# Reversible, evidence-linked entity resolution for construction documents

A weekend proof of work by **Hamroz Gavharov**.

**The problem, in Kuro's words** ([kuro.build](https://kuro.build), open problem 03, "Fuzzy matching is not enough"):
*"A wrong merge is worse than none, so resolution has to be reversible and able to say 'not sure'."*

This repo is my attempt at a small, working version of that: entity resolution over messy German/English construction documents where every merge has reasons, a confidence and a pointer to the sentence it came from; uncertain pairs go to a human; and every decision, automatic or human, can be undone from an append-only log.

## What you can do in the demo

| View | What it shows |
|---|---|
| **Overview** | Counts, extraction mode (rule-based or LLM), upload of your own PDF/text |
| **Documents** | Each document with every mention highlighted at its exact character offsets; click a mention for its context and its entity |
| **Entities** | Clusters (list and graph). For each entity: spellings, cities, VAT IDs, register entries, vendor numbers, every mention as a source line, and the merges holding it together, with **Undo** / **Split** / **Detach mention** |
| **Review** | Three buckets: *not sure: needs a human* (Merge / Keep separate / Skip), *merged*, *kept separate* |
| **Audit log** | The append-only event log: resolver runs, automatic decisions with rule and confidence, human decisions, undos. Downloadable as JSON |

### Sample data

Nine fictional documents (`public/samples/`) for three fictional projects of a fictional general contractor (Brandt Generalbau GmbH): a Leistungsverzeichnis excerpt, subcontractor quotes, invoices, site diaries in German and English, a change-order quote and an award memo. They contain the traps the problem is about:

- one firm under five names: *Müller Bau GmbH*, *Mueller-Bau*, *Müller Bauunternehmung GmbH*, *Müller Bau*, and the trade name *MB Rohbau Berlin*, which shares no distinctive token with the others but has the same vendor no. 4711, VAT ID and street;
- a **different** *Müller Bau GmbH* bidding in Hamburg (name similarity 1.0, different VAT ID and register entry);
- *M. Bau GmbH & Co. KG*: an abbreviation that might be Müller and might not;
- two genuinely different firms: *Schmidt Elektro GmbH* (Berlin) and *Schmidt Elektrotechnik GmbH* (Leipzig), plus a site-diary "Schmidt Elektro" with no city;
- a trade name vs legal name: *Elbtal Fassaden · Kühn Fassadentechnik GmbH* on one letterhead;
- people as *Thomas Becker*, *T. Becker*, *Hr. Becker*, *Becker, Thomas*; *Sabine Wolff* / *S. Wolff* / *Ms. Wolff*; and several unrelated *Schmidt*s.

On the samples the resolver ends with 22 entities, merges the five Müller spellings and keeps the Hamburg firm apart, and leaves 13 open questions for a human (for example the bare "Müller Bau" in the electrical quote, which has no context at all).

## Approach

```
documents ─▶ extract ─▶ block ─▶ score ─▶ bucket ─▶ cluster (with constraints) ─▶ review ─▶ log
              │                     │                     │                          │
       offsets, line,       name + signed          cannot-link from         every change is
       context fields       evidence, rule         conflicts & humans       an appended event
```

