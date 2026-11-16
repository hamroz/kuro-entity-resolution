"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Entity } from "@/lib/er/entities";
import { useER } from "./er-provider";
import { PairCard, PairHistory } from "./pair-card";
import { Badge, Button, Loading, PageHeader, SourceLine, TypeBadge, cx } from "./ui";

const EntityGraph = dynamic(() => import("./entity-graph"), { ssr: false, loading: () => <Loading label="Drawing graph…" /> });

export function EntitiesView() {
  const { ready, entities } = useER();
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get("view") ?? "list";
  const selectedId = params.get("e");

  if (!ready) return <Loading />;
  const selected = entities.find((e) => e.id === selectedId) ?? entities[0];

  return (
    <div>
      <PageHeader title="Entities">
        Clusters of mentions after automatic and human decisions. Each entity lists the merges that hold it together, with reasons; split
        any of them and the cluster is recomputed from the log.
      </PageHeader>
      <div className="mb-4 flex gap-1 text-sm">
        {[
          ["list", "List"],
          ["graph", "Graph"],
        ].map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => router.replace(`/entities?view=${k}${selectedId ? `&e=${encodeURIComponent(selectedId)}` : ""}`, { scroll: false })}
            className={cx("rounded-md px-3 py-1", tab === k ? "bg-stone-900 text-white" : "bg-white text-stone-700 ring-1 ring-stone-200")}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "graph" ? (
        <EntityGraph />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          <ul className="max-h-[75vh] space-y-1 overflow-y-auto pr-1 text-sm">
            {entities.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/entities?e=${encodeURIComponent(e.id)}`}
                  scroll={false}
                  className={cx(
                    "flex items-center gap-2 rounded-md px-2 py-1.5",
                    selected?.id === e.id ? "bg-stone-900 text-white" : "hover:bg-stone-100",
                  )}
                >
                  <span className={cx("h-2 w-2 shrink-0 rounded-full", e.type === "org" ? "bg-sky-500" : "bg-violet-500")} />
                  <span className="flex-1 truncate">{e.name}</span>
                  <span className="text-[11px] opacity-70">
                    {e.mentions.length}× · {e.docs.length} docs
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {selected && <EntityDetail entity={selected} />}
        </div>
      )}
    </div>
  );
}

function Facts({ label, values }: { label: string; values: string[] }) {
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
      <span className="w-20 shrink-0 text-stone-500">{label}</span>
      {values.map((v) => (
        <span key={v} className="rounded bg-stone-100 px-1.5 py-0.5 text-stone-800">
          {v}
        </span>
      ))}
      {values.length > 1 && (label === "VAT ID" || label === "register" || label === "city") && <Badge tone="red">conflicting values</Badge>}
    </div>
  );
}

function EntityDetail({ entity }: { entity: Entity }) {
  const { entities, entityById, res, decidePair, decidePairs, undoEvent, pairs } = useER();
  const people = entities.filter((p) => p.type === "person" && p.employers.includes(entity.id));
  const ids = new Set(entity.mentions.map((m) => m.id));
  const blocked = pairs.filter((p) => res.blocked.includes(p.key) && (ids.has(p.a) || ids.has(p.b)));

  const detach = (mentionId: string) =>
    decidePairs(
      entity.edges.filter((p) => p.a === mentionId || p.b === mentionId),
      "separate",
      "mention detached from entity by user",
    );

  return (
    <div className="min-w-0 space-y-6">
      <div className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <TypeBadge type={entity.type} />
          <h2 className="text-lg font-semibold">{entity.name}</h2>
          <span className="text-xs text-stone-500">
            {entity.mentions.length} mentions in {entity.docs.length} documents · {entity.edges.length} merges
          </span>
        </div>
        <div className="mt-3 space-y-1.5">
          <Facts label="spellings" values={entity.aliases} />
          <Facts label="city" values={entity.cities} />
          <Facts label="trade" values={entity.trades} />
          <Facts label="VAT ID" values={entity.vats} />
          <Facts label="register" values={entity.registers} />
          <Facts label="vendor no." values={entity.vendors} />
          <Facts label="projects" values={entity.projects} />
          {entity.type === "person" && entity.employers.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
              <span className="w-20 shrink-0 text-stone-500">works for</span>
              {entity.employers.map((id) => (
                <Link key={id} href={`/entities?e=${encodeURIComponent(id)}`} className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-900 underline">
                  {entityById.get(id)?.name ?? id}
                </Link>
              ))}
            </div>
          )}
          {people.length > 0 && (
            <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
              <span className="w-20 shrink-0 text-stone-500">people</span>
              {people.map((p) => (
                <Link key={p.id} href={`/entities?e=${encodeURIComponent(p.id)}`} className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-900 underline">
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-stone-900">Evidence: every mention</h3>
        <ul className="space-y-1.5">
          {entity.mentions.map((m) => (
            <li key={m.id} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <SourceLine mention={m} />
              </div>
              {entity.mentions.length > 1 && (
                <Button tone="ghost" onClick={() => detach(m.id)} title="Split every merge that touches this mention and remember it as a non-match">
                  detach
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      {entity.edges.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-stone-900">Merges holding this entity together</h3>
          <p className="mb-2 text-xs text-stone-500">
            <b>Undo</b> retracts the decision and sends the pair to the review queue. <b>Split</b> records a confirmed non-match: it is
            remembered on later runs and blocks transitive merges.
          </p>
          <div className="space-y-3">
            {entity.edges
              .slice()
              .sort((a, b) => b.confidence - a.confidence)
              .map((p) => {
                const active = res.state.get(p.key)?.active;
                return (
                  <PairCard
                    key={p.key}
                    pair={p}
                    actions={
                      <>
                        {active && <Button onClick={() => undoEvent(active.id)}>Undo</Button>}
                        <Button tone="danger" onClick={() => decidePair(p, "separate", "split by user")}>
                          Split
                        </Button>
                      </>
                    }
                    footer={<PairHistory pairKey={p.key} />}
                  />
                );
              })}
          </div>
        </section>
      )}

      {blocked.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold text-stone-900">Merges blocked by a constraint</h3>
          <p className="mb-2 text-xs text-stone-500">
            These pairs scored as merges, but applying them would join mentions that a human or an identifier conflict keeps apart.
          </p>
          <div className="space-y-3">
            {blocked.map((p) => (
              <PairCard key={p.key} pair={p} footer={<PairHistory pairKey={p.key} />} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
