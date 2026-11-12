"use client";
import { useState } from "react";

export default function Chat() {
  const [reply, setReply] = useState("");

  // Fires an LLM call on every keystroke.
  async function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const r = await fetch("/api/chat", { method: "POST", body: JSON.stringify({ text: e.target.value }) });
    setReply((await r.json()).reply);
  }

  return (
    <main>
      <input onChange={onChange} placeholder="Ask anything" />
      <p>{reply}</p>
    </main>
  );
}
