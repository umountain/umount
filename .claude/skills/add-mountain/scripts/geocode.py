#!/usr/bin/env python3
"""산 정상 / 주차장 좌표 검색 (OpenStreetMap Nominatim + Photon).

사용법:
  geocode.py peak <산 이름> [--ele 높이]          # 정상 후보 (표고 포함)
  geocode.py place <장소명> --near <lat>,<lon> [--mountain 산이름]   # 정상 근처(15km) 장소 후보
  geocode.py parking-near <lat> <lon> [--radius 600]  # 좌표 주변 주차장 (Overpass)
  geocode.py reverse <lat> <lon>                  # 좌표 → 주소
"""
import argparse
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request

UA = "umount-add-mountain/1.0 (+https://github.com/umountain/umount)"
NOMINATIM = "https://nominatim.openstreetmap.org"
PHOTON = "https://photon.komoot.io/api/"
OVERPASS = ["https://maps.mail.ru/osm/tools/overpass/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass-api.de/api/interpreter"]


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "ko"})
    with urllib.request.urlopen(req, timeout=20) as r:
        data = json.load(r)
    time.sleep(1)  # Nominatim 사용 정책: 초당 1회
    return data


def nominatim_search(q, **extra):
    params = {"q": q, "format": "jsonv2", "addressdetails": 1, "extratags": 1,
              "accept-language": "ko", "countrycodes": "kr", "limit": 10, **extra}
    return get(f"{NOMINATIM}/search?{urllib.parse.urlencode(params)}")


def dist_km(lat1, lon1, lat2, lon2):
    return math.hypot((lon1 - lon2) * math.cos(math.radians(lat1)), lat1 - lat2) * 111


def peak(args):
    out = []
    for r in nominatim_search(args.name):
        ele = (r.get("extratags") or {}).get("ele")
        item = {"name": r.get("name"), "type": r.get("type"), "lat": float(r["lat"]), "lon": float(r["lon"]),
                "ele": ele, "address": r.get("display_name")}
        if args.ele and ele:
            try:
                item["ele_diff"] = round(abs(float(ele) - args.ele), 1)
            except ValueError:
                pass
        out.append(item)
    out.sort(key=lambda x: (x["type"] not in ("peak", "volcano"), x.get("ele_diff", 1e9)))
    return out


def place_queries(query, mountain):
    """사용자 표기 + 변형 (공백 제거, '제 1' → '제1', 산 이름 접두)"""
    q = re.sub(r"제\s+(\d)", r"제\1", query.strip())
    qs = [query, q, q.replace(" ", "")]
    if mountain:
        lot = re.search(r"제?\d+\s*주차장|주차장", q)
        if mountain not in q:
            qs.append(f"{mountain} {q}")
        if lot:
            qs += [f"{mountain}{lot.group(0).replace(' ', '')}", f"{mountain} 주차장"]
    return list(dict.fromkeys(qs))


def place(args):
    lat, lon = map(float, args.near.split(","))
    seen, out = set(), []

    def add(name, plat, plon, addr, src, q, kind):
        d = dist_km(lat, lon, plat, plon)
        key = (round(plat, 5), round(plon, 5))
        if d <= args.radius and key not in seen:
            seen.add(key)
            out.append({"name": name, "lat": plat, "lon": plon, "dist_km": round(d, 2),
                        "is_parking": kind == "parking" or "주차" in (name or ""),
                        "address": addr, "query": q, "source": src})

    for q in place_queries(args.query, args.mountain):
        for r in nominatim_search(q):
            add(r.get("name"), float(r["lat"]), float(r["lon"]), r.get("display_name"), "nominatim", q, r.get("type"))
        params = urllib.parse.urlencode({"q": q, "lat": lat, "lon": lon, "limit": 10})
        for f in get(f"{PHOTON}?{params}").get("features", []):
            p = f["properties"]
            addr = " ".join(x for x in [p.get("state"), p.get("county"), p.get("city"), p.get("district"),
                                         p.get("street"), p.get("housenumber")] if x)
            add(p.get("name"), f["geometry"]["coordinates"][1], f["geometry"]["coordinates"][0], addr, "photon",
                q, p.get("osm_value"))
    return sorted(out, key=lambda x: (not x["is_parking"], x["dist_km"]))


def parking_near(args):
    """좌표 주변 OSM 주차장(amenity=parking). 이름 없는 주차장도 찾을 수 있다."""
    query = f"[out:json][timeout:25];nwr(around:{args.radius},{args.lat},{args.lon})[amenity=parking];out center tags;"
    body = urllib.parse.urlencode({"data": query}).encode()
    elements = None
    for attempt in range(3):  # 공용 서버가 자주 과부하라 20초 간격으로 재시도
        for url in OVERPASS:
            try:
                req = urllib.request.Request(url, data=body, headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    elements = json.load(r)["elements"]
                break
            except Exception as e:
                print(f"[overpass] {url}: {e}", file=sys.stderr)
        if elements is not None:
            break
        time.sleep(20)
    if elements is None:
        sys.exit("Overpass 서버 응답 없음 (잠시 후 재시도)")
    out = []
    for e in elements:
        c = e.get("center", e)
        out.append({"osm": f"{e['type']}/{e['id']}", "name": e.get("tags", {}).get("name"), "lat": c["lat"], "lon": c["lon"],
                    "dist_m": round(dist_km(args.lat, args.lon, c["lat"], c["lon"]) * 1000), "tags": e.get("tags")})
    return sorted(out, key=lambda x: x["dist_m"])


def reverse(args):
    params = urllib.parse.urlencode({"lat": args.lat, "lon": args.lon, "format": "jsonv2",
                                     "addressdetails": 1, "accept-language": "ko", "zoom": 18})
    r = get(f"{NOMINATIM}/reverse?{params}")
    return {"display_name": r.get("display_name"), "address": r.get("address")}


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("peak"); p.add_argument("name"); p.add_argument("--ele", type=float)
    p = sub.add_parser("place"); p.add_argument("query"); p.add_argument("--near", required=True)
    p.add_argument("--mountain", help="산 이름 (검색어 변형에 사용)")
    p.add_argument("--radius", type=float, default=15)
    p = sub.add_parser("parking-near"); p.add_argument("lat", type=float); p.add_argument("lon", type=float)
    p.add_argument("--radius", type=int, default=600, help="미터")
    p = sub.add_parser("reverse"); p.add_argument("lat", type=float); p.add_argument("lon", type=float)
    args = ap.parse_args()
    result = {"peak": peak, "place": place, "parking-near": parking_near, "reverse": reverse}[args.cmd](args)
    json.dump(result, sys.stdout, ensure_ascii=False, indent=2)
    print()


if __name__ == "__main__":
    main()
