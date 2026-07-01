"""Upgrade 1 — calibration measurement (stdlib-only tests, no external deps).

The brain turns a stream of ground-truth labels — (model confidence at
extraction, whether the extracted value was correct) — into an empirically
calibrated map plus the headline honesty metrics: Brier score, Expected
Calibration Error, and a reliability diagram. These tests pin the maths to
hand-computed values so the calibration claim is auditable, not asserted.
"""
import math
import unittest

from app.calibration import (
    Sample,
    brier_score,
    expected_calibration_error,
    reliability_bins,
    pav_isotonic,
    fit_isotonic,
    apply_calibration,
    fit_calibration,
)


class TestBrier(unittest.TestCase):
    def test_hand_computed_brier(self):
        # ((0.9-1)^2 + (0.8-0)^2 + (0.1-0)^2) / 3 = (0.01 + 0.64 + 0.01)/3
        samples = [Sample(0.9, True), Sample(0.8, False), Sample(0.1, False)]
        self.assertAlmostEqual(brier_score(samples), 0.22, places=10)

    def test_perfect_predictions_score_zero(self):
        samples = [Sample(1.0, True), Sample(0.0, False)]
        self.assertEqual(brier_score(samples), 0.0)


class TestECE(unittest.TestCase):
    def test_hand_computed_ece_two_bins(self):
        # bin0 [<0.5]: scores 0.2,0.4 -> conf 0.3, acc 0.5, gap 0.2, n2
        # bin1 [>=0.5]: scores 0.6,0.9 -> conf 0.75, acc 0.5, gap 0.25, n2
        # ECE = (2/4)*0.2 + (2/4)*0.25 = 0.225
        samples = [
            Sample(0.2, False), Sample(0.4, True),
            Sample(0.6, False), Sample(0.9, True),
        ]
        self.assertAlmostEqual(expected_calibration_error(samples, bins=2), 0.225, places=10)

    def test_perfectly_calibrated_has_low_ece(self):
        # 100 samples at p=0.5 with exactly half correct -> gap ~0.
        samples = [Sample(0.5, i % 2 == 0) for i in range(100)]
        self.assertAlmostEqual(expected_calibration_error(samples, bins=10), 0.0, places=10)


class TestReliability(unittest.TestCase):
    def test_returns_one_row_per_nonempty_bin(self):
        samples = [Sample(0.2, False), Sample(0.4, True), Sample(0.9, True)]
        rows = reliability_bins(samples, bins=10)
        # scores land in bins 2, 4 and 9 -> 3 non-empty bins.
        self.assertEqual(len(rows), 3)
        first = rows[0]
        self.assertEqual(first["count"], 1)
        self.assertAlmostEqual(first["mean_predicted"], 0.2, places=10)
        self.assertAlmostEqual(first["empirical_accuracy"], 0.0, places=10)


class TestIsotonicPAV(unittest.TestCase):
    def test_pool_adjacent_violators_known_case(self):
        # y = [1, 0, 1, 1] -> PAV pools the 1,0 violation to 0.5 each.
        fitted = pav_isotonic([1.0, 0.0, 1.0, 1.0])
        self.assertEqual(fitted, [0.5, 0.5, 1.0, 1.0])

    def test_fitted_output_is_non_decreasing(self):
        fitted = pav_isotonic([0.0, 1.0, 0.0, 1.0, 0.0, 1.0])
        for a, b in zip(fitted, fitted[1:]):
            self.assertLessEqual(a, b)

    def test_fit_and_apply_interpolates_and_clips(self):
        # Monotone-miscalibrated: low scores mostly wrong, high scores mostly right.
        samples = [
            Sample(0.1, False), Sample(0.2, False),
            Sample(0.6, False), Sample(0.7, True),
            Sample(0.9, True), Sample(0.95, True),
        ]
        cal = fit_isotonic(samples)
        # Calibrated map is monotone non-decreasing across its knots.
        ys = cal["y"]
        for a, b in zip(ys, ys[1:]):
            self.assertLessEqual(a, b)
        # Applying is clipped to [0,1] and monotone.
        self.assertGreaterEqual(apply_calibration(cal, 0.0), 0.0)
        self.assertLessEqual(apply_calibration(cal, 1.0), 1.0)
        self.assertLessEqual(apply_calibration(cal, 0.1), apply_calibration(cal, 0.95))


class TestFitCalibration(unittest.TestCase):
    def test_returns_metrics_and_map(self):
        samples = [Sample(0.9, True), Sample(0.8, False), Sample(0.1, False)]
        result = fit_calibration(samples, bins=10)
        self.assertEqual(result["n"], 3)
        self.assertIn("brier", result)
        self.assertIn("ece", result)
        self.assertIn("reliability", result)
        self.assertEqual(result["calibration_map"]["method"], "isotonic")
        self.assertTrue(len(result["calibration_map"]["x"]) >= 1)

    def test_empty_sample_set_is_handled(self):
        result = fit_calibration([], bins=10)
        self.assertEqual(result["n"], 0)
        self.assertTrue(math.isnan(result["brier"]) or result["brier"] is None)


if __name__ == "__main__":
    unittest.main()
