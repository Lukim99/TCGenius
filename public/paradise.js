(function () {
    'use strict';
    const sceneCanvas = document.getElementById('paScene'), hudCanvas = document.getElementById('paHud');
    const controls = document.getElementById('paControls'), puzzleForm = document.getElementById('paPuzzle'), live = document.getElementById('paLive');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fmt = n => Number(n || 0).toLocaleString('ko-KR');
    const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
    const ratio = (n, max) => clamp(Number(n) / Math.max(1, Number(max)), 0, 1);
    const asset = name => '/rpg-ui?file=%EB%82%99%EC%9B%90%2F' + name + '.webp';
    const FONT = 'ParadiseSans,Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif';
    const colors = { silver: '#c9d7de', gold: '#e8c272', prismatic: '#c4a2f2', cursed: '#e0707f' };
    const metals = { silver: ['#f4f8fa', '#7f8d96', '#e2e9ec', '#66737b'], gold: ['#fff0c2', '#b4842f', '#f2d184', '#86601f'], prismatic: ['#ffd9f3', '#8fd3ff', '#c4a3ff', '#ffe0a3', '#97eed2'], cursed: ['#ffb8c1', '#84243a', '#df6b7d', '#561522'], ember: ['#ffd2a0', '#8a2f14', '#f08048', '#4f1a0c'], iron: ['#e6ddd0', '#6d625a', '#c4b8aa', '#4a403a'] };
    const glowTint = { silver: [.75, .86, .92], gold: [1, .8, .45], prismatic: [.75, .62, 1], cursed: [1, .36, .42] };
    const tier = { silver: '실버 증강', gold: '골드 증강', prismatic: '프리즘 증강', cursed: '저주 증강' };
    const POWER_WARNING = '위험!';
    let state = null, ranking = null, busy = false, pending = null, offset = 0, message = '', messageUntil = 0, fontsReady = false;
    let overlay = null, overlayPage = 0, focused = 1, hover = -1, pointer = { x: 0, y: 0 }, selection = null;
    let sceneKey = '', sceneAt = performance.now(), regions = [], regionKey = '', puzzleKey = '', activeScene = 'lobby', expiredPuzzle = '';
    const audio = window.ParadiseAudio, battle = window.ParadiseBattle, battleRoot = document.getElementById('paBattle');
    let battleUntil = 0, heldBattle = null, keyboardCard = -1, inputMode = 'pointer';
    const hoverLevels = [0, 0, 0]; let hoverTime = performance.now();
    let hellKey = null, fall = null, landing = null, lastDropKey = '', chestPick = null, chestPage = 0;
    let outcomeReveal = null;
    const now = () => Date.now() + offset;
    const rand = n => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
    const ctx = hudCanvas.getContext('2d');
    function announce(text, visible = true) { live.textContent = String(text || ''); message = visible ? live.textContent : ''; messageUntil = performance.now() + 4500; }
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
    function text(c, value, x, y, size = 14, color = '#ece8de', align = 'left', weight = 500, maxWidth, shadow = true) { c.font = `${weight} ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color; c.shadowColor = 'rgba(0,0,0,.55)'; c.shadowBlur = shadow ? 4 : 0; if (maxWidth) c.fillText(String(value), x, y, maxWidth); else c.fillText(String(value), x, y); c.shadowBlur = 0; }
    function wrap(c, value, width, fontSize = 14, maxLines = 10, weight = 500) {
        c.font = `${weight} ${fontSize}px ${FONT}`; const rows = [];
        for (const paragraph of String(value || '').split('\n')) { let line = ''; for (const word of paragraph.split(/\s+/)) { const next = line ? line + ' ' + word : word; if (c.measureText(next).width <= width) { line = next; continue; } if (line) rows.push(line); line = ''; for (const char of word) { if (line && c.measureText(line + char).width > width) { rows.push(line); line = ''; } line += char; } } if (line) rows.push(line); }
        if (rows.length > maxLines) { let last = rows[maxLines - 1]; while (last && c.measureText(last + '…').width > width) last = last.slice(0, -1); rows[maxLines - 1] = last + '…'; }
        return rows.slice(0, maxLines);
    }
    function paragraph(c, value, x, y, width, size = 14, color = '#c9d2d4', lineHeight = size * 1.55, maxLines = 8, align = 'left', weight = 500) { const lines = wrap(c, value, width, size, maxLines, weight); lines.forEach((line, i) => text(c, line, x, y + i * lineHeight, size, color, align, weight)); return lines.length * lineHeight; }
    function line(c, x, y, xx, yy, color = '#ffffff22', width = 1) { c.beginPath(); c.moveTo(x, y); c.lineTo(xx, yy); c.strokeStyle = color; c.lineWidth = width; c.stroke(); }
    function panel(c, x, y, w, h, { alpha = .82, edge, r = 12 } = {}) { rr(c, x, y, w, h, r); c.fillStyle = `rgba(11,16,22,${alpha})`; c.fill(); let stroke = edge; if (!stroke) { stroke = c.createLinearGradient(0, y, 0, y + h); stroke.addColorStop(0, 'rgba(255,255,255,.18)'); stroke.addColorStop(1, 'rgba(255,255,255,.05)'); } c.strokeStyle = stroke; c.lineWidth = 1; c.stroke(); }
    function metal(c, rarity, x, y, w, h) { const list = metals[rarity] || metals.gold, g = c.createLinearGradient(x, y, x + w, y + h); list.forEach((color, i) => g.addColorStop(i / (list.length - 1), color)); return g; }
    function warnLabel(warn) { return warn ? ` · ${POWER_WARNING}` : ''; }
    function drawWarning(c, x, y, w, h) {
        chamfer(c, x, y, w, h, 6); c.fillStyle = 'rgba(224,63,74,.12)'; c.fill(); c.strokeStyle = 'rgba(239,85,96,.5)'; c.lineWidth = 1; c.stroke();
        text(c, POWER_WARNING, x + w / 2, y + h / 2, 14, '#ff777f', 'center', 700, w - 20);
    }
    function sigil(c, id, x, y, size, color, category) {
        if (category && !['firstStrike','blade','execution','combo','comeback','lastStand','unyielding','ironSkin','insurance','thirst','risk','devil','glass','focus','clarity','pilgrim','future','rewind','forbidden','rest','gambler','greed','contract','cursedTreasure','duplicate'].includes(id)) {
            id = { basic:'blade', skill:'manaCycle', critical:'focus', combo:'combo', defense:'ironSkin', recovery:'thirst', exploration:'rewind', risk:'devil', reward:'contract' }[category] || id;
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
        else if (['contract', 'cursedTreasure', 'duplicate'].includes(id)) { path(c, [[-23, -40], [25, -40], [32, -31], [26, 35], [-26, 35], [-31, 26], [-23, -40]]); c.stroke(); stroke([[-12, -19], [17, -19]]); stroke([[-15, -5], [13, -5]]); circle(5, 24, 11); stroke([[1, 34], [-5, 47], [5, 41], [14, 48], [13, 34]]); }
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
        const tag = choice.equipment ? '장착 장비 전용' : choice.dangerous ? '위험 계약 · 뒤틀림 +10' : '', footTop = h - 2 - 50, warnTop = footTop - (warn ? 44 : 0);
        const maxLines = Math.max(2, Math.floor((warnTop - 6 - y) / lh));
        paragraph(c, choice.desc, cx, y + bodySize * .5, tw, bodySize, '#d6dce0', lh, maxLines, 'center');
        if (warn) drawWarning(c, pad - 6, warnTop, w - (pad - 6) * 2, 32);
        // 하단 띠: 카드 외곽에 맞춰 잘린 어두운 바탕 + 금속 구분선, 층 이동과 조건을 한 줄로.
        c.save(); outline(); c.clip(); c.fillStyle = 'rgba(0,0,0,.32)'; c.fillRect(0, footTop, w, h); c.restore();
        c.save(); c.globalAlpha = .55; line(c, 4, footTop, w - 4, footTop, edge, 1); c.restore();
        const floors = `${choice.floors > 0 ? '+' : ''}${choice.floors}층`, fy = footTop + 25, floorColor = choice.floors < 0 ? '#8fe0d2' : color;
        if (tag) { text(c, floors, pad, fy, 22, floorColor, 'left', 800); const fw = c.measureText(floors).width; text(c, tag, w - pad, fy + 1, 13, choice.dangerous ? '#e9a0a6' : '#a7b2b8', 'right', 500, tw - fw - 14); }
        else text(c, floors, cx, fy, 22, floorColor, 'center', 800);
        return canvas;
    }

    async function fetchState() {
        if (busy || pending || document.hidden || performance.now()<battleUntil) return;
        try { const response = await fetch('/api/paradise', { cache: 'no-store' }); if (response.status === 401) { location.href = '/'; return; } const result = await response.json(); if (!response.ok) throw new Error(result.error); accept(result); } catch (error) { announce(error.message); }
    }
    async function fetchRanking() { try { const response = await fetch('/api/paradise/ranking', { cache: 'no-store' }); if (response.ok) ranking = await response.json(); else announce('주간 랭킹을 불러오지 못했습니다.'); } catch (_) { announce('주간 랭킹 연결을 확인해주세요.'); } }
    function accept(next) {
        const run = next.run;
        const previous=battleState(state), upcoming=battleState(next), events=run?.combatEvents||[];
        const latest=previous&&events.filter(e=>e.enemyId===previous.target.id).at(-1);
        const leaving=previous&&(!upcoming||upcoming.target.id!==previous.target.id);
        if(previous&&leaving&&latest&&(latest.cleared||latest.defeated)) {
            heldBattle={...previous,serverNow:next.serverTime,player:{...previous.player,...next.player},target:{...previous.target,hp:latest.targetHp}};
            const duration=battle.update(heldBattle,events,next.runId);
            if(duration)battleUntil=performance.now()+duration;
        } else if(upcoming) battle.update(upcoming,events,next.runId);
        const key = JSON.stringify([run?.id, run?.phase, run?.event?.id, run?.enemy?.id, run?.choices?.map(c => c.id), run?.altarUsed, run?.chests?.map(c => c.id + (c.opened ? '!' : ''))]);
        if (key !== sceneKey) { sceneKey = key; sceneAt = Math.max(performance.now(),battleUntil); selection = null; focused = 1; hover = -1; keyboardCard = -1; hoverLevels.fill(0); fall = null; chestPick = null; chestPage = 0; renderer.clearCards(); if (run?.phase === 'augment') setTimeout(()=>{if(state?.run?.phase==='augment')sound('reveal');},Math.max(0,battleUntil-performance.now())); if (run?.altarUsed && run.phase === 'altar') sound('reveal'); }
        // 낙하 결과는 서버 응답 뒤에만 착지 연출로 보여준다.
        const drop = run?.mode === 'hell' ? run.lastDrop : null, dropKey = drop ? [run.id, drop.from, drop.to].join() : '';
        if (drop && state && dropKey !== lastDropKey) { landing = { drop, at: performance.now() }; sound('land'); fall = null; }
        lastDropKey = dropKey;
        state = next; offset = next.serverTime - Date.now(); activeScene = !run ? 'lobby' : run.phase === 'event' ? run.event.id : run.phase;
        if (!ranking || ranking.week !== next.weekly.week) fetchRanking();
        audio.setScene(run?.status==='active'?(run.mode==='hell'?'hell':'heaven'):null);
        syncPuzzle(); regionKey = '';
    }
    async function mutate(action, input = {}, retry = false) {
        if (busy || pending && !retry) return; busy = true; regionKey = '';
        if (!retry) { outcomeReveal = null; pending = { action, body: { ...input, requestId: crypto.randomUUID(), revision: state.revision, runId: state.runId } }; }
        try {
            const response = await fetch('/api/paradise/' + pending.action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.body) });
            if (response.status === 401) { location.href = '/'; return; } const result = await response.json(); if (result.retryable) throw new Error(result.error);
            pending = null; if (result.state) accept(result.state); if (result.error) { announce(result.error); selection = null; fall = null; chestPick = null; } else if (result.reveal) {
                outcomeReveal = {...result.reveal, at:performance.now()}; announce(result.message, false); sound(result.reveal.positive ? 'reveal' : 'land');
            } else if (!['attack', 'skill'].includes(action)) announce(result.message, !['enter', 'retire', 'claim'].includes(action));
            if (['augment', 'event', 'retire', 'claim'].includes(action)) fetchRanking();
        } catch (error) { announce(error.message || '연결이 끊겼습니다. 같은 요청으로 재시도해주세요.'); selection = null; fall = null; chestPick = null; }
        finally { busy = false; regionKey = ''; }
    }
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

    function register(x, y, w, h, label, fn, disabled = false) { regions.push({ x, y, w, h, label, fn, disabled: disabled || busy || !!pending }); }
    function inside(x, y, w, h) { return pointer.x >= x && pointer.x <= x + w && pointer.y >= y && pointer.y <= y + h; }
    function hitButton(x, y, w, h, label, fn, options = {}) {
        const hovered = !options.disabled && inside(x, y, w, h);
        chamfer(ctx, x, y, w, h, Math.min(7, h / 4));
        if (options.primary) { const g = ctx.createLinearGradient(0, y, 0, y + h); if (options.disabled) { g.addColorStop(0, '#4a4538'); g.addColorStop(1, '#37332a'); } else { g.addColorStop(0, hovered ? '#fbe3a4' : '#f0d18a'); g.addColorStop(1, hovered ? '#cc9d4b' : '#b98a3e'); } ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = options.disabled ? '#ffffff14' : '#fff3cc99'; }
        else { ctx.fillStyle = hovered ? 'rgba(30,40,50,.88)' : 'rgba(12,18,25,.74)'; ctx.fill(); ctx.strokeStyle = hovered ? 'rgba(240,220,170,.55)' : 'rgba(255,255,255,.14)'; }
        ctx.lineWidth = 1; ctx.stroke();
        const color = options.disabled ? (options.primary ? '#8d8572' : 'rgba(230,235,238,.32)') : options.primary ? '#1d1608' : '#ece8de';
        text(ctx, options.glyph ?? label, x + w / 2, y + h / 2 + .5, options.size || 14, color, 'center', options.primary ? 700 : 600, w - 16, !options.primary);
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
        if (run?.status === 'active') { if (!hell) hitButton(16, h - 52, mobile ? 96 : 112, 36, '유물 · 증강', () => { overlay = 'inventory'; overlayPage = 0; }); hitButton(w - (mobile ? 96 : 112), h - 52, mobile ? 80 : 96, 36, hell ? '탐험 포기' : '귀환', () => { overlay = 'retire'; }); }
        if (message && t < messageUntil) {
            const width = Math.min(w - 32, 560), bottom = run?.phase === 'combat' ? (mobile ? 256 : 230) : run?.phase === 'puzzle' ? 172 : run?.phase === 'augment' && mobile ? 178 : 110;
            // 지옥의 비전투 장면은 하단에 행동 버튼이 몰려 있어 알림을 상단에 띄운다.
            const ty = hell && run.phase !== 'combat' ? 62 : h - bottom;
            const rows=wrap(ctx,message,width-32,14,12), height=rows.length*21+24, top=Math.max(64,ty-height+40);
            panel(ctx, (w - width) / 2, top, width, height, { alpha: .96, r: 3 });
            rows.forEach((row,i)=>text(ctx,row,w/2,top+22+i*21,14,'#efe7d2','center',500));
        }
    }
    function revealOutcome(w, h, t) {
        if (!outcomeReveal) return;
        const elapsed=t-outcomeReveal.at;
        if(elapsed>6500){outcomeReveal=null;return;}
        const mobile=w<700,width=Math.min(w-32,540),x=(w-width)/2,y=mobile?70:84,color=outcomeReveal.positive?'#edce85':'#f19a9e';
        const rows=wrap(ctx,outcomeReveal.text,width-96,mobile?15:17,12),height=Math.max(96,rows.length*25+30);
        ctx.save();ctx.globalAlpha=reduced?1:Math.min(1,elapsed/180,(6500-elapsed)/350);
        panel(ctx,x,y,width,height,{alpha:.97,edge:color+'88',r:2});
        if(!reduced&&elapsed<600){ctx.shadowColor=color;ctx.shadowBlur=18*Math.sin(elapsed/600*Math.PI);}
        sigil(ctx,outcomeReveal.motif,x+37,y+height/2,36,color);
        rows.forEach((row,i)=>text(ctx,row,x+72,y+26+i*25,mobile?15:17,i?color:'#fff3d9','left',i?600:700));
        ctx.restore();
    }
    function sceneBackground(w, h, t) {
        if (state?.run?.mode === 'hell' || state && !state.run && overlay === 'hell') return hellBackground(w, h, t);
        const scene = activeScene, event = ['casino', 'forge', 'mirror', 'chests', 'judge', 'well', 'puzzle'].includes(scene);
        const bg = renderer.image(asset(event ? scene : scene === 'lobby' ? 'paradise' : 'corridor')), dim = scene === 'augment' || overlay ? .5 : scene === 'lobby' ? .6 : scene === 'combat' ? .9 : 1;
        const drift = reduced ? 0 : Math.sin(t / 11000) * 8;
        renderer.cover(bg, -12 + drift, -8, w + 24, h + 16, [dim, dim, dim, 1]);
        const particleColor = scene === 'forge' ? [1, .45, .10] : scene === 'well' || scene === 'collapse' ? [1, .12, .18] : scene === 'casino' || scene === 'chests' ? [1, .77, .29] : [.44, .83, .83];
        if (!reduced) for (let i = 0; i < 22; i++) { const speed = scene === 'forge' ? .045 : .008, x = ((i * 271 + Math.sin(t / 2300 + i) * 35) % (w + 60)) - 30, y = h - ((t * speed + i * 71) % (h + 40)), radius = i % 4 === 0 ? 8 : 4; renderer.quad(renderer.glow, x, y, radius, radius, [...particleColor, scene === 'forge' ? .5 : .22]); }
        if (scene === 'mirror') renderer.quad(renderer.glow, w * (.25 + .5 * ((t / 6500) % 1)), h * .15, w * .07, h * .7, [.7, .9, 1, .14]);
        if (scene === 'well' || scene === 'puzzle') for (let i = 0; i < 3; i++) { const r = 70 + ((t / 35 + i * 50) % 160); renderer.quad(renderer.glow, w / 2 - r, h * .43 - r / 3, r * 2, r / 1.5, [...particleColor, .05]); }
        if (scene === 'chests') [[.27, [1, .18, .20]], [.50, [.17, .53, 1]], [.73, [1, .74, .2]]].forEach(([x, color]) => renderer.quad(renderer.glow, w * x - 70, h * .18, 140, h * .5, [...color, .2]));
        if (scene === 'judge' || scene === 'collapse') renderer.quad(renderer.glow, w * .48, -h * .1, w * .04, h * .9, scene === 'collapse' ? [1, .1, .15, .3] : [1, .85, .5, .2]);
        const vignette = ctx.createRadialGradient(w / 2, h * .45, h * .2, w / 2, h / 2, Math.max(w, h) * .7); vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,.6)'); ctx.fillStyle = vignette; ctx.fillRect(0, 0, w, h);
        const top = ctx.createLinearGradient(0, 0, 0, 110); top.addColorStop(0, 'rgba(3,6,10,.7)'); top.addColorStop(1, 'rgba(3,6,10,0)'); ctx.fillStyle = top; ctx.fillRect(0, 0, w, 110);
    }
    function lobby(w, h, t) {
        const mobile = w < 700, gap = mobile ? 12 : 28, pw = mobile ? (w - 32 - gap) / 2 : 280, ph = mobile ? Math.min(h * .46, pw * 1.55) : Math.min(h * .5, 400);
        const top = mobile ? Math.max(84, h * .42 - ph / 2) : h * .46 - ph / 2, canEnter = state.enabled && state.ticket.count >= 1 && !state.entryBlocked, art = renderer.image(asset('corridor'));
        const keys = state.hell?.keys || [], keyCount = keys.reduce((a, k) => a + (k.count || 0), 0), canHell = !!state.hell?.enabled && keyCount > 0, hellArt = renderer.image(asset('hell'));
        const openHell = () => { overlay = 'hell'; hellKey = null; sound('tap'); };
        for (let i = 0; i < 2; i++) {
            const x = w / 2 + (i ? gap / 2 : -gap / 2 - pw), can = i ? canHell : canEnter, hovered = can && inside(x, top, pw, ph), cx = x + pw / 2;
            if (hovered) renderer.quad(renderer.glow, x - pw * .2, top - ph * .1, pw * 1.4, ph * 1.2, i ? [1, .42, .16, .16] : [1, .82, .5, .14]);
            renderer.cover(i ? hellArt : art, x, top, pw, ph, i ? (!can ? [.45, .38, .38, 1] : hovered ? [1, 1, 1, 1] : [.86, .86, .86, 1]) : hovered ? [1, 1, 1, 1] : [.88, .88, .88, 1]);
            const scrim = ctx.createLinearGradient(0, top + ph * .4, 0, top + ph); scrim.addColorStop(0, 'rgba(5,8,12,0)'); scrim.addColorStop(1, 'rgba(5,8,12,.9)'); ctx.fillStyle = scrim; ctx.fillRect(x, top + ph * .4, pw, ph * .6);
            rr(ctx, x, top, pw, ph, 3); ctx.strokeStyle = i && !can ? 'rgba(170,90,100,.45)' : metal(ctx, i ? 'ember' : 'gold', x, top, pw, ph); ctx.lineWidth = i && !can ? 1 : hovered ? 2.5 : 2; ctx.stroke();
            if (i && !can) { const ly = top + ph * .42; ctx.beginPath(); ctx.arc(cx, ly - 4, 9, Math.PI, 0); ctx.strokeStyle = '#d6aeb3cc'; ctx.lineWidth = 3; ctx.stroke(); rr(ctx, cx - 14, ly - 4, 28, 22, 4); ctx.fillStyle = '#d6aeb3cc'; ctx.fill(); }
            else { path(ctx, [[cx, top - 8], [cx + 9, top], [cx, top + 8], [cx - 9, top]]); ctx.fillStyle = metal(ctx, i ? 'ember' : 'gold', cx - 9, top - 8, 18, 16); ctx.fill(); }
            text(ctx, i ? '지옥' : '천상의 회랑', cx, top + ph - 46, mobile ? 18 : 22, i ? (can ? '#ffd8bc' : '#c9a5aa') : '#f6edd8', 'center', 700, pw - 20);
            text(ctx, i ? (!state.hell?.enabled ? '준비 중' : keyCount ? `열쇠 ${keyCount}개` : '열쇠 없음') : `최고 ${state.weekly.bestFloor || 0}층 · 입장권 ${state.ticket.count}장`, cx, top + ph - 20, mobile ? 13 : 14, i ? (can ? '#f0b48a' : '#9c7d82') : '#d8c99f', 'center', 500, pw - 16);
            register(x, top, pw, ph, i ? '지옥 · 열쇠 선택' : '천상의 회랑 입장', i ? openHell : () => mutate('enter'), i ? !canHell : !state.enabled || state.ticket.count < 1 || !!state.entryBlocked);
        }
        const by = top + ph + 24, bs = mobile ? 14 : 16;
        hitButton(w / 2 - gap / 2 - pw, by, pw, 52, !state.enabled ? '입장 준비 중' : state.ticket.count < 1 ? '입장권 없음' : '입장 · 입장권 1장 사용', () => mutate('enter'), { primary: true, size: bs, disabled: !canEnter });
        hitButton(w / 2 + gap / 2, by, pw, 52, !state.hell?.enabled ? '준비 중' : keyCount ? '열쇠 선택' : '열쇠 없음', openHell, { primary: true, size: bs, disabled: !canHell });
        if (mobile) text(ctx, `전투력 ${fmt(state.player.combatPower)}`, w / 2, by + 74, 13, '#a3b2b8', 'center');
        if (state.entryBlocked) paragraph(ctx, state.entryBlocked, w / 2, by + (mobile ? 100 : 78), Math.min(w - 48, 480), 13, '#eba493', 19, 2, 'center');
        hitButton(16, h - 52, 88, 36, '회랑 안내', () => { overlay = 'guide'; });
    }
    function cardGeometry(w, h) {
        if (w < 700) { const cardW = Math.min(w - 84, 300), y = 104; return { mobile: true, cardW, cardH: Math.min(cardW / .6, h - y - 160), y }; }
        const cardW = Math.min(clamp(h - 270, 320, 560) * .6, (w - 200) / 3), cardH = cardW / .6;
        return { mobile: false, cardW, cardH, y: Math.max(148, h / 2 - cardH / 2 + 16) };
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
            text(ctx,'더 선택할 증강이 없습니다',w/2,h*.43,20,'#f5ecd6','center',700);
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
            register(Math.max(0, card.slotX), card.slotY, Math.min(w, card.slotX + card.slotW) - Math.max(0, card.slotX), card.slotH, `${tier[card.choice.rarity] || '증강'} ${card.choice.name} · ${card.choice.desc} · ${card.choice.floors > 0 ? '+' : ''}${card.choice.floors}층${warnLabel(card.choice.powerWarning)}`, () => mobile && focused !== card.i ? (focused = card.i, sound('tap')) : choose(card.choice, card.i), !!selection || t-sceneAt<460);

        }
        if (mobile) {
            const dotsY = geo.y + geo.cardH + 18;
            if(count>1)hitButton(w / 2 - 86, dotsY - 18, 40, 36, '이전 증강', () => { focused = (focused + count - 1) % count; }, { glyph: '‹', size: 20 });
            for (let i = 0; i < count; i++) { ctx.beginPath(); ctx.arc(w / 2 + (i - (count-1)/2) * 16, dotsY, i === focused ? 4 : 3, 0, Math.PI * 2); ctx.fillStyle = i === focused ? '#f0d58e' : 'rgba(255,255,255,.3)'; ctx.fill(); }
            if(count>1)hitButton(w / 2 + 46, dotsY - 18, 40, 36, '다음 증강', () => { focused = (focused + 1) % count; }, { glyph: '›', size: 20 });
            hitButton(w / 2 - 120, h - 116, 240, 48, '이 증강 선택', () => choose(state.run.choices[focused], focused), { primary: true, size: 16, disabled: !!selection });
        }
        if (selection) { const p = clamp((t - selection.started) / 430, 0, 1); ctx.fillStyle = `rgba(255,232,180,${Math.sin(p * Math.PI) * .1})`; ctx.fillRect(0, 0, w, h); }
    }
    function battleState(snapshot) {
        if (!snapshot?.run?.enemy || !snapshot.battle) return null;
        const run=snapshot.run, enemy=run.enemy, sprite=enemy.sprite;
        return { ...snapshot.battle, serverNow:snapshot.serverTime, inField:true, phase:'elite',
            nextActionAt:run.nextActionAt, combatLog:run.combatLog, target:enemy,
            activeField:{backgroundUrl:asset(run.mode==='hell'?'hell':'corridor'),monster:typeof sprite==='string'?{spriteUrl:sprite}:sprite||{}} };
    }
    function combat(w, h, t) {
        const locked=busy||!!pending||!!overlay||t<battleUntil;
        const current=t<battleUntil?heldBattle:battleState(state);
        if(!current)return;
        battle.update(current, [], state.runId, true);
        for(const r of battle.draw(t, locked)) register(r.x,r.y,r.w,r.h,r.label,r.action,locked);
    }
    battle.onAction=(action, body)=>mutate(action, action==='skill'?{skill:body.skillName}:{});
    function eventScene(w, h, t) {
        const e = state.run.event, mobile = w < 700, boxW = mobile ? w - 32 : Math.min(1100, w - Math.max(64, w * .16)), boxX = (w - boxW) / 2, bottom = h - 68;
        const n = e.choices.length, cols = mobile ? 1 : n, gap = mobile ? 8 : 16, cw = (boxW - gap * (cols - 1)) / cols, descSize = mobile && h<740 ? 13 : 14, lh = descSize * 1.5;
        const descriptions=e.choices.map(choice=>choice.desc.split('\n').flatMap(part=>wrap(ctx,part,cw-40,descSize,20).map(row=>({row,tone:/실패|대신|바칩니다|저주|받는 피해/.test(part)?'#e6a2a6':/[+]|회복|얻습니다/.test(part)?'#e7d29d':'#d1d7dc'}))));
        const names=e.choices.map(choice=>wrap(ctx,choice.name,cw-40-(choice.powerWarning?52:0),mobile?17:18,3,700));
        const measured = e.choices.map((choice,i) => 28 + names[i].length*23 + descriptions[i].length*lh + 12);
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
            const x = boxX + (mobile ? 0 : i * (cw + gap)), ch = heights[i], yy = mobile ? cy : top, tint = choice.id === 'red' ? '#d0626a' : choice.id === 'blue' ? '#6f9fd6' : '#d9b56a', hovered = inside(x, yy, cw, ch);
            panel(ctx, x, yy, cw, ch, { alpha: hovered ? .94 : .88, edge: hovered?tint+'cc':'#ffffff14', r: 2 }); rr(ctx, x + 1, yy + 12, 2, ch - 24, 0); ctx.fillStyle = tint; ctx.fill();
            names[i].forEach((row,j)=>text(ctx,row,x+20,yy+24+j*23,mobile?17:18,'#f6edd8','left',700));
            descriptions[i].forEach(({row,tone},j)=>text(ctx,row,x+20,yy+28+names[i].length*23+j*lh,descSize,tone,'left',500));
            if (choice.powerWarning) text(ctx,POWER_WARNING,x+cw-18,yy+24,14,'#ff777f','right',700);
            register(x, yy, cw, ch, choice.name + ' · ' + choice.desc + warnLabel(choice.powerWarning), () => { sound('tap'); mutate('event', { choice: choice.id }); });
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
        hitButton(w / 2 - bw - 6, by, bw, 46, '정답 제출', submitPuzzle, { primary: true, size: 15 }); hitButton(w / 2 + 6, by, bw, 46, '건너뛰기 · +5층', () => mutate('puzzle', { skip: true }), { size: 15 });
        if (!seconds && !busy && !pending && expiredPuzzle !== e.puzzle.id) { expiredPuzzle = e.puzzle.id; mutate('puzzle', { answer: '' }); }
    }
    function ended(w, h) {
        const run = state.run, mobile = w < 700, y0 = h * .14 + (mobile ? 28 : 0);
        text(ctx, run.outcome === 'cleared' ? '회랑 정복' : run.outcome === 'defeated' ? '전투 패배' : '탐험 종료', w / 2, y0, mobile ? 20 : 24, '#ece0c4', 'center', 700);
        text(ctx, run.highestFloor || run.clearedFloor || run.floor, w / 2, y0 + 66, mobile ? 56 : 72, '#f2d58a', 'center', 800); text(ctx, '도달층', w / 2, y0 + 112, 13, '#b8bfc2', 'center', 600);
        const stats = [['클리어', run.clearedFloor + '층'], ['승리', run.battlesWon + '회'], ['정예 처치', run.elitesWon + '회']], sw = Math.min(140, (w - 56) / 3), sy = y0 + 140;
        stats.forEach(([label, value], i) => { const x = w / 2 - sw / 2 + (i - 1) * (sw + 12); panel(ctx, x, sy, sw, 64, { alpha: .78 }); text(ctx, value, x + sw / 2, sy + 25, 18, '#f5ecd6', 'center', 700, sw - 12); text(ctx, label, x + sw / 2, sy + 47, 12, '#9fabb1', 'center', 500); });
        const rewards = [...run.rewards.map(r => `${r.name || r.type} ×${fmt(r.count)}`), ...run.contracts.filter(c => c.star).map(c => c.name + ' 확정')];
        const rw = Math.min(w - 32, 480), ry = sy + 84, rows = Math.max(1, Math.min(rewards.length, Math.floor((h - 140 - ry - 44) / 26))), rh = 44 + rows * 26;
        panel(ctx, (w - rw) / 2, ry, rw, rh, { alpha: .8 }); text(ctx, '정산 보상', (w - rw) / 2 + 18, ry + 20, 13, '#a7b2b8', 'left', 600);
        if (rewards.length) rewards.slice(0, rows).forEach((reward, i) => text(ctx, reward, (w - rw) / 2 + 18, ry + 46 + i * 26, 15, '#f0d99e', 'left', 600, rw - 36));
        else text(ctx, '지급할 보상이 없습니다.', (w - rw) / 2 + 18, ry + 46, 15, '#b8c0c3');
        hitButton(w / 2 - 130, h - 108, 260, 50, run.claimed ? '다시 회랑으로' : '종료 보상 수령', () => { if (run.claimed) { state.run = null; activeScene = 'lobby'; sceneKey = ''; } else mutate('claim'); }, { primary: true, size: 16 });
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
    function chestCard(c, chest, x, y, w, h, t, open, lit) {
        const rich = !!chest.rich, cx = x + w / 2, tone = rich ? '255,190,90' : '255,110,60', artH = Math.round(h * .38), pad = 18, tw = w - pad * 2, outline = () => chamfer(c, x, y, w, h, 14);
        outline(); const bg = c.createLinearGradient(0, y, 0, y + h); bg.addColorStop(0, rich ? '#2c1c0e' : '#22130f'); bg.addColorStop(1, '#0a0606'); c.fillStyle = bg; c.fill();
        const light = c.createRadialGradient(cx, y + artH * .6, 0, cx, y + artH * .6, w * .6); light.addColorStop(0, `rgba(${tone},${lit ? .32 : .2})`); light.addColorStop(1, `rgba(${tone},0)`); c.save(); outline(); c.clip(); c.fillStyle = light; c.fillRect(x, y, w, artH + 40); c.restore();
        drawChest(c, cx, y + artH + 6, Math.min(w * .6, artH * 1.2), rich, open, t);
        const ns = clamp(Math.round(w * .066), 17, 20), names = wrap(c, chest.name, tw, ns, 2, 700);
        let yy = y + artH + 26 + ns / 2; names.forEach((name, i) => text(c, name, cx, yy + i * ns * 1.25, ns, rich ? '#ffe2a6' : '#f6e6d8', 'center', 700)); yy += (names.length - 1) * ns * 1.25 + ns / 2 + 12;
        line(c, cx - 14, yy, cx + 14, yy, `rgba(${tone},.8)`, 2); yy += 14;
        const foot = y + h - 44, bs = w < 260 ? 14 : 15, lh = bs * 1.5;
        paragraph(c, chest.description.split(' · 상급 강화석')[0], cx, yy + bs / 2, tw, bs, '#d8d2cc', lh, Math.max(1, Math.floor((foot - 6 - yy) / lh)), 'center');
        c.save(); outline(); c.clip(); c.fillStyle = 'rgba(0,0,0,.35)'; c.fillRect(x, foot, w, 44); c.restore(); line(c, x + 4, foot, x + w - 4, foot, `rgba(${tone},.35)`);
        if (chest.stones) text(c, `상급 강화석 ${fmt(chest.stones)}개`, cx, foot + 22, 15, rich ? '#ffd27a' : '#d8ccc0', 'center', 600, tw);
        outline(); c.strokeStyle = metal(c, rich ? 'gold' : 'ember', x, y, w, h); c.lineWidth = lit ? 2.5 : 1.8; c.stroke();
    }
    function chestScene(w, h, t) {
        const run = state.run, list = (run.chests || []).filter(c => !c.opened), n = list.length, mobile = w < 700, open = chestPick ? (reduced ? 1 : clamp((t - chestPick.started) / 520, 0, 1)) : 0, opens = run.opensRemaining ?? 1;
        const head = `지하 ${run.clearedFloor || 0}층 보상 · ${opens}회 개봉 가능`;
        const pick = chest => { if (busy || pending || chestPick || opens <= 0) return; chestPick = { id: chest.id, started: performance.now() }; sound('chest'); setTimeout(() => mutate('chest', { chest: chest.id }), reduced ? 0 : 560); };
        const label = chest => `${chest.name} · ${chest.description}`;
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
        const recent = run.rewardSummary?.length ? run.rewardSummary.map(r => `${r.name} ×${fmt(r.count)}`).join(' · ') : '';
        if (recent && y + ch + 58 < h - 64) text(ctx, `획득 ${recent}`, w / 2, y + ch + 58, 14, '#d8c2ac', 'center', 600, Math.min(w - 260, 900));
        shown.forEach((chest, j) => {
            const x = x0 + j * (cw + 28), intro = reduced ? 1 : clamp((t - sceneAt - j * 120) / 500, 0, 1), e = 1 - Math.pow(1 - intro, 3), picked = chestPick?.id === chest.id, hovered = !chestPick && inside(x, y, cw, ch), yy = y + (1 - e) * 50 - (hovered && !reduced ? 6 : 0);
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
        const run = state.run, mobile = w < 700, y0 = h * .14 + (mobile ? 28 : 0), list = run.rewardSummary || [];
        text(ctx, { cleared: '탐험 완료', defeated: '전투 패배', retired: '탐험 포기' }[run.outcome] || '탐험 종료', w / 2, y0, mobile ? 20 : 24, '#ffd9bc', 'center', 700);
        text(ctx, `지하 ${run.clearedFloor || run.floor}층`, w / 2, y0 + 52, mobile ? 38 : 50, '#ffc27a', 'center', 800);
        const cols = mobile ? 1 : 2, rw = Math.min(w - 32, mobile ? 480 : 640), rx = (w - rw) / 2, ry = y0 + 96, rowH = 54, perCol = Math.max(1, Math.floor((h - 132 - ry - 96) / rowH)), per = perCol * cols, pages = Math.max(1, Math.ceil(list.length / per));
        chestPage = clamp(chestPage, 0, pages - 1);
        const page = list.slice(chestPage * per, (chestPage + 1) * per), rows = Math.max(1, Math.ceil(page.length / cols)), rh = 28 + rows * rowH + (pages > 1 ? 52 : 0), cw = (rw - 24) / cols;
        panel(ctx, rx, ry, rw, rh, { alpha: .82, edge: 'rgba(255,150,90,.3)' });
        page.forEach((item, i) => {
            const ix = rx + 12 + (i % cols) * cw, iy = ry + 14 + Math.floor(i / cols) * rowH; ctx.save(); ctx.globalAlpha = reduced ? 1 : clamp((t - sceneAt - i * 70) / 300, 0, 1);
            chamfer(ctx, ix + 6, iy + 5, 36, 36, 6); ctx.fillStyle = 'rgba(255,140,80,.08)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,160,100,.25)'; ctx.lineWidth = 1; ctx.stroke();
            if (!iconAt(item.iconUrl, ix + 8, iy + 7, 32)) sigil(ctx, '', ix + 24, iy + 23, 24, '#f0a070');
            const names = wrap(ctx, item.name, cw - 124, 15, 2, 600);
            names.forEach((name, j) => text(ctx, name, ix + 52, iy + 23 + (j - (names.length - 1) / 2) * 19, 15, '#f2e6da', 'left', 600));
            text(ctx, `×${fmt(item.count)}`, ix + cw - 12, iy + 23, 15, '#ffc27a', 'right', 700); ctx.restore();
        });
        if (!list.length) text(ctx, '획득한 보상이 없습니다.', w / 2, ry + 37, 15, '#b8b0aa', 'center');
        if (pages > 1) { const py = ry + rh - 46; hitButton(rx + 12, py, 64, 36, '이전', () => chestPage--, { disabled: chestPage <= 0, size: 13 }); text(ctx, `${chestPage + 1} / ${pages}`, w / 2, py + 18, 14, '#c9bdb2', 'center', 600); hitButton(rx + rw - 76, py, 64, 36, '다음', () => chestPage++, { disabled: chestPage >= pages - 1, size: 13 }); }
        hitButton(w / 2 - 130, h - 108, 260, 50, '로비로', () => { state.run = null; activeScene = 'lobby'; sceneKey = ''; }, { primary: true, size: 16 });
    }
    function drawOverlay(w, h) {
        const keys = state.hell?.keys || [], hell = state.run?.mode === 'hell';
        const mobile = w < 700, bw = Math.min(w - 24, 680), bh = Math.min(h - (mobile ? 88 : 140), overlay === 'hell' ? 200 + keys.length * 92 : overlay === 'retire' && hell ? 360 : 640), x = (w - bw) / 2, y = (h - bh) / 2;
        ctx.fillStyle = 'rgba(4,8,12,.68)'; ctx.fillRect(0, 0, w, h); panel(ctx, x, y, bw, bh, { alpha: .97, r: 14 }); regions = [];
        const title = { ranking: '주간 순위', inventory: '유물 · 증강', retire: hell ? '탐험 포기' : '귀환', guide: '회랑 안내', hell: '지옥 열쇠' }[overlay];
        text(ctx, title, x + 24, y + 34, mobile ? 20 : 22, '#f5ecd6', 'left', 700); line(ctx, x + 20, y + 60, x + bw - 20, y + 60, 'rgba(255,255,255,.09)');
        hitButton(x + bw - 52, y + 14, 36, 36, '닫기', () => { overlay = null; syncPuzzle(); }, { glyph: '×', size: 20 });
        if (overlay === 'ranking') {
            text(ctx, '매주 월요일 00:00 (한국 시간) 초기화', x + 24, y + 84, 13, '#a3b0b5'); text(ctx, `나의 최고 ${state.weekly.bestFloor || 0}층 · ${ranking?.me?.rank ? ranking.me.rank + '위' : '순위 없음'}`, x + 24, y + 110, 16, '#f0d58e', 'left', 700);
            const rows = ranking?.rows || [], count = Math.max(3, Math.floor((bh - 250) / 36)), pages = Math.max(1, Math.ceil(rows.length / count)); overlayPage = clamp(overlayPage, 0, pages - 1);
            text(ctx, '순위', x + 24, y + 146, 12, '#8a979c', 'left', 600); text(ctx, '이름', x + 78, y + 146, 12, '#8a979c', 'left', 600); text(ctx, '최고 도달층', x + bw - 24, y + 146, 12, '#8a979c', 'right', 600);
            rows.slice(overlayPage * count, (overlayPage + 1) * count).forEach((row, i) => { const yy = y + 178 + i * 36, mine = row.name === state.player.name; if (mine) { rr(ctx, x + 14, yy - 16, bw - 28, 32, 8); ctx.fillStyle = 'rgba(240,213,142,.1)'; ctx.fill(); } text(ctx, row.rank, x + 28, yy, 16, row.rank <= 3 ? '#f0d58e' : '#9aa7ac', 'left', 700); text(ctx, row.name, x + 78, yy, 15, mine ? '#f6e7bd' : '#d5dcdd', 'left', mine ? 600 : 500, bw - 190); text(ctx, row.floor + '층', x + bw - 24, yy, 15, '#ecd8a4', 'right', 700); });
            if (!rows.length) text(ctx, ranking ? '이번 주 기록이 없습니다.' : '불러오는 중…', w / 2, y + bh * .5, 14, '#a3b0b5', 'center');
            text(ctx, '같은 층은 먼저 도달한 순서 · 상위 100명', w / 2, y + bh - 74, 12, '#8a979c', 'center');
            hitButton(x + 20, y + bh - 52, 64, 36, '이전', () => overlayPage--, { disabled: overlayPage <= 0, size: 13 }); hitButton(x + bw - 84, y + bh - 52, 64, 36, '다음', () => overlayPage++, { disabled: overlayPage >= pages - 1, size: 13 }); hitButton(w / 2 - 44, y + bh - 52, 88, 36, '새로고침', fetchRanking, { size: 13 });
        } else if (overlay === 'inventory') {
            const run = state.run, list = [...(run.quests || []).map(q => ({ name: q.name, desc: q.status === 'completed' ? '계약 달성' : q.status === 'failed' ? '계약 실패' : `${q.remaining}회 전투 남음 · 달성 ${q.progress}/${q.target}` })), ...run.relics.map(r => ({ name: r.name + (r.spent ? ' · 소모됨' : ''), desc: r.desc })), ...run.effects.map(a => ({ name: a.name + (a.count > 1 ? ' ×' + a.count : ''), desc: a.desc })), ...run.temporary.map(a => ({ name: a.name, desc: a.battles + '회 전투 남음' })), ...run.contracts.map(a => ({ name: a.name, desc: '탐험 종료 시 보상' }))];
            const count = Math.max(2, Math.floor((bh - 150) / 76)), pages = Math.max(1, Math.ceil(list.length / count)); overlayPage = clamp(overlayPage, 0, pages - 1);
            list.slice(overlayPage * count, (overlayPage + 1) * count).forEach((item, i) => { const yy = y + 92 + i * 76; text(ctx, item.name, x + 24, yy, 16, '#f0dca8', 'left', 700, bw - 48); paragraph(ctx, item.desc, x + 24, yy + 25, bw - 48, 14, '#c3cdd0', 20, 2); });
            if (!list.length) text(ctx, '획득한 유물과 증강이 없습니다.', w / 2, y + bh / 2, 14, '#a3b0b5', 'center');
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
                register(xx, yy, ww, rh, `${key.name} · 낙하 ${key.drops}회 · 보유 ${key.count}개${picked ? ' · 선택됨' : ''}`, () => { hellKey = key.name; sound('tap'); }, !owned);
            });
            const chosen = keys.find(k => k.name === hellKey && k.count > 0);
            paragraph(ctx, '패배·포기 시 마지막 돌파 층 기준 상자 · 열쇠 미반환', w / 2, y + bh - 94, bw - 48, 14, '#c9b8aa', 20, 2, 'center');
            hitButton(w / 2 - 130, y + bh - 72, 260, 50, chosen ? '열쇠 1개 사용 · 입장' : '열쇠 선택', () => { overlay = null; mutate('enter', { mode: 'hell', key: chosen.name }); }, { primary: true, size: 15, disabled: !chosen || !state.hell?.enabled });
        } else if (overlay === 'retire' && hell) {
            paragraph(ctx, '지옥 탐험이 종료됩니다.\n마지막으로 돌파한 층 기준으로 상자를 엽니다. 돌파한 층이 없으면 보상이 없습니다.\n사용한 열쇠는 반환되지 않습니다.', x + 24, y + 96, bw - 48, 16, '#dde3e3', 26, 6);
            hitButton(w / 2 - 120, y + bh - 128, 240, 48, '탐험 포기', () => { overlay = null; mutate('retire'); }, { primary: true, size: 15 }); hitButton(w / 2 - 120, y + bh - 68, 240, 44, '계속 탐험', () => { overlay = null; });
        } else if (overlay === 'retire') {
            const used = paragraph(ctx, '탐험을 종료하고 획득한 계약과 보상을 정산합니다. 입장권은 반환되지 않습니다.', x + 24, y + 96, bw - 48, 16, '#dde3e3', 26, 4);
            text(ctx, '주간 최고 도달층은 보존됩니다.', x + 24, y + 96 + used + 10, 14, '#e2cf9c', 'left', 600); hitButton(w / 2 - 120, y + bh - 128, 240, 48, '귀환하고 정산', () => { overlay = null; mutate('retire'); }, { primary: true, size: 15 }); hitButton(w / 2 - 120, y + bh - 68, 240, 44, '탐험 계속', () => { overlay = null; syncPuzzle(); });
        } else {
            const lines = ['입장권 1장으로 1층부터 시작합니다. HP와 MP는 다음 전투로 이어집니다.', '전투와 사건 뒤, 세 개의 증강 중 하나를 선택합니다. 장비 전용 증강은 실제 장착한 장비만 등장합니다.', '더 큰 도약과 위험한 계약은 뒤틀림을 높입니다. 100이 되면 회랑이 붕괴합니다.', '999층 수문장을 쓰러뜨리거나 언제든 귀환해 종료 보상을 정산할 수 있습니다.', '기본 보상과 입장권 획득처는 운영자 설정에 따릅니다. 주간 기록은 매주 월요일 0시 초기화됩니다.']; let yy = y + 92; for (const value of lines) yy += paragraph(ctx, value, x + 24, yy, bw - 48, 15, '#d3dbdc', 23, 4) + 14;
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
        const inCombat=state?.run?.phase==='combat'||t<battleUntil;
        battleRoot.hidden=!inCombat; sceneCanvas.hidden=inCombat;
        if(!inCombat){renderer.begin(w, h);sceneBackground(w,h,t);}
        if (!state) text(ctx, '불러오는 중…', w / 2, h / 2, 16, '#d8cfb8', 'center', 600);
        else {
            const run = state.run, hell = run?.mode === 'hell';
            // 패배·포기 후에도 status='ended'인 채로 상자 선택이 이어지므로 phase를 먼저 본다.
            if(inCombat)combat(w,h,t); else if (hell && run.phase === 'chests') chestScene(w, h, t); else if (hell && (run.status === 'ended' || run.phase === 'ended')) hellEnded(w, h, t); else if (hell && run.phase === 'descent') descentScene(w, h, t); else if (hell && run.phase === 'altar') altarScene(w, h, t);
            else if (!state.run) lobby(w, h, t); else if (state.run.phase === 'augment') augments(w, h, t); else if (state.run.phase === 'combat') combat(w, h, t); else if (state.run.phase === 'event') eventScene(w, h, t); else if (state.run.phase === 'puzzle') puzzleScene(w, h); else ended(w, h);
            // 연출 중에는 장면 행동을 받지 않는다.
            if (hell || fall || landing) { if (landing) regions.forEach(r => { r.disabled = true; }); dropFx(w, h, t); }
            gameHud(w, h, t);
            revealOutcome(w,h,t);
            if (overlay) { puzzleForm.hidden = true; drawOverlay(w, h); }
            if (pending && !busy) { hitButton(w / 2 - 140, h / 2 - 24, 280, 48, '저장 확인 · 같은 요청 재시도', () => mutate(pending.action, {}, true), { primary: true }); const r = regions[regions.length - 1]; r.disabled = false; }
        }
        syncRegions(); requestAnimationFrame(frame);
    }
    addEventListener('pointermove', event => { if(Math.hypot(pointer.x-event.clientX,pointer.y-event.clientY)>4)inputMode='pointer';pointer.x=event.clientX;pointer.y=event.clientY; });
    addEventListener('pointerdown',()=>{inputMode='pointer';audio.unlock();});
    document.addEventListener('pointerleave',()=>{pointer={x:-1000,y:-1000};});
    let touchX = 0; addEventListener('touchstart', event => { touchX = event.changedTouches[0].clientX; }, { passive: true }); addEventListener('touchend', event => { if (state?.run?.phase === 'augment' && innerWidth < 700 && Math.abs(event.changedTouches[0].clientX - touchX) > 40 && !selection) focused = clamp(focused + (event.changedTouches[0].clientX < touchX ? 1 : -1), 0, Math.max(0,state.run.choices.length-1)); else if (state?.run?.phase === 'chests' && innerWidth < 700 && Math.abs(event.changedTouches[0].clientX - touchX) > 40 && !chestPick) chestPage += event.changedTouches[0].clientX < touchX ? 1 : -1; }, { passive: true });
    addEventListener('keydown', event => { inputMode='keyboard';audio.unlock();if (event.target instanceof HTMLInputElement || busy || pending || performance.now()<battleUntil) return; if (event.key === 'Escape') { overlay = null; syncPuzzle(); } if (state?.run?.phase === 'augment' && /^[123]$/.test(event.key)) { const i = Number(event.key) - 1; if (innerWidth < 700) focused = i; else choose(state.run.choices[i], i); } if(state?.run?.phase==='combat'&&!overlay)battle.key(event);
        const side = { ArrowLeft: -1, ArrowRight: 1 }[event.key]; if (!side || overlay || state?.run?.mode !== 'hell') return;
        if (state.run.phase === 'descent') descend(side < 0 ? 'left' : 'right'); else if (state.run.phase === 'chests' && !chestPick) chestPage += side; });
    document.addEventListener('visibilitychange', () => { audio.visibility();if(!document.hidden)fetchState();else{battle.reset();battleUntil=0;} });
    addEventListener('pagehide',()=>audio.stop());
    setInterval(() => { if (state?.run?.phase === 'combat' || state && state.weekly.resetsAt <= now()) fetchState(); }, 1000);
    fetchState(); requestAnimationFrame(frame);
})();
