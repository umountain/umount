#!/usr/bin/env python3
"""mountains.json에 방문 기록 추가 (기존 산이면 visits에 추가, 없으면 새 산 생성).

사용법:
  add_visit.py <mountains.json> <entry.json> [--dry-run]

entry.json 형식:
{
  "name": "연인산", "altitude": 1068, "location": "경기 가평군 가평읍",
  "latitude": 37.89, "longitude": 127.41,
  "visit": {
    "date": "2026-02-18", "duration": "09:48 ~ 12:58",
    "course": "A - B - 원점회귀",
    "parking": {"name": "...", "address": "...", "latitude": 0, "longitude": 0, "fee": "무료"} | null
  }
}
기존 산과 이름이 같으면 altitude/location/좌표는 무시하고 visit만 추가한다.
"""
import argparse
import json
import re
import sys

REQUIRED = ["name", "altitude", "location", "latitude", "longitude", "visit"]


def validate(e):
    missing = [k for k in REQUIRED if e.get(k) in (None, "")]
    v = e.get("visit") or {}
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v.get("date") or ""):
        missing.append("visit.date(YYYY-MM-DD)")
    if v.get("duration") and not re.fullmatch(r"\d{2}:\d{2} ~ \d{2}:\d{2}", v["duration"]):
        missing.append("visit.duration(HH:mm ~ HH:mm)")
    if not v.get("course"):
        missing.append("visit.course")
    p = v.get("parking")
    if p is not None:
        missing += [f"visit.parking.{k}" for k in ("name", "latitude", "longitude") if p.get(k) in (None, "")]
    if missing:
        sys.exit("필수 값 누락/형식 오류: " + ", ".join(missing))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data"); ap.add_argument("entry"); ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    raw = open(args.data, encoding="utf-8").read()
    data = json.loads(raw)
    entry = json.load(open(args.entry, encoding="utf-8"))
    validate(entry)

    v = entry["visit"]
    visit = {"date": v["date"], "duration": v.get("duration"), "course": v["course"], "parking": None}
    if v.get("parking"):
        p = v["parking"]
        visit["parking"] = {"name": p["name"], "address": p.get("address"),
                            "latitude": p["latitude"], "longitude": p["longitude"], "fee": p.get("fee")}

    mountains = data["mountains"]
    existing = next((m for m in mountains if m["name"] == entry["name"]), None)
    if existing:
        if any(x["date"] == visit["date"] for x in existing["visits"]):
            sys.exit(f"이미 같은 날짜의 방문 기록이 있습니다: {entry['name']} {visit['date']}")
        existing["visits"].append(visit)
        existing["visits"].sort(key=lambda x: x["date"])
        target, action = existing, "기존 산에 방문 추가"
    else:
        target = {"id": max((m["id"] for m in mountains), default=0) + 1, "name": entry["name"],
                  "altitude": entry["altitude"], "location": entry["location"],
                  "latitude": entry["latitude"], "longitude": entry["longitude"], "visits": [visit]}
        mountains.append(target)
        action = "새 산 추가"

    out = json.dumps(data, ensure_ascii=False, indent=2) + ("\n" if raw.endswith("\n") else "")
    if not args.dry_run:
        open(args.data, "w", encoding="utf-8").write(out)
    print(json.dumps({"action": action, "dry_run": args.dry_run, "mountain": target}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
