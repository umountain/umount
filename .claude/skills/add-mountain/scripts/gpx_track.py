#!/usr/bin/env python3
"""GPX → 지도용 GeoJSON 경로 (Douglas-Peucker로 포인트 축소).

사용법:
  gpx_track.py <out.json> <in.gpx> [in2.gpx ...] [--tolerance 4]

여러 GPX를 주면 시간순으로 이어 MultiLineString으로 저장한다 (운동 기록이 중간에 끊긴 경우).
좌표는 [lon, lat, ele, dist] (소수 5자리 ≈ 1m, 고도 정수 m, dist = 줄이기 전 원본 기준 누적 거리 m).
점을 줄이면 지그재그 길이 펴져 거리가 짧아지므로, 고도 그래프는 원본 누적 거리(dist)를 쓴다.
끊긴 구간 사이의 거리는 더하지 않는다.
"""
import argparse
import json
import math
import re
import sys

TRKPT = re.compile(r'<trkpt\s+(?:lon="([^"]+)"\s+lat="([^"]+)"|lat="([^"]+)"\s+lon="([^"]+)")\s*>(.*?)</trkpt>', re.S)
ELE = re.compile(r"<ele>([^<]+)</ele>")
TIME = re.compile(r"<time>([^<]+)</time>")


def read_gpx(path):
    pts = []
    for lon, lat, lat2, lon2, body in TRKPT.findall(open(path, encoding="utf-8").read()):
        ele = ELE.search(body)
        t = TIME.search(body)
        pts.append((float(lon or lon2), float(lat or lat2), float(ele.group(1)) if ele else None,
                    t.group(1) if t else ""))
    return pts


def dist_m(a, b):
    return math.hypot((a[0] - b[0]) * math.cos(math.radians(a[1])), a[1] - b[1]) * 111320


def with_distance(segments):
    """각 점에 원본 기준 누적 거리(m)를 붙인다: (lon, lat, ele, time, dist)"""
    out, total = [], 0.0
    for seg in segments:
        line = []
        for i, p in enumerate(seg):
            if i:
                total += dist_m(seg[i - 1], p)
            line.append(p + (total,))
        out.append(line)
    return out


def simplify(pts, tol_m):
    """평면 근사(m 단위) Douglas-Peucker. 재귀 대신 스택 사용."""
    if len(pts) < 3:
        return pts
    k = math.cos(math.radians(pts[0][1])) * 111320
    xy = [(p[0] * k, p[1] * 110540) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        seg = math.hypot(dx, dy)
        best, idx = 0.0, -1
        for i in range(a + 1, b):
            px, py = xy[i]
            d = abs(dy * (px - ax) - dx * (py - ay)) / seg if seg else math.hypot(px - ax, py - ay)
            if d > best:
                best, idx = d, i
        if best > tol_m:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k_ in zip(pts, keep) if k_]


def coords(pts):
    return [[round(p[0], 5), round(p[1], 5), round(p[2]) if p[2] is not None else 0, round(p[4])] for p in pts]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out"); ap.add_argument("gpx", nargs="+")
    ap.add_argument("--tolerance", type=float, default=4, help="허용 오차(m)")
    args = ap.parse_args()

    segments = [s for s in (read_gpx(p) for p in args.gpx) if s]
    if not segments:
        sys.exit("GPX에 trkpt가 없습니다")
    segments.sort(key=lambda s: s[0][3])
    segments = with_distance(segments)
    lines = [coords(simplify(s, args.tolerance)) for s in segments]
    geom = {"type": "LineString", "coordinates": lines[0]} if len(lines) == 1 else \
        {"type": "MultiLineString", "coordinates": lines}
    feature = {"type": "Feature", "properties": {}, "geometry": geom}
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(feature, f, separators=(",", ":"))
        f.write("\n")
    raw = sum(len(s) for s in segments)
    print(json.dumps({"out": args.out, "points": raw, "kept": sum(len(l) for l in lines), "segments": len(lines),
                      "distance_km": round(segments[-1][-1][4] / 1000, 2),
                      "start": segments[0][0][3], "end": segments[-1][-1][3]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
