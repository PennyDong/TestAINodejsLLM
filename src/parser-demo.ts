// src/parser-demo.ts
import "dotenv/config";
import * as readline from "node:readline";
import { z } from "zod";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatPromptTemplate } from "@langchain/core/prompts";

// 1. 定義預期的資料結構 (Schema)
const taskSchema = z.object({
  isTechRelated: z.boolean().describe("這段對話是否與軟體技術或寫程式相關？"),
  summary: z.string().describe("用一句話總結使用者的核心意圖"),
  actionItems: z
    .array(z.string())
    .describe("列出 1 到 3 個具體的待辦或行動清單，若無則回傳空陣列"),
  urgency: z
    .enum(["High", "Medium", "Low", "None"])
    .describe("評估此任務的緊急程度，若非任務請選 None"),
});

async function main() {
  // 2. 初始化模型與管線 (這部分只需要在程式啟動時做一次)
  const model = new ChatGoogleGenerativeAI({
    model: "gemini-3.6-flash",
    apiKey: process.env.GEMINI_API_KEY,
    temperature: 0.1,
  });

  const structuredModel = model.withStructuredOutput(taskSchema);

  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "你是一個專案管理的資料萃取機器人。請分析使用者的輸入，並嚴格按照 JSON 格式回傳。",
    ],
    ["human", "{input}"],
  ]);

  const chain = prompt.pipe(structuredModel);

  // 3. 建立互動式終端機 (Readline)
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("=== 💡 即時任務萃取機器人已啟動 ===");
  console.log(
    "請隨意輸入一段話（例如交辦事項、抱怨或閒聊），系統會自動將其結構化。",
  );
  console.log("輸入 'exit' 離開程式。\n");

  rl.setPrompt("請輸入內容 > ");
  rl.prompt();

  // 4. 監聽使用者的動態輸入
  rl.on("line", async (input: string) => {
    const trimmedInput = input.trim();

    // 防呆處理
    if (!trimmedInput) return rl.prompt();
    if (trimmedInput.toLowerCase() === "exit") {
      console.log("系統關閉中...");
      return process.exit(0);
    }

    try {
      process.stdout.write("⚙️  分析中...\n");

      // 關鍵：將使用者即時輸入的文字 (trimmedInput) 傳給模型
      const result = await chain.invoke({ input: trimmedInput });

      // 將回傳的強型別物件美化印出
      console.log("\n✅ [解析完成] 對應的 TypeScript 物件：");
      console.log(JSON.stringify(result, null, 2));
      console.log("-".repeat(40) + "\n");
    } catch (err: any) {
      // Output Parser 有時會遇到模型輸出不符合 Schema 導致解析失敗的例外狀況
      console.error(
        "\n❌ 解析失敗，模型回傳的格式不符或發生錯誤：",
        err.message,
      );
    }

    // 處理完畢，等待下一次輸入
    rl.prompt();
  });
}

main();
