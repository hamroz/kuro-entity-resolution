"""Load the sample documents shipped with the web app (public/samples)."""

from __future__ import annotations

import json
from pathlib import Path

SAMPLES = Path(__file__).resolve().parents[2] / "public" / "samples"


def load_samples(root: Path = SAMPLES) -> list[dict]:
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    docs = []
    for d in manifest["documents"]:
        text = (root / d["file"]).read_text(encoding="utf-8").replace("\r\n", "\n")
        docs.append({**d, "text": text})
    return docs
