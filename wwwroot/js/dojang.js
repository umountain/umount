// UMOUNT - MapLibre 지도 interop
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const KO_NAME = ['coalesce', ['get', 'name:ko'], ['get', 'name']];

let overview = null; // { map, ro, el, markers: { [id]: { wrap, dot, m } }, mountains, dotnet }
let detail = null;   // { map, ro, el, markers, token, ready }

function waitForMapLibre() {
    return new Promise(resolve => {
        const check = () => window.maplibregl ? resolve(window.maplibregl) : setTimeout(check, 100);
        check();
    });
}

// 지명 한국어 표기, 도로 번호 방패 숨김
function tune(map) {
    map.getStyle().layers.forEach(l => {
        try {
            if (/shield/.test(l.id)) { map.setLayoutProperty(l.id, 'visibility', 'none'); return; }
            const tf = l.type === 'symbol' && l.layout && l.layout['text-field'];
            if (tf && /name/.test(JSON.stringify(tf)) && !/ref/.test(JSON.stringify(tf))) {
                map.setLayoutProperty(l.id, 'text-field', KO_NAME);
            }
        } catch { }
    });
}

function createMap(ml, el, options) {
    const map = new ml.Map({
        container: el,
        style: STYLE_URL,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
        ...options
    });
    map.touchZoomRotate.disableRotation();
    map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    map.on('style.load', () => tune(map));
    map.on('load', () => el.querySelectorAll('.maplibregl-compact-show').forEach(e => e.classList.remove('maplibregl-compact-show')));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el);
    return { map, ro };
}

function sealHtml({ letter, size, fontSize, ink, bg, fg, ring, opacity, badge }) {
    return `<div class="dj-seal" style="width:${size}px;height:${size}px;font-size:${fontSize}px;opacity:${opacity};--seal-ink:${ink};--seal-bg:${bg};--seal-fg:${fg};--seal-ring:${ring}"><span>${letter}</span>${badge ? `<span class="dj-badge">${badge}</span>` : ''}</div>`;
}

function passes(m, minAltitude) {
    return m.altitude >= minAltitude;
}

export async function initOverview(el, mountains, dotnet, selectedId, filter) {
    disposeOverview();
    const ml = await waitForMapLibre();
    if (!el.isConnected) return;

    const bounds = new ml.LngLatBounds();
    mountains.forEach(d => bounds.extend([d.longitude, d.latitude]));
    const { map, ro } = createMap(ml, el, { bounds, fitBoundsOptions: { padding: 48 } });

    const markers = {};
    mountains.forEach(d => {
        const wrap = document.createElement('div');
        wrap.className = 'dj-marker';
        const dot = document.createElement('div');
        const tip = document.createElement('div');
        tip.className = 'dj-tip';
        tip.textContent = `${d.name} · ${Math.round(d.altitude).toLocaleString()}m`;
        wrap.append(dot, tip);
        wrap.addEventListener('mouseenter', () => { wrap.style.zIndex = 1000; });
        wrap.addEventListener('mouseleave', () => { wrap.style.zIndex = d.id === overview?.selectedId ? 2 : 1; });
        wrap.addEventListener('click', e => { e.stopPropagation(); dotnet.invokeMethodAsync('OnMarkerClick', d.id); });
        markers[d.id] = { wrap, dot, m: new ml.Marker({ element: wrap, anchor: 'center' }).setLngLat([d.longitude, d.latitude]).addTo(map) };
    });

    overview = { map, ro, el, markers, mountains, dotnet };
    syncOverview(selectedId, filter);
}

export function syncOverview(selectedId, filter) {
    if (!overview) return;
    overview.selectedId = selectedId;
    overview.mountains.forEach(d => {
        const sel = d.id === selectedId;
        const ink = sel ? '#d9622b' : d.altitude >= 1000 ? '#2f5d46' : '#5b6e5e';
        const bg = sel ? '#d9622b' : '#efe9dc';
        const { wrap, dot } = overview.markers[d.id];
        dot.innerHTML = sealHtml({
            letter: d.name[0],
            size: sel ? 40 : 32,
            fontSize: sel ? 16 : 13,
            ink, bg,
            fg: sel ? '#fff' : ink,
            ring: sel ? '#fff' : ink,
            opacity: passes(d, filter) ? 1 : .25,
            badge: d.visitCount > 1 ? d.visitCount : null
        });
        wrap.style.zIndex = sel ? 2 : 1;
    });
}

