"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import type { PairResult } from "@/lib/er/types";
import { useER } from "./er-provider";
import { PairCard, PairHistory } from "./pair-card";
import { Badge, Button, Loading, PageHeader, cx } from "./ui";

const PAGE = 25;

export function ReviewView() {
  const { ready, queue, pairs, res } = useER();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("tab") ?? "queue";
  const [typeFilter, setTypeFilter] = useState<"all" | "org" | "person">("all");
  const [limit, setLimit] = useState(PAGE);

  const merged = useMemo(
    () => pairs.filter((p) => res.statuses.get(p.key) === "merge").sort((a, b) => a.confidence - b.confidence),
    [pairs, res],
  );
  const separate = useMemo(
    () =>
      pairs
        .filter((p) => res.statuses.get(p.key) === "separate")
        .sort((a, b) => b.name_sim - a.name_sim || b.confidence - a.confidence),
    [pairs, res],
  );
  const mootUnsure = useMemo(
    () => pairs.filter((p) => res.statuses.get(p.key) === "unsure" && res.roots.get(p.a) === res.roots.get(p.b)).length,
    [pairs, res],
  );

  if (!ready) return <Loading />;

  const open = queue.filter((q) => !q.skipped).length;
  const tabs: [string, string, number][] = [
    ["queue", "Not sure: needs a human", open],
    ["merged", "Merged", merged.length],
    ["separate", "Kept separate", separate.length],
  ];
  const filt = (ps: PairResult[]) => (typeFilter === "all" ? ps : ps.filter((p) => p.type === typeFilter));

  return (
    <div>
      <PageHeader title="Review">
        Three buckets. Pairs above 85% confidence (or sharing a VAT ID, register entry, vendor no. or letterhead) merge automatically;
        identifier conflicts and weak matches stay separate; everything in between is a question for a human. Decisions are appended to
        the log and remembered on the next run.
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-center gap-1 text-sm">
        {tabs.map(([k, label, n]) => (
          <button
            key={k}
            type="button"
            onClick={() => {
              setLimit(PAGE);
              router.replace(`/review?tab=${k}`, { scroll: false });
            }}
            className={cx("rounded-md px-3 py-1", tab === k ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200")}
          >
            {label} <span className="ml-1 tabular-nums opacity-70">{n}</span>
          </button>
        ))}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}
          className="ml-auto rounded-md border border-stone-300 bg-white px-2 py-1 text-xs"
        >
          <option value="all">orgs and people</option>
          <option value="org">organisations</option>
          <option value="person">people</option>
        </select>
      </div>

      {tab === "queue" && <Queue typeFilter={typeFilter} mootUnsure={mootUnsure} />}
      {tab === "merged" && <PairList pairs={filt(merged)} limit={limit} onMore={() => setLimit(limit + PAGE)} kind="merged" />}
      {tab === "separate" && <PairList pairs={filt(separate)} limit={limit} onMore={() => setLimit(limit + PAGE)} kind="separate" />}
    </div>
  );
}

function ClusterLabel({ mentionId }: { mentionId: string }) {
  const { res, entityById } = useER();
  const e = entityById.get(res.roots.get(mentionId) ?? "");
  if (!e) return null;
  return (
    <Link href={`/entities?e=${encodeURIComponent(e.id)}`} className="underline">
      {e.name}
      {e.mentions.length > 1 ? ` (${e.mentions.length} mentions)` : " (single mention)"}
    </Link>
  );
}

function Queue({ typeFilter, mootUnsure }: { typeFilter: "all" | "org" | "person"; mootUnsure: number }) {
  const { queue, decidePair, skipPair } = useER();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const items = queue.filter((q) => typeFilter === "all" || q.pair.type === typeFilter);
  if (!items.length) {
    return (
      <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
        Nothing left to decide. {mootUnsure > 0 && `${mootUnsure} uncertain pairs are already connected through stronger merges.`}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500">
        One question per pair of entities, represented by its strongest uncertain pair. {mootUnsure} further uncertain pairs are not asked
        because their mentions are already connected through stronger merges, or separated by a constraint.
      </p>
      {items.map((q) => (
        <PairCard
          key={q.pair.key}
          pair={q.pair}
          actions={
            <div className="flex w-56 flex-col gap-2">
              <input
                value={notes[q.pair.key] ?? ""}
                onChange={(e) => setNotes({ ...notes, [q.pair.key]: e.target.value })}
                placeholder="note (optional)"
                className="rounded-md border border-stone-300 px-2 py-1 text-xs"
              />
              <div className="flex flex-wrap gap-2">
                <Button tone="primary" onClick={() => decidePair(q.pair, "merge", notes[q.pair.key])}>
                  Merge
                </Button>
                <Button tone="danger" onClick={() => decidePair(q.pair, "separate", notes[q.pair.key])}>
                  Keep separate
                </Button>
                <Button tone="ghost" onClick={() => skipPair(q.pair.key)} disabled={q.skipped}>
                  {q.skipped ? "Skipped" : "Skip"}
                </Button>
              </div>
            </div>
          }
          footer={
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-stone-500">
              <span>
                left belongs to <ClusterLabel mentionId={q.pair.a} />
              </span>
              <span>
                right belongs to <ClusterLabel mentionId={q.pair.b} />
              </span>
              {q.skipped && <Badge>skipped</Badge>}
            </div>
          }
        />
      ))}
    </div>
  );
}

function PairList({ pairs, limit, onMore, kind }: { pairs: PairResult[]; limit: number; onMore: () => void; kind: "merged" | "separate" }) {
  const { res, undoEvent, decidePair } = useER();
  const blocked = new Set(res.blocked);
  return (
    <div className="space-y-4">
      <p className="text-xs text-stone-500">
        {kind === "merged"
          ? "Weakest merges first: these are the ones worth checking."
          : "Most similar names first: these are the pairs string similarity alone would have merged."}
      </p>
      {pairs.slice(0, limit).map((p) => {
        const active = res.state.get(p.key)?.active;
        const human = active?.actor === "user";
        return (
          <PairCard
            key={p.key}
            pair={p}
            actions={
              <>
                {human && <Badge tone="violet">human decision</Badge>}
                {blocked.has(p.key) && <Badge tone="red">blocked by constraint</Badge>}
                {active && <Button onClick={() => undoEvent(active.id)}>Undo</Button>}
                {kind === "merged" ? (
                  <Button tone="danger" onClick={() => decidePair(p, "separate", "split by user")}>
                    Split
                  </Button>
                ) : (
                  <Button onClick={() => decidePair(p, "merge", "merged by user")}>Merge anyway</Button>
                )}
              </>
            }
            footer={<PairHistory pairKey={p.key} />}
          />
        );
      })}
      {pairs.length > limit && (
        <div className="text-center">
          <Button onClick={onMore}>Show more ({pairs.length - limit} left)</Button>
        </div>
      )}
    </div>
  );
}
