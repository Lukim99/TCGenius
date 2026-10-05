// 서버가 공개한 패턴만 그린다. 피해와 입력 판정은 전투 엔진에서 처리한다.
(() => {
    'use strict';
    const FILES = {
        beep: 'signal-v2', gloss: 'bronze-set-v2', fall: 'shards-rush-v2', stone: 'stone-hit-v2',
        blast: 'resonance-impact-v2', wall: 'wall-pressure-v2', rupture: 'echo-break-v2',
        shield: 'ward-form-v2', darkShield: 'obsidian-close-v2', mochi: 'mochi-flex-v2', rain: 'rain-veil-v2',
        mirror: 'mirror-glint-v2', charge: 'power-gather-v2', purge: 'life-drain-v2',
        empower: 'dark-surge-v2', growl: 'dark-growl-v2', dealing: 'dealing-aura-v2', revive: 'revival-bloom-v2',
        fire: 'fire-ignite-v2', fireBlast: 'fire-erupt-v2', cannon: 'sky-load-v2', cannonHit: 'sky-impact-v2',
        execute: 'doom-pressure-v2', executeHit: 'doom-cut-v2', heal: 'healing-absorb-v2',
        darkBlast: 'dark-impact-v2', dealingHit: 'dealing-cut-v2', bounce: 'ground-land-v2', puzzle: 'puzzle-hit-v2'
    };
    // 즉시 발동한 실제 사건. 카드 없이 효과만 보여 주고, 서버 목록에서 빠져도 끝까지 그린다.
    const INSTANT = new Set(['regenerate', 'dark-blast', 'crit-reflect', 'revive', 'puzzle', 'dealing', 'dealing-strike', 'bounce']);
    const VISUAL_ONLY = new Set(['harden', 'shards', 'resonance', 'echo', 'wall', 'rupture', 'dealing-ready', ...INSTANT]);
    // 자연 종료 직전에 빠지면 마무리(폭발, 착탄, 사라짐)를 이어서 그린다.
    const TAIL = new Set(['resonance', 'echo', 'shards', 'shatter', 'carve-break', 'purge', 'execute', 'flame', 'cannon', 'empower', 'dark-shield', 'mochi-shield', 'rain-shield', 'reflect']);
    const CAST_IMPACT = new Set(['purge', 'execute', 'flame', 'cannon']);
    const TEXTURES = { mist: '레이드/fx-dark-mist.png', shard: '레이드/fx-bronze-shard.png', fire: '레이드/fx-fire-flow-v2.png', puzzle: '레이드/fx-puzzle-piece-v1.png',
        carve: '레이드/fx-sculpture-carving-v1.png', echoBody: '레이드/whiplash-echo-body-v1.png' };
    // 조각 아틀라스(3x2칸) 단계: 원석, 머리 윤곽, 다리 틈, 전체 윤곽, 다듬은 석상, 청동. 진행도가 이 지점을 지날 때 다음 단계로 깎인다.
    const CARVE_KNOTS = [0, .2, .45, .7, .9, 1];
    // 등록 원본(1672x941) 좌표. 우퍼 중심과 반지름, 초록 램프, 기계 외곽, 잔향의 뻗은 팔(어깨 기준점, 잘라낼 범위, 다각형), 손.
    const PLANE = [1672, 941];
    const WHIP = { woofer: [835, 452, 130], lamp: [688, 295, 24], box: [626, 26, 424, 612] };
    const ARM = { pivot: [905, 640], hand: [1190, 640], box: [820, 450, 500, 450],
        poly: [[835, 585], [960, 520], [1060, 468], [1135, 462], [1312, 568], [1302, 640], [1268, 720], [1285, 892], [1175, 892], [1115, 765], [1000, 705], [900, 692], [835, 662]] };
    // 분리 보스 그림 안의 기준점(가로, 세로 비율): 황소 몸통, 스피커 우퍼, 잔향의 뻗은 손.
    const FOCUS = { sculpture: [.55, .52], whiplash: [.5, .66], 'whiplash-echo': [.7, .66] };
    const GLINTS = [[.42, .05], [.39, .3], [.58, .45], [.79, .58], [.3, .83], [.66, .74]];
    const BRONZE = [255, 196, 120], BRONZE_HOT = [255, 246, 222], VIOLET = [168, 120, 255], VIOLET_HOT = [236, 222, 255];
    const RED = [232, 40, 52], RED_HOT = [255, 196, 188], PALE = [196, 204, 255], PALE_HOT = [244, 246, 255];
    const TAU = Math.PI * 2;
    const buffers = new Map(), images = new Map(), puffTiles = new Map();
    let audio = null, loading = null, hexTile = null, fireTint = null, carve = null, armCut = null;
    const tailTime = kind => kind === 'flame' ? 1.5 : kind === 'carve-break' ? 1.1 : .65;
    const assetUrl = file => '/rpg-ui?file=' + encodeURIComponent(file);
    const idle = fn => window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 400 }) : setTimeout(fn, 30);
    function unlockAudio() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        if (!audio) audio = new AudioContext();
        audio.resume().catch(() => {});
        if (!loading) loading = Promise.all(Object.entries(FILES).map(async ([key, file]) => {
            try {
                const response = await fetch('/rpg-ui?file=' + encodeURIComponent('sfx/raid/' + file + '.mp3'));
                if (!response.ok) return;
                buffers.set(key, await audio.decodeAudioData(await response.arrayBuffer()));
            } catch (_) {}
        }));
    }
    document.addEventListener('pointerdown', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio);
    // 텍스처는 처음 필요할 때 불러오고, 준비되기 전에는 대체 그림을 쓴다.
    // decoded는 decode()가 끝난 그림만 돌려준다. 장면을 통째로 대신 그리는 연출은 반쯤 풀린 그림을 쓰지 않는다.
    function picture(src, decoded) {
        if (!src) return null;
        let image = images.get(src);
        if (!image) {
            image = new Image(); image.decoding = 'async'; image.src = src; images.set(src, image);
            image.decode().then(() => { image.ready = true; }, () => {});
        }
        return (decoded ? image.ready : image.complete) && image.naturalWidth ? image : null;
    }
    const texture = (key, decoded) => picture(assetUrl(TEXTURES[key]), decoded);
    // 연기 덩어리 타일. 기본은 어두운 연기, 돌가루는 밝은 석회색으로 같은 모양을 쓴다.
    function puff(color = '46,40,44') {
        let tile = puffTiles.get(color);
        if (tile) return tile;
        tile = document.createElement('canvas'); tile.width = tile.height = 128; puffTiles.set(color, tile);
        const g = tile.getContext('2d');
        for (let i = 0; i < 7; i++) {
            const x = 30 + rand(i) * 68, y = 34 + rand(i + 9) * 60, r = 26 + rand(i + 3) * 30;
            const gradient = g.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, 'rgba(' + color + ',.55)'); gradient.addColorStop(1, 'rgba(' + color + ',0)');
            g.fillStyle = gradient; g.fillRect(0, 0, 128, 128);
        }
        return tile;
    }
    const stoneDust = () => puff('178,164,142');

    // ---- 조각 아틀라스 준비: 유휴 시간에 한 단계씩 처리한다 ----
    // 단계마다 다음 단계 표면까지의 거리로 깎이는 순서를 정하고 256개 묶음으로 나눈다.
    // 진행도가 바뀌면 사이에 있는 묶음의 픽셀만 다시 쓴다.
    function chamfer(zero, N) {
        const d = new Float32Array(N * N), D = Math.SQRT2;
        for (let i = 0; i < d.length; i++) d[i] = zero[i] ? 0 : 1e6;
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const i = y * N + x;
            let v = d[i];
            if (!v) continue;
            if (x) v = Math.min(v, d[i - 1] + 1);
            if (y) { v = Math.min(v, d[i - N] + 1); if (x) v = Math.min(v, d[i - N - 1] + D); if (x < N - 1) v = Math.min(v, d[i - N + 1] + D); }
            d[i] = v;
        }
        for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
            const i = y * N + x;
            let v = d[i];
            if (!v) continue;
            if (x < N - 1) v = Math.min(v, d[i + 1] + 1);
            if (y < N - 1) { v = Math.min(v, d[i + N] + 1); if (x < N - 1) v = Math.min(v, d[i + N + 1] + D); if (x) v = Math.min(v, d[i + N - 1] + D); }
            d[i] = v;
        }
        return d;
    }
    // 각진 면: 흔들린 격자점의 보로노이 칸마다 같은 값을 준다. 깎인 자리가 먼지처럼 흩어지지 않고 면 단위로 떨어진다.
    function facet(x, y, cell, seed) {
        const gx = Math.floor(x / cell), gy = Math.floor(y / cell);
        let best = 1e9, value = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
            const h = (gx + i) * 131 + (gy + j) * 977 + seed;
            const dx = (gx + i + rand(h)) * cell - x, dy = (gy + j + rand(h + 5)) * cell - y, d = dx * dx + dy * dy;
            if (d < best) { best = d; value = rand(h + 11); }
        }
        return value;
    }
    function carvePair(k) {
        const N = carve.size, n = N * N, a = carve.stages[k], b = carve.stages[k + 1];
        const outside = new Uint8Array(n), next = new Uint8Array(n);
        for (let i = 0; i < n; i++) { outside[i] = a[i * 4 + 3] < 128 ? 1 : 0; next[i] = b[i * 4 + 3] >= 128 ? 1 : 0; }
        const dOut = chamfer(outside, N), dIn = chamfer(next, N), cell = Math.max(4, Math.round(N * .028));
        const bucket = new Int16Array(n).fill(-1), start = new Uint32Array(257), surface = [];
        for (let i = 0; i < n; i++) {
            if (!a[i * 4 + 3]) continue;
            if (next[i]) { surface.push(i); continue; }
            const x = i % N, y = (i / N) | 0, cr = facet(x, y, cell, k * 7919);
            // 떨어질 부분은 바깥에서 안쪽으로, 막힌 다리 틈은 가운데부터 면 단위로 깎인다.
            const o = .75 * dOut[i] / (dOut[i] + dIn[i] + 1e-6) + .25 * cr;
            bucket[i] = Math.min(255, Math.floor(o * 256));
            start[bucket[i] + 1]++;
        }
        for (let i = 1; i <= 256; i++) start[i] += start[i - 1];
        const fill = start.slice(0, 256), index = new Uint32Array(start[256]);
        for (let i = 0; i < n; i++) if (bucket[i] >= 0) index[fill[bucket[i]]++] = i;
        carve.pairs[k] = { start, index, surface: new Uint32Array(surface) };
    }
    function nestCarveStage(k) {
        const N = carve.size, a = carve.stages[k], b = carve.stages[k + 1];
        // 반투명 경계만 다음 형태까지 메운다. 불투명도 1 차이로 다음 단계의 청동색을 원석에 복사하지 않는다.
        const nearest = new Int32Array(N * N).fill(-1), distance = new Int32Array(N * N).fill(N * 2);
        for (let i = 0; i < nearest.length; i++) if (a[i * 4 + 3] >= 128) { nearest[i] = i; distance[i] = 0; }
        const take = (i, j) => {
            if (distance[j] + 1 < distance[i]) { distance[i] = distance[j] + 1; nearest[i] = nearest[j]; }
        };
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const i = y * N + x;
            if (x) take(i, i - 1);
            if (y) take(i, i - N);
        }
        for (let y = N - 1; y >= 0; y--) for (let x = N - 1; x >= 0; x--) {
            const i = y * N + x;
            if (x < N - 1) take(i, i + 1);
            if (y < N - 1) take(i, i + N);
        }
        for (let i = 0; i < nearest.length; i++) {
            const p = i * 4;
            if (b[p + 3] <= a[p + 3]) continue;
            if (a[p + 3] < 128 && nearest[i] >= 0) {
                const q = nearest[i] * 4;
                a[p] = a[q]; a[p + 1] = a[q + 1]; a[p + 2] = a[q + 2];
            }
            a[p + 3] = b[p + 3];
        }
    }
    function carveAtlas(size) {
        if (carve) return carve.ready ? carve : null;
        carve = { size, ready: false, stages: [], pairs: [] };
        const N = size, jobs = [];
        const run = () => { try { jobs.shift()?.(); } catch (_) { jobs.length = 0; } if (jobs.length) idle(run); };
        for (let c = 0; c < 6; c++) jobs.push(() => {
            const atlas = texture('carve'), canvas = document.createElement('canvas'); canvas.width = canvas.height = N;
            const g = canvas.getContext('2d', { willReadFrequently: true });
            g.drawImage(atlas, (c % 3) * 512, Math.floor(c / 3) * 512, 512, 512, 0, 0, N, N);
            const data = g.getImageData(0, 0, N, N).data;
            // 투명 배경이 아니면 원본 청동을 가리지 않는다.
            if (data[3] > 16 || data[(N - 1) * 4 + 3] > 16) { jobs.length = 0; return; }
            carve.stages[c] = data;
        });
        // 앞 단계가 다음 단계를 모두 품게 한다. 깎기는 재료를 덜어 낼 뿐 새로 붙이지 않는다.
        for (let k = 4; k >= 0; k--) jobs.push(() => nestCarveStage(k));
        jobs.push(() => {
            const last = carve.stages[5];
            let x0 = N, y0 = N, x1 = 0, y1 = 0;
            for (let i = 0; i < N * N; i++) if (last[i * 4 + 3] > 64) { const x = i % N, y = (i / N) | 0; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
            carve.box = [x0, y0, x1 + 1, y1 + 1];
        });
        for (let k = 0; k < 5; k++) jobs.push(() => carvePair(k));
        jobs.push(() => { carve.ready = true; });
        let tries = 0;
        const wait = () => { if (texture('carve', true)) idle(run); else if (++tries < 120) setTimeout(wait, 250); };
        wait();
        return null;
    }

    // ---- 파편 공용 도구 ----
    // 영역을 보로노이 판으로 나눈다. 같은 씨앗이면 재접속해도 같은 금과 조각이 나온다.
    function voronoi(sites, [x, y, w, h]) {
        return sites.map((s, i) => {
            let poly = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
            for (let j = 0; j < sites.length && poly.length; j++) {
                if (j === i) continue;
                const o = sites[j], nx = o[0] - s[0], ny = o[1] - s[1], c = (nx * (s[0] + o[0]) + ny * (s[1] + o[1])) / 2, next = [];
                for (let k = 0; k < poly.length; k++) {
                    const p = poly[k], q = poly[(k + 1) % poly.length], dp = nx * p[0] + ny * p[1] - c, dq = nx * q[0] + ny * q[1] - c;
                    if (dp <= 0) next.push(p);
                    if ((dp <= 0) !== (dq <= 0)) { const f = dp / (dp - dq); next.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
                }
                poly = next;
            }
            return poly;
        }).filter(poly => poly.length > 2);
    }
    // 원본 그림에서 판 모양대로 잘라 판마다 작은 캔버스에 둔다. 어두운 사본은 돌아갈 때 보이는 두께 면이다.
    function cutPlates(source, polys, scale, sw, sh, finish) {
        return polys.map(poly => {
            const xs = poly.map(p => p[0]), ys = poly.map(p => p[1]);
            const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys)), w = Math.ceil(Math.max(...xs)) - x + 1, h = Math.ceil(Math.max(...ys)) - y + 1;
            const make = dark => {
                const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
                const g = c.getContext('2d');
                g.scale(scale, scale); g.translate(-x, -y);
                g.beginPath(); poly.forEach(([px, py], i) => i ? g.lineTo(px, py) : g.moveTo(px, py)); g.closePath(); g.clip();
                g.drawImage(source, 0, 0, sw, sh);
                finish?.(g);
                if (dark) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = 'rgba(16,13,16,.86)'; g.fillRect(x, y, w, h); }
                return c;
            };
            return { x, y, w, h, cx: xs.reduce((a, v) => a + v) / xs.length, cy: ys.reduce((a, v) => a + v) / ys.length, image: make(false), edge: make(true) };
        });
    }
    const inside = (pts, x, y) => {
        let hit = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const [xi, yi] = pts[i], [xj, yj] = pts[j];
            if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
        }
        return hit;
    };
    // 잔향의 뻗은 팔만 원본 장면에서 떼어 낸다. 팔을 지운 몸 그림과 달라진 픽셀만 남긴다.
    function extractArm(scene, body) {
        if (armCut?.src === scene.src) return;
        const cut = armCut = { src: scene.src, canvas: null };
        idle(() => {
            try {
                const kx = scene.naturalWidth / PLANE[0], ky = scene.naturalHeight / PLANE[1], [bx, by, bw, bh] = ARM.box;
                const w = Math.round(bw * kx), h = Math.round(bh * ky), c = document.createElement('canvas'); c.width = w; c.height = h;
                const g = c.getContext('2d', { willReadFrequently: true });
                g.drawImage(body, bx / PLANE[0] * body.naturalWidth, by / PLANE[1] * body.naturalHeight, bw / PLANE[0] * body.naturalWidth, bh / PLANE[1] * body.naturalHeight, 0, 0, w, h);
                const base = g.getImageData(0, 0, w, h).data;
                g.clearRect(0, 0, w, h);
                g.beginPath(); ARM.poly.forEach(([x, y], i) => i ? g.lineTo((x - bx) * kx, (y - by) * ky) : g.moveTo((x - bx) * kx, (y - by) * ky)); g.closePath(); g.fill();
                const region = g.getImageData(0, 0, w, h).data;
                g.clearRect(0, 0, w, h);
                g.drawImage(scene, bx * kx, by * ky, w, h, 0, 0, w, h);
                const pixels = g.getImageData(0, 0, w, h), data = pixels.data;
                for (let i = 0; i < data.length; i += 4) {
                    const diff = Math.abs(data[i] - base[i]) + Math.abs(data[i + 1] - base[i + 1]) + Math.abs(data[i + 2] - base[i + 2]) + Math.abs(data[i + 3] - base[i + 3]) * 2;
                    data[i + 3] = data[i + 3] * clamp((diff - 28) / 60) * region[i + 3] / 255;
                }
                g.putImageData(pixels, 0, 0);
                cut.canvas = c;
            } catch (_) { cut.failed = true; }
        });
    }
    // 잔향 장면(등록 인물, 배경)과 팔 없는 몸. 해독이 끝나기 전에는 null이라 들어올 장면을 미리 드러내지 않는다.
    function echoArt(art) {
        const scene = picture(art?.image, true), hall = picture(art?.background, true), body = texture('echoBody', true);
        if (scene && body) extractArm(scene, body);
        return scene && hall ? { scene, hall, body } : null;
    }
    // 원본의 검은 바탕을 광량 알파로 바꾼다. 투명 효과 캔버스에 검은 사각형이 남지 않는다.
    function fireSheet() {
        const image = texture('fire');
        if (!image) return null;
        if (!fireTint) {
            fireTint = document.createElement('canvas'); fireTint.width = image.naturalWidth; fireTint.height = image.naturalHeight;
            const g = fireTint.getContext('2d');
            g.drawImage(image, 0, 0);
            const pixels = g.getImageData(0, 0, fireTint.width, fireTint.height), data = pixels.data;
            for (let i = 0; i < data.length; i += 4) {
                const light = Math.max(data[i], data[i + 1], data[i + 2]);
                if (light < 5) { data[i + 3] = 0; continue; }
                data[i] = data[i] * 255 / light;
                data[i + 1] = data[i + 1] * 176 / light;
                data[i + 2] = data[i + 2] * 100 / light;
                data[i + 3] = data[i + 3] * light / 255;
            }
            g.putImageData(pixels, 0, 0);
        }
        return fireTint;
    }

    function soundPlan(kind, duration) {
        switch (kind) {
        case 'harden': return [[1, 'gloss', .35]];
        case 'shards': return [[0, 'fall', .3], [2, 'stone', .6], [3, 'stone', .6], [4, 'stone', .6]];
        case 'resonance': return [[0, 'beep', .6], [.16, 'beep', .6], [.32, 'beep', .6], [3, 'blast', .7]];
        case 'echo': return [[0, 'beep', .5], [.22, 'beep', .5], [3, 'beep', .6], [3.22, 'beep', .6]];
        case 'wall': return [[0, 'wall', .4]];
        case 'rupture': return [[0, 'rupture', .45]];
        case 'shield': return [[0, 'shield', .4]];
        case 'dark-shield': return [[0, 'darkShield', .45]];
        case 'mochi-shield': return [[0, 'mochi', .5]];
        case 'rain-shield': return [[0, 'rain', .4]];
        case 'reflect': return [[0, 'mirror', .45]];
        case 'charge': return [[0, 'charge', .4]];
        case 'purge': return [[0, 'purge', .4]];
        case 'empower': return [[0, 'empower', .4], [.18, 'growl', .3]];
        case 'dealing': return [[0, 'dealing', .4]];
        case 'dealing-ready': return [[0, 'dealing', .3]];
        case 'revive': return [[0, 'revive', .4]];
        // 시전 끝의 실제 타격만 한 번 더 울린다.
        case 'flame': return [[0, 'fire', .35], [duration, 'fireBlast', .6]];
        case 'cannon': return [[0, 'cannon', .35], [duration, 'cannonHit', .6]];
        case 'execute': return [[0, 'execute', .4], [duration, 'executeHit', .65]];
        case 'regenerate': return [[0, 'heal', .35]];
        case 'dark-blast': return [[0, 'darkBlast', .5]];
        case 'dealing-strike': return [[0, 'dealingHit', .5]];
        case 'crit-reflect': return [[0, 'mirror', .4]];
        case 'bounce': return [[0, 'bounce', .5]];
        case 'puzzle': return [[.3, 'puzzle', .4], [.6, 'puzzle', .3]];
        // 외피가 갈라지는 세 번, 고요 뒤 파열과 파편, 마지막 착지.
        case 'transition': return [[.55, 'stone', .3], [1.15, 'stone', .35], [1.7, 'stone', .4], [2.65, 'rupture', .7], [2.65, 'fall', .55], [3.2, 'bounce', .45]];
        case 'carve-break': return [[0, 'stone', .35]];
        default: return [];
        }
    }
    const kindOf = event => event.kind === 'raidCue' ? event.effect || 'charge' : event.kind;
    const hash = id => { let h = 7; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h; };
    const rand = i => { const n = Math.sin(i * 61.37 + 17.8) * 43758.54; return n - Math.floor(n); };
    const clamp = value => Math.max(0, Math.min(1, value));
    const ease = p => 1 - (1 - p) ** 3;
    const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + clamp(a) + ')';

    function create(canvas) {
        const ctx = canvas?.getContext('2d');
        if (!ctx) return null;
        const mask = document.createElement('canvas'), maskCtx = mask.getContext('2d');
        const fog = document.createElement('canvas'), fogCtx = fog.getContext('2d');
        // 잔향 인물(몸과 팔)을 먼저 합성해 두는 화면 크기 캔버스.
        const layer = document.createElement('canvas'), layerCtx = layer.getContext('2d');
        const live = document.createElement('div');
        live.className = 'pq-fx-announcement'; live.setAttribute('aria-live', 'polite');
        canvas.parentElement.append(live);
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const states = new Map(), sources = new Set();
        let scope = '', frame = 0, lastFrame = 0, width = 0, height = 0, ratio = 1, volume = 0, master = null;
        let sprite = null, spriteRect = null, spriteDrawRect = null, currentView = null, focus = [.5, .55], scene = { x: 0, y: 0, w: 0, h: 0 };
        let mist = null, lastOutcome = '';
        // carved: 깎는 중인 조각 출력, chips: 실제 타격에서 떨어진 돌 조각, handoff: 실제 무대가 잔향으로 바뀔 때까지 유지하는 마지막 장면.
        let clockOffset = 0, frameDt = 0, carved = null, chips = [], whip = null, whipQueued = false, handoff = null, held = null;
        const boxes = new Map();

        function setVolume(value) {
            volume = clamp(Number(value) || 0);
            if (master && audio) master.gain.setValueAtTime(volume, audio.currentTime);
            if (!volume) stopSounds();
        }
        function stopSounds(state) {
            for (const source of state ? state.sources : sources) { try { source.stop(); } catch (_) {} }
        }
        function play(state, key, gain) {
            if (!audio || audio.state !== 'running' || !volume || document.hidden || !buffers.has(key)) return;
            if (!master) { master = audio.createGain(); master.connect(audio.destination); }
            master.gain.setValueAtTime(volume, audio.currentTime);
            const source = audio.createBufferSource(), mix = audio.createGain();
            source.buffer = buffers.get(key); mix.gain.value = gain;
            source.connect(mix); mix.connect(master);
            state.sources.add(source); sources.add(source);
            source.onended = () => { state.sources.delete(source); sources.delete(source); source.disconnect(); mix.disconnect(); };
            source.start();
        }
        function measure() {
            const bounds = canvas.getBoundingClientRect();
            width = bounds.width; height = bounds.height;
            ratio = Math.min(2, window.devicePixelRatio || 1);
            const w = Math.round(width * ratio), h = Math.round(height * ratio);
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = mask.width = layer.width = w; canvas.height = mask.height = layer.height = h;
                ctx.setTransform(ratio, 0, 0, ratio, 0, 0); maskCtx.setTransform(ratio, 0, 0, ratio, 0, 0); layerCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
            }
            locate(bounds);
        }
        // 전경 캔버스와 실제 보스 영역을 구분한다. 등록된 원본 좌표는 배경과 같은 cover 변환을 받는다.
        function locate(bounds = canvas.getBoundingClientRect()) {
            const stage = document.getElementById('pqPhaseStage')?.getBoundingClientRect();
            scene = stage?.width ? { x: stage.left - bounds.left, y: stage.top - bounds.top, w: stage.width, h: stage.height } : { x: 0, y: 0, w: width, h: height };
            sprite = document.getElementById('pqBossIllustImg');
            spriteRect = spriteDrawRect = null;
            if (sprite?.complete && sprite.naturalWidth) {
                const box = sprite.getBoundingClientRect();
                const s = Math.min(box.width / sprite.naturalWidth, box.height / sprite.naturalHeight), w = sprite.naturalWidth * s, h = sprite.naturalHeight * s;
                if (w > 0) {
                    spriteDrawRect = { x: box.left - bounds.left + (box.width - w) / 2, y: box.top - bounds.top + (box.height - h) / 2, w, h };
                    const subject = JSON.parse(sprite.dataset.subject || '[0,0,1,1]');
                    spriteRect = { x: spriteDrawRect.x + w * subject[0], y: spriteDrawRect.y + h * subject[1], w: w * subject[2], h: h * subject[3] };
                }
            }
            focus = FOCUS[(sprite?.src.match(/(sculpture|whiplash-echo|whiplash)(?:-scene)?\.png/) || [])[1]] || [.5, .55];
        }
        const observer = new ResizeObserver(measure); observer.observe(canvas);

        // 연출이 실제 보스 그림을 대신 그리는 동안만 원본을 숨긴다. 무대가 다시 그려져도 새 요소에 이어 붙인다.
        function hold(on) {
            const host = on ? document.getElementById('pqBossIllust') : null;
            if (held && held !== host) delete held.dataset.fxHold;
            if (host && host.dataset.fxHold !== '1') host.dataset.fxHold = '1';
            held = host;
        }
        function clearPatterns() {
            stopSounds(); states.clear(); currentView = null; chips = [];
            document.querySelectorAll('[data-raid-target]').forEach(card => delete card.dataset.raidTarget);
        }
        function reset() {
            cancelAnimationFrame(frame); frame = 0;
            clearPatterns(); mist = null; lastOutcome = ''; handoff = null; carved = null; hold(false);
            ctx.clearRect(0, 0, width, height); live.textContent = '';
        }
        const mistAlive = () => !!mist && (!mist.doneAt || performance.now() - mist.doneAt < 600);
        const busy = () => states.size > 0 || mistAlive() || !!handoff;
        function kick() {
            if (!frame && busy() && !document.hidden) frame = requestAnimationFrame(render);
            if (!busy()) { ctx.clearRect(0, 0, width, height); hold(false); }
        }
        // 잡몹 단계의 정화 진행. 재접속하면 현재 진행도에서 바로 시작한다.
        function syncMist(info, now) {
            if (!info) { mist = null; return; }
            const target = info.complete ? 1 : clamp(Number(info.progress) || 0);
            if (!mist) { mist = { shown: target, target, doneAt: info.complete ? now - 600 : 0 }; texture('mist'); }
            mist.target = target;
            if (info.complete && !mist.doneAt) mist.doneAt = now;
        }
        function targets(events) {
            const marked = new Map();
            for (const event of events) for (const name of [...(event.targets || []), ...(event.target ? [event.target] : [])]) {
                marked.set(name, ['burden', 'blessing'].includes(event.kind) ? event.kind : '1');
            }
            document.querySelectorAll('.pq-char-card[data-member]').forEach(card => {
                const mark = marked.get(card.dataset.member);
                if (mark) card.dataset.raidTarget = mark;
                else delete card.dataset.raidTarget;
            });
        }
        function update(view, options) {
            const nextScope = (options.scope || '') + ':' + (view?.form || ''), now = performance.now();
            if (nextScope !== scope) {
                // 같은 방에서 잔향 형태로 넘어오면 전환의 마지막 장면을 실제 무대가 바뀔 때까지 그대로 둔다.
                const ending = states.get('form-transition'), echo = ending && view?.form === 'echo' && scope === (options.scope || '') + ':transition' ? echoArt(ending.event.art) : null;
                reset(); scope = nextScope;
                if (echo) handoff = { hall: echo.hall, scene: echo.scene, at: now };
            }
            clockOffset = Number(options.serverOffset) || 0;
            setVolume(options.volume);
            syncMist(options.purification, now);
            if (!view) {
                if (!mist) { reset(); return; }
                if (states.size) clearPatterns();
                measure(); kick(); return;
            }
            currentView = view; measure();
            // 짧은 즉시 효과가 첫 이미지 요청을 기다리다 끝나지 않도록 해당 보스의 재질을 미리 읽는다.
            const art = sprite?.src || '';
            if (art.includes('ingyeo')) texture('fire');
            if (art.includes('black-hodu')) texture('mist');
            if (art.includes('tabujago')) texture('puzzle');
            // 조각 아틀라스는 보스가 처음 보일 때부터 유휴 시간에 준비한다. 잔향 그림은 위플래쉬 단계 내내 미리 해독해 둔다.
            if (art.includes('sculpture-scene')) carveAtlas(width < 420 ? 256 : 384);
            if (view.transitionArt) {
                echoArt(view.transitionArt);
                if (art.includes('whiplash-scene') && !whipQueued) { whipQueued = true; idle(() => { whipQueued = false; whipPlates(); }); }
            }
            const seen = new Set(), announcements = [], breaks = [];
            const events = (view.events || []).filter(event => event.presentation !== 'speech');
            if (view.form === 'transition') events.push({ id: 'form-transition', kind: 'transition', duration: 4, remain: view.transitionRemain, art: view.transitionArt });
            // 직접 본 보호막 시련이 성공으로 끝났을 때만 깨지는 연출을 붙인다.
            const outcome = view.outcome;
            if (outcome?.id && outcome.id !== lastOutcome) {
                const shielded = states.get(String(outcome.id));
                if (outcome.ok && shielded?.kind === 'trial' && shielded.event.stage === 'shield') {
                    states.set('shatter:' + outcome.id, { event: { duration: 0 }, kind: 'shatter', start: now, plan: [], fired: new Set(), sources: new Set(), hits: [], removed: true });
                }
                lastOutcome = outcome.id;
            }
            for (const event of events) {
                const id = String(event.id); seen.add(id);
                let state = states.get(id);
                if (!state) {
                    const age = Math.max(0, Number(event.duration || 0) - Number(event.remain || 0));
                    state = { event, kind: kindOf(event), seed: hash(id), start: now - age * 1000, plan: soundPlan(kindOf(event), Number(event.duration || 0)), fired: new Set(), sources: new Set(), hits: [], removed: false, fresh: age < .6 };
                    // 재접속으로 이미 지난 신호를 다시 울리지 않는다.
                    state.plan.forEach(([at], i) => { if (age - at > .15) state.fired.add(i); });
                    states.set(id, state);
                    if (['shards', 'bounce', 'burden'].includes(state.kind)) texture('shard');
                    if (['empower', 'dark-shield', 'flame', 'bounce', 'burden'].includes(state.kind)) texture('mist');
                    if (['flame', 'berserk'].includes(state.kind)) texture('fire');
                    if (state.kind === 'puzzle') texture('puzzle');
                    if (state.kind === 'sculpture') { carved = null; chips = []; }
                    if (VISUAL_ONLY.has(state.kind)) announcements.push(event.message || event.label);
                }
                if (event.remain != null) state.start = now - Math.max(0, Number(event.duration || 0) - Number(event.remain || 0)) * 1000;
                if (event.kind === 'trial' && state.event.stage !== event.stage && event.stage === 'shield') play(state, 'shield', .4);
                // 보호막 수치가 줄어든 스냅샷마다 피격 파문을 남긴다.
                if (event.kind === 'trial' && event.stage === 'shield' && state.event.stage === 'shield' && Number(event.shield) < Number(state.event.shield)) {
                    state.hits.push({ at: now, angle: Math.random() * TAU });
                    if (state.hits.length > 4) state.hits.shift();
                }
                // 실제 공격과 지원이 늘린 누적 타격 수만 끌 자국을 낸다. 스냅샷 반복이나 감쇠로는 생기지 않는다.
                const carvedNow = Number(event.carveHits || 0), carvedBefore = Number(state.event.carveHits || 0);
                if (event.kind === 'sculpture' && carvedNow > carvedBefore) {
                    state.pending = Math.min(6, (state.pending || 0) + (carvedNow - carvedBefore) * 2);
                    if (now - (state.chiselAt || 0) > 250) { state.chiselAt = now; play(state, 'stone', .18); }
                }
                state.event = event; state.removed = false;
            }
            for (const [id, state] of states) {
                if (seen.has(id)) continue;
                const age = (now - state.start) / 1000;
                // 깎던 돌은 판으로 갈라져 떨어지고 그 뒤에 원래 청동 황소가 남는다.
                if (state.kind === 'sculpture' && state.hold && carved) {
                    const snap = document.createElement('canvas'); snap.width = snap.height = carve.size;
                    snap.getContext('2d').drawImage(carved.canvas, 0, 0);
                    breaks.push(['carve-break:' + id, { event: { duration: 0 }, kind: 'carve-break', seed: state.seed, start: now, plan: soundPlan('carve-break'), fired: new Set(), sources: new Set(), hits: [], removed: true, snap }]);
                }
                // 공명과 연속 타격은 마지막 서버 틱과 화면 프레임 사이도 이어서 그린다.
                if (INSTANT.has(state.kind)) state.removed = true;
                else if (CAST_IMPACT.has(state.kind) && state.event.stage !== 'resolved') { stopSounds(state); states.delete(id); }
                else if (!TAIL.has(state.kind) || age < Number(state.event.duration || 0) - .35) { stopSounds(state); states.delete(id); }
                else state.removed = true;
            }
            for (const [id, state] of breaks) states.set(id, state);
            if (announcements.length) live.textContent = announcements.join(' ');
            targets(events);
            kick();
        }
        // ---- 공통 그리기 도구 ----
        function point(u, v) {
            const b = spriteRect;
            return b ? [b.x + b.w * u, b.y + b.h * v] : [scene.x + scene.w * .5, scene.y + scene.h * (.3 + v * .4)];
        }
        const scenePoint = (u, v) => spriteDrawRect ? [spriteDrawRect.x + spriteDrawRect.w * u, spriteDrawRect.y + spriteDrawRect.h * v] : point(u, v);
        const unit = () => Math.max(.6, Math.min(1.6, Math.min(scene.w, scene.h) / 400));
        const groundY = () => spriteRect ? Math.min(scene.y + scene.h - 6, spriteRect.y + spriteRect.h * .97) : scene.y + scene.h * .86;
        function glow(x, y, r, c, alpha, add = true) {
            if (alpha <= 0 || r <= 0) return;
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, rgba(c, 1)); gradient.addColorStop(.3, rgba(c, .5)); gradient.addColorStop(1, rgba(c, 0));
            ctx.globalCompositeOperation = add ? 'lighter' : 'source-over'; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = gradient;
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        // 두께가 있는 빛의 띠. 충격파, 파동, 보호막 파문이 같이 쓴다.
        function band(x, y, r, thick, c, alpha, squash = 1) {
            if (alpha <= 0 || r <= 0) return;
            ctx.save(); ctx.translate(x, y); ctx.scale(1, squash);
            const outer = r + thick * .25, gradient = ctx.createRadialGradient(0, 0, Math.max(0, r - thick), 0, 0, outer);
            gradient.addColorStop(0, rgba(c, 0)); gradient.addColorStop(.8, rgba(c, 1)); gradient.addColorStop(1, rgba(c, 0));
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = gradient;
            ctx.beginPath(); ctx.arc(0, 0, outer, 0, TAU); ctx.fill(); ctx.restore();
        }
        function bolt(g, x1, y1, x2, y2, seed, c, hot, alpha, line) {
            const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
            g.beginPath(); g.moveTo(x1, y1);
            for (let i = 1; i < 6; i++) { const off = (rand(seed + i) - .5) * len * .24; g.lineTo(x1 + dx * i / 6 + nx * off, y1 + dy * i / 6 + ny * off); }
            g.lineTo(x2, y2); g.lineCap = g.lineJoin = 'round';
            g.globalAlpha = clamp(alpha * .45); g.strokeStyle = rgba(c, 1); g.lineWidth = line * 3; g.stroke();
            g.globalAlpha = clamp(alpha); g.strokeStyle = rgba(hot, 1); g.lineWidth = line; g.stroke();
        }
        function star(x, y, r, alpha) {
            if (alpha <= .02) return;
            glow(x, y, r * .55, BRONZE_HOT, alpha * .8);
            ctx.strokeStyle = rgba(BRONZE_HOT, 1); ctx.lineWidth = 1.2; ctx.globalAlpha = clamp(alpha);
            ctx.beginPath(); ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r * .7); ctx.lineTo(x, y + r * .7); ctx.stroke();
        }
        // 보스 그림의 알파 안쪽에만 칠한다. 먼저 칠한 뒤 그림 알파로 잘라 여러 획도 함께 남는다.
        function skin(paint, alpha, op = 'source-over') {
            const b = spriteRect;
            if (!b || alpha <= 0) return;
            maskCtx.globalCompositeOperation = 'source-over'; maskCtx.globalAlpha = 1;
            maskCtx.clearRect(0, 0, width, height);
            paint(maskCtx, b);
            maskCtx.globalCompositeOperation = 'destination-in'; maskCtx.globalAlpha = 1;
            maskCtx.drawImage(sprite, spriteDrawRect.x, spriteDrawRect.y, spriteDrawRect.w, spriteDrawRect.h);
            const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y), x1 = Math.min(width, b.x + b.w), y1 = Math.min(height, b.y + b.h);
            if (x1 <= x0 || y1 <= y0) return;
            ctx.globalCompositeOperation = op; ctx.globalAlpha = clamp(alpha);
            ctx.drawImage(mask, x0 * ratio, y0 * ratio, (x1 - x0) * ratio, (y1 - y0) * ratio, x0, y0, x1 - x0, y1 - y0);
        }
        // skin의 반대: 보스 그림 뒤에 있는 것처럼 알파 바깥에만 남긴다.
        function behind(paint, alpha) {
            if (!spriteRect) { paint(ctx); return; }
            if (alpha <= 0) return;
            maskCtx.globalCompositeOperation = 'source-over'; maskCtx.globalAlpha = 1;
            maskCtx.clearRect(0, 0, width, height);
            paint(maskCtx);
            maskCtx.globalCompositeOperation = 'destination-out'; maskCtx.globalAlpha = 1;
            maskCtx.drawImage(sprite, spriteDrawRect.x, spriteDrawRect.y, spriteDrawRect.w, spriteDrawRect.h);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha);
            ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, width, height);
        }
        // 가장자리가 흐린 작은 빛 덩어리. glow와 같지만 마스크 캔버스에도 그린다.
        function mote(g, x, y, r, c, alpha) {
            if (alpha <= .01 || r <= 0) return;
            const gradient = g.createRadialGradient(x, y, 0, x, y, r);
            gradient.addColorStop(0, rgba(c, 1)); gradient.addColorStop(.35, rgba(c, .4)); gradient.addColorStop(1, rgba(c, 0));
            g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(alpha); g.fillStyle = gradient;
            g.fillRect(x - r, y - r, r * 2, r * 2);
        }

        // ---- 패턴별 효과 ----
        // 청동 피부: 따뜻한 광택이 오른 뒤 대각선 반사광이 몸을 훑고, 굴곡에 반짝임이 맺힌다.
        function sheen(t, delay, fade, reduced) {
            const b = spriteRect;
            if (!b) return;
            const warm = clamp(t / Math.max(.3, delay)) * fade;
            skin((m, b) => {
                const gradient = m.createLinearGradient(b.x, b.y, b.x + b.w * .7, b.y + b.h);
                gradient.addColorStop(0, 'rgba(255,232,180,1)'); gradient.addColorStop(.55, 'rgba(205,130,60,.7)'); gradient.addColorStop(1, 'rgba(70,36,14,.4)');
                m.fillStyle = gradient; m.fillRect(b.x, b.y, b.w, b.h);
            }, warm * .55, 'overlay');
            const active = t - delay;
            if (active >= 0 && active < .3) skin((m, b) => { m.fillStyle = rgba(BRONZE_HOT, 1); m.fillRect(b.x, b.y, b.w, b.h); }, (1 - active / .3) * .35 * fade, 'lighter');
            const cycle = reduced || active < 0 ? -1 : (active % 1.7) / .85;
            const sweepX = cycle >= 0 && cycle <= 1 ? b.x - b.w * .3 + ease(cycle) * b.w * 1.6 : null;
            if (sweepX != null) skin((m, b) => {
                const gradient = m.createLinearGradient(sweepX - b.w * .2, b.y, sweepX + b.w * .2, b.y + b.h * .3);
                gradient.addColorStop(0, 'rgba(255,200,130,0)'); gradient.addColorStop(.42, 'rgba(255,214,150,.45)');
                gradient.addColorStop(.5, 'rgba(255,252,240,1)'); gradient.addColorStop(.58, 'rgba(255,214,150,.45)'); gradient.addColorStop(1, 'rgba(255,200,130,0)');
                m.fillStyle = gradient; m.fillRect(b.x, b.y, b.w, b.h);
            }, .8 * fade, 'lighter');
            if (active < 0 || focus !== FOCUS.sculpture) return;
            GLINTS.forEach(([u, v], i) => {
                const [x, y] = point(u, v);
                const hit = sweepX == null ? 0 : clamp(1 - Math.abs(sweepX - x) / (b.w * .1));
                const idle = reduced ? .35 : .2 + .2 * Math.sin(t * 2.3 + i * 1.7);
                star(x, y, b.w * .035 * (1 + hit), Math.max(idle, hit) * fade);
            });
        }
        function shard(x, y, size, spin, tilt, depth, alpha) {
            const facing = Math.cos(tilt), image = texture('shard');
            // 어두운 배경에서 윤곽이 묻히지 않도록 뒤에 옅은 청동빛을 깐다.
            glow(x, y, size * 1.5, BRONZE, alpha * .22 * Math.min(1, depth));
            ctx.save(); ctx.translate(x, y); ctx.rotate(spin); ctx.scale(.5 + .5 * Math.abs(facing), 1);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(alpha * (.7 + Math.min(1, depth) * .3));
            if (image) {
                // 텍스처는 정사각형 안에 대각선으로 들어 있어 실제 조각은 절반 정도다.
                const h = size * 3.4, w = h * image.naturalWidth / image.naturalHeight;
                ctx.drawImage(image, -w / 2, -h / 2, w, h);
                if (facing > .6) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((facing - .6) * .9 * alpha); ctx.drawImage(image, -w / 2, -h / 2, w, h); }
            } else {
                const light = .45 + .55 * Math.max(0, facing), shade = k => 'rgb(' + Math.round(BRONZE[0] * k) + ',' + Math.round(BRONZE[1] * k * .82) + ',' + Math.round(BRONZE[2] * k * .6) + ')';
                ctx.fillStyle = shade(light * (.45 + depth * .4));
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .55, -size * .1); ctx.lineTo(size * .2, size * .9); ctx.lineTo(-size * .1, 0); ctx.closePath(); ctx.fill();
                ctx.fillStyle = shade((1.1 - light * .5) * (.35 + depth * .3));
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(-size * .1, 0); ctx.lineTo(size * .2, size * .9); ctx.lineTo(-size * .5, size * .3); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = rgba(BRONZE_HOT, .7 * light); ctx.lineWidth = .8;
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(-size * .1, 0); ctx.lineTo(size * .2, size * .9); ctx.stroke();
            }
            ctx.restore();
            if (facing > .93) star(x, y - size * .3, size * .6, (facing - .93) * 10 * alpha * depth);
        }
        // 파편은 시간으로만 계산한다. 재접속해도 같은 위치에서 이어진다.
        function shards(t, fade, reduced) {
            const s = unit(), ground = groundY(), small = width < 420, count = small ? 7 : 12;
            const bottom = scene.y + scene.h * .96, dust = [150, 128, 104];
            // 무대 밖(HUD 아래 입력 영역)으로 번지지 않게 무대 안에만 그린다.
            ctx.save(); ctx.beginPath(); ctx.rect(scene.x, scene.y, scene.w, scene.h); ctx.clip();
            // 예고: 첫 착지 전부터 천장에서 돌가루가 흘러내린다.
            if (t < 2.2) {
                const p = clamp(t / 1.6), out = clamp((2.2 - t) / .4);
                for (let i = 0; i < (small ? 4 : 7); i++) {
                    const x = scene.x + scene.w * (.08 + rand(i + 300) * .84), len = scene.h * (.15 + p * (.3 + rand(i + 301) * .3));
                    const sway = reduced ? 0 : Math.sin(t * 1.3 + i) * scene.w * .004, wide = (5 + rand(i + 302) * 7) * s;
                    const gradient = ctx.createLinearGradient(0, scene.y, 0, scene.y + len);
                    gradient.addColorStop(0, rgba(dust, .5)); gradient.addColorStop(1, rgba(dust, 0));
                    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(p * out * .55 * fade); ctx.fillStyle = gradient;
                    ctx.beginPath(); ctx.moveTo(x - wide, scene.y); ctx.lineTo(x + wide, scene.y); ctx.lineTo(x + sway + wide * .4, scene.y + len); ctx.lineTo(x + sway - wide * .4, scene.y + len); ctx.closePath(); ctx.fill();
                }
            }
            for (let volley = -1; volley < 3; volley++) {
                for (let i = 0; i < (volley < 0 ? count - 4 : count); i++) {
                    const seed = volley * 53 + i * 7 + 101;
                    const fall = volley < 0 ? .9 : .95 + rand(seed + 1) * .25;
                    const land = volley < 0 ? .4 + rand(seed) * 1.5 : 2 + volley + (rand(seed) - .5) * .14;
                    const age = t - (land - fall);
                    if (age < 0 || age > fall + 1.3) continue;
                    const depth = volley < 0 ? .3 + rand(seed + 2) * .25 : .45 + rand(seed + 2) * .55;
                    // 깊이에 따라 착지선이 받침대 뒤쪽에서 화면 앞쪽까지 퍼진다.
                    const x = scene.x + scene.w * (.06 + rand(seed + 3) * .88);
                    const floor = ground - scene.h * .06 + (bottom - ground + scene.h * .06) * clamp((depth - .45) / .55);
                    const size = (14 + rand(seed + 4) * 16) * depth * s * (volley < 0 ? .6 : 1);
                    const top = scene.y - size * 3, drift = (rand(seed + 5) - .5) * scene.w * .08;
                    if (age < fall) {
                        const p = age / fall;
                        // 낙하 지점에 그림자가 짙어지며 좁혀 든다.
                        if (volley >= 0) {
                            ctx.save(); ctx.translate(x, floor); ctx.scale(1, .3);
                            glow(0, 0, size * (3.2 - p * 1.6), [12, 7, 4], (.12 + p * .5) * fade, false);
                            ctx.restore();
                            band(x, floor, size * (3.6 - p * 2.4), size * .35, BRONZE, p * p * .35 * fade, .3);
                        }
                        if (reduced) continue;
                        const y = top + (floor - top) * p * p, px = x - drift * (1 - p), speed = 2 * (floor - top) * p / fall;
                        const trail = Math.min(size * 6, speed * .07), tail = px - drift * .07, w = size * .45;
                        const gradient = ctx.createLinearGradient(tail, y - trail, px, y);
                        gradient.addColorStop(0, rgba(dust, 0)); gradient.addColorStop(1, rgba(BRONZE, .45 * Math.min(1, depth) * fade));
                        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = gradient;
                        ctx.beginPath(); ctx.moveTo(tail, y - trail); ctx.lineTo(px + w, y); ctx.lineTo(px - w, y); ctx.closePath(); ctx.fill();
                        shard(px, y, size, rand(seed + 6) * TAU + age * (1 + rand(seed + 7) * 1.6), age * (2 + rand(seed + 8) * 2.5), depth, fade);
                        continue;
                    }
                    const a = age - fall, weight = Math.min(1, depth);
                    // 착지: 넓은 섬광과 바닥 충격 고리, 튀는 잔조각, 피어오르는 먼지, 눕는 파편.
                    if (a < .14) glow(x, floor, size * 4.5, BRONZE_HOT, (1 - a / .14) * .75 * weight * fade);
                    if (a < .45) band(x, floor, size * (1 + (reduced ? 2 : ease(a / .45) * 7)), size * .7, BRONZE_HOT, (1 - a / .45) * .5 * weight * fade, .28);
                    if (!reduced && a < .6) for (let k = 0; k < (small ? 2 : 4); k++) {
                        const angle = -Math.PI * (.12 + rand(seed + k * 3) * .76), v = (120 + rand(seed + k * 3 + 1) * 200) * s * depth;
                        const vx = Math.cos(angle) * v, vy = Math.sin(angle) * v;
                        const sx = x + vx * a, sy = Math.min(floor, floor + vy * a + 600 * s * a * a);
                        shard(sx, sy, size * (.22 + rand(seed + k * 3 + 2) * .15), angle + a * 9, a * 12 + k, depth, clamp(1 - a / .6) * fade);
                        if (a < .25) {
                            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((1 - a / .25) * fade);
                            ctx.strokeStyle = rgba(BRONZE_HOT, 1); ctx.lineWidth = 2;
                            ctx.beginPath(); ctx.moveTo(sx - vx * .04, sy - vy * .04); ctx.lineTo(sx, sy); ctx.stroke();
                        }
                    }
                    if (a < 1) for (let k = 0; k < 3; k++) {
                        const r = size * (1.4 + (reduced ? 1 : ease(a) * (3 + k * 1.5))), lift = (reduced ? 0 : a) * size * (1 + k) * .8;
                        ctx.save(); ctx.translate(x + (k - 1) * size * a * 1.4, floor - lift); ctx.scale(1, .55);
                        glow(0, 0, r, dust, (1 - a) * (.42 - k * .1) * weight * fade, false);
                        ctx.restore();
                    }
                    shard(x, floor - size * .25, size, rand(seed + 6) * TAU, 1.1, depth * .85, clamp(1 - (a - .9) / .4) * fade);
                }
                // 화면 앞을 스쳐 떨어지는 큰 파편: 초점이 맞지 않아 흐리고, 착지 시각에 화면 아래로 빠진다.
                if (volley < 0 || reduced) continue;
                for (let i = 0; i < (small ? 1 : 2); i++) {
                    const seed = volley * 31 + i * 13 + 900, at = 2 + volley + (rand(seed) - .5) * .1, life = .75;
                    const age = t - (at - life);
                    if (age < 0 || age > life + .15) continue;
                    const side = (i + volley) % 2, p = age / life, size = (40 + rand(seed + 1) * 22) * s;
                    const x = scene.x + scene.w * (side ? .7 + rand(seed + 2) * .24 : .06 + rand(seed + 2) * .24);
                    const y = scene.y - size * 3 + (scene.h + size * 6) * p ** 1.4;
                    ctx.save(); ctx.filter = 'blur(' + (2 * s).toFixed(1) + 'px)';
                    shard(x, y, size, rand(seed + 3) * TAU + age * 1.8, age * 3, 1.6, .8 * fade);
                    ctx.restore();
                }
            }
            // 일제 낙하 순간 바닥 전체에 먼지가 깔리고 바닥이 잠깐 밝아진다. 화면은 흔들지 않는다.
            for (const at of [2, 3, 4]) {
                const d = t - at;
                if (d < 0 || d >= .9) continue;
                if (d < .15) {
                    const gradient = ctx.createLinearGradient(0, ground - scene.h * .2, 0, scene.y + scene.h);
                    gradient.addColorStop(0, rgba(BRONZE_HOT, 0)); gradient.addColorStop(1, rgba(BRONZE_HOT, .22));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((1 - d / .15) * fade); ctx.fillStyle = gradient;
                    ctx.fillRect(scene.x, ground - scene.h * .2, scene.w, scene.y + scene.h - ground + scene.h * .2);
                }
                ctx.save(); ctx.translate(scene.x + scene.w * .5, (ground + bottom) / 2); ctx.scale(1, .2);
                glow(0, 0, scene.w * (.45 + (reduced ? .2 : ease(d / .9) * .4)), dust, (1 - d / .9) * .4 * fade, false);
                ctx.restore();
            }
            ctx.restore();
        }
        // 보라색 공명: 세 번의 점등, 안으로 빨려드는 기운과 방전, 짧은 섬광과 충격파.
        function charge(t, duration, c, hot, burst, fade, reduced) {
            const [x, y] = point(...focus), core = spriteRect ? spriteRect.w * .2 : unit() * 70;
            const p = duration ? clamp(t / duration) : .5, end = duration ? t - duration : -1;
            if (end < 0) {
                glow(x, y, core * (.5 + p * .7), c, (.18 + p * .4) * fade);
                glow(x, y, core * (.18 + p * .3), hot, (.3 + p * .6) * fade);
                if (burst) for (const at of [0, .16, .32]) {
                    const d = t - at;
                    if (d < 0 || d >= .22) continue;
                    glow(x, y, core * 1.1, hot, (1 - d / .22) * .9);
                    band(x, y, core * (.5 + (reduced ? 0 : d * 5)), core * .3, c, (1 - d / .22) * .9);
                }
                if (reduced) return;
                const n = width < 420 ? 8 : 14;
                ctx.lineCap = 'round';
                for (let i = 0; i < n; i++) {
                    const life = .85, ph = ((t + rand(i) * life) % life) / life, base = rand(i + 9) * TAU;
                    if (t < ph * life) continue;
                    const r1 = core * (3.2 - ph * 2.8), r0 = r1 + core * .7, a1 = base + ph * 1.1, a0 = a1 - .35;
                    const gradient = ctx.createLinearGradient(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0, x + Math.cos(a1) * r1, y + Math.sin(a1) * r1);
                    gradient.addColorStop(0, rgba(c, 0)); gradient.addColorStop(1, rgba(hot, 1));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(Math.sin(ph * Math.PI) * (.35 + p * .6) * fade);
                    ctx.strokeStyle = gradient; ctx.lineWidth = 1.2 + p * 1.8;
                    ctx.beginPath(); ctx.moveTo(x + Math.cos(a0) * r0, y + Math.sin(a0) * r0);
                    ctx.quadraticCurveTo(x + Math.cos(a0 + .3) * (r0 + r1) * .5, y + Math.sin(a0 + .3) * (r0 + r1) * .5, x + Math.cos(a1) * r1, y + Math.sin(a1) * r1); ctx.stroke();
                }
                if (p < .2) return;
                const tick = Math.floor(t * 14);
                ctx.globalCompositeOperation = 'lighter';
                for (let k = 0; k < (p > .7 ? 3 : 2); k++) {
                    if (rand(tick * 5 + k) > .3 + p * .55) continue;
                    const angle = rand(tick * 5 + k + 2) * TAU, r = core * (.9 + rand(tick + k) * .8);
                    bolt(ctx, x, y, x + Math.cos(angle) * r, y + Math.sin(angle) * r, tick * 7 + k, c, hot, (.5 + p * .5) * fade, 1.4);
                }
            } else if (burst && end < .65) {
                const e = end / .65, reach = Math.hypot(scene.w, scene.h) * .8, wave = reduced ? .3 : ease(e);
                if (end < .16) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - end / .16) * .4; ctx.fillStyle = rgba(hot, 1); ctx.fillRect(scene.x, scene.y, scene.w, scene.h); }
                glow(x, y, core * (1.4 - e), hot, (1 - e) * .9);
                band(x, y, core * .6 + wave * reach, core * (1 - e * .5), c, (1 - e) * .9);
                band(x, groundY(), core + wave * reach, core * .8, hot, (1 - e) * .5, .25);
            }
        }
        // 되울림: 좌우 원뿔이 차오른 뒤 겹친 파동으로 방출된다. 1초와 4초에 실제 타격.
        function echo(t, fade, reduced) {
            const [x, y] = point(...focus), core = spriteRect ? spriteRect.w * .2 : unit() * 70, length = Math.hypot(scene.w, scene.h) * .6;
            for (const [hit, power] of [[1, 1], [4, 1.35]]) {
                const w = t - (hit - 1);
                if (w < 0 || w > 1.6) continue;
                if (w >= 1 && w < 1.15) glow(x, y, core * 1.2 * power, VIOLET_HOT, (1 - (w - 1) / .15) * .8 * fade);
                for (const dir of [Math.PI * .84, Math.PI * .16]) {
                    const spread = .26 * power;
                    ctx.save(); ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, length, dir - spread, dir + spread); ctx.closePath(); ctx.clip();
                    if (w < 1) {
                        const fill = ease(w), gradient = ctx.createRadialGradient(x, y, core * .4, x, y, length * fill + 1);
                        gradient.addColorStop(0, rgba(VIOLET, .5)); gradient.addColorStop(.85, rgba(VIOLET, .18)); gradient.addColorStop(1, rgba(VIOLET, 0));
                        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(.55 * power * fade); ctx.fillStyle = gradient;
                        ctx.fillRect(x - length, y - length, length * 2, length * 2);
                        ctx.globalAlpha = clamp((.25 + fill * .4) * fade); ctx.strokeStyle = rgba(VIOLET_HOT, 1); ctx.lineWidth = 1.5;
                        for (const edge of [dir - spread, dir + spread]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(edge) * length * fill, y + Math.sin(edge) * length * fill); ctx.stroke(); }
                    } else {
                        const e = (w - 1) / .6;
                        for (let k = 0; k < 3; k++) {
                            const r = core * .6 + length * (reduced ? .3 + k * .2 : ease(clamp(e * 1.15 - k * .12)) * (1 - k * .08));
                            band(x, y, r, core * .35 * power, k ? VIOLET : VIOLET_HOT, (1 - e) * (.9 - k * .2) * fade);
                        }
                    }
                    ctx.restore();
                }
            }
        }
        // 맥동과 역전: 모임은 안으로, 흩어짐은 밖으로 흐른다. 역전은 붉은 소용돌이와 반전된 중심.
        function flow(t, ev, inversion, reduced) {
            const [x, y] = point(...focus), radius = Math.min(scene.w, scene.h) * .42, inward = ev.pulse === 'gather';
            const c = inversion ? RED : VIOLET, hot = inversion ? RED_HOT : VIOLET_HOT, n = width < 420 ? 12 : 20;
            ctx.lineCap = 'round';
            for (let i = 0; i < n; i++) {
                const angle = i / n * TAU + rand(i) * .3, ph = reduced ? .5 : (t * .8 + rand(i + 5)) % 1;
                const at = s => {
                    const curl = inversion ? (inward ? -1.1 : 1.1) * s : 0, r = radius * (.12 + s * .88);
                    return [x + Math.cos(angle + curl) * r, y + Math.sin(angle + curl) * r * .62];
                };
                const head = inward ? 1 - ph : ph, [hx, hy] = at(head), [tx, ty] = at(clamp(inward ? head + .16 : head - .16));
                const alpha = Math.sin(ph * Math.PI) * .85, gradient = ctx.createLinearGradient(tx, ty, hx, hy);
                gradient.addColorStop(0, rgba(c, 0)); gradient.addColorStop(1, rgba(hot, 1));
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha); ctx.strokeStyle = gradient; ctx.lineWidth = 2.2;
                ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
                glow(hx, hy, 5, hot, alpha * .8);
            }
            const beat = reduced ? .5 : (t * 1.2) % 1;
            if (inversion) {
                glow(x, y, radius * .22, [20, 2, 6], .7, false);
                band(x, y, radius * .2, radius * .05, c, .7);
            } else glow(x, y, radius * (inward ? .14 + beat * .06 : .1), hot, inward ? .5 : .25);
            band(x, y, radius * (inward ? 1 - beat * .85 : .15 + beat * .85), radius * .05, c, Math.sin(beat * Math.PI) * .45, .62);
        }
        function shieldShape() {
            const b = spriteRect;
            return b ? [b.x + b.w * .5, b.y + b.h * .52, b.w * .58, b.h * .56] : [scene.x + scene.w * .5, scene.y + scene.h * .55, scene.w * .25, scene.h * .3];
        }
        // 보호막: 가장자리가 짙은 막, 육각 결, 반사광, 테두리의 네 층. 깎일수록 금이 가고 피격 지점에 파문이 남는다.
        function shield(t, state, c, hot, reduced) {
            const ev = state.event, [cx, cy, rx, ry] = shieldShape();
            const strength = ev.kind === 'trial' ? clamp(Number(ev.shield || 0) / Math.max(1, Number(ev.shieldMax || 0))) : 1, appear = clamp(t / .4);
            ctx.save(); ctx.translate(cx, cy); ctx.scale(1, ry / rx);
            const body = ctx.createRadialGradient(0, 0, rx * .5, 0, 0, rx);
            body.addColorStop(0, rgba(c, 0)); body.addColorStop(.8, rgba(c, .1)); body.addColorStop(.97, rgba(c, .42)); body.addColorStop(1, rgba(c, 0));
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = appear * (.55 + .45 * strength); ctx.fillStyle = body;
            ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.fill();
            if (!hexTile) {
                hexTile = document.createElement('canvas'); hexTile.width = 24; hexTile.height = 42;
                const g = hexTile.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 1;
                g.beginPath(); g.moveTo(12, 0); g.lineTo(24, 7); g.lineTo(24, 21); g.lineTo(12, 28); g.lineTo(0, 21); g.lineTo(0, 7); g.closePath(); g.moveTo(12, 28); g.lineTo(12, 42); g.stroke();
            }
            ctx.save(); ctx.clip();
            ctx.translate(0, (reduced ? 0 : (t * 6) % 42) - rx);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = appear * .09 * (.4 + .6 * strength); ctx.fillStyle = ctx.createPattern(hexTile, 'repeat');
            ctx.fillRect(-rx, -42, rx * 2, rx * 2 + 84);
            ctx.restore();
            ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
            const drift = reduced ? 0 : Math.sin(t * .8) * .25;
            ctx.globalAlpha = appear * .55; ctx.strokeStyle = rgba(PALE_HOT, 1); ctx.lineWidth = rx * .035;
            ctx.beginPath(); ctx.arc(0, 0, rx * .9, -2.5 + drift, -1.75 + drift); ctx.stroke();
            ctx.globalAlpha = appear * .25; ctx.lineWidth = rx * .02;
            ctx.beginPath(); ctx.arc(0, 0, rx * .9, .7 + drift, 1.1 + drift); ctx.stroke();
            ctx.globalAlpha = appear * (.35 + .3 * strength); ctx.strokeStyle = rgba(hot, 1); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.stroke();
            for (let i = 0; i < Math.floor((1 - strength) * 8); i++) {
                const angle = rand(i + 40) * TAU, r0 = rx * (.96 - rand(i + 41) * .1), r1 = rx * (.55 + rand(i + 42) * .2);
                bolt(ctx, Math.cos(angle) * r0, Math.sin(angle) * r0, Math.cos(angle + .2) * r1, Math.sin(angle + .2) * r1, i * 13, c, hot, appear * .6, 1);
            }
            const now = performance.now();
            for (const hit of state.hits) {
                const d = (now - hit.at) / 1000;
                if (d > .45) continue;
                const hx = Math.cos(hit.angle) * rx * .92, hy = Math.sin(hit.angle) * rx * .92;
                ctx.save(); ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU); ctx.clip();
                glow(hx, hy, rx * .25, hot, (1 - d / .45) * .8);
                band(hx, hy, rx * (.05 + d * .9), rx * .06, c, (1 - d / .45) * .7);
                ctx.restore();
            }
            ctx.restore();
        }
        function shatter(t) {
            const e = clamp(t / .65), [cx, cy, rx, ry] = shieldShape(), n = width < 420 ? 10 : 16;
            if (e >= 1) return;
            band(cx, cy, rx * (1 + ease(e) * .4), rx * .12, PALE_HOT, (1 - e) * .9, ry / rx);
            for (let i = 0; i < n; i++) {
                const angle = i / n * TAU + rand(i) * .3, v = rx * (.5 + rand(i + 3) * .7), size = rx * (.06 + rand(i + 5) * .06);
                const px = cx + Math.cos(angle) * (rx + v * e), py = cy + Math.sin(angle) * (ry + v * e * ry / rx) + 160 * e * e;
                ctx.save(); ctx.translate(px, py); ctx.rotate(angle + e * (4 + rand(i + 7) * 6));
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - e) * .8;
                ctx.fillStyle = rgba(PALE, .5); ctx.strokeStyle = rgba(PALE_HOT, 1); ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(0, -size); ctx.lineTo(size * .8, size * .6); ctx.lineTo(-size * .7, size * .4); ctx.closePath(); ctx.fill(); ctx.stroke();
                ctx.restore();
            }
        }
        // 정화: 어두운 연기 장막이 중앙부터 걷혀 실제 배경을 드러낸다. 절반 해상도로 따로 그린다.
        function drawMist(now, dt, reduced) {
            if (!scene.w || !scene.h) return;
            mist.shown += (mist.target - mist.shown) * (1 - Math.exp(-dt / .25));
            const dissolve = mist.doneAt ? clamp((now - mist.doneAt) / 600) : 0;
            const reveal = mist.shown + (1 - mist.shown) * ease(dissolve);
            const w = Math.max(1, Math.round(scene.w * .5)), h = Math.max(1, Math.round(scene.h * .5));
            if (fog.width !== w || fog.height !== h) { fog.width = w; fog.height = h; }
            const g = fogCtx, image = texture('mist') || puff(), time = reduced ? 0 : now / 1000;
            g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
            const veil = g.createLinearGradient(0, 0, 0, h);
            veil.addColorStop(0, 'rgba(7,6,9,.86)'); veil.addColorStop(.6, 'rgba(12,8,10,.9)'); veil.addColorStop(1, 'rgba(24,6,9,.94)');
            g.fillStyle = veil; g.fillRect(0, 0, w, h);
            for (let i = 0; i < (w < 240 ? 9 : 14); i++) {
                const size = (.45 + rand(i + 11) * .5) * Math.max(w, h);
                const px = ((rand(i) + time * .006 * (.5 + rand(i + 3))) % 1.3 - .15) * w;
                const py = (rand(i + 7) * 1.1 - .05) * h + Math.sin(time * .15 + i) * h * .02;
                g.globalAlpha = .4 + rand(i + 13) * .35;
                g.drawImage(image, px - size / 2, py - size * .31, size, size * .62);
            }
            g.globalCompositeOperation = 'source-atop'; g.globalAlpha = .75 + (reduced ? 0 : Math.sin(time * .5) * .15);
            const ember = g.createRadialGradient(w * .5, h * 1.1, 0, w * .5, h * 1.1, h * .95);
            ember.addColorStop(0, 'rgba(130,16,24,.45)'); ember.addColorStop(1, 'rgba(130,16,24,0)');
            g.fillStyle = ember; g.fillRect(0, 0, w, h);
            if (reveal > 0) {
                // 무대 비율에 맞춘 타원으로 걷어 낸다. 걷힌 넓이가 진행도와 비슷하게 늘고, 100%에서 모서리까지 맑아진다.
                const cx = w * .5, cy = h * .56, squash = h / w, r = w * .5 * 1.55 * reveal ** .7, inner = .5 + .5 * reveal;
                const hole = g.createRadialGradient(0, 0, r * inner, 0, 0, r + 1);
                // 진행 초반에는 걷힌 중앙에도 옅은 연기가 남는다.
                hole.addColorStop(0, 'rgba(0,0,0,' + (.8 + .2 * reveal) + ')'); hole.addColorStop(1, 'rgba(0,0,0,0)');
                g.save(); g.translate(cx, cy); g.scale(1, squash);
                g.globalCompositeOperation = 'destination-out'; g.globalAlpha = 1; g.fillStyle = hole; g.fillRect(-w, -w * 1.2, w * 2, w * 2.4);
                g.restore();
                // 가장자리를 연기 모양으로 갉아 타원 경계가 드러나지 않게 한다.
                g.globalAlpha = .45;
                for (let k = 0; k < 12; k++) {
                    const angle = k / 12 * TAU + time * .03, rr = r * (inner + (1 - inner) * .3) * (.85 + rand(k + 20) * .2), size = Math.max(8, Math.min(r * .5, h * .7));
                    g.drawImage(image, cx + Math.cos(angle) * rr - size / 2, cy + Math.sin(angle) * rr * squash - size * .31, size, size * .62);
                }
            }
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 - dissolve;
            ctx.drawImage(fog, scene.x, scene.y, scene.w, scene.h);
        }

        // ---- 일반 레이드 신호 ----
        const body = () => spriteRect || { x: scene.x + scene.w * .3, y: scene.y + scene.h * .2, w: scene.w * .4, h: scene.h * .6 };
        // 공개된 대상의 파티 카드 쪽으로 방향만 잡는다. 카드가 없으면 무대 가운데.
        function memberX(name) {
            const card = name && document.querySelector('.pq-char-card[data-member="' + CSS.escape(name) + '"]');
            let x = card ? card.getBoundingClientRect().left + card.offsetWidth / 2 - canvas.getBoundingClientRect().left : scene.x + scene.w / 2;
            // 낮은 가로 화면은 파티가 무대 옆에 있다. 각 대상을 같은 모서리에 몰지 않는다.
            if (card && (x < scene.x || x > scene.x + scene.w)) {
                const cards = [...document.querySelectorAll('.pq-char-card[data-member]')];
                x = scene.x + scene.w * (.15 + .7 * (cards.indexOf(card) + .5) / cards.length);
            }
            return Math.max(scene.x + 16, Math.min(scene.x + scene.w - 16, x));
        }
        // 알파 재질을 회전, 압축해 그린다. 연기는 일반 합성, 불과 회복광은 가산 합성이다.
        function material(g, image, x, y, w, h, alpha, angle = 0, flip = 1) {
            if (!image || alpha <= .01) return;
            g.save(); g.translate(x, y); g.rotate(angle); g.scale(flip, 1); g.globalAlpha = clamp(alpha);
            g.drawImage(image, -w / 2, -h / 2, w, h); g.restore();
        }
        // 화염 애니메이션 시트의 한 프레임. 밑동(셀 높이 95%)을 고정하고 크기와 기울기는 움직이지 않는다.
        // 불마다 20~25fps와 시작 프레임이 달라 같은 모양이 나란히 반복되지 않는다.
        function fireFrame(x, base, size, t, seed, alpha, reduced) {
            const sheet = fireSheet();
            if (!sheet || alpha <= .01 || size < 2) return;
            const cell = sheet.width / 5, offset = Math.floor(rand(seed + 1) * 25);
            const f = reduced ? offset : (Math.floor(t * (20 + rand(seed) * 5)) + offset) % 25;
            ctx.save(); ctx.translate(x, base); if (rand(seed + 2) > .5) ctx.scale(-1, 1);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha);
            ctx.drawImage(sheet, (f % 5) * cell, Math.floor(f / 5) * cell, cell, cell, -size / 2, -size * .95, size, size);
            ctx.restore();
        }
        function embers(x0, w, base, rise, n, t, seed, alpha) {
            for (let i = 0; i < n; i++) {
                const ph = (t * (.35 + rand(seed + i) * .3) + rand(seed + i + 1)) % 1;
                const x = x0 + w * rand(seed + i + 2) + Math.sin(ph * 5 + i) * w * .02;
                glow(x, base - ph * rise, (3 + rand(seed + i + 3) * 3) * unit(), [255, 150, 60], Math.sin(ph * Math.PI) * alpha);
            }
        }
        // 날카로운 십자 반짝임. 거울면과 반격에 쓴다.
        function glint(x, y, r, angle, alpha) {
            if (alpha <= .01) return;
            ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(alpha); ctx.fillStyle = 'rgb(248,252,255)';
            ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(0, -r * .07); ctx.lineTo(r, 0); ctx.lineTo(0, r * .07); ctx.closePath();
            ctx.moveTo(0, -r * .55); ctx.lineTo(r * .06, 0); ctx.lineTo(0, r * .55); ctx.lineTo(-r * .06, 0); ctx.closePath(); ctx.fill();
            ctx.restore();
        }
        // 흑화 증폭: 무거운 연기가 몸으로 응축되고, 기존 그림의 붉은 결만 낮게 맥동한다.
        function empower(t, fade, reduced, seed) {
            const b = body(), image = texture('mist') || puff(), [cx, cy] = point(.5, .65), h = Math.min(b.h, scene.h), sink = ease(clamp(t / .9)) * fade;
            if (!reduced && t < 1.15) for (let i = 0; i < 4; i++) {
                const p = ease(clamp((t - i * .08) / .75)), side = i % 2 ? 1 : -1;
                const x = cx + side * b.w * (.62 - p * .43), y = cy + h * (.12 - i * .09) * (1 - p);
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, image, x, y, b.w * (.58 - p * .22), h * (.7 - p * .25), Math.sin(p * Math.PI) * .35 * fade, side * p * .3);
            }
            skin((m, b) => {
                const g = m.createRadialGradient(cx, cy, h * .06, cx, cy, b.w * .62);
                g.addColorStop(0, 'rgba(24,4,10,.85)'); g.addColorStop(1, 'rgba(40,20,30,.15)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                for (let i = 0; i < 3; i++) {
                    const drift = reduced ? 0 : Math.sin(t * .6 + i) * h * .025;
                    material(m, image, b.x + b.w * (.25 + i * .25), cy + drift, b.w * .5, h * .8, .45, i * .6 + (reduced ? 0 : t * .06));
                }
            }, (.4 + (t < 1.2 ? .1 * Math.sin(clamp((t - .7) / .5) * Math.PI) : 0)) * sink, 'multiply');
            const phase = t % 1.8, beat = reduced ? .3 : Math.exp(-(((phase - .12) / .1) ** 2)) + .5 * Math.exp(-(((phase - .38) / .1) ** 2));
            // 알파 내부의 연기 결을 재사용해 직선 번개 대신 낮은 진홍색 맥을 남긴다.
            skin((m, b) => {
                material(m, image, cx, cy, b.w * .9, h, .8, reduced ? 0 : Math.sin(t * .4) * .08);
            }, (.12 + .2 * beat) * sink, 'lighter');
            ctx.globalCompositeOperation = 'source-over';
            material(ctx, image, cx, groundY(), b.w * .9, h * .28, .22 * sink, reduced ? 0 : Math.sin(t * .2) * .04);
        }
        // 재생: 옆구리와 아랫몸 주변의 작은 빛 알갱이가 곡선을 그리며 몸의 여러 지점으로 모이고,
        // 닿은 자리의 보스 알파 안에서만 잠깐 번진 뒤 사라진다. 일부는 몸 뒤로 지나가 가려진다.
        function regenerate(t, duration, reduced, seed) {
            const b = body(), ground = groundY(), h = Math.min(b.h, scene.h * .85), cx = b.x + b.w / 2, u = unit(), n = width < 420 ? 9 : 14;
            const MINT = [150, 232, 190], GOLD = [255, 220, 150], WHITE = [255, 250, 232], out = clamp((duration - t) / .3);
            const front = [], back = [], blooms = [];
            for (let i = 0; i < n; i++) {
                const s = seed + i * 11, side = rand(s) < .5 ? -1 : 1, warm = rand(s + 11) < .45;
                // 출발 시각을 구간별로 나눠 한꺼번에 몰리지 않게 한다.
                const born = duration * .4 * (i + rand(s + 1)) / n, life = duration * (.38 + rand(s + 2) * .14);
                const [tx, ty] = point(.3 + rand(s + 3) * .4, .38 + rand(s + 4) * .45);
                blooms.push([tx, ty, born + life, rand(s + 5), warm]);
                const q = (t - born) / life;
                if (reduced || q <= 0 || q >= 1) continue;
                const sx = cx + side * b.w * (.4 + rand(s + 6) * .3), sy = ground - h * (.1 + rand(s + 7) * .35);
                const mx = (sx + tx) / 2 + side * b.w * (.08 + rand(s + 8) * .12), my = Math.min(sy, ty) - h * (.04 + rand(s + 9) * .1);
                const k = q * q * (3 - 2 * q), sink = clamp((q - .65) / .35), absorb = 1 - sink * sink * (3 - 2 * sink);
                const x = (1 - k) ** 2 * sx + 2 * (1 - k) * k * mx + k * k * tx, y = (1 - k) ** 2 * sy + 2 * (1 - k) * k * my + k * k * ty;
                (rand(s + 12) < .4 ? back : front).push([x, y, (4 + rand(s + 10) * 5) * u * (.35 + .65 * absorb), warm ? GOLD : MINT, clamp(q / .2) * absorb, rand(s + 13) < .25]);
            }
            const paint = (g, list, dim) => list.forEach(([x, y, r, c, a, spark]) => {
                mote(g, x, y, r * 2.2, c, a * .3 * dim);
                mote(g, x, y, r * .6, spark ? WHITE : c, a * (spark ? .85 : .5) * dim);
            });
            behind(g => paint(g, back, .7), out);
            paint(ctx, front, out);
            skin(m => {
                const lift = m.createLinearGradient(0, ground, 0, ground - h * .7);
                lift.addColorStop(0, rgba(MINT, .5)); lift.addColorStop(1, rgba(MINT, 0));
                m.globalAlpha = .2 * clamp(t / (duration * .8)); m.fillStyle = lift; m.fillRect(b.x, b.y, b.w, b.h);
                for (const [x, y, at, v, warm] of blooms) {
                    // 동작 줄이기는 이동 없이 닿을 자리만 천천히 밝아졌다가 사라진다.
                    let a;
                    if (reduced) a = .45 * Math.sin(clamp(t / duration) * Math.PI);
                    else {
                        const x0 = (t - at + .06) / .4;
                        if (x0 <= 0 || x0 >= 1) continue;
                        a = .7 * (x0 < .25 ? x0 / .25 : (1 - (x0 - .25) / .75) ** 2);
                    }
                    mote(m, x, y, h * (.05 + v * .04), warm ? GOLD : MINT, a);
                }
            }, .9 * out, 'lighter');
        }
        // 파멸의 정화: 무대 아래 파티 쪽에서 잿빛 생명줄이 보스로 빨려 올라가고, 끝나면 몸이 붉게 차오른다.
        function purge(t, duration, reduced, seed) {
            const [x, y] = point(...focus), b = body(), bottom = scene.y + scene.h, end = t - duration, n = width < 420 ? 4 : 6, u = unit();
            const p = clamp(t / duration), ASH = [216, 208, 222], BLOOD = [196, 24, 48], BLOOD_HOT = [255, 170, 170];
            if (end < 0) {
                ctx.lineCap = 'round';
                for (let i = 0; i < n; i++) {
                    const sx = scene.x + scene.w * (.1 + .8 * i / (n - 1)), mx = (sx + x) / 2 + (sx - x) * .25, my = (bottom + y) / 2;
                    if (reduced) continue;
                    for (let k = 0; k < 2; k++) {
                        const ph = (t * .9 + rand(seed + i * 2 + k)) % 1, s = ph ** 1.6, a = Math.sin(ph * Math.PI);
                        const dx = (1 - s) ** 2 * sx + 2 * (1 - s) * s * mx + s * s * x, dy = (1 - s) ** 2 * bottom + 2 * (1 - s) * s * my + s * s * y;
                        glow(dx, dy, 5 * u, BLOOD, a * (.4 + p * .5));
                        glow(dx, dy, 2 * u, BLOOD_HOT, a * (.5 + p * .5));
                    }
                }
                glow(x, y, b.w * (.12 + p * .12), [10, 2, 6], .35 * p, false);
                skin((m, b) => {
                    const g = m.createRadialGradient(x, y, 0, x, y, b.w * .35);
                    g.addColorStop(0, rgba(ASH, .2)); g.addColorStop(1, rgba(ASH, 0));
                    m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                }, p * .25, 'lighter');
            } else if (end < .65) {
                const e = end / .65;
                skin((m, b) => { m.fillStyle = rgba(BLOOD, 1); m.fillRect(b.x, b.y, b.w, b.h); }, (1 - e) * .45, 'lighter');
                glow(x, y, b.w * .15, BLOOD_HOT, (1 - e) * .3);
            }
        }
        // 종언: 무대 가장자리가 어두워지며 맥박이 빨라지고, 몸을 가르는 붉은 선이 길어진 뒤 한 번에 베어 낸다.
        function execute(t, duration, reduced, seed) {
            const [x, y] = point(.5, .45), end = t - duration, p = clamp(t / duration), reach = Math.hypot(scene.w, scene.h) * .5, u = unit();
            const angle = -.55 + (rand(seed) - .5) * .3, dx = Math.cos(angle), dy = Math.sin(angle), fall = end < 0 ? 1 : clamp(1 - end / .65);
            const beat = reduced || end >= 0 ? 0 : Math.max(0, Math.sin(t * TAU * (.8 + p * .9))) ** 8;
            const vignette = ctx.createRadialGradient(x, y, Math.min(scene.w, scene.h) * (.42 - p * .14), x, y, reach * 1.2);
            vignette.addColorStop(0, 'rgba(6,0,4,0)'); vignette.addColorStop(1, 'rgba(6,0,4,1)');
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp((.25 + p * .4 + beat * .12) * fall); ctx.fillStyle = vignette;
            ctx.fillRect(scene.x, scene.y, scene.w, scene.h);
            ctx.lineCap = 'round';
            if (end < 0) {
                const len = reach * .55 * (reduced ? 1 : ease(p)), flicker = reduced ? 1 : .75 + .25 * Math.sin(t * 31);
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((.25 + p * .4) * flicker); ctx.strokeStyle = rgba(RED, 1); ctx.lineWidth = 4;
                ctx.beginPath(); ctx.moveTo(x - dx * len, y - dy * len); ctx.lineTo(x + dx * len, y + dy * len); ctx.stroke();
                ctx.globalAlpha = clamp((.4 + p * .6) * flicker); ctx.strokeStyle = rgba(RED_HOT, 1); ctx.lineWidth = 1; ctx.stroke();
            } else if (end < .65) {
                const e = end / .65, len = reach * 1.2, nx = -dy, ny = dx, shift = (reduced ? 0 : ease(e)) * 10 * u;
                if (end < .1) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = (1 - end / .1) * .35; ctx.fillStyle = 'rgb(60,0,10)'; ctx.fillRect(scene.x, scene.y, scene.w, scene.h); }
                ctx.globalCompositeOperation = 'lighter';
                for (const [c, w, a] of [[RED, 16, .5], [RED_HOT, 6, 1]]) {
                    const half = w * u * (1 - e);
                    ctx.globalAlpha = clamp((1 - e) * a); ctx.fillStyle = rgba(c, 1);
                    ctx.beginPath(); ctx.moveTo(x - dx * len, y - dy * len); ctx.lineTo(x + nx * half, y + ny * half); ctx.lineTo(x + dx * len, y + dy * len); ctx.lineTo(x - nx * half, y - ny * half); ctx.closePath(); ctx.fill();
                }
                // 베인 자리가 양쪽으로 벌어지는 잔상.
                ctx.globalAlpha = clamp((1 - e) * .4); ctx.strokeStyle = rgba(RED_HOT, 1); ctx.lineWidth = 1;
                for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x - dx * len * .6 + nx * shift * side, y - dy * len * .6 + ny * shift * side); ctx.lineTo(x + dx * len * .6 + nx * shift * side, y + dy * len * .6 + ny * shift * side); ctx.stroke(); }
            }
        }
        // 화염 폭발: 바닥 곳곳의 작은 불씨가 천천히 달아오르고, 완료 신호에서만 한 번 분출해 위로 말려 오른다.
        // 몸 아래쪽이 잠깐 밝아지고, 연기는 계속 올라가며 흩어진다. 크기는 분출 때 한 번만 커졌다가 줄어든다.
        function flame(t, duration, reduced, seed) {
            const b = body(), ground = groundY(), end = t - duration, p = clamp(t / duration), cx = b.x + b.w / 2, u = unit(), h = Math.min(b.h, scene.h);
            const light = (strength, radius) => skin((m, b) => {
                const g = m.createRadialGradient(cx, ground, h * .03, cx, ground, radius);
                g.addColorStop(0, 'rgba(255,174,84,.8)'); g.addColorStop(.35, 'rgba(235,72,20,.25)'); g.addColorStop(1, 'rgba(180,34,10,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
            }, strength, 'lighter');
            // 바닥 불씨: 간격, 깊이, 크기, 점화 시각이 모두 다르다.
            const n = width < 420 ? 4 : 6, sources = [];
            for (let i = 0; i < n; i++) {
                const s = seed + i * 7;
                sources.push({ s, x: cx + b.w * (-.44 + .88 * (i + .15 + rand(s) * .7) / n), y: ground - h * rand(s + 3) * .05, size: h * (.11 + rand(s + 4) * .1), on: rand(s + 5) * .55 });
            }
            if (end < 0) {
                light(.1 + p * .22, h * (.28 + p * .22));
                ctx.save(); ctx.translate(cx, ground); ctx.scale(1, .12);
                glow(0, 0, b.w * .42, [235, 82, 22], .1 + p * .15);
                ctx.restore();
                for (const f of sources) {
                    const lit = ease(clamp((p - f.on) / .35));
                    fireFrame(f.x, f.y, f.size * (.55 + .45 * ease(p)), t, f.s, (.3 + .25 * p) * lit, reduced);
                }
                if (!reduced) embers(cx - b.w * .25, b.w * .5, ground, h * .45, width < 420 ? 5 : 8, t, seed + 50, .4);
            } else if (end < 1.5) {
                const image = texture('mist') || puff();
                light(end < .1 ? .45 * end / .1 : .45 * (1 - clamp((end - .1) / .55)) ** 2, h * .6);
                // 연기는 불길보다 늦게 나와 계속 올라가며 옅어진다.
                ctx.globalCompositeOperation = 'source-over';
                for (let i = 0; i < 4; i++) {
                    const k = clamp((end - .08 - i * .06) / 1.3), s = seed + 40 + i * 3;
                    if (k <= 0 || k >= 1) continue;
                    const x = cx + (rand(s) - .5) * b.w * .6 + (rand(s + 1) - .5) * b.w * .2 * k, size = h * (.35 + .35 * k);
                    material(ctx, image, x, ground - h * (.12 + .5 * (reduced ? 0 : ease(k))), size, size * .7, Math.sin(k * Math.PI) * .28, (rand(s + 2) - .5) * .4);
                }
                // 예열 불씨는 분출에 흡수되듯 바로 꺼진다.
                for (const f of sources) fireFrame(f.x, f.y, f.size, t, f.s, .55 * (1 - clamp(end / .3)), reduced);
                for (let i = 0; i < (width < 420 ? 3 : 4); i++) {
                    const s = seed + 30 + i * 5, age = end - (reduced ? 0 : i * .05 + rand(s + 3) * .04), q = age / .9;
                    if (age < 0 || q >= 1) continue;
                    const grow = reduced ? 1 : ease(clamp(age / .2)), size = h * (.3 + rand(s + 4) * .12) * (.5 + .5 * grow) * (1 - .25 * q);
                    const x = cx + (rand(s + 5) - .5) * b.w * .5 + (rand(s + 6) - .5) * b.w * .15 * q, rise = reduced ? 0 : h * .16 * ease(q);
                    fireFrame(x, ground - rise, size, t, s, .8 * (1 - q) ** 1.5 * clamp(age / .06), reduced);
                }
                if (!reduced) for (let i = 0; i < (width < 420 ? 8 : 12); i++) {
                    const a = end - rand(seed + i + 60) * .08;
                    if (a < 0 || a > 1.1) continue;
                    const vx = (rand(seed + i + 61) - .5) * h * .9, vy = h * (.35 + rand(seed + i + 62) * .4);
                    const x = cx + (rand(seed + i + 63) - .5) * h * .4 + vx * a, y = ground - vy * a + h * .75 * a * a;
                    if (y > ground) continue;
                    glow(x, y, (2 + rand(seed + i + 64) * 2) * u, [255, 162, 74], .65 * (1 - a / 1.1));
                }
            }
        }
        // 천국의 대포: 무대 위쪽에 열린 하늘 구멍에서 조준선이 좁혀 들고, 끝나면 포탄이 아래로 내리꽂힌다.
        function cannon(t, duration, ev, reduced, seed) {
            const end = t - duration, p = clamp(t / duration), aim = scene.y + scene.h * .93, u = unit(), SKY = [160, 206, 255], SKY_HOT = [240, 248, 255];
            const names = ev.targets || [];
            for (let k = 0; k < (names.length || 2); k++) {
                const ox = scene.x + scene.w * (.25 + .5 * rand(seed + k * 3)), oy = scene.y + scene.h * .04;
                const tx = names[k] ? memberX(names[k]) : scene.x + scene.w * (.15 + .7 * rand(seed + k * 3 + 1));
                const ang = Math.atan2(aim - oy, tx - ox), nx = -Math.sin(ang), ny = Math.cos(ang);
                if (end < 0) {
                    band(ox, oy, scene.w * .05 * (.4 + .6 * ease(p)), 6 * u, SKY_HOT, .6 * ease(clamp(t / .4)), .3);
                    const spread = scene.w * .08 * (1 - (reduced ? .5 : ease(p))) + 1.5;
                    const g = ctx.createLinearGradient(ox, oy, tx, aim);
                    g.addColorStop(0, rgba(SKY, .5)); g.addColorStop(1, rgba(SKY, .05));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(.25 + p * .5); ctx.fillStyle = g;
                    ctx.beginPath(); ctx.moveTo(ox - nx * 2, oy - ny * 2); ctx.lineTo(ox + nx * 2, oy + ny * 2); ctx.lineTo(tx + nx * spread, aim + ny * spread); ctx.lineTo(tx - nx * spread, aim - ny * spread); ctx.closePath(); ctx.fill();
                    // 착탄점은 조준 기호 대신 바닥에 응축되는 푸른 빛과 떨어지는 먼지로 표시한다.
                    ctx.save(); ctx.translate(tx, aim); ctx.scale(1, .25);
                    glow(0, 0, (26 - p * 12) * u, SKY, .15 + p * .3); ctx.restore();
                    if (!reduced) for (let i = 0; i < 3; i++) {
                        const q = (t * 1.2 + i / 3) % 1;
                        glow(tx + (rand(seed + i + 90) - .5) * 14 * u, aim - (1 - q) * 65 * u, 2 * u, SKY_HOT, q * .25);
                    }
                } else if (end < .65) {
                    const e = end / .65, travel = reduced ? 1 : clamp(end / .18), len = Math.hypot(tx - ox, aim - oy);
                    const hx = ox + (tx - ox) * travel, hy = oy + (aim - oy) * travel, trail = Math.min(len * .35, len * travel);
                    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
                    for (const [c, w] of [[SKY, 9], [SKY_HOT, 3]]) {
                        ctx.globalAlpha = clamp(1 - e); ctx.strokeStyle = rgba(c, 1); ctx.lineWidth = w * u;
                        ctx.beginPath(); ctx.moveTo(hx - Math.cos(ang) * trail, hy - Math.sin(ang) * trail); ctx.lineTo(hx, hy); ctx.stroke();
                    }
                    if (travel >= 1) {
                        glow(tx, aim, 40 * u, SKY_HOT, (1 - e) * .8);
                        band(tx, aim, (10 + (reduced ? 30 : ease(e) * 60)) * u, 8 * u, SKY, (1 - e) * .7, .3);
                    }
                }
            }
        }
        // 폭주지대: 바닥의 몇 군데가 불규칙하게 타오른다. 시전 단계는 없다.
        function berserk(t, reduced, seed) {
            const ground = groundY(), bottom = scene.y + scene.h, top = ground - scene.h * .1;
            const g = ctx.createLinearGradient(0, top, 0, bottom);
            g.addColorStop(0, 'rgba(255,80,20,0)'); g.addColorStop(1, 'rgba(255,80,20,.15)');
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = .8; ctx.fillStyle = g;
            ctx.fillRect(scene.x, top, scene.w, bottom - top);
            // 고정된 바닥 지점마다 실제 화염 프레임만 돈다. 높이는 지점별로 다르되 시간에 따라 변하지 않는다.
            const n = width < 420 ? 4 : 5;
            for (let i = 0; i < n; i++) {
                const s = seed + i * 5, x = scene.x + scene.w * (.06 + .88 * (i + .1 + rand(s + 3) * .8) / n);
                const y = ground + (bottom - ground) * rand(s + 4) * .6;
                fireFrame(x, y, scene.h * (.12 + rand(s + 5) * .1), t, s, .5, reduced);
            }
            if (!reduced) embers(scene.x, scene.w, bottom, scene.h * .5, width < 420 ? 6 : 10, t, seed + 200, .4);
        }
        // 칠흑의 방패: 몸의 표면에 흑요석 같은 어두운 반사막이 닫힌다.
        function darkShield(t, fade, reduced) {
            const b = body(), h = Math.min(b.h, scene.h * .85), ground = groundY(), mistImage = texture('mist') || puff();
            const show = ease(clamp(t / .35)) * fade;
            skin((m, b) => {
                const g = m.createLinearGradient(0, ground - h * .7, 0, ground);
                g.addColorStop(0, 'rgba(18,22,34,0)'); g.addColorStop(.4, 'rgba(18,22,34,.65)'); g.addColorStop(1, 'rgba(8,10,18,.9)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
                material(m, mistImage, b.x + b.w * .5, ground - h * .25, b.w, h * .8, .35);
            }, .52 * show, 'multiply');
            const sweep = reduced ? .5 : (t / 2.8) % 1;
            skin((m, b) => {
                const x = b.x + b.w * (-.2 + sweep * 1.4), g = m.createLinearGradient(x - h * .12, ground - h * .6, x + h * .12, ground);
                g.addColorStop(0, 'rgba(140,152,176,0)'); g.addColorStop(.46, 'rgba(98,112,138,.12)');
                g.addColorStop(.5, 'rgba(190,202,218,.5)'); g.addColorStop(.54, 'rgba(98,112,138,.12)'); g.addColorStop(1, 'rgba(140,152,176,0)');
                m.fillStyle = g; m.fillRect(b.x, ground - h * .65, b.w, h * .65);
            }, .4 * show, 'lighter');
            if (!reduced && t < .8) for (let i = 0; i < 2; i++) {
                const p = ease(clamp(t / .8)), side = i ? 1 : -1;
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, mistImage, b.x + b.w * (.5 + side * (.48 - p * .18)), ground - h * .28, h * .7, h * .55, Math.sin(p * Math.PI) * .3, side * .2);
            }
        }
        // 모찌나간다: 말랑한 반투명 막이 튕기듯 부풀어 오르고 숨 쉬듯 출렁인다.
        function mochiShield(t, fade, reduced) {
            const [cx, cy, rx, ry] = shieldShape(), pop = reduced ? 1 : 1 - Math.exp(-7 * t) * Math.cos(12 * t), breath = reduced ? 0 : Math.sin(t * 2.4) * .03;
            if (pop <= .01) return;
            ctx.save(); ctx.translate(cx, cy + ry * .04); ctx.scale(pop * (1 + breath), pop * (1 - breath) * ry / rx);
            ctx.beginPath();
            for (let i = 0; i <= 48; i++) {
                const a = i / 48 * TAU, r = rx * (1 + (reduced ? 0 : .025 * Math.sin(3 * a + t * 2.2) + .015 * Math.sin(5 * a - t * 3.1)));
                if (i) ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); else ctx.moveTo(r, 0);
            }
            ctx.closePath();
            const fill = ctx.createRadialGradient(0, -rx * .1, rx * .45, 0, 0, rx * 1.03);
            fill.addColorStop(0, 'rgba(255,240,244,0)'); fill.addColorStop(.8, 'rgba(255,232,238,.16)'); fill.addColorStop(1, 'rgba(255,214,226,.42)');
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(fade); ctx.fillStyle = fill; ctx.fill();
            ctx.strokeStyle = 'rgba(255,244,247,.6)'; ctx.lineWidth = 2; ctx.stroke();
            ctx.translate(-rx * .38, -rx * .52); ctx.rotate(-.5); ctx.scale(1, .32);
            glow(0, 0, rx * .2, [255, 250, 252], .35 * fade);
            ctx.restore();
        }
        // 레인! 도와줘!: 보스 위로 빗줄기가 떨어져 둥근 물막에 부딪히고 표면을 타고 흘러내린다.
        function rainShield(t, fade, reduced, seed) {
            const [cx, cy, rx, ry] = shieldShape(), ground = Math.max(cy, groundY()), u = unit(), WATER = [140, 200, 236], WATER_HOT = [226, 244, 255];
            const appear = clamp(t / .5) * fade, surface = x => Math.abs(x - cx) < rx ? cy - ry * Math.sqrt(1 - ((x - cx) / rx) ** 2) : ground;
            ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, TAU); ctx.lineTo(cx + rx, ground); ctx.lineTo(cx - rx, ground); ctx.closePath();
            const g = ctx.createLinearGradient(0, cy - ry, 0, ground);
            g.addColorStop(0, rgba(WATER, .16)); g.addColorStop(1, rgba(WATER, .03));
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = appear; ctx.fillStyle = g; ctx.fill();
            ctx.globalAlpha = appear * .5; ctx.strokeStyle = rgba(WATER_HOT, 1); ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 1.06, Math.PI * 1.94); ctx.stroke();
            ctx.lineCap = 'round';
            const n = width < 420 ? 14 : 24, len = 16 * u;
            for (let i = 0; i < n; i++) {
                const x = scene.x + scene.w * (i + rand(seed + i)) / n, stop = surface(x);
                const ph = reduced ? rand(seed + i + 9) : (t * (1.3 + rand(seed + i + 1) * .5) + rand(seed + i + 2)) % 1;
                const y = scene.y - len + (stop - scene.y + len) * ph, tail = Math.max(scene.y, y), head = Math.min(stop, y + len);
                if (head <= tail) continue;
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = appear * .35; ctx.strokeStyle = rgba(WATER_HOT, 1); ctx.lineWidth = 1.1;
                ctx.beginPath(); ctx.moveTo(x, tail); ctx.lineTo(x + (head - tail) * .12, head); ctx.stroke();
                if (!reduced && y + len > stop && stop < ground) glow(x, stop, 5 * u, WATER_HOT, appear * .5 * (1 - (y + len - stop) / len));
            }
            if (!reduced) for (let k = 0; k < 4; k++) {
                const ph = (t * .45 + k / 4) % 1, a = -Math.PI / 2 + (k % 2 ? 1 : -1) * ph * Math.PI * .45;
                glow(cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, 4 * u, WATER_HOT, appear * .6 * Math.sin(ph * Math.PI));
            }
        }
        // 반사: 보스 표면이 차가운 거울처럼 빛을 튕긴다. 외곽에 도형을 둘러놓지 않는다.
        function mirror(t, fade, reduced, seed) {
            const show = clamp(t / .3) * fade, b = body(), cycle = reduced ? .4 : (t / 1.3) % 1;
            skin((m, b) => {
                const x = b.x + b.w * (-.25 + cycle * 1.5), g = m.createLinearGradient(x - b.w * .12, b.y, x + b.w * .12, b.y + b.h * .22);
                g.addColorStop(0, 'rgba(138,188,214,0)'); g.addColorStop(.45, 'rgba(154,206,226,.12)');
                g.addColorStop(.5, 'rgba(238,250,255,.8)'); g.addColorStop(.55, 'rgba(154,206,226,.12)'); g.addColorStop(1, 'rgba(138,188,214,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
            }, .6 * show, 'lighter');
            if (!reduced) {
                const flash = clamp(1 - (t % 1.3) / .2), [x, y] = point(.3 + rand(seed + Math.floor(t / 1.3)) * .4, .5);
                glint(x, y, Math.min(b.w, b.h) * .055, -.6, flash * show * .65);
            }
        }
        // 어둠 폭발: 몸 중심으로 어둠이 오그라든 뒤 검은 충격파와 연기가 바닥을 따라 퍼진다.
        function darkBlast(t, reduced, seed) {
            const [x, y] = point(.5, .55), b = body(), reach = Math.max(scene.w, scene.h) * .65, n = width < 420 ? 5 : 8;
            if (t < .3) glow(x, y, b.w * (.5 - t), [8, 2, 8], (t / .3) * .55, false);
            const e = clamp((t - .22) / .98);
            if (e <= 0 || e >= 1) return;
            const r = b.w * .2 + (reduced ? .4 : ease(e)) * reach, thick = reach * .14, squash = .55;
            ctx.save(); ctx.translate(x, y); ctx.scale(1, squash);
            const g = ctx.createRadialGradient(0, 0, Math.max(0, r - thick), 0, 0, r);
            g.addColorStop(0, 'rgba(10,4,12,0)'); g.addColorStop(.7, 'rgba(10,4,12,.6)'); g.addColorStop(1, 'rgba(10,4,12,0)');
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(1 - e); ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
            ctx.restore();
            band(x, y, r - thick * .3, 2 * unit(), [180, 20, 44], (1 - e) * .55, squash);
            const image = texture('mist') || puff(), size = b.w * .4;
            for (let i = 0; i < n; i++) {
                const a = i / n * TAU + rand(seed + i) * .5;
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp((1 - e) * .45);
                ctx.drawImage(image, x + Math.cos(a) * r * .85 - size / 2, y + Math.sin(a) * r * squash * .85 - size * .31, size, size * .62);
            }
        }
        // 치명 반사: 맞은 자리에서 각진 섬광이 튀고, 날카로운 반격이 공격한 쪽으로 되돌아간다.
        function critReflect(t, ev, reduced, seed) {
            const [px, py] = point(.35 + rand(seed) * .3, .3 + rand(seed + 1) * .35), tx = memberX(ev.targets?.[0]), ty = scene.y + scene.h * .95, u = unit();
            if (t < .2) glow(px, py, 22 * u, RED_HOT, (1 - t / .2) * .6);
            if (t < .25) glint(px, py, (18 + (reduced ? 0 : t * 80)) * u, Math.PI / 4, 1 - t / .25);
            const e = clamp((t - .08) / .3), out = clamp(1 - (t - .38) / .42);
            if (e <= 0 || out <= 0) return;
            const head = reduced ? 1 : ease(e), back = Math.max(0, head - .35), ang = Math.atan2(ty - py, tx - px), nx = -Math.sin(ang) * 3 * u, ny = Math.cos(ang) * 3 * u;
            const hx = px + (tx - px) * head, hy = py + (ty - py) * head, bx = px + (tx - px) * back, by = py + (ty - py) * back;
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = out; ctx.fillStyle = rgba(RED_HOT, 1);
            ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo((bx + hx) / 2 + nx, (by + hy) / 2 + ny); ctx.lineTo(hx, hy); ctx.lineTo((bx + hx) / 2 - nx, (by + hy) / 2 - ny); ctx.closePath(); ctx.fill();
            if (head >= 1) glint(tx, ty, 14 * u, 0, out * .8);
        }
        // 부활: 검게 식은 몸에 발밑부터 빛기둥이 솟고, 아래부터 다시 불이 붙는다.
        function revive(t, duration, reduced) {
            const b = body(), ground = groundY(), p = clamp(t / duration), out = clamp((duration - t) / .5), BONE = [255, 238, 210];
            const relight = ease(clamp((t - .35) / 1)), cx = b.x + b.w / 2, w = b.w * (.12 + .1 * Math.sin(p * Math.PI));
            skin((m, b) => { m.fillStyle = 'rgb(12,8,12)'; m.fillRect(b.x, b.y, b.w, b.h); }, (1 - relight) * .7);
            const g = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
            g.addColorStop(0, rgba(BONE, 0)); g.addColorStop(.5, rgba(BONE, .5)); g.addColorStop(1, rgba(BONE, 0));
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp(t / .4) * out; ctx.fillStyle = g;
            ctx.fillRect(cx - w, scene.y, w * 2, ground - scene.y);
            const front = b.y + b.h * (1 - relight);
            if (!reduced && relight > 0 && relight < 1) skin((m, b) => {
                const g = m.createLinearGradient(0, front - b.h * .05, 0, front + b.h * .12);
                g.addColorStop(0, rgba(BONE, 0)); g.addColorStop(.35, rgba(BONE, 1)); g.addColorStop(1, rgba(BONE, 0));
                m.fillStyle = g; m.fillRect(b.x, front - b.h * .05, b.w, b.h * .17);
            }, .7, 'lighter');
            if (t > .4 && t < 1.3) { const e = (t - .4) / .9; band(cx, ground, b.w * (.2 + (reduced ? .4 : ease(e)) * .9), 8 * unit(), BONE, (1 - e) * .5, .22); }
        }
        // 퍼즐 던지기: 조각들이 몸에서 튀어나와 돌며 무대 아래 파티 쪽으로 흩어진다.
        function puzzle(t, reduced, seed) {
            const n = width < 420 ? 6 : 10, u = unit(), bottom = scene.y + scene.h + 12 * u, image = texture('puzzle');
            for (let i = 0; i < n; i++) {
                const ph = reduced ? .55 : clamp((t - i / n * .55) / .55);
                if (ph <= 0 || ph >= 1) continue;
                const [sx, sy] = point(.3 + rand(seed + i) * .4, .3 + rand(seed + i + 1) * .3);
                const ex = scene.x + scene.w * (.06 + rand(seed + i + 2) * .88), lift = scene.h * (.12 + rand(seed + i + 3) * .15);
                const s = (16 + rand(seed + i + 4) * 10) * u;
                ctx.save(); ctx.translate(sx + (ex - sx) * ph, sy + (bottom - sy) * ph - lift * 4 * ph * (1 - ph));
                ctx.rotate(rand(seed + i + 5) * TAU + (reduced ? 0 : ph * (6 + rand(seed + i + 6) * 6)));
                ctx.scale(.45 + .55 * Math.abs(Math.cos(ph * 5 + i)), 1);
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, image, 0, 0, s * 2, s * 2, Math.min(1, ph * 6) * (reduced ? 1 - t / 1.2 : 1));
                ctx.restore();
            }
        }
        // 무난한 딜링: 다음 공격의 열기가 몸과 무기에 축적된다.
        function dealing(t, duration, ev, reduced) {
            const [x, y] = point(.63, .58), b = body(), count = Math.max(1, Math.min(3, Number(ev.count) || 1)), out = clamp((duration - t) / .35), u = unit();
            const h = Math.min(b.h, scene.h), show = ease(clamp(t / .25)) * out;
            skin((m, b) => {
                const g = m.createRadialGradient(x, y, 0, x, y, h * .4);
                g.addColorStop(0, 'rgba(255,180,88,.65)'); g.addColorStop(.35, 'rgba(228,110,36,.18)'); g.addColorStop(1, 'rgba(228,110,36,0)');
                m.fillStyle = g; m.fillRect(b.x, b.y, b.w, b.h);
            }, (.2 + count * .12) * show, 'lighter');
            for (let i = 0; i < 5 + count * 2; i++) {
                const p = reduced ? .5 : ease(clamp((t - i * .035) / .6)), angle = rand(i + count * 31) * TAU;
                const distance = h * (.18 + rand(i + 9) * .25) * (1 - p);
                glow(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance * .7, 2.5 * u, [255, 200, 132], Math.sin(p * Math.PI) * out * .5);
            }
            glint(x, y, 10 * u, -.5, show * .4);
        }
        // 마지막 3초: 원본 무기 좌표에 열기가 올라가고, 몸의 기운이 창끝으로 응축된다.
        function dealingReady(t, duration, reduced, seed) {
            const [hx, hy] = scenePoint(.403, .445), [gx, gy] = scenePoint(.444, .675), [cx, cy] = scenePoint(.50, .63);
            const u = unit(), p = clamp(t / Math.max(.1, duration)), heat = ease(clamp(p / .65)), compress = clamp((p - .6) / .27);
            const show = clamp(t / .25) * (p > .96 ? .35 : 1), rise = reduced ? 1 : ease(clamp(p / .6));
            // 빛은 실제 창의 알파 안에만 남긴다. 무기를 새 도형으로 덧그리지 않는다.
            skin(m => {
                const g = m.createLinearGradient(gx, gy, hx, hy);
                g.addColorStop(0, rgba([234, 103, 32], .12));
                g.addColorStop(Math.max(.01, rise - .25), rgba(BRONZE, .15));
                g.addColorStop(Math.min(.99, rise), rgba(BRONZE_HOT, .85));
                g.addColorStop(1, rgba(BRONZE, rise >= .99 ? .8 : 0));
                m.strokeStyle = g; m.lineWidth = 14 * u; m.lineCap = 'round';
                m.beginPath(); m.moveTo(gx, gy); m.lineTo(hx, hy); m.stroke();
                for (const tip of [[.386, .303], [.406, .331], [.43, .389]]) {
                    const [tx, ty] = scenePoint(...tip);
                    const shine = m.createLinearGradient(hx, hy, tx, ty);
                    shine.addColorStop(0, rgba(BRONZE_HOT, heat)); shine.addColorStop(1, rgba([255, 153, 68], heat * .65));
                    m.strokeStyle = shine; m.lineWidth = 12 * u;
                    m.beginPath(); m.moveTo(hx, hy); m.lineTo(tx, ty); m.stroke();
                }
            }, show * (.35 + heat * .55), 'lighter');
            skin(m => mote(m, cx, cy, 24 * u, BRONZE, (1 - compress) * heat * .25), show, 'lighter');
            behind(m => mote(m, hx, hy - 14 * u, (25 - compress * 10) * u, BRONZE, heat * .3), show);
            glow(hx, hy, (14 - compress * 5) * u, BRONZE_HOT, heat * compress * show * .45);
            if (!reduced) for (let i = 0; i < 7; i++) {
                const age = (p - .35 - i * .065) / .25;
                if (age <= 0 || age >= 1) continue;
                const q = ease(age), bend = (rand(seed + i) - .5) * 18 * u;
                glow(cx + (hx - cx) * q + Math.sin(q * Math.PI) * bend, cy + (hy - cy) * q, (1.2 + rand(seed + i + 11)) * u, BRONZE_HOT, Math.sin(age * Math.PI) * show * .6);
            }
            if (compress > 0 && compress < 1) glint(hx, hy - 8 * u, 18 * u, -1.35, Math.sin(compress * Math.PI) * show * .45);
        }
        // 확실한 딜링: 무기에 축적된 열기가 한 번의 넓은 궤적으로 터진다.
        function dealingStrike(t, reduced) {
            const [x, y] = scenePoint(.403, .445), b = body(), u = unit(), AMBER = [255, 150, 50], AMBER_HOT = [255, 232, 186];
            ctx.lineCap = 'round'; ctx.globalCompositeOperation = 'lighter';
            if (t < .25) glow(x, y, Math.min(b.w, b.h) * (.12 + .1 * clamp(t / .25)), AMBER, .35 * (1 - t / .25));
            if (t > .18 && t < .45) glow(x, y, b.w * .3, AMBER_HOT, (1 - Math.abs(t - .25) / .2) * .7);
            const e = reduced ? .5 : clamp((t - .2) / .45), out = clamp(1 - (t - .65) / .55), R = scene.w * .55, oy = y - R * .35;
            if (t > .2 && out > 0) for (let j = 0; j < 6; j++) {
                const head = Math.PI * (.88 - e * .76);
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = clamp((1 - j / 6) * out); ctx.strokeStyle = rgba(j ? AMBER : AMBER_HOT, 1); ctx.lineWidth = (12 - j * 1.5) * u;
                ctx.beginPath(); ctx.arc(x, oy, R, head + j * .12, head + (j + 1) * .12); ctx.stroke();
            }
            if (t > .45) { const g = clamp((t - .45) / .75); band(x, groundY(), b.w * (.3 + (reduced ? .5 : ease(g)) * 1.2), 10 * u, AMBER, (1 - g) * .6, .22); }
        }
        // 튀어오르기: 발밑의 먼지와 파편이 튀고 지정 대상 쪽에도 무거운 충격이 이어진다.
        function bounce(t, ev, reduced) {
            const b = body(), u = unit(), image = texture('mist') || puff(), bottom = scene.y + scene.h - 8 * u;
            const origins = [[b.x + b.w * .5, groundY()], [memberX(ev.targets?.[0]), bottom]];
            origins.forEach(([x, y], k) => {
                const age = t - k * .12, p = reduced ? .4 : clamp(age / .7);
                if (age < 0 || age > .85) return;
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, image, x, y - p * 18 * u, (50 + p * 80) * u, (25 + p * 25) * u, (1 - p) * .3);
                for (let i = 0; i < (width < 420 ? 3 : 5); i++) {
                    const vx = (rand(i + k * 13) - .5) * 70 * u, lift = (30 + rand(i + 7) * 30) * u;
                    shard(x + vx * p, y - 4 * p * (1 - p) * lift, (3 + rand(i + 19) * 3) * u, i * 2 + p * 4, p * 5, .5, clamp(1 - p * .5));
                }
            });
        }
        // 주시는 대상 방향으로 흐르는 낮은 불씨로만 표시한다.
        function markCue(t, ev, reduced) {
            const [x, y] = point(...focus), u = unit(), tx = memberX(ev.targets?.[0]), ty = scene.y + scene.h - 10 * u, EMBER = [255, 120, 40];
            if (!reduced) for (let i = 0; i < 3; i++) {
                const s = (t / 2.4 + i / 3) % 1;
                glow(x + (tx - x) * s, y + (ty - y) * s, 2.5 * u, EMBER, Math.sin(s * Math.PI) * .35);
            }
            glow(tx, ty, 7 * u, EMBER, reduced ? .25 : .2 + .1 * Math.sin(t * 2));
        }
        // 조의 의지: 부서진 청동 덩어리가 대상 위에 내려앉고, 지지 인원에 따라 하중을 넓게 받친다.
        function burden(t, state, reduced) {
            const ev = state.event, u = unit(), bottom = scene.y + scene.h - 6 * u, duration = Number(ev.duration || 0), seed = state.seed;
            const names = [...new Set([ev.target, ...(ev.responded || [])].filter(Boolean).map(String))];
            const xs = names.length ? names.map(memberX) : [memberX()], count = xs.length;
            const goal = xs.reduce((a, x) => a + x, 0) / count;
            state.loadX = state.loadX == null || reduced ? goal : state.loadX + (goal - state.loadX) * .2;
            const settle = reduced ? 1 : ease(clamp(t / .4)), show = settle * clamp((duration - t) / .2);
            if (show <= 0) return;
            const y = bottom - (26 + count * 5) * u - (1 - settle) * 24 * u + clamp(t / Math.max(.1, duration)) * 6 * u / count;
            for (let i = 0; i < 4; i++) {
                const x = state.loadX + (i - 1.5) * (14 + count * 3) * u;
                shard(x, y + (rand(seed + i) - .5) * 12 * u, (10 + rand(seed + i + 7) * 6) * u, i * 1.2 + seed, .2 + i * .4, .7, show);
            }
            xs.forEach(x => {
                ctx.globalCompositeOperation = 'source-over';
                material(ctx, texture('mist') || puff(), x, bottom - 7 * u, 55 * u, 25 * u, .18 * show);
            });
            if (!reduced) for (let i = 0; i < 3; i++) {
                const p = (t * 2.5 + i / 3) % 1;
                shard(state.loadX + (rand(seed + i + 21) - .5) * 55 * u, y + p * p * 40 * u, 1.5 * u, i + p * 3, p * 4, .3, (1 - p) * show);
            }
        }
        // ---- 조각: 원석이 실제로 깎여 황소가 된다 ----
        // 서버 감쇠는 100ms마다 최대치의 0.1%다. 다음 감쇠 시각 뒤로 지난 칸만큼 빼서 게이지와 같은 값을 쓴다.
        function carveTarget(ev) {
            const max = Math.max(1, Number(ev.hpMax || 0)), next = Number(ev.decayNextAt || 0), at = Date.now() - clockOffset;
            let damage = Number(ev.damage || 0);
            if (next && at >= next) damage -= (Math.floor((at - next) / 100) + 1) * max / 1000;
            return clamp(damage / max);
        }
        // 실제 청동 황소의 알파 경계(원본 픽셀). 그림마다 한 번만 잰다.
        function liveBox() {
            if (!sprite?.naturalWidth || !spriteDrawRect) return null;
            let box = boxes.get(sprite.src);
            if (!box) {
                const subject = JSON.parse(sprite.dataset.subject || '[0,0,1,1]'), W = sprite.naturalWidth, H = sprite.naturalHeight;
                const sx = subject[0] * W, sy = subject[1] * H, sw = subject[2] * W, sh = subject[3] * H;
                box = [sx, sy, sw, sh];
                try {
                    const k = Math.min(1, 200 / Math.max(sw, sh)), w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
                    const c = document.createElement('canvas'); c.width = w; c.height = h;
                    const g = c.getContext('2d', { willReadFrequently: true });
                    g.drawImage(sprite, sx, sy, sw, sh, 0, 0, w, h);
                    const data = g.getImageData(0, 0, w, h).data;
                    let x0 = w, y0 = h, x1 = -1, y1 = -1;
                    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[(y * w + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
                    if (x1 >= x0) box = [sx + x0 / k, sy + y0 / k, (x1 - x0 + 1) / k, (y1 - y0 + 1) / k];
                } catch (_) {}
                boxes.set(sprite.src, box);
            }
            const s = spriteDrawRect.w / sprite.naturalWidth;
            return { x: spriteDrawRect.x + box[0] * s, y: spriteDrawRect.y + box[1] * s, w: box[2] * s, h: box[3] * s };
        }
        // 아틀라스 칸을 실제 황소 경계에 맞춘다. 발바닥과 가로 중심을 맞추고 모든 단계에 같은 배율을 쓴다.
        function carveRect() {
            const live = liveBox();
            if (!live || !carve?.box) return null;
            const [x0, y0, x1, y1] = carve.box, s = Math.min(live.w / (x1 - x0), live.h / (y1 - y0));
            return { x: live.x + live.w / 2 - (x0 + x1) / 2 * s, y: live.y + live.h - y1 * s, s, live };
        }
        const FRONT = 5;
        function carveWrite(from, to) {
            const k = carved.k, s0 = carve.stages[k], s1 = carve.stages[k + 1], o = carved.out.data, pair = carve.pairs[k];
            const qb = carved.q * 256, hw = carved.hw[k] * 256;
            for (let b = Math.max(0, from); b < Math.min(256, to); b++) {
                const done = b < qb, front = !done && b < qb + FRONT, crust = !done && b < hw;
                for (let j = pair.start[b]; j < pair.start[b + 1]; j++) {
                    const p = pair.index[j] * 4, src = done ? s1 : s0;
                    let r = src[p], g = src[p + 1], bl = src[p + 2];
                    // 감쇠로 되돌아온 자리는 무광 돌 껍질로 메워지고, 곧 떨어질 자리는 끌 자국처럼 어둡다.
                    if (crust) { r = r * .65 + 42; g = g * .65 + 39; bl = bl * .65 + 35; }
                    if (front && s1[p + 3] < 128) { r *= .82; g *= .82; bl *= .82; }
                    o[p] = r; o[p + 1] = g; o[p + 2] = bl; o[p + 3] = src[p + 3];
                }
            }
        }
        // 진행도가 바뀐 만큼의 묶음만 다시 쓴다. 단계가 바뀔 때만 전체를 새로 쓴다.
        function carveSet(p) {
            if (!carved) {
                const c = document.createElement('canvas'); c.width = c.height = carve.size;
                const g = c.getContext('2d');
                carved = { canvas: c, g, out: g.createImageData(carve.size, carve.size), k: -1, q: 0, hw: new Float32Array(5) };
            }
            let k = 0;
            while (k < 4 && p >= CARVE_KNOTS[k + 1]) k++;
            const q = clamp((p - CARVE_KNOTS[k]) / (CARVE_KNOTS[k + 1] - CARVE_KNOTS[k])), last = carved.q;
            if (k !== carved.k) { carved.k = k; carved.q = q; carved.hw[k] = Math.max(carved.hw[k], q); carved.out.data.fill(0); carveWrite(0, 256); }
            else if (Math.abs(q - last) >= 1 / 1024) { carved.q = q; carved.hw[k] = Math.max(carved.hw[k], q); carveWrite(Math.floor(Math.min(q, last) * 256) - 1, Math.ceil(Math.max(q, last) * 256) + FRONT + 1); }
            else return;
            // 남겨 둔 석재의 면과 조명은 이어서 다듬는다. 내부를 무작위 얼룩처럼 교체하지 않는다.
            const a = carve.stages[k], b = carve.stages[k + 1], out = carved.out.data;
            for (const i of carve.pairs[k].surface) {
                const p = i * 4;
                for (let c = 0; c < 4; c++) out[p + c] = a[p + c] + (b[p + c] - a[p + c]) * q;
            }
            carved.g.putImageData(carved.out, 0, 0);
        }
        // 실제 타격마다 깎이는 면에서 그 단계의 돌 재질 그대로 작은 조각을 떼어 낸다.
        function spawnChips(rect, n) {
            const N = carve.size, pair = carve.pairs[carved.k], src = carve.stages[carved.k], b0 = Math.floor(carved.q * 256), u = unit(), now = performance.now();
            const lo = pair.start[Math.max(0, Math.min(255, b0 - 2))], hi = pair.start[Math.min(256, b0 + 12)];
            for (let i = 0; i < n && hi > lo; i++) {
                const idx = pair.index[lo + Math.floor(Math.random() * (hi - lo))], px = idx % N, py = (idx / N) | 0;
                const size = Math.max(4, Math.round(N * (.018 + Math.random() * .022))), c = document.createElement('canvas'); c.width = c.height = size;
                const g = c.getContext('2d'), image = g.createImageData(size, size), pts = [];
                for (let k = 0; k < 5; k++) { const a = (k + Math.random() * .7) / 5 * TAU, r = size * (.28 + Math.random() * .22); pts.push([size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r]); }
                for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
                    const sx = px - (size >> 1) + x, sy = py - (size >> 1) + y;
                    if (sx < 0 || sy < 0 || sx >= N || sy >= N || !inside(pts, x + .5, y + .5)) continue;
                    const s = (sy * N + sx) * 4, d = (y * size + x) * 4;
                    image.data[d] = src[s]; image.data[d + 1] = src[s + 1]; image.data[d + 2] = src[s + 2]; image.data[d + 3] = src[s + 3];
                }
                g.putImageData(image, 0, 0);
                chips.push({ image: c, x: rect.x + px * rect.s, y: rect.y + py * rect.s, size: size * rect.s, vx: (px / N > .5 ? 1 : -1) * (30 + Math.random() * 90) * u, vy: -(70 + Math.random() * 130) * u, spin: (Math.random() - .5) * 14, born: now });
                if (chips.length > (width < 420 ? 10 : 24)) chips.shift();
            }
        }
        function drawChips(now, reduced) {
            const ground = groundY(), u = unit(), gravity = 900 * u, dust = stoneDust();
            chips = chips.filter(c => now - c.born < 2200);
            ctx.globalCompositeOperation = 'source-over';
            for (const c of chips) {
                const t = (now - c.born) / 1000, fall = ground - c.y;
                const land = fall > 0 ? (-c.vy + Math.sqrt(c.vy * c.vy + 2 * gravity * fall)) / gravity : 0, k = Math.min(t, land);
                if (t < .45) material(ctx, dust, c.x, c.y, (20 + t * 60) * u, (14 + t * 40) * u, (1 - t / .45) * .5);
                const alpha = 1 - clamp((t - land - .5) / .5);
                if (reduced || alpha <= 0) continue;
                ctx.save(); ctx.translate(c.x + c.vx * k, Math.min(ground, c.y + c.vy * k + gravity * k * k / 2)); ctx.rotate(c.spin * k);
                ctx.globalAlpha = alpha; ctx.drawImage(c.image, -c.size / 2, -c.size / 2, c.size, c.size); ctx.restore();
            }
        }
        function sculpture(state, t, reduced) {
            const target = carveTarget(state.event), rect = carve?.ready ? carveRect() : null, now = performance.now();
            if (!rect) {
                // 아틀라스가 준비되기 전에는 청동을 숨기지 않는다.
                state.hold = false;
                skin((m, b) => { m.fillStyle = 'rgba(236,226,206,1)'; m.fillRect(b.x, b.y, b.w, b.h); }, target * .55, 'overlay');
                return;
            }
            // 받침에서 돌가루가 올라 가장 짙을 때 청동 대신 원석이 놓인다. 재접속은 먼지 없이 현재 모양을 바로 보인다.
            if (state.showAt == null) state.showAt = state.fresh ? now + (t < .3 ? .3 - t : .3) * 1000 : now;
            // 타격은 잠깐 따라붙고, 감쇠는 게이지와 같이 바로 내려간다.
            state.shown = state.shown == null || target <= state.shown ? target : state.shown + (target - state.shown) * (1 - Math.exp(-frameDt / .09));
            if (now >= state.showAt) {
                carveSet(state.shown);
                state.hold = true;
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
                ctx.drawImage(carved.canvas, rect.x, rect.y, carve.size * rect.s, carve.size * rect.s);
                if (state.pending) { spawnChips(rect, state.pending); state.pending = 0; }
            }
            drawChips(now, reduced);
            const live = rect.live, d = (now - state.showAt) / 1000 + .3;
            if (state.fresh && d > 0 && d < 1.1) {
                const image = stoneDust(), rise = reduced ? .6 : ease(clamp(d / .5)), show = d < .3 ? d / .3 : 1 - (d - .3) / .8;
                ctx.globalCompositeOperation = 'source-over';
                for (let i = 0; i < 9; i++) {
                    const size = live.w * (.5 + rand(state.seed + i + 7) * .25), x = live.x + live.w * ((i % 5) + .5) / 5 + (rand(state.seed + i) - .5) * live.w * .1;
                    material(ctx, image, x, live.y + live.h * (1 - (i < 5 ? .2 : .55) * rise - .1 * rand(state.seed + i + 3)), size, size * .8, show);
                }
            }
        }
        function drawPlate(p, map, dx, dy, rot, thick, alpha) {
            if (alpha <= .01) return;
            const w = p.w * map.s, h = p.h * map.s, ox = (p.x - p.cx) * map.s, oy = (p.y - p.cy) * map.s;
            ctx.save(); ctx.translate(map.x + p.cx * map.s + dx, map.y + p.cy * map.s + dy); ctx.rotate(rot);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(alpha);
            // 돌아갈수록 판의 두께 면이 드러난다. 제자리에서는 원본과 같다.
            const side = thick * Math.min(1, Math.abs(rot) * 1.5);
            if (side > .3) ctx.drawImage(p.edge, ox + Math.sin(rot) * side, oy + side, w, h);
            ctx.drawImage(p.image, ox, oy, w, h);
            ctx.restore();
        }
        // 조각이 끝나면 깎던 돌이 판으로 갈라져 받침 위로 무너지고, 그 뒤에 원래 청동 황소가 남는다.
        function carveBreak(state, t, reduced) {
            const rect = carve?.ready ? carveRect() : null;
            if (!rect || t > 1.1) return;
            const N = carve.size, [x0, y0, x1, y1] = carve.box, mx = (x0 + x1) / 2, map = { x: rect.x, y: rect.y, s: rect.s }, live = rect.live;
            if (!state.plates) {
                const sites = [];
                for (let i = 0; i < (width < 420 ? 8 : 12); i++) sites.push([x0 + (x1 - x0) * rand(state.seed + i * 3), y0 + (y1 - y0) * rand(state.seed + i * 3 + 1)]);
                state.plates = cutPlates(state.snap, voronoi(sites, [0, 0, N, N]), 1, N, N);
            }
            state.plates.forEach((p, i) => {
                if (reduced) { drawPlate(p, map, 0, 0, 0, 0, 1 - clamp(t / .5)); return; }
                const s = state.seed + i * 5, tau = Math.max(0, t - rand(s + 40) * .08), g = 1500, vx = (p.cx - mx) * 1.4, vy = -(20 + rand(s + 41) * 60);
                const fall = Math.max(0, y1 - p.cy - p.h * .25), land = (-vy + Math.sqrt(vy * vy + 2 * g * fall)) / g, k = Math.min(tau, land);
                drawPlate(p, map, vx * k * map.s, Math.min(fall, vy * k + g * k * k / 2) * map.s, (rand(s + 42) - .5) * 5 * k, (4 + rand(s + 43) * 4) * map.s, 1 - clamp((tau - land - .15) / .3));
            });
            const image = stoneDust(), show = 1 - clamp(t / .9);
            ctx.globalCompositeOperation = 'source-over';
            for (let i = 0; i < 6; i++) material(ctx, image, live.x + live.w * (i + .5) / 6, live.y + live.h * (.95 - (reduced ? 0 : ease(clamp(t / .9)) * .25)), live.w * .45, live.w * .3, show * .8);
        }

        // ---- 위플래쉬에서 잔향으로: 외피가 갈라져 깨지고 안의 잔향이 손을 뻗는다 ----
        // 장면 전체를 대신 그릴 때 실제 무대의 가장자리 그늘(.pq-game-stage::after)과 바닥 그늘(.pq-stage-boss::after)도 같이 얹는다.
        function chrome(g) {
            const s = scene, off = 4000;
            g.save(); g.beginPath(); g.rect(s.x, s.y, s.w, s.h); g.clip();
            g.globalCompositeOperation = 'source-atop'; g.globalAlpha = 1; g.fillStyle = '#000';
            g.shadowColor = 'rgba(0,0,0,.75)'; g.shadowBlur = 90 * ratio; g.shadowOffsetX = off * ratio;
            g.beginPath(); g.rect(s.x - off - 300, s.y - 300, s.w + 600, s.h + 600); g.rect(s.x - off, s.y, s.w, s.h); g.fill('evenodd');
            g.restore();
            const bottom = g.createLinearGradient(0, s.y + s.h, 0, s.y + s.h - 36);
            bottom.addColorStop(0, 'rgba(10,8,18,.75)'); bottom.addColorStop(1, 'rgba(10,8,18,0)');
            g.globalCompositeOperation = 'source-atop'; g.fillStyle = bottom; g.fillRect(s.x, s.y + s.h - 36, s.w, 36);
            g.globalCompositeOperation = 'source-over';
        }
        // 등록 장면을 무대와 같은 평면(보스 그림 사각형)에 그린다. reveal이 있으면 기계 자리와 원 안만 드러낸다.
        function paintScene(hall, figure, reveal, alpha = 1) {
            const r = spriteDrawRect, m = maskCtx;
            if (!r || alpha <= 0) return;
            m.globalCompositeOperation = 'source-over'; m.globalAlpha = 1; m.clearRect(0, 0, width, height);
            if (reveal) {
                m.drawImage(sprite, r.x, r.y, r.w, r.h);
                m.fillStyle = '#000'; m.beginPath(); m.arc(reveal[0], reveal[1], reveal[2], 0, TAU); m.fill();
                m.globalCompositeOperation = 'source-in';
            }
            m.drawImage(hall, r.x, r.y, r.w, r.h);
            m.globalCompositeOperation = 'source-atop';
            if (figure === layer) m.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, width, height);
            else m.drawImage(figure, r.x, r.y, r.w, r.h);
            chrome(m);
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(alpha);
            ctx.drawImage(mask, 0, 0, mask.width, mask.height, 0, 0, width, height);
        }
        // 위플래쉬 외피를 판으로 나눈다. 우퍼 둘레에 판이 촘촘하고, 위쪽 가시 둘은 따로 넘어진다.
        function whipPlates() {
            if (!sprite?.src.includes('whiplash-scene') || !sprite.complete || !sprite.naturalWidth || !spriteDrawRect) return null;
            const small = width < 420, key = sprite.src + (small ? ':s' : '');
            if (whip?.key === key) return whip;
            const [wx, wy, wr] = WHIP.woofer, [bx, by, bw, bh] = WHIP.box, ring = small ? 4 : 7, sites = [[680, 110], [1000, 110]];
            for (let i = 0; i < ring; i++) { const a = (i + rand(i + 400) * .6) / ring * TAU, r = wr * (.45 + rand(i + 401) * .6); sites.push([wx + Math.cos(a) * r, wy + Math.sin(a) * r]); }
            for (let i = sites.length; i < (small ? 10 : 18); i++) sites.push([bx + bw * (.08 + rand(i + 420) * .84), by + bh * (.25 + rand(i + 421) * .72)]);
            const polys = voronoi(sites, WHIP.box), scale = Math.min(1, spriteDrawRect.w * ratio / PLANE[0]);
            // 날아가는 판에도 꺼진 램프가 남는다.
            const [lx, ly, lr] = WHIP.lamp, dim = g => {
                const d = g.createRadialGradient(lx, ly, 0, lx, ly, lr * 1.3);
                d.addColorStop(0, 'rgba(6,14,9,.9)'); d.addColorStop(1, 'rgba(6,14,9,0)');
                g.fillStyle = d; g.fillRect(lx - lr * 2, ly - lr * 2, lr * 4, lr * 4);
            };
            const plates = cutPlates(sprite, polys, scale, PLANE[0], PLANE[1], dim);
            // 판 경계가 곧 금이다. 상자 테두리 위의 변은 빼고, 우퍼에 가까운 끝에서 갈라지기 시작한다.
            const side = p => (Math.abs(p[0] - bx) < .5 ? 1 : 0) | (Math.abs(p[0] - bx - bw) < .5 ? 2 : 0) | (Math.abs(p[1] - by) < .5 ? 4 : 0) | (Math.abs(p[1] - by - bh) < .5 ? 8 : 0);
            const edges = new Map();
            polys.forEach(poly => poly.forEach((p, i) => {
                const q = poly[(i + 1) % poly.length], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
                if (side(p) & side(q) || len < 4) return;
                const id = [p, q].map(v => Math.round(v[0]) + ',' + Math.round(v[1])).sort().join('|');
                if (edges.has(id)) return;
                const [a, b] = Math.hypot(p[0] - wx, p[1] - wy) <= Math.hypot(q[0] - wx, q[1] - wy) ? [p, q] : [q, p];
                const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len, seed = edges.size * 13 + 700, points = [];
                for (let j = 0; j <= 5; j++) { const off = j % 5 ? (rand(seed + j) - .5) * len * .12 : 0; points.push([a[0] + (b[0] - a[0]) * j / 5 + nx * off, a[1] + (b[1] - a[1]) * j / 5 + ny * off]); }
                edges.set(id, { points, begin: .55 + 1.35 * clamp((Math.hypot(a[0] - wx, a[1] - wy) - wr * .4) / 520) });
            }));
            const list = [...edges.values()].sort((a, b) => a.begin - b.begin);
            // 처음 갈라지는 교차점에서 작은 외피 조각이 떨어진다.
            const spalls = list.slice(0, small ? 4 : 8).map((e, i) => {
                const [x, y] = e.points[0], r = 7 + rand(i + 800) * 5;
                return { begin: e.begin, plate: cutPlates(sprite, [[0, 1, 2].map(k => [x + Math.cos(k * 2.1 + i) * r, y + Math.sin(k * 2.1 + i) * r])], scale, PLANE[0], PLANE[1])[0] };
            });
            return whip = { key, plates, edges: list, spalls };
        }
        function partial(g, pts, f, map) {
            const end = f * (pts.length - 1);
            g.moveTo(map.x + pts[0][0] * map.s, map.y + pts[0][1] * map.s);
            for (let i = 1; i < pts.length; i++) {
                const k = Math.min(1, end - (i - 1));
                if (k <= 0) break;
                const a = pts[i - 1], b = pts[i];
                g.lineTo(map.x + (a[0] + (b[0] - a[0]) * k) * map.s, map.y + (a[1] + (b[1] - a[1]) * k) * map.s);
            }
        }
        // 잔향 인물: 팔 없는 몸에 떼어 낸 팔을 어깨 기준으로 붙인다. 3.7초에 원본과 같은 자리, 마지막 0.3초에 원본 장면으로 넘긴다.
        function composeEcho(echo, t) {
            const r = spriteDrawRect, g = layerCtx, s = r.w / PLANE[0], arm = armCut?.src === echo.scene.src ? armCut.canvas : null;
            g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, width, height);
            if (!arm || !echo.body || t >= 4) g.drawImage(echo.scene, r.x, r.y, r.w, r.h);
            else {
                g.drawImage(echo.body, r.x, r.y, r.w, r.h);
                if (t > 2.95) {
                    const k = ease(clamp((t - 2.95) / .75)), [px, py] = ARM.pivot, [bx, by, bw, bh] = ARM.box, x = r.x + px * s, y = r.y + py * s;
                    g.save(); g.globalAlpha = clamp((t - 2.95) / .15);
                    g.translate(x, y); g.rotate(-.14 * (1 - k)); g.scale(.78 + .22 * k, .78 + .22 * k); g.translate(-x, -y);
                    g.drawImage(arm, r.x + bx * s, r.y + by * s, bw * s, bh * s); g.restore();
                }
                if (t > 3.7) {
                    const f = clamp((t - 3.7) / .3);
                    g.globalCompositeOperation = 'destination-out'; g.globalAlpha = f; g.fillRect(0, 0, width, height);
                    g.globalCompositeOperation = 'lighter'; g.drawImage(echo.scene, r.x, r.y, r.w, r.h);
                    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
                }
            }
            // 깨지기 전에는 금 사이로 붉은 안쪽 빛만 받고, 팔을 뻗으면 손끝부터 밝아진다.
            const lit = clamp((t - 2.95) / .7), dark = .62 * (1 - ease(lit));
            if (dark <= .01) return;
            const x = r.x + ARM.hand[0] * s, y = r.y + ARM.hand[1] * s, reach = r.w * .9 * lit;
            let fill = 'rgba(14,3,8,' + dark + ')';
            if (lit > 0) { fill = g.createRadialGradient(x, y, reach * .35, x, y, reach + 1); fill.addColorStop(0, 'rgba(14,3,8,0)'); fill.addColorStop(1, 'rgba(14,3,8,' + dark + ')'); }
            g.globalCompositeOperation = 'source-atop'; g.fillStyle = fill; g.fillRect(r.x, r.y, r.w, r.h);
            if (t < 2.95) { g.fillStyle = 'rgba(190,24,40,.22)'; g.fillRect(r.x, r.y, r.w, r.h); }
            g.globalCompositeOperation = 'source-over';
        }
        // 금: 외피 알파 안에서만 벌어지고, 틈으로 뒤의 잔향이 비친다. 위쪽 턱은 빛을 받는다.
        function cracks(net, t, reduced, map, pulse, echo) {
            const u = unit(), lines = (m, scale) => {
                for (const e of net.edges) {
                    const grow = reduced ? (t >= e.begin ? 1 : 0) : clamp((t - e.begin) / .3);
                    if (grow <= 0) continue;
                    m.lineWidth = (.5 + 2 * clamp((t - e.begin) / 1.4)) * u * scale;
                    m.beginPath(); partial(m, e.points, grow, map); m.stroke();
                }
            };
            skin(m => {
                m.lineCap = m.lineJoin = 'round'; m.strokeStyle = 'rgb(44,6,12)'; lines(m, 1);
                if (echo) { m.globalCompositeOperation = 'source-atop'; m.drawImage(layer, 0, 0, layer.width, layer.height, 0, 0, width, height); }
            }, 1);
            skin(m => { m.lineCap = 'round'; m.strokeStyle = 'rgb(255,226,214)'; m.translate(-.6 * u, -.6 * u); lines(m, .3); m.setTransform(ratio, 0, 0, ratio, 0, 0); }, .3, 'lighter');
            if (pulse > 0) skin(m => { m.lineCap = 'round'; m.strokeStyle = rgba(RED, 1); lines(m, .6); }, pulse * .8, 'lighter');
        }
        // 들어올 장면이 아직 해독되지 않았으면 연기로 덮어 둔다.
        function veil(alpha) {
            if (alpha <= .01) return;
            const image = texture('mist') || puff();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(alpha * .75); ctx.fillStyle = 'rgb(9,7,10)'; ctx.fillRect(scene.x, scene.y, scene.w, scene.h);
            for (let i = 0; i < 6; i++) material(ctx, image, scene.x + scene.w * (i % 3 + .5) / 3, scene.y + scene.h * (i < 3 ? .3 : .75), scene.w * .6, scene.h * .6, alpha * .8, i);
        }
        // 0~.55 압력, .55~2.1 금, 2.1~2.65 고요, 2.65~3.3 파열, 2.95~3.65 팔, 3.7~4 원본 장면. 서버 남은 시간 기준이라 재접속해도 이어진다.
        function transition(state, t, reduced) {
            const r = spriteDrawRect;
            if (!r || !sprite?.src.includes('whiplash-scene')) { state.hold = false; return; }
            const map = { x: r.x, y: r.y, s: r.w / PLANE[0] }, echo = echoArt(state.event.art), net = whipPlates(), u = unit();
            const ready = !!(echo && net), [wx, wy, wr] = WHIP.woofer, cx = map.x + wx * map.s, cy = map.y + wy * map.s;
            const broken = ready && !reduced && t >= 2.65;
            state.hold = ready && t >= (reduced ? 3.25 : 2.65);
            state.veil = (state.veil || 0) + ((!ready && t > 2.4 ? 1 : 0) - (state.veil || 0)) * (1 - Math.exp(-frameDt / .25));
            if (echo) composeEcho(echo, t);
            if (!broken) {
                // 압력: 우퍼 콘이 안으로 빨려 들고 초록 램프가 깜빡이다 꺼진다.
                if (!reduced) {
                    const k = .015 * ease(clamp(t / .55)), rr = wr * map.s;
                    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, rr, 0, TAU); ctx.clip();
                    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; ctx.fillStyle = 'rgb(7,7,9)'; ctx.fillRect(cx - rr, cy - rr, rr * 2, rr * 2);
                    ctx.translate(cx, cy); ctx.scale(1 - k, 1 - k); ctx.translate(-cx, -cy);
                    ctx.drawImage(sprite, r.x, r.y, r.w, r.h); ctx.restore();
                }
                const [lx, ly, lr] = WHIP.lamp, x = map.x + lx * map.s, y = map.y + ly * map.s, size = lr * 2 * map.s;
                const off = t >= .55 ? 1 : reduced ? t / .55 : (rand(Math.floor(t * 18) + 900) > .45 ? .85 : .2) * t / .55;
                const lamp = ctx.createRadialGradient(x, y, 0, x, y, lr * 1.3 * map.s);
                lamp.addColorStop(0, 'rgba(6,14,9,.9)'); lamp.addColorStop(1, 'rgba(6,14,9,0)');
                ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = clamp(off); ctx.fillStyle = lamp; ctx.fillRect(x - size, y - size, size * 2, size * 2);
                if (net && t >= .55) cracks(net, t, reduced, map, t > 2.2 && t < 2.6 ? Math.sin((t - 2.2) / .4 * Math.PI) : 0, echo);
                if (net && !reduced) net.spalls.forEach((s, i) => {
                    const k = t - s.begin - .1;
                    if (k > 0 && k < 1.2) drawPlate(s.plate, map, (rand(i + 820) - .5) * 60 * k * map.s, 750 * k * k * map.s, k * (rand(i + 821) - .5) * 9, 2 * map.s, 1);
                });
                // 고요: 새 금 없이 장면 빛이 15% 가라앉는다.
                if (t > 2.1) { ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = .15 * clamp((t - 2.1) / .25); ctx.fillStyle = '#000'; ctx.fillRect(scene.x, scene.y, scene.w, scene.h); }
                if (reduced && ready && t >= 2.65) paintScene(echo.hall, echo.scene, null, clamp((t - 2.65) / .6));
            } else {
                // 파열: 우퍼에서 퍼지는 먼지 앞선 안쪽으로 잔향의 방이 드러나고, 판은 바깥으로 날아가며 일부는 그녀 앞을 지난다.
                const e = t - 2.65, R = 980 * map.s * ease(clamp(e / .65));
                paintScene(echo.hall, layer, e < .65 ? [cx, cy, R] : null);
                net.plates.forEach((p, i) => {
                    const dx = p.cx - wx, dy = p.cy - wy, d = Math.hypot(dx, dy) || 1, tau = Math.max(0, e - d / 2400);
                    let vx, vy, w;
                    if (p.cy < 210) { vx = Math.sign(dx) * 160; vy = -40; w = Math.sign(dx) * (1.6 + rand(i + 510)); }
                    else { const v = (650 + rand(i + 500) * 450) * (1.25 - Math.min(1, d / 420) * .6); vx = dx / d * v; vy = dy / d * v - 220; w = (rand(i + 501) - .5) * 7; }
                    drawPlate(p, map, vx * tau * map.s, (vy * tau + 1000 * tau * tau) * map.s, w * tau, (5 + rand(i + 502) * 6) * map.s, 1 - clamp((t - 3.6) / .3));
                });
                const smoke = texture('mist') || puff(), dust = stoneDust(), thin = 1 - clamp((t - 3.65) / .35);
                ctx.globalCompositeOperation = 'source-over';
                if (e < .9) for (let k = 0; k < 12; k++) {
                    const a = k / 12 * TAU + rand(k + 830) * .4, rr = R * (.92 + rand(k + 831) * .12), size = Math.max(40 * u, R * .55);
                    material(ctx, smoke, cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .8, size, size * .62, (1 - clamp(e / .9)) * .7, a);
                }
                for (let k = 0; k < (width < 420 ? 5 : 8); k++) {
                    const a = rand(k + 840) * TAU, dist = (60 + rand(k + 841) * 260) * map.s * (.4 + ease(clamp(e / 1.1))), size = (120 + rand(k + 842) * 140) * map.s;
                    material(ctx, dust, cx + Math.cos(a) * dist, cy + Math.sin(a) * dist * .6 + e * 30 * map.s, size, size * .7, .5 * thin * clamp(e / .15));
                }
            }
            veil(state.veil);
        }

        function draw(state, t) {
            const kind = state.kind, ev = state.event, reduced = motion.matches;
            const duration = Number(ev.duration || 0), seed = state.seed;
            if (CAST_IMPACT.has(kind) && ev.stage !== 'resolved') t = Math.min(t, Math.max(0, duration - .001));
            const end = t - duration;
            const fade = end > 0 ? clamp(1 - end / tailTime(kind)) : 1;
            if (INSTANT.has(kind) && end > 0) return;
            ctx.save();
            ctx.beginPath(); ctx.rect(scene.x, scene.y, scene.w, scene.h); ctx.clip();
            if (kind === 'harden') sheen(t, 1, fade, reduced);
            else if (kind === 'empower') empower(t, fade, reduced, seed);
            else if (kind === 'regenerate') { if (Number(ev.amount) > 0) regenerate(t, duration, reduced, seed); }
            else if (kind === 'purge') purge(t, duration, reduced, seed);
            else if (kind === 'execute') execute(t, duration, reduced, seed);
            else if (kind === 'flame') flame(t, duration, reduced, seed);
            else if (kind === 'cannon') cannon(t, duration, ev, reduced, seed);
            else if (kind === 'charge') {
                // 기모아: 금빛 기운이 바깥 고리에서 몸 안으로 빨려 든다. 저지 결과에 따라 갈리므로 끝 폭발은 그리지 않는다.
                charge(t, duration, [236, 190, 100], [255, 242, 210], false, fade, reduced);
            }
            else if (kind === 'berserk') berserk(t, reduced, seed);
            else if (kind === 'dark-shield') darkShield(t, fade, reduced);
            else if (kind === 'mochi-shield') mochiShield(t, fade, reduced);
            else if (kind === 'rain-shield') rainShield(t, fade, reduced, seed);
            else if (kind === 'dark-blast') darkBlast(t, reduced, seed);
            else if (kind === 'crit-reflect') critReflect(t, ev, reduced, seed);
            else if (kind === 'revive') revive(t, duration, reduced);
            else if (kind === 'puzzle') puzzle(t, reduced, seed);
            else if (kind === 'dealing') dealing(t, duration, ev, reduced);
            else if (kind === 'dealing-ready') dealingReady(t, duration, reduced, seed);
            else if (kind === 'dealing-strike') dealingStrike(t, reduced);
            else if (kind === 'bounce') bounce(t, ev, reduced);
            else if (kind === 'mark') markCue(t, ev, reduced);
            else if (kind === 'burden') burden(t, state, reduced);
            else if (kind === 'sculpture') sculpture(state, t, reduced);
            else if (kind === 'carve-break') carveBreak(state, t, reduced);
            else if (kind === 'shards') shards(t, fade, reduced);
            else if (kind === 'resonance') charge(t, duration, VIOLET, VIOLET_HOT, true, fade, reduced);
            else if (kind === 'echo') echo(t, fade, reduced);
            else if (kind === 'dictation' || kind === 'voice') {
                // 외침: 둥근 고리 대신 좌우로 퍼지는 음파 호.
                const [x, y] = point(...focus), r = Math.min(scene.w, scene.h) * .34;
                ctx.lineCap = 'round'; ctx.strokeStyle = rgba(PALE_HOT, 1);
                for (let i = 0; i < 3; i++) {
                    const p = reduced ? .3 + i * .2 : (t * .8 + i / 3) % 1;
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - p) * .45; ctx.lineWidth = 2 - p;
                    for (const dir of [0, Math.PI]) { ctx.beginPath(); ctx.arc(x, y, r * (.15 + p * .85), dir - .45, dir + .45); ctx.stroke(); }
                }
            } else if (kind === 'pulse' || kind === 'inversion') flow(t, ev, kind === 'inversion', reduced);
            else if (kind === 'trial' && ev.stage === 'record') {
                // 기록 중: 차가운 막이 몸을 덮고 주사선이 아래로 훑는다.
                const scan = reduced ? .5 : (t * .45) % 1;
                skin((m, b) => {
                    const gradient = m.createLinearGradient(0, b.y + b.h * (scan - .12), 0, b.y + b.h * (scan + .12));
                    gradient.addColorStop(0, rgba(PALE, .15)); gradient.addColorStop(.5, rgba(PALE_HOT, 1)); gradient.addColorStop(1, rgba(PALE, .15));
                    m.fillStyle = gradient; m.fillRect(b.x, b.y, b.w, b.h);
                }, .35, 'lighter');
            } else if (kind === 'shield' || kind === 'trial') shield(t, state, PALE, PALE_HOT, reduced);
            else if (kind === 'reflect') mirror(t, fade, reduced, seed);
            else if (kind === 'curse') {
                skin((m, b) => { m.fillStyle = 'rgba(60,20,90,1)'; m.fillRect(b.x, b.y, b.w, b.h); }, .4 + (reduced ? 0 : Math.sin(t * 2) * .08), 'multiply');
                ctx.save(); ctx.translate(point(.5, 1)[0], groundY()); ctx.scale(1, .25);
                glow(0, 0, (spriteRect?.w || scene.w * .4) * .6, [120, 60, 190], .35);
                ctx.restore();
            } else if (kind === 'transition') transition(state, Math.min(t, 4), reduced);
            else if (kind === 'wall') {
                // 양쪽 벽이 소리에 떨린다.
                const strength = Math.sin(clamp(t / Math.max(.1, duration)) * Math.PI), size = scene.w * .14;
                ctx.globalCompositeOperation = 'lighter';
                for (const side of [0, 1]) {
                    const edge = side ? scene.x + scene.w : scene.x, dir = side ? -1 : 1;
                    const gradient = ctx.createLinearGradient(edge, 0, edge + dir * size, 0);
                    gradient.addColorStop(0, rgba(VIOLET, .35)); gradient.addColorStop(1, rgba(VIOLET, 0));
                    ctx.globalAlpha = strength * fade; ctx.fillStyle = gradient; ctx.fillRect(Math.min(edge, edge + dir * size), scene.y, size, scene.h);
                    ctx.strokeStyle = rgba(VIOLET_HOT, 1); ctx.lineWidth = 1.2;
                    for (let k = 0; k < 4; k++) {
                        const x0 = edge + dir * size * (.15 + k * .2);
                        ctx.globalAlpha = strength * (.5 - k * .1) * fade; ctx.beginPath();
                        for (let y = scene.y; y <= scene.y + scene.h; y += 8) {
                            const x = x0 + Math.sin(y * .06 + (reduced ? 0 : t * 38) + k) * size * .06 * strength;
                            if (y === scene.y) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                        }
                        ctx.stroke();
                    }
                }
            } else if (kind === 'rupture') {
                const [x, y] = point(...focus), reach = Math.hypot(scene.w, scene.h) * .45, grow = reduced ? 1 : ease(clamp(t / .2)), alpha = clamp(1 - t / 1.3);
                ctx.globalCompositeOperation = 'lighter';
                for (let i = 0; i < 7; i++) {
                    const angle = i / 7 * TAU + rand(i + 30) * .4, r = reach * (.6 + rand(i + 31) * .4) * grow;
                    bolt(ctx, x, y, x + Math.cos(angle) * r, y + Math.sin(angle) * r, i * 17, RED, RED_HOT, alpha * .9, 1.8);
                }
                glow(x, y, reach * .25, RED_HOT, alpha * .6);
                band(x, y, reach * (.1 + (reduced ? .3 : ease(clamp(t / .6))) * .9), reach * .08, RED, alpha * .6);
            } else if (kind === 'pillars') {
                // 하중이 큰 기둥일수록 돌가루가 많이 떨어진다.
                for (let i = 0; i < 4; i++) {
                    const load = clamp(Number(ev.loads?.[i] || 0) / 12), x = scene.x + scene.w * (.16 + i * .22);
                    const gradient = ctx.createLinearGradient(0, scene.y, 0, scene.y + scene.h);
                    gradient.addColorStop(0, rgba(BRONZE, .3 * load)); gradient.addColorStop(1, rgba(BRONZE, 0));
                    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1; ctx.fillStyle = gradient; ctx.fillRect(x - 10, scene.y, 20, scene.h);
                    if (!reduced) for (let k = 0; k < Math.round(load * 5); k++) {
                        const p = (t * (.6 + rand(i * 9 + k) * .5) + rand(i * 9 + k + 1)) % 1;
                        glow(x + (rand(i * 9 + k + 2) - .5) * 16, scene.y + p * scene.h * .9, 2.5, [214, 196, 168], (1 - p) * .6, false);
                    }
                }
            } else if (kind === 'blessing') {
                const [x, top] = point(.5, 0), w = (spriteRect?.w || scene.w * .4) * .5, ground = groundY();
                const gradient = ctx.createLinearGradient(0, scene.y, 0, ground);
                gradient.addColorStop(0, 'rgba(255,240,206,.32)'); gradient.addColorStop(1, 'rgba(255,240,206,0)');
                ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = reduced ? .7 : .6 + Math.sin(t * 2) * .15; ctx.fillStyle = gradient;
                ctx.beginPath(); ctx.moveTo(x - w * .3, scene.y); ctx.lineTo(x + w * .3, scene.y); ctx.lineTo(x + w, ground); ctx.lineTo(x - w, ground); ctx.closePath(); ctx.fill();
                glow(x, top + (spriteRect?.h || 0) * .4, w * 1.2, [255, 236, 200], .12);
            } else if (kind === 'shatter') shatter(t);
            ctx.restore();
        }
        function render(now) {
            frame = 0;
            if (document.hidden || !busy() || !width || !height) { ctx.clearRect(0, 0, width, height); if (!busy()) hold(false); return; }
            if (now - lastFrame < 32) { frame = requestAnimationFrame(render); return; }
            const dt = Math.min(.1, (now - lastFrame) / 1000);
            lastFrame = now; frameDt = dt; ctx.clearRect(0, 0, width, height);
            locate();
            if (mistAlive()) { ctx.save(); drawMist(now, dt, motion.matches); ctx.restore(); }
            if (handoff) {
                // 실제 무대가 잔향 그림으로 바뀌고 해독이 끝난 뒤에 넘긴다. 같은 픽셀이라 이음새가 없다.
                const image = document.getElementById('pqBossIllustImg'), background = image?.closest('.pq-scene-plane')?.querySelector('.pq-stage-background');
                if ((image?.src === handoff.scene.src && image.complete && image.naturalWidth && (!background || background.complete)) || now - handoff.at > 8000) handoff = null;
                else { ctx.save(); ctx.beginPath(); ctx.rect(scene.x, scene.y, scene.w, scene.h); ctx.clip(); paintScene(handoff.hall, handoff.scene, null); ctx.restore(); }
            }
            for (const [id, state] of states) {
                const age = (now - state.start) / 1000, ev = state.event;
                const finite = ev.remain != null || state.kind === 'shatter' || state.kind === 'carve-break';
                if (state.removed && age > Number(ev.duration || 0) + tailTime(state.kind)) { stopSounds(state); states.delete(id); continue; }
                state.plan.forEach(([at, key, gain], i) => {
                    if (state.fired.has(i) || age < at) return;
                    if (CAST_IMPACT.has(state.kind) && at >= Number(ev.duration || 0) && ev.stage !== 'resolved') return;
                    state.fired.add(i);
                    if (age - at <= .15) play(state, key, gain);
                });
                // 형태 전환은 서버가 잔향으로 넘길 때까지 마지막 장면을 유지한다.
                state.hold = false;
                if (!finite || state.kind === 'transition' || age <= Number(ev.duration || 0) + tailTime(state.kind)) draw(state, age);
            }
            hold(!!handoff || [...states.values()].some(state => state.hold));
            if (busy()) frame = requestAnimationFrame(render);
        }
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { cancelAnimationFrame(frame); frame = 0; stopSounds(); }
            else kick();
        });
        return { update, reset, setVolume, markTargets: () => targets(currentView?.events || []), visualOnly: event => event.stage === 'resolved' || VISUAL_ONLY.has(kindOf(event)) };
    }
    window.RaidPatternFX = { create };
})();
