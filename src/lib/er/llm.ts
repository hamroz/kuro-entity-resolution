// LLM extraction (server only). Used when ANTHROPIC_API_KEY or OPENAI_API_KEY
// is set; otherwise the app uses the rule-based extractor in extract.ts.
//
// The model proposes mentions and their context; this module grounds every
// proposal in the source text. A mention whose surface string cannot be found
// on (or near) the line the model named is dropped - no evidence, no fact.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { emptyCtx, findTrade, lineOf, lineOffsets } from "./extract";
import { normalizeStreet, orgCore, personParts } from "./normalize";
import type { Doc, Mention } from "./types";

const LlmMention = z.object({
  surface: z.string().describe("the name exactly as written in the text, without titles like Herr/Frau/Fa."),
  type: z.enum(["org", "person"]),
  line: z.number().int().describe("1-based line number where this occurrence appears"),
  city: z.string().nullable(),
  street: z.string().nullable().describe("street and house number, e.g. 'Industriestraße 12'"),
  vat_id: z.string().nullable(),
  register_no: z.string().nullable().describe("commercial register, e.g. 'HRB 145233'"),
  vendor_no: z.string().nullable().describe("vendor / Kreditor number used by the recipient"),
  trade: z.string().nullable().describe("construction trade (Gewerk), e.g. Rohbau, Elektro, Fassade"),
  role: z.string().nullable().describe("role in the document: bidder, issuer, subcontractor, site manager, ..."),
  email_domain: z.string().nullable(),
  employer: z.string().nullable().describe("persons only: surface of the organisation they act for, if stated"),
  alias_of: z.string().nullable().describe("orgs only: another org surface stated to be the same firm (trade name vs legal name)"),
});
const LlmOutput = z.object({ mentions: z.array(LlmMention) });
type LlmMentionT = z.infer<typeof LlmMention>;

const SYSTEM = `You extract organisation and person mentions from German and English construction documents
(bills of quantities, quotes, invoices, site diaries, award memos).
Return every occurrence separately, including short or misspelled variants ("Mueller-Bau", "M. Bau GmbH & Co. KG").
For each occurrence give the exact surface text and the line number shown in the L-prefix.
Only fill context fields with facts stated near that occurrence (same line or same address/letterhead block).
Never infer or normalise identities: two spellings are two mentions. Use null when a field is not stated.`;

export type Provider = "anthropic" | "openai";

export function llmConfig(): { provider: Provider; model: string } | null {
  const forced = process.env.LLM_PROVIDER as Provider | undefined;
  if ((forced === "anthropic" || !forced) && process.env.ANTHROPIC_API_KEY) {
    return { provider: "anthropic", model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5" };
  }
  if ((forced === "openai" || !forced) && process.env.OPENAI_API_KEY) {
    return { provider: "openai", model: process.env.OPENAI_MODEL || "gpt-4.1-mini" };
  }
  return null;
}

function numbered(text: string): string {
  return text
    .split("\n")
    .map((l, i) => `L${String(i + 1).padStart(3, "0")}| ${l}`)
    .join("\n");
}

async function callAnthropic(model: string, doc: Doc): Promise<LlmMentionT[]> {
  const client = new Anthropic();
  const msg = await client.messages.parse({
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { format: zodOutputFormat(LlmOutput), effort: "low" },
    messages: [{ role: "user", content: `Document "${doc.title}" (project ${doc.project}):\n\n${numbered(doc.text)}` }],
  });
  if (msg.stop_reason === "refusal") throw new Error("model declined the request");
  if (!msg.parsed_output) throw new Error("model returned no structured output");
  return msg.parsed_output.mentions;
}

function strictSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictSchema);
  if (node && typeof node === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "$schema") continue;
      o[k] = strictSchema(v);
    }
    if (o.type === "object" && o.properties) {
      o.additionalProperties = false;
      o.required = Object.keys(o.properties as object);
    }
    return o;
  }
  return node;
}

