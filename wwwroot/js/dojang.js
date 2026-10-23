// UMOUNT - MapLibre 지도 interop
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const KO_NAME = ['coalesce', ['get', 'name:ko'], ['get', 'name']];

let overview = null; // { map, ro, el, markers: { [id]: { wrap, dot, m } }, mountains, dotnet }
let parking = null;  // { map, ro, el, markers: [] }

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

// mountain: { name, latitude, longitude }, parkings: [{ latitude, longitude, href }]
export async function showParking(el, mountain, parkings) {
    const ml = await waitForMapLibre();
    if (!el.isConnected) return;

    if (!parking || parking.el !== el) {
        disposeParking();
        const { map, ro } = createMap(ml, el, { center: [mountain.longitude, mountain.latitude], zoom: 12 });
        parking = { map, ro, el, markers: [] };
    }

    const { map } = parking;
    parking.markers.forEach(k => k.remove());
    parking.markers = [];
    const add = (html, ll) => {
        const e = document.createElement('div');
        e.innerHTML = html;
        parking.markers.push(new ml.Marker({ element: e, anchor: 'center' }).setLngLat(ll).addTo(map));
    };

    add(sealHtml({ letter: mountain.name[0], size: 26, fontSize: 12, ink: '#2f5d46', bg: '#efe9dc', fg: '#2f5d46', ring: '#2f5d46', opacity: 1 }),
        [mountain.longitude, mountain.latitude]);

    const bounds = new ml.LngLatBounds();
    bounds.extend([mountain.longitude, mountain.latitude]);
    parkings.forEach(p => {
        bounds.extend([p.longitude, p.latitude]);
        add(`<a href="${p.href}" target="_blank" rel="noopener" title="구글 지도에서 열기" style="text-decoration:none"><div class="dj-p">P</div></a>`,
            [p.longitude, p.latitude]);
    });

    if (parkings.length) map.fitBounds(bounds, { padding: 44, maxZoom: 15, duration: 400 });
    else map.easeTo({ center: [mountain.longitude, mountain.latitude], zoom: 12, duration: 400 });
}

export function disposeParking() {
    if (!parking) return;
    parking.ro.disconnect();
    try { parking.map.remove(); } catch { }
    parking = null;
}

// 세로 배치(모바일)일 때 상세 패널로 스크롤
export function revealDetail(el) {
    const stacked = getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length < 2;
    if (!stacked) return;
    el.scrollTop = 0;
    const y = el.getBoundingClientRect().top + window.scrollY - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
}
