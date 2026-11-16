// Name normalisation. Mirror of python/resolver/normalize.py - keep in sync.

const UMLAUTS: Record<string, string> = { ä: "ae", ö: "oe", ü: "ue", ß: "ss", Ä: "Ae", Ö: "Oe", Ü: "Ue" };

export const KNOWN_CITIES = [
  "Berlin", "Leipzig", "Dresden", "Hamburg", "Potsdam", "München",
  "Köln", "Frankfurt", "Stuttgart", "Hannover", "Bremen",
];

// Matched on the folded string; longest first.
const LEGAL_FORMS: [string, string][] = [
  ["GmbH & Co. KG", "gmbh\\s*&\\s*co\\.?\\s*kg"],
  ["UG", "ug\\s*\\(haftungsbeschraenkt\\)"],
  ["GmbH", "gmbh"],
  ["mbH", "mbh"],
  ["AG", "ag"],
  ["KG", "kg"],
  ["OHG", "ohg"],
  ["GbR", "gbr"],
  ["e.K.", "e\\.\\s?k\\."],
  ["SE", "se"],
  ["Ltd", "ltd\\.?|limited"],
  ["UG", "ug"],
];
const LEGAL_RES: [string, RegExp][] = LEGAL_FORMS.map(([name, pat]) => [
  name,
  new RegExp("(?<![a-z0-9])(?:" + pat + ")(?![a-z0-9])", "g"),
]);

const SYNONYMS: Record<string, string> = {
  bauunternehmung: "bau",
  bauunternehmen: "bau",
  baugesellschaft: "bau",
  elektrotechnik: "elektro",
  elektroinstallation: "elektro",
  elektroanlagen: "elektro",
  fassadentechnik: "fassaden",
  fassadenbau: "fassaden",
  fassade: "fassaden",
};

export const GENERIC = new Set([
  "bau", "elektro", "fassaden", "rohbau", "hochbau", "generalbau", "technik",
  "haustechnik", "geruestbau", "bewehrungsbau", "service", "gruppe", "partner",
  "holding", "bauunternehmung",
]);

const DROP_TOKENS = new Set(["und", "and", "co", "fa", "firma"]);

export function fold(text: string): string {
  let s = text.normalize("NFC");
  s = Array.from(s, (ch) => UMLAUTS[ch] ?? ch).join("");
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s.toLowerCase();
}

const KNOWN_CITIES_FOLDED: Record<string, string> = Object.fromEntries(KNOWN_CITIES.map((c) => [fold(c), c]));

export function stripLegalForm(folded: string): [string, string | null] {
  let found: string | null = null;
  for (const [name, rx] of LEGAL_RES) {
    rx.lastIndex = 0;
    if (rx.test(folded)) {
      found = name;
      break;
    }
  }
  let rest = folded;
  for (const [, rx] of LEGAL_RES) {
    rx.lastIndex = 0;
    rest = rest.replace(rx, " ");
  }
  return [rest, found];
}

export interface OrgCore {
  tokens: string[];
  compact: string;
  legal_form: string | null;
  city: string | null;
}

export function orgCore(surface: string): OrgCore {
  const folded = fold(surface);
  const [rest, legal] = stripLegalForm(folded);
  let tokens = rest
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t && !DROP_TOKENS.has(t));
  let city: string | null = null;
  if (tokens.length > 1 && tokens[tokens.length - 1] in KNOWN_CITIES_FOLDED) {
    city = KNOWN_CITIES_FOLDED[tokens[tokens.length - 1]];
    tokens = tokens.slice(0, -1);
  }
  tokens = tokens.map((t) => SYNONYMS[t] ?? t);
  return { tokens, compact: tokens.join(""), legal_form: legal, city };
}

