"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { RULES } from "@/lib/er/resolve";
import type { Doc, Evidence, Mention, PairResult } from "@/lib/er/types";
import { useER } from "./er-provider";

export function cx(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight text-stone-900">{title}</h1>
      {children && <div className="mt-1 max-w-3xl text-sm text-stone-600">{children}</div>}
    </div>
  );
}

export function Loading({ label = "Reading documents…" }: { label?: string }) {
  return <div className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">{label}</div>;
}

export function Badge({ tone = "stone", children, title }: { tone?: "stone" | "green" | "amber" | "red" | "blue" | "violet"; children: ReactNode; title?: string }) {
  const tones = {
    stone: "bg-stone-100 text-stone-700 ring-stone-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-300",
    red: "bg-rose-50 text-rose-800 ring-rose-200",
    blue: "bg-sky-50 text-sky-800 ring-sky-200",
    violet: "bg-violet-50 text-violet-800 ring-violet-200",
  };
  return (
    <span title={title} className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset", tones[tone])}>
      {children}
    </span>
  );
}

export function TypeBadge({ type }: { type: "org" | "person" }) {
  return type === "org" ? <Badge tone="blue">org</Badge> : <Badge tone="violet">person</Badge>;
}

export function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? "bg-emerald-500" : value >= 0.35 ? "bg-amber-500" : "bg-stone-400";
  return (
    <div className="flex items-center gap-2" title={`confidence ${value.toFixed(3)}`}>
      <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-stone-200">
        <div className={cx("absolute inset-y-0 left-0", color)} style={{ width: `${pct}%` }} />
        <div className="absolute inset-y-0 w-px bg-stone-500/60" style={{ left: "35%" }} />
        <div className="absolute inset-y-0 w-px bg-stone-500/60" style={{ left: "85%" }} />
      </div>
      <span className="tabular-nums text-xs text-stone-600">{pct}%</span>
    </div>
  );
}

export function EvidenceList({ pair }: { pair: PairResult }) {
  const items: Evidence[] = [
    { code: "bias", label: "starting point: a name alone is not proof", weight: pair.type === "org" ? -7 : -6 },
    { code: "name", label: `name similarity ${pair.name_sim.toFixed(2)}`, weight: 7.5 * pair.name_sim },
    ...pair.evidence,
  ];
  const total = items.reduce((n, e) => n + e.weight, 0);
  return (
    <ul className="space-y-0.5 text-xs">
      {items.map((e, i) => (
        <li key={i} className="flex items-baseline gap-2">
          <span
            className={cx(
              "w-11 shrink-0 text-right font-mono tabular-nums",
              e.weight > 0 ? "text-emerald-700" : e.weight < 0 ? "text-rose-700" : "text-stone-400",
            )}
          >
            {e.weight > 0 ? "+" : ""}
            {e.weight.toFixed(1)}
          </span>
          <span className="text-stone-700">{e.label}</span>
        </li>
      ))}
      <li className="flex items-baseline gap-2 border-t border-stone-200 pt-0.5 text-stone-500">
        <span className="w-11 shrink-0 text-right font-mono tabular-nums">{total > 0 ? "+" : ""}{total.toFixed(1)}</span>
        <span>
          log-odds → {Math.round((1 / (1 + Math.exp(-total))) * 100)}%
          {pair.rule === "R0" && ", capped: identifier conflict"}
          {pair.rule === "R1" && ", raised: shared identifier"}
        </span>
      </li>
    </ul>
  );
}

export function RuleBadge({ rule }: { rule: string }) {
  const tone = rule === "R0" || rule === "R4" ? "stone" : rule === "R3" ? "amber" : rule.startsWith("H") ? "violet" : "green";
  const title = (RULES as Record<string, string>)[rule] ?? (rule.startsWith("H") ? "human decision" : rule);
  return (
    <Badge tone={tone} title={title}>
      {rule}
    </Badge>
  );
}

export function lineText(doc: Doc, line: number): { text: string; start: number } {
  const lines = doc.text.split("\n");
  let start = 0;
  for (let i = 0; i < line - 1; i++) start += lines[i].length + 1;
  return { text: lines[line - 1] ?? "", start };
}

/** The exact source line of a mention with the mention highlighted. */
export function SourceLine({ mention, compact = false }: { mention: Mention; compact?: boolean }) {
  const { docById } = useER();
  const doc = docById.get(mention.doc_id);
  if (!doc) return null;
  const { text, start } = lineText(doc, mention.line);
  const a = mention.start - start;
  const b = mention.end - start;
  return (
    <Link
      href={`/documents?doc=${mention.doc_id}&m=${encodeURIComponent(mention.id)}`}
      className="group block min-w-0 rounded-md border border-stone-200 bg-white px-3 py-2 hover:border-stone-400"
    >
      {!compact && (
        <div className="mb-1 flex flex-wrap items-center gap-x-2 text-[11px] text-stone-500">
          <span className="font-medium text-stone-700">{doc.title}</span>
          <span>
            {mention.doc_id} · line {mention.line}
          </span>
          <span>{doc.project}</span>
        </div>
      )}
      <div className="truncate font-mono text-xs text-stone-700">
        {text.slice(0, a)}
        <mark className={cx("rounded px-0.5", mention.type === "org" ? "bg-sky-100 text-sky-900" : "bg-violet-100 text-violet-900")}>
          {text.slice(a, b)}
        </mark>
        {text.slice(b)}
      </div>
    </Link>
  );
}

export function ContextChips({ mention }: { mention: Mention }) {
  const c = mention.ctx;
  const chips: [string, string | null][] = [
    ["city", c.city], ["trade", c.trade], ["VAT", c.vat], ["register", c.register], ["vendor", c.vendor],
    ["street", c.street], ["role", c.role], ["employer", c.org_surface], ["e-mail", c.email_domain],
    ["legal form", c.legal_form],
  ];
  const shown = chips.filter(([, v]) => v);
  if (!shown.length) return <span className="text-xs italic text-stone-400">no context found</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {shown.map(([k, v]) => (
        <span key={k} className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-700">
          <span className="text-stone-400">{k}</span> {v}
        </span>
      ))}
    </div>
  );
}

export function Button({
  children, onClick, tone = "default", title, disabled,
}: { children: ReactNode; onClick?: () => void; tone?: "default" | "primary" | "danger" | "ghost"; title?: string; disabled?: boolean }) {
  const tones = {
    default: "border border-stone-300 bg-white text-stone-800 hover:bg-stone-50",
    primary: "bg-stone-900 text-white hover:bg-stone-700",
    danger: "border border-rose-300 bg-white text-rose-700 hover:bg-rose-50",
    ghost: "text-stone-600 hover:bg-stone-100",
  };
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cx("rounded-md px-2.5 py-1 text-xs font-medium transition disabled:opacity-40", tones[tone])}
    >
      {children}
    </button>
  );
}
