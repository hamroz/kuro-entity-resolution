// Append-only decision log. Mirror of python/resolver/events.py - keep in sync.
//
// Nothing is overwritten: merges, splits, undos and human verdicts are new
// events, and the state of every pair is a fold over the log. Human decisions
// are memory - a resolver re-run never overrides them - and a confirmed
// non-match is a cannot-link constraint that also holds against transitive merges.

import { cluster, type MergeEdge } from "./resolve";
import type { Decision, DecisionEvent, ERevent, PairResult, PairState, QueueItem } from "./types";

const DECISION_FOR_BUCKET: Record<string, Decision> = { auto: "merge", unsure: "unsure", separate: "separate" };

function nextId(events: ERevent[]): [string, number] {
  const seq = events.length + 1;
  return [`e${String(seq).padStart(5, "0")}`, seq];
}

export function fold(events: ERevent[]): Map<string, PairState> {
  const undone = new Set(events.filter((e) => e.type === "undo").map((e) => (e as { target: string }).target));
  const state = new Map<string, PairState>();
  for (const e of events) {
    if (e.type !== "decision") continue;
    let st = state.get(e.pair);
    if (!st) {
      st = { active: null, history: [], user_undo: false };
      state.set(e.pair, st);
    }
    st.history.push(e);
    if (undone.has(e.id)) {
      if (e.actor === "system") st.user_undo = true;
    } else {
      st.active = e;
    }
  }
  return state;
}

export function statusOf(st: PairState | undefined): Decision {
  if (!st || st.active === null) return "unsure";
  return st.active.decision;
}

export function reconcile(
  pairs: PairResult[], events: ERevent[], at: string, mode = "rules", docs = 0, mentions = 0,
): ERevent[] {
  const out = [...events];
  let [id, seq] = nextId(out);
  out.push({ id, seq, at, type: "run", mode, docs, mentions, pairs: pairs.length });
  const state = fold(out);
  for (const p of pairs) {
    const st = state.get(p.key);
    const decision = DECISION_FOR_BUCKET[p.bucket];
    if (st) {
      const active = st.active;
      if (active && active.actor === "user") continue; // remembered human decision
      if (!active && st.user_undo) continue; // a human undid the automatic call
      if (active && active.decision === decision && active.rule === p.rule) continue; // unchanged
    }
    [id, seq] = nextId(out);
    out.push({
      id, seq, at, type: "decision", pair: p.key, a: p.a, b: p.b, actor: "system", decision,
      rule: p.rule, confidence: p.confidence, note: null,
    });
  }
  return out;
}

export function decide(events: ERevent[], pair: PairResult, decision: Decision, at: string, note: string | null = null): ERevent[] {
  const [id, seq] = nextId(events);
  const rule = { merge: "H-merge", separate: "H-separate", unsure: "H-unsure" }[decision];
  return [
    ...events,
    {
      id, seq, at, type: "decision", pair: pair.key, a: pair.a, b: pair.b, actor: "user", decision, rule,
      confidence: pair.confidence ?? 0, note,
    },
  ];
}

export function undo(events: ERevent[], targetId: string, at: string, note: string | null = null): ERevent[] {
  if (!events.some((e) => e.id === targetId && e.type === "decision")) throw new Error(`no decision event ${targetId}`);
  const [id, seq] = nextId(events);
  return [...events, { id, seq, at, type: "undo", target: targetId, actor: "user", note }];
}

export function skip(events: ERevent[], pairKey: string, at: string): ERevent[] {
  const [id, seq] = nextId(events);
  return [...events, { id, seq, at, type: "skip", pair: pairKey, actor: "user" }];
}

export interface Resolution {
  roots: Map<string, string>;
  blocked: string[];
  statuses: Map<string, Decision>;
  state: Map<string, PairState>;
}

export function currentClusters(mentionIds: string[], pairs: PairResult[], events: ERevent[]): Resolution {
  const state = fold(events);
  const merges: MergeEdge[] = [];
  const cannot = new Set<string>();
  const statuses = new Map<string, Decision>();
  for (const p of pairs) {
    const st = state.get(p.key);
    const s = statusOf(st);
    statuses.set(p.key, s);
    const human = !!(st && st.active && st.active.actor === "user");
    if (s === "merge") merges.push({ a: p.a, b: p.b, key: p.key, confidence: p.confidence, human });
    else if (s === "separate" && (human || p.rule === "R0")) cannot.add(p.key);
  }
  const { roots, blocked } = cluster(mentionIds, merges, cannot);
  return { roots, blocked, statuses, state };
}

export function isCannotLink(p: PairResult, res: Resolution): boolean {
  const st = res.state.get(p.key);
  const human = !!(st && st.active && st.active.actor === "user");
  return res.statuses.get(p.key) === "separate" && (human || p.rule === "R0");
}

/** Open questions for a human, one per pair of clusters. */
export function reviewQueue(pairs: PairResult[], res: Resolution, events: ERevent[]): QueueItem[] {
  const skipped = new Set(events.filter((e) => e.type === "skip").map((e) => (e as { pair: string }).pair));
  const ck = (x: string, y: string): [string, string] => (x < y ? [x, y] : [y, x]);
  const blockedClusters = new Set<string>();
  for (const p of pairs) {
    if (isCannotLink(p, res)) blockedClusters.add(ck(res.roots.get(p.a)!, res.roots.get(p.b)!).join("|"));
  }
  const best = new Map<string, PairResult>();
  for (const p of pairs) {
    if (res.statuses.get(p.key) !== "unsure") continue;
    const ra = res.roots.get(p.a)!;
    const rb = res.roots.get(p.b)!;
    if (ra === rb) continue;
    const k = ck(ra, rb).join("|");
    if (blockedClusters.has(k)) continue;
    const cur = best.get(k);
    if (!cur || p.confidence > cur.confidence || (p.confidence === cur.confidence && p.key < cur.key)) best.set(k, p);
  }
  const items: QueueItem[] = Array.from(best.entries()).map(([k, p]) => ({
    clusters: k.split("|") as [string, string],
    pair: p,
    skipped: skipped.has(p.key),
  }));
  items.sort(
    (x, y) =>
      Number(x.skipped) - Number(y.skipped) ||
      y.pair.confidence - x.pair.confidence ||
      (x.pair.key < y.pair.key ? -1 : x.pair.key > y.pair.key ? 1 : 0),
  );
  return items;
}

export function decisionEvents(events: ERevent[]): DecisionEvent[] {
  return events.filter((e): e is DecisionEvent => e.type === "decision");
}
