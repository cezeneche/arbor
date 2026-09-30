-- A relief claim no longer has to name a CBAM liability to cap against.
--
-- The cap used to be applied when the claim was made, against a liability the
-- caller supplied. Arbor could only supply the case's estimated liability — the
-- wrong figure for one goods line, and none at all when the rate is not yet
-- published, which capped the relief at £0 and lost it. The HMRC return now
-- caps each line's relief at that line's own charge, where the charge is known,
-- so a claim may be stored uncapped. Existing claims keep their cap reference.
ALTER TABLE cbam.cbam_cpr_claims ALTER COLUMN cbam_liability_gbp DROP NOT NULL;

COMMENT ON COLUMN cbam.cbam_cpr_claims.cbam_liability_gbp IS
    'The liability the claim was capped against when it was made, or NULL when it '
    'was stored uncapped. The HMRC return caps relief at each goods line''s charge.';
