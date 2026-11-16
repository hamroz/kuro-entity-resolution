// Deterministic, rule-based mention extraction.
// Mirror of python/resolver/extract.py - keep in sync (the parity test checks it).

import { KNOWN_CITIES, fold, normalizeStreet, orgCore, personParts } from "./normalize";
import type { Doc, Mention, MentionContext } from "./types";

const L = "A-Za-zÄÖÜäöüß";
const UP = "A-ZÄÖÜ";
const LOW = "a-zäöüß";

const LEGAL_RAW = "(?:GmbH ?& ?Co\\. ?KG|GmbH|AG|KG|OHG|GbR|e\\. ?K\\.|UG|mbH|SE|Ltd\\.?)";
const NOT_LEGAL = "(?!(?:GmbH|AG|KG|OHG|GbR|UG|mbH|SE|Co\\.)(?![" + L + "]))";
const NAMETOK = NOT_LEGAL + "[" + UP + "][" + L + "]*\\.?(?:-[" + L + "]+)*";
const NAME_SEQ = NAMETOK + "(?: (?:& )?" + NAMETOK + "){0,4}";

const ORG_LEGAL_RE = new RegExp("(?<![" + L + "])(" + NAME_SEQ + ") (" + LEGAL_RAW + ")(?![" + L + "])", "g");
const ORG_LABEL_RE = new RegExp(
  "(?<![" + L + "])(?:Fa\\.|Firma) (" + NAMETOK + "(?: (?:& )?" + NAMETOK + "){0,3})",
  "g",
);

const STOP_LEAD = new Set([
  "Die", "Der", "Das", "Den", "Dem", "Firma", "Fa.", "The", "Note", "Hinweis", "Bidder",
  "Bieter", "Client", "An", "To", "From", "Von", "Mit", "With", "Recommendation", "Project",
  "Issued", "Award",
]);

const FIRST_NAMES = [
  "Thomas", "Sabine", "Jens", "Katrin", "Peter", "Jana", "Michael", "Andreas", "Stefan",
  "Anna", "Klaus", "Julia", "Martin", "Frank", "Petra", "Markus", "Lukas", "Laura", "Jonas", "Lea",
];
const FIRST = "(?:" + FIRST_NAMES.join("|") + ")";
const LAST = "[" + UP + "][" + LOW + "]+(?:-[" + UP + "][" + LOW + "]+)?";
const HON = "(?:Herrn|Herr|Frau|Hr\\.|Fr\\.|Mr\\.|Ms\\.|Mrs\\.)";
const B = "(?<![" + L + ".])";
const PERSON_RES = [
  new RegExp(B + HON + " (?:(?:" + FIRST + "|[" + UP + "]\\.) )?" + LAST + "(?![" + L + "])", "g"),
  new RegExp(B + LAST + ", " + FIRST + "(?![" + L + "])", "g"),
  new RegExp(B + FIRST + " " + LAST + "(?![" + L + "])", "g"),
  new RegExp(B + "[" + UP + "]\\. " + LAST + "(?![" + L + "])", "g"),
];

