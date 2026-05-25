import OpenAI from "openai";

const model = process.env.DEEPSEEK_MODEL;
if (!model) {
  console.error("Set DEEPSEEK_MODEL to your DeepSeek model id.");
  process.exit(2);
}

const client = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: process.env.DEEPSEEK_BASE_URL || "http://127.0.0.1:8787/v1",
});

const response = await client.chat.completions.create({
  model,
  messages: [
    { role: "user", content: "Say hello in one short sentence." },
  ],
});

console.log(response.choices[0]?.message?.content || response.choices[0]?.message);

