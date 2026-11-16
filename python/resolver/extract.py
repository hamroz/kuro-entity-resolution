"""Deterministic, rule-based mention extraction.

Finds organisation and person mentions in plain text and pulls the context
that later decides identity: city, street, VAT ID, register number, vendor
number, trade (Gewerk), role, e-mail domain and project.

Every mention keeps its character offsets and line number, so any fact can
be pointed back to the exact place in the source document.
The TypeScript mirror is src/lib/er/extract.ts.
"""

from __future__ import annotations

import re

from .normalize import KNOWN_CITIES, fold, normalize_street, org_core, person_parts

L = "A-Za-zÄÖÜäöüß"  # letters, used for explicit word boundaries
UP = "A-ZÄÖÜ"
LOW = "a-zäöüß"

LEGAL_RAW = r"(?:GmbH ?& ?Co\. ?KG|GmbH|AG|KG|OHG|GbR|e\. ?K\.|UG|mbH|SE|Ltd\.?)"
NOT_LEGAL = r"(?!(?:GmbH|AG|KG|OHG|GbR|UG|mbH|SE|Co\.)(?![" + L + r"]))"
NAMETOK = NOT_LEGAL + r"[" + UP + r"][" + L + r"]*\.?(?:-[" + L + r"]+)*"
NAME_SEQ = NAMETOK + r"(?: (?:& )?" + NAMETOK + r"){0,4}"

ORG_LEGAL_RE = re.compile(r"(?<![" + L + r"])(" + NAME_SEQ + r") (" + LEGAL_RAW + r")(?![" + L + r"])")
ORG_LABEL_RE = re.compile(
    r"(?<![" + L + r"])(?:Fa\.|Firma) (" + NAMETOK + r"(?: (?:& )?" + NAMETOK + r"){0,3})"
)

STOP_LEAD = {
    "Die", "Der", "Das", "Den", "Dem", "Firma", "Fa.", "The", "Note", "Hinweis", "Bidder",
    "Bieter", "Client", "An", "To", "From", "Von", "Mit", "With", "Recommendation", "Project",
    "Issued", "Award",
}

FIRST_NAMES = [
    "Thomas", "Sabine", "Jens", "Katrin", "Peter", "Jana", "Michael", "Andreas", "Stefan",
    "Anna", "Klaus", "Julia", "Martin", "Frank", "Petra", "Markus", "Lukas", "Laura", "Jonas", "Lea",
]
FIRST = "(?:" + "|".join(FIRST_NAMES) + ")"
LAST = r"[" + UP + r"][" + LOW + r"]+(?:-[" + UP + r"][" + LOW + r"]+)?"
HON = r"(?:Herrn|Herr|Frau|Hr\.|Fr\.|Mr\.|Ms\.|Mrs\.)"
B = r"(?<![" + L + r".])"
PERSON_RES = [
    re.compile(B + HON + r" (?:(?:" + FIRST + r"|[" + UP + r"]\.) )?" + LAST + r"(?![" + L + r"])"),
    re.compile(B + LAST + r", " + FIRST + r"(?![" + L + r"])"),
    re.compile(B + FIRST + r" " + LAST + r"(?![" + L + r"])"),
    re.compile(B + r"[" + UP + r"]\. " + LAST + r"(?![" + L + r"])"),
]

VAT_RE = re.compile(r"(?<![A-Za-z])DE ?(\d{3}) ?(\d{3}) ?(\d{3})(?!\d)")
REG_RE = re.compile(r"(?<![A-Za-z])(HR[AB]) ?(\d{3,6})(?!\d)")
VENDOR_RE = re.compile(
    r"(?:Kreditor(?:en)?-?Nr\.?|Lieferanten-?Nr\.?|[Vv]endor (?:[Nn]o\.?|#|number))\s*:?\s*#?\s*(\d{3,6})(?!\d)"
)
POSTCODE_RE = re.compile(r"(?<!\d)\d{5} ([" + UP + r"][" + LOW + r"]+)")
CITY_RE = re.compile(r"(?<![" + L + r"])(" + "|".join(KNOWN_CITIES) + r")(?![" + LOW + r"])")
STREET_RE = re.compile(
    r"(?<![" + L + r"])("
    r"(?:[" + UP + r"][" + LOW + r"]+[- ])+(?:Straße|Strasse|Str\.|Damm|Weg|Allee|Platz|Ring|Chaussee|Landstraße)"
    r"|(?:[" + UP + r"][" + LOW + r"]+-)*[" + UP + r"][" + LOW + r"]*(?:straße|strasse|str\.|weg|allee|platz|damm|ring|chaussee)"
    r") (\d{1,4}[a-z]?)(?![\d])"
)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[a-z]{2,})")
ALIAS_GAP_RE = re.compile(
    r"^\s*(?:·|\||–|\()?\s*(?:ein Unternehmen der|eine Marke der|a trading name of|trading as|vormals|formerly)?\s*$"
)
LABEL_BEFORE_RE = re.compile(r"([" + L + r"][" + L + r". ]*?)\s*:\s*$")
ROLE_AFTER_RE = re.compile(r"^,\s*([" + L + r"][" + L + r" ]{2,30}?)\s*(?:,|\(|$)")

