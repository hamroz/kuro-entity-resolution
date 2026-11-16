"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import type { Mention } from "@/lib/er/types";
import { useER } from "./er-provider";
import { Badge, ContextChips, Loading, PageHeader, TypeBadge, cx } from "./ui";

export function DocumentsView() {
  const { ready, docs, projects, mentions, mentionById, res, entityById } = useER();
  const params = useSearchParams();
  const router = useRouter();
  const docId = params.get("doc") ?? docs[0]?.id;
  const selectedId = params.get("m");
  const doc = docs.find((d) => d.id === docId);
  const selected = selectedId ? mentionById.get(selectedId) : undefined;
  const lineRef = useRef<HTMLDivElement | null>(null);

  const docMentions = useMemo(() => mentions.filter((m) => m.doc_id === docId), [mentions, docId]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const m of mentions) c.set(m.doc_id, (c.get(m.doc_id) ?? 0) + 1);
    return c;
  }, [mentions]);

  useEffect(() => {
    lineRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [selectedId, docId]);

  if (!ready) return <Loading />;

  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? id;
  const groups = Array.from(new Set(docs.map((d) => d.project)));
  const select = (m: Mention) => router.replace(`/documents?doc=${m.doc_id}&m=${encodeURIComponent(m.id)}`, { scroll: false });

  return (
    <div>
      <PageHeader title="Documents">
        Every highlighted span is a mention with exact character offsets. Click one to see the context the resolver used and the entity it
        ended up in. <span className="rounded bg-sky-100 px-1 text-sky-900">organisation</span>{" "}
        <span className="rounded bg-violet-100 px-1 text-violet-900">person</span>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <aside className="space-y-4 text-sm">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-500">
                {g} · {projectName(g)}
              </div>
              <ul className="space-y-0.5">
                {docs
                  .filter((d) => d.project === g)
                  .map((d) => (
                    <li key={d.id}>
                      <Link
                        href={`/documents?doc=${d.id}`}
                        className={cx(
                          "flex items-baseline gap-2 rounded px-2 py-1",
                          d.id === docId ? "bg-stone-900 text-white" : "text-stone-700 hover:bg-stone-100",
                        )}
                      >
                        <span className="font-mono text-[11px] opacity-70">{d.id}</span>
                        <span className="flex-1 truncate">{d.title}</span>
                        <span className="text-[11px] opacity-70">{counts.get(d.id) ?? 0}</span>
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </aside>
        {doc ? (
          <div className="min-w-0 space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <span className="text-base font-semibold text-stone-900">{doc.title}</span>
              <Badge>{doc.kind}</Badge>
              <Badge>{doc.lang}</Badge>
              <span>
                {doc.project} · {projectName(doc.project)}
              </span>
            </div>
            {selected && selected.doc_id === doc.id && (
              <div className="rounded-lg border border-stone-300 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <TypeBadge type={selected.type} />
                  <span className="font-medium">{selected.surface}</span>
                  <span className="text-xs text-stone-500">
                    line {selected.line}, chars {selected.start}–{selected.end} · found by {selected.extractor === "llm" ? selected.how : `rule: ${selected.how}`}
                  </span>
                  {(() => {
                    const ent = entityById.get(res.roots.get(selected.id) ?? "");
                    return ent ? (
                      <Link href={`/entities?e=${encodeURIComponent(ent.id)}`} className="ml-auto text-xs underline">
                        entity: {ent.name} ({ent.mentions.length} mentions)
                      </Link>
                    ) : null;
                  })()}
                </div>
                <div className="mt-2">
                  <ContextChips mention={selected} />
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white py-3 font-mono text-[12.5px] leading-6">
              {doc.text.split("\n").map((line, i) => {
                const lineStart = doc.text.split("\n").slice(0, i).reduce((n, l) => n + l.length + 1, 0);
                const ms = docMentions.filter((m) => m.line === i + 1).sort((a, b) => a.start - b.start);
                const parts: ReactNode[] = [];
                let pos = 0;
                for (const m of ms) {
                  const a = m.start - lineStart;
                  const b = m.end - lineStart;
                  if (a < pos) continue;
                  parts.push(line.slice(pos, a));
                  parts.push(
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => select(m)}
                      title={`${m.type} · ${m.how}`}
                      className={cx(
                        "rounded px-0.5",
                        m.type === "org" ? "bg-sky-100 text-sky-950 hover:bg-sky-200" : "bg-violet-100 text-violet-950 hover:bg-violet-200",
                        selected?.id === m.id && "ring-2 ring-amber-500",
                      )}
                    >
                      {line.slice(a, b)}
                    </button>,
                  );
                  pos = b;
                }
                parts.push(line.slice(pos));
                const isSel = selected && selected.doc_id === doc.id && selected.line === i + 1;
                return (
                  <div key={i} ref={isSel ? lineRef : undefined} className={cx("flex px-3", isSel && "bg-amber-50")}>
                    <span className="mr-4 w-6 shrink-0 select-none text-right text-stone-400">{i + 1}</span>
                    <span className="whitespace-pre">{parts}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-sm text-stone-500">Document not found.</p>
        )}
      </div>
    </div>
  );
}
