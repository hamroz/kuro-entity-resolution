"use client";

import Link from "next/link";
import { useState } from "react";
import { useER } from "./er-provider";
import { Badge, Button, cx } from "./ui";

function Stat({ label, value, href, tone }: { label: string; value: number | string; href?: string; tone?: string }) {
  const body = (
    <div className={cx("rounded-lg border bg-white p-4", tone ?? "border-stone-200", href && "hover:border-stone-400")}>
      <div className="text-2xl font-semibold tabular-nums text-stone-900">{value}</div>
      <div className="text-xs text-stone-500">{label}</div>
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const STEPS = [
  ["Ingest", "construction documents: BoQ excerpts, quotes, invoices, site diaries; or your own PDF / text"],
  ["Extract", "organisation and person mentions with offsets, line, city, trade, VAT ID, register, vendor no."],
  ["Block", "only compare mentions sharing a distinctive token, an initial or an identifier"],
  ["Score", "name similarity (legal forms, umlauts, synonyms) plus signed context evidence"],
  ["Bucket", "auto-merge, needs a human, or kept separate; each with its rule and reasons"],
  ["Cluster", "strongest edges first; identifier conflicts and human splits are cannot-link constraints"],
  ["Log", "every decision is an event; undo and split append, nothing is overwritten"],
];

export function Overview() {
  const { ready, docs, mentions, entities, pairs, res, queue, events, extraction, modeInfo, forceRules, setForceRules, resetDemo } = useER();
  const statuses = Array.from(res.statuses.values());
  const human = events.filter((e) => e.type !== "run" && e.actor === "user").length;
  const orgs = entities.filter((e) => e.type === "org").length;

  return (
    <div className="space-y-10">
      <section className="max-w-3xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-amber-700">Proof of work · entity resolution</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">Fuzzy matching is not enough.</h1>
        <blockquote className="mt-4 border-l-2 border-amber-500 pl-4 text-stone-700">
          “A wrong merge is worse than none, so resolution has to be reversible and able to say ‘not sure’.”
          <footer className="mt-1 text-xs text-stone-500">
            kuro.build, open problem 03
          </footer>
        </blockquote>
        <p className="mt-4 text-sm leading-6 text-stone-600">
          This demo resolves companies and people across nine fictional construction documents from three projects, in German and English.
          The same subcontractor appears as <em>Müller Bau GmbH</em>, <em>Mueller-Bau</em>, <em>Müller Bauunternehmung</em> and
          under a trade name with the same vendor number; a different <em>Müller Bau GmbH</em> bids in Hamburg; two <em>Schmidt Elektro</em> firms
          work in Berlin and Leipzig. Every merge shows its reasons and links to the sentence it came from, uncertain pairs go to a
          human, and every decision can be undone.
        </p>
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <Stat label="documents" value={ready ? docs.length : "…"} href="/documents" />
        <Stat label="mentions" value={ready ? mentions.length : "…"} href="/documents" />
        <Stat label={`entities (${orgs} orgs)`} value={ready ? entities.length : "…"} href="/entities" />
        <Stat label="merged pairs" value={ready ? statuses.filter((s) => s === "merge").length : "…"} href="/review?tab=merged" tone="border-emerald-200" />
        <Stat label="open questions" value={ready ? queue.filter((q) => !q.skipped).length : "…"} href="/review" tone="border-amber-300" />
        <Stat label="kept separate" value={ready ? statuses.filter((s) => s === "separate").length : "…"} href="/review?tab=separate" />
        <Stat label="human decisions" value={ready ? human : "…"} href="/audit" />
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">Things to try</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-stone-700">
            <li>
              <Link className="underline" href="/review">Review queue</Link>: the electrical quote’s bare “Müller Bau” has no address, VAT ID or
              trade. Same string as the Berlin firm, but there is a Hamburg firm too, so the resolver says it is not sure.
            </li>
            <li>
              <Link className="underline" href="/review?tab=separate">Kept separate</Link>: <em>Müller Bau GmbH</em> (Berlin) and{" "}
              <em>Müller Bau GmbH</em> (Hamburg) have a name similarity of 1.0 and are kept apart by their VAT IDs and register entries.
            </li>
            <li>
              <Link className="underline" href="/entities">Entities</Link>: <em>MB Rohbau Berlin</em> shares no name tokens with Müller Bau, but
              the same vendor no. 4711, VAT ID and street put it in the same entity. Split it and watch the audit log.
            </li>
            <li>
              Mark a pair “keep separate”, then upload a document that mentions it again: the decision is remembered and blocks transitive merges.
            </li>
          </ol>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-stone-900">Extraction mode</h2>
          <div className="mt-3 space-y-2 text-sm text-stone-700">
            <div className="flex items-center gap-2">
              <Badge tone={extraction.extractor === "llm" ? "violet" : "stone"}>{extraction.extractor === "llm" ? "LLM" : "rule-based"}</Badge>
              <span>{extraction.label}</span>
            </div>
            {modeInfo.mode === "rules" ? (
              <p className="text-xs text-stone-500">
                No <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> on the server, so a deterministic rule-based extractor
                (legal-form anchors, labels like “Fa.”, a corpus gazetteer with umlaut variants, person patterns) reads the documents.
                With a key, an LLM proposes mentions as structured output and each one is grounded back to its exact offset.
              </p>
            ) : (
              <>
                <p className="text-xs text-stone-500">
                  The LLM proposes mentions and context as structured output; proposals whose text cannot be found in the document are dropped
                  {extraction.dropped ? ` (${extraction.dropped} dropped)` : ""}.
                  {extraction.fallbackDocs.length > 0 && ` Fell back to rules for: ${extraction.fallbackDocs.join(", ")}.`}
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={forceRules} onChange={(e) => setForceRules(e.target.checked)} />
                  use the rule-based extractor instead
                </label>
              </>
            )}
          </div>
          <h2 className="mt-5 text-sm font-semibold text-stone-900">Pipeline</h2>
          <ol className="mt-2 space-y-1.5 text-xs">
            {STEPS.map(([k, v], i) => (
              <li key={k} className="flex gap-2">
                <span className="w-16 shrink-0 font-semibold text-stone-800">
                  {i + 1}. {k}
                </span>
                <span className="text-stone-600">{v}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Upload />

      <section className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
        <Button tone="danger" onClick={() => window.confirm("Clear all decisions and uploaded documents in this browser?") && resetDemo()}>
          Reset demo
        </Button>
        <span>State (decision log, uploads) lives in this browser’s localStorage. {pairs.length} scored candidate pairs.</span>
      </section>
    </div>
  );
}

function Upload() {
  const { projects, addDocument, docs, removeDocument } = useER();
  const [project, setProject] = useState("SPB-25");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const uploads = docs.filter((d) => d.uploaded);

  async function onFile(file: File) {
    setBusy(true);
    setMsg(null);
    try {
      let body = "";
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/parse", { method: "POST", body: fd });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "upload failed");
        body = data.text;
      } else {
        body = await file.text();
      }
      body = body.replace(/\r\n/g, "\n");
      if (!body.trim()) throw new Error("no text layer found (scanned PDFs need OCR, which this demo does not do)");
      setText(body);
      setTitle(file.name);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "could not read file");
    } finally {
      setBusy(false);
    }
  }

  function add() {
    if (!text.trim()) return;
    const id = addDocument({ title: title || "Uploaded document", kind: "Upload", lang: "?", project, text });
    setMsg(`Added as ${id}. Mentions and decisions update automatically.`);
    setText("");
    setTitle("");
  }

  return (
    <section className="rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-stone-900">Add your own document</h2>
      <p className="mt-1 text-xs text-stone-500">
        PDF (text layer) or plain text. It is resolved together with the samples; existing human decisions stay in force.
        PDFs are parsed on the server and not stored; the text is kept in this browser only.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_200px]">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"Paste text, e.g.\nNachunternehmer: Mueller Bau GmbH, Industriestraße 12, 12099 Berlin\nUSt-IdNr. DE287445190"}
          className="h-36 w-full rounded-md border border-stone-300 p-2 font-mono text-xs"
        />
        <div className="space-y-2 text-xs">
          <input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="w-full text-xs" />
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-md border border-stone-300 px-2 py-1" />
          <select value={project} onChange={(e) => setProject(e.target.value)} className="w-full rounded-md border border-stone-300 px-2 py-1">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.name}
              </option>
            ))}
            <option value="UPLOAD">other project</option>
          </select>
          <Button tone="primary" onClick={add} disabled={busy || !text.trim()}>
            {busy ? "Reading…" : "Add document"}
          </Button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-stone-600">{msg}</p>}
      {uploads.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {uploads.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Link className="underline" href={`/documents?doc=${d.id}`}>
                {d.id} · {d.title}
              </Link>
              <span className="text-stone-400">{d.project}</span>
              <Button tone="ghost" onClick={() => removeDocument(d.id)}>
                remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
