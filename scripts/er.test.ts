// TypeScript-side checks of the event log (the Python suite covers the same
// behaviour; test_parity.py checks that both resolvers agree on the samples).
//   npm test

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { currentClusters, decide, fold, reconcile, reviewQueue, undo } from "../src/lib/er/events";
import { extractCorpus } from "../src/lib/er/extract";
import { resolve } from "../src/lib/er/resolve";
import type { Doc, Mention, PairResult } from "../src/lib/er/types";

const samples = join(process.cwd(), "public", "samples");
const manifest = JSON.parse(readFileSync(join(samples, "manifest.json"), "utf8"));
const docs: Doc[] = manifest.documents.map((d: Doc & { file: string }) => ({ ...d, text: readFileSync(join(samples, d.file), "utf8") }));
const mentions = extractCorpus(docs);
const pairs = resolve(mentions);
const ids = mentions.map((m) => m.id);

const find = (doc: string, surface: string, nth = 0): Mention => mentions.filter((m) => m.doc_id === doc && m.surface === surface)[nth];
const pairOf = (a: Mention, b: Mention): PairResult => pairs.find((p) => p.key === (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`))!;

test("reconcile is append-only and idempotent", () => {
  const e1 = reconcile(pairs, [], "t0");
  const e2 = reconcile(pairs, e1, "t1");
  assert.deepEqual(e2.slice(0, e1.length), e1);
  assert.equal(e2.length, e1.length + 1);
});

test("undoing an automatic merge sends it back to a human and survives re-runs", () => {
  let ev = reconcile(pairs, [], "t0");
  const p = pairOf(find("d03", "Müller Bau GmbH", 1), find("d05", "MB Rohbau Berlin"));
  const target = fold(ev).get(p.key)!.active!;
  ev = undo(ev, target.id, "t1");
  ev = reconcile(pairs, ev, "t2");
  const st = fold(ev).get(p.key)!;
  assert.equal(st.active, null);
  assert.equal(st.user_undo, true);
});

test("a confirmed non-match blocks transitive merges", () => {
  let ev = reconcile(pairs, [], "t0");
  const loose = find("d02", "Müller Bau");
  const berlin = find("d03", "Müller Bau GmbH");
  ev = decide(ev, pairOf(loose, berlin), "separate", "t1");
  ev = decide(ev, pairOf(loose, find("d04", "Mueller-Bau")), "merge", "t2");
  const res = currentClusters(ids, pairs, ev);
  assert.notEqual(res.roots.get(loose.id), res.roots.get(berlin.id));
  assert.ok(res.blocked.length > 0);
});

test("review queue shrinks after a human merge", () => {
  let ev = reconcile(pairs, [], "t0");
  const q1 = reviewQueue(pairs, currentClusters(ids, pairs, ev), ev);
  ev = decide(ev, q1[0].pair, "merge", "t1");
  const q2 = reviewQueue(pairs, currentClusters(ids, pairs, ev), ev);
  assert.ok(q2.length < q1.length);
});
