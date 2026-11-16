"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { buildEntities, type Entity } from "@/lib/er/entities";
import {
  currentClusters, decide, reconcile, reviewQueue, skip, undo, type Resolution,
} from "@/lib/er/events";
import { extractCorpus } from "@/lib/er/extract";
import { resolve } from "@/lib/er/resolve";
import type { Decision, Doc, ERevent, Mention, PairResult, Project, QueueItem } from "@/lib/er/types";

const STORAGE_KEY = "kuro-er-demo-v1";

interface Persisted {
  events: ERevent[];
  uploads: Doc[];
  lastSig: string | null;
  llmCache: Record<string, { hash: string; mentions: Mention[] }>;
  forceRules: boolean;
}

const EMPTY: Persisted = { events: [], uploads: [], lastSig: null, llmCache: {}, forceRules: false };

export interface ModeInfo {
  mode: "llm" | "rules";
  provider?: string;
  model?: string;
}

export interface ExtractionInfo {
  label: string; // shown in the UI
  extractor: "rules" | "llm";
  llmDocs: number;
  fallbackDocs: string[];
  dropped: number;
  running: boolean;
}

interface ERContextValue {
  ready: boolean;
  projects: Project[];
  docs: Doc[];
  docById: Map<string, Doc>;
  mentions: Mention[];
  mentionById: Map<string, Mention>;
  pairs: PairResult[];
  pairByKey: Map<string, PairResult>;
  res: Resolution;
  entities: Entity[];
  entityById: Map<string, Entity>;
  queue: QueueItem[];
  events: ERevent[];
  modeInfo: ModeInfo;
  extraction: ExtractionInfo;
  forceRules: boolean;
  setForceRules: (v: boolean) => void;
  decidePair: (pair: PairResult, decision: Decision, note?: string) => void;
  decidePairs: (pairs: PairResult[], decision: Decision, note?: string) => void;
  undoEvent: (eventId: string, note?: string) => void;
  skipPair: (pairKey: string) => void;
  addDocument: (doc: Omit<Doc, "id">) => string;
  removeDocument: (id: string) => void;
  resetDemo: () => void;
}

const Ctx = createContext<ERContextValue | null>(null);

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function load(): Persisted {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return EMPTY;
  }
}

function save(p: Persisted) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage full or blocked: the demo still works for this session */
  }
}

const now = () => new Date().toISOString();

