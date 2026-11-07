"""Tell the ops Slack channel a nightly database backup failed.

Run by .github/workflows/backup.yml when a backup job fails. Rendered in the
shared alert format (contract/alerts) by Nucleos's formatter, which needs only
the standard library. Never fails the job itself: the run is already red.

Environment: KIND (arbor | nucleos), RUN_URL, OPS_SLACK_WEBHOOK_URL.
BACKUP_ALERT_DRY_RUN=1 prints the Slack payload instead of sending it.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "nucleos" / "api" / "ledger_app" / "services"))
from alert_format import Alert, render_slack  # noqa: E402

NAMES = {"arbor": "Arbor", "nucleos": "Nucleos"}


def main() -> None:
    kind = os.getenv("KIND", "unknown")
    name = NAMES.get(kind, kind)
    run_url = os.getenv("RUN_URL", "")
    alert = Alert(
        severity="critical",
        source="Backups",
        environment="production",
        title=f"{name} database backup failed",
        summary=(
            f"Last night's backup of the {name} database did not finish, so there is "
            "no new copy outside Supabase. The previous backups are untouched. "
            "The run log says which step failed: the dump, the restore drill, "
            "encryption or the upload."
        ),
        at=datetime.now(timezone.utc),
        facts=[("Database", name)],
        action="Open the run, fix the cause, then re-run the workflow.",
        link=("Open the run", run_url) if run_url else None,
    )
    payload = render_slack(alert)

    if os.getenv("BACKUP_ALERT_DRY_RUN") == "1":
        print(json.dumps(payload))
        return
    webhook = os.getenv("OPS_SLACK_WEBHOOK_URL")
    if not webhook:
        print("OPS_SLACK_WEBHOOK_URL is not set; nothing sent.")
        return
    request = urllib.request.Request(
        webhook, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}
    )
    try:
        urllib.request.urlopen(request, timeout=15)
    except Exception as exc:  # the job is already failing; say so and stop
        print(f"Could not post to Slack: {exc}")


if __name__ == "__main__":
    main()
