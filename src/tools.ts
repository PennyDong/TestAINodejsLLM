// src/tools.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
// 工具 1：取得系統時間
export const getSystemTimeTool = tool(
  async () => {
    // 這裡我們直接回傳字串，LangChain 會自動將它餵回給模型
    return new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
  },
  {
    name: "getSystemTime",
    description:
      "當使用者詢問目前的日期、時間或星期幾時，呼叫此工具以獲取系統時間。",
    // 如果工具不需要參數，可以用空的 Zod Schema
    schema: z.object({}),
  },
);

// 工具 2：模擬股票查詢 API
export const queryStockPriceTool = new DynamicStructuredTool({
  name: "queryStockPrice",
  description: "當使用者詢問股票價格時，呼叫此工具。",
  schema: z.object({
    // 支援傳入 string 或 number，並強制轉為 string 處理
    symbol: z
      .union([z.string(), z.number()])
      .describe("股票代碼或名稱，例如 TSLA、AAPL 或 2330"),
  }),
  func: async ({ symbol }: any) => {
    const symbolStr = String(symbol).trim();
    console.log(`\n[系統日誌] 正在呼叫外部 API 查詢 ${symbolStr} 股價...`);

    const mockDb: Record<string, string> = {
      TSLA: "特斯拉 (TSLA) 目前股價為 185.20 USD",
      AAPL: "蘋果 (AAPL) 目前股價為 173.50 USD",
      GOOGL: "Google (GOOGL) 目前股價為 142.10 USD",
      "2330": "台積電 (2330) 目前股價為 820 TWD",
      台積電: "台積電 (2330) 目前股價為 820 TWD",
    };

    return (
      mockDb[symbolStr.toUpperCase()] ||
      mockDb[symbolStr] ||
      `找不到 ${symbolStr} 的股價資訊`
    );
  },
});
