// Shared data shapes. Field names match the Python reference implementation
// (python/resolver) so both produce the same JSON for the parity test.

export type MentionType = "org" | "person";
export type Extractor = "rules" | "llm";

export interface Doc {
  id: string;
  title: string;
  kind: string;
  lang: string;
  project: string;
  text: string;
  file?: string;
  uploaded?: boolean;
}

export interface Project {
  id: string;
  name: string;
}

export interface MentionContext {
  project: string;
  city: string | null;
  street: string | null;
  vat: string | null;
  register: string | null;
  vendor: string | null;
  trade: string | null;
  role: string | null;
  email_domain: string | null;
  legal_form: string | null;
  alias_of: string | null;
  org_mention_id: string | null;
  org_surface: string | null;
}

export interface OrgNorm {
  tokens: string[];
  compact: string;
}

export interface PersonNorm {
  first: string;
  last: string;
}

export interface Mention {
  id: string; // `${docId}:${start}` - stable across runs
  doc_id: string;
  type: MentionType;
  surface: string;
  start: number;
  end: number;
  line: number; // 1-based
  extractor: Extractor;
  how: string; // which rule / model found it
  ctx: MentionContext;
  norm: OrgNorm | PersonNorm;
}

export type Bucket = "auto" | "unsure" | "separate";
export type Rule = "R0" | "R1" | "R2" | "R3" | "R4";

export interface Evidence {
  code: string;
  label: string;
  weight: number;
}

export interface PairResult {
  key: string;
  a: string;
  b: string;
  type: MentionType;
  name_sim: number;
  confidence: number;
  bucket: Bucket;
  rule: Rule;
  evidence: Evidence[];
}

export type Decision = "merge" | "separate" | "unsure";
export type Actor = "system" | "user";

export interface RunEvent {
  id: string;
  seq: number;
  at: string;
  type: "run";
  mode: string;
  docs: number;
  mentions: number;
  pairs: number;
}

export interface DecisionEvent {
  id: string;
  seq: number;
  at: string;
  type: "decision";
  pair: string;
  a: string;
  b: string;
  actor: Actor;
  decision: Decision;
  rule: string;
  confidence: number;
  note: string | null;
}

export interface UndoEvent {
  id: string;
  seq: number;
  at: string;
  type: "undo";
  target: string;
  actor: "user";
  note: string | null;
}

export interface SkipEvent {
  id: string;
  seq: number;
  at: string;
  type: "skip";
  pair: string;
  actor: "user";
}

export type ERevent = RunEvent | DecisionEvent | UndoEvent | SkipEvent;

export interface PairState {
  active: DecisionEvent | null;
  history: DecisionEvent[];
  user_undo: boolean;
}

export interface QueueItem {
  clusters: [string, string];
  pair: PairResult;
  skipped: boolean;
}
