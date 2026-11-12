import express from "express";
import { summarize } from "./llm.js";

const app = express();
app.use(express.json());
app.post("/summarize", async (req, res) => res.json({ summary: await summarize(req.body.text) }));
app.listen(3000);