# (keyword in folded text, trade). Earliest occurrence wins.
TRADES: list[tuple[str, str]] = [
    ("generalbau", "General contractor"),
    ("generalunternehmer", "General contractor"),
    ("general contractor", "General contractor"),
    ("rohbau", "Rohbau"),
    ("hochbau", "Rohbau"),
    ("stahlbeton", "Rohbau"),
    ("beton", "Rohbau"),
    ("concrete", "Rohbau"),
    ("formwork", "Rohbau"),
    ("schalung", "Rohbau"),
    ("bewehrung", "Rohbau"),
    ("shell works", "Rohbau"),
    ("shell construction", "Rohbau"),
    ("elektro", "Elektro"),
    ("electrical", "Elektro"),
    ("electrician", "Elektro"),
    ("kabel", "Elektro"),
    ("cable", "Elektro"),
    ("fassade", "Fassade"),
    ("facade", "Fassade"),
    ("geruest", "Gerüst"),
    ("scaffold", "Gerüst"),
    ("sanitaer", "Sanitär/HLS"),
    ("heizung", "Sanitär/HLS"),
    ("plumbing", "Sanitär/HLS"),
]


def find_trade(text: str) -> str | None:
    f = fold(text)
    best_idx = -1
    best = None
    for kw, trade in TRADES:
        idx = f.find(kw)
        if idx >= 0 and (best_idx < 0 or idx < best_idx):
            best_idx = idx
            best = trade
    return best


def _variant_regex(core: str) -> str:
    out = []
    for ch in core:
        if ch == "ü":
            out.append("(?:ü|ue)")
        elif ch == "ö":
            out.append("(?:ö|oe)")
        elif ch == "ä":
            out.append("(?:ä|ae)")
        elif ch == "ß":
            out.append("(?:ß|ss)")
        elif ch in " -":
            out.append("[- ]")
        else:
            out.append(re.escape(ch))
    return "".join(out)


def _strip_legal_raw(surface: str) -> str:
    return re.sub(r"\s*" + LEGAL_RAW + r"$", "", surface).strip()


def _overlaps(start: int, end: int, spans: list[tuple[int, int]]) -> bool:
    return any(start < e and s < end for s, e in spans)


def _lines(text: str) -> list[tuple[int, int]]:
    """(start, end) offsets of each line, end exclusive, newline excluded."""
    out = []
    pos = 0
    for line in text.split("\n"):
        out.append((pos, pos + len(line)))
        pos += len(line) + 1
    return out


def _line_of(lines: list[tuple[int, int]], offset: int) -> int:
    for i, (s, e) in enumerate(lines):
        if s <= offset <= e:
            return i
    return len(lines) - 1


def _paragraphs(text: str, lines: list[tuple[int, int]]) -> list[int]:
    """Paragraph index per line (-1 for blank lines)."""
    para = []
    idx = -1
    prev_blank = True
    for s, e in lines:
        blank = text[s:e].strip() == ""
        if blank:
            para.append(-1)
        else:
            if prev_blank:
                idx += 1
            para.append(idx)
        prev_blank = blank
    return para


