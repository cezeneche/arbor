"""A comparable fingerprint for a value that is stored encrypted.

cbam_cases is meant to hold one case per importer per period, and said so with
a UNIQUE constraint on the encrypted importer_eori. Fernet is randomised, so
the same EORI encrypts differently every time and the constraint could never
fire — which is how a timed-out case creation could be retried into a second
case for the same import.

The fingerprint is deterministic so equality works, and keyed so it does not
give the EORI back.
"""

from __future__ import annotations

import pytest

from ledger_app.core.crypto import encrypt_field, field_fingerprint


def test_the_same_value_always_fingerprints_the_same():
    assert field_fingerprint("GB247188003000") == field_fingerprint("GB247188003000")


def test_encryption_does_not_have_that_property():
    # The reason the constraint was inert, pinned here so it cannot be
    # mistaken for a comparable value again.
    assert encrypt_field("GB247188003000") != encrypt_field("GB247188003000")


def test_different_values_fingerprint_differently():
    assert field_fingerprint("GB247188003000") != field_fingerprint("GB247188003001")


def test_the_fingerprint_does_not_contain_the_value():
    assert "247188003000" not in field_fingerprint("GB247188003000")


def test_nothing_fingerprints_to_nothing():
    assert field_fingerprint(None) is None
    assert field_fingerprint("") is None


@pytest.mark.parametrize("value", ["gb247188003000", " GB247188003000 "])
def test_case_and_surrounding_space_do_not_make_a_different_importer(value):
    # A form prints an EORI lower-case or padded; it is the same importer, and
    # a second case for the same period would be double counting.
    assert field_fingerprint(value) == field_fingerprint("GB247188003000")