async function callOpenAI(model: string, doc: Doc): Promise<LlmMentionT[]> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Document "${doc.title}" (project ${doc.project}):\n\n${numbered(doc.text)}` },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "mentions", strict: true, schema: strictSchema(z.toJSONSchema(LlmOutput)) },
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  return LlmOutput.parse(JSON.parse(content)).mentions;
}

function normStreet(s: string | null): string | null {
  if (!s) return null;
  const m = /^(.*?)\s*(\d{1,4}[a-z]?)\s*$/.exec(s.trim());
  return m ? normalizeStreet(m[1]) + " " + m[2] : normalizeStreet(s);
}

function normRegister(s: string | null): string | null {
  if (!s) return null;
  const m = /(HR[AB])\s*(\d{3,6})/.exec(s);
  return m ? `${m[1]} ${m[2]}` : s.trim();
}

/** Turn model proposals into grounded mentions with exact offsets. */
export function groundMentions(doc: Doc, proposals: LlmMentionT[], how: string): { mentions: Mention[]; dropped: number } {
  const lines = lineOffsets(doc.text);
  const used = new Set<number>();
  const mentions: Mention[] = [];
  const raw: { m: Mention; p: LlmMentionT }[] = [];
  let dropped = 0;
  for (const p of proposals) {
    const surface = p.surface.trim();
    if (!surface) continue;
    let start = -1;
    const li = p.line - 1;
    if (li >= 0 && li < lines.length) {
      const [ls, le] = lines[li];
      let from = ls;
      while (from <= le) {
        const i = doc.text.indexOf(surface, from);
        if (i < 0 || i + surface.length > le) break;
        if (!used.has(i)) {
          start = i;
          break;
        }
        from = i + 1;
      }
    }
    if (start < 0) {
      let from = 0;
      while (true) {
        const i = doc.text.indexOf(surface, from);
        if (i < 0) break;
        if (!used.has(i)) {
          start = i;
          break;
        }
        from = i + 1;
      }
    }
    if (start < 0) {
      dropped++;
      continue;
    }
    used.add(start);
    const ctx = emptyCtx(doc.project);
    const vat = p.vat_id ? p.vat_id.replace(/\s+/g, "").toUpperCase() : null;
    Object.assign(ctx, {
      city: p.city || null,
      street: normStreet(p.street),
      vat,
      register: normRegister(p.register_no),
      vendor: p.vendor_no ? p.vendor_no.replace(/\D/g, "") || null : null,
      trade: p.trade ? findTrade(p.trade) ?? p.trade : null,
      role: p.role || null,
      email_domain: p.email_domain ? p.email_domain.toLowerCase() : null,
    });
    let norm: Mention["norm"];
    if (p.type === "org") {
      const core = orgCore(surface);
      ctx.legal_form = core.legal_form;
      if (!ctx.city && core.city) ctx.city = core.city;
      norm = { tokens: core.tokens, compact: core.compact };
    } else {
      norm = personParts(surface);
    }
    const m: Mention = {
      id: `${doc.id}:${start}`, doc_id: doc.id, type: p.type, surface, start, end: start + surface.length,
      line: lineOf(lines, start) + 1, extractor: "llm", how, ctx, norm,
    };
    raw.push({ m, p });
    mentions.push(m);
  }
  const orgs = mentions.filter((m) => m.type === "org");
  for (const { m, p } of raw) {
    if (m.type === "person" && p.employer) {
      const cands = orgs.filter((o) => o.surface === p.employer!.trim());
      cands.sort((x, y) => Math.abs(x.start - m.start) - Math.abs(y.start - m.start));
      if (cands[0]) {
        m.ctx.org_mention_id = cands[0].id;
        m.ctx.org_surface = cands[0].surface;
      }
    }
    if (m.type === "org" && p.alias_of) {
      const other = orgs.find((o) => o.surface === p.alias_of!.trim() && o.line === m.line && o.id !== m.id);
      if (other) {
        m.ctx.alias_of = other.id;
        other.ctx.alias_of = m.id;
      }
    }
  }
  mentions.sort((a, b) => a.start - b.start);
  return { mentions, dropped };
}

export async function llmExtract(doc: Doc): Promise<{ mentions: Mention[]; dropped: number }> {
  const cfg = llmConfig();
  if (!cfg) throw new Error("no LLM configured");
  const proposals = cfg.provider === "anthropic" ? await callAnthropic(cfg.model, doc) : await callOpenAI(cfg.model, doc);
  return groundMentions(doc, proposals, `${cfg.provider}:${cfg.model}`);
}
