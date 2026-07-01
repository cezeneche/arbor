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


if __name__ == "__main__":
    unittest.main()
