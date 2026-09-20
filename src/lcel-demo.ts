// src/lcel-demo.ts
import "dotenv/config";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { RunnableSequence } from "@langchain/core/runnables";

/*
LLM 本身是一個 Runnable：它接收文字或結構化提示，回傳模型生成的內容。
提示模板是一個 Runnable：它接收使用者輸入的參數，套入提示模板，產生最終送給模型的 prompt。
輸出解析器也是 Runnable：它負責將模型輸出的內容解析成結構化資料，方便後續應用程式處理。

RunnableSequence：順序執行 Runnable
提示 → 模型 → 解析

const chain = RunnableSequence.from([
  promptTemplate,
  llm,
  parser,
]);
*/

async function main() {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-3.6-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.1,
  });

  // ==========================================
  // Chain 1: 負責撰寫程式碼的管線
  // 輸出結果：純文字 (String)
  // ==========================================
  const codePrompt = ChatPromptTemplate.fromTemplate(
    "請用 C# 寫一個 {task} 的功能，只要回傳程式碼即可，不要包含 Markdown 語法或任何廢話。",
  );
  const coderChain = codePrompt.pipe(model).pipe(new StringOutputParser());

  // ==========================================
  // Chain 2: 負責 Code Review 的管線
  // 輸出結果：強型別 JSON 物件 (Zod Schema)
  // ==========================================
  const reviewSchema = z.object({
    hasVulnerability: z
      .boolean()
      .describe("程式碼是否有潛在的 SQL Injection 風險或漏洞"),
    score: z.number().describe("程式碼品質評分 (1-10)"),
    suggestions: z.array(z.string()).describe("具體的重構或改進建議清單"),
  });

  const reviewerModel = model.withStructuredOutput(reviewSchema);
  const reviewPrompt = ChatPromptTemplate.fromTemplate(
    "你是一位嚴格的後端架構師。請審查以下 C# 程式碼並回傳分析報告：\n\n{code}",
  );
  const reviewerChain = reviewPrompt.pipe(reviewerModel);

  // ==========================================
  // 核心魔法：使用 LCEL (RunnableSequence) 組合管線
  // ==========================================
  const workflow = RunnableSequence.from([
    {
      // 這裡會先執行 coderChain，並將其結果 (字串) 賦值給 code 變數
      code: coderChain,
    },
    // 接著將包含了 { code: "..." } 的物件餵給下一個管線
    reviewerChain,
  ]);

  console.log("🚀 開始執行自動化生成與審查流程...\n");

  // 只要呼叫最外層的 workflow，LCEL 就會在底層自動依照順序執行
  const result = await workflow.invoke({
    task: "透過 ADO.NET 連接 SQL Server，並使用參數化查詢 (SqlParameter) 根據傳入的使用者名稱來刪除使用者",
  });

  console.log("✅ 審查報告 (TypeScript 物件)：");
  console.log(JSON.stringify(result, null, 2));
}

main();