const VAT_RE = /(?<![A-Za-z])DE ?(\d{3}) ?(\d{3}) ?(\d{3})(?!\d)/;
const REG_RE = /(?<![A-Za-z])(HR[AB]) ?(\d{3,6})(?!\d)/;
const VENDOR_RE =
  /(?:Kreditor(?:en)?-?Nr\.?|Lieferanten-?Nr\.?|[Vv]endor (?:[Nn]o\.?|#|number))\s*:?\s*#?\s*(\d{3,6})(?!\d)/;
const POSTCODE_RE = new RegExp("(?<!\\d)\\d{5} ([" + UP + "][" + LOW + "]+)");
const CITY_RE = new RegExp("(?<![" + L + "])(" + KNOWN_CITIES.join("|") + ")(?![" + LOW + "])");
const STREET_RE = new RegExp(
  "(?<![" + L + "])(" +
    "(?:[" + UP + "][" + LOW + "]+[- ])+(?:Straße|Strasse|Str\\.|Damm|Weg|Allee|Platz|Ring|Chaussee|Landstraße)" +
    "|(?:[" + UP + "][" + LOW + "]+-)*[" + UP + "][" + LOW + "]*(?:straße|strasse|str\\.|weg|allee|platz|damm|ring|chaussee)" +
    ") (\\d{1,4}[a-z]?)(?![\\d])",
);
const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})/;
const ALIAS_GAP_RE =
  /^\s*(?:·|\||–|\()?\s*(?:ein Unternehmen der|eine Marke der|a trading name of|trading as|vormals|formerly)?\s*$/;
const LABEL_BEFORE_RE = new RegExp("([" + L + "][" + L + ". ]*?)\\s*:\\s*$");
const ROLE_AFTER_RE = new RegExp("^,\\s*([" + L + "][" + L + " ]{2,30}?)\\s*(?:,|\\(|$)");

const TRADES: [string, string][] = [
  ["generalbau", "General contractor"],
  ["generalunternehmer", "General contractor"],
  ["general contractor", "General contractor"],
  ["rohbau", "Rohbau"],
  ["hochbau", "Rohbau"],
  ["stahlbeton", "Rohbau"],
  ["beton", "Rohbau"],
  ["concrete", "Rohbau"],
  ["formwork", "Rohbau"],
  ["schalung", "Rohbau"],
  ["bewehrung", "Rohbau"],
  ["shell works", "Rohbau"],
  ["shell construction", "Rohbau"],
  ["elektro", "Elektro"],
  ["electrical", "Elektro"],
  ["electrician", "Elektro"],
  ["kabel", "Elektro"],
  ["cable", "Elektro"],
  ["fassade", "Fassade"],
  ["facade", "Fassade"],
  ["geruest", "Gerüst"],
  ["scaffold", "Gerüst"],
  ["sanitaer", "Sanitär/HLS"],
  ["heizung", "Sanitär/HLS"],
  ["plumbing", "Sanitär/HLS"],
];

export const TRADE_NAMES = Array.from(new Set(TRADES.map(([, t]) => t)));

export function findTrade(text: string): string | null {
  const f = fold(text);
  let bestIdx = -1;
  let best: string | null = null;
  for (const [kw, trade] of TRADES) {
    const idx = f.indexOf(kw);
    if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) {
      bestIdx = idx;
      best = trade;
    }
  }
  return best;
}

