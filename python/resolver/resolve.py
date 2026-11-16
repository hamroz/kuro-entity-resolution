"""Candidate generation, scoring and bucketing.

Pipeline:
  1. block: only compare mentions that share a blocking key
     (a distinctive name token, an initial, or an identifier)
  2. score organisations: name similarity + context evidence -> confidence
  3. cluster organisations from automatic decisions only (with identifier
     conflicts as cannot-link constraints)
  4. score persons, using step 3 to compare employers as resolved entities
  5. bucket every pair: auto-merge / needs a human / kept separate

Each pair carries the rule that decided it and the signed evidence behind
the score, so every decision can be explained and replayed.
The TypeScript mirror is src/lib/er/resolve.ts.
"""

from __future__ import annotations

import math

from .normalize import GENERIC, name_similarity, person_name_similarity

AUTO_THRESHOLD = 0.85
UNSURE_THRESHOLD = 0.35

ORG_BIAS = -7.0
PERSON_BIAS = -6.0
NAME_WEIGHT = 7.5

W = {
    "vat_match": 5.0, "vat_conflict": -6.0,
    "register_match": 4.0, "register_conflict": -5.0,
    "vendor_match": 4.5, "vendor_conflict": -4.0,
    "street_match": 2.0,
    "city_match": 1.2, "city_conflict": -2.5,
    "trade_match": 0.8, "trade_conflict": -1.0,
    "project_match": 0.6,
    "legal_form_conflict": -0.8,
    "alias": 6.0,
    "same_doc": 1.0, "same_doc_person": 1.5,
    "employer_same": 1.5, "employer_different": -1.0,
    "email_match": 1.5, "email_conflict": -0.5,
}

RULES = {
    "R0": "identifier conflict: different VAT ID, register entry or vendor number",
    "R1": "shared identifier (VAT ID, register entry, vendor number or letterhead alias)",
    "R2": "name and context agree above the auto-merge threshold",
    "R3": "evidence is mixed or thin: a human decides",
    "R4": "not enough similarity: kept separate",
}


def sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def pair_key(a: str, b: str) -> str:
    return a + "|" + b if a < b else b + "|" + a


def _blocking_keys(m: dict) -> list[str]:
    keys: list[str] = []
    if m["type"] == "org":
        if m["norm"]["compact"]:
            keys.append("compact:" + m["norm"]["compact"])
        for t in m["norm"]["tokens"]:
            if len(t) == 1:
                keys.append("init:" + t)
            elif len(t) >= 2 and t not in GENERIC:
                keys.append("tok:" + t)
                keys.append("init:" + t[0])
        for f in ("vat", "register", "vendor"):
            if m["ctx"][f]:
                keys.append(f + ":" + m["ctx"][f])
        if m["ctx"]["alias_of"]:
            keys.append("alias:" + min(m["id"], m["ctx"]["alias_of"]))
    else:
        keys.append("last:" + m["norm"]["last"])
    return keys


def candidate_pairs(mentions: list[dict]) -> list[tuple[dict, dict]]:
    index: dict[str, list[int]] = {}
    for i, m in enumerate(mentions):
        for k in _blocking_keys(m):
            index.setdefault(k, []).append(i)
    seen: set[tuple[int, int]] = set()
    for k in sorted(index):
        ids = index[k]
        for x in range(len(ids)):
            for y in range(x + 1, len(ids)):
                i, j = ids[x], ids[y]
                if i == j:
                    continue
                a, b = (i, j) if i < j else (j, i)
                if mentions[a]["type"] != mentions[b]["type"]:
                    continue
                seen.add((a, b))
    return [(mentions[a], mentions[b]) for a, b in sorted(seen)]


def _ev(code: str, label: str) -> dict:
    return {"code": code, "label": label, "weight": W[code]}


def score_org_pair(a: dict, b: dict) -> dict:
    ca, cb = a["ctx"], b["ctx"]
    name, used_initial = name_similarity(a["norm"]["tokens"], b["norm"]["tokens"])
    evidence: list[dict] = []
    strong = False
    conflict = False
    for field, label in (("vat", "VAT ID"), ("register", "register entry"), ("vendor", "vendor no.")):
        va, vb = ca[field], cb[field]
        if va and vb:
            if va == vb:
                evidence.append(_ev(field + "_match", f"same {label} {va}"))
                strong = True
            else:
                evidence.append(_ev(field + "_conflict", f"different {label}: {va} vs {vb}"))
                conflict = True
    if ca["alias_of"] == b["id"] or cb["alias_of"] == a["id"]:
        evidence.append(_ev("alias", "named together on one letterhead"))
        strong = True
    if ca["street"] and cb["street"] and ca["street"] == cb["street"]:
        evidence.append(_ev("street_match", "same street address"))
    if ca["city"] and cb["city"]:
        if ca["city"] == cb["city"]:
            evidence.append(_ev("city_match", f"same city ({ca['city']})"))
        else:
            evidence.append(_ev("city_conflict", f"different cities: {ca['city']} vs {cb['city']}"))
    if ca["trade"] and cb["trade"]:
        if ca["trade"] == cb["trade"]:
            evidence.append(_ev("trade_match", f"same trade ({ca['trade']})"))
        else:
            evidence.append(_ev("trade_conflict", f"different trades: {ca['trade']} vs {cb['trade']}"))
    if ca["project"] and ca["project"] == cb["project"]:
        evidence.append(_ev("project_match", f"same project ({ca['project']})"))
    if ca["legal_form"] and cb["legal_form"] and ca["legal_form"] != cb["legal_form"]:
        evidence.append(_ev("legal_form_conflict", f"different legal forms: {ca['legal_form']} vs {cb['legal_form']}"))
    city_conflict = any(e["code"] == "city_conflict" for e in evidence)
    if a["doc_id"] == b["doc_id"] and a["norm"]["compact"] == b["norm"]["compact"] and not city_conflict:
        evidence.append(_ev("same_doc", "same name within one document"))
    logit = ORG_BIAS + NAME_WEIGHT * name + sum(e["weight"] for e in evidence)
    return _decide(a, b, name, used_initial, evidence, logit, strong, conflict)


