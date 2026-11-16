import { connection } from "next/server";
import { llmConfig } from "@/lib/er/llm";

export async function GET() {
  await connection(); // read env at request time, not at build time
  const cfg = llmConfig();
  return Response.json(cfg ? { mode: "llm", ...cfg } : { mode: "rules" });
}
