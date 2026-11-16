"""Reversible, evidence-linked entity resolution for construction documents.

Reference implementation of the logic the web demo runs in TypeScript.
"""

from .corpus import load_samples
from .events import current_clusters, decide, fold, reconcile, undo
from .extract import extract_corpus
from .resolve import resolve

__all__ = [
    "load_samples", "extract_corpus", "resolve", "reconcile", "decide", "undo", "fold",
    "current_clusters",
]
