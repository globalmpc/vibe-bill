import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { Resend } from "resend";
import Stripe from "stripe";
import { ClerkExpressRequireAuth } from "@clerk/clerk-sdk-node";

const app = express();
app.use(express.json());
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

app.post("/ticket", ClerkExpressRequireAuth(), async (req, res) => {
  const msg = await anthropic.messages.create({
    model: "claude-3-5-sonnet-20241022",
    max_tokens: 500,
    messages: [{ role: "user", content: req.body.text }],
  });
  await resend.emails.send({ from: "help@example.com", to: req.body.email, subject: "Re: your ticket", text: msg.content[0].text });
  res.json({ ok: true });
});

app.post("/checkout", ClerkExpressRequireAuth(), async (req, res) => {
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: req.body.priceId, quantity: 1 }],
    success_url: "https://example.com/ok",
  });
  res.json({ url: session.url });
});

app.listen(3000);
