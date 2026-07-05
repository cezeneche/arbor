"""Upgrade 9 — graph flow consistency (stdlib-only tests)."""
import unittest

from app.flow import check_conservation, detect_double_counting


class TestConservation(unittest.TestCase):
    def test_balanced_node_passes(self):
        # 100 in via edge, 100 out via edge — balances.
        nodes = [{"id": "mid"}]
        edges = [{"source": "a", "target": "mid", "quantity": 100}, {"source": "mid", "target": "b", "quantity": 100}]
        self.assertEqual(check_conservation(nodes, edges), [])

    def test_overdraw_is_flagged(self):
        # Node produces 10, receives nothing, ships 100 — impossible.
        nodes = [{"id": "s", "supply": 10}]
        edges = [{"source": "s", "target": "b", "quantity": 100}]
        anomalies = check_conservation(nodes, edges)
        self.assertEqual(anomalies[0]["type"], "OVERDRAW")

    def test_supply_covers_outflow(self):
        nodes = [{"id": "s", "supply": 100}]
        edges = [{"source": "s", "target": "b", "quantity": 100}]
        self.assertEqual(check_conservation(nodes, edges), [])

    def test_imbalance_within_tolerance_passes(self):
        nodes = [{"id": "s", "supply": 100}]
        edges = [{"source": "s", "target": "b", "quantity": 102}]  # 2% over, tol 5%
        self.assertEqual(check_conservation(nodes, edges), [])


class TestDoubleCounting(unittest.TestCase):
    def test_certificate_claimed_by_two_parties(self):
        claims = [
            {"ref": "REGO-123", "claimant": "buyer_a"},
            {"ref": "REGO-123", "claimant": "buyer_b"},
        ]
        [a] = detect_double_counting(claims)
        self.assertEqual(a["type"], "DOUBLE_COUNTED")
        self.assertEqual(a["claimants"], ["buyer_a", "buyer_b"])

    def test_single_claimant_is_fine(self):
        self.assertEqual(
            detect_double_counting([{"ref": "REGO-123", "claimant": "buyer_a"}]), []
        )

    def test_over_allocation_against_capacity(self):
        claims = [
            {"ref": "lot-9", "claimant": "buyer_a", "quantity": 60, "capacity": 100},
            {"ref": "lot-9", "claimant": "buyer_a", "quantity": 60, "capacity": 100},
        ]
        [a] = detect_double_counting(claims)
        self.assertEqual(a["type"], "OVER_ALLOCATION")
        self.assertEqual(a["total"], 120)

    def test_within_capacity_is_fine(self):
        claims = [
            {"ref": "lot-9", "claimant": "buyer_a", "quantity": 40, "capacity": 100},
            {"ref": "lot-9", "claimant": "buyer_b", "quantity": 40, "capacity": 100},
        ]
        self.assertEqual(detect_double_counting(claims), [])


if __name__ == "__main__":
    unittest.main()
