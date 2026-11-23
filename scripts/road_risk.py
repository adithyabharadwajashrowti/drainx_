"""
DrainX road damage risk score
Water is the #1 enemy of bitumen roads: roads that flood often are where potholes form next.
  risk = 0.6 x flood exposure (from the digital twin)  +  0.4 x pothole density (from YOLO)
Writes one row per road segment to `road_risk` every 30 s.
Run:  python road_risk.py
"""
import time
from datetime import datetime, timedelta, timezone

from common import get_db

SEGMENTS = {   # twin junction -> (name, lat, lng)   (approximate - verify)
    "J1": ("HSR Layout 27th Main", 12.9121, 77.6446),
    "J2": ("Silk Board Junction",  12.9177, 77.6238),
    "J3": ("BTM Layout 2nd Stage", 12.9166, 77.6101),
    "J4": ("Madiwala",             12.9226, 77.6174),
}
FLOOD_M3_FOR_MAX = 300   # this much predicted flooding = maximum flood score
POTHOLES_FOR_MAX = 10    # this many potholes in 30 days = maximum pothole score


def label(score):
    return "CRITICAL" if score >= 0.7 else "HIGH" if score >= 0.45 else "MEDIUM" if score >= 0.2 else "LOW"


def main():
    db = get_db()
    while True:
        try:
            run = db.table("runs").select("details").order("id", desc=True).limit(1).execute().data
            risk = run[0]["details"]["risk"] if run else {}
            since = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
            ph = db.table("potholes").select("road_segment").gte("created_at", since).execute().data or []
            rows = []
            for j, (name, lat, lng) in SEGMENTS.items():
                flood = min(1.0, (risk.get(j, {}).get("flood_m3", 0) or 0) / FLOOD_M3_FOR_MAX)
                holes = sum(1 for p in ph if p["road_segment"] == j)
                pot = min(1.0, holes / POTHOLES_FOR_MAX)
                score = round(0.6 * flood + 0.4 * pot, 2)
                rows.append({"segment": j, "name": name, "lat": lat, "lng": lng,
                             "flood_score": round(flood, 2), "pothole_count": holes,
                             "pothole_score": round(pot, 2), "risk": score, "label": label(score),
                             "updated_at": datetime.now(timezone.utc).isoformat()})
            db.table("road_risk").upsert(rows).execute()
            print(" | ".join(f"{r['name']}: {r['label']} ({r['risk']})" for r in rows))
        except Exception as e:
            print("risk update failed:", e)
        time.sleep(30)


if __name__ == "__main__":
    main()
