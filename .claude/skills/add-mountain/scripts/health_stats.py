#!/usr/bin/env python3
"""Apple 건강 앱 내보내기(export.xml)에서 방문 시간과 겹치는 운동 기록의 거리·상승고도·칼로리를 합산.

사용법:
  health_stats.py <export.xml> --visit <YYYY-MM-DD> "<HH:mm ~ HH:mm>"   # 한 방문
  health_stats.py <export.xml> --apply <mountains.json> [--dry-run]   # stats 없는 모든 방문 채우기

export.xml은 1GB가 넘을 수 있어 한 줄씩 읽는다 (수십 초 걸림).
결과: {"distance": km(소수 1자리), "ascent": m | null, "calories": kcal}
방문 시간과 겹치는 운동만 합산한다 (기록이 중간에 끊겨 여러 개면 모두 더함).
"""
import argparse
import json
import re
import sys
from datetime import datetime

ATTR = re.compile(r'(\w+)="([^"]*)"')


def parse_time(s):
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


def read_workouts(path, dates):
    """dates에 시작한 운동만 [{start, end, distance, ascent, calories}]"""
    out, cur = [], None
    with open(path, encoding="utf-8") as f:
        for line in f:
            if cur is None:
                if "<Workout " in line:
                    a = dict(ATTR.findall(line))
                    if a.get("startDate", "")[:10] in dates:
                        cur = {"start": parse_time(a["startDate"]), "end": parse_time(a["endDate"]),
                               "distance": 0.0, "ascent": None, "calories": 0.0}
                continue
            if "</Workout>" in line:
                out.append(cur)
                cur = None
            elif "<WorkoutStatistics " in line:
                a = dict(ATTR.findall(line))
                if a.get("type", "").endswith("DistanceWalkingRunning"):
                    cur["distance"] = float(a["sum"]) * (1.609344 if a.get("unit") == "mi" else 1)
                elif a.get("type", "").endswith("ActiveEnergyBurned"):
                    cur["calories"] = float(a["sum"])
            elif 'key="HKElevationAscended"' in line:
                m = re.search(r'value="([\d.]+) cm"', line)
                if m:
                    cur["ascent"] = float(m.group(1)) / 100
    return out


def visit_window(date, duration):
    a, b = [x.strip() for x in duration.split("~")]
    return parse_time(f"{date} {a}:00"), parse_time(f"{date} {b}:59")


def stats_for(workouts, date, duration):
    start, end = visit_window(date, duration)
    hits = [w for w in workouts if w["start"] < end and w["end"] > start]
    if not hits:
        return None
    ascents = [w["ascent"] for w in hits if w["ascent"] is not None]
    return {"distance": round(sum(w["distance"] for w in hits), 1),
            "ascent": round(sum(ascents)) if ascents else None,
            "calories": round(sum(w["calories"] for w in hits))}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("export")
    ap.add_argument("--visit", nargs=2, metavar=("DATE", "DURATION"))
    ap.add_argument("--apply", metavar="MOUNTAINS_JSON")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    if args.visit:
        date, duration = args.visit
        print(json.dumps(stats_for(read_workouts(args.export, {date}), date, duration), ensure_ascii=False))
        return
    if not args.apply:
        sys.exit("--visit 또는 --apply 중 하나가 필요합니다")

    raw = open(args.apply, encoding="utf-8").read()
    data = json.loads(raw)
    todo = [(m, v) for m in data["mountains"] for v in m["visits"] if "stats" not in v and v.get("duration")]
    workouts = read_workouts(args.export, {v["date"] for _, v in todo})
    for m, v in todo:
        s = stats_for(workouts, v["date"], v["duration"])
        print(f'{m["name"]} {v["date"]}: {s}')
        if s:
            v["stats"] = s
    if not args.dry_run:
        open(args.apply, "w", encoding="utf-8").write(
            json.dumps(data, ensure_ascii=False, indent=2) + ("\n" if raw.endswith("\n") else ""))


if __name__ == "__main__":
    main()
