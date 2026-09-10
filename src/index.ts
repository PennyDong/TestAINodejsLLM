// src/index.ts
import "dotenv/config";
import * as readline from "node:readline";
import * as path from "node:path";
import Database from "better-sqlite3";
import { GoogleGenAI } from "@google/genai";
import { PROMPTS } from "./prompts";

// 1. 指定資料庫路徑 (此處放在專案根目錄下的 chat.db)
const dbPath = path.resolve(process.cwd(), "chat.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL"); // 開啟 WAL 模式，避免併發讀寫或強制中斷時壞檔

// 2. 建立資料表 (若不存在)
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const CURRENT_SESSION = "default_session";
const MAX_CONTEXT_TURNS = 10; // 滑動視窗：只帶最近 10 筆歷史

// 資料庫操作預編譯 (提高效能)
const insertMsg = db.prepare(`
  INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)
`);

/*
user: 代表發問者輸入的問題、指令或上傳的檔案。
model(openAI:assistant): 代表AI 先前產生的回答。在送出歷史對話時帶入，模型才知道「我上一句說了什麼」。
system: 代表隱形裁判 / 人設指令（如「你是一個資深工程師，回答必須簡短」）。在 Gemini 中通常抽成獨立的 systemInstruction，不在對話列表內。
function/tool: 當 AI 呼叫了外部 API（如查詢天氣、搜尋 Google、執行程式）後，將工具回傳的結果餵回給模型時使用的角色。
*/
interface MessageRow {
  role: "user" | "model";
  content: string;
}

// 取得最近歷史對話，並組裝為 Gemini API 的 contents 格式
function getRecentHistory(limit: number = MAX_CONTEXT_TURNS) {
  const rows = db
    .prepare(
      `
      SELECT role, content FROM (
        SELECT id, role, content FROM messages
        WHERE session_id = ?
        ORDER BY id DESC
        LIMIT ?
      ) ORDER BY id ASC
    `,
    )
    .all(CURRENT_SESSION, limit) as MessageRow[];

  // 防禦邏輯：如果歷史紀錄中最後一筆剛好是 'user'（先前失敗留下的），把它剔除
  if (rows.length > 0 && rows[rows.length - 1].role === "user") {
    rows.pop();
  }

  return rows.map((row) => ({
    role: row.role,
    parts: [{ text: row.content }],
  }));
}

async function main() {
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // 1. 當前啟用的角色 Key（預設為技術顧問）
  let currentRoleKey = "tech";

  console.log("=== Gemini CLI 已啟動 ===");
  console.log(`目前角色：【${PROMPTS[currentRoleKey].name}】`);
  console.log("指令說明：輸入 /role 查看可切換角色清單\n");
  console.log(
    `Gemini Chatbot (串流 + SQLite 記憶模式) 已啟動。\n資料庫位置: ${dbPath}\n輸入訊息開始對話（按 Ctrl+C 離開）。\n`,
  );
  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", async (input: string) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      rl.prompt();
      return;
    }

    // 2. 指令攔截：查看角色清單
    if (trimmedInput === "/role") {
      console.log("\n可用的角色代碼：");
      Object.keys(PROMPTS).forEach((key) => {
        const isCurrent = key === currentRoleKey ? " (目前使用中)" : "";
        console.log(
          `- /role ${key.padEnd(8)} : ${PROMPTS[key].name}${isCurrent}`,
        );
      });
      console.log(
        "\n使用方式：輸入 /role <代碼> 切換角色（例：/role review）\n",
      );
      rl.prompt();
      return;
    }

    // 3. 指令攔截：切換指定角色
    if (trimmedInput.startsWith("/role ")) {
      const targetRole = trimmedInput.replace("/role ", "").trim();
      if (PROMPTS[targetRole]) {
        currentRoleKey = targetRole;
        console.log(`\n已成功切換角色為：【${PROMPTS[targetRole].name}】\n`);
      } else {
        console.log(
          `\n查無此角色代碼「${targetRole}」，輸入 /role 可查看清單。\n`,
        );
      }
      rl.prompt();
      return;
    }

    try {
      // 1. 先從 DB 取出「先前的歷史對話」
      const historyContents = getRecentHistory();

      // 2. 將本次提問暫存到即將送出的陣列中（此時先不寫入 SQLite）
      const requestContents = [
        ...historyContents,
        { role: "user", parts: [{ text: trimmedInput }] },
      ];

      // 3. 呼叫 API 進行串流
      // 取得當前啟用角色設定
      const activeConfig = PROMPTS[currentRoleKey] || PROMPTS.default;

      // 注入 systemInstruction 與調控參數
      const responseStream = await withRetry(() =>
        ai.models.generateContentStream({
          model: "gemini-3.6-flash",
          contents: requestContents,
          config: {
            systemInstruction: activeConfig.instruction,
            temperature: activeConfig.temperature, // 動態套用 Temperature
            topP: activeConfig.topP, // 動態套用 Top-P
            topK: activeConfig.topK, // 動態套用 Top-K（若有定義）
          },
        }),
      );
      process.stdout.write("\nAI: ");
      let fullReplyText = "";
      for await (const chunk of responseStream) {
        if (chunk.text) {
          process.stdout.write(chunk.text);
          fullReplyText += chunk.text;
        }
      }
      process.stdout.write("\n\n");

      // 4. 全部順利完成後，才一併寫入 SQLite（保證成雙成對）
      if (fullReplyText.trim().length > 0) {
        const insertBoth = db.transaction(() => {
          insertMsg.run(CURRENT_SESSION, "user", trimmedInput);
          insertMsg.run(CURRENT_SESSION, "model", fullReplyText);
        });
        insertBoth(); // 使用 better-sqlite3 的事務，保證兩筆同時成功或同時失敗
      }
    } catch (err) {
      // 若 API 發生 503、限流或網路中斷，DB 完全沒被汙染，使用者隨時能直接重試
      console.error("\n[錯誤] 呼叫失敗，對話未儲存，請重新輸入：", err);
    }

    rl.prompt();
  });

  // 優雅關閉資料庫連線
  rl.on("close", () => {
    db.close();
    process.exit(0);
  });
}

main();

// 自動重試輔助函式：遇到 503 時自動暫停並遞增重試
async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1500,
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    // 檢查是否為 503 或伺服器過載狀態
    const isUnavailable =
      err.status === 503 ||
      err.message?.includes("503") ||
      err.message?.includes("high demand") ||
      err.message?.includes("UNAVAILABLE");

    if (isUnavailable && retries > 0) {
      console.warn(
        `\n[提示] Google 伺服器目前流量尖峰 (503)，等待 ${(delayMs / 1000).toFixed(1)} 秒後自動重試... (剩餘次數: ${retries})`,
      );
      await new Promise((res) => setTimeout(res, delayMs));
      return withRetry(fn, retries - 1, delayMs * 2); // 指數退避，每次延遲加倍
    }
    throw err;
  }
}
