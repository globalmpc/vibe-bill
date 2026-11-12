import OpenAI from "openai";
import { supabase } from "../../../lib/supabase";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: Request) {
  const { text } = await req.json();
  const res = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: text }],
  });
  const reply = res.choices[0].message.content;
  await supabase.from("messages").insert({ text, reply });
  return Response.json({ reply });
}
