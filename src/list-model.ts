// list-models.ts
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";

async function checkModels() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.list();
  for await (const model of response) {
    if (model.name?.includes("flash")) {
      console.log(model.name);
    }
  }
}

checkModels();
//指令 npx ts-node src/list-model.ts
