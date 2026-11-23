"""
DrainX pothole detector (YOLO)
  python pothole_detect.py               -> laptop webcam
  python pothole_detect.py road.mp4      -> a recorded dashcam / phone video
Every confident detection (max one every 5 s) is saved to `potholes`
with the road segment it belongs to. road_risk.py turns these into a risk score.
"""
import random
import sys
import time

from ultralytics import YOLO  # pip install ultralytics

from common import env, get_db, raise_alert

MODEL = env("POTHOLE_MODEL", "best.pt")        # the weights you trained in Colab
SEGMENT = env("POTHOLE_SEGMENT", "J2")          # which twin road segment the camera is on
SEG_LAT, SEG_LNG = 12.9177, 77.6238             # centre of that segment
MIN_CONF = 0.5
COOLDOWN_S = 5


def main():
    source = sys.argv[1] if len(sys.argv) > 1 else 0
    if source == "0":
        source = 0
    db = get_db()
    model = YOLO(MODEL)
    last_upload = 0.0
    total = 0
    for r in model.predict(source=source, stream=True, conf=0.35, show=True, verbose=False):
        if r.boxes is None or len(r.boxes) == 0:
            continue
        conf = float(r.boxes.conf.max())
        if conf < MIN_CONF or time.time() - last_upload < COOLDOWN_S:
            continue
        last_upload = time.time()
        total += 1
        db.table("potholes").insert({
            "lat": SEG_LAT + random.uniform(-0.0015, 0.0015),
            "lng": SEG_LNG + random.uniform(-0.0015, 0.0015),
            "confidence": round(conf, 2), "boxes": len(r.boxes), "road_segment": SEGMENT,
        }).execute()
        print(f"pothole #{total} saved (confidence {conf:.2f})")
        if total == 1:
            raise_alert(db, "pothole", "New pothole detected on Silk Board road segment "
                        "(a repeat flood zone) - added to repair priority list.")


if __name__ == "__main__":
    main()
