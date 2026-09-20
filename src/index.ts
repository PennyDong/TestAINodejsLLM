// src/index.ts
import "dotenv/config";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";
import { createToolCallingAgent, AgentExecutor } from "langchain/agents";

// 匯入我們先前建立的模組
import { PROMPTS } from "./prompts";
import { SQLiteHistory } from "./history";
import { analyzeCode } from "./reviewer";
import { getSystemTimeTool, queryStockPriceTool } from "./tools";

const CURRENT_SESSION = "default_session";

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let currentRoleKey = "tech";

  console.log("=== 🚀 Gemini 全功能 CLI (記憶 + 工具 + 審查) ===");
  console.log(`目前角色：【${PROMPTS[currentRoleKey]?.name || "預設"}】`);
  console.log("指令說明：/role [代碼] 切換角色 | /review [路徑] 審查檔案\n");

  rl.setPrompt("> ");
  rl.prompt();

  // 1. 準備工具清單
  const tools = [getSystemTimeTool, queryStockPriceTool];

  // 2. 定義 Agent 專用的 Prompt 模板 (結合了歷史紀錄與 Agent 暫存區)
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "{systemInstruction}"],
    new MessagesPlaceholder("history"), // 歷史記憶插槽
    ["human", "{input}"],
    new MessagesPlaceholder("agent_scratchpad"), // Agent 思考與工具執行結果的插槽
  ]);

  rl.on("line", async (input: string) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return rl.prompt();

    // ==========================================
    // ⚡ 入口 A：角色切換指令 (/role)
    // ==========================================
    if (trimmedInput.startsWith("/role")) {
      const targetRole = trimmedInput.replace("/role", "").trim();
      if (PROMPTS[targetRole]) {
        currentRoleKey = targetRole;
        console.log(`\n✅ 已成功切換角色為：【${PROMPTS[targetRole].name}】\n`);
      } else {
        console.log(`\n❌ 查無此角色代碼「${targetRole}」。\n`);
      }
      return rl.prompt();
    }

    // ==========================================
    // ⚡ 入口 B：實體檔案審查指令 (/review)
    // ==========================================
    if (trimmedInput.startsWith("/review ")) {
      const rawPath = trimmedInput.replace("/review ", "").trim();
      const targetPath = path.resolve(process.cwd(), rawPath);

      try {
        if (!fs.existsSync(targetPath)) {
          console.log(`\n❌ 找不到檔案：${targetPath}\n`);
          return rl.prompt();
        }

        console.log(`\n📄 正在讀取檔案：${targetPath}`);
        const codeContent = fs.readFileSync(targetPath, "utf-8");

        console.log("⚙️  架構師 AI 正在進行深度審查 (動態語言路由)...\n");
        const result = await analyzeCode(codeContent);

        console.log("================ 審查報告 ================");
        console.log(
          `🛡️  資安與致命缺陷：${result.hasVulnerability ? "❌ 發現風險" : "✅ 安全"}`,
        );
        console.log(`⭐  架構綜合評分：${result.score} / 10`);
        console.log(`💡  改進建議：`);
        if (result.suggestions.length === 0) {
          console.log("    (無，程式碼品質優良)");
        } else {
          result.suggestions.forEach((item, index) =>
            console.log(`    ${index + 1}. ${item}`),
          );
        }
        console.log("==========================================\n");
      } catch (err: any) {
        console.error(`\n❌ 審查過程發生錯誤: ${err.message}\n`);
      }
      return rl.prompt();
    }

    // ==========================================
    // ⚡ 入口 C：日常對話與 Agent 工具調用
    // ==========================================
    try {
      const activePrompt = PROMPTS[currentRoleKey] || PROMPTS.default;

      // 每次對話動態實例化模型 (套用當前角色的 Temperature)
      const model = new ChatGoogleGenerativeAI({
        model: "gemini-3.6-flash",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: activePrompt.temperature,
        topP: activePrompt.topP,
        maxRetries: 3,
      });

      // 建立 Agent
      const agent = createToolCallingAgent({
        llm: model,
        tools: tools,
        prompt: prompt,
      });

      // 建立 Agent 執行器
      const agentExecutor = new AgentExecutor({ agent, tools: tools });

      // 【核心整合】將 AgentExecutor 套上 SQLite 記憶體託管
      const withHistory = new RunnableWithMessageHistory({
        runnable: agentExecutor,
        getMessageHistory: (sessionId) => new SQLiteHistory(sessionId),
        inputMessagesKey: "input",
        historyMessagesKey: "history",
      });

      process.stdout.write(`\n[${activePrompt.name} 思考中...]\n`);

      // 呼叫執行 (Agent 會自動決定要不要呼叫工具，並結合 SQLite 歷史紀錄)
      const response = await withHistory.invoke(
        {
          input: trimmedInput,
          systemInstruction: activePrompt.instruction,
        },
        { configurable: { sessionId: CURRENT_SESSION } },
      );
      console.log(`\n[${activePrompt.name}]: ${(response as any).output}\n`);
    } catch (err: any) {
      console.error("\n呼叫失敗：", err.message || err);
    }

    rl.prompt();
  });

  rl.on("close", () => {
    SQLiteHistory.closeConnection();
    process.exit(0);
  });
}

main();