1. **Extraction.** Each mention keeps `doc_id`, character offsets, line number and the context near it: city, street, VAT ID, register entry (HRB/HRA), vendor/Kreditor number, trade (Gewerk), role, e-mail domain, legal form, and for people the employer mention.
   - *Rule-based (default, no keys):* legal-form anchors (`GmbH`, `AG`, `GmbH & Co. KG`, …), labels (`Fa.`, `Firma`), a corpus-wide gazetteer that finds core names again with umlaut and hyphen variants (`M(ü|ue)ller[- ]Bau`), person patterns (honorifics, `Last, First`, initials), and a letterhead-alias rule (`X · Y GmbH`). Context comes from the rest of the line and the following lines of the same address block.
   - *LLM (when `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is set):* the model returns mentions and context fields as structured output (Zod schema). Every proposal is then **grounded**: its surface string must be found on the line the model named (or elsewhere in the document), otherwise it is dropped. The UI labels which extractor produced the mentions.
2. **Normalisation.** Umlaut folding (`ü→ue`, `ß→ss`), legal forms stripped but recorded, a trailing city moved to context (`MB Rohbau Berlin`), domain synonyms (`Bauunternehmung→bau`, `Elektrotechnik→elektro`), generic trade tokens weighted half.
3. **Blocking.** Mentions are only compared if they share a distinctive token, an initial, the compact name, or an identifier (VAT, register, vendor, letterhead alias).
4. **Scoring.** Log-odds: a negative starting point (a name alone is not proof), plus 7.5 × name similarity, plus signed evidence:

   | evidence | weight |
   |---|---|
   | same VAT ID / register entry / vendor no. | +5.0 / +4.0 / +4.5 |
   | different VAT ID / register entry / vendor no. | −6.0 / −5.0 / −4.0 (hard conflict) |
   | named together on one letterhead | +6.0 |
   | same street | +2.0 |
   | same / different city | +1.2 / −2.5 |
   | same / different trade | +0.8 / −1.0 |
   | same project | +0.6 |
   | different legal form (GmbH vs GmbH & Co. KG) | −0.8 |
   | same spelling in one document | +1.0 |
   | people: employers resolve to the same / a different org | +1.5 / −1.0 |

   People are scored *after* organisations: the employer comparison uses the organisation clusters, so "S. Wolff" at "MB Rohbau Berlin" is recognised as the Sabine Wolff of Müller Bau because MB Rohbau resolved to Müller Bau through its vendor number.
5. **Buckets and rules.** Every pair records the rule that decided it:
   - `R0` identifier conflict → kept separate (and a cannot-link constraint)
   - `R1` shared identifier or letterhead alias → auto-merge
   - `R2` confidence ≥ 0.85 → auto-merge
   - `R3` 0.35–0.85, or an abbreviated name with no evidence either way → **not sure: a human decides**
   - `R4` below 0.35 → kept separate
6. **Clustering.** Union-find over merge decisions, human ones first, then strongest first. An edge that would put two mentions with a cannot-link constraint (an identifier conflict or a human "keep separate") into one cluster is skipped and shown as *blocked*. This stops the classic transitive failure where A≈B and B≈C silently merge A and C.
7. **Review queue.** One question per pair of clusters (not per mention pair), represented by its strongest uncertain pair, and only if the clusters are not already joined or separated by a constraint.

## Why reversible and evidence-linked

- **Append-only log.** Resolver runs, automatic decisions, human decisions, undos and skips are events. The state of a pair is a fold over the log: the latest decision that has not been undone. Nothing is edited or deleted, so "who merged this, when, by which rule" is always answerable.
- **Undo vs split.** *Undo* retracts a decision; an undone automatic merge goes back to a human and is not re-applied on the next run. *Split* records a confirmed non-match.
- **Human decisions are memory.** A re-run (for example after uploading a new document) appends decisions only for new or changed pairs and never overrides a human. A confirmed non-match is a cannot-link constraint, so it also holds against merges through other mentions.
- **Evidence everywhere.** Every mention is a span in a document; every merge shows the two source lines highlighted, the signed evidence and the confidence. In LLM mode, proposals that cannot be found in the text are dropped.

## Architecture

- `src/lib/er/`: the resolver in TypeScript, used by the Next.js app (App Router, TypeScript, Tailwind, `@xyflow/react` for the graph). It runs in the browser, so the app deploys to Vercel as static pages plus three small route handlers: `/api/mode`, `/api/extract` (LLM extraction) and `/api/parse` (PDF to text with `unpdf`).
- `python/resolver/`: the reference implementation in Python, with the same functions (`extract_corpus`, `resolve`, `reconcile`, `decide`, `undo`, `current_clusters`, `review_queue`).
- `python/flows/resolve_flow.py`: a small Prefect flow (load → extract → score → append decisions to the log → summary). It also runs without Prefect installed (the decorators fall back to no-ops).
- **Parity:** `npm run fixture` runs the TypeScript resolver on the samples and writes `python/tests/fixtures/ts_output.json`; `python/tests/test_parity.py` checks that Python produces the same mentions, pair scores, buckets, rules, evidence, clusters and review queue.
- State (event log, uploads, LLM cache) lives in the browser's localStorage in this demo.

## Run it

```bash
npm install
npm run dev            # http://localhost:3000
npm run build && npm run lint
npm test               # TypeScript event-log tests
npm run fixture        # regenerate the TS→Python parity fixture

cd python
python3 -m venv .venv && .venv/bin/pip install pytest
.venv/bin/pytest -q    # includes the parity test against the TS port
.venv/bin/python flows/resolve_flow.py   # pip install "prefect>=3" first to run it as a real Prefect flow
```

Optional LLM extraction (see `.env.example`): set `ANTHROPIC_API_KEY` (default model `claude-opus-5-5`, override with `ANTHROPIC_MODEL`) or `OPENAI_API_KEY` (default `gpt-4.1-mini`, override with `OPENAI_MODEL`). `LLM_PROVIDER=anthropic|openai` picks one if both are set. Without keys the app uses the rule-based extractor.

## Limitations

- The weights and thresholds are hand-set and checked against nine documents I wrote myself. The confidence is a log-odds score, not a calibrated probability.
- The rule-based extractor is tuned to the samples: a small first-name list, a fixed city list, German/English label words. On real documents it will miss things; that is what the LLM mode is for.
- The LLM path is type-checked and its grounding step is implemented, but I have not evaluated it against a live model or a labelled set.
- Person scoring uses the automatic organisation clusters; a human org decision does not yet propagate into person scores.
- Mention IDs are `doc_id:offset`, so editing a document's text changes its IDs. Production would anchor spans to a document version.
- Only organisations and people. Requirements, BoQ positions and prices are not resolved here.
- PDFs need a text layer (no OCR), and evidence is line-level, not page/region-level.
- Single-user state in localStorage; no auth, no server-side log.

## What I would do next

- Learn the weights from the human decisions: the evidence items are already log-odds features, so a logistic regression on the review log gives calibrated weights, and the queue can be ordered by expected information gain.
- Store the log as an append-only table with entities as a projection, and run resolution incrementally per new document from the Prefect flow.
- Page and bounding-box evidence from the PDF layout instead of line numbers.
- External identifiers as evidence: VAT validation and commercial-register lookups.
- Use the same blocking → evidence → reversible-decision machinery for BoQ positions and prices.
- An eval set for the LLM extractor (precision/recall of mentions and context fields), tracked per model.
