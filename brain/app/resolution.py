"""Upgrade 5 — entity-resolution baseline scorer (pure stdlib).

TypeScript does the blocking (cheap, deterministic grouping); this scores the
surviving candidate pairs. The certified-data network effect depends on the same
real-world supplier resolving to one identity across many buyers, so the scorer's
job is to say, per pair, how likely two normalised company names are the same
entity — and whether that is confident enough to auto-merge, needs human review,
or is distinct.

Lexical baseline, deliberately dependency-free (no torch, no embeddings): it runs
in the lean serverless brain today and catches the common case — spelling,
punctuation, and suffix variants of the same name. Semantic embeddings are the
next escalation if this plateaus (mirroring the plan's baseline→escalation
shape), and optimal transport the one after that.

Similarity fuses two complementary signals, each in [0, 1]:
  - char n-gram cosine over TF-IDF vectors — robust to word order and to shared
    distinctive substrings; smoothed IDF so a common n-gram is down-weighted but
    never zeroed.
  - normalised edit-distance ratio — robust to small typos and to short names
    where n-grams are sparse.
"""
from __future__ import annotations

import math
from collections import Counter


def char_ngrams(text: str, n: int) -> list[str]:
    """Character n-grams of `text`. For text shorter than n, the whole string is
    the single gram (so short names still compare)."""
    if n < 1:
        raise ValueError("n must be >= 1")
    if len(text) < n:
        return [text] if text else []
    return [text[i : i + n] for i in range(len(text) - n + 1)]


def _idf(docs_ngrams: list[list[str]]) -> dict[str, float]:
    """Smoothed inverse document frequency per n-gram: log((1+N)/(1+df)) + 1, so
    IDF is always positive (a gram shared by every name is down-weighted, not
    dropped)."""
    n_docs = len(docs_ngrams)
    df: Counter[str] = Counter()
    for grams in docs_ngrams:
        for g in set(grams):
            df[g] += 1
    return {g: math.log((1 + n_docs) / (1 + d)) + 1.0 for g, d in df.items()}


def tfidf_vector(grams: list[str], idf: dict[str, float]) -> dict[str, float]:
    """TF-IDF sparse vector for one document's n-grams (term freq × idf)."""
    tf = Counter(grams)
    return {g: count * idf.get(g, 0.0) for g, count in tf.items()}


def cosine(a: dict[str, float], b: dict[str, float]) -> float:
    """Cosine similarity of two sparse vectors. 0 if either is empty."""
    if not a or not b:
        return 0.0
    # Iterate the smaller vector for the dot product.
    small, large = (a, b) if len(a) <= len(b) else (b, a)
    dot = sum(weight * large.get(g, 0.0) for g, weight in small.items())
    norm_a = math.sqrt(sum(w * w for w in a.values()))
    norm_b = math.sqrt(sum(w * w for w in b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


def levenshtein(a: str, b: str) -> int:
    """Edit distance between two strings (iterative, O(len(a)·len(b)))."""
    if a == b:
        return 0
    if not a:
        return len(b)
    if not b:
        return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        curr = [i]
        for j, cb in enumerate(b, start=1):
            cost = 0 if ca == cb else 1
            curr.append(min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost))
        prev = curr
    return prev[-1]


def levenshtein_ratio(a: str, b: str) -> float:
    """1 - edit_distance / max_len, in [0, 1]. Two empty strings are identical."""
    if not a and not b:
        return 1.0
    longest = max(len(a), len(b))
    return 1.0 - levenshtein(a, b) / longest


def decide(similarity: float, threshold_match: float, threshold_review: float) -> str:
    """Band a similarity into an action: match / review / distinct."""
    if similarity >= threshold_match:
        return "match"
    if similarity >= threshold_review:
        return "review"
    return "distinct"


def score_pairs(
    names: dict[str, str],
    pairs: list[tuple[str, str]],
    ngram: int = 3,
    threshold_match: float = 0.85,
    threshold_review: float = 0.65,
    ngram_weight: float = 0.5,
) -> list[dict]:
    """Score each candidate pair. TF-IDF is fit over the whole batch of names so a
    generic n-gram (e.g. "ste") is down-weighted relative to a distinctive one."""
    docs = {eid: char_ngrams(text, ngram) for eid, text in names.items()}
    idf = _idf(list(docs.values()))
    vectors = {eid: tfidf_vector(grams, idf) for eid, grams in docs.items()}

    out: list[dict] = []
    for a, b in pairs:
        va, vb = vectors.get(a, {}), vectors.get(b, {})
        ngram_cos = cosine(va, vb)
        lev = levenshtein_ratio(names.get(a, ""), names.get(b, ""))
        similarity = ngram_weight * ngram_cos + (1.0 - ngram_weight) * lev
        out.append(
            {
                "a": a,
                "b": b,
                "similarity": similarity,
                "decision": decide(similarity, threshold_match, threshold_review),
            }
        )
    return out
