"""
DrainX bridge: Arduino (USB) <-> Supabase
  * reads one JSON line per second from the node and uploads it to `readings`
  * forwards commands from the dashboard / brain (table `commands`) to the node
Run:  python bridge.py
IMPORTANT: close the Arduino IDE Serial Monitor first, otherwise the port is busy.
"""
import json
import time

import serial  # pip install pyserial

from common import env, get_db, take_commands, raise_alert

PORT = env("SERIAL_PORT", "COM3")
NODE_ID = "SS-01"
UPLOAD_EVERY_S = 2.0
FIELDS = ["level_pct", "pit_pct", "turbidity", "tds", "soil_pct", "flow_lpm", "litres_total",
          "gate_open", "rain_on", "quality_ok", "first_flush", "mode", "reason", "threshold"]


def open_serial():
    while True:
        try:
            s = serial.Serial(PORT, 115200, timeout=1)
            time.sleep(2)  # the Uno restarts when the port opens
            print(f"Connected to node on {PORT}")
            return s
        except serial.SerialException as e:
            print(f"Cannot open {PORT} ({e}). Is the Uno plugged in and Serial Monitor closed? Retrying...")
            time.sleep(3)


def main():
    db = get_db()
    ser = open_serial()
    last_upload = 0.0
    last_poll = 0.0
    prev_reason = None

    while True:
        # ---- 1. read from node ----
        try:
            raw = ser.readline().decode(errors="ignore").strip()
        except serial.SerialException:
            print("Node disconnected - reconnecting")
            try:
                ser.close()
            except Exception:
                pass
            ser = open_serial()
            continue

        if raw.startswith("{"):
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                msg = None

            if msg and "level_pct" in msg:
                # alerts on important changes (sent once, not every second)
                reason = msg.get("reason")
                if reason != prev_reason:
                    if reason == "dirty_water_to_drain":
                        raise_alert(db, "quality", "Polluted runoff detected at Silk Board node - "
                                    "sent to drain, groundwater protected.", NODE_ID)
                    elif reason == "pit_full":
                        raise_alert(db, "pit", "Recharge pit at Silk Board is full.", NODE_ID)
                    prev_reason = reason

                if time.time() - last_upload >= UPLOAD_EVERY_S:
                    row = {k: msg.get(k) for k in FIELDS}
                    row["node_id"] = NODE_ID
                    try:
                        db.table("readings").insert(row).execute()
                        last_upload = time.time()
                        print(f"level {row['level_pct']:5}%  gate {'OPEN ' if row['gate_open'] else 'shut '}"
                              f" litres {row['litres_total']}  ({row['reason']})")
                    except Exception as e:
                        print("upload failed (check internet):", e)
            elif msg:
                print("node says:", msg)  # acks, errors, status

        # ---- 2. forward commands to node ----
        if time.time() - last_poll >= 1.0:
            last_poll = time.time()
            try:
                for c in take_commands(db, NODE_ID):
                    ser.write((c["command"].strip() + "\n").encode())
                    print("  -> sent command", c["command"])
                    time.sleep(0.1)
            except Exception as e:
                print("command poll failed:", e)


if __name__ == "__main__":
    main()
