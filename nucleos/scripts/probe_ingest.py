"""Drive documents through Nucleos ingestion and report what comes back.

Not a test: a sweep for inputs that produce a wrong value, a crash, or a
confident silence. Each case says what a reader would expect.
"""
import sys, traceback
sys.path[:0] = ['.', 'api']
from ledger_app.services.text_ingest import run_text_ingest

CASES = {
 "empty document": "",
 "whitespace only": "   \n\n\t  \n",
 "one word": "Invoice",
 "no numbers at all": "IMPORT DECLARATION\nCommodity code pending\nNet mass to follow\n",
 "huge number": "IMPORT DECLARATION\nCommodity code 72083900\nNet mass 999999999999999 kg\nCountry of origin TR\n",
 "negative mass": "IMPORT DECLARATION\nCommodity code 72083900\nNet mass -24500 kg\nCountry of origin TR\n",
 "zero mass": "IMPORT DECLARATION\nCommodity code 72083900\nNet mass 0 kg\nCountry of origin TR\n",
 "mass in tonnes": "IMPORT DECLARATION\nCommodity code 72083900\nNet mass 24.5 t\nCountry of origin TR\n",
 "6-digit HS code": "IMPORT DECLARATION\nCommodity code 720839\nNet mass 24500 kg\nCountry of origin TR\n",
 "two codes one mass": "IMPORT DECLARATION\nCommodity code 72083900\nCommodity code 72131000\nNet mass 24500 kg\n",
 "repeated fields": "IMPORT DECLARATION\nImporter EORI GB247188003000\nImporter EORI GB999999999999\nCommodity code 72083900\nNet mass 1 kg\n",
 "unicode punctuation": "IMPORT DECLARATION Commodity code 72083900 Net mass 24 500 kg\n",
 "rtl text": "IMPORT DECLARATION\nكود السلعة 72083900\nالوزن الصافي 24500 kg\n",
 "csv-shaped": "cn_code,net_mass_kg,origin\n72083900,24500,TR\n72131000,8200,TR\n",
 "xml-shaped": "<declaration><cn_code>72083900</cn_code><net_mass_kg>24500</net_mass_kg></declaration>",
 "html injection": "IMPORT DECLARATION\n<script>alert(1)</script>\nCommodity code 72083900\nNet mass 24500 kg\n",
 "sql-ish": "IMPORT DECLARATION\nImporter'; DROP TABLE cbam_cases;--\nCommodity code 72083900\nNet mass 24500 kg\n",
 "very long line": "IMPORT DECLARATION\nCommodity code 72083900\nDescription " + ("steel " * 5000) + "\nNet mass 24500 kg\n",
 "many goods lines": "IMPORT DECLARATION\n" + "".join(f"Commodity code 7208{i:04d}\nNet mass {i} kg\n" for i in range(200)),
 "null bytes": "IMPORT DECLARATION\x00\nCommodity code 72083900\nNet mass 24500 kg\n",
}

for name, text in CASES.items():
    try:
        out = run_text_ingest(text)
        c = out["candidate"]
        lines = c.get("lines") or []
        first = lines[0] if lines else {}
        print(f"{name:22} | lines={len(lines):3} | cn={str(first.get('cn_code'))[:10]:10} "
              f"| kg={str(first.get('net_mass_kg'))[:16]:16} | eori={str((c.get('importer') or {}).get('eori'))[:16]}")
    except Exception as exc:
        print(f"{name:22} | RAISED {type(exc).__name__}: {str(exc)[:70]}")
