// Runs the TypeScript resolver on the bundled samples and writes the result
// to python/tests/fixtures/ts_output.json. python/tests/test_parity.py then
// checks that the Python reference implementation produces the same output.
//
//   npm run fixture

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractCorpus } from "../src/lib/er/extract";
import { currentClusters, reconcile, reviewQueue } from "../src/lib/er/events";
import { resolve } from "../src/lib/er/resolve";
import type { Doc } from "../src/lib/er/types";

const root = process.cwd();
const samples = join(root, "public", "samples");
const manifest = JSON.parse(readFileSync(join(samples, "manifest.json"), "utf8"));
const docs: Doc[] = manifest.documents.map((d: Doc & { file: string }) => ({
  ...d,
  text: readFileSync(join(samples, d.file), "utf8").replace(/\r\n/g, "\n"),
}));

const mentions = extractCorpus(docs);
const pairs = resolve(mentions);
const events = reconcile(pairs, [], "t0", "rules", docs.length, mentions.length);
const res = currentClusters(mentions.map((m) => m.id), pairs, events);
const groups = new Map<string, string[]>();
for (const [id, r] of res.roots) {
  if (!groups.has(r)) groups.set(r, []);
  groups.get(r)!.push(id);
}
const clusters = Array.from(groups.values())
  .map((g) => g.sort())
  .sort((a, b) => (a[0] < b[0] ? -1 : 1));
const queue = reviewQueue(pairs, res, events).map((q) => q.pair.key);

const out = { mentions, pairs, clusters, queue };
writeFileSync(join(root, "python", "tests", "fixtures", "ts_output.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`mentions=${mentions.length} pairs=${pairs.length} clusters=${clusters.length} queue=${queue.length}`);