export function disposeOverview() {
    if (!overview) return;
    overview.ro.disconnect();
    try { overview.map.remove(); } catch { }
    overview = null;
}

const ACTIVE = '#d9622b';
const trackCache = new Map();

function loadTrack(url) {
    if (!trackCache.has(url)) {
        trackCache.set(url, fetch(url).then(r => r.ok ? r.json() : null).catch(() => null));
    }
    return trackCache.get(url);
}

function eachCoord(geom, fn) {
    const lines = geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates;
    lines.forEach(line => line.forEach(fn));
}

function firstCoord(geom) {
    return geom.type === 'LineString' ? geom.coordinates[0] : geom.coordinates[0][0];
}

function distM([lon1, lat1], [lon2, lat2]) {
    return Math.hypot((lon1 - lon2) * Math.cos(lat1 * Math.PI / 180), lat1 - lat2) * 111320;
}

// 고도 그래프: 누적 거리(끊긴 구간은 건너뜀) 대비 고도. 마우스를 올리면 지도에 위치 표시
function drawProfile(el, geom, map, ml) {
    el.innerHTML = '';
    const pts = [];
    let dist = 0;
    (geom.type === 'LineString' ? [geom.coordinates] : geom.coordinates).forEach(line => {
        line.forEach((c, i) => {
            if (i > 0) dist += distM(line[i - 1], c);
            if (c.length > 2) pts.push({ d: dist, e: c[2], c });
        });
    });
    el.hidden = pts.length < 2;
    if (el.hidden) return { remove() { } };

    const lo = Math.min(...pts.map(p => p.e)), hi = Math.max(...pts.map(p => p.e));
    const pad = Math.max((hi - lo) * .12, 10);
    const x = p => p.d / dist * 1000;
    const y = e => 100 - (e - lo + pad) / (hi - lo + 2 * pad) * 100;
    const line = pts.map(p => `${x(p).toFixed(1)},${y(p.e).toFixed(1)}`).join(' ');
    const km = v => `${(v / 1000).toFixed(1)}km`;

    el.innerHTML = `
        <svg viewBox="0 0 1000 100" preserveAspectRatio="none">
            <polygon class="dj-prof-area" points="0,100 ${line} 1000,100" />
            <polyline class="dj-prof-line" points="${line}" />
        </svg>
        <span class="dj-prof-label" style="top:2px">${Math.round(hi).toLocaleString()}m</span>
        <span class="dj-prof-label" style="bottom:2px">${Math.round(lo).toLocaleString()}m</span>
        <span class="dj-prof-label" style="bottom:2px;right:4px">${km(dist)}</span>
        <div class="dj-prof-cursor" hidden><span></span></div>`;

    const cursor = el.querySelector('.dj-prof-cursor');
    const tip = cursor.firstElementChild;
    const dotEl = document.createElement('div');
    dotEl.className = 'dj-pos';
    const marker = new ml.Marker({ element: dotEl, anchor: 'center' });

    const move = e => {
        const r = el.getBoundingClientRect();
        const target = Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * dist;
        let a = 0, b = pts.length - 1;
        while (b - a > 1) { const m = (a + b) >> 1; pts[m].d < target ? a = m : b = m; }
        const p = target - pts[a].d < pts[b].d - target ? pts[a] : pts[b];
        const left = p.d / dist * 100;
        cursor.hidden = false;
        cursor.style.left = `${left}%`;
        tip.textContent = `${km(p.d)} · ${Math.round(p.e).toLocaleString()}m`;
        tip.style.transform = `translateX(${left > 70 ? '-100%' : '0'})`;
        marker.setLngLat([p.c[0], p.c[1]]).addTo(map);
    };
    const leave = () => { cursor.hidden = true; marker.remove(); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', leave);
    return marker;
}

function lastCoord(geom) {
    const line = geom.type === 'LineString' ? geom.coordinates : geom.coordinates.at(-1);
    return line.at(-1);
}

// 방문 하나의 지도: 정상 + 그날 주차장 + 경로(출발/도착) + 고도 그래프
// mountain: { name, latitude, longitude }, parking: { latitude, longitude, href } | null,
// track: GeoJSON url | null, profileEl: 고도 그래프 요소 | null, showEnd: 도착점 표시 (원점회귀가 아닌 코스)
export async function showDetail(el, profileEl, mountain, parking, track, showEnd) {
    const ml = await waitForMapLibre();
    if (!el.isConnected) return;

    if (!detail || detail.el !== el) {
        disposeDetail();
        const { map, ro } = createMap(ml, el, { center: [mountain.longitude, mountain.latitude], zoom: 12 });
        detail = { map, ro, el, markers: [], token: 0, ready: new Promise(r => map.once('load', r)) };
    }

    const d = detail;
    const token = ++d.token;
    const { map } = d;
    const data = track ? await loadTrack(track) : null;
    await d.ready;
    if (token !== d.token || detail !== d) return;

    if (map.getLayer('trk')) map.removeLayer('trk');
    if (map.getLayer('trk-case')) map.removeLayer('trk-case');
    if (map.getSource('trk')) map.removeSource('trk');
    d.markers.forEach(k => k.remove());
    d.markers = [];
    const add = (html, ll) => {
        const e = document.createElement('div');
        e.innerHTML = html;
        d.markers.push(new ml.Marker({ element: e, anchor: 'center' }).setLngLat(ll).addTo(map));
    };

    const bounds = new ml.LngLatBounds();
    bounds.extend([mountain.longitude, mountain.latitude]);

    if (data) {
        const line = { 'line-join': 'round', 'line-cap': 'round' };
        map.addSource('trk', { type: 'geojson', data });
        map.addLayer({ id: 'trk-case', type: 'line', source: 'trk', layout: line,
            paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': .9 } });
        map.addLayer({ id: 'trk', type: 'line', source: 'trk', layout: line,
            paint: { 'line-color': ACTIVE, 'line-width': 4 } });
        eachCoord(data.geometry, c => bounds.extend([c[0], c[1]]));
        add('<div class="dj-start" title="출발"></div>', firstCoord(data.geometry).slice(0, 2));
        if (showEnd) add('<div class="dj-end" title="도착"></div>', lastCoord(data.geometry).slice(0, 2));
    }

    add(sealHtml({ letter: mountain.name[0], size: 26, fontSize: 12, ink: '#2f5d46', bg: '#efe9dc', fg: '#2f5d46', ring: '#2f5d46', opacity: 1 }),
        [mountain.longitude, mountain.latitude]);

    if (parking) {
        bounds.extend([parking.longitude, parking.latitude]);
        add(`<a href="${parking.href}" target="_blank" rel="noopener" title="구글 지도에서 열기" style="text-decoration:none"><div class="dj-p">P</div></a>`,
            [parking.longitude, parking.latitude]);
    }

    // 고도 그래프 위치 표시 마커는 마지막에 추가해 가장 위에 보이게 한다
    if (profileEl && data) d.markers.push(drawProfile(profileEl, data.geometry, map, ml));

    if (parking || data) map.fitBounds(bounds, { padding: 36, maxZoom: 15, duration: 0 });
}

export function disposeDetail() {
    if (!detail) return;
    detail.ro.disconnect();
    try { detail.map.remove(); } catch { }
    detail = null;
}

// 펼친 방문 카드가 다 보이지 않으면 카드 머리가 위에 오도록 스크롤
// (2열 배치는 상세 패널 안에서, 1열 배치는 창에서 스크롤)
export function revealVisit(bodyEl) {
    const card = bodyEl.closest('.visit');
    const panel = card?.closest('.detail');
    if (!panel) return;
    const own = panel.scrollHeight > panel.clientHeight + 1;
    const view = own ? panel.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
    const r = card.getBoundingClientRect();
    if (r.top >= view.top && (r.bottom <= view.bottom || r.top - view.top < 40)) return;
    const behavior = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    const delta = r.top - view.top - 12;
    if (own) panel.scrollBy({ top: delta, behavior });
    else window.scrollBy({ top: delta, behavior });
}

// 세로 배치(모바일)일 때 상세 패널로 스크롤
export function revealDetail(el) {
    const stacked = getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length < 2;
    if (!stacked) return;
    el.scrollTop = 0;
    const y = el.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
}
