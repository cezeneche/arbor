"""Upgrade 1 — Bayesian fusion of self-consistency samples (stdlib-only tests).

Layer 1 extracts each document k times at temperature > 0. Per field, agreement
across the k samples is the honest confidence signal: unanimous agreement is
strong evidence the model is certain; disagreement is evidence it is guessing.
We fuse the agreement into a beta-binomial posterior (conjugate prior per
document class), so even unanimous agreement never reports a naive 1.0 — the
Laplace/prior smoothing keeps it numerically honest, which is the whole point.
"""
import unittest

from app.fusion import fuse_field, normalise_key


class TestNormaliseKey(unittest.TestCase):
    def test_whitespace_and_case_insensitive(self):
        self.assertEqual(normalise_key('  Acme  Steel '), normalise_key('acme steel'))

    def test_numeric_equivalence_including_thousands_separators(self):
        self.assertEqual(normalise_key('48,250'), normalise_key('48250'))
        self.assertEqual(normalise_key('24500 kg'), normalise_key('24500'))

    def test_none_and_empty_collapse_to_the_same_key(self):
        self.assertEqual(normalise_key(None), normalise_key(''))
        self.assertEqual(normalise_key(None), normalise_key('   '))

    def test_genuinely_different_values_differ(self):
        self.assertNotEqual(normalise_key('100'), normalise_key('200'))


class TestFuseField(unittest.TestCase):
    def test_unanimous_agreement_is_high_but_not_naive_one(self):
        # 3/3 agree. With Beta(1,1): mean = (1+3)/(1+1+3) = 0.8 — honest, not 1.0.
        r = fuse_field(['48250', '48,250', '48250'])
        self.assertEqual(r['agreement'], 3)
        self.assertEqual(r['k'], 3)
        self.assertAlmostEqual(r['posterior_mean'], 0.8, places=10)
        # Consensus is a representative raw value from the modal group.
        self.assertIn(r['consensus'], {'48250', '48,250'})

    def test_split_vote_lowers_confidence(self):
        # 2/3 agree -> mean = (1+2)/(1+1+3) = 0.6
        r = fuse_field(['100', '100', '250'])
        self.assertEqual(r['agreement'], 2)
        self.assertAlmostEqual(r['posterior_mean'], 0.6, places=10)
        self.assertEqual(normalise_key(r['consensus']), normalise_key('100'))

    def test_total_disagreement_is_low(self):
        # 1/3 modal -> mean = (1+1)/(1+1+3) = 0.4
        r = fuse_field(['a', 'b', 'c'])
        self.assertEqual(r['agreement'], 1)
        self.assertAlmostEqual(r['posterior_mean'], 0.4, places=10)

    def test_null_can_be_the_consensus(self):
        r = fuse_field([None, None, 'x'])
        self.assertEqual(r['agreement'], 2)
        self.assertIsNone(r['consensus'])

    def test_credible_interval_brackets_the_mean_and_is_clipped(self):
        r = fuse_field(['x', 'x', 'x'])
        self.assertLessEqual(r['ci_low'], r['posterior_mean'])
        self.assertGreaterEqual(r['ci_high'], r['posterior_mean'])
        self.assertGreaterEqual(r['ci_low'], 0.0)
        self.assertLessEqual(r['ci_high'], 1.0)

    def test_document_class_prior_shifts_the_posterior(self):
        # A stronger prior toward correctness raises unanimous-agreement confidence.
        weak = fuse_field(['x', 'x', 'x'], prior_alpha=1.0, prior_beta=1.0)
        strong = fuse_field(['x', 'x', 'x'], prior_alpha=8.0, prior_beta=2.0)
        self.assertGreater(strong['posterior_mean'], weak['posterior_mean'])

    def test_empty_sample_set_returns_prior_mean(self):
        r = fuse_field([], prior_alpha=1.0, prior_beta=1.0)
        self.assertEqual(r['k'], 0)
        self.assertAlmostEqual(r['posterior_mean'], 0.5, places=10)


if __name__ == '__main__':
    unittest.main()
