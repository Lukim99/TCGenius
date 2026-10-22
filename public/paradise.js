(function () {
    'use strict';
    const sceneCanvas = document.getElementById('paScene'), hudCanvas = document.getElementById('paHud');
    const controls = document.getElementById('paControls'), puzzleForm = document.getElementById('paPuzzle'), live = document.getElementById('paLive');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const ratio = (n, max) => clamp(Number(n) / Math.max(1, Number(max)), 0, 1);
    const asset = name => '/rpg-ui?file=%EB%82%99%EC%9B%90%2F' + (name === 'hell' ? 'hell-hd-v2' : name) + '.webp';
    const FONT = 'ParadiseSans,Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    const colors = { silver: '#c9d7de', gold: '#e8c272', prismatic: '#c4a2f2', cursed: '#e0707f' };
    const metals = { silver: ['#f4f8fa', '#7f8d96', '#e2e9ec', '#66737b'], gold: ['#fff0c2', '#b4842f', '#f2d184', '#86601f'], prismatic: ['#ffd9f3', '#8fd3ff', '#c4a3ff', '#ffe0a3', '#97eed2'], cursed: ['#ffb8c1', '#84243a', '#df6b7d', '#561522'], ember: ['#ffd2a0', '#8a2f14', '#f08048', '#4f1a0c'], iron: ['#e6ddd0', '#6d625a', '#c4b8aa', '#4a403a'] };
    const glowTint = { silver: [.75, .86, .92], gold: [1, .8, .45], prismatic: [.75, .62, 1], cursed: [1, .36, .42] };
    const tier = { silver: '실버 증강', gold: '골드 증강', prismatic: '프리즘 증강', cursed: '저주 증강' };
    const POWER_WARNING = '위험!';
    const relicInk = { normal: '#c9d4da', advanced: '#f0c66a', special: '#cf9dff' }, relicGlow = { normal: [.72, .82, .88], advanced: [1, .78, .4], special: [.78, .58, 1] }, relicMetal = { normal: 'silver', advanced: 'gold', special: 'prismatic' };
    const routeLook = { normal: { metal: 'silver', ink: '#c9d7de', glow: [.6, .8, .92], sigil: 'blade' }, elite: { metal: 'cursed', ink: '#ee8f95', glow: [1, .34, .32], sigil: 'devil' }, event: { metal: 'prismatic', ink: '#c9a8f4', glow: [.7, .56, 1], sigil: 'mystery' } };
    // 층 이동 연출: 어둡게(OUT) → 유지(HOLD) → 목적지로 밝게(IN). 전체 1.25초 안쪽.
    const FADE_OUT = 260, FADE_HOLD = 140, FADE_IN = 520, FADE_END = 1250;
    let state = null, ranking = null, busy = false, pending = null, offset = 0, message = '', messageUntil = 0, fontsReady = false;
    let overlay = null, overlayPage = 0, inventoryTab = 'relics', focused = 1, hover = -1, pointer = { x: 0, y: 0 }, selection = null;
    let sceneKey = '', sceneAt = performance.now(), regions = [], regionKey = '', puzzleKey = '', activeScene = 'lobby', expiredPuzzle = '';
    const audio = window.ParadiseAudio, battle = window.ParadiseBattle, battleRoot = document.getElementById('paBattle');
    let battleUntil = 0, heldBattle = null, keyboardCard = -1, inputMode = 'pointer';
    const hoverLevels = [0, 0, 0]; let hoverTime = performance.now();
    let hellKey = null, fall = null, landing = null, lastDropKey = '', chestPick = null, chestPage = 0;
    let lobbyScroll = 0, lobbyHeight = 0, transition = null;
    let outcomeReveal = null, rewardReveal = null, heavenEntry = null, noticeDetail = '';
    const now = () => Date.now() + offset;
    const rand = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
    const ctx = hudCanvas.getContext('2d');
    function displayText(value) { return String(value).replace(/\s*·\s*/g, ', '); }
    function announce(text, visible = true) { live.textContent = displayText(text || ''); message = visible ? live.textContent : ''; messageUntil = performance.now() + (innerWidth < 700 ? 2800 : 4500); }
    function sound(kind) { audio.play(kind); }

    // 기존 필드와 같은 WebGL 장면 + 캔버스 HUD 구조. 증강 카드는 화면 크기 그대로의 텍스처로 올려 글자가 축소되지 않게 한다.
    class CorridorGL {
        constructor(canvas) {
            this.canvas = canvas; this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, powerPreference: 'high-performance' });
            if (!this.gl) throw new Error('WebGL을 사용할 수 없습니다. 브라우저의 그래픽 가속을 켜고 다시 접속해주세요.');
            this.images = new Map(); this.cards = new Map(); this.cardSize = '';
            const gl = this.gl;
            const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
            const program = gl.createProgram();
            gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p;attribute vec2 uv;uniform vec2 resolution;varying vec2 v;void main(){gl_Position=vec4(p/resolution*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);v=uv;}'));
            gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float;uniform sampler2D tex;uniform vec4 tint;varying vec2 v;void main(){gl_FragColor=texture2D(tex,v)*tint;}'));
            gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('회랑 그래픽 셰이더를 연결하지 못했습니다.');
            gl.useProgram(program); this.program = program; this.res = gl.getUniformLocation(program, 'resolution'); this.tint = gl.getUniformLocation(program, 'tint'); this.buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); const p = gl.getAttribLocation(program, 'p'), uv = gl.getAttribLocation(program, 'uv'); gl.enableVertexAttribArray(p); gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            const glow = document.createElement('canvas'); glow.width = glow.height = 128; const g = glow.getContext('2d'), fill = g.createRadialGradient(64, 64, 0, 64, 64, 64); fill.addColorStop(0, '#ffffffbb'); fill.addColorStop(.22, '#ffffff66'); fill.addColorStop(1, '#ffffff00'); g.fillStyle = fill; g.fillRect(0, 0, 128, 128); this.glow = this.texture(glow);
            canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); fatal('그래픽 장치 연결이 끊겼습니다. 새로고침하면 저장된 탐험으로 돌아갑니다.'); });
        }
        texture(source) { const gl = this.gl, tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); return { tex, width: source.width, height: source.height }; }
        clearCards() { for (const texture of this.cards.values()) this.gl.deleteTexture(texture.tex); this.cards.clear(); }
        image(url) { if (!url) return null; if (!this.images.has(url)) { const image = new Image(), entry = { image, ready: false }; image.decoding = 'async'; image.onload = () => { Object.assign(entry, this.texture(image), { ready: true }); this.clearCards(); }; image.src = url; this.images.set(url, entry); } return this.images.get(url); }
        quad(texture, x, y, w, h, tint = [1, 1, 1, 1], uv = [0, 0, 1, 1], tilt = 0) {
            if (!texture?.tex || w <= 0 || h <= 0) return;
            const gl = this.gl, [u, v, uw, vh] = uv, bend = tilt * h * .035;
            gl.bindTexture(gl.TEXTURE_2D, texture.tex); gl.uniform4fv(this.tint, tint);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([x, y + bend, u, v, x + w, y - bend, u + uw, v, x, y + h - bend, u, v + vh, x, y + h - bend, u, v + vh, x + w, y - bend, u + uw, v, x + w, y + h + bend, u + uw, v + vh]), gl.STREAM_DRAW); gl.drawArrays(gl.TRIANGLES, 0, 6);
        }
        cover(texture, x, y, w, h, tint) { if (!texture?.ready) return; const source = texture.width / texture.height, target = w / h; let uv = [0, 0, 1, 1]; if (source > target) { const width = target / source; uv = [(1 - width) / 2, 0, width, 1]; } else { const height = source / target; uv = [0, (1 - height) / 2, 1, height]; } this.quad(texture, x, y, w, h, tint, uv); }
        sprite(url, x, y, w, h, mirror = false) { const image = this.image(url); if (!image?.ready) return; const scale = Math.min(w / image.width, h / image.height), sw = image.width * scale, sh = image.height * scale; this.quad(image, x + (w - sw) / 2, y + h - sh, sw, sh, mirror ? [.65, .9, 1, 1] : [1, 1, 1, 1], mirror ? [1, 0, -1, 1] : [0, 0, 1, 1]); }
        begin(w, h) { const gl = this.gl; gl.viewport(0, 0, this.canvas.width, this.canvas.height); gl.clearColor(.015, .025, .04, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.useProgram(this.program); gl.uniform2f(this.res, w, h); }
        card(choice, w, h) {
            if (!fontsReady) return null;
            w = Math.round(w); h = Math.round(h); const size = `${w}x${h}@${devicePixelRatio}`; if (size !== this.cardSize) { this.clearCards(); this.cardSize = size; }
            const key = JSON.stringify(choice); if (!this.cards.has(key)) this.cards.set(key, this.texture(paintCard(choice, this.image(choice.iconUrl), w, h))); return this.cards.get(key);
        }
    }
    let renderer;
    function fatal(text) { const node = document.getElementById('paFatal'); node.hidden = false; node.textContent = text; const button = document.createElement('button'); button.textContent = '새로고침'; button.onclick = () => location.reload(); node.append(document.createElement('br'), button); }
    try { renderer = new CorridorGL(sceneCanvas); } catch (error) { fatal(error.message); return; }
    // 카드 텍스처는 글꼴이 준비된 뒤에만 굽는다. 실패하거나 늦어지면 대체 글꼴로 진행.
    const fontWait = document.fonts ? Promise.all(['500 16px ParadiseSans', '700 16px ParadiseSans', '800 16px ParadiseSans'].map(font => document.fonts.load(font))) : Promise.resolve();
    Promise.race([fontWait, new Promise(resolve => setTimeout(resolve, 3000))]).catch(() => {}).then(() => { fontsReady = true; renderer.clearCards(); });

    function path(c, points, close = true) { c.beginPath(); points.forEach(([x, y], index) => index ? c.lineTo(x, y) : c.moveTo(x, y)); if (close) c.closePath(); }
    function rr(c, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
    function chamfer(c, x, y, w, h, k) { path(c, [[x + k, y], [x + w - k, y], [x + w, y + k], [x + w, y + h - k], [x + w - k, y + h], [x + k, y + h], [x, y + h - k], [x, y + k]]); }
    // 아이콘의 불투명 영역 경계를 한 번만 계산해 캐시한다. (원본 파일은 그대로)
    function trimmed(entry) {
        if (entry.trim) return entry.trim;
        const image = entry.image, s = 128, probe = document.createElement('canvas'); probe.width = probe.height = s; const g = probe.getContext('2d'); g.drawImage(image, 0, 0, s, s);
        let data; try { data = g.getImageData(0, 0, s, s).data; } catch (_) { return entry.trim = [0, 0, image.width, image.height]; }
        let x0 = s, y0 = s, x1 = -1, y1 = -1; for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) if (data[(y * s + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (x1 < 0) return entry.trim = [0, 0, image.width, image.height];
        const kx = image.width / s, ky = image.height / s; x0 = Math.max(0, x0 - 2); y0 = Math.max(0, y0 - 2); x1 = Math.min(s, x1 + 3); y1 = Math.min(s, y1 + 3);
        return entry.trim = [x0 * kx, y0 * ky, (x1 - x0) * kx, (y1 - y0) * ky];
    }
    function text(c, value, x, y, size = 14, color = '#ece8de', align = 'left', weight = 500, maxWidth, shadow = true) { c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color; c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = shadow ? 4 : 0; if (maxWidth) c.fillText(displayText(value), x, y, maxWidth); else c.fillText(displayText(value), x, y); c.shadowBlur = 0; }
    function wrap(c, value, width, fontSize = 14, maxLines = 10, weight = 500) {
        c.font = `${weight} ${fontSize}px ${FONT}`; const rows = [];
        for (const paragraph of displayText(value || '').split('\n')) { let line = ''; for (const word of paragraph.split(/\s+/)) { const next = line ? line + ' ' + word : word; if (c.measureText(next).width <= width) { line = next; continue; } if (line) rows.push(line); line = ''; for (const char of word) { if (line && c.measureText(line + char).width > width) { rows.push(line); line = ''; } line += char; } } if (line) rows.push(line); }
        if (rows.length > maxLines) { let last = rows[maxLines - 1]; while (last && c.measureText(last + '…').width > width) last = last.slice(0, -1); rows[maxLines - 1] = last + '…'; }
        return rows.slice(0, maxLines);
    }
    function paragraph(c, value, x, y, width, size = 14, color = '#c9d2d4', lineHeight = size * 1.55, maxLines = 8, align = 'left', weight = 500) { const lines = wrap(c, value, width, size, maxLines, weight); lines.forEach((line, i) => text(c, line, x, y + i * lineHeight, size, color, align, weight)); return lines.length * lineHeight; }
    function line(c, x, y, xx, yy, color = '#ffffff22', width = 1) { c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.strokeStyle = color; c.lineWidth = width; c.stroke(); }
    function panel(c, x, y, w, h, { alpha = .82, edge, r = 12 } = {}) { rr(c, x, y, w, h, r); c.fillStyle = `rgba(11,16,22,${alpha})`; c.fill(); let stroke = edge; if (!stroke) { stroke = c.createLinearGradient(0, y, 0, y + h); stroke.addColorStop(0, 'rgba(255,255,255,.18)'); stroke.addColorStop(1, 'rgba(255,255,255,.05)'); } c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
    function metal(c, rarity, x, y, w, h) { const list = metals[rarity] || metals.gold, g = c.createLinearGradient(x, y, x + w, y + h); list.forEach((color, i) => g.addColorStop(i / (list.length - 1), color)); return g; }
    function warnLabel(warn) { return warn ? `, ${POWER_WARNING}` : ''; }
    // 유물 등급 표식: 작은 보석 + 등급명. 이름과 이어 붙이지 않고 따로 놓는다.
    function tierMark(c, relic, x, y, align = 'left') {
        const ink = relicInk[relic.rarity] || relicInk.normal, label = relic.rarityLabel || '', h = 20;
        c.font = `700 12px ${FONT}`; const bw = c.measureText(label).width + 30, bx = align === 'right' ? x - bw : align === 'center' ? x - bw / 2 : x;
        chamfer(c, bx, y - h / 2, bw, h, 5); c.fillStyle = 'rgba(8,11,16,.84)'; c.fill(); c.strokeStyle = ink + '66'; c.lineWidth = 1; c.stroke();
        const gx = bx + 11, gem = c.createLinearGradient(gx, y - 5, gx, y + 5); gem.addColorStop(0, '#ffffff'); gem.addColorStop(.45, ink); gem.addColorStop(1, ink + '77');
        path(c, [[gx, y - 5.5], [gx + 4.5, y], [gx, y + 5.5], [gx - 4.5, y]]); c.fillStyle = gem; c.fill();
        text(c, label, bx + 21, y + .5, 12, ink, 'left', 700, undefined, false);
        return bw;
    }
    function drawWarning(c, x, y, w, h) {
        chamfer(c, x, y, w, h, 6); c.fillStyle = 'rgba(224,63,74,.12)'; c.fill(); c.strokeStyle = 'rgba(239,85,96,.5)'; c.lineWidth = 1; c.stroke();
        text(c, POWER_WARNING, x + w / 2, y + h / 2, 14, '#ff777f', 'center', 700, w - 20);
    }
    function sigil(c, id, x, y, size, color, category) {
        if (category && !['firstStrike','blade','execution','combo','comeback','lastStand','unyielding','ironSkin','insurance','thirst','risk','devil','glass','focus','clarity','pilgrim','future','rewind','forbidden','rest','gambler','greed','contract','cursedTreasure','duplicate'].includes(id)) {
            id = { basic:'blade', skill:'manaCycle', critical:'focus', dot:'thirst', combo:'combo', shield:'ironSkin', ultimate:'forbidden', active:'manaCycle', passive:'clarity', defense:'ironSkin', recovery:'thirst', exploration:'rewind', risk:'devil', reward:'contract' }[category] || id;
        }
        c.save(); c.translate(x, y); c.scale(size / 100, size / 100); c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 4.5; c.lineCap = 'round'; c.lineJoin = 'round';
        const stroke = points => { path(c, points, false); c.stroke(); };
        const circle = (x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.stroke(); };
        const sword = (angle = 0) => { c.save(); c.rotate(angle); path(c, [[-6, 19], [-7, -30], [0, -47], [7, -30], [6, 19]]); c.stroke(); stroke([[-23, 20], [0, 15], [23, 20]]); stroke([[0, 20], [0, 44]]); circle(0, 47, 4); c.restore(); };
        if (['firstStrike', 'blade', 'execution', 'combo', 'comeback'].includes(id)) {
            if (id === 'combo') { sword(-.55); sword(.55); } else { sword(id === 'execution' ? .45 : .15); if (id === 'firstStrike') for (let i = 0; i < 5; i++) { const a = -Math.PI + i * .5; stroke([[Math.cos(a) * 33, Math.sin(a) * 33 - 8], [Math.cos(a) * 46, Math.sin(a) * 46 - 8]]); } }
        } else if (['lastStand', 'unyielding', 'ironSkin', 'insurance'].includes(id)) { path(c, [[0, -43], [36, -27], [31, 17], [0, 45], [-31, 17], [-36, -27]]); c.stroke(); if (id === 'lastStand') stroke([[4, -30], [-9, -6], [9, 1], [-7, 29]]); else { stroke([[-18, 0], [-3, 14], [22, -15]]); } }
        else if (['thirst', 'risk', 'devil', 'glass'].includes(id)) { c.beginPath(); c.moveTo(0, -44); c.bezierCurveTo(5, -22, 37, -6, 29, 22); c.bezierCurveTo(24, 48, -25, 48, -29, 22); c.bezierCurveTo(-37, -6, -5, -22, 0, -44); c.stroke(); stroke([[0, -17], [-8, 4], [7, 9], [0, 30]]); if (id === 'devil') { stroke([[-20, -19], [-37, -38], [-31, -10]]); stroke([[20, -19], [37, -38], [31, -10]]); } }
        else if (['focus', 'clarity', 'pilgrim'].includes(id)) { c.beginPath(); c.moveTo(-45, 0); c.quadraticCurveTo(0, -45, 45, 0); c.quadraticCurveTo(0, 45, -45, 0); c.stroke(); circle(0, 0, 15); circle(0, 0, 5); stroke([[0, -38], [0, -49]]); stroke([[0, 38], [0, 49]]); }
        else if (['future', 'rewind', 'forbidden', 'rest'].includes(id)) { stroke([[-29, -40], [29, -40], [27, -28], [-24, 29], [-29, 40], [29, 40], [24, 28], [-27, -28], [-29, -40]]); stroke([[-15, 27], [15, 27]]); circle(0, 0, 6); }
        else if (['gambler', 'greed'].includes(id)) { path(c, [[-29, -32], [29, -32], [34, 26], [-25, 33]]); c.stroke(); [[-14, -16], [15, -16], [0, 0], [-13, 18], [17, 17]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill(); }); }
        else if (['contract', 'cursedTreasure'].includes(id)) { path(c, [[-23, -40], [25, -40], [32, -31], [26, 35], [-26, 35], [-31, 26], [-23, -40]]); c.stroke(); stroke([[-12, -19], [17, -19]]); stroke([[-15, -5], [13, -5]]); circle(5, 24, 11); stroke([[1, 34], [-5, 47], [5, 41], [14, 48], [13, 34]]); }
        else { circle(0, 0, 31); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4; stroke([[Math.cos(a) * 36, Math.sin(a) * 36], [Math.cos(a) * 46, Math.sin(a) * 46]]); } path(c, [[0, -25], [13, 0], [0, 25], [-13, 0]]); c.stroke(); }
        c.restore();
    }
    // 카드 크기(w×h)는 실제 화면 표시 크기. 모바일은 별도 비율로 그려 본문이 14px 아래로 내려가지 않는다.
    function paintCard(choice, icon, w, h) {
        const dpr = Math.min(devicePixelRatio || 1, 2), canvas = document.createElement('canvas'); canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); const c = canvas.getContext('2d'); c.scale(dpr, dpr);
        const color = colors[choice.rarity] || colors.gold, warn = choice.powerWarning, top = 8, cx = w / 2, edge = metal(c, choice.rarity, 0, 0, w, h);
        const pad = Math.round(w * .08), tw = w - pad * 2, nameSize = clamp(Math.round(w * .074), 20, 25), names = wrap(c, choice.name, tw, nameSize, 2, 700);
        const bodySize = clamp(Math.round(w * .5) / 10, 14.5, 16.5), lh = bodySize * 1.5;
        const textHeight = names.length * nameSize * 1.22 + wrap(c, choice.desc, tw, bodySize, 30).length * lh + 112 + (warn ? 44 : 0);
        const artH = Math.round(Math.max(48, Math.min(w * .66, h * .44, h - textHeight))), cy = top + artH * .55;
        const outline = () => chamfer(c, 2, top, w - 4, h - top - 2, 16);
        outline(); const bg = c.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, choice.rarity === 'cursed' ? '#2a161c' : '#1a2430'); bg.addColorStop(.5, '#0e141b'); bg.addColorStop(1, '#090d12'); c.fillStyle = bg; c.fill();
        c.save(); c.clip(); const light = c.createRadialGradient(cx, cy, 0, cx, cy, w * .62); light.addColorStop(0, color + '4a'); light.addColorStop(.45, color + '12'); light.addColorStop(1, color + '00'); c.fillStyle = light; c.fillRect(0, 0, w, artH + 60); c.restore();
        // 메달리온: 어두운 원판 + 금속 테두리. 장비 아이콘은 투명 여백을 잘라 원판을 꽉 채운다.
        const r = Math.min(w * .3, artH * .44), disc = c.createRadialGradient(cx, cy - r * .2, 0, cx, cy, r); disc.addColorStop(0, color + '3a'); disc.addColorStop(.7, '#0d131add'); disc.addColorStop(1, '#080c11'); c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = disc; c.fill(); c.strokeStyle = edge; c.lineWidth = 1.5; c.stroke();
        c.beginPath(); c.arc(cx, cy, r - 5, 0, Math.PI * 2); c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.stroke();
        if (icon?.ready) { const [sx, sy, sw, sh] = trimmed(icon), box = r * 1.5, k = box / Math.max(sw, sh), dw = sw * k, dh = sh * k; c.save(); c.beginPath(); c.arc(cx, cy, r - 2, 0, Math.PI * 2); c.clip(); c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 14; c.shadowOffsetY = 4; c.drawImage(icon.image, sx, sy, sw, sh, cx - dw / 2, cy - dh / 2, dw, dh); c.restore(); }
        else sigil(c, choice.id, cx, cy, r * 1.15, color, choice.category);
        outline(); c.strokeStyle = edge; c.lineWidth = 2.5; c.stroke();
        chamfer(c, 8, top + 6, w - 16, h - top - 14, 12); c.strokeStyle = 'rgba(255,255,255,.07)'; c.lineWidth = 1; c.stroke();
        path(c, [[cx, 0], [cx + 9, top], [cx, top * 2], [cx - 9, top]]); c.fillStyle = metal(c, choice.rarity, cx - 9, 0, 18, 16); c.fill(); c.strokeStyle = '#0b0f14'; c.lineWidth = 1.5; c.stroke();
        let y = top + artH + 10 + nameSize * .6;
        names.forEach((name, i) => text(c, name, cx, y + i * nameSize * 1.22, nameSize, '#f5efe2', 'center', 700));
        y += (names.length - 1) * nameSize * 1.22 + nameSize * .6 + 12; line(c, cx - 14, y, cx + 14, y, color + 'bb', 2); y += 18;
        const tag = choice.equipment ? '장착 장비 전용' : choice.dangerous ? '위험 계약, 뒤틀림 +10' : '', footTop = h - 2 - 50, warnTop = footTop - (warn ? 44 : 0);
        const maxLines = Math.max(2, Math.floor((warnTop - 6 - y) / lh));
        paragraph(c, choice.desc, cx, y + bodySize * .5, tw, bodySize, '#d6dce0', lh, maxLines, 'center');
        if (warn) drawWarning(c, pad - 6, warnTop, w - (pad - 6) * 2, 32);
        // 하단 띠: 카드 외곽에 맞춰 잘린 어두운 바탕 + 금속 구분선, 층 이동과 조건을 한 줄로.
        c.save(); outline(); c.clip(); c.fillStyle = 'rgba(0,0,0,.32)'; c.fillRect(0, footTop, w, h); c.restore();
        c.save(); c.globalAlpha = .55; line(c, 4, footTop, w - 4, footTop, edge, 1); c.restore();
        const floors = choice.starting ? '시작 증강' : `${choice.floors > 0 ? '+' : ''}${choice.floors}층`, fy = footTop + 25, floorColor = choice.floors < 0 ? '#8fe0d2' : color;
        if (tag) { text(c, floors, pad, fy, 22, floorColor, 'left', 800); const fw = c.measureText(floors).width; text(c, tag, w - pad, fy + 1, 13, choice.dangerous ? '#e9a0a6' : '#a7b2b8', 'right', 500, tw - fw - 14); }
        else text(c, floors, cx, fy, 22, floorColor, 'center', 800);
        return canvas;
    }

    let stateLoading = false, rankingLoading = false, stateGeneration = 0;
    async function fetchState() {
        if (stateLoading || busy || pending || heavenEntry || transition?.next || document.hidden || performance.now()<battleUntil) return;
        stateLoading = true; const generation = stateGeneration;
        try { const response = await fetch('/api/paradise', { cache: 'no-store' }); if (response.status === 401) { location.href = '/'; return; } const result = await response.json(); if (!response.ok) throw new Error(result.error); if (generation === stateGeneration) accept(result); } catch (error) { if (generation === stateGeneration) announce(error.message); } finally { stateLoading = false; }
    }
    async function fetchRanking() { if (rankingLoading) return; rankingLoading = true; try { const response = await fetch('/api/paradise/ranking', { cache: 'no-store' }); if (response.ok) ranking = await response.json(); else announce('주간 랭킹을 불러오지 못했습니다.'); } catch (_) { announce('주간 랭킹 연결을 확인해주세요.'); } finally { rankingLoading = false; } }
    // 천상의 다음 조우(전투, 이벤트, 갈림길)가 바뀔 때만 층 이동 연출을 건다. 같은 응답의 재조회는 키가 같아 다시 재생되지 않는다.
    function encounter(run) {
        if (!run || run.mode === 'hell' || run.status !== 'active') return null;
        return run.phase === 'combat' ? `c${run.enemy?.id}@${run.floor}` : ['event', 'puzzle'].includes(run.phase) ? `e${run.event?.id}@${run.floor}` : run.phase === 'route' ? `r${run.floor}` : '';
    }
    function accept(next) {
        if (transition?.next) { const queued = transition.next; transition.next = null; apply(queued); }
        const from = encounter(state?.run), to = encounter(next.run);
        if (!heavenEntry && from != null && to && to !== from && state.run.id === next.run.id) {
            transition = { at: performance.now(), floor: next.run.floor !== state.run.floor ? next.run.floor : null, cue: next.run.phase === 'combat' ? '전투 시작' : '', next: null };
            // 전투 중이 아니면 이전 장면 위로 먼저 어두워진 뒤 상태를 바꾼다. 전투였다면 처치 연출(battleUntil)이 끝날 무렵 어두워진다.
            if (!reduced && state.run.phase !== 'combat') { transition.next = next; return; }
            apply(next);
            transition.at = Math.max(performance.now(), battleUntil - (reduced ? 0 : FADE_OUT));
            return;
        }
        apply(next);
    }
    function apply(next) {
        battle.prepare(next.player?.card);
        const run = next.run;
        const previous=battleState(state), upcoming=battleState(next), events=run?.combatEvents||[];
        const latest=previous&&events.filter(e=>e.enemyId===previous.target.id).at(-1);
        const leaving=previous&&(!upcoming||upcoming.target.id!==previous.target.id);
        if(previous&&leaving&&latest&&(latest.cleared||latest.defeated)) {
            heldBattle={...previous,serverNow:next.serverTime,player:{...previous.player,...next.player},target:{...previous.target,hp:latest.targetHp}};
            const duration=battle.update(heldBattle,events,next.runId);
            if(duration)battleUntil=performance.now()+duration;
        } else if(upcoming) battle.update(upcoming,events,next.runId);
        const key = JSON.stringify([run?.id, run?.phase, run?.event?.id, run?.enemy?.id, run?.offerId || run?.choices?.map(c => c.id), run?.altarUsed, run?.chests?.map(c => c.id + (c.opened ? '!' : '')), run?.routes?.map(r => r.id), run?.relicChoices?.map(r => r.id), run?.relicPicksRemaining]);
        if (key !== sceneKey) { sceneKey = key; sceneAt = Math.max(performance.now(),battleUntil, transition ? transition.at + (reduced ? 0 : FADE_OUT + FADE_HOLD) : 0); selection = null; focused = 1; hover = -1; keyboardCard = -1; hoverLevels.fill(0); fall = null; chestPick = null; chestPage = 0; renderer.clearCards(); if (run?.phase === 'augment') setTimeout(()=>{if(state?.run?.phase==='augment')sound('reveal');},Math.max(0,battleUntil-performance.now())); if (run?.altarUsed && run.phase === 'altar') sound('reveal'); }
        // 낙하 결과는 서버 응답 뒤에만 착지 연출로 보여준다.
        const drop = run?.mode === 'hell' ? run.lastDrop : null, dropKey = drop ? [run.id, drop.from, drop.to].join() : '';
        if (drop && state && dropKey !== lastDropKey) { landing = { drop, at: performance.now() }; sound('land'); fall = null; }
        lastDropKey = dropKey;
        const autoReturn = run?.outcome === 'timedOut' && (state?.run?.id !== run.id || state.run.outcome !== 'timedOut');
        state = next; offset = next.serverTime - Date.now(); activeScene = !run ? 'lobby' : run.phase === 'event' ? run.event.id : run.phase;
        if (autoReturn) {
            overlay = null; outcomeReveal = null;
            if (run.claimed && run.rewardSummary?.length) {
                rewardReveal = { title: '자동 귀환 보상', items: run.rewardSummary, page: 0, at: performance.now() };
                rewardReveal.items.forEach(item => { if (item.iconUrl) renderer.image(item.iconUrl); }); sound('reveal');
            }
            announce(run.timeoutClaimError || '제한 시간이 종료되어 자동 귀환했습니다.', false);
        }
        if (!ranking || ranking.week !== next.weekly.week) fetchRanking();
        audio.setScene(run?.status==='active'?(run.mode==='hell'?'hell':'heaven'):null);
        syncPuzzle(); regionKey = '';
    }
    async function mutate(action, input = {}, retry = false) {
        if (busy || heavenEntry || transition?.next || pending && !retry) return; busy = true; stateGeneration++; regionKey = '';
        if (!retry) { outcomeReveal = null; pending = { action, body: { ...input, requestId: crypto.randomUUID(), revision: action === 'shop/buy' ? state.shop.revision : action.startsWith('progression/') ? state.progression.revision : state.revision, ...(action === 'shop/buy' ? { catalogRevision: state.shop.catalogRevision } : {}), runId: state.runId } }; }
        try {
            const response = await fetch('/api/paradise/' + pending.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.body) });
            if (response.status === 401) { location.href = '/'; return; } const result = await response.json(); if (result.retryable) throw new Error(result.error);
            pending = null; if (result.state) accept(result.state); if (result.error) { if (state.run?.outcome !== 'timedOut' || action === 'claim') announce(result.error); selection = null; fall = null; chestPick = null; } else if (result.reveal?.kind === 'rewards') {
                rewardReveal = { ...result.reveal, page: 0, at: performance.now() };
                rewardReveal.items.forEach(item => { if (item.iconUrl) renderer.image(item.iconUrl); });
                announce('보상을 획득했습니다. ' + result.reveal.items.map(item => `${item.name} ${fmt(item.count)}개`).join(', '), false);
                sound('reveal');
            } else if (result.reveal) {
                outcomeReveal = {...result.reveal, at:performance.now()}; announce(result.message, false); sound(result.reveal.positive ? 'reveal' : 'land');
            } else if (!['attack', 'skill'].includes(action)) announce(result.message, !['enter', 'retire', 'claim', 'reroll', 'dismiss', 'route', 'relic', 'shop/buy'].includes(action));
            if (!result.error && action === 'shop/buy') { window.ParadiseShop.purchaseComplete(result.purchase); audio.play('purchase-v1', .38); }
            if (!result.error && action === 'dismiss') { overlay = null; outcomeReveal = null; lobbyScroll = 0; chestPage = 0; syncPuzzle(); }
            if (!result.error && action.startsWith('progression/')) { sound(result.state.progression.lastResult?.success ? 'reveal' : 'land'); }
            if (!result.error && action === 'reroll') { renderer.clearCards(); sound('reveal'); }
            if (!result.error && action === 'enter' && state.run?.mode !== 'hell') {
                heavenEntry = { at: performance.now(), ticket: state.ticket.iconUrl };
                renderer.image(state.ticket.iconUrl); sound('reveal');
            }
            if (['augment', 'event', 'retire', 'claim', 'dismiss'].includes(action)) fetchRanking();
        } catch (error) { announce(error.message || '연결이 끊겼습니다. 같은 요청으로 재시도해주세요.'); selection = null; fall = null; chestPick = null; }
        finally { busy = false; regionKey = ''; }
    }
    function pickRoute(route, index) { if (!route || busy || pending || selection || transition) return; selection = { index, started: performance.now() }; sound('select'); setTimeout(() => mutate('route', { choice: route.id }), reduced ? 0 : 380); }
    function pickRelic(relic, index) { if (!relic || busy || pending || selection || transition) return; selection = { index, started: performance.now() }; sound('select'); setTimeout(() => mutate('relic', { choice: relic.id }), reduced ? 0 : 420); }
    function choose(choice, index) { if (!choice || busy || pending || selection) return; selection = { index, started: performance.now() }; sound('select'); setTimeout(() => mutate('augment', { choice: choice.id }), reduced ? 0 : 430); }

    function syncPuzzle() {
        const event = state?.run?.phase === 'puzzle' ? state.run.event : null;
        puzzleForm.hidden = !event || overlay != null;
        if (!event) { puzzleKey = ''; return; }
        if (puzzleKey === event.puzzle.id) return; puzzleKey = event.puzzle.id; puzzleForm.replaceChildren();
        const p = event.puzzle; puzzleForm.style.gridTemplateColumns = `repeat(${p.grid?.size || Math.min(7, p.length)},1fr)`;
        for (let i = 0; i < p.length; i++) { const input = document.createElement('input'); input.type = 'text'; input.maxLength = 1; input.inputMode = /^[0-9]+$/.test(p.symbols) ? 'numeric' : 'text'; input.autocomplete = 'off'; input.setAttribute('aria-label', (i + 1) + '번째 칸'); const given = p.grid?.cells?.[i]; input.value = given || ''; input.readOnly = !!given; input.addEventListener('input', () => { if (input.value) [...puzzleForm.elements].slice(i + 1).find(e => !e.readOnly)?.focus(); }); puzzleForm.append(input); }
    }
    puzzleForm.onsubmit = event => { event.preventDefault(); submitPuzzle(); };
    function submitPuzzle() { mutate('puzzle', { answer: [...puzzleForm.querySelectorAll('input')].map(input => input.value).join('') }); }

    function register(x, y, w, h, label, fn, disabled = false) { regions.push({ x, y, w, h, label: displayText(label), fn, disabled: disabled || busy || !!pending }); }
    function inside(x, y, w, h) { return pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h; }
    function hitButton(x, y, w, h, label, fn, options = {}) {
        const hovered = !options.disabled && inside(x, y, w, h);
        chamfer(ctx, x, y, w, h, Math.min(7, h / 4));
        if (options.primary) { const g = ctx.createLinearGradient(0, y, 0, y + h); if (options.disabled) { g.addColorStop(0, '#4a4538'); g.addColorStop(1, '#37332a'); } else { g.addColorStop(0, hovered ? '#fbe3a4' : '#f0d18a'); g.addColorStop(1, hovered ? '#cc9d4b' : '#b98a3e'); } ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = options.disabled ? '#ffffff14' : '#fff3cc99'; }
        else { ctx.fillStyle = hovered ? 'rgba(30,40,50,.88)' : 'rgba(12,18,25,.74)'; ctx.fill(); ctx.strokeStyle = hovered ? 'rgba(240,220,170,.55)' : 'rgba(255,255,255,.14)'; }
        ctx.lineWidth = 1; ctx.stroke();
        const color = options.disabled ? (options.primary ? '#8d8572' : 'rgba(230,235,238,.32)') : options.primary ? '#1d1608' : '#ece8de';
        if (options.icon) {
            const cx = x + w / 2;
            iconAt(options.icon, cx - 60, y + (h - 36) / 2, 36);
            text(ctx, options.glyph ?? label, cx - 14, y + h / 2 + .5, options.size || 14, color, 'left', 700, w / 2, false);
        } else text(ctx, options.glyph ?? label, x + w / 2, y + h / 2 + .5, options.size || 14, color, 'center', options.primary ? 700 : 600, w - 16, !options.primary);
        if (options.strike) line(ctx, x + w * .3, y + h * .72, x + w * .7, y + h * .28, color, 1.5);
        register(x, y, w, h, label, fn, options.disabled);
    }
    function bar(x, y, w, h, value, max, color, label) {
        rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1; ctx.stroke();
        const fill = (w - 2) * ratio(value, max); if (fill > 0) { const g = ctx.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, color); g.addColorStop(1, color + '99'); rr(ctx, x + 1, y + 1, fill, h - 2, (h - 2) / 2); ctx.fillStyle = g; ctx.fill(); }
        if (label) text(ctx, label, x + w / 2, y + h / 2 + .5, clamp(h * .8, 10, 12), '#fffaf0', 'center', 600);
    }
    function gameHud(w, h, t) {
        const mobile = w < 700, run = state.run, p = state.player, hell = run?.mode === 'hell';
        hitButton(16, 16, 36, 36, '나가기', () => { location.href = '/'; }, { glyph: '‹', size: 22 });
        if (hell) {
            text(ctx, '지하', 64, 31, 13, '#e8a27a', 'left', 600); const lw = ctx.measureText('지하').width + 68;
            text(ctx, run.floor, lw, 28, 24, '#f5ecd6', 'left', 800); const fw = ctx.measureText(String(run.floor)).width;
            text(ctx, '층', lw + 2 + fw, 31, 13, '#d4c59e', 'left', 600); text(ctx, `/ ${run.maxFloor || 100}`, lw + 20 + fw, 31, 12, '#8e9aa1');
            const drops = `낙하 ${run.dropsRemaining ?? 0}회`; text(ctx, drops, 64, 50, 14, '#f0b48a', 'left', 700);
            if (run.rocketJump) { const rx = 78 + ctx.measureText(drops).width; renderer.quad(renderer.glow, rx - 12, 36, 32, 30, [1, .5, .15, .35]); path(ctx, [[rx, 42], [rx + 8, 42], [rx + 8, 49], [rx + 12, 49], [rx + 4, 58], [rx - 4, 49], [rx, 49]]); ctx.fillStyle = '#ff8a3a'; ctx.fill(); text(ctx, '로켓', rx + 18, 50, 14, '#ffb070', 'left', 700); }
            if (!mobile) text(ctx, `전투력 ${fmt(p.combatPower)}`, w - 66, 34, 13, '#a3b2b8', 'right');
        } else if (run) {
            text(ctx, run.floor, 64, 28, 24, '#f5ecd6', 'left', 800); const fw = ctx.measureText(String(run.floor)).width;
            text(ctx, '층', 66 + fw, 31, 13, '#d4c59e', 'left', 600); text(ctx, '/ 999', 84 + fw, 31, 12, '#8e9aa1');
            const bw = mobile ? 104 : 150; bar(64, 45, bw, 5, run.distortion, 100, run.distortion >= 75 ? '#e0646b' : '#a07ad6'); text(ctx, `뒤틀림 ${run.distortion}`, 72 + bw, 48, 12, run.distortion >= 75 ? '#f0a0a4' : '#b4bcc4', 'left', 600);
        } else text(ctx, '낙원', 64, 34, 22, '#f2e6c8', 'left', 800);
        const rankW = mobile ? 56 : 88, rankX = w - 60 - rankW;
        if (!hell) {
        if (!mobile) { text(ctx, `주간 최고 ${state.weekly.bestFloor ? state.weekly.bestFloor + '층' : '—'}`, rankX - 14, 26, 13, '#e4d09c', 'right', 600); text(ctx, `전투력 ${fmt(p.combatPower)}`, rankX - 14, 44, 12, '#a3b2b8', 'right'); }
        hitButton(rankX, 16, rankW, 36, '주간 순위', () => { overlay = 'ranking'; overlayPage = 0; fetchRanking(); }, { glyph: mobile ? '순위' : '주간 순위' });
        }
        hitButton(w - 52, 16, 36, 36, audio.muted ? '소리 켜기' : '소리 끄기', () => audio.toggle(), { glyph: '♪', strike: audio.muted, size: 15 });
        if (run?.status === 'active' && run.timer) {
            const ms = Math.max(0, run.timer.remainingMs - (run.timer.paused ? 0 : now() - state.serverTime)), seconds = Math.ceil(ms / 1000);
            const label = `${run.timer.paused ? 'Ⅱ  ' : ''}${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
            text(ctx, label, mobile ? (w < 360 ? w - 16 : rankX - 12) : w / 2, mobile && w < 360 ? 67 : 29, mobile ? 13 : 16, run.timer.paused ? '#9dd7cf' : seconds <= 60 ? '#f18b88' : '#e3dccb', mobile ? 'right' : 'center', 700);
        }
        if (run?.status === 'active') {
            if (!hell) {
                const hovered = inside(14, h - 62, 48, 48);
                ctx.save(); ctx.shadowColor = '#e5c57d'; ctx.shadowBlur = hovered ? 14 : 3;
                iconAt(asset('bag'), 18, h - 58, 40); ctx.restore();
                register(14, h - 62, 48, 48, '가방 열기', () => { overlay = 'inventory'; overlayPage = 0; });
                if (!mobile) relicStrip(w);
            }
            if (hell || run.canReturn && !['route', 'relic'].includes(run.phase)) hitButton(w - (mobile ? 96 : 112), h - 52, mobile ? 80 : 96, 36, hell ? '탐험 포기' : '귀환', () => { overlay = 'retire'; });
        }
        if (message && t < messageUntil && !overlay) {
            if (mobile) { compactNotice(message, w, h, t, messageUntil, '#e4cb8f', 2, () => { message = ''; }); return; }
            const width = Math.min(w - 32, 560), bottom = run?.phase === 'combat' ? (mobile ? 256 : 230) : run?.phase === 'puzzle' ? 172 : run?.phase === 'augment' && mobile ? 178 : 110;
            // 지옥의 비전투 장면은 하단에 행동 버튼이 몰려 있어 알림을 상단에 띄운다.
            const ty = hell && run.phase !== 'combat' ? 62 : h - bottom;
            const rows=wrap(ctx,message,width-32,14,12), height=rows.length*21+24, top=Math.max(64,ty-height+40);
            panel(ctx, (w - width) / 2, top, width, height, { alpha: .96, r: 3 });
            rows.forEach((row,i)=>text(ctx,row,w/2,top+22+i*21,14,'#efe7d2','center',500));
        }
    }
    function relicStrip(w) {
        const relics = state.run.relics, step = Math.min(42, (w - 32) / Math.max(1, relics.length)), size = step - 4, y = 65;
        let tooltip = null;
        relics.forEach((relic, i) => {
            const x = 16 + i * step, hovered = inside(x, y, step, size);
            const ink = relicInk[relic.rarity] || relicInk.normal;
            ctx.save(); ctx.globalAlpha = relic.spent ? .35 : 1;
            ctx.shadowColor = ink; ctx.shadowBlur = hovered ? 12 : 2;
            iconAt(relic.iconUrl, x + 2, y, size); ctx.restore();
            // 아이콘 아래 등급 보석. 일반은 은빛, 상급은 호박색, 특급은 보랏빛.
            const gx = x + 2 + size / 2, gy = y + size + 4;
            ctx.save(); ctx.globalAlpha = relic.spent ? .35 : hovered ? 1 : .8; path(ctx, [[gx, gy - 3], [gx + 2.6, gy], [gx, gy + 3], [gx - 2.6, gy]]); ctx.fillStyle = ink; ctx.fill(); ctx.restore();
            register(x, y, step, size, `${relic.name}, ${relic.rarityLabel}, ${relic.desc}${relic.spent ? ', 사용 완료' : ''}`, () => { inventoryTab = 'relics'; overlay = 'inventory'; overlayPage = 0; });
            if (hovered && !overlay) tooltip = { relic, x };
        });
        if (tooltip) {
            const width = 300, x = Math.min(w - width - 16, tooltip.x), top = y + size + 14, relic = tooltip.relic, ink = relicInk[relic.rarity] || relicInk.normal;
            const rows = wrap(ctx, relic.desc, width - 32, 13, 8), height = 62 + rows.length * 20 + (relic.spent ? 20 : 0);
            panel(ctx, x, top, width, height, { alpha: .97, edge: ink + '55', r: 3 });
            line(ctx, x + 16, top + 1, x + 76, top + 1, ink, 1.5);
            ctx.font = `700 12px ${FONT}`; const badge = ctx.measureText(relic.rarityLabel || '').width + 30;
            text(ctx, relic.name, x + 16, top + 25, 15, '#f3ead6', 'left', 700, width - badge - 44);
            tierMark(ctx, relic, x + width - 14, top + 25, 'right');
            rows.forEach((row, i) => text(ctx, row, x + 16, top + 54 + i * 20, 13, '#dce1e1', 'left', 500));
            if (relic.spent) text(ctx, '사용 완료', x + 16, top + 54 + rows.length * 20, 12, '#97a3a8', 'left', 600);
        }
    }
    function compactNotice(value, w, h, t, until, color, maxLines, dismiss) {
        const width = Math.min(w - 32, 344), x = (w - width) / 2, fontSize = 12, textWidth = width - 54;
        const all = wrap(ctx, value, textWidth, fontSize, 200), rows = wrap(ctx, value, textWidth, fontSize, maxLines);
        const more = all.length > maxLines, height = rows.length * 18 + 20 + (more ? 18 : 0);
        const bottom = state.run?.phase === 'combat' ? h - 214 : state.run?.phase === 'augment' ? h - 176 : h - 126;
        const y = Math.max(68, bottom - height);
        ctx.save(); ctx.globalAlpha = reduced ? 1 : clamp((until - t) / 250, 0, 1);
        panel(ctx, x, y, width, height, { alpha: .86, edge: color + '55', r: 6 });
        line(ctx, x + 1, y + 10, x + 1, y + height - 10, color, 2);
        rows.forEach((row, i) => text(ctx, row, x + 12, y + 19 + i * 18, fontSize, '#eee8dc', 'left', 500));
        if (more) {
            text(ctx, '자세히', x + 12, y + height - 12, 11, color, 'left', 600);
            register(x, y, width - 38, height, '알림 전체 보기', () => { noticeDetail = value; overlay = 'notice'; overlayPage = 0; dismiss(); });
        }
        text(ctx, '×', x + width - 20, y + 20, 19, '#b5bdc3', 'center');
        register(x + width - 40, y, 40, 40, '알림 닫기', dismiss);
        ctx.restore();
    }
    function revealOutcome(w, h, t) {
        if (!outcomeReveal) return;
        const elapsed=t-outcomeReveal.at;
        if(elapsed>6500){outcomeReveal=null;return;}
        if (overlay) return;
        if (w < 700) {
            const until = outcomeReveal.at + 4200;
            if (t >= until) { outcomeReveal = null; return; }
            compactNotice(outcomeReveal.text, w, h, t, until, outcomeReveal.positive ? '#edce85' : '#f19a9e', 3, () => { outcomeReveal = null; });
            return;
        }
        const mobile=w<700,width=Math.min(w-32,540),x=(w-width)/2,y=mobile?70:84,color=outcomeReveal.positive?'#edce85':'#f19a9e';
        const rows=wrap(ctx,outcomeReveal.text,width-96,mobile?15:17,12),height=Math.max(96,rows.length*25+30);
        ctx.save();ctx.globalAlpha=reduced?1:Math.min(1,elapsed/180,(6500-elapsed)/350);
        panel(ctx,x,y,width,height,{alpha:.97,edge:color+'88',r:2});
        if(!reduced&&elapsed<600){ctx.shadowColor=color;ctx.shadowBlur=18*Math.sin(elapsed/600*Math.PI);}
        sigil(ctx,outcomeReveal.motif,x+37,y+height/2,36,color);
        rows.forEach((row,i)=>text(ctx,row,x+72,y+26+i*25,mobile?15:17,i?color:'#fff3d9','left',i?600:700));
        ctx.restore();
    }
    function revealRewards(w, h, t) {
        regions = []; puzzleForm.hidden = true;
        const reveal = rewardReveal, mobile = w < 700, per = mobile ? 1 : 3;
        const pages = Math.max(1, Math.ceil(reveal.items.length / per));
        reveal.page = clamp(reveal.page, 0, pages - 1);
        const list = reveal.items.slice(reveal.page * per, (reveal.page + 1) * per);
        const elapsed = reduced ? 10000 : t - reveal.at;
        const cw = Math.min(mobile ? 272 : 240, (w - 64) / (mobile ? 1 : 3));
        const ch = Math.min(340, h - 236), top = (h - ch) / 2, cy = top + ch * .42;
        const tint = reveal.rich || list.some(item => item.cardType === '각성') ? [.78, .62, 1] : [1, .8, .42];
        const color = tint[0] === 1 ? '#edce85' : '#d4b7ff';
        ctx.fillStyle = 'rgba(3,6,12,.88)'; ctx.fillRect(0, 0, w, h);
        if (!reduced) {
            const burst = clamp(elapsed / 650, 0, 1), radius = 60 + burst * 330;
            renderer.quad(renderer.glow, w / 2 - radius, cy - radius, radius * 2, radius * 2, [...tint, .65]);
            ctx.save(); ctx.translate(w / 2, cy); ctx.rotate(t / 14000);
            for (let i = 0; i < 12; i++) {
                ctx.rotate(Math.PI / 6);
                const beam = ctx.createLinearGradient(0, 0, radius, 0); beam.addColorStop(0, color + '40'); beam.addColorStop(1, color + '00');
                path(ctx, [[0, 0], [radius, -18], [radius, 18]]); ctx.fillStyle = beam; ctx.fill();
            }
            ctx.restore();
            for (let i = 0; i < 28; i++) {
                const angle = i * 2.4, distance = 30 + ((elapsed * .05 + i * 19) % 300);
                const x = w / 2 + Math.cos(angle) * distance, y = cy + Math.sin(angle) * distance * .7;
                renderer.quad(renderer.glow, x - 4, y - 4, 8, 8, [...tint, .7 * (1 - distance / 340)]);
            }
        }
        text(ctx, '보상 획득', w / 2, top - 62, mobile ? 26 : 32, '#fff3d7', 'center', 800);
        text(ctx, reveal.title, w / 2, top - 28, mobile ? 14 : 16, color, 'center', 600, w - 40);
        const total = list.length * cw + Math.max(0, list.length - 1) * 20, left = (w - total) / 2;
        list.forEach((item, i) => {
            const p = clamp((elapsed - 180 - i * 150) / 480, 0, 1), ease = 1 - Math.pow(1 - p, 3);
            const x = left + i * (cw + 20), y = top + (1 - ease) * 28;
            const card = item.kind === 'card', ink = item.cardType === '각성' ? '#d4b7ff' : item.cardType === '전직' ? '#8edaff' : '#edce85';
            ctx.save(); ctx.globalAlpha = ease; ctx.translate(x + cw / 2, y + ch / 2); ctx.scale(Math.max(.04, ease), 1); ctx.translate(-cw / 2, -ch / 2);
            chamfer(ctx, 0, 0, cw, ch, 14);
            const bg = ctx.createLinearGradient(0, 0, cw, ch); bg.addColorStop(0, '#222a35'); bg.addColorStop(1, '#080e16'); ctx.fillStyle = bg; ctx.fill();
            ctx.strokeStyle = ink; ctx.lineWidth = 1.5; ctx.stroke();
            chamfer(ctx, 6, 6, cw - 12, ch - 12, 11); ctx.strokeStyle = ink + '24'; ctx.lineWidth = 1; ctx.stroke();
            const artSize = Math.min(cw - 58, ch - 142), artY = 28;
            if (!iconAt(item.iconUrl, (cw - artSize) / 2, artY, artSize)) sigil(ctx, card ? 'contract' : 'clarity', cw / 2, artY + artSize / 2, artSize * .65, ink);
            const label = card ? `${item.star} ${item.cardType}` : item.kind === 'gold' ? '재화' : item.kind === 'experience' ? '성장' : '아이템';
            text(ctx, label, cw / 2, ch - 100, 12, ink, 'center', 700);
            const names = wrap(ctx, item.name, cw - 28, mobile ? 17 : 18, 2, 700);
            names.forEach((name, j) => text(ctx, name, cw / 2, ch - 70 + (j - (names.length - 1) / 2) * 23, mobile ? 17 : 18, '#f6f0e4', 'center', 700));
            text(ctx, `×${fmt(item.count)}`, cw / 2, ch - 28, 23, ink, 'center', 800);
            if (!reduced && p < 1) {
                ctx.save(); chamfer(ctx, 0, 0, cw, ch, 14); ctx.clip();
                const sweep = -cw + p * cw * 3, shine = ctx.createLinearGradient(sweep - 50, 0, sweep + 50, 0);
                shine.addColorStop(0, '#ffffff00'); shine.addColorStop(.5, '#ffffff55'); shine.addColorStop(1, '#ffffff00');
                ctx.fillStyle = shine; ctx.fillRect(0, 0, cw, ch); ctx.restore();
            }
            ctx.restore();
        });
        if (!list.length) text(ctx, '지급할 보상이 없습니다.', w / 2, cy, 16, '#d6dce0', 'center');
        const ready = elapsed >= 660 + Math.max(0, list.length - 1) * 150, by = top + ch + 24;
        const changePage = direction => { reveal.page += direction; reveal.at = performance.now(); sound('tap'); };
        if (pages > 1) {
            hitButton(w / 2 - 142, by, 44, 44, '이전 보상', () => changePage(-1), { glyph: '‹', size: 22, disabled: !ready || reveal.page === 0 });
            hitButton(w / 2 + 98, by, 44, 44, '다음 보상', () => changePage(1), { glyph: '›', size: 22, disabled: !ready || reveal.page === pages - 1 });
            text(ctx, `${reveal.page + 1} / ${pages}`, w / 2, top - 3, 12, '#a8b4c3', 'center', 600);
        }
        hitButton(w / 2 - 88, by, 176, 44, '확인', () => { rewardReveal = null; sound('tap'); }, { primary: true, size: 16, disabled: !ready });
    }
    function sceneBackground(w, h, t) {
        if (state?.run?.mode === 'hell' || state && !state.run && overlay === 'hell') return hellBackground(w, h, t);
        const scene = activeScene, event = ['casino', 'forge', 'mirror', 'chests', 'judge', 'well', 'puzzle', 'riftTrader'].includes(scene);
        const bg = renderer.image(asset(event ? scene : scene === 'lobby' ? 'paradise' : 'corridor')), dim = scene === 'augment' || scene === 'relic' || overlay ? .5 : scene === 'lobby' ? .6 : scene === 'route' ? .62 : scene === 'ended' ? .55 : scene === 'combat' ? .9 : 1;
        const drift = reduced ? 0 : Math.sin(t / 11000) * 8;
        renderer.cover(bg, -12 + drift, -8, w + 24, h + 16, [dim, dim, dim, 1]);
        const particleColor = scene === 'riftTrader' ? [.66, .48, .87] : scene === 'forge' ? [1, .45, .10] : scene === 'well' || scene === 'collapse' ? [1, .12, .18] : scene === 'casino' || scene === 'chests' ? [1, .77, .29] : [.44, .83, .83];
        if (!reduced) for (let i = 0; i < 22; i++) { const speed = scene === 'forge' ? .045 : .008, x = ((i * 271 + Math.sin(t / 2300 + i) * 35) % (w + 60)) - 30, y = h - ((t * speed + i * 71) % (h + 40)), radius = i % 4 === 0 ? 8 : 4; renderer.quad(renderer.glow, x, y, radius, radius, [...particleColor, scene === 'forge' ? .5 : .22]); }
        if (scene === 'mirror') renderer.quad(renderer.glow, w * (.25 + .5 * ((t / 6500) % 1)), h * .15, w * .07, h * .7, [.7, .9, 1, .14]);
        if (scene === 'riftTrader') renderer.quad(renderer.glow, w * .46, h * .05, w * .08, h * .56, [.66, .48, .87, reduced ? .12 : .12 + Math.sin(t / 640) * .035]);
        if (scene === 'well' || scene === 'puzzle') for (let i = 0; i < 3; i++) { const r = 70 + ((t / 35 + i * 50) % 160); renderer.quad(renderer.glow, w / 2 - r, h * .43 - r / 3, r * 2, r / 1.5, [...particleColor, .05]); }
        if (scene === 'chests') [[.27, [1, .18, .20]], [.50, [.17, .53, 1]], [.73, [1, .74, .2]]].forEach(([x, color]) => renderer.quad(renderer.glow, w * x - 70, h * .18, 140, h * .5, [...color, .2]));
        if (scene === 'judge' || scene === 'collapse') renderer.quad(renderer.glow, w * .48, -h * .1, w * .04, h * .9, scene === 'collapse' ? [1, .1, .15, .3] : [1, .85, .5, .2]);
        const vignette = ctx.createRadialGradient(w / 2, h * .45, h * .2, w / 2, h / 2, Math.max(w, h) * .7); vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.6)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
        const top = ctx.createLinearGradient(0, 0, 0, 110); top.addColorStop(0, 'rgba(3,6,10,.7)'); top.addColorStop(1, 'rgba(3,6,10,0)'); ctx.fillStyle = top; ctx.fillRect(0, 0, w, 110);
    }
    function lobbyApi(w, h) {
        return { text, paragraph, wrap, line, panel, metal, chamfer, rr, iconAt, hitButton,
            register: (x,y,rw,rh,label,fn,disabled) => { const top = Math.max(0,y), bottom = Math.min(h,y+rh); if (bottom > top) register(x,top,rw,bottom-top,label,fn,disabled); },
            renderer, asset, inside, fmt, mutate: (action,input) => mutate('progression/' + action,input),
            enterHeaven: () => mutate('enter'), openHell: () => { overlay = 'hell'; hellKey = null; sound('tap'); },
            openEquipment: slot => { overlay = 'equipment:' + slot; sound('tap'); },
            openShop: () => { if (!state.shop) return; window.ParadiseShop.open(); overlay = 'shop'; sound('tap'); },
            buy: (product,quantity) => mutate('shop/buy',{product,quantity}),
            openRanking: () => { overlay = 'ranking'; overlayPage = 0; fetchRanking(); }, close: () => { overlay = null; }
        };
    }
    // 서버가 종료 탐험을 정리한 뒤에만 로비로 바뀐다(성공 처리는 mutate에서 오버레이와 스크롤 초기화).
    function returnToLobby() { sound('tap'); mutate('dismiss'); }
    function lobby(w, h, t) {
        lobbyScroll = clamp(lobbyScroll,0,Math.max(0,lobbyHeight-h));
        ctx.save(); ctx.beginPath(); ctx.rect(0,68,w,h-68); ctx.clip();
        lobbyHeight = window.ParadiseLobby.draw({ctx,w,h,t,state,ranking,busy:busy||!!pending,scroll:lobbyScroll,api:lobbyApi(w,h)});
        ctx.restore();
        if(lobbyHeight>h){const track=h-92,thumb=Math.max(32,track*(h-68)/(lobbyHeight-68)),y=78+(track-thumb)*lobbyScroll/(lobbyHeight-h);rr(ctx,w-6,y,3,thumb,1.5);ctx.fillStyle='#ead49a88';ctx.fill();}
    }
    function heavenEntryScene(w, h, t) {
        const age = t - heavenEntry.at, duration = reduced ? 180 : 1850, p = clamp(age / duration, 0, 1);
        if (p >= 1) { heavenEntry = null; return; }
        const open = reduced ? 1 : 1 - Math.pow(1 - clamp((p - .12) / .75, 0, 1), 3);
        renderer.begin(w, h);
        const zoom = 1 + open * .18;
        renderer.cover(renderer.image(asset('corridor')), (w - w * zoom) / 2, (h - h * zoom) / 2, w * zoom, h * zoom, [1, 1, 1, 1]);
        ctx.clearRect(0, 0, w, h);
        const fade = reduced ? 1 - p : 1 - clamp((p - .78) / .22, 0, 1);
        ctx.fillStyle = `rgba(3,12,23,${.66 * fade})`; ctx.fillRect(0, 0, w, h);
        const cx = w / 2, cy = h * .46, gateW = Math.min(w * .66, 430), gateH = Math.min(h * .52, 470);
        renderer.quad(renderer.glow, cx - gateW * .5 - open * w * .25, cy - gateH * .65, gateW * (1 + open), gateH * 1.5, [.5, .84, 1, .85 * fade]);
        if (!reduced) for (let i = 0; i < 32; i++) {
            const angle = i * 2.39996, distance = (24 + rand(i + 7) * 160) * (1 + open * 4);
            const x = cx + Math.cos(angle) * distance, y = cy + Math.sin(angle) * distance * .75, size = 4 + rand(i + 1) * 9;
            renderer.quad(renderer.glow, x - size / 2, y - size / 2, size, size, [1, .88, .58, fade * .8]);
        }
        ctx.save(); ctx.globalAlpha = fade;
        for (const side of [-1, 1]) {
            const x = cx + side * (gateW / 2 + open * w * .46);
            ctx.beginPath(); ctx.moveTo(x, cy + gateH / 2); ctx.lineTo(x, cy - gateH * .25);
            ctx.quadraticCurveTo(x, cy - gateH * .57, cx + side * open * w * .46, cy - gateH * .64);
            ctx.strokeStyle = '#c5a26c'; ctx.lineWidth = 7; ctx.shadowColor = '#93dfff'; ctx.shadowBlur = 20; ctx.stroke();
            ctx.strokeStyle = '#f9e8ba'; ctx.lineWidth = 2; ctx.stroke();
        }
        ctx.shadowBlur = 0;
        const ticket = renderer.image(heavenEntry.ticket);
        if (ticket?.ready && p < .60) {
            const [sx, sy, sw, sh] = trimmed(ticket), size = Math.min(w * .30, 150) * (1 - open * .7);
            ctx.save(); ctx.globalAlpha *= 1 - clamp((p - .3) / .3, 0, 1);
            ctx.drawImage(ticket.image, sx, sy, sw, sh, cx - size / 2, cy - size * sh / sw / 2, size, size * sh / sw); ctx.restore();
        }
        text(ctx, '천상', cx, cy + gateH * .68, w < 700 ? 24 : 32, '#f2e5c6', 'center', 700);
        ctx.restore();
        regions = []; puzzleForm.hidden = true;
    }
    function cardGeometry(w, h) {
        if (w < 700) { const cardW = Math.min(w - 84, 300), y = 104; return { mobile: true, cardW, cardH: Math.min(cardW / .6, h - y - 160), y }; }
        const cardW = Math.min(clamp(h - 290, 210, 540) * .6, (w - 200) / 3), cardH = cardW / .6;
        return { mobile: false, cardW, cardH, y: Math.max(164, h / 2 - cardH / 2 + 8) };
    }
    function cardLayouts(w, h, t) {
        const { mobile, cardW, cardH, y } = cardGeometry(w, h);
        focused=clamp(focused,0,Math.max(0,state.run.choices.length-1));
        return state.run.choices.map((choice, i) => {
            const delta = i - focused, scale = mobile && delta ? .88 : 1;
            let x = mobile ? w / 2 - cardW / 2 + delta * cardW * .84 : w / 2 + (i - (state.run.choices.length-1)/2) * (cardW + 28) - cardW / 2;
            const progress = reduced ? 1 : clamp((t - sceneAt - i * 90) / 280, 0, 1), ease = 1 - Math.pow(1 - progress, 3);
            const slotX=x, slotY=y+(mobile&&delta?cardH*.06:0);
            let width = cardW * scale, height = cardH * scale, yy = y + (1 - ease) * 12 + (mobile && delta ? cardH * .06 : 0);
            x += (cardW - width) / 2;
            const selected = selection?.index === i, hoverCard = hover === i || mobile && i === focused;
            if (selection) { const p = clamp((t - selection.started) / 430, 0, 1); if (!selected) yy += p * 120; else { width *= 1 + p * .06; height *= 1 + p * .06; x -= p * cardW * .03; yy -= p * 18; } }
            else if (!reduced && !mobile) { const amount=hoverLevels[i]; yy-=4*amount; x-=cardW*.0125*amount; width*=1+.025*amount; height*=1+.025*amount; }
            return { choice, x, y: yy, w: width, h: height, slotX, slotY, slotW:cardW*scale, slotH:cardH*scale, i, alpha: selection && !selected ? 1 - clamp((t - selection.started) / 350, 0, 1) : (mobile && delta ? .5 : 1)*ease, hover: hoverCard, progress };
        });
    }
    function augments(w, h, t) {
        const geo = cardGeometry(w, h), mobile = geo.mobile;
        const count=state.run.choices.length;
        if(!count){
            text(ctx,state.run.completed ? '999층 정복' : '더 선택할 증강이 없습니다',w/2,h*.43,20,'#f5ecd6','center',700);
            if (state.run.completed) {
                hitButton(w/2-120,h*.5,240,48,'귀환하고 정산',()=>{overlay='retire';},{primary:true});
                return;
            }
            if(state.run.continueWarning)drawWarning(ctx,w/2-120,h*.5-40,240,30);
            hitButton(w/2-120,h*.5,240,48,'5층 올라가기',()=>mutate('continue'),{primary:true});
            return;
        }
        text(ctx, '증강 선택', w / 2, mobile ? 82 : geo.y - 46, mobile ? 18 : 24, '#f5ecd6', 'center', 700);
        const dt=Math.min(50,t-hoverTime); hoverTime=t;
        const slots=cardLayouts(w,h,t);
        const active=inputMode==='keyboard'?keyboardCard:slots.findIndex(r=>inside(r.slotX,r.slotY,r.slotW,r.slotH));
        if(active!==hover&&active>=0&&t-sceneAt>460)sound('hover');
        hover=active;
        hoverLevels.forEach((level,i)=>{const target=i===active?1:0;hoverLevels[i]=level+(target-level)*Math.min(1,dt/(target?70:95));});
        const layouts = cardLayouts(w, h, t), order = mobile ? [...layouts].sort((a, b) => Number(a.i === focused) - Number(b.i === focused)) : layouts;
        for (const card of order) {
            if (card.hover && !selection) renderer.quad(renderer.glow, card.x - card.w * .2, card.y - card.h * .08, card.w * 1.4, card.h * 1.16, [...(glowTint[card.choice.rarity] || glowTint.gold), .16]);
            const amount=hoverLevels[card.i], brightness=mobile?1:hover<0?1:card.i===hover?1+.06*amount:.92;
            renderer.quad(renderer.card(card.choice, geo.cardW, geo.cardH), card.x, card.y, card.w, card.h, [brightness, brightness, brightness, card.alpha]);
            if(amount>.01&&!mobile){ctx.save();ctx.globalAlpha=amount*.55;chamfer(ctx,card.x+1,card.y+1,card.w-2,card.h-2,12);ctx.strokeStyle=colors[card.choice.rarity]||colors.gold;ctx.lineWidth=2;ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=14;ctx.stroke();ctx.restore();}
            register(Math.max(0, card.slotX), card.slotY, Math.min(w, card.slotX + card.slotW) - Math.max(0, card.slotX), card.slotH, `${tier[card.choice.rarity] || '증강'} ${card.choice.name}, ${card.choice.desc}, ${card.choice.starting ? '시작 증강' : `${card.choice.floors > 0 ? '+' : ''}${card.choice.floors}층`}${warnLabel(card.choice.powerWarning)}`, () => mobile && focused !== card.i ? (focused = card.i, sound('tap')) : choose(card.choice, card.i), !!selection || t-sceneAt<460);
            if (!mobile) hitButton(card.slotX + card.slotW / 2 - 48, geo.y + geo.cardH + 12, 96, 36, `${card.choice.name} 새로고침`, () => mutate('reroll', { choice: card.choice.id }), { glyph: card.choice.canReroll ? '↻  1' : '↻  0', size: 18, disabled: !card.choice.canReroll || !!selection || t-sceneAt<460 });
        }
        if (mobile) {
            const dotsY = geo.y + geo.cardH + 18;
            if(count>1)hitButton(w / 2 - 86, dotsY - 18, 40, 36, '이전 증강', () => { focused = (focused + count - 1) % count; }, { glyph: '‹', size: 20 });
            for (let i = 0; i < count; i++) { ctx.beginPath(); ctx.arc(w / 2 + (i - (count-1)/2) * 16, dotsY, i === focused ? 4 : 3, 0, Math.PI * 2); ctx.fillStyle = i === focused ? '#f0d58e' : 'rgba(255,255,255,.3)'; ctx.fill(); }
            if(count>1)hitButton(w / 2 + 46, dotsY - 18, 40, 36, '다음 증강', () => { focused = (focused + 1) % count; }, { glyph: '›', size: 20 });
            const choice = state.run.choices[focused];
            hitButton(w / 2 - 134, h - 116, 66, 48, `${choice.name} 새로고침`, () => mutate('reroll', { choice: choice.id }), { glyph: choice.canReroll ? '↻ 1' : '↻ 0', size: 18, disabled: !choice.canReroll || !!selection });
            hitButton(w / 2 - 58, h - 116, 192, 48, '이 증강 선택', () => choose(choice, focused), { primary: true, size: 16, disabled: !!selection });
        }
        if (selection) { const p = clamp((t - selection.started) / 430, 0, 1); ctx.fillStyle = `rgba(255,232,180,${Math.sin(p * Math.PI) * .1})`; ctx.fillRect(0, 0, w, h); }
    }
    function battleState(snapshot) {
        if (!snapshot?.run?.enemy || !snapshot.battle) return null;
        const run=snapshot.run, enemy=run.enemy, sprite=enemy.sprite;
        return { ...snapshot.battle, serverNow:snapshot.serverTime, inField:true, phase:'elite',
            nextActionAt:run.nextActionAt, combatLog:run.combatLog, target:enemy, paradiseRelics: run.mode !== 'hell' && run.relics.length > 0,
            activeField:{backgroundUrl:asset(run.mode==='hell'?'hell':'corridor'),monster:typeof sprite==='string'?{spriteUrl:sprite}:sprite||{}} };
    }
    function combat(w, h, t) {
        const locked=busy||!!pending||!!overlay||t<battleUntil;
        const current=t<battleUntil?heldBattle:battleState(state);
        if(!current)return;
        battle.update(current, [], state.runId, true);
        for(const r of battle.draw(t, locked)) register(r.x,r.y,r.w,r.h,r.label,r.action,locked);
        gimmickBadge(w);
    }
    // 진행 중인 봉인: 우측 상단 헤더 아래 이름과 진행도만. 데스크톱은 hover 툴팁, 누르면 알림 창에서 전체 내용.
    function gimmickBadge(w) {
        const g = state.run?.routeGimmick; if (!g) return;
        const ink = (sealTones[g.tone] || sealTones.amber)[0], mobile = w < 700, by = mobile ? 132 : state.run.relics.length ? 184 : 142, bh = mobile ? 22 : 26;
        ctx.font = `700 12px ${FONT}`; const nw = ctx.measureText(g.name).width; ctx.font = `600 12px ${FONT}`; const pw = g.progress ? ctx.measureText(g.progress).width + 10 : 0;
        const bw = Math.min(mobile ? w * .55 : 280, 40 + nw + pw), bx = w - 16 - bw, hovered = inside(bx, by, bw, bh);
        chamfer(ctx, bx, by, bw, bh, 6); ctx.fillStyle = 'rgba(8,11,16,.8)'; ctx.fill(); ctx.strokeStyle = ink + (hovered ? 'aa' : '55'); ctx.lineWidth = 1; ctx.stroke();
        sigil(ctx, sealSigil[g.sigil] || g.sigil, bx + 15, by + bh / 2, 15, ink);
        if (g.progress) text(ctx, g.progress, bx + bw - 10, by + bh / 2 + .5, 12, ink, 'right', 600, undefined, false);
        text(ctx, g.name, bx + 28, by + bh / 2 + .5, 12, '#efe6d2', 'left', 700, bw - 38 - pw, false);
        const detail = `${g.name}\n시련: ${g.rule}\n보상: ${g.reward}${g.progress ? '\n' + g.progress : ''}`;
        register(bx, by, bw, bh, detail.replace(/\n/g, ', '), () => { noticeDetail = detail; overlay = 'notice'; overlayPage = 0; sound('tap'); });
        if (!hovered || mobile || overlay) return;
        const tw = 300, tx = w - 16 - tw, ty = by + bh + 8, rule = wrap(ctx, g.rule, tw - 32, 13, 6), reward = wrap(ctx, g.reward, tw - 32, 13, 4);
        panel(ctx, tx, ty, tw, 66 + (rule.length + reward.length) * 20, { alpha: .97, edge: ink + '55', r: 3 });
        let y = ty + 22;
        [['시련', rule, ink, '#dfe4e6'], ['보상', reward, '#e8c272', '#f2d89c']].forEach(([label, rows, labelInk, color]) => { text(ctx, label, tx + 16, y, 12, labelInk, 'left', 700); y += 20; rows.forEach(row => { text(ctx, row, tx + 16, y, 13, color); y += 20; }); y += 6; });
    }
    battle.onAction=(action, body)=>mutate(action, action==='skill'?{skill:body.skillName}:{});
    function eventScene(w, h, t) {
        const e = state.run.event, mobile = w < 700, boxW = mobile ? w - 32 : Math.min(1100, w - Math.max(64, w * .16)), boxX = (w - boxW) / 2, bottom = h - 68;
        const n = e.choices.length, cols = mobile ? 1 : n, gap = mobile ? 8 : 16, cw = (boxW - gap * (cols - 1)) / cols, descSize = mobile && h<740 ? 13 : 14, lh = descSize * 1.5;
        const descriptions=e.choices.map(choice=>choice.desc.split('\n').flatMap(part=>wrap(ctx,part,cw-40,descSize,20).map(row=>({row,tone:e.id === 'riftTrader' && /뒤틀림/.test(part)?'#be9fe6':/실패|대신|바칩니다|저주|받는 피해/.test(part)?'#e6a2a6':/[+]|회복|얻습니다/.test(part)?'#e7d29d':'#d1d7dc'}))));
        const names=e.choices.map(choice=>wrap(ctx,choice.name,cw-40-(choice.powerWarning?52:0),mobile?17:18,3,700));
        const measured = e.choices.map((choice,i) => (mobile && e.id === 'riftTrader' ? 20 : 28) + names[i].length*23 + descriptions[i].length*lh + 12);
        const heights = mobile ? measured : measured.map(() => Math.max(...measured)), total = mobile ? heights.reduce((a, b) => a + b, 0) + gap * (n - 1) : heights[0], top = bottom - total;
        const titleSize = mobile ? 24 : 30, storySize = mobile ? 14 : 16, slh = storySize * 1.55, quoteSize = mobile ? 15 : 17;
        let story = wrap(ctx, e.story, boxW, storySize, mobile ? 3 : 2), quote = !!e.quote;
        const headerH = () => titleSize + 14 + story.length * slh + (quote ? quoteSize + 12 : 0) + 18;
        while (headerH() > top - 72 && (quote || story.length)) { if (quote) quote = false; else story = story.slice(0, -1); }
        const hy = top - headerH(), scrim = ctx.createLinearGradient(0, hy - 120, 0, h); scrim.addColorStop(0, 'rgba(3,6,10,0)'); scrim.addColorStop(.35, 'rgba(3,6,10,.72)'); scrim.addColorStop(1, 'rgba(3,6,10,.9)'); ctx.fillStyle = scrim; ctx.fillRect(0, hy - 120, w, h - hy + 120);
        text(ctx, e.title, boxX, hy + titleSize / 2, titleSize, '#f6edd8', 'left', 700, boxW);
        let y = hy + titleSize + 14 + storySize / 2; story.forEach((row, i) => text(ctx, row, boxX, y + i * slh, storySize, '#d3dbdc'));
        if (quote) text(ctx, '“' + e.quote + '”', boxX, y + story.length * slh + 10, quoteSize, '#ecd9a8', 'left', 600, boxW);
        let cy = top;
        e.choices.forEach((choice, i) => {
            const x = boxX + (mobile ? 0 : i * (cw + gap)), ch = heights[i], yy = mobile ? cy : top, tint = e.id === 'riftTrader' ? ({ power: '#c8703f', vigor: '#6e9a82', pierce: '#8faec4', skip: '#878b92' }[choice.id]) : choice.id === 'red' ? '#d0626a' : choice.id === 'blue' ? '#6f9fd6' : '#d9b56a', hovered = inside(x, yy, cw, ch);
            panel(ctx, x, yy, cw, ch, { alpha: hovered ? .94 : .88, edge: hovered?tint+'cc':'#ffffff14', r: 2 }); rr(ctx, x + 1, yy + 12, 2, ch - 24, 0); ctx.fillStyle = tint; ctx.fill();
            names[i].forEach((row,j)=>text(ctx,row,x+20,yy+24+j*23,mobile?17:18,'#f6edd8','left',700));
            descriptions[i].forEach(({row,tone},j)=>text(ctx,row,x+20,yy+28+names[i].length*23+j*lh,descSize,tone,'left',500));
            if (choice.powerWarning) text(ctx,POWER_WARNING,x+cw-18,yy+24,14,'#ff777f','right',700);
            register(x, yy, cw, ch, choice.name + ', ' + choice.desc + warnLabel(choice.powerWarning), () => { sound('tap'); mutate('event', { choice: choice.id }); });
            cy += ch + gap;
        });
    }
    function puzzleScene(w, h) {
        const mobile = w < 700, e = state.run.event, p = e.puzzle, width = Math.min(w - 24, 720), x = (w - width) / 2;
        const seconds = Math.max(0, Math.ceil((e.deadline - now()) / 1000)), titleY = mobile ? 84 : 100;
        text(ctx, p.title, w / 2, titleY, mobile ? 20 : 24, '#f5ecd6', 'center', 700, w - 48);
        text(ctx, `남은 시간 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, w / 2, titleY + 28, 15, seconds < 20 ? '#f08d84' : '#dccb95', 'center', 700);
        const ruleSize = mobile ? 14 : 15, clueSize = mobile ? 14 : 16, rules = p.rules.map(rule => wrap(ctx, rule, width - 40, ruleSize, 3)), clues = p.clues.map(clue => wrap(ctx, clue, width - 40, clueSize, 2, 600));
        const py = titleY + 50, contentH = rules.reduce((a, r) => a + r.length * ruleSize * 1.5 + 6, 0) + clues.reduce((a, r) => a + r.length * clueSize * 1.5 + 4, 0) + (clues.length ? 8 : 0);
        panel(ctx, x, py, width, contentH + 28, { alpha: .86 });
        let y = py + 14 + ruleSize * .75;
        for (const rows of rules) { rows.forEach((row, i) => text(ctx, row, x + 20, y + i * ruleSize * 1.5, ruleSize, '#c9d3d5')); y += rows.length * ruleSize * 1.5 + 6; }
        if (clues.length) { line(ctx, x + 20, y - 4, x + width - 20, y - 4); y += 8; }
        for (const rows of clues) { rows.forEach((row, i) => text(ctx, row, x + 20, y + i * clueSize * 1.5, clueSize, '#f0e0b6', 'left', 600)); y += rows.length * clueSize * 1.5 + 4; }
        puzzleForm.style.top = Math.min(h - 240, py + contentH + 46) + 'px'; puzzleForm.hidden = overlay != null;
        const bw = mobile ? (w - 44) / 2 : 200, by = h - (mobile ? 116 : 112);
        hitButton(w / 2 - bw - 6, by, bw, 46, '정답 제출', submitPuzzle, { primary: true, size: 15 }); hitButton(w / 2 + 6, by, bw, 46, '건너뛰고 +5층', () => mutate('puzzle', { skip: true }), { size: 15 });
        if (!seconds && !busy && !pending && expiredPuzzle !== e.puzzle.id) { expiredPuzzle = e.puzzle.id; mutate('puzzle', { answer: '' }); }
    }
    // 천상 결과 의식: 최고 도달층 메달리온을 중심에 두고, 결과별 빛과 금속으로 톤을 나눈다.
    function ended(w, h, t) {
        const run = state.run, mobile = w < 700, defeated = run.outcome === 'defeated', summit = run.completed || run.outcome === 'cleared';
        const tone = defeated ? { ink: '#e8949a', glow: [1, .32, .36], metal: 'cursed' } : run.outcome === 'timedOut' ? { ink: '#9fd8d0', glow: [.5, .86, .84], metal: 'silver' }
            : summit || run.outcome === 'cleared' ? { ink: '#f0d18a', glow: [1, .78, .42], metal: 'gold' } : { ink: '#c9d7de', glow: [.7, .84, .92], metal: 'silver' };
        const title = summit ? '999층 정복' : { cleared: '회랑 정복', defeated: '전투 패배', timedOut: '시간 종료' }[run.outcome] || '탐험 종료';
        const floor = run.highestFloor ?? run.clearedFloor ?? 0, starred = run.contracts.filter(c => c.star);
        const items = run.claimed ? (run.rewardSummary || []) : run.canClaim || run.canReturn
            ? [...(run.rewards || []).map(r => ({ name: r.name || r.type, count: r.count, iconUrl: r.iconUrl, kind: r.type === '골드' ? 'gold' : 'item' })), ...(defeated ? [] : starred.map(c => ({ name: c.name, contract: true })))] : [];
        const tiles = [...items, ...(defeated && !run.claimed ? starred.map(c => ({ name: c.name, contract: true, lost: true })) : [])];
        const heading = run.claimed ? '획득 보상' : defeated ? (items.length ? '마지막 은총' : tiles.length ? '잃은 계약' : '') : tiles.length ? '정산 보상' : '';
        const empty = defeated ? '탐험 보상을 잃었습니다' : '지급할 보상이 없습니다';
        const intro = reduced ? 1 : clamp((t - sceneAt) / 900, 0, 1), ease = 1 - Math.pow(1 - intro, 3);
        const veil = ctx.createLinearGradient(0, 0, 0, h); veil.addColorStop(0, 'rgba(3,5,9,.2)'); veil.addColorStop(.5, 'rgba(3,5,9,.45)'); veil.addColorStop(1, 'rgba(3,5,9,.82)'); ctx.fillStyle = veil; ctx.fillRect(0, 0, w, h);
        // 세로 배분: 제목 / 메달리온 / 기록 / 보상 / (복구 안내) / 행동 버튼. 낮은 화면에서는 메달리온이 먼저 줄어든다.
        const by = h - (mobile ? 76 : 96), noteW = Math.min(w - 48, 520), note = run.timeoutClaimError ? wrap(ctx, run.timeoutClaimError, noteW, 12, 3) : [];
        const bottom = by - 14 - (note.length ? note.length * 17 + 8 : 0), top = mobile ? 74 : 86;
        const D = clamp(Math.min(bottom - top - 40 - 52 - 112, w * .5), 72, mobile ? 168 : 214), R = D / 2 * (.94 + .06 * ease);
        const titleY = top + 12, cx = w / 2, cy = top + 40 + D / 2, statsY = cy + D / 2 + 30, ry = statsY + 34;
        // 제목: 양옆 금속선
        ctx.save(); ctx.globalAlpha = ease;
        const ts = mobile ? 19 : 23; text(ctx, title, cx, titleY, ts, '#f4ead2', 'center', 700); const tw = ctx.measureText(title).width / 2 + 16;
        line(ctx, cx - tw - 46, titleY, cx - tw, titleY, tone.ink + '88', 1); line(ctx, cx + tw, titleY, cx + tw + 46, titleY, tone.ink + '88', 1);
        ctx.restore();
        // 메달리온
        renderer.quad(renderer.glow, cx - R * 2.3, cy - R * 2.3, R * 4.6, R * 4.6, [...tone.glow, (defeated ? .12 : .2) * ease * (reduced ? 1 : 1 + .12 * Math.sin(t / 1500))]);
        ctx.save(); ctx.globalAlpha = ease;
        const disc = ctx.createRadialGradient(cx, cy - R * .35, 0, cx, cy, R); disc.addColorStop(0, tone.ink + '2e'); disc.addColorStop(.7, 'rgba(10,14,20,.92)'); disc.addColorStop(1, 'rgba(5,8,12,.97)');
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = disc; ctx.fill(); ctx.strokeStyle = metal(ctx, tone.metal, cx - R, cy - R, R * 2, R * 2); ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, R - 7, 0, Math.PI * 2); ctx.strokeStyle = tone.ink + '30'; ctx.lineWidth = 1; ctx.stroke();
        const spin = reduced ? 0 : t / 60000;
        for (let i = 0; i < 40; i++) { const a = spin + i * Math.PI / 20, major = i % 10 === 0, r0 = R - 10, r1 = r0 - (major ? 7 : 3); line(ctx, cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, tone.ink + (major ? 'aa' : '3a'), 1); }
        for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 - Math.PI / 2, px = cx + Math.cos(a) * R, py = cy + Math.sin(a) * R, s = k ? 4.5 : 7; path(ctx, [[px, py - s], [px + s * .75, py], [px, py + s], [px - s * .75, py]]); ctx.fillStyle = metal(ctx, tone.metal, px - s, py - s, s * 2, s * 2); ctx.fill(); ctx.strokeStyle = '#0b0f14'; ctx.lineWidth = 1; ctx.stroke(); }
        if (defeated) { path(ctx, [[cx + R * .16, cy - R + 3], [cx + R * .04, cy - R * .72], [cx + R * .14, cy - R * .6], [cx - R * .02, cy - R * .38]], false); ctx.strokeStyle = tone.ink + '99'; ctx.lineWidth = 1.5; ctx.stroke(); }
        const ns = clamp(R * .6, 30, 84); text(ctx, floor, cx, cy - ns * .1, ns, defeated ? '#f1d9d6' : '#fff1cf', 'center', 800, R * 1.6);
        text(ctx, '최고 도달층', cx, cy + ns * .52, clamp(R * .11, 11, 14), tone.ink, 'center', 600);
        // 기록: 판 없이 숫자와 가는 구분선만
        const stats = [[run.clearedFloor + '층', '클리어'], [run.battlesWon + '회', '승리'], [run.elitesWon + '회', '정예 처치']], sw = Math.min(124, (w - 40) / 3);
        stats.forEach(([value, label], i) => { const x = cx + (i - 1) * sw; text(ctx, value, x, statsY - 7, mobile ? 16 : 18, '#f2eadb', 'center', 700, sw - 10); text(ctx, label, x, statsY + 14, 12, '#99a5ab', 'center', 500); if (i) line(ctx, x - sw / 2, statsY - 14, x - sw / 2, statsY + 18, 'rgba(255,255,255,.12)'); });
        ctx.restore();
        // 보상: 아이콘이 놓인 한 줄(들). 넘치면 머리줄 양 끝의 화살표로 넘긴다.
        const tileW = mobile ? 92 : 112, tileH = 96, rw = Math.min(w - 24, 760), cols = Math.max(1, Math.floor(rw / tileW)), rowsFit = Math.max(1, Math.floor((bottom - ry - 22) / (tileH + 6)));
        const per = cols * rowsFit, pages = Math.max(1, Math.ceil(tiles.length / per)); chestPage = clamp(chestPage, 0, pages - 1);
        const page = tiles.slice(chestPage * per, (chestPage + 1) * per);
        if (heading) {
            text(ctx, heading, cx, ry, 12, defeated ? tone.ink : '#cbb886', 'center', 700); const hw = ctx.measureText(heading).width / 2 + 12;
            line(ctx, cx - hw - 70, ry, cx - hw, ry, 'rgba(255,255,255,.12)'); line(ctx, cx + hw, ry, cx + hw + 70, ry, 'rgba(255,255,255,.12)');
            if (pages > 1) { hitButton(cx - hw - 116, ry - 16, 32, 32, '이전 보상', () => chestPage--, { glyph: '‹', size: 18, disabled: chestPage <= 0 }); hitButton(cx + hw + 84, ry - 16, 32, 32, '다음 보상', () => chestPage++, { glyph: '›', size: 18, disabled: chestPage >= pages - 1 }); }
        } else text(ctx, empty, cx, ry + 8, mobile ? 14 : 15, defeated ? tone.ink : '#b8c0c3', 'center', 600, w - 40);
        page.forEach((item, i) => {
            const row = Math.floor(i / cols), inRow = Math.min(cols, page.length - row * cols), x = cx + (i % cols - (inRow - 1) / 2) * tileW, y = ry + 22 + row * (tileH + 6);
            const a = reduced ? 1 : clamp((t - sceneAt - 450 - i * 70) / 320, 0, 1);
            ctx.save(); ctx.globalAlpha = a * (item.lost ? .5 : 1);
            const ink = item.lost ? '#a8a2a2' : item.contract ? '#a9dccb' : item.kind === 'card' ? (item.cardType === '각성' ? '#d4b7ff' : '#8edaff') : '#edce85';
            const icy = y + 24; ctx.beginPath(); ctx.arc(x, icy, 23, 0, Math.PI * 2); ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fill(); ctx.strokeStyle = ink + '40'; ctx.lineWidth = 1; ctx.stroke();
            if (!iconAt(item.iconUrl, x - 18, icy - 18, 36)) sigil(ctx, item.contract || item.kind === 'card' ? 'contract' : 'clarity', x, icy, 26, ink);
            const names = wrap(ctx, item.name, tileW - 12, 12, 2, 600);
            names.forEach((name, j) => text(ctx, name, x, y + 60 + j * 15, 12, '#e9e3d6', 'center', 600));
            if (item.lost) { const lw = Math.min(tileW - 16, ctx.measureText(names[0] || '').width) / 2; line(ctx, x - lw, y + 60, x + lw, y + 60, tone.ink, 1.2); }
            text(ctx, item.contract ? (item.lost ? '상실' : '확정') : `×${fmt(item.count)}`, x, y + 66 + names.length * 15, 13, ink, 'center', 700);
            ctx.restore();
        });
        if (note.length) note.forEach((row, i) => text(ctx, row, cx, bottom + 8 + i * 17, 12, '#edb27c', 'center', 500));
        const label = run.canReturn ? '귀환하고 정산' : run.canClaim ? '보상 수령' : '낙원으로 돌아가기', bw = Math.min(280, w - 48);
        hitButton(cx - bw / 2, by, bw, 50, label, () => {
            if (run.canReturn) mutate('retire');
            else if (run.canClaim) mutate('claim');
            else returnToLobby();
        }, { primary: true, size: 16 });
    }
    // 갈림길: 아치 관문 안쪽으로 겹겹이 물러나는 회랑과 소실점의 빛. 종류는 금속, 빛, 문장으로 구분한다.
    function gateway(c, x, y, w, h, look, t, lit, seed) {
        const cx = x + w / 2, spring = y + w / 2, vx = cx, vy = y + h * .44, [r, g, b] = look.glow.map(v => Math.round(v * 255));
        const arch = () => { c.beginPath(); c.moveTo(x, y + h); c.lineTo(x, spring); c.arc(cx, spring, w / 2, Math.PI, 0); c.lineTo(x + w, y + h); c.closePath(); };
        arch(); const depth = c.createLinearGradient(0, y, 0, y + h); depth.addColorStop(0, 'rgba(9,11,17,.94)'); depth.addColorStop(1, 'rgba(3,4,8,.97)'); c.fillStyle = depth; c.fill();
        c.save(); arch(); c.clip();
        const far = c.createRadialGradient(vx, vy, 0, vx, vy, w * .6); far.addColorStop(0, `rgba(${r},${g},${b},${lit ? .6 : .38})`); far.addColorStop(.45, `rgba(${r},${g},${b},.1)`); far.addColorStop(1, `rgba(${r},${g},${b},0)`); c.fillStyle = far; c.fillRect(x, y, w, h);
        for (let n = 1; n <= 5; n++) { const k = Math.pow(.74, n); c.save(); c.translate(vx, vy); c.scale(k, k); c.translate(-vx, -vy); arch(); c.restore(); c.strokeStyle = `rgba(${r},${g},${b},${.32 - n * .045})`; c.lineWidth = 1; c.stroke(); }
        for (let i = 1; i <= 7; i++) { const f = 1 - Math.pow(.7, i), yy = y + h + (vy - (y + h)) * f, half = w / 2 * (1 - f); line(c, vx - half, yy, vx + half, yy, `rgba(${r},${g},${b},${.2 * (1 - f)})`, 1); }
        line(c, x, y + h, vx, vy, `rgba(${r},${g},${b},.14)`); line(c, x + w, y + h, vx, vy, `rgba(${r},${g},${b},.14)`);
        if (!reduced) for (let i = 0; i < 7; i++) { const f = (t / 5200 + rand(i + seed * 13)) % 1, mx = vx + (rand(i + 3 + seed) - .5) * w * .8 * (1 - f * .6), my = vy + h * .4 - f * h * .55; c.fillStyle = `rgba(${r},${g},${b},${.5 * Math.sin(f * Math.PI)})`; c.fillRect(mx, my, 2, 2); }
        c.save(); c.shadowColor = look.ink; c.shadowBlur = lit ? 18 : 8; sigil(c, look.sigil, vx, vy - w * .02, w * (look.sigil === 'mystery' ? .26 : .3), look.ink + (lit ? 'ff' : 'cc')); c.restore();
        c.restore();
        arch(); c.strokeStyle = metal(c, look.metal, x, y, w, h); c.lineWidth = lit ? 3 : 2; c.stroke();
        c.save(); c.translate(cx, spring); c.scale((w / 2 - 7) / (w / 2), (w / 2 - 7) / (w / 2)); c.translate(-cx, -spring); arch(); c.restore(); c.strokeStyle = look.ink + '30'; c.lineWidth = 1; c.stroke();
        // 쐐기돌. 정예는 가시 셋, 미지는 떠도는 별, 일반은 단정한 마름모.
        const ky = y; c.fillStyle = metal(c, look.metal, cx - 10, ky - 10, 20, 20);
        if (look.sigil === 'devil') { path(c, [[cx - 13, ky + 4], [cx - 9, ky - 12], [cx - 4, ky + 2], [cx, ky - 17], [cx + 4, ky + 2], [cx + 9, ky - 12], [cx + 13, ky + 4]]); c.fill(); }
        else { path(c, [[cx, ky - 10], [cx + 8, ky], [cx, ky + 10], [cx - 8, ky]]); c.fill(); }
        c.strokeStyle = '#0b0f14'; c.lineWidth = 1; c.stroke();
        if (look.sigil === 'mystery') for (let i = 0; i < 3; i++) { const a = (reduced ? 0 : t / 2400) + i * Math.PI * 2 / 3; c.beginPath(); c.arc(cx + Math.cos(a) * 18, ky + Math.sin(a) * 6, 1.8, 0, Math.PI * 2); c.fillStyle = look.ink; c.fill(); }
        line(c, x - 10, y + h, x + w + 10, y + h, metal(c, look.metal, x, y + h, w, 2), 2);
    }
    // 관문 봉인: 기믹이 있는 길은 문턱에 기믹 색 인장을 찍는다. 시련은 기믹 색, 보상은 금빛. 봉인 없는 길은 조용한 금속 마름모.
    const sealTones = { amber: ['#f0c66a', [1, .76, .36]], violet: ['#c9a2f4', [.74, .56, 1]], crimson: ['#ef7f88', [1, .32, .36]], cyan: ['#86d9df', [.45, .85, .9]] };
    const sealSigil = { flame: 'thirst', sword: 'blade', shield: 'ironSkin', eye: 'focus', hourglass: 'rewind', coin: 'greed', dice: 'gambler', scroll: 'contract' };
    function sealMark(c, cx, cy, R, route, look, lit, t, alpha) {
        const g = route.gimmick, [ink, glow] = g ? sealTones[g.tone] || sealTones.amber : [look.ink, look.glow];
        renderer.quad(renderer.glow, cx - R * 2.2, cy - R * 2.2, R * 4.4, R * 4.4, [...glow, (g ? (lit ? .3 : .18) : .07) * alpha]);
        if (g) { const spin = reduced ? 0 : t / 40000; for (let k = 0; k < 16; k++) { const a = spin + k * Math.PI / 8, r1 = R + (k % 2 ? 5 : 9); line(c, cx + Math.cos(a) * (R + 2), cy + Math.sin(a) * (R + 2), cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, ink + (lit ? 'bb' : '66'), 1.2); } }
        const disc = c.createRadialGradient(cx, cy - R * .4, 0, cx, cy, R); disc.addColorStop(0, ink + (g ? '50' : '24')); disc.addColorStop(.75, '#0c1118'); disc.addColorStop(1, '#06090d');
        c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fillStyle = disc; c.fill(); c.strokeStyle = metal(c, g ? 'gold' : look.metal, cx - R, cy - R, R * 2, R * 2); c.lineWidth = lit ? 2.5 : 2; c.stroke();
        c.beginPath(); c.arc(cx, cy, R - 4.5, 0, Math.PI * 2); c.strokeStyle = ink + (lit ? '80' : '40'); c.lineWidth = 1; c.stroke();
        c.save(); c.shadowColor = ink; c.shadowBlur = lit ? 14 : 6;
        if (g) sigil(c, sealSigil[g.sigil] || g.sigil, cx, cy, R * 1.1, ink);
        else { path(c, [[cx, cy - R * .38], [cx + R * .28, cy], [cx, cy + R * .38], [cx - R * .28, cy]]); c.fillStyle = metal(c, look.metal, cx - R * .3, cy - R * .4, R * .6, R * .8); c.fill(); }
        c.restore();
    }
    // 봉인 아래 글: (길 종류) / 이름 / 시련 / 보상. 두 길 중 긴 쪽 높이에 맞춰 관문 높이를 정한다.
    function sealPlan(route, gw, mobile) {
        const g = route.gimmick, size = mobile ? 13 : 15, lh = Math.round(size * 1.45), nameSize = mobile ? 16 : 18;
        const names = wrap(ctx, g ? g.name : route.title, gw, nameSize, 2, 700);
        const parts = g ? [['시련', g.rule, (sealTones[g.tone] || sealTones.amber)[0], '#dfe4e6'], ['보상', g.reward, '#e8c272', '#f2d89c']] : [['', route.description, '', '#c3ccd0']];
        const sections = parts.map(([label, body, ink, color]) => ({ label, ink, color, rows: wrap(ctx, body, gw - 2, size, 20) }));
        const height = (g ? 18 : 0) + names.length * nameSize * 1.25 + 8 + sections.reduce((a, s) => a + (s.label ? 18 : 0) + s.rows.length * lh + 6, 0);
        return { g, size, lh, nameSize, names, sections, height };
    }
    function routeScene(w, h, t) {
        const routes = (state.run.routes || []).slice(0, 2), mobile = w < 700, gap = mobile ? 14 : 84, gw = mobile ? (w - 32 - gap) / 2 : Math.min(290, (w - 220) / 2);
        const sealed = routes.some(route => route.gimmick), R = mobile ? 20 : 24, plans = sealed ? routes.map(route => sealPlan(route, gw, mobile)) : [];
        const labelH = sealed ? R + 14 + Math.max(...plans.map(plan => plan.height)) : mobile ? 88 : 104, top = mobile ? 124 : Math.max(132, h * .18);
        // 봉인 화면은 관문을 낮추고, 하단 가방과 알림 자리를 비워둔다.
        const gh = clamp(Math.min(gw * (sealed ? (mobile ? 1.45 : 1.3) : 1.6), h - top - labelH - (sealed ? (mobile ? 80 : 130) : mobile ? 36 : 52)), sealed && mobile ? 90 : 120, 460);
        text(ctx, '길을 선택하세요', w / 2, top - (mobile ? 30 : 40), mobile ? 17 : 20, '#efe3c6', 'center', 700);
        const p = selection ? (reduced ? 1 : clamp((t - selection.started) / 380, 0, 1)) : 0;
        routes.forEach((route, i) => {
            const look = routeLook[route.kind] || routeLook.normal, x = w / 2 + (i ? gap / 2 : -gap / 2 - gw), picked = selection?.index === i;
            const intro = reduced ? 1 : clamp((t - sceneAt - i * 110) / 520, 0, 1), e = 1 - Math.pow(1 - intro, 3), lit = picked || !selection && inside(x, top, gw, gh + labelH);
            renderer.quad(renderer.glow, x - gw * .35, top - gh * .12, gw * 1.7, gh * 1.3, [...look.glow, (lit ? .22 : .1) * e * (1 + (picked ? p : 0))]);
            ctx.save(); ctx.globalAlpha = e * (selection && !picked ? 1 - p * .85 : 1);
            const yy = top + (1 - e) * 18, zoom = picked ? 1 + p * .05 : 1;
            ctx.translate(x + gw / 2, yy + gh); ctx.scale(zoom, zoom); ctx.translate(-(x + gw / 2), -(yy + gh));
            gateway(ctx, x, yy, gw, gh, look, t, lit, i);
            if (sealed) sealMark(ctx, x + gw / 2, yy + gh, R, route, look, lit, t, ctx.globalAlpha);
            if (route.powerWarning) drawWarning(ctx, x + gw / 2 - 38, yy + gh - 42 - (sealed ? R + 8 : 0), 76, 28);
            ctx.restore(); ctx.save(); ctx.globalAlpha = e * (selection && !picked ? 1 - p * .85 : 1);
            if (sealed) {
                const plan = plans[i]; let ty = yy + gh + R + 14;
                if (plan.g) { text(ctx, route.title, x + gw / 2, ty + 6, 12, look.ink, 'center', 700, gw); ty += 18; }
                plan.names.forEach((row, j) => text(ctx, row, x + gw / 2, ty + plan.nameSize * .6 + j * plan.nameSize * 1.25, plan.nameSize, lit ? '#fff4dc' : '#f0e7d4', 'center', 700, gw));
                ty += plan.names.length * plan.nameSize * 1.25 + 8;
                for (const s of plan.sections) {
                    if (s.label) {
                        path(ctx, [[x + 4, ty + 4], [x + 8, ty + 8.5], [x + 4, ty + 13], [x, ty + 8.5]]); ctx.fillStyle = s.ink; ctx.fill();
                        text(ctx, s.label, x + 14, ty + 9, 12, s.ink, 'left', 700); line(ctx, x + 22 + ctx.measureText(s.label).width, ty + 9, x + gw, ty + 9, s.ink + '30'); ty += 18;
                    }
                    s.rows.forEach((row, j) => text(ctx, row, x, ty + plan.lh / 2 + j * plan.lh, plan.size, s.color, 'left', 500));
                    ty += s.rows.length * plan.lh + 6;
                }
            } else {
                const ly = yy + gh + 26, ds = mobile ? 13 : 14;
                text(ctx, route.title, x + gw / 2, ly, mobile ? 17 : 20, lit ? '#fff4dc' : '#f0e7d4', 'center', 700, gw);
                wrap(ctx, route.description, gw - 8, ds, 2).forEach((row, j) => text(ctx, row, x + gw / 2, ly + 25 + j * ds * 1.45, ds, '#c3ccd0', 'center', 500));
            }
            ctx.restore();
            const g = route.gimmick;
            register(x, top, gw, gh + labelH, `${i + 1}번 길, ${route.title}, ${route.description}${g ? `, 봉인 ${g.name}, 시련: ${g.rule} 보상: ${g.reward}` : ''}${warnLabel(route.powerWarning)}`, () => pickRoute(route, i), !!selection || intro < .9);
        });
        if (p) { ctx.fillStyle = `rgba(2,4,7,${p * .5})`; ctx.fillRect(0, 0, w, h); }
    }
    // 유물 발견: 받침대 위에 떠 있는 유물 셋. 등급색 빛기둥과 가는 모서리 틀.
    function pedestal(relic, cx, base, s, t, lit, i, picked, p) {
        const ink = relicInk[relic.rarity] || relicInk.normal, tint = relicGlow[relic.rarity] || relicGlow.normal, bob = reduced ? 0 : Math.sin(t / 950 + i * 1.9) * s * .05, iy = base - s * 1.2 + bob - (picked ? p * s * .25 : 0);
        renderer.quad(renderer.glow, cx - s * .42, iy - s * 1.3, s * .84, base - iy + s * 1.4, [...tint, lit ? .16 : .08]);
        renderer.quad(renderer.glow, cx - s, iy - s, s * 2, s * 2, [...tint, (lit ? .3 : .16) * (1 + (picked ? p * 1.5 : 0))]);
        ctx.beginPath(); ctx.ellipse(cx, base + 4, s * .3 * (1 - bob / s), s * .07, 0, 0, Math.PI * 2); ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fill();
        path(ctx, [[cx - s * .5, base], [cx + s * .5, base], [cx + s * .36, base + s * .44], [cx - s * .36, base + s * .44]]);
        const stone = ctx.createLinearGradient(0, base, 0, base + s * .44); stone.addColorStop(0, '#1d242d'); stone.addColorStop(1, '#0a0e13'); ctx.fillStyle = stone; ctx.fill(); ctx.strokeStyle = ink + '30'; ctx.lineWidth = 1; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, base, s * .62, s * .15, 0, 0, Math.PI * 2); const plate = ctx.createLinearGradient(0, base - s * .15, 0, base + s * .15); plate.addColorStop(0, '#2a323c'); plate.addColorStop(1, '#10151b'); ctx.fillStyle = plate; ctx.fill(); ctx.strokeStyle = metal(ctx, relicMetal[relic.rarity] || 'silver', cx - s * .62, base - s * .15, s * 1.24, s * .3); ctx.lineWidth = lit ? 2 : 1.4; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(cx, base, s * .44, s * .1, 0, 0, Math.PI * 2); ctx.strokeStyle = ink + (lit ? '88' : '44'); ctx.lineWidth = 1; ctx.stroke();
        const f = s * .66, k = s * .16; ctx.strokeStyle = ink + (lit ? 'dd' : '77'); ctx.lineWidth = 1.2;
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const ox = cx + sx * f, oy = iy + sy * f; path(ctx, [[ox, oy - sy * k], [ox, oy], [ox - sx * k, oy]], false); ctx.stroke(); }
        ctx.save(); ctx.shadowColor = ink; ctx.shadowBlur = lit ? 20 : 9; if (!iconAt(relic.iconUrl, cx - s / 2, iy - s / 2, s)) sigil(ctx, '', cx, iy, s * .7, ink); ctx.restore();
    }
    function relicScene(w, h, t) {
        const run = state.run, list = (run.relicChoices || []).slice(0, 3), n = list.length, mobile = w < 700, picks = run.relicPicksRemaining || 0;
        const titleY = mobile ? 90 : Math.max(112, h * .15), p = selection ? (reduced ? 1 : clamp((t - selection.started) / 420, 0, 1)) : 0;
        text(ctx, '유물 하나를 고르세요', w / 2, titleY, mobile ? 18 : 22, '#f3e8cf', 'center', 700);
        if (picks > 1) text(ctx, `남은 선택 ${picks}회`, w / 2, titleY + 26, 13, '#aeb8bd', 'center', 600);
        focused = clamp(focused, 0, Math.max(0, n - 1));
        const cw = mobile ? (w - 16) / 3 : Math.min(270, (w - 160) / 3), s = mobile ? Math.min(cw * .5, 64, h * .1) : Math.min(cw * .46, h * .16, 118);
        const base = titleY + (picks > 1 ? 54 : 34) + s * 1.86;
        list.forEach((relic, i) => {
            const cx = w / 2 + (i - (n - 1) / 2) * cw, picked = selection?.index === i, intro = reduced ? 1 : clamp((t - sceneAt - i * 120) / 560, 0, 1), e = 1 - Math.pow(1 - intro, 3);
            const hot = mobile ? i === focused : !selection && inside(cx - cw / 2, base - s * 2, cw, h - 70 - base + s * 2);
            ctx.save(); ctx.globalAlpha = e * (selection && !picked ? 1 - p * .8 : mobile && i !== focused ? .55 : 1);
            pedestal(relic, cx, base + (1 - e) * 16, s, t, hot || picked, i, picked, p);
            if (!mobile) {
                const ink = relicInk[relic.rarity] || relicInk.normal, ny = base + s * .44 + 30;
                text(ctx, relic.name, cx, ny, 18, '#f6eedb', 'center', 700, cw - 16);
                tierMark(ctx, relic, cx, ny + 28, 'center');
                const lines = Math.max(1, Math.min(5, Math.floor((h - 76 - (ny + 54)) / 21)));
                paragraph(ctx, relic.desc, cx, ny + 58, cw - 24, 14, '#cfd6d9', 21, lines, 'center');
                if (hot) line(ctx, cx - 18, ny - 20, cx + 18, ny - 20, ink, 1.5);
            }
            ctx.restore();
            const top = base - s * 2, bottomY = mobile ? base + s * .5 : h - 70;
            register(cx - cw / 2, top, cw, bottomY - top, `${i + 1}번 유물, ${relic.name}, ${relic.rarityLabel}, ${relic.desc}`, () => mobile && focused !== i ? (focused = i, sound('tap')) : pickRelic(relic, i), !!selection || intro < .9);
        });
        if (mobile && n) {
            const relic = list[focused], ny = base + s * .44 + 34, by = h - 116;
            text(ctx, relic.name, w / 2, ny, 18, '#f6eedb', 'center', 700, w - 40);
            tierMark(ctx, relic, w / 2, ny + 28, 'center');
            paragraph(ctx, relic.desc, w / 2, ny + 58, w - 48, 14, '#cfd6d9', 21, Math.max(1, Math.floor((by - 14 - ny - 58) / 21)), 'center');
            hitButton(w / 2 - 110, by, 220, 48, '이 유물 선택', () => pickRelic(relic, focused), { primary: true, size: 16, disabled: !!selection });
        }
        if (p) { ctx.fillStyle = `rgba(255,236,196,${Math.sin(p * Math.PI) * .08})`; ctx.fillRect(0, 0, w, h); }
    }
    // 층 이동 막: 어두워졌다가 목적지로 밝아지고, 전투라면 짧은 신호. 연출 중 장면 입력은 막는다.
    function transitionFx(w, h, t) {
        if (!transition) return false;
        if (transition.next && t - transition.at >= FADE_OUT) { const queued = transition.next; transition.next = null; apply(queued); }
        const age = t - transition.at, end = reduced ? 600 : FADE_END;
        if (age >= end) { transition = null; return false; }
        if (age < 0) return true;
        const mobile = w < 700;
        if (!reduced) {
            const d = age < FADE_OUT ? age / FADE_OUT : age < FADE_OUT + FADE_HOLD ? 1 : 1 - clamp((age - FADE_OUT - FADE_HOLD) / FADE_IN, 0, 1), dark = d * d * (3 - 2 * d);
            ctx.fillStyle = `rgba(2,4,7,${dark})`; ctx.fillRect(0, 0, w, h);
            if (transition.floor && !transition.next) {
                const a = dark * clamp((age - FADE_OUT + 60) / 160, 0, 1); ctx.save(); ctx.globalAlpha = a;
                text(ctx, `${transition.floor}층`, w / 2, h * .44, mobile ? 34 : 46, '#ecdcb6', 'center', 300); const fw = ctx.measureText(`${transition.floor}층`).width / 2 + 18;
                line(ctx, w / 2 - fw - 40, h * .44, w / 2 - fw, h * .44, '#ecdcb655'); line(ctx, w / 2 + fw, h * .44, w / 2 + fw + 40, h * .44, '#ecdcb655'); ctx.restore();
            }
        }
        if (transition.cue && !transition.next) {
            const start = reduced ? 0 : FADE_OUT + FADE_HOLD + 220, a = reduced ? 1 : Math.min(clamp((age - start) / 180, 0, 1), clamp((end - age) / 240, 0, 1));
            if (a > 0) {
                const y = h * (mobile ? .3 : .27), spread = reduced ? 1 : 1 - Math.pow(1 - clamp((age - start) / 320, 0, 1), 3), half = (mobile ? 90 : 140) * spread;
                ctx.save(); ctx.globalAlpha = a;
                const band = ctx.createLinearGradient(w / 2 - half - 60, 0, w / 2 + half + 60, 0); band.addColorStop(0, 'rgba(3,5,8,0)'); band.addColorStop(.5, 'rgba(3,5,8,.55)'); band.addColorStop(1, 'rgba(3,5,8,0)'); ctx.fillStyle = band; ctx.fillRect(w / 2 - half - 60, y - 26, half * 2 + 120, 52);
                line(ctx, w / 2 - half, y - 22, w / 2 + half, y - 22, '#e8c27299', 1); line(ctx, w / 2 - half, y + 22, w / 2 + half, y + 22, '#e8c27299', 1);
                text(ctx, transition.cue, w / 2, y, mobile ? 22 : 28, '#fbeccb', 'center', 800); ctx.restore();
            }
        }
        return true;
    }
    // 지옥: 픽셀 배경은 최근접 필터로 선명하게, 낙하 중에는 선택 방향으로 밀리며 깊이 확대된다.
    function hellBackground(w, h, t) {
        const bg = renderer.image(asset('hell')), gl = renderer.gl;
        if (bg?.ready && !bg.pixel) { gl.bindTexture(gl.TEXTURE_2D, bg.tex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); bg.pixel = true; }
        let zoom = 1, sx = 0, sy = 0, rush = 0;
        if (fall && !reduced) { const p = clamp((t - fall.started) / 650, 0, 1), e = p * p; zoom = 1 + e * .6; sx = (fall.side === 'left' ? 1 : -1) * e * w * .16; sy = -e * h * .1; rush = p; }
        else if (landing && !reduced) { const e = 1 - Math.pow(1 - clamp((t - landing.at) / 600, 0, 1), 3); zoom = 1 + (1 - e) * .35; sy = (1 - e) * h * .12; rush = 1 - e; }
        const dim = overlay ? .5 : activeScene === 'combat' ? .85 : activeScene === 'ended' ? .55 : .8, drift = reduced ? 0 : Math.sin(t / 11000) * 6, bw = (w + 24) * zoom, bh = (h + 16) * zoom;
        renderer.cover(bg, (w - bw) / 2 + drift + sx, (h - bh) / 2 + sy, bw, bh, [dim, dim, dim, 1]);
        if (!reduced) for (let i = 0; i < 34; i++) {
            const x = ((i * 197 + Math.sin(t / 1900 + i) * 40) % (w + 60)) - 30, y = h - ((t * (.025 + rand(i) * .03) + i * 83) % (h + 60)), size = i % 6 ? 2 : 3;
            if (i % 3 === 0) renderer.quad(renderer.glow, x - 6, y - 6, 14, 14, [1, .45, .12, .3]);
            ctx.fillStyle = `rgba(255,${130 + (i % 4) * 25},60,${.45 + .35 * Math.sin(t / 180 + i * 1.7)})`; ctx.fillRect(Math.round(x), Math.round(y), size, size);
        }
        if (rush) for (let i = 0; i < 26; i++) { const x = rand(i + 40) * w, y = h - ((t * 1.4 + i * 97) % (h + 120)); renderer.quad(renderer.glow, x, y, 4, 30 + rush * 50, [1, .62, .3, .4 * rush]); }
        const vignette = ctx.createRadialGradient(w / 2, h * .45, h * .2, w / 2, h / 2, Math.max(w, h) * .7); vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(10,0,0,.62)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
        const top = ctx.createLinearGradient(0, 0, 0, 110); top.addColorStop(0, 'rgba(8,3,3,.72)'); top.addColorStop(1, 'rgba(8,3,3,0)'); ctx.fillStyle = top; ctx.fillRect(0, 0, w, 110);
    }
    function dropFx(w, h, t) {
        if (fall) { const p = reduced ? 1 : clamp((t - fall.started) / 650, 0, 1); ctx.fillStyle = `rgba(0,0,0,${p * p * .8})`; ctx.fillRect(0, 0, w, h); }
        if (!landing) return; const age = t - landing.at, dur = reduced ? 1100 : 1500; if (age > dur) { landing = null; return; }
        const p = reduced ? 1 : clamp(age / 500, 0, 1), fade = 1 - clamp((age - dur + 350) / 350, 0, 1), mobile = w < 700, y = h * .34 - (1 - (1 - Math.pow(1 - p, 3))) * 40;
        ctx.fillStyle = `rgba(0,0,0,${.8 * (1 - p)})`; ctx.fillRect(0, 0, w, h);
        ctx.save(); ctx.globalAlpha = fade; text(ctx, `지하 ${landing.drop.to}층`, w / 2, y, mobile ? 40 : 56, '#ffe0b0', 'center', 800); text(ctx, `${landing.drop.distance}층 낙하`, w / 2, y + (mobile ? 38 : 48), 16, '#f0a070', 'center', 700); ctx.restore();
    }
    function descend(side) { if (busy || pending || fall || landing) return; fall = { side, started: performance.now() }; sound('descent'); setTimeout(() => mutate('descend', { side }), reduced ? 0 : 650); }
    // 방향이 기운 균열: 바위 테두리가 겹겹이 좁아지며 용암 빛 쪽으로 꺾인다.
    function chasm(c, x, y, w, h, dir, t, lit) {
        const k = Math.min(12, w * .06), cx = x + w / 2, cy = y + h * .4, vx = cx + dir * w * .2, vy = y + h * .66;
        c.save(); chamfer(c, x, y, w, h, k); const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, 'rgba(26,10,8,.6)'); g.addColorStop(1, 'rgba(6,2,2,.9)'); c.fillStyle = g; c.fill(); c.clip();
        for (let n = 0; n < 5; n++) {
            const f = n / 4, s = 1 - f * .78, px = cx + (vx - cx) * f, py = cy + (vy - cy) * f, pts = [];
            for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, j = .8 + .2 * rand(i * 7 + n * 31 + dir); pts.push([px + Math.cos(a) * w * .46 * s * j, py + Math.sin(a) * h * .3 * s * j]); }
            path(c, pts); c.fillStyle = ['#3a211a', '#2a1611', '#1c0d0a', '#120706', '#0a0303'][n]; c.fill(); c.strokeStyle = `rgba(255,${110 - n * 12},40,${.18 + f * .5})`; c.lineWidth = 1.5; c.stroke();
        }
        const pulse = reduced ? .8 : .7 + .3 * Math.sin(t / 520), lava = c.createRadialGradient(vx, vy, 0, vx, vy, w * .22); lava.addColorStop(0, `rgba(255,214,140,${.9 * pulse})`); lava.addColorStop(.35, `rgba(255,96,32,${.55 * pulse})`); lava.addColorStop(1, 'rgba(255,60,20,0)'); c.fillStyle = lava; c.fillRect(x, y, w, h);
        const sy = y + h * .12, ang = Math.atan2(vy - sy, vx - cx);
        for (let i = 0; i < 3; i++) { const f = reduced ? (i + 1) / 4 : (t / 1100 + i / 3) % 1, s = w * .09 * (1 - f * .5); c.save(); c.translate(cx + (vx - cx) * f * .9, sy + (vy - sy) * f); c.rotate(ang - Math.PI / 2); path(c, [[-s, -s * .5], [0, s * .3], [s, -s * .5]], false); c.strokeStyle = `rgba(255,200,140,${(lit ? .95 : .6) * Math.sin(f * Math.PI)})`; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(); c.restore(); }
        c.fillStyle = 'rgba(0,0,0,.5)'; c.fillRect(x, y + h - 60, w, 60); c.restore();
        line(c, x + 4, y + h - 60, x + w - 4, y + h - 60, 'rgba(255,150,90,.3)');
        chamfer(c, x, y, w, h, k); c.strokeStyle = metal(c, 'ember', x, y, w, h); c.lineWidth = lit ? 2.5 : 1.5; c.stroke();
    }
    function descentScene(w, h, t) {
        const mobile = w < 700, gap = mobile ? 12 : 48, pw = mobile ? (w - 32 - gap) / 2 : Math.min(380, (w - 160) / 2), ph = Math.min(mobile ? h - 188 : h - 260, 540), top = Math.max(112, (h - ph) / 2 + (mobile ? 0 : 10));
        ['left', 'right'].forEach((side, i) => {
            const x = w / 2 + (i ? gap / 2 : -gap / 2 - pw), picked = fall?.side === side, hovered = !fall && inside(x, top, pw, ph), p = fall ? (reduced ? 1 : clamp((t - fall.started) / 650, 0, 1)) : 0, label = i ? '오른쪽으로 낙하' : '왼쪽으로 낙하';
            if (hovered || picked) renderer.quad(renderer.glow, x - pw * .2, top - ph * .05, pw * 1.4, ph * 1.1, [1, .4, .12, .18]);
            ctx.save(); ctx.globalAlpha = fall && !picked ? 1 - p : 1; chasm(ctx, x, top, pw, ph, i ? 1 : -1, t, hovered || picked);
            text(ctx, label, x + pw / 2, top + ph - 30, mobile ? 17 : 20, '#ffe2c4', 'center', 700, pw - 16); ctx.restore();
            register(x, top, pw, ph, label, () => descend(side), !!fall || !!landing || !state.run.dropsRemaining);
        });
    }
    function drawAltar(c, cx, base, s, t, used, p) {
        const heat = used ? 1 : .55, pulse = reduced ? 1 : .82 + .18 * Math.sin(t / 460), flare = used ? Math.sin(p * Math.PI) : 0;
        c.save(); c.translate(cx, base); c.scale(1, .26); const ground = c.createRadialGradient(0, 0, 0, 0, 0, s * .8); ground.addColorStop(0, `rgba(255,96,32,${.4 * heat * pulse})`); ground.addColorStop(1, 'rgba(255,60,20,0)'); c.fillStyle = ground; c.beginPath(); c.arc(0, 0, s * .8, 0, Math.PI * 2); c.fill(); c.restore();
        // 육각 현무암 기둥: 좌·정면·우·윗면 네 면을 명암으로 나누고 정면에 용암 균열.
        const column = (dx, height, width, back) => {
            const x = cx + dx * s, wd = width * s, bottom = base - (back ? s * .05 : 0), top = bottom - height * s, d = wd * .2, a = x - wd / 2, b = x - wd / 4, e = x + wd / 4, f = x + wd / 2, shade = back ? .7 : 1;
            const face = (pts, rgb) => { path(c, pts); c.fillStyle = `rgb(${rgb.map(v => Math.round(v * shade)).join()})`; c.fill(); };
            face([[a, top], [b, top + d], [b, bottom + d], [a, bottom]], [30, 24, 24]); face([[b, top + d], [e, top + d], [e, bottom + d], [b, bottom + d]], [46, 38, 36]); face([[e, top + d], [f, top], [f, bottom], [e, bottom + d]], [22, 17, 17]);
            face([[a, top], [b, top - d], [e, top - d], [f, top], [e, top + d], [b, top + d]], [66, 56, 52]); c.strokeStyle = `rgba(255,150,90,${.12 + .2 * heat})`; c.lineWidth = 1; c.stroke();
            if (back) return; const r = rand(dx * 97 + height * 13), fx = k => b + (e - b) * k;
            c.save(); c.shadowColor = '#ff5a18'; c.shadowBlur = 10 * heat * pulse; path(c, [[fx(.3 + r * .3), top + d + 4], [fx(.65), top + height * s * .35], [fx(.35), top + height * s * .62], [fx(.55 + r * .3), bottom + d - 2]], false); c.strokeStyle = `rgba(255,${130 + Math.round(r * 70)},60,${.45 + .45 * heat * pulse})`; c.lineWidth = 2; c.stroke(); c.restore();
        };
        [[-.36, .36, .15], [-.13, .5, .16], [.13, .5, .16], [.36, .36, .15]].forEach(([dx, hh, ww]) => column(dx, hh, ww, true));
        [[-.45, .2, .14], [-.27, .3, .16], [.27, .3, .16], [.45, .2, .14], [0, .4, .24]].forEach(([dx, hh, ww]) => column(dx, hh, ww, false));
        const cy = base - s * .58 + (reduced ? 0 : Math.sin(t / 700) * s * .012), r = s * (.065 + .035 * flare);
        renderer.quad(renderer.glow, cx - r * 6, cy - r * 6, r * 12, r * 12, [1, .45, .15, (.2 + .3 * heat) * pulse]);
        for (let i = 0; i < 6; i++) { const a0 = (reduced ? 0 : t / 1500) + i * Math.PI / 3; c.beginPath(); c.ellipse(cx, cy, r * 2.5, r * .8, 0, a0, a0 + .55); c.strokeStyle = `rgba(255,150,80,${.3 + .45 * heat})`; c.lineWidth = 2; c.stroke(); }
        const core = c.createRadialGradient(cx, cy - r * .4, 0, cx, cy, r * 1.3); core.addColorStop(0, '#fff4d6'); core.addColorStop(.35, '#ffb24e'); core.addColorStop(.75, '#e0451a'); core.addColorStop(1, '#4a0f06');
        path(c, [[cx, cy - r * 1.35], [cx + r, cy], [cx, cy + r * 1.35], [cx - r, cy]]); c.fillStyle = core; c.fill(); c.strokeStyle = '#ffd9a0'; c.lineWidth = 1.5; c.stroke();
        if (used && p < 1) {
            for (let k = 0; k < 2; k++) { const q = clamp(p * 1.3 - k * .2, 0, 1), ring = s * (.08 + q * .7); c.beginPath(); c.ellipse(cx, cy, ring, ring * .42, 0, 0, Math.PI * 2); c.strokeStyle = `rgba(255,190,110,${(1 - q) * .8})`; c.lineWidth = 3; c.stroke(); }
            for (let i = 0; i < 18; i++) { const a = rand(i + 1) * Math.PI * 2, dist = p * s * (.25 + rand(i + 5) * .35); c.fillStyle = `rgba(255,${170 + (i % 3) * 30},90,${1 - p})`; c.fillRect(Math.round(cx + Math.cos(a) * dist), Math.round(cy + Math.sin(a) * dist * .6 - p * s * .2), 4, 4); }
        }
    }
    function altarScene(w, h, t) {
        const run = state.run, mobile = w < 700, s = Math.min(w * .62, h * .5, 420), p = run.altarUsed ? (reduced ? 1 : clamp((t - sceneAt) / 1100, 0, 1)) : 0;
        drawAltar(ctx, w / 2, h * (mobile ? .62 : .64), s, t, !!run.altarUsed, p);
        if (!run.altarUsed) { hitButton(w / 2 - 130, h - 124, 260, 52, '제단에 손을 댄다', () => { sound('tap'); mutate('altar'); }, { primary: true, size: 16 }); return; }
        const q = reduced ? 1 : clamp((t - sceneAt - 500) / 500, 0, 1);
        ctx.save(); ctx.globalAlpha = q; text(ctx, run.altarResult?.name || '', w / 2, h - 170 + (1 - q) * 12, mobile ? 22 : 26, '#ffd79a', 'center', 800, w - 40); ctx.restore();
        hitButton(w / 2 - 110, h - 124, 220, 52, '계속', () => mutate('continue'), { primary: true, size: 16, disabled: q < 1 });
    }
    function drawChest(c, cx, bottom, s, rich, open, t) {
        const entry = renderer.image(asset(rich ? 'hell-chest-rich' : 'hell-chest'));
        if (!entry?.ready) return;
        const [sx, sy, sw, sh] = trimmed(entry), width = s * 1.14, height = sh / sw * width;
        const lift = open * s * .12, cy = bottom - height * .5 - lift;
        if (rich || open) {
            const glow = c.createRadialGradient(cx, cy, 0, cx, cy, width * .75);
            glow.addColorStop(0, 'rgba(255,212,120,' + (.12 + open * .65) + ')'); glow.addColorStop(1, 'rgba(255,100,20,0)');
            c.fillStyle = glow; c.fillRect(cx - width, cy - width, width * 2, width * 2);
        }
        c.save(); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
        if (open) c.filter = 'brightness(' + (1 + open * 1.4) + ')';
        c.drawImage(entry.image, sx, sy, sw, sh, cx - width / 2, bottom - height - lift, width, height); c.restore();
        if (open && !reduced) {
            c.save(); c.globalAlpha *= Math.sin(open * Math.PI);
            for (let i = 0; i < 12; i++) {
                const a = i / 12 * Math.PI * 2, r = width * (.2 + open * .6);
                c.fillStyle = rich ? '#ffe6a0' : '#ffb078'; c.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r * .6, 3, 3);
            }
            c.restore();
        }
    }
    const tierLabel = tier => tier === 0 ? '최소 단계' : tier === 10 ? '최고 단계' : tier + '단계';
    // 구버전 상자 행은 categoryName/rewardText가 없으므로 name·description에서 복원한다.
    function chestInfo(chest) {
        const category = chest.categoryName || String(chest.name || '').replace(/^풍요로운\s+/, '').replace(/^(최소 단계|최고 단계|\d+단계)\s+/, '').replace(/\s*상자$/, '');
        return { category, reward: chest.rewardText || String(chest.description || '').split(' · 상급 강화석')[0], tier: Number.isFinite(chest.tier) ? tierLabel(chest.tier) : '' };
    }
    function runeRing(c, cx, cy, rx, ry, rgb, a, t) {
        c.save(); c.translate(cx, cy); c.scale(1, ry / rx); c.strokeStyle = `rgba(${rgb},${a})`; c.lineWidth = 1.4;
        const floor = c.createRadialGradient(0, 0, 0, 0, 0, rx); floor.addColorStop(0, `rgba(${rgb},${a * .35})`); floor.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = floor; c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill(); c.stroke();
        c.beginPath(); c.arc(0, 0, rx * .72, 0, Math.PI * 2); c.stroke();
        const spin = reduced ? 0 : t / 12000;
        for (let i = 0; i < 16; i++) { const q = spin + i / 16 * Math.PI * 2, r2 = rx * (i % 4 ? .84 : .95); c.beginPath(); c.moveTo(Math.cos(q) * rx * .76, Math.sin(q) * rx * .76); c.lineTo(Math.cos(q) * r2, Math.sin(q) * r2); c.stroke(); }
        c.restore();
    }
    function chip(c, label, cx, cy, size, rarity) {
        c.font = `800 ${size}px ${FONT}`; const cw = c.measureText(label).width + size * 1.2, ch = size * 1.7;
        chamfer(c, cx - cw / 2, cy - ch / 2, cw, ch, 5); c.fillStyle = metal(c, rarity, cx - cw / 2, cy - ch / 2, cw, ch); c.fill();
        text(c, label, cx, cy + .5, size, '#2a1606', 'center', 800, undefined, false); return cw;
    }
    function chestCard(c, chest, x, y, w, h, t, open, lit) {
        const rich = !!chest.rich, info = chestInfo(chest), cx = x + w / 2, tone = rich ? '255,204,110' : '255,120,70', pad = 16, tw = w - pad * 2, outline = () => chamfer(c, x, y, w, h, 14);
        const foot = y + h - 42, base = y + 40 + Math.round(h * .34);
        outline(); const bg = c.createLinearGradient(0, y, 0, y + h); bg.addColorStop(0, rich ? '#3c2810' : '#22130f'); bg.addColorStop(1, '#0a0606'); c.fillStyle = bg; c.fill();
        c.save(); outline(); c.clip();
        const light = c.createRadialGradient(cx, base - h * .16, 0, cx, base - h * .16, w * .7); light.addColorStop(0, `rgba(${tone},${(rich ? .34 : .18) + (lit ? .1 : 0) + open * .3})`); light.addColorStop(1, `rgba(${tone},0)`); c.fillStyle = light; c.fillRect(x, y, w, base - y + 30);
        runeRing(c, cx, base - 4, w * .38, w * .095, tone, (lit ? .62 : .32) + open * .35, t);
        c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x, foot, w, 42); c.restore();
        line(c, x + 4, foot, x + w - 4, foot, `rgba(${tone},.35)`);
        text(c, info.tier, x + pad, y + 22, 12, rich ? '#e8c98a' : '#b9a28e', 'left', 600, tw * .5);
        if (rich) chip(c, '풍요로운', x + w - pad - 38, y + 22, 12, 'gold');
        drawChest(c, cx, base, Math.min(w * .58, h * .34), rich, open, t);
        if (chest.iconUrl) { const s = 26, ix = cx + w * .26 - s / 2, iy = base - s - 2; c.beginPath(); c.arc(ix + s / 2, iy + s / 2, s * .66, 0, Math.PI * 2); c.fillStyle = 'rgba(10,5,4,.82)'; c.fill(); c.strokeStyle = `rgba(${tone},.6)`; c.lineWidth = 1; c.stroke(); iconAt(chest.iconUrl, ix, iy, s); }
        const ns = clamp(Math.round(w * .078), 18, 24), names = wrap(c, info.category, tw, ns, 2, 800);
        let yy = base + 18 + ns / 2; names.forEach((name, i) => text(c, name, cx, yy + i * ns * 1.2, ns, rich ? '#ffe2a0' : '#f6e6d8', 'center', 800)); yy += (names.length - 1) * ns * 1.2 + ns / 2 + 10;
        line(c, cx - 18, yy, cx + 18, yy, `rgba(${tone},.7)`, 1.5); yy += 12;
        const rs = clamp(Math.round(w * .056), 14, 17); paragraph(c, info.reward, cx, yy + rs / 2, tw, rs, '#fff2e2', rs * 1.35, Math.max(1, Math.min(2, Math.floor((foot - 4 - yy) / (rs * 1.35)))), 'center', 700);
        if (chest.stones) {
            const label = `상급 강화석 ${fmt(chest.stones)}개`, is = 20; c.font = `700 14px ${FONT}`; const lw = Math.min(c.measureText(label).width, tw - is - 48), total = is + 6 + lw + (rich ? 40 : 0); let sx = cx - total / 2;
            if (iconAt(chest.stonesIconUrl, sx, foot + 21 - is / 2, is)) sx += is + 6; else sx += (is + 6) / 2;
            text(c, label, sx, foot + 21, 14, rich ? '#ffd27a' : '#d8ccc0', 'left', 700, lw);
            if (rich) chip(c, '3배', sx + lw + 24, foot + 21, 12, 'gold');
        }
        c.save(); if (rich) { c.shadowColor = 'rgba(255,196,90,.7)'; c.shadowBlur = lit ? 18 : 10; }
        outline(); c.strokeStyle = metal(c, rich ? 'gold' : 'ember', x, y, w, h); c.lineWidth = rich ? (lit ? 3 : 2.2) : lit ? 2.2 : 1.5; c.stroke(); c.restore();
    }
    function chestScene(w, h, t) {
        const run = state.run, list = (run.chests || []).filter(c => !c.opened), n = list.length, mobile = w < 700, open = chestPick ? (reduced ? 1 : clamp((t - chestPick.started) / 520, 0, 1)) : 0, opens = run.opensRemaining ?? 1;
        const head = `지하 ${run.clearedFloor || 0}층 보상 상자를 하나 고르세요`;
        const pick = chest => { if (busy || pending || chestPick || opens <= 0) return; chestPick = { id: chest.id, started: performance.now() }; sound('chest'); setTimeout(() => mutate('chest', { chest: chest.id }), reduced ? 0 : 560); };
        const label = chest => { const info = chestInfo(chest); return [chest.rich ? `풍요로운 ${info.category}` : info.category, info.tier, info.reward, chest.stones ? `상급 강화석 ${fmt(chest.stones)}개${chest.rich ? ' 3배' : ''}` : ''].filter(Boolean).join(', '); };
        if (mobile) {
            const cw = Math.min(w - 84, 300), ch = Math.min(h - 318, 440), y = 128; chestPage = clamp(chestPage, 0, Math.max(0, n - 1));
            text(ctx, head, w / 2, 114, 16, '#ffd2a8', 'center', 700, w - 32);
            for (const d of [-1, 1, 0]) {
                const i = chestPage + d; if (i < 0 || i >= n) continue; const sc = d ? .88 : 1, x = w / 2 - cw * sc / 2 + d * cw * .9, yy = y + ch * (1 - sc) / 2;
                ctx.save(); ctx.globalAlpha = d ? .45 : chestPick && chestPick.id !== list[i].id ? .5 : 1; chestCard(ctx, list[i], x, yy, cw * sc, ch * sc, t, chestPick?.id === list[i].id ? open : 0, !d); ctx.restore();
                register(Math.max(0, x), yy, Math.min(w, x + cw * sc) - Math.max(0, x), ch * sc, d ? (d < 0 ? '이전 상자' : '다음 상자') : label(list[i]), () => d ? (chestPage = i, sound('tap')) : pick(list[i]), !!chestPick);
            }
            const ny = y + ch + 8;
            hitButton(w / 2 - 92, ny, 44, 40, '이전 상자', () => chestPage--, { glyph: '‹', size: 20, disabled: chestPage <= 0 || !!chestPick }); text(ctx, `${chestPage + 1} / ${n}`, w / 2, ny + 20, 14, '#e0c9b4', 'center', 600); hitButton(w / 2 + 48, ny, 44, 40, '다음 상자', () => chestPage++, { glyph: '›', size: 20, disabled: chestPage >= n - 1 || !!chestPick });
            if (n) hitButton(w / 2 - 120, h - 116, 240, 48, '이 상자 선택', () => pick(list[chestPage]), { primary: true, size: 16, disabled: !!chestPick });
            return;
        }
        const cw = Math.min(300, (w - 220) / 3), ch = Math.min(h - 280, 470), y = Math.max(150, (h - ch) / 2), pages = Math.max(1, Math.ceil(n / 3)); chestPage = clamp(chestPage, 0, pages - 1);
        const shown = list.slice(chestPage * 3, chestPage * 3 + 3), total = shown.length * cw + (shown.length - 1) * 28, x0 = (w - total) / 2;
        text(ctx, head, w / 2, y - 36, 20, '#ffd2a8', 'center', 700, w - 48);
        const recent = run.rewardSummary?.length ? run.rewardSummary.map(r => `${r.name} ×${fmt(r.count)}`).join(', ') : '';
        if (recent && y + ch + 58 < h - 64) text(ctx, `획득 ${recent}`, w / 2, y + ch + 58, 14, '#d8c2ac', 'center', 600, Math.min(w - 260, 900));
        shown.forEach((chest, j) => {
            const x = x0 + j * (cw + 28), intro = reduced ? 1 : clamp((t - sceneAt - j * 120) / 500, 0, 1), e = 1 - Math.pow(1 - intro, 3), picked = chestPick?.id === chest.id, hovered = !chestPick && inside(x, y, cw, ch), yy = y + (1 - e) * 50 - (hovered && !reduced ? 3 : 0);
            if (hovered || picked) renderer.quad(renderer.glow, x - cw * .2, y - ch * .06, cw * 1.4, ch * 1.12, chest.rich ? [1, .78, .35, .18] : [1, .42, .16, .16]);
            ctx.save(); ctx.globalAlpha = chestPick && !picked ? Math.max(.3, 1 - open) : e; chestCard(ctx, chest, x, yy, cw, ch, t, picked ? open : 0, hovered || picked); ctx.restore();
            register(x, y, cw, ch, label(chest), () => pick(chest), !!chestPick || intro < .95);
        });
        if (pages > 1) {
            hitButton(x0 - 64, y + ch / 2 - 22, 44, 44, '이전 상자', () => chestPage--, { glyph: '‹', size: 22, disabled: chestPage <= 0 || !!chestPick }); hitButton(x0 + total + 20, y + ch / 2 - 22, 44, 44, '다음 상자', () => chestPage++, { glyph: '›', size: 22, disabled: chestPage >= pages - 1 || !!chestPick });
            text(ctx, `${chestPage + 1} / ${pages}`, w / 2, y + ch + 28, 14, '#e0c9b4', 'center', 600);
        }
    }
    function iconAt(url, x, y, s) { const e = url && renderer.image(url); if (!e?.ready) return false; const [sx, sy, sw, sh] = trimmed(e), k = s / Math.max(sw, sh); ctx.drawImage(e.image, sx, sy, sw, sh, x + (s - sw * k) / 2, y + (s - sh * k) / 2, sw * k, sh * k); return true; }
    function hellEnded(w, h, t) {
        const run = state.run, mobile = w < 700, list = run.rewardSummary || [], defeated = run.outcome === 'defeated', floor = run.clearedFloor ?? 0;
        const tone = defeated ? '232,118,118' : '255,186,104', y0 = h * .12 + (mobile ? 28 : 0), fy = y0 + (mobile ? 50 : 62);
        runeRing(ctx, w / 2, fy + 4, mobile ? 120 : 170, mobile ? 30 : 40, tone, .42, t);
        text(ctx, { cleared: '탐험 완료', defeated: '전투 패배', retired: '탐험 포기', timedOut: '시간 종료' }[run.outcome] || '탐험 종료', w / 2, y0, mobile ? 18 : 22, defeated ? '#f0a8a8' : '#ffd9bc', 'center', 700);
        text(ctx, `지하 ${fmt(floor)}층`, w / 2, fy, mobile ? 40 : 54, defeated ? '#f3b4a2' : '#ffc27a', 'center', 800);
        text(ctx, '돌파한 층', w / 2, fy + (mobile ? 32 : 42), 13, '#b8a596', 'center', 600);
        const ry = fy + (mobile ? 62 : 78), gap = 10, cols = mobile ? 3 : 5, rw = Math.min(w - 32, 720), tw = (rw - gap * (cols - 1)) / cols, th = mobile ? 100 : 116;
        const fit = n => Math.max(1, Math.floor((h - 124 - ry - n + gap) / (th + gap))) * cols;
        let per = fit(0); const pages = list.length > per ? Math.ceil(list.length / (per = fit(48))) : 1;
        chestPage = clamp(chestPage, 0, pages - 1);
        const page = list.slice(chestPage * per, (chestPage + 1) * per), rows = Math.max(1, Math.ceil(page.length / cols));
        page.forEach((item, i) => {
            const rowN = Math.min(cols, page.length - Math.floor(i / cols) * cols), ix = (w - rowN * tw - (rowN - 1) * gap) / 2 + (i % cols) * (tw + gap), iy = ry + Math.floor(i / cols) * (th + gap), is = Math.round(th * .4);
            ctx.save(); ctx.globalAlpha = reduced ? 1 : clamp((t - sceneAt - i * 60) / 300, 0, 1);
            chamfer(ctx, ix, iy, tw, th, 8); ctx.fillStyle = 'rgba(16,8,6,.74)'; ctx.fill(); ctx.strokeStyle = `rgba(${tone},.3)`; ctx.lineWidth = 1; ctx.stroke();
            const g = ctx.createRadialGradient(ix + tw / 2, iy + 10 + is / 2, 0, ix + tw / 2, iy + 10 + is / 2, is); g.addColorStop(0, `rgba(${tone},.22)`); g.addColorStop(1, `rgba(${tone},0)`); ctx.fillStyle = g; ctx.fillRect(ix, iy, tw, is + 20);
            if (!iconAt(item.iconUrl, ix + (tw - is) / 2, iy + 10, is)) sigil(ctx, '', ix + tw / 2, iy + 10 + is / 2, is * .7, '#f0a070');
            const names = wrap(ctx, item.name, tw - 12, 12, 2, 600);
            names.forEach((name, j) => text(ctx, name, ix + tw / 2, iy + is + 22 + j * 14, 12, '#f2e6da', 'center', 600));
            text(ctx, `×${fmt(item.count)}`, ix + tw / 2, iy + th - 13, 15, '#ffc27a', 'center', 800, tw - 8); ctx.restore();
        });
        if (!list.length) text(ctx, '획득한 보상이 없습니다.', w / 2, ry + 30, 15, '#b8b0aa', 'center');
        if (pages > 1) { const py = ry + rows * (th + gap) + 2; hitButton(w / 2 - 96, py, 44, 36, '이전 보상', () => chestPage--, { glyph: '‹', size: 18, disabled: chestPage <= 0 }); text(ctx, `${chestPage + 1} / ${pages}`, w / 2, py + 18, 14, '#c9bdb2', 'center', 600); hitButton(w / 2 + 52, py, 44, 36, '다음 보상', () => chestPage++, { glyph: '›', size: 18, disabled: chestPage >= pages - 1 }); }
        hitButton(w / 2 - 130, h - 108, 260, 50, '낙원으로 돌아가기', () => { returnToLobby(); }, { primary: true, size: 16 });
    }
    function drawOverlay(w, h) {
        if(overlay === 'shop') { regions=[]; if (!state.shop) { overlay = null; return; } window.ParadiseShop.draw({ctx,w,h,t:performance.now(),state,busy:busy||!!pending,api:lobbyApi(w,h)}); return; }
        if(overlay.startsWith('equipment:')) { regions=[]; window.ParadiseLobby.drawEquipment({ctx,w,h,t:performance.now(),state,busy:busy||!!pending,slot:overlay.split(':')[1],api:lobbyApi(w,h)}); return; }
        const keys = state.hell?.keys || [], hell = state.run?.mode === 'hell';
        const mobile = w < 700, bw = Math.min(w - 24, 680), bh = Math.min(h - (mobile ? 88 : 140), overlay === 'hell' ? 200 + keys.length * 92 : overlay === 'retire' && hell ? 360 : 640), x = (w - bw) / 2, y = (h - bh) / 2;
        ctx.fillStyle = 'rgba(4,8,12,.68)'; ctx.fillRect(0, 0, w, h); panel(ctx, x, y, bw, bh, { alpha: .97, r: 14 }); regions = [];
        const title = { ranking: '주간 순위', inventory: '탐험 기록', retire: hell ? '탐험 포기' : '귀환', hell: '지옥 열쇠', notice: '알림' }[overlay];
        text(ctx, title, x + 24, y + 34, mobile ? 20 : 22, '#f5ecd6', 'left', 700); line(ctx, x + 20, y + 60, x + bw - 20, y + 60, 'rgba(255,255,255,.09)');
        hitButton(x + bw - 52, y + 14, 36, 36, '닫기', () => { overlay = null; syncPuzzle(); }, { glyph: '×', size: 20 });
        if (overlay === 'notice') {
            const lines = wrap(ctx, noticeDetail, bw - 48, 15, 200), count = Math.max(1, Math.floor((bh - 160) / 24)), pages = Math.max(1, Math.ceil(lines.length / count));
            overlayPage = clamp(overlayPage, 0, pages - 1);
            lines.slice(overlayPage * count, (overlayPage + 1) * count).forEach((row, i) => text(ctx, row, x + 24, y + 90 + i * 24, 15, '#e8e1d3'));
            if (pages > 1) {
                hitButton(x + 20, y + bh - 52, 64, 36, '이전', () => overlayPage--, { disabled: overlayPage <= 0, size: 13 });
                text(ctx, `${overlayPage + 1} / ${pages}`, w / 2, y + bh - 34, 13, '#a3b0b5', 'center');
                hitButton(x + bw - 84, y + bh - 52, 64, 36, '다음', () => overlayPage++, { disabled: overlayPage >= pages - 1, size: 13 });
            }
        } else if (overlay === 'ranking') {
            text(ctx, '매주 월요일 00:00 (한국 시간) 초기화', x + 24, y + 84, 13, '#a3b0b5'); text(ctx, `나의 최고 ${state.weekly.bestFloor || 0}층`, x + 24, y + 110, 16, '#f0d58e', 'left', 700); text(ctx, ranking?.me?.rank ? ranking.me.rank + '위' : '순위 없음', x + 40 + ctx.measureText(`나의 최고 ${state.weekly.bestFloor || 0}층`).width, y + 110, 15, '#c9d2d4', 'left', 600);
            const rows = ranking?.rows || [], count = Math.max(3, Math.floor((bh - 250) / 36)), pages = Math.max(1, Math.ceil(rows.length / count)); overlayPage = clamp(overlayPage, 0, pages - 1);
            text(ctx, '순위', x + 24, y + 146, 12, '#8a979c', 'left', 600); text(ctx, '이름', x + 78, y + 146, 12, '#8a979c', 'left', 600); text(ctx, '최고 도달층', x + bw - 24, y + 146, 12, '#8a979c', 'right', 600);
            rows.slice(overlayPage * count, (overlayPage + 1) * count).forEach((row, i) => { const yy = y + 178 + i * 36, mine = row.name === state.player.name; if (mine) { rr(ctx, x + 14, yy - 16, bw - 28, 32, 8); ctx.fillStyle = 'rgba(240,213,142,.1)'; ctx.fill(); } text(ctx, row.rank, x + 28, yy, 16, row.rank <= 3 ? '#f0d58e' : '#9aa7ac', 'left', 700); text(ctx, row.name, x + 78, yy, 15, mine ? '#f6e7bd' : '#d5dcdd', 'left', mine ? 600 : 500, bw - 190); text(ctx, row.floor + '층', x + bw - 24, yy, 15, '#ecd8a4', 'right', 700); });
            if (!rows.length) text(ctx, ranking ? '이번 주 기록이 없습니다.' : '불러오는 중…', w / 2, y + bh * .5, 14, '#a3b0b5', 'center');
            text(ctx, '같은 층은 먼저 도달한 순서, 상위 100명', w / 2, y + bh - 74, 12, '#8a979c', 'center');
            hitButton(x + 20, y + bh - 52, 64, 36, '이전', () => overlayPage--, { disabled: overlayPage <= 0, size: 13 }); hitButton(x + bw - 84, y + bh - 52, 64, 36, '다음', () => overlayPage++, { disabled: overlayPage >= pages - 1, size: 13 }); hitButton(w / 2 - 44, y + bh - 52, 88, 36, '새로고침', fetchRanking, { size: 13 });
        } else if (overlay === 'inventory') {
            const run = state.run, groups = {
                relics: [...run.relics].sort((a,b) => ({special:0,advanced:1,normal:2}[a.rarity])-({special:0,advanced:1,normal:2}[b.rarity])).map(r => ({ ...r, relic: true })),
                augments: [...run.effects.map(a => ({ ...a, desc: a.desc + (run.temporary.find(buff => buff.name === a.name) ? '\n' + run.temporary.find(buff => buff.name === a.name).battles + '회 전투 남음' : '') })),
                    ...run.temporary.filter(buff => !run.effects.some(a => a.name === buff.name)).map(buff => ({ name: buff.name, desc: buff.battles + '회 전투 남음' }))],
                contracts: [...run.contracts.map(a => ({ name: a.name, desc: '귀환 시 정산됩니다.', ink: '#a9dccb' })), ...(run.quests || []).map(q => ({
                    name: q.name, desc: (run.effects.find(a => a.name === q.name)?.desc || '') + '\n' + (q.status === 'completed' ? '달성 완료' : q.status === 'failed' ? '달성 실패' : `${q.progress}/${q.target}, ${q.remaining}회 전투 남음`),
                    ink: q.status === 'failed' ? '#b18d92' : q.status === 'completed' ? '#a9dccb' : '#f0dca8'
                }))]
            };
            const tabs = [['relics', '유물'], ['augments', '증강'], ['contracts', '계약']], tw = (bw - 56) / 3;
            tabs.forEach(([key, label], i) => hitButton(x + 20 + i * (tw + 8), y + 74, tw, 38, `${label} ${groups[key].length}`, () => { inventoryTab = key; overlayPage = 0; }, { primary: inventoryTab === key, size: 14 }));
            const list = groups[inventoryTab], pagesOfRows = [[]], available = bh - 194;
            let used = 0;
            for (const item of list) {
                const icon = inventoryTab === 'relics', width = bw - 48 - (icon ? 76 : 0), lines = wrap(ctx, item.desc, width, 14, 12), height = Math.max(icon ? 92 : 72, 45 + lines.length * 20);
                if (used && used + height > available) { pagesOfRows.push([]); used = 0; }
                pagesOfRows.at(-1).push({ item, icon, width, lines, height }); used += height;
            }
            const pages = pagesOfRows.length; overlayPage = clamp(overlayPage, 0, pages - 1);
            let yy = y + 139;
            for (const { item, icon, width, lines, height } of pagesOfRows[overlayPage]) {
                const tx = x + 24 + (icon ? 76 : 0);
                if (icon) { ctx.save(); ctx.globalAlpha = item.spent ? .4 : 1; ctx.shadowColor = relicInk[item.rarity] || relicInk.normal; ctx.shadowBlur = 8; iconAt(item.iconUrl, x + 22, yy - 5, 60); ctx.restore(); }
                if (item.relic) {
                    text(ctx, item.name, tx, yy, 15, item.spent ? '#aeb6ba' : '#f3ead6', 'left', 700, width - 150);
                    const nx = tx + Math.min(ctx.measureText(item.name).width, width - 150) + 12, bw = tierMark(ctx, item, nx, yy);
                    if (item.spent) text(ctx, '소모됨', nx + bw + 10, yy, 12, '#97a3a8', 'left', 600);
                } else text(ctx, item.name, tx, yy, 15, item.ink || colors[item.rarity] || '#f0dca8', 'left', 700, width);
                lines.forEach((value, i) => text(ctx, value, tx, yy + 25 + i * 20, 14, '#c3cdd0'));
                line(ctx, x + 24, yy + height - 24, x + bw - 24, yy + height - 24, 'rgba(255,255,255,.07)');
                yy += height;
            }
            if (!list.length) text(ctx, { relics: '획득한 유물이 없습니다.', augments: '획득한 증강이 없습니다.', contracts: '보유한 계약이 없습니다.' }[inventoryTab], w / 2, y + bh / 2, 14, '#a3b0b5', 'center');
            hitButton(x + 20, y + bh - 52, 64, 36, '이전', () => overlayPage--, { disabled: overlayPage <= 0, size: 13 }); text(ctx, `${overlayPage + 1} / ${pages}`, w / 2, y + bh - 34, 13, '#a3b0b5', 'center'); hitButton(x + bw - 84, y + bh - 52, 64, 36, '다음', () => overlayPage++, { disabled: overlayPage >= pages - 1, size: 13 });
        } else if (overlay === 'hell') {
            // 희귀 열쇠를 대신 고르지 않도록 기본 선택은 비워 둔다.
            const rh = mobile ? 72 : 82;
            keys.forEach((key, i) => {
                const xx = x + 20, yy = y + 80 + i * (rh + 10), ww = bw - 40, owned = key.count > 0, picked = owned && hellKey === key.name, hovered = owned && inside(xx, yy, ww, rh), s = rh - 28;
                chamfer(ctx, xx, yy, ww, rh, 8); ctx.fillStyle = picked ? 'rgba(120,40,18,.5)' : hovered ? 'rgba(40,22,18,.85)' : 'rgba(18,12,12,.7)'; ctx.fill(); ctx.strokeStyle = picked ? '#ff9a5a' : owned ? 'rgba(255,170,120,.3)' : 'rgba(255,255,255,.08)'; ctx.lineWidth = picked ? 2 : 1; ctx.stroke();
                ctx.save(); ctx.globalAlpha = owned ? 1 : .4; if (!iconAt(key.iconUrl, xx + 14, yy + 14, s)) sigil(ctx, '', xx + 14 + s / 2, yy + rh / 2, s * .8, '#f0a070');
                text(ctx, key.name, xx + s + 28, yy + rh / 2 - 11, mobile ? 16 : 17, '#f6e6d8', 'left', 700, ww - s - 130); text(ctx, `낙하 ${key.drops}회`, xx + s + 28, yy + rh / 2 + 13, 14, '#f0a878', 'left', 700);
                text(ctx, `보유 ${fmt(key.count)}`, xx + ww - 16, yy + rh / 2, 15, owned ? '#ffd2a8' : '#8f8682', 'right', 700); ctx.restore();
                register(xx, yy, ww, rh, `${key.name}, 낙하 ${key.drops}회, 보유 ${key.count}개${picked ? ', 선택됨' : ''}`, () => { hellKey = key.name; sound('tap'); }, !owned);
            });
            const chosen = keys.find(k => k.name === hellKey && k.count > 0);
            paragraph(ctx, '패배하거나 포기하면 마지막 돌파 층 기준으로 상자를 열고, 열쇠는 반환되지 않습니다.', w / 2, y + bh - 94, bw - 48, 14, '#c9b8aa', 20, 2, 'center');
            hitButton(w / 2 - 130, y + bh - 72, 260, 50, chosen ? '열쇠 1개 사용하여 입장' : '열쇠 선택', () => { overlay = null; mutate('enter', { mode: 'hell', key: chosen.name }); }, { primary: true, size: 15, disabled: !chosen || !state.hell?.enabled });
        } else if (overlay === 'retire' && hell) {
            paragraph(ctx, '지옥 탐험이 종료됩니다.\n마지막으로 돌파한 층 기준으로 상자를 엽니다. 돌파한 층이 없으면 보상이 없습니다.\n사용한 열쇠는 반환되지 않습니다.', x + 24, y + 96, bw - 48, 16, '#dde3e3', 26, 6);
            hitButton(w / 2 - 120, y + bh - 128, 240, 48, '탐험 포기', () => { overlay = null; mutate('retire'); }, { primary: true, size: 15 }); hitButton(w / 2 - 120, y + bh - 68, 240, 44, '계속 탐험', () => { overlay = null; });
        } else if (overlay === 'retire') {
            const used = paragraph(ctx, '탐험을 종료하고 획득한 계약과 보상을 정산합니다. 입장권은 반환되지 않습니다.', x + 24, y + 96, bw - 48, 16, '#dde3e3', 26, 4);
            text(ctx, '주간 최고 도달층은 보존됩니다.', x + 24, y + 96 + used + 10, 14, '#e2cf9c', 'left', 600); hitButton(w / 2 - 120, y + bh - 128, 240, 48, '귀환하고 정산', () => { overlay = null; mutate('retire'); }, { primary: true, size: 15 }); hitButton(w / 2 - 120, y + bh - 68, 240, 44, '탐험 계속', () => { overlay = null; syncPuzzle(); });
        }
    }
    function syncRegions() {
        const children=[...controls.children];
        regions.forEach((region,i)=>{
            let button=children[i];
            if(!button){button=document.createElement('button');button.type='button';controls.append(button);}
            button.setAttribute('aria-label',region.label);button.disabled=region.disabled;
            button.style.cssText=`left:${region.x}px;top:${region.y}px;width:${region.w}px;height:${region.h}px`;
            button.onclick=region.fn;
            button.onfocus=()=>{if(inputMode!=='keyboard')return;const index=state?.run?.choices?.findIndex(c=>region.label.includes(c.name));if(index>=0)keyboardCard=index;};
        });
        children.slice(regions.length).forEach(button=>button.remove());
    }
    function frame(t) {
        const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
        if (sceneCanvas.width !== Math.round(w * dpr) || sceneCanvas.height !== Math.round(h * dpr)) { sceneCanvas.width = hudCanvas.width = Math.round(w * dpr); sceneCanvas.height = hudCanvas.height = Math.round(h * dpr); }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); regions = [];
        const inCombat=!heavenEntry&&(state?.run?.phase==='combat'||t<battleUntil);
        if (!inCombat && !battleRoot.hidden) battle.stopCutscene();
        battleRoot.hidden=!inCombat; sceneCanvas.hidden=inCombat;
        if(!inCombat){renderer.begin(w, h);sceneBackground(w,h,t);}
        if (!state) text(ctx, '불러오는 중…', w / 2, h / 2, 16, '#d8cfb8', 'center', 600);
        else if (heavenEntry) heavenEntryScene(w, h, t);
        else {
            const run = state.run, hell = run?.mode === 'hell';
            // 패배·포기 후에도 status='ended'인 채로 상자 선택이 이어지므로 phase를 먼저 본다.
            if(inCombat)combat(w,h,t); else if (hell && run.phase === 'chests') chestScene(w, h, t); else if (hell && (run.status === 'ended' || run.phase === 'ended')) hellEnded(w, h, t); else if (hell && run.phase === 'descent') descentScene(w, h, t); else if (hell && run.phase === 'altar') altarScene(w, h, t);
            else if (!state.run) lobby(w, h, t); else if (state.run.phase === 'augment') augments(w, h, t); else if (state.run.phase === 'combat') combat(w, h, t); else if (state.run.phase === 'event') eventScene(w, h, t); else if (state.run.phase === 'puzzle') puzzleScene(w, h); else if (state.run.phase === 'route') routeScene(w, h, t); else if (state.run.phase === 'relic') relicScene(w, h, t); else ended(w, h, t);
            // 연출 중에는 장면 행동을 받지 않는다.
            if (hell || fall || landing) { if (landing) regions.forEach(r => { r.disabled = true; }); dropFx(w, h, t); }
            if (transitionFx(w, h, t)) regions.forEach(r => { r.disabled = true; });
            gameHud(w, h, t);
            revealOutcome(w,h,t);
            if (overlay) { puzzleForm.hidden = true; drawOverlay(w, h); }
            if (rewardReveal) revealRewards(w, h, t);
            if (pending && !busy) { hitButton(w / 2 - 140, h / 2 - 24, 280, 48, '저장 확인 후 같은 요청 재시도', () => mutate(pending.action, {}, true), { primary: true }); const r = regions[regions.length - 1]; r.disabled = false; }
        }
        syncRegions(); requestAnimationFrame(frame);
    }
    const scrollLobby = delta => { if(!state || state.run || overlay || rewardReveal) return false; lobbyScroll=clamp(lobbyScroll+delta,0,Math.max(0,lobbyHeight-innerHeight));regionKey='';return true; };
    addEventListener('wheel',event=>{if(scrollLobby(event.deltaY))event.preventDefault();},{passive:false});
    let lobbyTouchY=0;
    addEventListener('touchstart',event=>{lobbyTouchY=event.touches[0].clientY;},{passive:true});
    addEventListener('touchmove',event=>{const y=event.touches[0].clientY;if(scrollLobby(lobbyTouchY-y))event.preventDefault();lobbyTouchY=y;},{passive:false});
    addEventListener('keydown',event=>{if(state&&!state.run&&!overlay&&['PageDown','PageUp','ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();scrollLobby({PageDown:innerHeight*.8,PageUp:-innerHeight*.8,ArrowDown:64,ArrowUp:-64,Home:-lobbyHeight,End:lobbyHeight}[event.key]);}});
    addEventListener('pointermove', event => { if(Math.hypot(pointer.x-event.clientX,pointer.y-event.clientY)>4)inputMode='pointer';pointer.x=event.clientX;pointer.y=event.clientY; });
    addEventListener('pointerdown',()=>{inputMode='pointer';audio.unlock();});
    document.addEventListener('pointerleave',()=>{pointer={x:-1000,y:-1000};});
    let touchX = 0; addEventListener('touchstart', event => { touchX = event.changedTouches[0].clientX; }, { passive: true }); addEventListener('touchend', event => { if(rewardReveal)return; if (state?.run?.phase === 'augment' && innerWidth < 700 && Math.abs(event.changedTouches[0].clientX - touchX) > 40 && !selection) focused = clamp(focused + (event.changedTouches[0].clientX < touchX ? 1 : -1), 0, Math.max(0,state.run.choices.length-1)); else if (state?.run?.phase === 'chests' && innerWidth < 700 && Math.abs(event.changedTouches[0].clientX - touchX) > 40 && !chestPick) chestPage += event.changedTouches[0].clientX < touchX ? 1 : -1; }, { passive: true });
    addEventListener('keydown', event => { inputMode='keyboard';audio.unlock();if (event.target instanceof HTMLInputElement || busy || pending || heavenEntry || transition || performance.now()<battleUntil) return;
        if(rewardReveal){if(event.key==='Escape'){event.preventDefault();rewardReveal=null;}return;}
        if (event.key === 'Escape') { overlay = null; syncPuzzle(); } if (state?.run?.phase === 'augment' && /^[123]$/.test(event.key)) { const i = Number(event.key) - 1; if (innerWidth < 700) focused = i; else choose(state.run.choices[i], i); }
        if (!overlay && state?.run?.phase === 'route' && /^[12]$/.test(event.key)) { const i = Number(event.key) - 1; pickRoute(state.run.routes?.[i], i); }
        if (!overlay && state?.run?.phase === 'relic' && /^[123]$/.test(event.key)) { const i = Number(event.key) - 1; focused = i; pickRelic(state.run.relicChoices?.[i], i); }
        if(state?.run?.phase==='combat'&&!overlay)battle.key(event);
        const side = { ArrowLeft: -1, ArrowRight: 1 }[event.key]; if (!side || overlay || state?.run?.mode !== 'hell') return;
        if (state.run.phase === 'descent') descend(side < 0 ? 'left' : 'right'); else if (state.run.phase === 'chests' && !chestPick) chestPage += side; });
    document.addEventListener('visibilitychange', () => { audio.visibility();if(!document.hidden)fetchState();else{battle.reset();battleUntil=0;} });
    addEventListener('pagehide',()=>audio.stop());
    setInterval(() => { if (state?.run?.status === 'active' && (state.run.phase === 'combat' || state.run.timer && (!state.run.timer.paused || state.run.timer.remainingMs <= 0)) || state && state.weekly.resetsAt <= now()) fetchState(); }, 1000);
    fetchState(); requestAnimationFrame(frame);
})();
