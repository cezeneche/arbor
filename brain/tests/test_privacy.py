"""Upgrade 10 — differential privacy (stdlib-only tests).

Noise is random, so we test the mechanism's *properties* (scale, clamping, floor,
unbiasedness) with a seeded RNG rather than exact outputs.
"""
import random
import unittest

from app.privacy import dp_count, dp_mean, laplace_scale, release


class TestLaplaceScale(unittest.TestCase):
    def test_scale_is_sensitivity_over_epsilon(self):
        self.assertAlmostEqual(laplace_scale(2.0, 0.5), 4.0)

    def test_smaller_epsilon_means_more_noise(self):
        self.assertGreater(laplace_scale(1.0, 0.1), laplace_scale(1.0, 1.0))

    def test_non_positive_epsilon_rejected(self):
        with self.assertRaises(ValueError):
            laplace_scale(1.0, 0.0)


class TestDpMean(unittest.TestCase):
    def test_clamps_outliers_to_public_bounds(self):
        # A wild outlier can't dominate: it's clamped to `high` before averaging.
        rng = random.Random(0)
        noisy = dp_mean([1.0, 1.0, 1_000_000.0], low=0.0, high=10.0, epsilon=1.0, rng=rng)
        # True clamped mean is (1+1+10)/3 = 4; noisy stays in a sane neighbourhood.
        self.assertLess(noisy, 100.0)

    def test_is_unbiased_in_expectation(self):
        values = [2.0, 4.0, 6.0, 8.0, 10.0]  # true mean 6
        samples = [dp_mean(values, 0.0, 20.0, 1.0, random.Random(s)) for s in range(4000)]
        self.assertAlmostEqual(sum(samples) / len(samples), 6.0, delta=0.3)

    def test_reproducible_with_seeded_rng(self):
        a = dp_mean([1.0, 2.0, 3.0], 0.0, 10.0, 1.0, random.Random(42))
        b = dp_mean([1.0, 2.0, 3.0], 0.0, 10.0, 1.0, random.Random(42))
        self.assertEqual(a, b)


class TestRelease(unittest.TestCase):
    def test_suppresses_below_the_floor(self):
        r = release([1.0, 2.0, 3.0], 0.0, 10.0, 1.0, min_n=10)
        self.assertTrue(r["suppressed"])
        self.assertEqual(r["n"], 3)
        self.assertNotIn("dp_mean", r)

    def test_releases_at_or_above_the_floor(self):
        values = [5.0] * 12
        r = release(values, 0.0, 10.0, 1.0, min_n=10, rng=random.Random(1))
        self.assertFalse(r["suppressed"])
        self.assertEqual(r["n"], 12)
        self.assertIn("dp_mean", r)
        self.assertEqual(r["bounds"], [0.0, 10.0])

    def test_dp_count_is_noisy_but_near_true(self):
        c = dp_count(100, 1.0, random.Random(7))
        self.assertGreater(c, 80)
        self.assertLess(c, 120)


if __name__ == "__main__":
    unittest.main()
