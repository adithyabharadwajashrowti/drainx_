"""Shared helpers for every DrainX laptop script."""
import os
from datetime import datetime, timezone

from dotenv import load_dotenv
from supabase import create_client

# .env lives next to this file (scripts/.env)
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None:
        raise SystemExit(f"Missing {name} in scripts/.env - copy .env.example to .env and fill it in.")
    return value


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def get_db():
    """Supabase client using the SERVICE ROLE key (laptop only - never put it in the dashboard)."""
    return create_client(env("SUPABASE_URL"), env("SUPABASE_SERVICE_KEY"))


def take_commands(db, target):
    """Fetch pending commands for one target (e.g. 'SS-01', 'SIM', 'BRAIN') and mark them done."""
    res = (db.table("commands").select("*")
           .eq("node_id", target).eq("status", "pending")
           .order("id").execute())
    cmds = res.data or []
    for c in cmds:
        db.table("commands").update({"status": "done", "sent_at": now_iso()}).eq("id", c["id"]).execute()
    return cmds


def raise_alert(db, kind, message, node_id=None):
    """Write an alert row. The dashboard shows it live and alerts.py pushes it to Telegram."""
    try:
        db.table("alerts").insert({"kind": kind, "message": message, "node_id": node_id}).execute()
        print(f"[ALERT] {message}")
    except Exception as e:  # never crash a script because an alert failed
        print("alert failed:", e)
