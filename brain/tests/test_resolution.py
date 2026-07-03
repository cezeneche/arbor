"""Upgrade 5 — entity-resolution baseline scorer (stdlib-only tests).

TypeScript blocks the corpus into candidate pairs; this scores them. The scorer
must rank genuine variants of one company (spelling / punctuation / suffix
differences, already stripped by TS normalisation) far above unrelated names,
and band each pair into match / review / distinct. Lexical, dependency-free.
"""
import unittest

from app.resolution import (
    char_ngrams,
    cosine,
    decide,
    levenshtein,
    levenshtein_ratio,
    score_pairs,
    tfidf_vector,
    _idf,
)


class TestCharNgrams(unittest.TestCase):
    def test_basic_trigrams(self):
        self.assertEqual(char_ngrams("acme", 3), ["acm", "cme"])

    def test_short_string_is_its_own_gram(self):
        self.assertEqual(char_ngrams("ab", 3), ["ab"])

    def test_empty_string_has_no_grams(self):
        self.assertEqual(char_ngrams("", 3), [])


class TestCosine(unittest.TestCase):
    def test_identical_vectors_are_one(self):
        v = {"a": 1.0, "b": 2.0}
        self.assertAlmostEqual(cosine(v, v), 1.0)

    def test_disjoint_vectors_are_zero(self):
        self.assertEqual(cosine({"a": 1.0}, {"b": 1.0}), 0.0)

    def test_empty_vector_is_zero(self):
        self.assertEqual(cosine({}, {"a": 1.0}), 0.0)


class TestLevenshtein(unittest.TestCase):
    def test_distance(self):
        self.assertEqual(levenshtein("kitten", "sitting"), 3)
        self.assertEqual(levenshtein("acme", "acme"), 0)

    def test_ratio_bounds(self):
        self.assertEqual(levenshtein_ratio("acme", "acme"), 1.0)
        self.assertEqual(levenshtein_ratio("", ""), 1.0)
        self.assertTrue(0.0 <= levenshtein_ratio("acme steel", "acme steal") < 1.0)


class TestDecide(unittest.TestCase):
    def test_bands(self):
        self.assertEqual(decide(0.9, 0.85, 0.65), "match")
        self.assertEqual(decide(0.7, 0.85, 0.65), "review")
        self.assertEqual(decide(0.4, 0.85, 0.65), "distinct")

    def test_boundaries_are_inclusive(self):
        self.assertEqual(decide(0.85, 0.85, 0.65), "match")
        self.assertEqual(decide(0.65, 0.85, 0.65), "review")


class TestIdf(unittest.TestCase):
    def test_ubiquitous_ngram_is_downweighted_but_positive(self):
        idf = _idf([["ste"], ["ste"], ["ste"]])
        self.assertGreater(idf["ste"], 0.0)

    def test_rare_ngram_outweighs_common(self):
        idf = _idf([["ste", "zzz"], ["ste"], ["ste"]])
        self.assertGreater(idf["zzz"], idf["ste"])


class TestScorePairs(unittest.TestCase):
    def test_identical_normalised_names_score_match(self):
        names = {"a": "acme steel", "b": "acme steel"}
        [scored] = score_pairs(names, [("a", "b")])
        self.assertAlmostEqual(scored["similarity"], 1.0)
        self.assertEqual(scored["decision"], "match")

    def test_close_variant_scores_high(self):
        # A one-character typo of the same company.
        names = {"a": "acme steel", "b": "acme steal"}
        [scored] = score_pairs(names, [("a", "b")])
        self.assertGreater(scored["similarity"], 0.65)

    def test_unrelated_names_score_distinct(self):
        names = {"a": "acme steel", "b": "zenith logistics"}
        [scored] = score_pairs(names, [("a", "b")])
        self.assertEqual(scored["decision"], "distinct")

    def test_distinctive_shared_substring_beats_generic_overlap(self):
        # "northgate" is distinctive; both share it. A pair sharing only the
        # generic "steel" token should score lower.
        names = {
            "a": "northgate steel",
            "b": "northgate steelworks",
            "c": "meridian steel",
        }
        scored = {(s["a"], s["b"]): s for s in score_pairs(names, [("a", "b"), ("a", "c")])}
        self.assertGreater(scored[("a", "b")]["similarity"], scored[("a", "c")]["similarity"])

    def test_unknown_id_scores_distinct_not_crash(self):
        names = {"a": "acme steel"}
        [scored] = score_pairs(names, [("a", "ghost")])
        self.assertEqual(scored["decision"], "distinct")

    def test_thresholds_are_honoured(self):
        names = {"a": "acme steel", "b": "acme steal"}
        [scored] = score_pairs(names, [("a", "b")], threshold_match=0.0, threshold_review=0.0)
        self.assertEqual(scored["decision"], "match")


if __name__ == "__main__":
    unittest.main()