def score_person_pair(a: dict, b: dict, org_cluster: dict[str, str]) -> dict | None:
    name, used_initial = person_name_similarity(a["norm"], b["norm"])
    if name == 0.0:
        return None
    ca, cb = a["ctx"], b["ctx"]
    evidence: list[dict] = []
    oa, ob = ca["org_mention_id"], cb["org_mention_id"]
    if oa and ob:
        if org_cluster.get(oa, oa) == org_cluster.get(ob, ob):
            evidence.append(_ev("employer_same", f"employers resolve to the same organisation ({ca['org_surface']} / {cb['org_surface']})"))
        else:
            evidence.append(_ev("employer_different", f"different employers: {ca['org_surface']} vs {cb['org_surface']}"))
    if ca["email_domain"] and cb["email_domain"]:
        if ca["email_domain"] == cb["email_domain"]:
            evidence.append(_ev("email_match", f"same e-mail domain ({ca['email_domain']})"))
        else:
            evidence.append(_ev("email_conflict", "different e-mail domains"))
    if ca["project"] and ca["project"] == cb["project"]:
        evidence.append(_ev("project_match", f"same project ({ca['project']})"))
    if a["doc_id"] == b["doc_id"] and name >= 0.8:
        evidence.append(_ev("same_doc_person", "compatible names within one document"))
    logit = PERSON_BIAS + NAME_WEIGHT * name + sum(e["weight"] for e in evidence)
    return _decide(a, b, name, used_initial, evidence, logit, False, False)


def _decide(a, b, name, used_initial, evidence, logit, strong, conflict) -> dict:
    p = sigmoid(logit)
    negative = any(e["weight"] < 0 for e in evidence)
    if conflict:
        bucket, rule, p = "separate", "R0", min(p, 0.02)
    elif strong:
        bucket, rule, p = "auto", "R1", max(p, 0.97)
    elif p >= AUTO_THRESHOLD:
        bucket, rule = "auto", "R2"
    elif p >= UNSURE_THRESHOLD or (used_initial and not negative and name >= 0.8):
        bucket, rule = "unsure", "R3"
    else:
        bucket, rule = "separate", "R4"
    if bucket == "unsure" and p < UNSURE_THRESHOLD:
        evidence = evidence + [{"code": "abbreviation", "label": "abbreviated name and no identifiers either way", "weight": 0.0}]
    return {
        "key": pair_key(a["id"], b["id"]),
        "a": a["id"] if a["id"] < b["id"] else b["id"],
        "b": b["id"] if a["id"] < b["id"] else a["id"],
        "type": a["type"],
        "name_sim": round(name, 4),
        "confidence": round(p, 4),
        "bucket": bucket,
        "rule": rule,
        "evidence": evidence,
    }


class UnionFind:
    def __init__(self, items):
        self.parent = {i: i for i in items}

    def find(self, x):
        while self.parent[x] != x:
            self.parent[x] = self.parent[self.parent[x]]
            x = self.parent[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if rb < ra:
            ra, rb = rb, ra
        self.parent[rb] = ra


def cluster(ids: list[str], merges: list[dict], cannot_link: set[str]) -> tuple[dict[str, str], list[str]]:
    """Constraint-aware clustering.

    merges: pair dicts with a, b, confidence and optional 'human' flag.
    Strongest edges are applied first; an edge that would put two mentions
    with a cannot-link constraint into one cluster is skipped (returned as blocked).
    Returns (mention id -> cluster root id, blocked pair keys).
    """
    uf = UnionFind(ids)
    members: dict[str, set[str]] = {i: {i} for i in ids}
    cl_pairs = [k.split("|") for k in sorted(cannot_link)]
    blocked: list[str] = []
    order = sorted(merges, key=lambda p: (0 if p.get("human") else 1, -p["confidence"], p["key"]))
    for p in order:
        ra, rb = uf.find(p["a"]), uf.find(p["b"])
        if ra == rb:
            continue
        ma, mb = members[ra], members[rb]
        if any((x in ma and y in mb) or (x in mb and y in ma) for x, y in cl_pairs):
            blocked.append(p["key"])
            continue
        uf.union(ra, rb)
        root = uf.find(ra)
        other = rb if root == ra else ra
        members[root] = ma | mb
        members.pop(other, None)
    return {i: uf.find(i) for i in ids}, blocked


def resolve(mentions: list[dict]) -> list[dict]:
    """Score every candidate pair. Pure function of the mentions."""
    orgs = [m for m in mentions if m["type"] == "org"]
    org_pairs = [score_org_pair(a, b) for a, b in candidate_pairs(orgs)]
    org_pairs = [p for p in org_pairs if _keep(p)]
    auto = [p for p in org_pairs if p["bucket"] == "auto"]
    conflicts = {p["key"] for p in org_pairs if p["rule"] == "R0"}
    org_cluster, _ = cluster([m["id"] for m in orgs], auto, conflicts)
    persons = [m for m in mentions if m["type"] == "person"]
    person_pairs = []
    for a, b in candidate_pairs(persons):
        p = score_person_pair(a, b, org_cluster)
        if p is not None:
            person_pairs.append(p)
    pairs = org_pairs + person_pairs
    pairs.sort(key=lambda p: p["key"])
    return pairs


def _keep(p: dict) -> bool:
    if p["name_sim"] >= 0.5:
        return True
    return p["rule"] in ("R0", "R1")
