
"""
DrainX - Real-time YOLOv8 Pothole Detection

Usage:
    python pothole_detect.py
    python pothole_detect.py road.mp4
"""

import random
import sys
import time

from ultralytics import YOLO

from common import env, get_db, raise_alert


# Configuration
MODEL = env("POTHOLE_MODEL", "models/best.pt")
SEGMENT = env("POTHOLE_SEGMENT", "J2")

SEG_LAT = 12.9177
SEG_LNG = 77.6238

MIN_CONF = 0.10
COOLDOWN_S = 5


def main():

    # Webcam by default, or use a video path
    source = sys.argv[1] if len(sys.argv) > 1 else 0

    if source == "0":
        source = 0

    print("Starting DrainX pothole detection...")

    # Connect to Supabase
    db = get_db()
    print("Supabase connected.")

    # Load trained YOLOv8 model
    model = YOLO(MODEL)
    print(f"Model loaded: {MODEL}")

    last_upload = 0.0
    total = 0

    # Start detection
    for result in model.predict(
        source=source,
        stream=True,
        conf=0.10,
        show=True,
        verbose=False
    ):

        if result.boxes is None or len(result.boxes) == 0:
            continue

        # Highest detection confidence
        confidence = float(result.boxes.conf.max())

        # Ignore low-confidence detections
        if confidence < MIN_CONF:
            continue

        # Prevent repeated alerts
        if time.time() - last_upload < COOLDOWN_S:
            continue

        last_upload = time.time()
        total += 1

        # Generate road location
        latitude = SEG_LAT + random.uniform(-0.0015, 0.0015)
        longitude = SEG_LNG + random.uniform(-0.0015, 0.0015)

        # Save detection to Supabase
        try:
            db.table("potholes").insert({
                "lat": latitude,
                "lng": longitude,
                "confidence": round(confidence, 2),
                "boxes": len(result.boxes),
                "road_segment": SEGMENT
            }).execute()

            print(
                f"[DETECTED] Pothole #{total} "
                f"| Confidence: {confidence:.2%}"
            )

        except Exception as e:
            print("[SUPABASE] Detection save failed:", e)
            continue

        # Create alert in Supabase.
        # alerts.py will read this row and send it to Telegram.
        message = (
            f"New pothole detected on Silk Board road segment!\n"
            f"Confidence: {confidence:.2%}\n"
            f"Road segment: {SEGMENT}\n"
            f"Location: {latitude:.5f}, {longitude:.5f}\n"
            f"Detection #{total} added to repair priority list."
        )

        raise_alert(
            db,
            "pothole",
            message
        )

    print(f"Detection finished. Total uploaded detections: {total}")


if __name__ == "__main__":
    main()
