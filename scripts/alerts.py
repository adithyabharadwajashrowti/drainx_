"""
DrainX alerts -> Telegram
  * anyone who opens the bot and presses START gets subscribed (judges scan a QR code)
  * every new row in `alerts` is pushed to all subscribers instantly
Run:  python alerts.py
"""
import time

import requests

from common import env, get_db

TOKEN = env("TELEGRAM_BOT_TOKEN")
API = f"https://api.telegram.org/bot{TOKEN}"
ICONS = {"flood_forecast": "🌧️", "quality": "🧪", "gate": "🚰", "pit": "🟦", "pothole": "🕳️"}


def tg(method, **params):
    return requests.post(f"{API}/{method}", json=params, timeout=30).json()


def main():
    db = get_db()
    last = db.table("alerts").select("id").order("id", desc=True).limit(1).execute().data
    last_alert_id = last[0]["id"] if last else 0
    offset = 0
    print("Alert bot running. Open your bot in Telegram and press START to test.")

    while True:
        # 1. new subscribers
        try:
            updates = tg("getUpdates", offset=offset, timeout=2).get("result", [])
            for u in updates:
                offset = u["update_id"] + 1
                msg = u.get("message") or {}
                if msg.get("text", "").startswith("/start"):
                    chat = msg["chat"]
                    db.table("subscribers").upsert({"chat_id": chat["id"],
                                                    "name": chat.get("first_name", "")}).execute()
                    tg("sendMessage", chat_id=chat["id"],
                       text="✅ You're subscribed to DrainX live alerts for Bengaluru.\n"
                            "You'll get flood forecasts and water-quality events in real time.")
                    print("New subscriber:", chat.get("first_name"))
        except Exception as e:
            print("telegram poll failed:", e)

        # 2. push new alerts
        try:
            new = (db.table("alerts").select("*").gt("id", last_alert_id).order("id").execute().data or [])
            if new:
                subs = db.table("subscribers").select("chat_id").execute().data or []
                for a in new:
                    text = f"{ICONS.get(a['kind'], '⚠️')} DrainX\n{a['message']}"
                    for s in subs:
                        tg("sendMessage", chat_id=s["chat_id"], text=text)
                    last_alert_id = a["id"]
                    print(f"pushed to {len(subs)}: {a['message']}")
        except Exception as e:
            print("alert push failed:", e)
        time.sleep(1)


if __name__ == "__main__":
    main()
