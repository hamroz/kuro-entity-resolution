"""Name normalisation for German/English construction company and person names.

Kept deliberately small and explicit so the TypeScript mirror
(src/lib/er/normalize.ts) can match it character for character.
"""

from __future__ import annotations

import re
import unicodedata

UMLAUTS = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue"}

KNOWN_CITIES = [
    "Berlin", "Leipzig", "Dresden", "Hamburg", "Potsdam", "München",
    "Köln", "Frankfurt", "Stuttgart", "Hannover", "Bremen",
]

# Legal forms, matched on the folded (lower-case, umlaut-free) string.
# Order matters: longest first.
LEGAL_FORMS: list[tuple[str, str]] = [
    ("GmbH & Co. KG", r"gmbh\s*&\s*co\.?\s*kg"),
    ("UG", r"ug\s*\(haftungsbeschraenkt\)"),
    ("GmbH", r"gmbh"),
    ("mbH", r"mbh"),
    ("AG", r"ag"),
    ("KG", r"kg"),
    ("OHG", r"ohg"),
    ("GbR", r"gbr"),
    ("e.K.", r"e\.\s?k\."),
    ("SE", r"se"),
    ("Ltd", r"ltd\.?|limited"),
    ("UG", r"ug"),
]
_LEGAL_RES = [(name, re.compile(r"(?<![a-z0-9])(?:" + pat + r")(?![a-z0-9])")) for name, pat in LEGAL_FORMS]

# Domain synonyms: different words for the same kind of firm.
SYNONYMS = {
    "bauunternehmung": "bau",
    "bauunternehmen": "bau",
    "baugesellschaft": "bau",
    "elektrotechnik": "elektro",
    "elektroinstallation": "elektro",
    "elektroanlagen": "elektro",
    "fassadentechnik": "fassaden",
    "fassadenbau": "fassaden",
    "fassade": "fassaden",
}

# Tokens that say what a firm does rather than who it is: they count half.
GENERIC = {
    "bau", "elektro", "fassaden", "rohbau", "hochbau", "generalbau", "technik",
    "haustechnik", "geruestbau", "bewehrungsbau", "service", "gruppe", "partner",
    "holding", "bauunternehmung",
}

DROP_TOKENS = {"und", "and", "co", "fa", "firma"}

_COMBINING = re.compile("[̀-ͯ]")
_NON_ALNUM = re.compile(r"[^a-z0-9]+")

def fold(text: str) -> str:
    """Lower-case, fold umlauts (ü -> ue), strip other accents."""
    s = unicodedata.normalize("NFC", text)
    s = "".join(UMLAUTS.get(ch, ch) for ch in s)
    s = unicodedata.normalize("NFD", s)
    s = _COMBINING.sub("", s)
    return s.lower()


KNOWN_CITIES_FOLDED = {fold(c): c for c in KNOWN_CITIES}


def strip_legal_form(folded: str) -> tuple[str, str | None]:
    """Remove legal-form markers from a folded name.

    Returns (rest, legal form). The legal form is the first entry of
    LEGAL_FORMS (longest first) that matches the original string.
    """
    found: str | None = None
    for name, rx in _LEGAL_RES:
        if rx.search(folded):
            found = name
            break
    rest = folded
    for _name, rx in _LEGAL_RES:
        rest = rx.sub(" ", rest)
    return rest, found


def org_core(surface: str) -> dict:
    """Normalise an organisation name.

    Returns tokens (synonym-mapped, legal form and trailing city removed),
    the compact key, the legal form and a city if the name ended in one.
    """
    folded = fold(surface)
    rest, legal = strip_legal_form(folded)
    tokens = [t for t in _NON_ALNUM.sub(" ", rest).split() if t and t not in DROP_TOKENS]
    city = None
    if len(tokens) > 1 and tokens[-1] in KNOWN_CITIES_FOLDED:
        city = KNOWN_CITIES_FOLDED[tokens[-1]]
        tokens = tokens[:-1]
    tokens = [SYNONYMS.get(t, t) for t in tokens]
    return {"tokens": tokens, "compact": "".join(tokens), "legal_form": legal, "city": city}


