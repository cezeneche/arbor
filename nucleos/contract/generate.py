"""Generate Pydantic and TypeScript types from the contract schemas.

The JSON Schema files under contract/schemas are the neutral source. Both repos
vendor them and generate from them, so neither language's types can drift from
the other without the drift check failing.

Usage
-----
    python contract/generate.py --python api/ledger_app/contract/models.py
    python contract/generate.py --typescript ../arbor/src/lib/nucleos/contract.ts
    python contract/generate.py --check      # verify the checked-in output matches

This handles the subset of JSON Schema the contract uses: objects with fixed
properties, arrays, enums, primitives, nullable unions, local $defs and
cross-file $ref into common.json. It deliberately does not attempt general
JSON Schema support — a generator that silently mishandles a construct is worse
than one that refuses it, so anything unrecognised raises.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any

SCHEMA_DIR = Path(__file__).parent / "schemas"

# Emitted at the top of every generated file.
BANNER_LINES = [
    "Generated from contract/schemas. Do not edit by hand.",
    "",
    "Regenerate with:  python contract/generate.py --python <out> --typescript <out>",
    "Verify with:      python contract/generate.py --check",
]

_PRIMITIVES_PY = {
    "string": "str",
    "integer": "int",
    "number": "float",
    "boolean": "bool",
}
_PRIMITIVES_TS = {
    "string": "string",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
}


class UnsupportedSchema(RuntimeError):
    """Raised rather than guessing at a construct the generator does not handle."""


def load_schemas() -> dict[str, dict[str, Any]]:
    return {
        path.name: json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(SCHEMA_DIR.glob("*.json"))
    }


def _title_from_ref(ref: str) -> str:
    # "common.json#/$defs/EmissionsMethod" -> "EmissionsMethod"
    # "#/$defs/CalculatedLine"             -> "CalculatedLine"
    return ref.rsplit("/", 1)[-1]


def _is_nullable(node: dict[str, Any]) -> bool:
    t = node.get("type")
    if isinstance(t, list):
        return "null" in t
    if "oneOf" in node:
        return any(sub.get("type") == "null" for sub in node["oneOf"])
    return False


def _non_null_type(node: dict[str, Any]) -> Any:
    t = node.get("type")
    if isinstance(t, list):
        remaining = [x for x in t if x != "null"]
        if len(remaining) != 1:
            raise UnsupportedSchema(f"expected one non-null type, got {t!r}")
        return remaining[0]
    return t


def _render(node: dict[str, Any], lang: str) -> str:
    """Render one schema node as a type expression."""
    if "$ref" in node:
        return _title_from_ref(node["$ref"])

    if "oneOf" in node:
        parts = [sub for sub in node["oneOf"] if sub.get("type") != "null"]
        if len(parts) != 1:
            raise UnsupportedSchema("oneOf must hold exactly one non-null branch")
        inner = _render(parts[0], lang)
        return f"{inner} | None" if lang == "py" else f"{inner} | null"

    if "enum" in node:
        raise UnsupportedSchema("inline enums must be named in $defs")

    base = _non_null_type(node)

    if base is None:
        # No type at all — an intentionally open value (EvidenceAtom.value).
        rendered = "Any" if lang == "py" else "unknown"
    elif base == "array":
        items = node.get("items")
        if not items:
            raise UnsupportedSchema("array without items")
        inner = _render(items, lang)
        rendered = f"list[{inner}]" if lang == "py" else f"{inner}[]"
    elif base == "object":
        if "properties" in node:
            raise UnsupportedSchema("inline objects must be named in $defs")
        rendered = "dict[str, Any]" if lang == "py" else "Record<string, unknown>"
    else:
        table = _PRIMITIVES_PY if lang == "py" else _PRIMITIVES_TS
        if base not in table:
            raise UnsupportedSchema(f"unknown primitive {base!r}")
        rendered = table[base]

    if _is_nullable(node):
        rendered = f"{rendered} | None" if lang == "py" else f"{rendered} | null"
    return rendered


def _doc(node: dict[str, Any]) -> str | None:
    return node.get("description")


# JSON Schema keyword -> Pydantic Field argument.
#
# Without these the generated models accept values the schema forbids: a
# declaration with zero goods lines, a negative mass. A contract that states a
# rule it does not enforce is worse than one that stays quiet, because a reader
# trusts it. TypeScript cannot express these in the type system, so the
# asymmetry is deliberate and documented in contract/README.md — the Python side
# is where the boundary is actually validated, and it is the side that receives.
_CONSTRAINTS: dict[str, str] = {
    "minLength": "min_length",
    "maxLength": "max_length",
    "minItems": "min_length",
    "maxItems": "max_length",
    "minimum": "ge",
    "maximum": "le",
    "exclusiveMinimum": "gt",
    "exclusiveMaximum": "lt",
}


def _field_constraints(node: dict[str, Any]) -> list[str]:
    """Pydantic Field arguments for the constraints this node declares."""
    args: list[str] = []
    for keyword, argument in _CONSTRAINTS.items():
        if keyword in node:
            args.append(f"{argument}={node[keyword]!r}")
    return args


def _collect_models(schemas: dict[str, dict[str, Any]]) -> list[tuple[str, dict[str, Any]]]:
    """Return (name, node) for every named model, deepest dependency first.

    Ordering matters for Python: a Pydantic model referenced by another must be
    defined first, and the contract has no cycles.
    """
    models: list[tuple[str, dict[str, Any]]] = []
    seen: set[str] = set()

    def add(name: str, node: dict[str, Any]) -> None:
        if name in seen:
            return
        seen.add(name)
        models.append((name, node))

    # common.json first — everything else refs into it.
    ordered = ["common.json"] + [n for n in schemas if n != "common.json"]
    for filename in ordered:
        schema = schemas[filename]
        for def_name, def_node in (schema.get("$defs") or {}).items():
            add(def_node.get("title", def_name), def_node)
        if schema.get("type") == "object" and "properties" in schema:
            add(schema["title"], schema)
    return models


def _sort_by_dependency(models: list[tuple[str, dict[str, Any]]]) -> list[tuple[str, dict[str, Any]]]:
    by_name = {name: node for name, node in models}
    emitted: list[tuple[str, dict[str, Any]]] = []
    done: set[str] = set()

    def refs_of(node: Any) -> set[str]:
        found: set[str] = set()
        if isinstance(node, dict):
            if "$ref" in node:
                found.add(_title_from_ref(node["$ref"]))
            for k, v in node.items():
                if k == "$defs":
                    continue
                found |= refs_of(v)
        elif isinstance(node, list):
            for v in node:
                found |= refs_of(v)
        return found

    def visit(name: str, stack: tuple[str, ...] = ()) -> None:
        if name in done or name not in by_name:
            return
        if name in stack:
            raise UnsupportedSchema(f"reference cycle through {name!r}")
        node = by_name[name]
        for dep in sorted(refs_of({k: v for k, v in node.items() if k != "$defs"})):
            visit(dep, stack + (name,))
        done.add(name)
        emitted.append((name, node))

    for name, _ in models:
        visit(name)
    return emitted


def _comment_block(text: str, prefix: str, indent: str = "") -> list[str]:
    return [f"{indent}{prefix} {line}".rstrip() for line in text.split("\n")]


def render_python(schemas: dict[str, dict[str, Any]]) -> str:
    models = _sort_by_dependency(_collect_models(schemas))
    out: list[str] = ['"""']
    out += BANNER_LINES
    out += ['"""', "from __future__ import annotations", "", "from typing import Any", "",
            "from pydantic import BaseModel, ConfigDict, Field", "", ""]

    for name, node in models:
        if "enum" in node:
            doc = _doc(node)
            out.append(f"class {name}(str, Enum):")
            if doc:
                out.append('    """')
                out += _comment_block(doc, "", "    ")
                out.append('    """')
            for value in node["enum"]:
                out.append(f'    {value} = "{value}"')
            out += ["", ""]
            continue

        out.append(f"class {name}(BaseModel):")
        doc = _doc(node)
        if doc:
            out.append('    """')
            out += _comment_block(doc, "", "    ")
            out.append('    """')
        out.append("")
        out.append("    model_config = ConfigDict(extra='forbid')")
        out.append("")

        required = set(node.get("required") or [])
        props: dict[str, Any] = node.get("properties") or {}
        if not props:
            out.append("    pass")
        for prop, prop_node in props.items():
            type_expr = _render(prop_node, "py")
            prop_doc = _doc(prop_node)
            constraints = _field_constraints(prop_node)
            if prop in required:
                default = f" = Field(..., {', '.join(constraints)})" if constraints else ""
            elif _is_nullable(prop_node) or "null" in str(prop_node.get("type", "")):
                default = (
                    f" = Field(None, {', '.join(constraints)})" if constraints else " = None"
                )
            elif _non_null_type(prop_node) == "array":
                args = ", ".join(["default_factory=list", *constraints])
                default = f" = Field({args})"
            else:
                default = (
                    f" = Field(None, {', '.join(constraints)})" if constraints else " = None"
                )
                if "| None" not in type_expr:
                    type_expr = f"{type_expr} | None"
            if prop_doc:
                out += _comment_block(prop_doc, "#", "    ")
            out.append(f"    {prop}: {type_expr}{default}")
        out += ["", ""]

    text = "\n".join(out).rstrip() + "\n"
    if "Enum" in text:
        text = text.replace(
            "from typing import Any", "from enum import Enum\nfrom typing import Any", 1
        )
    return text


