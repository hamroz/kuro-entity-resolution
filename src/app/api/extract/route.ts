import { llmConfig, llmExtract } from "@/lib/er/llm";
import type { Doc } from "@/lib/er/types";

export const maxDuration = 60;

const MAX_CHARS = 60_000;

export async function POST(request: Request) {
  const cfg = llmConfig();
  if (!cfg) return Response.json({ error: "No ANTHROPIC_API_KEY or OPENAI_API_KEY configured" }, { status: 400 });
  let doc: Doc;
  try {
    doc = (await request.json()).doc;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!doc || typeof doc.text !== "string" || typeof doc.id !== "string") {
    return Response.json({ error: "expected { doc: { id, text, ... } }" }, { status: 400 });
  }
  if (doc.text.length > MAX_CHARS) return Response.json({ error: "document too long for the demo" }, { status: 413 });
  try {
    const { mentions, dropped } = await llmExtract(doc);
    return Response.json({ mentions, dropped, ...cfg });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "extraction failed" }, { status: 502 });
  }
}
