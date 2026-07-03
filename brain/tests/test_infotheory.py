"""Upgrade 2 — information theory primitives (stdlib-only tests).

Pinned to hand-computed values. These bits are the foundation for schema
inference (mutual information) and active-learning review ranking (entropy /
expected information gain).
"""
import unittest

from app.infotheory import binary_entropy, entropy, mutual_information


class TestEntropy(unittest.TestCase):
    def test_fair_coin_is_one_bit(self):
        self.assertAlmostEqual(entropy([0.5, 0.5]), 1.0)

    def test_four_equal_outcomes_is_two_bits(self):
        self.assertAlmostEqual(entropy([0.25, 0.25, 0.25, 0.25]), 2.0)

    def test_certain_outcome_is_zero(self):
        self.assertAlmostEqual(entropy([1.0, 0.0, 0.0]), 0.0)

    def test_accepts_unnormalised_counts(self):
        # Counts [2, 2] normalise to [0.5, 0.5] -> 1 bit.
        self.assertAlmostEqual(entropy([2, 2]), 1.0)

    def test_empty_distribution_is_zero(self):
        self.assertEqual(entropy([]), 0.0)


class TestBinaryEntropy(unittest.TestCase):
    def test_half_is_one_bit(self):
        self.assertAlmostEqual(binary_entropy(0.5), 1.0)

    def test_certainty_is_zero(self):
        self.assertEqual(binary_entropy(0.0), 0.0)
        self.assertEqual(binary_entropy(1.0), 0.0)

    def test_known_value(self):
        # H(0.11) = -0.11 log2 0.11 - 0.89 log2 0.89 ≈ 0.49992
        self.assertAlmostEqual(binary_entropy(0.11), 0.49992, places=4)

    def test_symmetry(self):
        self.assertAlmostEqual(binary_entropy(0.3), binary_entropy(0.7))


class TestMutualInformation(unittest.TestCase):
    def test_independent_variables_have_zero_mi(self):
        # Product distribution: rows/cols independent.
        joint = [[0.25, 0.25], [0.25, 0.25]]
        self.assertAlmostEqual(mutual_information(joint), 0.0)

    def test_perfectly_correlated_mi_equals_entropy(self):
        # X determines Y (diagonal). I(X;Y) = H(X) = 1 bit.
        joint = [[0.5, 0.0], [0.0, 0.5]]
        self.assertAlmostEqual(mutual_information(joint), 1.0)

    def test_empty_or_zero_joint_is_zero(self):
        self.assertEqual(mutual_information([]), 0.0)
        self.assertEqual(mutual_information([[0.0, 0.0]]), 0.0)

    def test_mi_is_non_negative(self):
        joint = [[0.4, 0.1], [0.2, 0.3]]
        self.assertGreaterEqual(mutual_information(joint), 0.0)

    def test_accepts_unnormalised_counts(self):
        # Counts on the diagonal -> perfect correlation -> 1 bit.
        self.assertAlmostEqual(mutual_information([[5, 0], [0, 5]]), 1.0)


if __name__ == "__main__":
    unittest.main()
