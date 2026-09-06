import "dotenv/config";
import * as readline from "node:readline";
import { OpenAI } from "openai";

async function main() {
  const openai = new OpenAI();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("GPT Chatbot 已啟動，輸入訊息開始對話 ( 按 Ctrl+C 離開 )。\n");
  rl.setPrompt("> ");
  rl.prompt();

  // 將 input 明確標註為 string
  rl.on("line", async (input: string) => {
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      rl.prompt();
      return;
    }

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: trimmedInput }],
      });

      console.log(`\nAI: ${response.choices[0].message.content}\n`);
    } catch (error) {
      console.error("呼叫 API 發生錯誤：", error);
    }

    rl.prompt();
  });
}

main();
