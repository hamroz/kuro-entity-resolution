// Candidate generation, scoring and bucketing.
// Mirror of python/resolver/resolve.py - keep in sync.

import { GENERIC, nameSimilarity, personNameSimilarity } from "./normalize";
import type { Bucket, Evidence, Mention, OrgNorm, PairResult, PersonNorm, Rule } from "./types";

export const AUTO_THRESHOLD = 0.85;
export const UNSURE_THRESHOLD = 0.35;
const ORG_BIAS = -7.0;
const PERSON_BIAS = -6.0;
const NAME_WEIGHT = 7.5;

export const W: Record<string, number> = {
  vat_match: 5.0, vat_conflict: -6.0,
  register_match: 4.0, register_conflict: -5.0,
  vendor_match: 4.5, vendor_conflict: -4.0,
  street_match: 2.0,
  city_match: 1.2, city_conflict: -2.5,
  trade_match: 0.8, trade_conflict: -1.0,
  project_match: 0.6,
  legal_form_conflict: -0.8,
  alias: 6.0,
  same_doc: 1.0, same_doc_person: 1.5,
  employer_same: 1.5, employer_different: -1.0,
  email_match: 1.5, email_conflict: -0.5,
};

export const RULES: Record<Rule, string> = {
  R0: "identifier conflict: different VAT ID, register entry or vendor number",
  R1: "shared identifier (VAT ID, register entry, vendor number or letterhead alias)",
  R2: "name and context agree above the auto-merge threshold",
  R3: "evidence is mixed or thin: a human decides",
  R4: "not enough similarity: kept separate",
};

const sigmoid = (x: number) => 1.0 / (1.0 + Math.exp(-x));
export const round4 = (x: number) => Math.round(x * 1e4) / 1e4;
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function blockingKeys(m: Mention): string[] {
  const keys: string[] = [];
  if (m.type === "org") {
    const n = m.norm as OrgNorm;
    if (n.compact) keys.push("compact:" + n.compact);
    for (const t of n.tokens) {
      if (t.length === 1) keys.push("init:" + t);
      else if (t.length >= 2 && !GENERIC.has(t)) {
        keys.push("tok:" + t);
        keys.push("init:" + t[0]);
      }
    }
    for (const f of ["vat", "register", "vendor"] as const) {
      if (m.ctx[f]) keys.push(f + ":" + m.ctx[f]);
    }
    if (m.ctx.alias_of) keys.push("alias:" + (m.id < m.ctx.alias_of ? m.id : m.ctx.alias_of));
  } else {
    keys.push("last:" + (m.norm as PersonNorm).last);
  }
  return keys;
}