def detect_org_spans(docs: list[dict]) -> dict[str, list[dict]]:
    """Pass 1 + 2: legal-form and label anchored orgs, then a gazetteer pass
    that finds the same core names (with umlaut/hyphen variants) elsewhere."""
    found: dict[str, list[dict]] = {}
    cores: set[str] = set()
    for doc in docs:
        text = doc["text"]
        spans: list[dict] = []
        for m in ORG_LEGAL_RE.finditer(text):
            name = m.group(1)
            toks = name.split(" ")
            start = m.start(1)
            while toks and (toks[0] in STOP_LEAD or toks[0] == "&"):
                start += len(toks[0]) + 1
                toks = toks[1:]
            if not toks:
                continue
            spans.append({"start": start, "end": m.end(2), "how": "legal-form"})
        taken = [(s["start"], s["end"]) for s in spans]
        for m in ORG_LABEL_RE.finditer(text):
            surface = m.group(1)
            parts = surface.split(" ")
            if parts and len(parts[-1]) > 2 and parts[-1].endswith("."):
                surface = surface[:-1]
            s, e = m.start(1), m.start(1) + len(surface)
            if _overlaps(s, e, taken):
                continue
            spans.append({"start": s, "end": e, "how": "label"})
            taken.append((s, e))
        found[doc["id"]] = spans
        for sp in spans:
            core = _strip_legal_raw(text[sp["start"]:sp["end"]])
            if " " in core or "-" in core:
                cores.add(core)
    ordered = sorted(cores, key=lambda c: (-len(c), c))
    for doc in docs:
        text = doc["text"]
        spans = found[doc["id"]]
        taken = [(s["start"], s["end"]) for s in spans]
        for core in ordered:
            rx = re.compile(r"(?<![" + L + r"])" + _variant_regex(core) + r"(?![" + L + r"])")
            for m in rx.finditer(text):
                if _overlaps(m.start(), m.end(), taken):
                    continue
                spans.append({"start": m.start(), "end": m.end(), "how": "gazetteer"})
                taken.append((m.start(), m.end()))
        spans.sort(key=lambda s: s["start"])
    return found


def detect_person_spans(text: str, org_spans: list[tuple[int, int]]) -> list[dict]:
    spans: list[dict] = []
    taken = list(org_spans)
    for rx in PERSON_RES:
        for m in rx.finditer(text):
            if _overlaps(m.start(), m.end(), taken):
                continue
            spans.append({"start": m.start(), "end": m.end(), "how": "person-pattern"})
            taken.append((m.start(), m.end()))
    spans.sort(key=lambda s: s["start"])
    return spans


def _empty_ctx(project: str) -> dict:
    return {
        "project": project, "city": None, "street": None, "vat": None, "register": None,
        "vendor": None, "trade": None, "role": None, "email_domain": None, "legal_form": None,
        "alias_of": None, "org_mention_id": None, "org_surface": None,
    }


def _fields_from(segment: str, same_line_part: str) -> dict:
    out: dict = {}
    m = VAT_RE.search(segment)
    if m:
        out["vat"] = "DE" + m.group(1) + m.group(2) + m.group(3)
    m = REG_RE.search(segment)
    if m:
        out["register"] = m.group(1) + " " + m.group(2)
    m = VENDOR_RE.search(segment)
    if m:
        out["vendor"] = m.group(1)
    m = STREET_RE.search(segment)
    if m:
        out["street"] = normalize_street(m.group(1)) + " " + m.group(2)
    m = POSTCODE_RE.search(segment)
    if m:
        out["city"] = m.group(1)
    else:
        m = CITY_RE.search(same_line_part)
        if m:
            out["city"] = m.group(1)
    return out


