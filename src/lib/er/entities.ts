// Views over the resolution state: entities (clusters) and their merge edges.

import type { Resolution } from "./events";
import type { Decision, Mention, MentionType, PairResult } from "./types";

export interface Entity {
  id: string; // cluster root mention id
  type: MentionType;
  name: string;
  mentions: Mention[];
  docs: string[];
  aliases: string[];
  cities: string[];
  trades: string[];
  vats: string[];
  registers: string[];
  vendors: string[];
  projects: string[];
  employers: string[]; // entity ids (persons only)
  edges: PairResult[]; // merged pairs inside this entity
}

const uniq = (xs: (string | null | undefined)[]) => Array.from(new Set(xs.filter((x): x is string => !!x))).sort();

const HONORIFIC = /^(?:Herrn|Herr|Frau|Hr\.|Fr\.|Mr\.|Ms\.|Mrs\.)\s+/;

function canonicalName(type: MentionType, mentions: Mention[]): string {
  const counts = new Map<string, number>();
  for (const m of mentions) {
    let s = m.surface;
    if (type === "person") {
      s = s.replace(HONORIFIC, "");
      if (s.includes(",")) {
        const [last, first] = s.split(",").map((x) => x.trim());
        s = `${first} ${last}`;
      }
    }
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const score = (s: string) => {
    let v = (counts.get(s) ?? 0) * 10 + s.length / 100;
    if (type === "org" && /\b(GmbH|AG|KG|SE|OHG|GbR|UG)\b/.test(s)) v += 100;
    if (type === "person" && /^[A-ZÄÖÜ][a-zäöüß]+ /.test(s)) v += 100;
    return v;
  };
  return Array.from(counts.keys()).sort((a, b) => score(b) - score(a) || (a < b ? -1 : 1))[0];
}

export function buildEntities(mentions: Mention[], pairs: PairResult[], res: Resolution): Entity[] {
  const groups = new Map<string, Mention[]>();
  for (const m of mentions) {
    const r = res.roots.get(m.id) ?? m.id;
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(m);
  }
  const blocked = new Set(res.blocked);
  const out: Entity[] = [];
  for (const [id, ms] of groups) {
    const type = ms[0].type;
    const ids = new Set(ms.map((m) => m.id));
    const edges = pairs.filter(
      (p) => ids.has(p.a) && ids.has(p.b) && res.statuses.get(p.key) === "merge" && !blocked.has(p.key),
    );
    out.push({
      id,
      type,
      name: canonicalName(type, ms),
      mentions: ms,
      docs: uniq(ms.map((m) => m.doc_id)),
      aliases: uniq(ms.map((m) => m.surface)),
      cities: uniq(ms.map((m) => m.ctx.city)),
      trades: uniq(ms.map((m) => m.ctx.trade)),
      vats: uniq(ms.map((m) => m.ctx.vat)),
      registers: uniq(ms.map((m) => m.ctx.register)),
      vendors: uniq(ms.map((m) => m.ctx.vendor)),
      projects: uniq(ms.map((m) => m.ctx.project)),
      employers: uniq(ms.map((m) => (m.ctx.org_mention_id ? res.roots.get(m.ctx.org_mention_id) : null))),
      edges,
    });
  }
  // disambiguate entities that share a display name (e.g. two "Müller Bau GmbH")
  const byName = new Map<string, Entity[]>();
  for (const e of out) byName.set(e.name, [...(byName.get(e.name) ?? []), e]);
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    group.forEach((e, i) => {
      const hint = e.cities.length === 1 ? e.cities[0] : e.projects.length === 1 ? e.projects[0] : `#${i + 1}`;
      e.name = `${e.name} (${hint})`;
    });
  }
  out.sort((a, b) => (a.type === b.type ? b.mentions.length - a.mentions.length || (a.name < b.name ? -1 : 1) : a.type === "org" ? -1 : 1));
  return out;
}

export function statusLabel(d: Decision | undefined): string {
  if (d === "merge") return "merged";
  if (d === "separate") return "kept separate";
  return "needs a human";
}