export function ERProvider({ children }: { children: ReactNode }) {
  const [persisted, setPersisted] = useState<Persisted | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [samples, setSamples] = useState<Doc[] | null>(null);
  const [modeInfo, setModeInfo] = useState<ModeInfo>({ mode: "rules" });
  const [llmResult, setLlmResult] = useState<{ key: string; mentions: Mention[]; info: ExtractionInfo } | null>(null);
  const persistedRef = useRef<Persisted | null>(null);

  const update = useCallback((fn: (p: Persisted) => Persisted) => {
    setPersisted((prev) => {
      const next = fn(prev ?? EMPTY);
      persistedRef.current = next;
      save(next);
      return next;
    });
  }, []);

  // load samples, saved state and extraction mode
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const p = load();
      const manifest = await fetch("/samples/manifest.json").then((r) => r.json());
      const docs: Doc[] = await Promise.all(
        manifest.documents.map(async (d: Doc & { file: string }) => ({
          ...d,
          text: (await fetch(`/samples/${d.file}`).then((r) => r.text())).replace(/\r\n/g, "\n"),
        })),
      );
      let mode: ModeInfo = { mode: "rules" };
      try {
        mode = await fetch("/api/mode").then((r) => r.json());
      } catch {
        /* static hosting without API routes: rules only */
      }
      if (cancelled) return;
      setProjects(manifest.projects);
      setSamples(docs);
      setModeInfo(mode);
      persistedRef.current = p;
      setPersisted(p);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const uploads = persisted?.uploads;
  const docs = useMemo(() => (samples ? [...samples, ...(uploads ?? [])] : []), [samples, uploads]);
  const forceRules = persisted?.forceRules ?? false;
  const useLlm = modeInfo.mode === "llm" && !forceRules;

  // extraction: rules are a pure function of the documents; LLM results arrive async
  const rulesMentions = useMemo(() => (samples ? extractCorpus(docs) : []), [docs, samples]);
  const llmKey = useLlm ? hash(`${modeInfo.model}|` + docs.map((d) => `${d.id}:${d.project}:${hash(d.text)}`).join(",")) : "";

  useEffect(() => {
    if (!useLlm || !samples || !persistedRef.current) return;
    let cancelled = false;
    const label = `LLM extraction · ${modeInfo.provider} ${modeInfo.model}`;
    (async () => {
      const cache = { ...(persistedRef.current?.llmCache ?? {}) };
      const all: Mention[] = [];
      const fallback: string[] = [];
      let dropped = 0;
      let llmDocs = 0;
      await Promise.all(
        docs.map(async (doc) => {
          const h = hash(`${modeInfo.model}|${doc.project}|${doc.text}`);
          const hit = cache[doc.id];
          if (hit && hit.hash === h) {
            all.push(...hit.mentions);
            llmDocs++;
            return;
          }
          try {
            const r = await fetch("/api/extract", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ doc }),
            });
            if (!r.ok) throw new Error(String(r.status));
            const data = await r.json();
            cache[doc.id] = { hash: h, mentions: data.mentions };
            all.push(...data.mentions);
            dropped += data.dropped ?? 0;
            llmDocs++;
          } catch {
            fallback.push(doc.id);
            all.push(...rulesMentions.filter((m) => m.doc_id === doc.id));
          }
        }),
      );
      if (cancelled) return;
      const order = new Map(docs.map((d, i) => [d.id, i]));
      all.sort((a, b) => order.get(a.doc_id)! - order.get(b.doc_id)! || a.start - b.start);
      setLlmResult({
        key: llmKey,
        mentions: all,
        info: { label, extractor: "llm", llmDocs, fallbackDocs: fallback.sort(), dropped, running: false },
      });
      update((p) => ({ ...p, llmCache: cache }));
    })();
    return () => {
      cancelled = true;
    };
  }, [docs, samples, useLlm, llmKey, rulesMentions, modeInfo.model, modeInfo.provider, update]);

  const llmReady = useLlm && llmResult?.key === llmKey;
  const mentions = useMemo(
    () => (useLlm ? (llmReady ? llmResult!.mentions : []) : rulesMentions),
    [useLlm, llmReady, llmResult, rulesMentions],
  );
  const extraction: ExtractionInfo = useMemo(() => {
    if (!useLlm) {
      return { label: "Rule-based extractor (no LLM)", extractor: "rules", llmDocs: 0, fallbackDocs: [], dropped: 0, running: !samples || !persisted };
    }
    if (llmReady) return llmResult!.info;
    return { label: `LLM extraction · ${modeInfo.provider} ${modeInfo.model}`, extractor: "llm", llmDocs: 0, fallbackDocs: [], dropped: 0, running: true };
  }, [useLlm, llmReady, llmResult, samples, persisted, modeInfo.provider, modeInfo.model]);

  const pairs = useMemo(() => resolve(mentions), [mentions]);

  // append system decisions for every new resolver result (memory-aware)
  useEffect(() => {
    if (!persistedRef.current || extraction.running || mentions.length === 0) return;
    const sig = hash(`${extraction.extractor}|` + pairs.map((p) => `${p.key}:${p.bucket}:${p.rule}`).join(","));
    if (persistedRef.current.lastSig === sig) return;
    update((p) => ({
      ...p,
      lastSig: sig,
      events: reconcile(pairs, p.events, now(), extraction.extractor, docs.length, mentions.length),
    }));
  }, [pairs, extraction.running, extraction.extractor, docs.length, mentions.length, update, persisted?.lastSig]);

  const events = useMemo(() => persisted?.events ?? [], [persisted?.events]);
  const res = useMemo(() => currentClusters(mentions.map((m) => m.id), pairs, events), [mentions, pairs, events]);
  const queue = useMemo(() => reviewQueue(pairs, res, events), [pairs, res, events]);
  const entities = useMemo(() => buildEntities(mentions, pairs, res), [mentions, pairs, res]);

  const value: ERContextValue = useMemo(
    () => ({
      ready: !!persisted && !!samples && !extraction.running,
      projects,
      docs,
      docById: new Map(docs.map((d) => [d.id, d])),
      mentions,
      mentionById: new Map(mentions.map((m) => [m.id, m])),
      pairs,
      pairByKey: new Map(pairs.map((p) => [p.key, p])),
      res,
      entities,
      entityById: new Map(entities.map((e) => [e.id, e])),
      queue,
      events,
      modeInfo,
      extraction,
      forceRules,
      setForceRules: (v) => update((p) => ({ ...p, forceRules: v })),
      decidePair: (pair, decision, note) => update((p) => ({ ...p, events: decide(p.events, pair, decision, now(), note ?? null) })),
      decidePairs: (ps, decision, note) =>
        update((p) => ({ ...p, events: ps.reduce((ev, pair) => decide(ev, pair, decision, now(), note ?? null), p.events) })),
      undoEvent: (id, note) => update((p) => ({ ...p, events: undo(p.events, id, now(), note ?? null) })),
      skipPair: (key) => update((p) => ({ ...p, events: skip(p.events, key, now()) })),
      addDocument: (doc) => {
        const existing = persistedRef.current?.uploads ?? [];
        let n = existing.length + 1;
        while (existing.some((d) => d.id === `u${String(n).padStart(2, "0")}`)) n++;
        const id = `u${String(n).padStart(2, "0")}`;
        update((p) => ({ ...p, uploads: [...p.uploads, { ...doc, id, uploaded: true }] }));
        return id;
      },
      removeDocument: (id) => update((p) => ({ ...p, uploads: p.uploads.filter((d) => d.id !== id) })),
      resetDemo: () => update(() => ({ ...EMPTY })),
    }),
    [persisted, samples, extraction, projects, docs, mentions, pairs, res, entities, queue, events, modeInfo, forceRules, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useER(): ERContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useER outside ERProvider");
  return v;
}
