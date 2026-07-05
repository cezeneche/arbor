"""Upgrade 3 — algebraic constraints + MaxEnt completion (stdlib-only tests)."""
import unittest

from app.constraints import check_record, complete_missing


class TestCheckRecord(unittest.TestCase):
    def test_clean_record_has_no_violations(self):
        # 100 t × 2.0 tCO2e/t = 200 tCO2e — balances, plausible for steel.
        fields = {"quantity_tonnes": 100, "embedded_emissions_tco2e": 200, "embedded_emissions_per_tonne": 2.0}
        self.assertEqual(check_record(fields, "steel"), [])

    def test_negative_quantity_is_critical(self):
        v = check_record({"quantity_tonnes": -5}, "steel")
        self.assertEqual(v[0]["type"], "NON_NEGATIVITY")
        self.assertEqual(v[0]["severity"], "CRITICAL")

    def test_emissions_that_do_not_balance_are_flagged(self):
        # 100 × 2 = 200, but declared 500.
        fields = {"quantity_tonnes": 100, "embedded_emissions_tco2e": 500, "embedded_emissions_per_tonne": 2.0}
        types = [x["type"] for x in check_record(fields, "steel")]
        self.assertIn("MASS_BALANCE", types)

    def test_implausible_intensity_for_sector_is_critical(self):
        # 50 tCO2e/t is wildly high for cement (range 0.4–1.2).
        v = check_record({"embedded_emissions_per_tonne": 50}, "cement")
        self.assertTrue(any(x["type"] == "IMPLAUSIBLE_INTENSITY" and x["severity"] == "CRITICAL" for x in v))

    def test_intensity_within_range_passes(self):
        self.assertEqual(check_record({"embedded_emissions_per_tonne": 0.8}, "cement"), [])

    def test_percentage_out_of_bounds(self):
        v = check_record({"nitrogen_content_percent": 140}, None)
        self.assertEqual(v[0]["type"], "PERCENT_BOUND")

    def test_unknown_sector_skips_intensity_bound(self):
        # No sector range known -> intensity not bounded, only balance/sign checked.
        self.assertEqual(check_record({"embedded_emissions_per_tonne": 999}, "widgets"), [])


class TestCompleteMissing(unittest.TestCase):
    def test_missing_total_is_determined_by_balance(self):
        [c] = complete_missing({"quantity_tonnes": 100, "embedded_emissions_per_tonne": 2.0}, "steel")
        self.assertEqual(c["field"], "embedded_emissions_tco2e")
        self.assertEqual(c["value"], 200)
        self.assertTrue(c["determined"])
        self.assertEqual(c["entropy_bits"], 0.0)

    def test_missing_intensity_is_determined_by_balance(self):
        [c] = complete_missing({"quantity_tonnes": 100, "embedded_emissions_tco2e": 250}, "steel")
        self.assertEqual(c["field"], "embedded_emissions_per_tonne")
        self.assertEqual(c["value"], 2.5)
        self.assertTrue(c["determined"])

    def test_bounded_but_undetermined_intensity_is_maxent_uniform(self):
        # Only the sector is known -> uniform over the plausible range.
        [c] = complete_missing({}, "cement")
        self.assertEqual(c["field"], "embedded_emissions_per_tonne")
        self.assertAlmostEqual(c["value"], 0.8)  # midpoint of (0.4, 1.2)
        self.assertFalse(c["determined"])
        self.assertGreater(c["entropy_bits"], -10)  # log2(0.8), a real number

    def test_nothing_to_complete_when_all_present(self):
        fields = {"quantity_tonnes": 100, "embedded_emissions_tco2e": 200, "embedded_emissions_per_tonne": 2.0}
        self.assertEqual(complete_missing(fields, "steel"), [])


if __name__ == "__main__":
    unittest.main()