def person_parts(surface: str) -> dict:
    """Split a person mention into first name / initial and last name."""
    s = surface.strip()
    s = re.sub(r"^(?:Herrn|Herr|Frau|Hr\.|Fr\.|Mr\.|Ms\.|Mrs\.)\s+", "", s)
    if "," in s:
        last, first = [p.strip() for p in s.split(",", 1)]
    else:
        parts = s.split()
        if len(parts) == 1:
            first, last = "", parts[0]
        else:
            first, last = " ".join(parts[:-1]), parts[-1]
    first = fold(first).replace(".", "").strip()
    last = fold(last).strip()
    return {"first": first, "last": last}


def normalize_street(street: str) -> str:
    s = fold(street)
    s = s.replace("str.", "strasse")
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def jaro_winkler(a: str, b: str) -> float:
    if a == b:
        return 1.0
    la, lb = len(a), len(b)
    if la == 0 or lb == 0:
        return 0.0
    match_dist = max(la, lb) // 2 - 1
    if match_dist < 0:
        match_dist = 0
    a_m = [False] * la
    b_m = [False] * lb
    matches = 0
    for i in range(la):
        lo = max(0, i - match_dist)
        hi = min(i + match_dist + 1, lb)
        for j in range(lo, hi):
            if b_m[j] or a[i] != b[j]:
                continue
            a_m[i] = True
            b_m[j] = True
            matches += 1
            break
    if matches == 0:
        return 0.0
    k = 0
    trans = 0
    for i in range(la):
        if not a_m[i]:
            continue
        while not b_m[k]:
            k += 1
        if a[i] != b[k]:
            trans += 1
        k += 1
    m = float(matches)
    jaro = (m / la + m / lb + (m - trans / 2.0) / m) / 3.0
    prefix = 0
    for i in range(min(4, la, lb)):
        if a[i] == b[i]:
            prefix += 1
        else:
            break
    return jaro + prefix * 0.1 * (1.0 - jaro)


def _token_score(x: str, y: str) -> tuple[float, bool]:
    if x == y:
        return 1.0, False
    if len(x) == 1 and len(y) > 1 and y[0] == x:
        return 0.8, True
    if len(y) == 1 and len(x) > 1 and x[0] == y:
        return 0.8, True
    if len(x) >= 4 and len(y) >= 4:
        jw = jaro_winkler(x, y)
        if jw >= 0.9:
            return jw, False
    return 0.0, False


def _w(t: str) -> float:
    return 0.5 if t in GENERIC else 1.0


def name_similarity(a: list[str], b: list[str]) -> tuple[float, bool]:
    """Weighted soft token overlap. Returns (similarity 0..1, used_initial)."""
    if not a or not b:
        return 0.0, False
    if "".join(a) == "".join(b):
        return 1.0, False
    cands = []
    for i, x in enumerate(a):
        for j, y in enumerate(b):
            s, ini = _token_score(x, y)
            if s > 0:
                cands.append((-s, i, j, ini))
    cands.sort()
    used_a: set[int] = set()
    used_b: set[int] = set()
    num = 0.0
    used_initial = False
    for neg, i, j, ini in cands:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        num += -neg * (_w(a[i]) + _w(b[j])) / 2.0
        used_initial = used_initial or ini
    den = (sum(_w(t) for t in a) + sum(_w(t) for t in b)) / 2.0
    return num / den, used_initial


def person_name_similarity(a: dict, b: dict) -> tuple[float, bool]:
    """Last names must agree; first names may be full, an initial, or missing."""
    la, lb = a["last"], b["last"]
    if la != lb and jaro_winkler(la, lb) < 0.92:
        return 0.0, False
    fa, fb = a["first"], b["first"]
    if not fa or not fb:
        return 0.8, False
    if fa == fb:
        return (0.9, True) if len(fa) == 1 else (1.0, False)
    if len(fa) == 1 and fb[0] == fa:
        return 0.85, True
    if len(fb) == 1 and fa[0] == fb:
        return 0.85, True
    return 0.1, False