function escapeRe(ch: string): string {
  return ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function variantRegex(core: string): string {
  let out = "";
  for (const ch of core) {
    if (ch === "ü") out += "(?:ü|ue)";
    else if (ch === "ö") out += "(?:ö|oe)";
    else if (ch === "ä") out += "(?:ä|ae)";
    else if (ch === "ß") out += "(?:ß|ss)";
    else if (ch === " " || ch === "-") out += "[- ]";
    else out += escapeRe(ch);
  }
  return out;
}

const LEGAL_TAIL_RE = new RegExp("\\s*" + LEGAL_RAW + "$");
function stripLegalRaw(surface: string): string {
  return surface.replace(LEGAL_TAIL_RE, "").trim();
}

type Span = { start: number; end: number; how: string };

const overlaps = (s: number, e: number, spans: [number, number][]) => spans.some(([a, b]) => s < b && a < e);

export function lineOffsets(text: string): [number, number][] {
  const out: [number, number][] = [];
  let pos = 0;
  for (const line of text.split("\n")) {
    out.push([pos, pos + line.length]);
    pos += line.length + 1;
  }
  return out;
}

export function lineOf(lines: [number, number][], offset: number): number {
  for (let i = 0; i < lines.length; i++) {
    const [s, e] = lines[i];
    if (s <= offset && offset <= e) return i;
  }
  return lines.length - 1;
}

function paragraphs(text: string, lines: [number, number][]): number[] {
  const para: number[] = [];
  let idx = -1;
  let prevBlank = true;
  for (const [s, e] of lines) {
    const blank = text.slice(s, e).trim() === "";
    if (blank) para.push(-1);
    else {
      if (prevBlank) idx++;
      para.push(idx);
    }
    prevBlank = blank;
  }
  return para;
}

export function detectOrgSpans(docs: Doc[]): Record<string, Span[]> {
  const found: Record<string, Span[]> = {};
  const cores = new Set<string>();
  for (const doc of docs) {
    const text = doc.text;
    const spans: Span[] = [];
    for (const m of text.matchAll(ORG_LEGAL_RE)) {
      const name = m[1];
      let toks = name.split(" ");
      let start = m.index!;
      while (toks.length && (STOP_LEAD.has(toks[0]) || toks[0] === "&")) {
        start += toks[0].length + 1;
        toks = toks.slice(1);
      }
      if (!toks.length) continue;
      spans.push({ start, end: m.index! + m[0].length, how: "legal-form" });
    }
    const taken: [number, number][] = spans.map((s) => [s.start, s.end]);
    for (const m of text.matchAll(ORG_LABEL_RE)) {
      let surface = m[1];
      const parts = surface.split(" ");
      const lastPart = parts[parts.length - 1];
      if (parts.length && lastPart.length > 2 && lastPart.endsWith(".")) surface = surface.slice(0, -1);
      const s = m.index! + m[0].length - m[1].length;
      const e = s + surface.length;
      if (overlaps(s, e, taken)) continue;
      spans.push({ start: s, end: e, how: "label" });
      taken.push([s, e]);
    }
    found[doc.id] = spans;
    for (const sp of spans) {
      const core = stripLegalRaw(text.slice(sp.start, sp.end));
      if (core.includes(" ") || core.includes("-")) cores.add(core);
    }
  }
  const ordered = Array.from(cores).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
  for (const doc of docs) {
    const text = doc.text;
    const spans = found[doc.id];
    const taken: [number, number][] = spans.map((s) => [s.start, s.end]);
    for (const core of ordered) {
      const rx = new RegExp("(?<![" + L + "])" + variantRegex(core) + "(?![" + L + "])", "g");
      for (const m of text.matchAll(rx)) {
        const s = m.index!;
        const e = s + m[0].length;
        if (overlaps(s, e, taken)) continue;
        spans.push({ start: s, end: e, how: "gazetteer" });
        taken.push([s, e]);
      }
    }
    spans.sort((a, b) => a.start - b.start);
  }
  return found;
}

function detectPersonSpans(text: string, orgSpans: [number, number][]): Span[] {
  const spans: Span[] = [];
  const taken = [...orgSpans];
  for (const rx of PERSON_RES) {
    for (const m of text.matchAll(rx)) {
      const s = m.index!;
      const e = s + m[0].length;
      if (overlaps(s, e, taken)) continue;
      spans.push({ start: s, end: e, how: "person-pattern" });
      taken.push([s, e]);
    }
  }
  spans.sort((a, b) => a.start - b.start);
  return spans;
}

export function emptyCtx(project: string): MentionContext {
  return {
    project, city: null, street: null, vat: null, register: null, vendor: null, trade: null,
    role: null, email_domain: null, legal_form: null, alias_of: null, org_mention_id: null, org_surface: null,
  };
}

function fieldsFrom(segment: string, sameLinePart: string): Partial<MentionContext> {
  const out: Partial<MentionContext> = {};
  let m = VAT_RE.exec(segment);
  if (m) out.vat = "DE" + m[1] + m[2] + m[3];
  m = REG_RE.exec(segment);
  if (m) out.register = m[1] + " " + m[2];
  m = VENDOR_RE.exec(segment);
  if (m) out.vendor = m[1];
  m = STREET_RE.exec(segment);
  if (m) out.street = normalizeStreet(m[1]) + " " + m[2];
  m = POSTCODE_RE.exec(segment);
  if (m) out.city = m[1];
  else {
    m = CITY_RE.exec(sameLinePart);
    if (m) out.city = m[1];
  }
  return out;
}

type OrgWork = Mention & { _li: number; _nameCity: string | null };

export function extractDocument(doc: Doc, orgSpans: Span[]): Mention[] {
  const text = doc.text;
  const lines = lineOffsets(text);
  const para = paragraphs(text, lines);
  const project = doc.project || "";

  const orgs: OrgWork[] = orgSpans.map((sp) => {
    const li = lineOf(lines, sp.start);
    const surface = text.slice(sp.start, sp.end);
    const core = orgCore(surface);
    const ctx = emptyCtx(project);
    ctx.legal_form = core.legal_form;
    return {
      id: `${doc.id}:${sp.start}`, doc_id: doc.id, type: "org", surface, start: sp.start, end: sp.end,
      line: li + 1, extractor: "rules", how: sp.how, ctx,
      norm: { tokens: core.tokens, compact: core.compact }, _li: li, _nameCity: core.city,
    };
  });

  const linesWithOrg = new Set(orgs.map((o) => o._li));
  const raw = new Map<string, [string, string]>();
  orgs.forEach((o, idx) => {
    const li = o._li;
    const [, le] = lines[li];
    const nxt = idx + 1 < orgs.length && orgs[idx + 1]._li === li ? orgs[idx + 1] : null;
    const sameLine = text.slice(o.end, nxt ? nxt.start : le);
    let seg = sameLine;
    if (nxt === null && para[li] >= 0) {
      let j = li + 1;
      while (j < lines.length && para[j] === para[li] && !linesWithOrg.has(j)) {
        seg += "\n" + text.slice(lines[j][0], lines[j][1]);
        j++;
      }
    }
    raw.set(o.id, [seg, sameLine]);
  });

  for (let idx = orgs.length - 1; idx >= 0; idx--) {
    const o = orgs[idx];
    const nxt = idx + 1 < orgs.length && orgs[idx + 1]._li === o._li ? orgs[idx + 1] : null;
    if (nxt === null) continue;
    const gap = text.slice(o.end, nxt.start);
    if (ALIAS_GAP_RE.test(gap)) {
      const [seg, same] = raw.get(o.id)!;
      const [nseg, nsame] = raw.get(nxt.id)!;
      raw.set(o.id, [seg + nseg, same + nsame]);
      o.ctx.alias_of = nxt.id;
      nxt.ctx.alias_of = o.id;
    }
  }

  orgs.forEach((o, idx) => {
    const [seg, same] = raw.get(o.id)!;
    const li = o._li;
    const [ls] = lines[li];
    Object.assign(o.ctx, fieldsFrom(seg, same));
    if (!o.ctx.city && o._nameCity) o.ctx.city = o._nameCity;
    let prevEnd = ls;
    if (idx > 0 && orgs[idx - 1]._li === li) prevEnd = orgs[idx - 1].end;
    const before = text.slice(prevEnd, o.start);
    o.ctx.trade = findTrade(o.surface) ?? findTrade(before) ?? findTrade(seg);
    const lm = LABEL_BEFORE_RE.exec(before);
    if (lm) o.ctx.role = lm[1].trim();
  });

  const persons: Mention[] = [];
  for (const sp of detectPersonSpans(text, orgs.map((o) => [o.start, o.end]))) {
    const li = lineOf(lines, sp.start);
    const [ls, le] = lines[li];
    const surface = text.slice(sp.start, sp.end);
    const p: Mention = {
      id: `${doc.id}:${sp.start}`, doc_id: doc.id, type: "person", surface, start: sp.start, end: sp.end,
      line: li + 1, extractor: "rules", how: sp.how, ctx: emptyCtx(project), norm: personParts(surface),
    };
    let best: OrgWork | null = null;
    let bestGap = 26;
    for (const o of orgs) {
      if (o._li !== li) continue;
      const gap = o.end <= sp.start ? sp.start - o.end : o.start - sp.end;
      if (gap >= 0 && gap < bestGap) {
        bestGap = gap;
        best = o;
      }
    }
    if (best === null && para[li] >= 0) {
      const plines = para.filter((x) => x === para[li]).length;
      const porgs = orgs.filter((o) => para[o._li] === para[li]);
      if (plines <= 6 && porgs.length === 1) best = porgs[0];
    }
    if (best !== null) {
      p.ctx.org_mention_id = best.id;
      p.ctx.org_surface = best.surface;
    }
    const lineText = text.slice(ls, le);
    const em = EMAIL_RE.exec(lineText);
    if (em) p.ctx.email_domain = em[1].toLowerCase();
    const before = text.slice(ls, sp.start);
    const lm = LABEL_BEFORE_RE.exec(before);
    if (lm) p.ctx.role = lm[1].trim();
    else {
      const rm = ROLE_AFTER_RE.exec(text.slice(sp.end, le));
      if (rm) p.ctx.role = rm[1].trim();
    }
    persons.push(p);
  }

  const out: Mention[] = [
    ...orgs.map(({ _li, _nameCity, ...m }) => {
      void _li;
      void _nameCity;
      return m as Mention;
    }),
    ...persons,
  ];
  out.sort((a, b) => a.start - b.start);
  return out;
}

/** Extract mentions from all documents (the gazetteer pass spans the corpus). */
export function extractCorpus(docs: Doc[]): Mention[] {
  const orgSpans = detectOrgSpans(docs);
  const mentions: Mention[] = [];
  for (const doc of docs) mentions.push(...extractDocument(doc, orgSpans[doc.id]));
  return mentions;
}
