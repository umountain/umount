---
name: add-mountain
description: 등산 기록(산 이름, 높이, 방문일자, 시간, 코스, 주차장)을 받아 정상·주차장 좌표와 주소를 OpenStreetMap에서 찾아 wwwroot/data/mountains.json에 추가한다. "산 추가", "등산 기록 추가", "mountains.json 업데이트", 산 이름과 코스/주차장 정보를 함께 주는 요청에 사용.
---

# 등산 기록 추가 (mountains.json)

사용자가 준 등산 정보로 `wwwroot/data/mountains.json`을 갱신한다. 응답은 항상 한국어로 한다.

## 입력

| 항목 | 필수 | 예 |
|---|---|---|
| 이름 | ✅ | 연인산 |
| 높이(m) | ✅ | 1068 |
| 방문일자 | ✅ | 2026년 2월 18일 → `2026-02-18` (연도가 없으면 오늘 기준 가장 최근 지난 날짜로 하고 보고에 명시) |
| 시간 | 권장 | 09:48 ~ 12:58 → `"09:48 ~ 12:58"` (24시간, 두 자리) |
| 코스 | ✅ | 백둔리 제 1주차장 - 소망능선 - 정상 - 원점회귀 (구분자 ` - `) |
| 주차장 | 선택 | 이름 + 주차비. 없으면 `parking: null` |

- 필수 값이 빠졌으면 진행 전에 한 번에 모아서 묻는다. 시간이 없으면 "시간도 있나요?"라고 묻고, 없다고 하면 `duration: null`.
- 주차비가 없으면 묻고, 모르면 `fee: null`.
- 코스는 사용자가 쓴 표기를 그대로 두되 구분자만 ` - `로 통일한다.

## 절차

스크립트 경로: `.claude/skills/add-mountain/scripts/` (Python 표준 라이브러리만 사용)

1. **이미 있는 산인지 확인** — `mountains.json`에 같은 `name`이 있으면 정상 좌표 검색은 건너뛴다 (방문 기록만 추가됨). 같은 주차장 이름이 그 산의 기존 방문에 있으면 그 주차장 정보를 재사용한다.

2. **정상 좌표**
   ```bash
   python3 .claude/skills/add-mountain/scripts/geocode.py peak "<이름>" --ele <높이>
   ```
   - `type`이 `peak`이고 `ele`가 높이와 가장 가까운(±20m) 후보를 고른다. 동명 봉우리가 여러 개면 `ele_diff`로 판단.
   - 일치하는 후보가 없으면 주봉 이름(예: 소백산 → "비로봉", 설악산 → "대청봉"), "<이름> 정상", 산 이름 변형(예: "청계산 매봉" → "매봉")으로 다시 찾고, 그래도 없으면 WebSearch로 정상 좌표를 찾는다. 확신이 없으면 후보를 보여주고 사용자에게 고르게 한다.
   - `altitude`는 OSM `ele`가 아니라 **사용자가 준 높이**를 쓴다 (화면에서 반올림 표시되므로 1439.5를 넣으면 1,440m로 보임).

3. **location 문자열** — 정상 좌표를 `reverse`로 조회해 기존 데이터 형식에 맞춘다.
   ```bash
   python3 .claude/skills/add-mountain/scripts/geocode.py reverse <lat> <lon>
   ```
   - 형식: `<시도 약칭> <시군구> <읍면동> [리/번지]` — 예: `경기 가평군 가평읍`, `강원 영월군 무릉도원면`, `서울 노원구 상계동`
   - 시도 약칭: 서울, 부산, 대구, 인천, 광주, 대전, 울산, 세종, 경기, 강원, 충북, 충남, 전북, 전남, 경북, 경남, 제주

4. **주차장 좌표·주소** (주차장이 있을 때)
   ```bash
   python3 .claude/skills/add-mountain/scripts/geocode.py place "<주차장 이름>" --near <정상lat>,<정상lon> --mountain "<산 이름>"
   ```
   - 스크립트가 사용자 표기와 변형("제 1" → "제1", 공백 제거, "<산>제1주차장", "<산> 주차장")을 모두 검색하고, `is_parking`이 true인 결과를 거리순으로 먼저 보여준다.
   - **이름에 "주차장"이 있으면** 정상에서 15km 이내의 주차장(`is_parking: true`) 중 이름·번호가 사용자 표기와 맞는 곳을 고른다. 다리·도로 같은 비주차장 결과는 고르지 않는다.
   - **이름에 "주차장"이 없으면**(탐방지원센터·사찰·휴양림·학교 등) 그 시설의 주차장에 세운 것이다. 시설 좌표를 찾은 뒤, 시설에 딸린 주차장이 시설 건물과 떨어져 있을 수 있으므로 주변 주차장을 확인한다.
     ```bash
     python3 .claude/skills/add-mountain/scripts/geocode.py parking-near <시설lat> <시설lon> --radius 600
     ```
     가장 가까운 주차장 좌표를 쓰고(예: 어의곡탐방지원센터 → 북쪽 약 385m 새밭로 주차장), 주변에 주차장이 없으면 시설 좌표를 쓴다. 어느 쪽을 썼는지와 거리를 보고에 적는다.
   - 결과가 없으면 WebSearch로 찾고, 불확실하면 후보를 보여주고 사용자에게 묻는다.
   - 고른 좌표를 `reverse`로 조회해 주소를 만든다. 도로명+번지가 있으면 `경기도 가평군 설악면 유명산길 79-53` 형식, 번지가 없으면 리 단위까지만 (`경기 가평군 북면 백둔리 (백둔로)`). 주소를 지어내지 않는다.
   - 주차장 `name`은 사용자가 준 이름을 그대로 쓴다. 지도상 공식 명칭이 다르면 보고할 때 알려준다.

5. **JSON 갱신** — 스크래치패드에 entry 파일을 쓰고 먼저 `--dry-run`으로 검증한 뒤 반영한다.
   ```bash
   python3 .claude/skills/add-mountain/scripts/add_visit.py wwwroot/data/mountains.json <entry.json> --dry-run
   python3 .claude/skills/add-mountain/scripts/add_visit.py wwwroot/data/mountains.json <entry.json>
   ```
   entry 형식은 `add_visit.py` 상단 docstring 참고. 새 산이면 `id`는 자동으로 최댓값+1, 기존 산이면 visits에 날짜순으로 추가된다. 같은 날짜 기록이 이미 있으면 중단된다.

6. **확인** — `git diff --stat wwwroot/data/mountains.json`으로 추가만 있는지(기존 줄 변경 없음) 확인한다.

## 보고

한국어로 다음을 표로 보여준다: 이름/높이, location, 정상 좌표, 방문(일자·시간), 코스, 주차장(이름·요금·좌표·주소).
그리고 좌표를 어떻게 골랐는지(후보가 여러 개였는지, 공식 명칭 차이, 행정구역 경계 등 애매한 점)를 짧게 적는다.

커밋/푸시는 하지 않는다. 마지막에 "커밋하고 push해서 배포할까요?"라고 묻는다 (`main`에 push하면 GitHub Pages가 자동 재배포됨).