export function personParts(surface: string): { first: string; last: string } {
  let s = surface.trim();
  s = s.replace(/^(?:Herrn|Herr|Frau|Hr\.|Fr\.|Mr\.|Ms\.|Mrs\.)\s+/, "");
  let first: string;
  let last: string;
  if (s.includes(",")) {
    const i = s.indexOf(",");
    last = s.slice(0, i).trim();
    first = s.slice(i + 1).trim();
  } else {
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      first = "";
      last = parts[0];
    } else {
      first = parts.slice(0, -1).join(" ");
      last = parts[parts.length - 1];
    }
  }
  return { first: fold(first).replace(/\./g, "").trim(), last: fold(last).trim() };
}

export function normalizeStreet(street: string): string {
  return fold(street).split("str.").join("strasse").replace(/[^a-z0-9]/g, "");
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1.0;
  const la = a.length;
  const lb = b.length;
  if (la === 0 || lb === 0) return 0.0;
  let matchDist = Math.floor(Math.max(la, lb) / 2) - 1;
  if (matchDist < 0) matchDist = 0;
  const aM = new Array<boolean>(la).fill(false);
  const bM = new Array<boolean>(lb).fill(false);
  let matches = 0;
  for (let i = 0; i < la; i++) {
    const lo = Math.max(0, i - matchDist);
    const hi = Math.min(i + matchDist + 1, lb);
    for (let j = lo; j < hi; j++) {
      if (bM[j] || a[i] !== b[j]) continue;
      aM[i] = true;
      bM[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0.0;
  let k = 0;
  let trans = 0;
  for (let i = 0; i < la; i++) {
    if (!aM[i]) continue;
    while (!bM[k]) k++;
    if (a[i] !== b[k]) trans++;
    k++;
  }
  const m = matches;
  const jaro = (m / la + m / lb + (m - trans / 2.0) / m) / 3.0;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, la, lb); i++) {
    if (a[i] === b[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1.0 - jaro);
}

function tokenScore(x: string, y: string): [number, boolean] {
  if (x === y) return [1.0, false];
  if (x.length === 1 && y.length > 1 && y[0] === x) return [0.8, true];
  if (y.length === 1 && x.length > 1 && x[0] === y) return [0.8, true];
  if (x.length >= 4 && y.length >= 4) {
    const jw = jaroWinkler(x, y);
    if (jw >= 0.9) return [jw, false];
  }
  return [0.0, false];
}

const w = (t: string) => (GENERIC.has(t) ? 0.5 : 1.0);

/** Weighted soft token overlap. Returns [similarity 0..1, usedInitial]. */
export function nameSimilarity(a: string[], b: string[]): [number, boolean] {
  if (a.length === 0 || b.length === 0) return [0.0, false];
  if (a.join("") === b.join("")) return [1.0, false];
  const cands: [number, number, number, boolean][] = [];
  a.forEach((x, i) =>
    b.forEach((y, j) => {
      const [s, ini] = tokenScore(x, y);
      if (s > 0) cands.push([-s, i, j, ini]);
    }),
  );
  cands.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  let num = 0.0;
  let usedInitial = false;
  for (const [neg, i, j, ini] of cands) {
    if (usedA.has(i) || usedB.has(j)) continue;
    usedA.add(i);
    usedB.add(j);
    num += (-neg * (w(a[i]) + w(b[j]))) / 2.0;
    usedInitial = usedInitial || ini;
  }
  let sa = 0;
  for (const t of a) sa += w(t);
  let sb = 0;
  for (const t of b) sb += w(t);
  const den = (sa + sb) / 2.0;
  return [num / den, usedInitial];
}

export function personNameSimilarity(a: { first: string; last: string }, b: { first: string; last: string }): [number, boolean] {
  const la = a.last;
  const lb = b.last;
  if (la !== lb && jaroWinkler(la, lb) < 0.92) return [0.0, false];
  const fa = a.first;
  const fb = b.first;
  if (!fa || !fb) return [0.8, false];
  if (fa === fb) return fa.length === 1 ? [0.9, true] : [1.0, false];
  if (fa.length === 1 && fb[0] === fa) return [0.85, true];
  if (fb.length === 1 && fa[0] === fb) return [0.85, true];
  return [0.1, false];
}