def render_typescript(schemas: dict[str, dict[str, Any]]) -> str:
    models = _sort_by_dependency(_collect_models(schemas))
    out: list[str] = ["/**"]
    out += [f" * {line}".rstrip() for line in BANNER_LINES]
    out += [" */", ""]

    for name, node in models:
        doc = _doc(node)
        if doc:
            out.append("/**")
            out += [f" * {line}".rstrip() for line in doc.split("\n")]
            out.append(" */")
        if "enum" in node:
            union = " | ".join(f"'{v}'" for v in node["enum"])
            out += [f"export type {name} = {union}", ""]
            continue

        out.append(f"export interface {name} {{")
        required = set(node.get("required") or [])
        for prop, prop_node in (node.get("properties") or {}).items():
            prop_doc = _doc(prop_node)
            if prop_doc:
                out.append("  /**")
                out += [f"   * {line}".rstrip() for line in prop_doc.split("\n")]
                out.append("   */")
            optional = "" if prop in required else "?"
            out.append(f"  {prop}{optional}: {_render(prop_node, 'ts')}")
        out += ["}", ""]

    return "\n".join(out).rstrip() + "\n"


def schema_digest(schemas: dict[str, dict[str, Any]]) -> str:
    import hashlib

    canonical = json.dumps(schemas, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--python", type=Path)
    ap.add_argument("--typescript", type=Path)
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--digest", action="store_true")
    args = ap.parse_args()

    schemas = load_schemas()

    if args.digest:
        print(schema_digest(schemas))
        return 0

    targets: list[tuple[Path, str]] = []
    if args.python:
        targets.append((args.python, render_python(schemas)))
    if args.typescript:
        targets.append((args.typescript, render_typescript(schemas)))

    if not targets:
        ap.error("nothing to do: pass --python, --typescript, --check or --digest")

    failed = False
    for path, content in targets:
        if args.check:
            current = path.read_text(encoding="utf-8") if path.exists() else ""
            if current != content:
                print(f"DRIFT: {path} does not match the schemas", file=sys.stderr)
                failed = True
            else:
                print(f"ok: {path}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
            print(f"wrote {path}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