def extract_document(doc: dict, org_spans: list[dict]) -> list[dict]:
    text = doc["text"]
    lines = _lines(text)
    para = _paragraphs(text, lines)
    project = doc.get("project") or ""

    orgs: list[dict] = []
    for sp in org_spans:
        li = _line_of(lines, sp["start"])
        surface = text[sp["start"]:sp["end"]]
        core = org_core(surface)
        orgs.append({
            "id": f"{doc['id']}:{sp['start']}", "doc_id": doc["id"], "type": "org",
            "surface": surface, "start": sp["start"], "end": sp["end"], "line": li + 1,
            "extractor": "rules", "how": sp["how"], "ctx": _empty_ctx(project),
            "norm": {"tokens": core["tokens"], "compact": core["compact"]},
            "_li": li, "_name_city": core["city"],
        })
        orgs[-1]["ctx"]["legal_form"] = core["legal_form"]

    lines_with_org = {o["_li"] for o in orgs}

    # raw segment after each org: rest of line (to the next org on that line),
    # then following lines of the paragraph until a line that names another org.
    raw: dict[str, tuple[str, str]] = {}
    for idx, o in enumerate(orgs):
        li = o["_li"]
        ls, le = lines[li]
        nxt = orgs[idx + 1] if idx + 1 < len(orgs) and orgs[idx + 1]["_li"] == li else None
        same_line = text[o["end"]:(nxt["start"] if nxt else le)]
        seg = same_line
        if nxt is None and para[li] >= 0:
            j = li + 1
            while j < len(lines) and para[j] == para[li] and j not in lines_with_org:
                seg += "\n" + text[lines[j][0]:lines[j][1]]
                j += 1
        raw[o["id"]] = (seg, same_line)

    # letterhead aliases: "Elbtal Fassaden · Kühn Fassadentechnik GmbH"
    for idx in range(len(orgs) - 1, -1, -1):
        o = orgs[idx]
        nxt = orgs[idx + 1] if idx + 1 < len(orgs) and orgs[idx + 1]["_li"] == o["_li"] else None
        if nxt is None:
            continue
        gap = text[o["end"]:nxt["start"]]
        if ALIAS_GAP_RE.match(gap):
            seg, same = raw[o["id"]]
            nseg, nsame = raw[nxt["id"]]
            raw[o["id"]] = (seg + nseg, same + nsame)
            o["ctx"]["alias_of"] = nxt["id"]
            nxt["ctx"]["alias_of"] = o["id"]

    for idx, o in enumerate(orgs):
        seg, same = raw[o["id"]]
        li = o["_li"]
        ls, _le = lines[li]
        fields = _fields_from(seg, same)
        o["ctx"].update(fields)
        if not o["ctx"]["city"] and o["_name_city"]:
            o["ctx"]["city"] = o["_name_city"]
        prev_end = ls
        if idx > 0 and orgs[idx - 1]["_li"] == li:
            prev_end = orgs[idx - 1]["end"]
        before = text[prev_end:o["start"]]
        o["ctx"]["trade"] = find_trade(o["surface"]) or find_trade(before) or find_trade(seg)
        lm = LABEL_BEFORE_RE.search(before)
        if lm:
            o["ctx"]["role"] = lm.group(1).strip()

    persons: list[dict] = []
    for sp in detect_person_spans(text, [(o["start"], o["end"]) for o in orgs]):
        li = _line_of(lines, sp["start"])
        ls, le = lines[li]
        surface = text[sp["start"]:sp["end"]]
        p = {
            "id": f"{doc['id']}:{sp['start']}", "doc_id": doc["id"], "type": "person",
            "surface": surface, "start": sp["start"], "end": sp["end"], "line": li + 1,
            "extractor": "rules", "how": sp["how"], "ctx": _empty_ctx(project),
            "norm": person_parts(surface),
        }
        # employer: an org on the same line within 25 characters, else the only
        # org of a short paragraph (signature / address blocks)
        best = None
        best_gap = 26
        for o in orgs:
            if o["_li"] != li:
                continue
            gap = sp["start"] - o["end"] if o["end"] <= sp["start"] else o["start"] - sp["end"]
            if 0 <= gap < best_gap:
                best_gap = gap
                best = o
        if best is None and para[li] >= 0:
            plines = [j for j in range(len(lines)) if para[j] == para[li]]
            porgs = [o for o in orgs if para[o["_li"]] == para[li]]
            if len(plines) <= 6 and len(porgs) == 1:
                best = porgs[0]
        if best is not None:
            p["ctx"]["org_mention_id"] = best["id"]
            p["ctx"]["org_surface"] = best["surface"]
        line_text = text[ls:le]
        em = EMAIL_RE.search(line_text)
        if em:
            p["ctx"]["email_domain"] = em.group(1).lower()
        before = text[ls:sp["start"]]
        lm = LABEL_BEFORE_RE.search(before)
        if lm:
            p["ctx"]["role"] = lm.group(1).strip()
        else:
            rm = ROLE_AFTER_RE.search(text[sp["end"]:le])
            if rm:
                p["ctx"]["role"] = rm.group(1).strip()
        persons.append(p)

    out = orgs + persons
    for m in out:
        m.pop("_li", None)
        m.pop("_name_city", None)
    out.sort(key=lambda m: m["start"])
    return out


def extract_corpus(docs: list[dict]) -> list[dict]:
    """Extract mentions from all documents (gazetteer spans the whole corpus)."""
    org_spans = detect_org_spans(docs)
    mentions: list[dict] = []
    for doc in docs:
        mentions.extend(extract_document(doc, org_spans[doc["id"]]))
    return mentions