export function candidatePairs(mentions: Mention[]): [Mention, Mention][] {
  const index = new Map<string, number[]>();
  mentions.forEach((m, i) => {
    for (const k of blockingKeys(m)) {
      if (!index.has(k)) index.set(k, []);
      index.get(k)!.push(i);
    }
  });
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const ids of index.values()) {
    for (let x = 0; x < ids.length; x++) {
      for (let y = x + 1; y < ids.length; y++) {
        const i = ids[x];
        const j = ids[y];
        if (i === j) continue;
        const [a, b] = i < j ? [i, j] : [j, i];
        if (mentions[a].type !== mentions[b].type) continue;
        const k = `${a},${b}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([a, b]);
      }
    }
  }
  out.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  return out.map(([a, b]) => [mentions[a], mentions[b]]);
}

const ev = (code: string, label: string): Evidence => ({ code, label, weight: W[code] });

export function scoreOrgPair(a: Mention, b: Mention): PairResult {
  const ca = a.ctx;
  const cb = b.ctx;
  const [name, usedInitial] = nameSimilarity((a.norm as OrgNorm).tokens, (b.norm as OrgNorm).tokens);
  const evidence: Evidence[] = [];
  let strong = false;
  let conflict = false;
  const ids: [("vat" | "register" | "vendor"), string][] = [["vat", "VAT ID"], ["register", "register entry"], ["vendor", "vendor no."]];
  for (const [field, label] of ids) {
    const va = ca[field];
    const vb = cb[field];
    if (va && vb) {
      if (va === vb) {
        evidence.push(ev(field + "_match", `same ${label} ${va}`));
        strong = true;
      } else {
        evidence.push(ev(field + "_conflict", `different ${label}: ${va} vs ${vb}`));
        conflict = true;
      }
    }
  }
  if (ca.alias_of === b.id || cb.alias_of === a.id) {
    evidence.push(ev("alias", "named together on one letterhead"));
    strong = true;
  }
  if (ca.street && cb.street && ca.street === cb.street) evidence.push(ev("street_match", "same street address"));
  if (ca.city && cb.city) {
    if (ca.city === cb.city) evidence.push(ev("city_match", `same city (${ca.city})`));
    else evidence.push(ev("city_conflict", `different cities: ${ca.city} vs ${cb.city}`));
  }
  if (ca.trade && cb.trade) {
    if (ca.trade === cb.trade) evidence.push(ev("trade_match", `same trade (${ca.trade})`));
    else evidence.push(ev("trade_conflict", `different trades: ${ca.trade} vs ${cb.trade}`));
  }
  if (ca.project && ca.project === cb.project) evidence.push(ev("project_match", `same project (${ca.project})`));
  if (ca.legal_form && cb.legal_form && ca.legal_form !== cb.legal_form) {
    evidence.push(ev("legal_form_conflict", `different legal forms: ${ca.legal_form} vs ${cb.legal_form}`));
  }
  const cityConflict = evidence.some((e) => e.code === "city_conflict");
  if (a.doc_id === b.doc_id && (a.norm as OrgNorm).compact === (b.norm as OrgNorm).compact && !cityConflict) {
    evidence.push(ev("same_doc", "same name within one document"));
  }
  let logit = ORG_BIAS + NAME_WEIGHT * name;
  let sum = 0;
  for (const e of evidence) sum += e.weight;
  logit += sum;
  return decide(a, b, name, usedInitial, evidence, logit, strong, conflict);
}

export function scorePersonPair(a: Mention, b: Mention, orgCluster: Map<string, string>): PairResult | null {
  const [name, usedInitial] = personNameSimilarity(a.norm as PersonNorm, b.norm as PersonNorm);
  if (name === 0.0) return null;
  const ca = a.ctx;
  const cb = b.ctx;
  const evidence: Evidence[] = [];
  const oa = ca.org_mention_id;
  const ob = cb.org_mention_id;
  if (oa && ob) {
    if ((orgCluster.get(oa) ?? oa) === (orgCluster.get(ob) ?? ob)) {
      evidence.push(ev("employer_same", `employers resolve to the same organisation (${ca.org_surface} / ${cb.org_surface})`));
    } else {
      evidence.push(ev("employer_different", `different employers: ${ca.org_surface} vs ${cb.org_surface}`));
    }
  }
  if (ca.email_domain && cb.email_domain) {
    if (ca.email_domain === cb.email_domain) evidence.push(ev("email_match", `same e-mail domain (${ca.email_domain})`));
    else evidence.push(ev("email_conflict", "different e-mail domains"));
  }
  if (ca.project && ca.project === cb.project) evidence.push(ev("project_match", `same project (${ca.project})`));
  if (a.doc_id === b.doc_id && name >= 0.8) evidence.push(ev("same_doc_person", "compatible names within one document"));
  let logit = PERSON_BIAS + NAME_WEIGHT * name;
  let sum = 0;
  for (const e of evidence) sum += e.weight;
  logit += sum;
  return decide(a, b, name, usedInitial, evidence, logit, false, false);
}

function decide(
  a: Mention, b: Mention, name: number, usedInitial: boolean, evidence: Evidence[],
  logit: number, strong: boolean, conflict: boolean,
): PairResult {
  let p = sigmoid(logit);
  const negative = evidence.some((e) => e.weight < 0);
  let bucket: Bucket;
  let rule: Rule;
  if (conflict) {
    bucket = "separate"; rule = "R0"; p = Math.min(p, 0.02);
  } else if (strong) {
    bucket = "auto"; rule = "R1"; p = Math.max(p, 0.97);
  } else if (p >= AUTO_THRESHOLD) {
    bucket = "auto"; rule = "R2";
  } else if (p >= UNSURE_THRESHOLD || (usedInitial && !negative && name >= 0.8)) {
    bucket = "unsure"; rule = "R3";
  } else {
    bucket = "separate"; rule = "R4";
  }
  let evs = evidence;
  if (bucket === "unsure" && p < UNSURE_THRESHOLD) {
    evs = [...evidence, { code: "abbreviation", label: "abbreviated name and no identifiers either way", weight: 0.0 }];
  }
  const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id];
  return {
    key: pairKey(a.id, b.id), a: lo, b: hi, type: a.type,
    name_sim: round4(name), confidence: round4(p), bucket, rule, evidence: evs,
  };
}

export interface MergeEdge {
  a: string;
  b: string;
  key: string;
  confidence: number;
  human?: boolean;
}

/**
 * Constraint-aware clustering: strongest edges first (human ones before
 * automatic ones); an edge that would join two mentions under a cannot-link
 * constraint is skipped and reported as blocked.
 */
export function cluster(ids: string[], merges: MergeEdge[], cannotLink: Set<string>): { roots: Map<string, string>; blocked: string[] } {
  const parent = new Map<string, string>(ids.map((i) => [i, i]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  const members = new Map<string, Set<string>>(ids.map((i) => [i, new Set([i])]));
  const clPairs = Array.from(cannotLink).sort().map((k) => k.split("|"));
  const blocked: string[] = [];
  const order = [...merges].sort(
    (p, q) => (p.human ? 0 : 1) - (q.human ? 0 : 1) || q.confidence - p.confidence || (p.key < q.key ? -1 : p.key > q.key ? 1 : 0),
  );
  for (const p of order) {
    const ra = find(p.a);
    const rb = find(p.b);
    if (ra === rb) continue;
    const ma = members.get(ra)!;
    const mb = members.get(rb)!;
    if (clPairs.some(([x, y]) => (ma.has(x) && mb.has(y)) || (mb.has(x) && ma.has(y)))) {
      blocked.push(p.key);
      continue;
    }
    const [root, other] = rb < ra ? [rb, ra] : [ra, rb];
    parent.set(other, root);
    members.set(root, new Set([...ma, ...mb]));
    members.delete(other);
  }
  const roots = new Map<string, string>();
  for (const i of ids) roots.set(i, find(i));
  return { roots, blocked };
}

function keep(p: PairResult): boolean {
  if (p.name_sim >= 0.5) return true;
  return p.rule === "R0" || p.rule === "R1";
}

/** Score every candidate pair. Pure function of the mentions. */
export function resolve(mentions: Mention[]): PairResult[] {
  const orgs = mentions.filter((m) => m.type === "org");
  const orgPairs = candidatePairs(orgs).map(([a, b]) => scoreOrgPair(a, b)).filter(keep);
  const auto = orgPairs.filter((p) => p.bucket === "auto");
  const conflicts = new Set(orgPairs.filter((p) => p.rule === "R0").map((p) => p.key));
  const { roots: orgCluster } = cluster(orgs.map((m) => m.id), auto, conflicts);
  const persons = mentions.filter((m) => m.type === "person");
  const personPairs: PairResult[] = [];
  for (const [a, b] of candidatePairs(persons)) {
    const p = scorePersonPair(a, b, orgCluster);
    if (p) personPairs.push(p);
  }
  const pairs = [...orgPairs, ...personPairs];
  pairs.sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  return pairs;
}
