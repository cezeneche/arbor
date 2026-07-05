"""Upgrade 2 — schema inference (stdlib-only tests).

Fields that co-vary across documents should group; a field present in every
document is the schema backbone (core); a field that barely ever appears is noise.
"""
import unittest

from app.schema_infer import infer_schema, pairwise_mutual_information


class TestPairwiseMI(unittest.TestCase):
    def test_co_occurring_fields_have_positive_mi(self):
        docs = [["a", "b"], ["a", "b"], ["c"], ["c"]]
        pairs = {(p["a"], p["b"]): p["mi"] for p in pairwise_mutual_information(docs, ["a", "b", "c"])}
        # a and b always appear together -> high MI.
        self.assertGreater(pairs[("a", "b")], 0.5)


class TestInferSchema(unittest.TestCase):
    def setUp(self):
        # 10 docs. entity_name always present (core). weight+origin co-occur in
        # the first 5, absent in the last 5 (grouped). junk appears once (noise).
        self.docs = (
            [["entity_name", "weight", "origin"] for _ in range(5)]
            + [["entity_name"] for _ in range(4)]
            + [["entity_name", "junk"]]
        )

    def test_ubiquitous_field_is_core(self):
        result = infer_schema(self.docs)
        self.assertIn("entity_name", result["core"])

    def test_co_varying_fields_group_together(self):
        result = infer_schema(self.docs)
        grouped = {frozenset(g) for g in result["groups"]}
        self.assertIn(frozenset({"weight", "origin"}), grouped)

    def test_rare_field_is_noise(self):
        result = infer_schema(self.docs)
        self.assertIn("junk", result["noise"])
        # Noise is not smuggled into a group.
        self.assertFalse(any("junk" in g for g in result["groups"]))

    def test_empty_corpus_is_empty(self):
        self.assertEqual(
            infer_schema([]),
            {"core": [], "groups": [], "noise": [], "pairs": []},
        )


if __name__ == "__main__":
    unittest.main()
