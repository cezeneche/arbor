"""Contract + auth tests for the brain's HTTP surface.

Runs against the FastAPI app in-process via TestClient. The internal token is
set before the app is imported so the fail-closed auth path is exercised for
real, not mocked.
"""
import os
import unittest

os.environ.setdefault("BRAIN_INTERNAL_TOKEN", "test-secret-token")

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import TOKEN_HEADER  # noqa: E402
from app.main import app  # noqa: E402

client = TestClient(app)
AUTH = {TOKEN_HEADER: "test-secret-token"}


class TestHealth(unittest.TestCase):
    def test_health_needs_no_token(self):
        r = client.get("/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "ok")


class TestAuth(unittest.TestCase):
    def test_missing_token_rejected(self):
        r = client.post("/calibration/fit", json={"samples": []})
        self.assertEqual(r.status_code, 401)

    def test_wrong_token_rejected(self):
        r = client.post(
            "/calibration/fit",
            json={"samples": []},
            headers={TOKEN_HEADER: "wrong"},
        )
        self.assertEqual(r.status_code, 401)


class TestCalibrationFit(unittest.TestCase):
    def test_groups_are_calibrated_independently(self):
        samples = (
            [{"group": "supplier_identity", "score": 0.9, "correct": True} for _ in range(20)]
            + [{"group": "supplier_identity", "score": 0.9, "correct": False} for _ in range(5)]
            + [{"group": "mass", "score": 0.5, "correct": True} for _ in range(2)]
        )
        r = client.post(
            "/calibration/fit",
            json={"samples": samples, "bins": 10, "min_samples": 10},
            headers=AUTH,
        )
        self.assertEqual(r.status_code, 200)
        body = r.json()
        groups = {g["group"]: g for g in body["groups"]}
        self.assertIn("supplier_identity", groups)
        self.assertIn("mass", groups)
        # 25 supplier labels >= min_samples 10 -> sufficient; 2 mass labels -> not.
        self.assertTrue(groups["supplier_identity"]["sufficient"])
        self.assertFalse(groups["mass"]["sufficient"])
        self.assertEqual(groups["supplier_identity"]["n"], 25)
        self.assertIsNotNone(groups["supplier_identity"]["ece"])
        self.assertEqual(groups["supplier_identity"]["calibration_map"]["method"], "isotonic")
        self.assertIn("fitted_at", body)

    def test_score_out_of_range_is_rejected(self):
        r = client.post(
            "/calibration/fit",
            json={"samples": [{"group": "g", "score": 1.5, "correct": True}]},
            headers=AUTH,
        )
        self.assertEqual(r.status_code, 422)


class TestFusion(unittest.TestCase):
    def test_requires_token(self):
        r = client.post("/fusion/fields", json={"fields": []})
        self.assertEqual(r.status_code, 401)

    def test_fuses_field_samples_into_posteriors(self):
        r = client.post(
            "/fusion/fields",
            json={
                "fields": [
                    {"field_name": "declared_weight", "document_class": "CUSTOMS_DECLARATION",
                     "samples": ["24500", "24,500", "24500"]},
                    {"field_name": "importer_name", "document_class": "CUSTOMS_DECLARATION",
                     "samples": ["Acme Steel", "Acme Steel", "Acme Steel Ltd"]},
                ]
            },
            headers=AUTH,
        )
        self.assertEqual(r.status_code, 200)
        fields = {f["field_name"]: f for f in r.json()["fields"]}
        # Unanimous numeric agreement (thousands separator normalised) -> agreement 3.
        self.assertEqual(fields["declared_weight"]["agreement"], 3)
        self.assertAlmostEqual(fields["declared_weight"]["posterior_mean"], 0.8, places=6)
        # 2/3 agreement on the name -> lower confidence.
        self.assertEqual(fields["importer_name"]["agreement"], 2)
        self.assertLess(
            fields["importer_name"]["posterior_mean"],
            fields["declared_weight"]["posterior_mean"],
        )


class TestResolutionScore(unittest.TestCase):
    def test_requires_token(self):
        r = client.post("/resolution/score", json={"names": [], "pairs": []})
        self.assertEqual(r.status_code, 401)

    def test_scores_and_bands_candidate_pairs(self):
        r = client.post(
            "/resolution/score",
            json={
                "names": [
                    {"id": "a", "normalised": "acme steel"},
                    {"id": "b", "normalised": "acme steel"},
                    {"id": "c", "normalised": "zenith logistics"},
                ],
                "pairs": [{"a": "a", "b": "b"}, {"a": "a", "b": "c"}],
            },
            headers=AUTH,
        )
        self.assertEqual(r.status_code, 200)
        scores = {(s["a"], s["b"]): s for s in r.json()["scores"]}
        self.assertEqual(scores[("a", "b")]["decision"], "match")
        self.assertEqual(scores[("a", "c")]["decision"], "distinct")

    def test_ngram_out_of_range_is_rejected(self):
        r = client.post(
            "/resolution/score",
            json={"names": [], "pairs": [], "ngram": 9},
            headers=AUTH,
        )
        self.assertEqual(r.status_code, 422)


class TestSchemaInfer(unittest.TestCase):
    def test_requires_token(self):
        r = client.post("/infotheory/schema", json={"documents": []})
        self.assertEqual(r.status_code, 401)

    def test_classifies_fields(self):
        docs = (
            [["entity_name", "weight", "origin"] for _ in range(5)]
            + [["entity_name"] for _ in range(4)]
            + [["entity_name", "junk"]]
        )
        r = client.post("/infotheory/schema", json={"documents": docs}, headers=AUTH)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn("entity_name", body["core"])
        self.assertIn("junk", body["noise"])
        self.assertTrue(any(set(g) == {"weight", "origin"} for g in body["groups"]))


if __name__ == "__main__":
    unittest.main()
