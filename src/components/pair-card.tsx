"use client";

import type { ReactNode } from "react";
import type { PairResult } from "@/lib/er/types";
import { useER } from "./er-provider";
import { ConfidenceBar, ContextChips, EvidenceList, RuleBadge, SourceLine, TypeBadge } from "./ui";

export function formatTime(iso: string) {
  if (!iso || !iso.includes("T")) return iso;
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function PairHistory({ pairKey }: { pairKey: string }) {
  const { res, events } = useER();
  const st = res.state.get(pairKey);
  if (!st) return null;
  const undos = new Map(
    events.filter((e) => e.type === "undo").map((e) => [(e as { target: string }).target, e]),
  );
  return (
    <ol className="space-y-0.5 text-[11px] text-stone-500">
      {st.history.map((e) => {
        const u = undos.get(e.id);
        return (
          <li key={e.id} className={u ? "line-through decoration-stone-400" : ""}>
            <span className="font-mono">{e.id}</span> · {e.actor === "system" ? `${e.decision} by rule ${e.rule}` : `${e.decision} by user`}
            {" · "}
            {formatTime(e.at)}
            {e.note ? ` · “${e.note}”` : ""}
            {u && <span className="ml-1 no-underline">(undone {formatTime(u.at)})</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function PairCard({ pair, actions, footer }: { pair: PairResult; actions?: ReactNode; footer?: ReactNode }) {
  const { mentionById } = useER();
  const a = mentionById.get(pair.a);
  const b = mentionById.get(pair.b);
  if (!a || !b) return null;
  return (
    <div className="min-w-0 rounded-lg border border-stone-200 bg-stone-50/60 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <TypeBadge type={pair.type} />
        <span className="text-sm font-medium text-stone-900">
          {a.surface} <span className="text-stone-400">↔</span> {b.surface}
        </span>
        <RuleBadge rule={pair.rule} />
        <div className="ml-auto">
          <ConfidenceBar value={pair.confidence} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {[a, b].map((m) => (
          <div key={m.id} className="min-w-0 space-y-1.5">
            <SourceLine mention={m} />
            <ContextChips mention={m} />
          </div>
        ))}
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
        <EvidenceList pair={pair} />
        {actions && <div className="flex flex-wrap items-start justify-end gap-2">{actions}</div>}
      </div>
      {footer && <div className="mt-3 border-t border-stone-200 pt-2">{footer}</div>}
    </div>
  );
}
