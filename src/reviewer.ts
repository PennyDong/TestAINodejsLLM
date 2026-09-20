// src/reviewer.ts 抽離審查服務
import "dotenv/config";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { RunnableBranch, RunnableSequence } from "@langchain/core/runnables";
import { StringOutputParser } from "@langchain/core/output_parsers";

// 1. 統一的輸出格式 (不論語言)
const reviewSchema = z.object({
  hasVulnerability: z
    .boolean()
    .describe("是否有資安風險、效能瓶頸或 Memory Leak"),
  score: z.number().describe("程式碼品質綜合評分 (1-10)"),
  suggestions: z.array(z.string()).describe("具體的重構或改進建議"),
});

export async function analyzeCode(codeContent: string) {
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-3.6-flash",
    temperature: 0.0,
  });

  // ==========================================
  // 節點 A：語言偵測器 (分類器)
  // ==========================================
  const detectorPrompt = ChatPromptTemplate.fromTemplate(
    "請判斷以下程式碼的語言是 'csharp' 還是 'typescript'？只要回傳這兩個單字其中之一，不要有其他廢話。\n\n{code}",
  );
  const languageDetector = detectorPrompt
    .pipe(model)
    .pipe(new StringOutputParser());

  // ==========================================
  // 節點 B：針對不同技術棧的專屬 Prompt
  // ==========================================
  // C# 專屬審查
  const csharpPrompt = ChatPromptTemplate.fromTemplate(
    "你是一位 C#/.NET 後端架構師。請審查以下代碼，特別留意 SQL Server 的防護、ADO.NET 資源釋放與非同步設計：\n\n{code}",
  );
  const csharpChain = csharpPrompt.pipe(
    model.withStructuredOutput(reviewSchema),
  );

  // Angular / TypeScript 專屬審查
  const tsPrompt = ChatPromptTemplate.fromTemplate(
    "你是一位前端架構師。請審查以下 TypeScript 代碼，特別留意 Angular Directive 的拖曳事件效能、生命週期 (OnDestroy) 以及 RxJS 的 Memory Leak：\n\n{code}",
  );
  const tsChain = tsPrompt.pipe(model.withStructuredOutput(reviewSchema));

  // 預設審查 (通用)
  const defaultPrompt = ChatPromptTemplate.fromTemplate(
    "你是一位資深工程師。請審查以下代碼：\n\n{code}",
  );
  const defaultChain = defaultPrompt.pipe(
    model.withStructuredOutput(reviewSchema),
  );

  // ==========================================
  // 節點 C：使用 RunnableBranch 建立條件路由
  // ==========================================
  const routingBranch = RunnableBranch.from([
    [
      (x: { language: string; code: string }) => x.language.includes("csharp"),
      csharpChain,
    ],
    [
      (x: { language: string; code: string }) =>
        x.language.includes("typescript"),
      tsChain,
    ],
    defaultChain, // 如果都無法識別，走預設通道
  ]);

  // ==========================================
  // 終極魔法：組裝完整的動態工作流
  // ==========================================
  const workflow = RunnableSequence.from([
    {
      code: (input: { code: string }) => input.code,
      // 讓 detector 算出語言，並放入 language 變數中
      language: languageDetector,
    },
    // 將包含 { code, language } 的物件交給路由去決定走哪一條管線
    routingBranch,
  ]);

  // 執行並回傳
  return await workflow.invoke({ code: codeContent });
}
