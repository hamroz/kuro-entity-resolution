"use client";

import { useMemo, useState } from "react";
import type { ERevent } from "@/lib/er/types";
import { useER } from "./er-provider";
import { formatTime } from "./pair-card";
import { Badge, Button, Loading, PageHeader, RuleBadge, cx } from "./ui";

type Filter = "all" | "user" | "system";

export function AuditView() {
  const { ready, events, mentionById, res, undoEvent } = useER();
  const [filter, setFilter] = useState<Filter>("all");
  const [showUnchanged, setShowUnchanged] = useState(false);

  const undoneBy = useMemo(() => {
    const m = new Map<string, ERevent>();
    for (const e of events) if (e.type === "undo") m.set(e.target, e);
    return m;
  }, [events]);
  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);

  if (!ready) return <Loading />;

  const rows = events
    .slice()
    .reverse()
    .filter((e) => {
      if (filter === "user") return e.type !== "run" && e.actor === "user";
      if (filter === "system") return e.type === "run" || e.actor === "system";
      return true;
    })
    .filter((e) => showUnchanged || filter !== "all" || !(e.type === "decision" && e.actor === "system" && e.decision === "separate"));

  const pairLabel = (a: string, b: string) => `${mentionById.get(a)?.surface ?? a} ↔ ${mentionById.get(b)?.surface ?? b}`;

  const download = () => {
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "decision-log.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader title="Audit log">
        Append-only. The current state of every pair is a fold over these events: the latest decision that has not been undone wins.
        Undo and split add events, they never edit or delete earlier ones.
      </PageHeader>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        {(["all", "user", "system"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cx("rounded-md px-3 py-1", filter === f ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200")}
          >
            {f === "all" ? "all events" : f === "user" ? "human" : "system"}
          </button>
        ))}
        {filter === "all" && (
          <label className="ml-2 flex items-center gap-1 text-stone-600">
            <input type="checkbox" checked={showUnchanged} onChange={(e) => setShowUnchanged(e.target.checked)} />
            include automatic “kept separate” events
          </label>
        )}
        <span className="ml-auto text-stone-500">{events.length} events</span>
        <Button onClick={download}>Download JSON</Button>
      </div>
      <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-stone-200 bg-stone-50 text-stone-500">
            <tr>
              <th className="px-3 py-2 font-medium">event</th>
              <th className="px-3 py-2 font-medium">time</th>
              <th className="px-3 py-2 font-medium">actor</th>
              <th className="px-3 py-2 font-medium">what</th>
              <th className="px-3 py-2 font-medium">pair</th>
              <th className="px-3 py-2 font-medium">state</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((e) => {
              const undone = undoneBy.get(e.id);
              const active = e.type === "decision" && res.state.get(e.pair)?.active?.id === e.id;
              return (
                <tr key={e.id} className={cx(undone && "text-stone-400")}>
                  <td className="px-3 py-1.5 font-mono">{e.id}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">{formatTime(e.at)}</td>
                  <td className="px-3 py-1.5">
                    {e.type === "run" || e.actor === "system" ? <Badge>system</Badge> : <Badge tone="violet">user</Badge>}
                  </td>
                  <td className="px-3 py-1.5">
                    {e.type === "run" && (
                      <span>
                        resolver run ({e.mode}): {e.docs} docs, {e.mentions} mentions, {e.pairs} pairs
                      </span>
                    )}
                    {e.type === "decision" && (
                      <span className="flex items-center gap-1.5">
                        <span className="font-medium">{e.decision === "unsure" ? "needs a human" : e.decision}</span>
                        <RuleBadge rule={e.rule} />
                        {e.actor === "system" && <span className="tabular-nums text-stone-500">{Math.round(e.confidence * 100)}%</span>}
                        {e.note && <span className="italic text-stone-500">“{e.note}”</span>}
                      </span>
                    )}
                    {e.type === "undo" && (
                      <span>
                        undo of <span className="font-mono">{e.target}</span>
                        {(() => {
                          const t = byId.get(e.target);
                          return t && t.type === "decision" ? ` (${t.actor} ${t.decision})` : "";
                        })()}
                      </span>
                    )}
                    {e.type === "skip" && <span>skipped in review</span>}
                  </td>
                  <td className="max-w-[320px] truncate px-3 py-1.5">
                    {e.type === "decision" && pairLabel(e.a, e.b)}
                    {e.type === "skip" && (() => {
                      const [a, b] = e.pair.split("|");
                      return pairLabel(a, b);
                    })()}
                  </td>
                  <td className="px-3 py-1.5">
                    {undone ? <span>undone ({undone.id})</span> : active ? <Badge tone="green">active</Badge> : e.type === "decision" ? <span className="text-stone-400">superseded</span> : null}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {active && !undone && (
                      <Button tone="ghost" onClick={() => undoEvent(e.id)}>
                        undo
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
