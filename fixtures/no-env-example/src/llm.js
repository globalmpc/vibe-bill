import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL,
});

export async function summarize(text) {
  const res = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL,
    messages: [{ role: "user", content: `Summarize:\n${text}` }],
  });
  return res.choices[0].message.content;
}
