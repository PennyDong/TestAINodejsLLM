// src/tools.ts
import { FunctionDeclaration, Type } from "@google/genai";

// 1. 定義給 Gemini 閱讀的 Tool Schema
export const getCurrentTimeToolDeclaration: FunctionDeclaration = {
  name: "getCurrentTime",
  description: "取得指定時區的當前真實時間與日期",
  parameters: {
    type: Type.OBJECT,
    properties: {
      timeZone: {
        type: Type.STRING,
        description:
          "IANA 時區代碼，例如 'Asia/Taipei', 'America/New_York', 'UTC'",
      },
    },
    required: ["timeZone"],
  },
};

// 2. 應用程式端的真實執行邏輯 (Dispatcher)
export const executableTools: Record<
  string,
  (args: any) => Promise<any> | any
> = {
  getCurrentTime: ({ timeZone }: { timeZone: string }) => {
    try {
      const now = new Date().toLocaleString("zh-TW", { timeZone });
      return { status: "success", timeZone, currentTime: now };
    } catch {
      return { status: "error", message: `無效的時區名稱: ${timeZone}` };
    }
  },
};
