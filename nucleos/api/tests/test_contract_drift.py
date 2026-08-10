"""The generated contract types match the schemas, and the schemas match the digest.

The JSON Schema files are the neutral source and both repos vendor them. Nothing
stops someone editing the generated Pydantic by hand, or editing the schemas and
forgetting to regenerate — except this.

What it can and cannot prove
----------------------------
It proves this repo's generated models match this repo's schemas, and that those
schemas hash to the committed digest. It cannot reach into Arbor. The digest is
what makes divergence visible: changing a schema changes the digest, and a
digest that differs between the two repos shows up as a conflict in review
rather than as a runtime type error months later.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
GENERATOR = REPO_ROOT / "contract" / "generate.py"
GENERATED_PY = REPO_ROOT / "api" / "ledger_app" / "contract" / "models.py"
DIGEST_FILE = REPO_ROOT / "contract" / "DIGEST"


def _run(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(GENERATOR), *args],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )


def test_generated_python_matches_the_schemas():
    result = _run("--check", "--python", str(GENERATED_PY))
    assert result.returncode == 0, (
        "Generated contract models have drifted from the schemas.\n"
        f"{result.stdout}{result.stderr}\n"
        "Regenerate: python contract/generate.py --python api/ledger_app/contract/models.py"
    )


def test_schema_digest_matches_the_committed_value():
    result = _run("--digest")
    assert result.returncode == 0, result.stderr
    current = result.stdout.strip()
    committed = DIGEST_FILE.read_text(encoding="utf-8").strip()
    assert current == committed, (
        "The contract schemas changed but contract/DIGEST was not updated.\n"
        f"  committed: {committed}\n"
        f"  current:   {current}\n"
        "Update the digest in BOTH repos, and re-vendor the schemas into Arbor:\n"
        "  python contract/generate.py --digest > contract/DIGEST"
    )


def test_the_contract_models_import_and_enforce_their_shape():
    from ledger_app.contract import models

    request = models.CbamExtractionRequest(
        document_id="doc-1",
        document_type="COMMERCIAL_INVOICE",
        entity_id="ent-1",
        text="…",
        jurisdiction=models.Jurisdiction.EU,
    )
    assert request.document_id == "doc-1"

    with pytest.raises(Exception):
        models.CbamExtractionRequest(
            document_id="doc-1",
            document_type="COMMERCIAL_INVOICE",
            entity_id="ent-1",
            text="…",
            jurisdiction=models.Jurisdiction.EU,
            blob_url="https://example.invalid/doc.pdf",
        )


def test_the_two_axes_stay_separate():
    """A single enum covering both axes would satisfy a type checker and lose the
    distinction the whole contract exists to preserve."""
    from ledger_app.contract import models

    assert [m.value for m in models.EmissionsMethod] == ["ACTUAL", "ESTIMATED", "DEFAULT"]
    assert [t.value for t in models.ProvenanceTier] == ["VERIFIED", "DECLARED", "ESTIMATED"]
    assert models.EmissionsMethod is not models.ProvenanceTier

    line_fields = models.CalculatedLine.model_fields
    assert "emissions_method" in line_fields
    assert "provenance_tier" in line_fields


def test_no_payload_can_carry_a_document_blob():
    """Document blobs stop crossing the boundary in Phase 2. A schema that
    accepts a blob reference is how that quietly comes back."""
    import json

    banned = ("blob", "bytes", "content_base64", "file_url", "storage_uri", "download")
    for path in (REPO_ROOT / "contract" / "schemas").glob("*.json"):
        text = json.dumps(json.loads(path.read_text(encoding="utf-8")))
        properties_only = text.lower()
        for term in banned:
            assert f'"{term}' not in properties_only, (
                f"{path.name} declares a field containing {term!r}. "
                "Document blobs must not cross the Arbor/Nucleos boundary."
            )
