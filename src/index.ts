// src/index.ts
import "dotenv/config";
import * as readline from "node:readline";

import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  ChatPromptTemplate,
  MessagesPlaceholder,
} from "@langchain/core/prompts";
import { RunnableWithMessageHistory } from "@langchain/core/runnables";

import { PROMPTS } from "./prompts";
import { SQLiteHistory } from "./history";

const CURRENT_SESSION = "default_session";

// 1. 修改模板：加入 {currentTime} 動態變數插槽
const prompt = ChatPromptTemplate.fromMessages([
  [
    "system",
    `{systemInstruction}\n\n【系統環境】目前伺服器的真實時間為：{currentTime}。若使用者詢問日期、時間或星期幾，請直接依據此時間回答，無須提供程式碼。`,
  ],
  new MessagesPlaceholder("history"),
  ["human", "{input}"],
]);

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let currentRoleKey = "tech";

  console.log("=== Gemini CLI (動態 Prompt Template 版) ===");
  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", async (input: string) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) return rl.prompt();

    // 處理角色切換指令
    if (trimmedInput.startsWith("/role")) {
      const targetRole = trimmedInput.replace("/role", "").trim();
      if (PROMPTS[targetRole]) {
        currentRoleKey = targetRole;
        console.log(`\n已成功切換角色為：【${PROMPTS[targetRole].name}】\n`);
      } else {
        console.log(`\n查無此角色代碼「${targetRole}」。輸入 /role 查看清單\n`);
      }
      return rl.prompt();
    }

    try {
      const activePrompt = PROMPTS[currentRoleKey] || PROMPTS.default;

      const model = new ChatGoogleGenerativeAI({
        model: "gemini-3.6-flash",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: activePrompt.temperature,
        topP: activePrompt.topP,
        maxRetries: 3,
      });

      const chain = prompt.pipe(model);

      const withHistory = new RunnableWithMessageHistory({
        runnable: chain,
        getMessageHistory: (sessionId) => new SQLiteHistory(sessionId),
        inputMessagesKey: "input",
        historyMessagesKey: "history",
      });

      process.stdout.write(`\n[${activePrompt.name}]: `);

      // 2. 獲取當下的系統時間 (設定為台北時區)
      const now = new Date().toLocaleString("zh-TW", {
        timeZone: "Asia/Taipei",
      });

      // 3. 將三個變數 (input, systemInstruction, currentTime) 一併注入管線
      const stream = await withHistory.stream(
        {
          input: trimmedInput,
          systemInstruction: activePrompt.instruction,
          currentTime: now,
        },
        { configurable: { sessionId: CURRENT_SESSION } },
      );

      for await (const chunk of stream) {
        if (chunk.content) process.stdout.write(chunk.content.toString());
      }
      process.stdout.write("\n\n");
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
