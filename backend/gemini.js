import dotenv from "dotenv";
dotenv.config();

import { GoogleGenAI } from "@google/genai";

console.log(
  process.env.GEMINI_API_KEY
    ? "✅ Gemini key loaded"
    : "❌ Gemini key missing"
);

let ai;

// The SDK requires a key when constructed. Initialize it when a request uses
// Gemini so importing the Vercel function does not require build-time secrets.
export function getGeminiClient() {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return ai;
}

export default getGeminiClient;
