// src/history.ts
import * as path from "node:path";
import Database from "better-sqlite3";
import { BaseListChatMessageHistory } from "@langchain/core/chat_history";
import { BaseMessage, HumanMessage, AIMessage } from "@langchain/core/messages";

// 1. 初始化資料庫 (完全封裝在模組內部，不對外暴露 db 實例)
const dbPath = path.resolve(process.cwd(), "chat.db");
const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

const insertMsg = db.prepare(`
  INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)
`);

const MAX_CONTEXT_TURNS = 10;

// 2. 導出 LangChain 記憶體類別
export class SQLiteHistory extends BaseListChatMessageHistory {
  lc_namespace = ["langchain", "stores", "message", "sqlite"];
  private sessionId: string;

  constructor(sessionId: string) {
    super();
    this.sessionId = sessionId;
  }

  async getMessages(): Promise<BaseMessage[]> {
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
      .all(this.sessionId, MAX_CONTEXT_TURNS) as {
      role: string;
      content: string;
    }[];

    if (rows.length > 0 && rows[rows.length - 1].role === "user") {
      rows.pop();
    }

    return rows.map((row) =>
      row.role === "user"
        ? new HumanMessage(row.content)
        : new AIMessage(row.content),
    );
  }

  async addMessage(message: BaseMessage): Promise<void> {
    const role = message._getType() === "human" ? "user" : "model";
    insertMsg.run(this.sessionId, role, message.content.toString());
  }

  async addMessages(messages: BaseMessage[]): Promise<void> {
    const saveChat = db.transaction(() => {
      for (const msg of messages) {
        const role = msg._getType() === "human" ? "user" : "model";
        insertMsg.run(this.sessionId, role, msg.content.toString());
      }
    });
    saveChat();
  }

  async clear(): Promise<void> {
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(this.sessionId);
  }

  // 3. 提供安全的對外 API 來關閉資料庫
  static closeConnection() {
    db.close();
  }
}
