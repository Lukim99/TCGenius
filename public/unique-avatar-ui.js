// 바인드 큐브 아바타 합성 화면과 카드 모달 아바타 보관함.
// app.js가 UniqueAvatarUI.open(model, actions) / renderWardrobe(root, avatars, actions)를 호출한다.
// 판정은 서버 응답(actions.synthesize)만 쓴다. 이 파일은 화면, 연출, 효과음만 맡는다.
(() => {
    'use strict';

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const SOUND_FILES = ['select', 'charge', 'impact', 'resonance', 'bloom', 'victory'];
    const GRADE_KEYS = [['unique', '유니크'], ['limited', '한정'], ['prestige', '프레스티지'], ['normal', '일반']];
    const UNIQUE_STATS = [['공격력', '+250'], ['체력', '+2,500']];
    const UNIQUE_OPTION_COUNT = 5;
    // 연출 타이밍(ms): 요청 시작부터 충돌까지 최소 대기 / 충돌 기준 조리개 개방 / 공개 완료
    const HOLD_MIN = 1150;
    const OPEN_AT = 520;
    const REVEAL_END = 1900;
    const reducedQuery = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false, addEventListener() { }, removeEventListener() { } };

    let current = null;
    let uidSeq = 0;

    // ---------- 기본 도구 ----------
    function h(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = String(text);
        return n;
    }
    function svg(tag, attrs) {
        const n = document.createElementNS(SVG_NS, tag);
        Object.keys(attrs || {}).forEach(k => n.setAttribute(k, String(attrs[k])));
        return n;
    }
    function icon(kind) {
        const s = svg('svg', { viewBox: '0 0 20 20', class: 'ua-ico ua-ico-' + kind, 'aria-hidden': 'true', focusable: 'false' });
        if (kind === 'check') s.append(svg('path', { d: 'M4.5 10.5l3.6 3.6 7.4-8.2', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'square' }));
        if (kind === 'x') s.append(svg('path', { d: 'M5 5l10 10M15 5L5 15', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'square' }));
        if (kind === 'plus') s.append(svg('path', { d: 'M10 4v12M4 10h12', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }));
        if (kind === 'lock') s.append(svg('path', { d: 'M6.5 9V7a3.5 3.5 0 0 1 7 0v2', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }), svg('rect', { x: 4.5, y: 9, width: 11, height: 8, rx: 1.2, fill: 'currentColor' }));
        if (kind === 'skip') s.append(svg('path', { d: 'M3 4l7 6-7 6zM10 4l7 6-7 6z', fill: 'currentColor' }));
        if (kind === 'cube') s.append(svg('path', { d: 'M10 1.8l7 4v8.4l-7 4-7-4V5.8zM3 5.8l7 4 7-4M10 9.8v8.4', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
        if (kind === 'play') s.append(svg('path', { d: 'M6 3.5l11 6.5-11 6.5z', fill: 'currentColor' }));
        if (kind === 'replay') s.append(svg('path', { d: 'M4.2 7.5A6.5 6.5 0 1 1 3.6 12M4 3v4.6h4.6', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        if (kind === 'figure') s.append(svg('circle', { cx: 10, cy: 4.6, r: 2.6, fill: 'currentColor' }), svg('path', { d: 'M5.6 18.5l1.2-8.6c.2-1.3 1.3-2.2 2.6-2.2h1.2c1.3 0 2.4.9 2.6 2.2l1.2 8.6z', fill: 'currentColor' }));
        if (kind === 'card') s.append(svg('rect', { x: 4.5, y: 2.5, width: 11, height: 15, rx: 1.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }), svg('path', { d: 'M7.5 12.5l2.5-3 2.5 3', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5 }));
        if (kind === 'film') s.append(svg('rect', { x: 2.5, y: 4.5, width: 15, height: 11, rx: 1.4, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7 }), svg('path', { d: 'M8.5 7.6l4.4 2.4-4.4 2.4z', fill: 'currentColor' }));
        return s;
    }
    // silent: 보관함처럼 효과음을 쓰지 않는 화면은 음원을 열지 않는다
    function btn(cls, text, onClick, silent) {
        const b = h('button', cls, text);
        b.type = 'button';
        if (onClick) b.addEventListener('click', e => {
            if (b.disabled) return;
            if (!silent) sound.unlock();
            onClick(e);
        });
        return b;
    }
    // 실제 이미지. 실패하면 이름 첫 글자 판으로 대체한다.
    function art(cls, src, alt, eager, label) {
        const box = h('span', 'ua-art ' + (cls || ''));
        const letter = String(label != null ? label : alt || '').replace(/^\[[^\]]*\]\s*/, '').trim().charAt(0) || '?';
        const fb = h('span', 'ua-art-fallback', letter);
        fb.setAttribute('aria-hidden', 'true');
        box.append(fb);
        if (src) {
            const i = document.createElement('img');
            i.alt = alt || '';
            i.decoding = 'async';
            if (!eager) i.loading = 'lazy';
            i.draggable = false;
            i.addEventListener('error', () => { i.remove(); box.classList.add('is-broken'); });
            i.src = src;
            box.append(i);
        } else box.classList.add('is-broken');
        return box;
    }
    const uid = () => 'ua-' + (++uidSeq);
    const call = (fn, ...args) => (typeof fn === 'function' ? fn(...args) : undefined);
    const arr = v => (Array.isArray(v) ? v : []);
    const sid = v => (v == null ? '' : String(v));
    const fmt = v => (Math.round(Number(v) || 0)).toLocaleString('ko-KR');
    const hash = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    function gradeKey(grade, name) {
        const g = String(grade || '');
        if (/유니크/.test(g) || /^\[[^\]]*\]\s*유니크/.test(String(name || ''))) return 'unique';
        if (/한정/.test(g)) return 'limited';
        if (/프레스티지/.test(g)) return 'prestige';
        if (/일반/.test(g)) return 'normal';
        return 'other';
    }
    const synthesisAvatarImage = avatar => gradeKey(avatar.grade, avatar.name) === 'unique'
        ? avatar.iconUrl || avatar.imageUrl : avatar.portraitUrl || avatar.imageUrl;
    function tradesText(n) {
        if (n == null || n === '') return '';
        const v = Number(n);
        if (Number.isNaN(v)) return '';
        if (!Number.isFinite(v) || v < 0) return '거래 무제한';
        if (v === 0) return '거래 불가';
        return '거래 ' + fmt(v) + '회';
    }
    // 등급·거래 같은 부가 정보는 꼬리표 대신 한 줄 텍스트로 잇는다
    const joinMeta = (...parts) => parts.filter(Boolean).join(' · ');

    // ---------- 효과음: 외부 CC0 음원 레이어링 ----------
    const sound = (() => {
        let ctx = null, master = null, epoch = 0;
        const buffers = new Map(), loading = new Map(), voices = new Set();
        function load(name) {
            if (buffers.has(name)) return Promise.resolve(buffers.get(name));
            if (!ctx) return Promise.resolve(null);
            if (!loading.has(name)) {
                const task = fetch('/static/assets/unique-avatar/' + name + '.mp3')
                    .then(r => { if (!r.ok) throw new Error('audio'); return r.arrayBuffer(); })
                    .then(bytes => new Promise((ok, fail) => ctx.decodeAudioData(bytes, ok, fail)))
                    .then(buffer => { buffers.set(name, buffer); return buffer; })
                    .catch(() => null)
                    .finally(() => loading.delete(name));
                loading.set(name, task);
            }
            return loading.get(name);
        }
        // 사용자 입력 안에서만 부른다
        function unlock() {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return;
            if (!ctx) {
                try { ctx = new AC(); } catch (_) { ctx = null; return; }
                master = ctx.createGain();
                master.gain.value = 0.55;
                const comp = ctx.createDynamicsCompressor();
                comp.threshold.value = -14;
                comp.knee.value = 10;
                comp.ratio.value = 6;
                comp.attack.value = 0.003;
                comp.release.value = 0.22;
                master.connect(comp).connect(ctx.destination);
            }
            if (ctx.state === 'suspended') ctx.resume().catch(() => { });
            SOUND_FILES.forEach(load);
        }
        function cut(v) {
            try {
                const now = ctx.currentTime;
                v.gain.gain.cancelScheduledValues(now);
                v.gain.gain.setTargetAtTime(0, now, 0.02);
                v.source.stop(now + 0.08);
            } catch (_) { }
        }
        function stop() {
            epoch++;
            if (ctx) voices.forEach(cut);
            voices.clear();
        }
        function cue(name, volume, rate, delay) {
            if (!ctx || document.hidden) return;
            const token = epoch;
            load(name).then(buffer => {
                if (!buffer || token !== epoch || document.hidden || ctx.state !== 'running') return;
                while (voices.size >= 12) { const old = voices.values().next().value; cut(old); voices.delete(old); }
                const source = ctx.createBufferSource(), gain = ctx.createGain();
                source.buffer = buffer;
                source.playbackRate.value = Math.max(0.4, Math.min(2, rate || 1));
                gain.gain.value = Math.max(0, Math.min(0.9, volume));
                source.connect(gain).connect(master);
                const voice = { source, gain };
                voices.add(voice);
                source.onended = () => { voices.delete(voice); try { source.disconnect(); gain.disconnect(); } catch (_) { } };
                source.start(ctx.currentTime + Math.max(0, delay || 0));
            });
        }
        function play(kind) {
            switch (kind) {
                case 'select': cue('select', 0.42, 1.04); break;
                case 'slot': cue('select', 0.5, 0.84); cue('impact', 0.14, 1.3, 0.01); break;
                case 'release': cue('select', 0.3, 0.7); break;
                case 'charge': cue('charge', 0.55, 1); cue('resonance', 0.22, 0.62, 0.06); break;
                // 일반: 낮은 타격 두 겹 + 잔향
                case 'impact': stop(); cue('impact', 0.68, 0.8); cue('impact', 0.5, 0.5, 0.012); cue('bloom', 0.32, 0.92, 0.5); break;
                // 유니크: 낮은 타격 세 겹 + 공명 + 팡파르
                case 'unique': stop(); cue('impact', 0.8, 0.7); cue('impact', 0.62, 0.46, 0.012); cue('impact', 0.3, 1.1, 0.03); cue('resonance', 0.5, 0.84, 0.08); cue('victory', 0.78, 1, 0.3); cue('bloom', 0.46, 0.8, 0.52); break;
                case 'error': cue('impact', 0.22, 0.6); break;
            }
        }
        return { unlock, play, stop };
    })();

    // ---------- WebGL 차원 큐브 + 빛 입자 ----------
    const CUBE_VS = `
attribute vec3 aPos;attribute vec3 aNrm;attribute vec2 aUv;
uniform vec3 uRot;uniform float uScale;uniform float uSpread;uniform vec2 uCenter;uniform vec2 uSize;
varying vec2 vUv;varying float vFace;
mat3 rx(float a){float c=cos(a),s=sin(a);return mat3(1.0,0.0,0.0,0.0,c,s,0.0,-s,c);}
mat3 ry(float a){float c=cos(a),s=sin(a);return mat3(c,0.0,-s,0.0,1.0,0.0,s,0.0,c);}
mat3 rz(float a){float c=cos(a),s=sin(a);return mat3(c,s,0.0,-s,c,0.0,0.0,0.0,1.0);}
void main(){mat3 r=rz(uRot.z)*ry(uRot.y)*rx(uRot.x);vec3 p=r*((aPos+aNrm*uSpread)*uScale);vec3 n=r*aNrm;float d=max(6.0+p.z,0.6);
vFace=0.3+0.7*clamp(-n.z,0.0,1.0);vUv=aUv;gl_Position=vec4(uCenter+p.xy*uSize*(6.0/d),0.0,1.0);}`;
    const CUBE_FS = `
precision mediump float;varying vec2 vUv;varying float vFace;
uniform vec3 uColor;uniform float uAlpha;uniform float uTime;uniform float uGlow;
void main(){vec2 q=abs(vUv-0.5);float m=max(q.x,q.y);float e=0.5-m;
float edge=1.0-smoothstep(0.0,0.02,e);float halo=(1.0-smoothstep(0.0,0.17,e))*(0.16+0.3*uGlow);
float rune=(1.0-smoothstep(0.0,0.012,abs(m-0.31)))*0.4;float diag=(1.0-smoothstep(0.0,0.01,abs(q.x-q.y)))*step(m,0.31)*0.22;
float scan=0.5+0.5*sin(vUv.y*46.0-uTime*3.2);float fill=(0.03+0.045*scan)*(0.6+uGlow);
float a=clamp((edge*(0.7+0.3*vFace)+halo+(rune+diag)*vFace+fill*vFace)*uAlpha,0.0,1.0);gl_FragColor=vec4(uColor*a,a);}`;
    const DOT_VS = `
attribute vec4 aDot;uniform vec2 uView;uniform float uDpr;varying float vA;
void main(){gl_Position=vec4(aDot.x/uView.x*2.0-1.0,1.0-aDot.y/uView.y*2.0,0.0,1.0);gl_PointSize=aDot.z*uDpr;vA=aDot.w;}`;
    const DOT_FS = `
precision mediump float;uniform vec3 uColor;varying float vA;
void main(){float r=length(gl_PointCoord-0.5)*2.0;float a=((1.0-smoothstep(0.1,1.0,r))*0.7+(1.0-smoothstep(0.0,0.3,r))*0.5)*vA;if(a<0.004)discard;a=min(a,1.0);gl_FragColor=vec4(uColor*a,a);}`;
    const C_IDLE = [0.86, 0.64, 0.34], C_HOT = [1, 0.86, 0.6], C_GOLD = [1, 0.74, 0.32], C_IVORY = [0.84, 0.87, 0.93];
    const MAX_DOTS = 220;

    function createCoreGl(canvas) {
        let gl = null;
        try { gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true }); } catch (_) { gl = null; }
        if (!gl) return null;
        function compile(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader');
            return s;
        }
        function link(vs, fs) {
            const p = gl.createProgram();
            gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
            gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link');
            return p;
        }
        let cubeP, dotP;
        try { cubeP = link(CUBE_VS, CUBE_FS); dotP = link(DOT_VS, DOT_FS); } catch (_) { return null; }
        const cl = {
            pos: gl.getAttribLocation(cubeP, 'aPos'), nrm: gl.getAttribLocation(cubeP, 'aNrm'), uv: gl.getAttribLocation(cubeP, 'aUv'),
            rot: gl.getUniformLocation(cubeP, 'uRot'), scale: gl.getUniformLocation(cubeP, 'uScale'), spread: gl.getUniformLocation(cubeP, 'uSpread'),
            center: gl.getUniformLocation(cubeP, 'uCenter'), size: gl.getUniformLocation(cubeP, 'uSize'), color: gl.getUniformLocation(cubeP, 'uColor'),
            alpha: gl.getUniformLocation(cubeP, 'uAlpha'), time: gl.getUniformLocation(cubeP, 'uTime'), glow: gl.getUniformLocation(cubeP, 'uGlow')
        };
        const dl = {
            dot: gl.getAttribLocation(dotP, 'aDot'), view: gl.getUniformLocation(dotP, 'uView'),
            dpr: gl.getUniformLocation(dotP, 'uDpr'), color: gl.getUniformLocation(dotP, 'uColor')
        };
        // 면마다 두 삼각형: 위치3 + 법선3 + UV2
        const verts = [];
        [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].forEach(n => {
            const u = n[0] ? [0, 1, 0] : [1, 0, 0];
            const v = n[2] ? [0, 1, 0] : [0, 0, 1];
            [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]].forEach(([a, b]) => {
                verts.push(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2], n[0], n[1], n[2], (a + 1) / 2, (b + 1) / 2);
            });
        });
        const cubeBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW);
        const dots = new Float32Array(MAX_DOTS * 4);
        const dotBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
        gl.bufferData(gl.ARRAY_BUFFER, dots.byteLength, gl.DYNAMIC_DRAW);
        const pointMax = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) || [1, 64])[1] || 64;

        let phase = 'idle', tone = 'unique', phaseAt = performance.now(), burstAt = -1e9, anchor = null;
        let raf = 0, disposed = false, last = performance.now(), ang = 0, dpr = 1;
        canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); disposed = true; cancelAnimationFrame(raf); });

        function cube(rot, scale, spread, alpha, glow, color, cx, cy, sw, sh, t) {
            if (alpha <= 0.003) return;
            gl.uniform3f(cl.rot, rot[0], rot[1], rot[2]);
            gl.uniform1f(cl.scale, scale);
            gl.uniform1f(cl.spread, spread);
            gl.uniform2f(cl.center, cx, cy);
            gl.uniform2f(cl.size, sw, sh);
            gl.uniform3f(cl.color, color[0], color[1], color[2]);
            gl.uniform1f(cl.alpha, alpha);
            gl.uniform1f(cl.time, t);
            gl.uniform1f(cl.glow, glow);
            gl.drawArrays(gl.TRIANGLES, 0, 36);
        }
        function mix(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

        function draw(now) {
            const w = canvas.clientWidth, hgt = canvas.clientHeight;
            if (!w || !hgt) return;
            dpr = Math.min(2, window.devicePixelRatio || 1);
            const pw = Math.round(w * dpr), ph = Math.round(hgt * dpr);
            if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
            gl.viewport(0, 0, pw, ph);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            if (!anchor || !anchor.isConnected) return;
            const box = anchor.getBoundingClientRect(), cv = canvas.getBoundingClientRect();
            if (!box.width) return;
            const motion = !reducedQuery.matches;
            const t = now / 1000, age = (now - phaseAt) / 1000, dt = Math.min(0.05, (now - last) / 1000);
            last = now;
            const cx = box.left - cv.left + box.width / 2, cy = box.top - cv.top + box.height / 2;
            const R = Math.min(box.width, box.height) / 2;
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE);

            // 큐브
            let speed = 0.45, scale = 1, spread = 0, alpha = 0.85, glow = 0.2, color = C_IDLE;
            const toneColor = tone === 'unique' ? C_GOLD : C_IVORY;
            if (phase === 'charge') {
                const k = Math.min(age / 1.3, 1);
                speed = 0.45 + k * 5.2;
                scale = 1 - 0.16 * k + (motion ? 0.016 * Math.sin(age * 40) * k : 0);
                glow = 0.25 + 0.75 * k;
                alpha = 1;
                color = mix(C_IDLE, C_HOT, k);
            } else if (phase === 'burst') {
                speed = 6;
                spread = (1 - Math.exp(-age * 5)) * 2.6;
                alpha = Math.max(0, 1 - age / 0.5);
                glow = 1;
                scale = 1.08;
                color = toneColor;
            } else if (phase === 'after') alpha = 0;
            if (motion) ang += speed * dt;
            if (phase !== 'after' && phase !== 'hidden') {
                gl.useProgram(cubeP);
                gl.disableVertexAttribArray(dl.dot);
                gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
                gl.enableVertexAttribArray(cl.pos); gl.vertexAttribPointer(cl.pos, 3, gl.FLOAT, false, 32, 0);
                gl.enableVertexAttribArray(cl.nrm); gl.vertexAttribPointer(cl.nrm, 3, gl.FLOAT, false, 32, 12);
                gl.enableVertexAttribArray(cl.uv); gl.vertexAttribPointer(cl.uv, 2, gl.FLOAT, false, 32, 24);
                const ndcX = cx / w * 2 - 1, ndcY = 1 - cy / hgt * 2;
                const sw = R * 0.4 / w * 2, sh = R * 0.4 / hgt * 2;
                const a0 = motion ? ang : 0.6;
                cube([a0 * 0.55 + 0.52, a0, 0.22], scale, spread, alpha, glow, color, ndcX, ndcY, sw, sh, t);
                cube([-a0 * 0.8, -a0 * 1.3 + 0.785, 0.6], scale * 0.48, spread * 1.5, alpha * 0.75, glow, mix(color, C_HOT, 0.4), ndcX, ndcY, sw, sh, t);
                gl.disableVertexAttribArray(cl.pos); gl.disableVertexAttribArray(cl.nrm); gl.disableVertexAttribArray(cl.uv);
            }
            if (!motion) return;

            // 빛 입자
            let n = 0;
            const put = (x, y, size, a) => {
                if (n >= MAX_DOTS || a <= 0.004) return;
                const o = n * 4;
                dots[o] = x; dots[o + 1] = y; dots[o + 2] = Math.min(size, pointMax / dpr); dots[o + 3] = Math.min(1, a);
                n++;
            };
            let dotColor = C_IDLE;
            if (phase === 'idle') {
                for (let i = 0; i < 26; i++) {
                    const a = i * 2.39996 + t * (0.12 + 0.1 * hash(i)) * (i % 2 ? 1 : -1);
                    const rr = R * (0.62 + 0.5 * hash(i + 3));
                    const rise = (t * 0.06 + hash(i + 9)) % 1;
                    put(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.42 + R * 0.35 - rise * R * 1.1, 1.4 + 2.2 * hash(i + 5), Math.sin(rise * Math.PI) * 0.5);
                }
            } else if (phase === 'charge') {
                dotColor = C_HOT;
                const fade = Math.min(1, age * 2);
                for (let i = 0; i < 80; i++) {
                    const p = (age * 1.25 + hash(i)) % 1;
                    const rr = R * (0.18 + 1.4 * Math.pow(1 - p, 1.6));
                    const a = i * 2.39996 + p * 2.2 + t * 0.6;
                    put(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.2 + 2.6 * p, fade * (0.2 + 0.8 * p));
                }
            } else {
                dotColor = toneColor;
                if (phase === 'after' && anchor) {
                    const fr = Math.max(box.width, box.height) * 0.62;
                    for (let i = 0; i < (tone === 'unique' ? 64 : 36); i++) {
                        const rise = (t * 0.08 + hash(i)) % 1;
                        put(cx + (hash(i + 3) - 0.5) * fr * 2.2 + Math.sin(t * 0.7 + i) * 8, cy + fr * 0.9 - rise * fr * 2,
                            1.2 + 2.4 * hash(i + 6), Math.sin(rise * Math.PI) * (tone === 'unique' ? 0.8 : 0.45));
                    }
                }
            }
            // 충돌 파편은 공개 단계까지 이어서 흩어진다 (중심은 충돌 지점에 고정)
            const bAge = (now - burstAt) / 1000;
            if (bAge >= 0 && bAge < 2) {
                const bx = burst.x, by = burst.y, br = burst.r;
                if (bAge < 0.3) put(bx, by, br * 1.6, (1 - bAge / 0.3) * 0.9);
                const count = tone === 'unique' ? 150 : 90;
                for (let i = 0; i < count; i++) {
                    const life = 0.9 + 0.9 * hash(i + 2), k = bAge / life;
                    if (k >= 1) continue;
                    const d = br * (1.1 + 2.8 * hash(i)) * (1 - Math.exp(-bAge * 3.2));
                    const a = i * 2.39996 + hash(i + 1) * 0.4;
                    put(bx + Math.cos(a) * d, by + Math.sin(a) * d + 40 * bAge * bAge, (1.2 + 3 * hash(i + 4)) * (1 - k * 0.5), 1 - k);
                }
            }
            if (!n) return;
            gl.useProgram(dotP);
            gl.bindBuffer(gl.ARRAY_BUFFER, dotBuf);
            gl.bufferSubData(gl.ARRAY_BUFFER, 0, dots.subarray(0, n * 4));
            gl.enableVertexAttribArray(dl.dot);
            gl.vertexAttribPointer(dl.dot, 4, gl.FLOAT, false, 0, 0);
            gl.uniform2f(dl.view, w, hgt);
            gl.uniform1f(dl.dpr, dpr);
            gl.uniform3f(dl.color, dotColor[0], dotColor[1], dotColor[2]);
            gl.drawArrays(gl.POINTS, 0, n);
            gl.disableVertexAttribArray(dl.dot);
        }
        const burst = { x: 0, y: 0, r: 0 };
        function frame(now) {
            raf = 0;
            if (disposed) return;
            draw(now);
            if (!reducedQuery.matches && !document.hidden) raf = requestAnimationFrame(frame);
        }
        function wake() { if (!disposed && !raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }
        return {
            setAnchor(el) { anchor = el; wake(); },
            setPhase(p, t) {
                if (p === 'burst' && anchor && anchor.isConnected) {
                    const box = anchor.getBoundingClientRect(), cv = canvas.getBoundingClientRect();
                    burst.x = box.left - cv.left + box.width / 2;
                    burst.y = box.top - cv.top + box.height / 2;
                    burst.r = Math.min(box.width, box.height) / 2;
                    burstAt = performance.now();
                }
                if (p === 'idle') burstAt = -1e9;
                phase = p;
                if (t) tone = t;
                phaseAt = performance.now();
                wake();
            },
            wake,
            destroy() {
                disposed = true;
                cancelAnimationFrame(raf);
                const ext = gl.getExtension('WEBGL_lose_context');
                if (ext) ext.loseContext();
            }
        };
    }

    // ---------- 모델 정리 ----------
    function normModel(m) {
        m = m || {};
        const guaranteedAt = Math.max(1, Math.round(Number(m.guaranteedAt) || 15));
        return {
            version: sid(m.version),
            attempts: Math.max(0, Math.min(guaranteedAt - 1, Math.round(Number(m.attempts) || 0))),
            guaranteedAt,
            characters: arr(m.characters).filter(c => c && c.id != null),
            cubes: arr(m.cubes).filter(c => c && c.id != null),
            avatars: arr(m.avatars).filter(a => a && a.id != null),
            blockedReason: m.blockedReason ? String(m.blockedReason) : null
        };
    }

    // ---------- 합성 화면 ----------
    function createInstance(rawModel, actions) {
        const s = {
            model: normModel(rawModel), materials: [], cubeId: rawModel?.initialCubeId ?? null, characterId: null, filter: 'all',
            busy: false, view: 'setup', error: '', hint: '', stale: false, timers: [],
            settled: false, impacted: false, result: null, reveal: null
        };
        const prevFocus = document.activeElement;

        const later = (ms, fn) => {
            const id = setTimeout(() => { s.timers = s.timers.filter(t => t !== id); if (!s.stale) fn(); }, ms);
            s.timers.push(id);
        };
        const clearTimers = () => { s.timers.forEach(clearTimeout); s.timers = []; };
        const findAvatar = id => s.model.avatars.find(a => sid(a.id) === sid(id)) || null;
        const findCube = id => s.model.cubes.find(c => sid(c.id) === sid(id)) || null;
        const findChar = id => s.model.characters.find(c => sid(c.id) === sid(id)) || null;
        const isPity = () => s.model.attempts >= s.model.guaranteedAt - 1;

        function reconcile() {
            s.materials = s.materials.filter(id => findAvatar(id));
            const cube = findCube(s.cubeId);
            if (!cube || Number(cube.count) <= 0) {
                const owned = s.model.cubes.find(c => Number(c.count) > 0);
                if (owned || !cube) s.cubeId = owned ? owned.id : (s.model.cubes[0] ? s.model.cubes[0].id : null);
            }
            if (!findChar(s.characterId)) s.characterId = s.model.characters.length === 1 ? s.model.characters[0].id : null;
        }
        reconcile();

        // ----- 뼈대 -----
        const overlay = h('div', 'ua-overlay');
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        const titleId = uid();
        overlay.setAttribute('aria-labelledby', titleId);
        overlay.dataset.view = 'setup';
        const canvas = h('canvas', 'ua-gl');
        canvas.setAttribute('aria-hidden', 'true');
        const shell = h('div', 'ua-shell');
        const live = h('div', 'ua-sr');
        live.setAttribute('aria-live', 'polite');

        const top = h('header', 'ua-top');
        const titleBox = h('div', 'ua-title');
        const title = h('h2', 'ua-title-text', '바인드 큐브 합성');
        title.id = titleId;
        title.tabIndex = -1;
        titleBox.append(title, h('p', 'ua-title-sub', '아바타 2개를 새 아바타 1개로'));
        const topActs = h('div', 'ua-top-actions');
        const shopBtn = btn('ua-btn ua-btn-line ua-shop', '큐브 구매', () => call(actions.shop));
        shopBtn.hidden = typeof actions.shop !== 'function';
        const closeBtn = btn('ua-x', null, requestClose);
        closeBtn.setAttribute('aria-label', '합성 닫기');
        closeBtn.append(icon('x'));
        topActs.append(shopBtn, closeBtn);
        top.append(titleBox, topActs);

        const body = h('div', 'ua-body');

        // 합성실: 결과 캐릭터 투영 + 제단(재료 칸 | 큐브 | 재료 칸) + 캐릭터 필름
        const chamber = h('section', 'ua-chamber');
        chamber.setAttribute('aria-label', '합성 제단');
        const destiny = h('div', 'ua-destiny');
        destiny.setAttribute('aria-hidden', 'true');
        const floor = h('div', 'ua-floor');
        floor.setAttribute('aria-hidden', 'true');
        const stage = h('div', 'ua-stage');
        const slots = [0, 1].map(i => {
            const b = btn('ua-slot', null, () => {
                if (s.materials[i] != null) { const a = findAvatar(s.materials[i]); s.materials.splice(i, 1); s.error = ''; sound.play('release'); announce('재료 ' + (i + 1) + ' 비움' + (a ? ': ' + a.name : '')); syncSetup(); }
                else focusDrawer();
            });
            b.dataset.slot = String(i);
            b.dataset.id = '';
            const label = h('span', 'ua-slot-label', '재료 ' + (i + 1));
            const inner = h('span', 'ua-slot-inner');
            b.append(label, inner);
            return { el: b, inner, label };
        });
        const core = h('div', 'ua-core');
        const coreLight = h('span', 'ua-core-light');
        coreLight.setAttribute('aria-hidden', 'true');
        const coreFrame = h('span', 'ua-core-frame');
        coreFrame.setAttribute('aria-hidden', 'true');
        const beamA = h('span', 'ua-beam is-a'), beamB = h('span', 'ua-beam is-b');
        beamA.setAttribute('aria-hidden', 'true'); beamB.setAttribute('aria-hidden', 'true');
        const coreIcon = h('span', 'ua-core-icon');
        coreIcon.setAttribute('aria-hidden', 'true');
        core.append(coreLight, beamA, beamB, coreFrame, coreIcon);
        stage.append(slots[0].el, core, slots[1].el);

        // 우측(모바일은 아래) 정보 레일
        const rail = h('div', 'ua-rail');
        const pity = panel('유니크 확정 게이지', 'ua-pity');
        const pityMeta = h('span', 'ua-panel-meta');
        pity.head.append(pityMeta);
        const pips = h('div', 'ua-pips');
        pips.setAttribute('role', 'progressbar');
        pips.setAttribute('aria-label', '유니크 확정 게이지');
        const pityNote = h('p', 'ua-pity-note');
        const pityBig = h('p', 'ua-pity-big');
        const pityNum = h('b'), pityUnit = h('span');
        pityBig.append(pityNum, pityUnit);
        pityBig.setAttribute('aria-hidden', 'true');
        pity.el.append(pityBig, pips, pityNote);

        const cubes = panel('바인드 큐브', 'ua-cubes-panel');
        const cubeRow = h('div', 'ua-cubes');
        cubeRow.setAttribute('role', 'group');
        cubeRow.setAttribute('aria-label', '사용할 바인드 큐브');
        cubes.el.append(cubeRow);

        const outcome = panel('합성 결과', 'ua-outcome-panel');
        const outRows = h('div', 'ua-outcome');
        const outNormal = outcomeRow('normal', '일반 아바타');
        const outUnique = outcomeRow('unique', '유니크 아바타');
        const uStats = h('ul', 'ua-out-stats');
        UNIQUE_STATS.forEach(([k, v]) => { const li = h('li'); li.append(h('span', null, k), h('b', null, v)); uStats.append(li); });
        const optLi = h('li', 'is-wide');
        optLi.append(h('span', null, '추가 옵션'), h('b', null, UNIQUE_OPTION_COUNT + '종 중 1종 선택'));
        uStats.append(optLi);
        outUnique.el.append(uStats);
        outRows.append(outUnique.el, outNormal.el);
        outcome.el.append(outRows);
        rail.append(cubes.el, pity.el, outcome.el);

        // 결과 캐릭터
        const chars = panel('결과 캐릭터', 'ua-chars-panel');
        chars.head.append(h('span', 'ua-panel-meta', '재료와 상관없이 고른 캐릭터의 아바타가 나옵니다'));
        const charRow = h('div', 'ua-chars');
        charRow.setAttribute('role', 'group');
        charRow.setAttribute('aria-label', '결과 캐릭터 선택');
        chars.el.append(charRow);
        chamber.append(floor, destiny, stage, chars.el);

        // 재료 서랍
        const drawer = panel('재료 아바타', 'ua-drawer');
        const drawerMeta = h('span', 'ua-panel-meta');
        drawer.head.append(drawerMeta);
        const filterRow = h('div', 'ua-filter');
        filterRow.setAttribute('role', 'group');
        filterRow.setAttribute('aria-label', '등급 필터');
        const grid = h('div', 'ua-grid');
        grid.setAttribute('role', 'group');
        grid.setAttribute('aria-label', '재료로 쓸 아바타. 2개를 고르세요');
        drawer.el.append(filterRow, grid);

        body.append(chamber, rail, drawer.el);

        // 하단 실행 줄
        const cta = h('footer', 'ua-cta');
        const ctaCopy = h('div', 'ua-cta-copy');
        const ctaCost = h('strong', 'ua-cta-cost');
        const ctaHint = h('span', 'ua-cta-hint');
        const ctaWarn = h('span', 'ua-cta-warn');
        const ctaError = h('div', 'ua-error');
        ctaError.setAttribute('role', 'alert');
        ctaCopy.append(ctaCost, ctaHint, ctaWarn, ctaError);
        const goBtn = btn('ua-go', null, submit);
        const goLabel = h('span', 'ua-go-label', '합성하기');
        const goSub = h('span', 'ua-go-sub');
        const goMark = h('span', 'ua-go-mark');
        goMark.setAttribute('aria-hidden', 'true');
        goBtn.append(goMark, h('span', 'ua-go-text'));
        goBtn.lastChild.append(goLabel, goSub);
        cta.append(ctaCopy, goBtn);

        shell.append(top, body, cta);

        const revealHost = h('div', 'ua-reveal-host');
        const skipBtn = btn('ua-skip', null, skip);
        skipBtn.append(h('span', null, '연출 건너뛰기'), icon('skip'));
        skipBtn.hidden = true;
        overlay.append(shell, revealHost, canvas, skipBtn, live);

        function panel(text, cls) {
            const el = h('section', 'ua-panel ' + cls);
            const head = h('header', 'ua-panel-head');
            const t = h('h3', 'ua-h', text);
            t.id = uid();
            el.setAttribute('aria-labelledby', t.id);
            head.append(t);
            el.append(head);
            return { el, head };
        }
        function outcomeRow(kind, label) {
            const el = h('div', 'ua-out');
            el.dataset.kind = kind;
            const desc = h('span', 'ua-out-desc');
            el.append(h('span', 'ua-out-name', label), desc);
            return { el, desc };
        }
        function announce(text) { live.textContent = ''; live.textContent = text; }
        function focusDrawer() {
            drawer.el.scrollIntoView({ block: 'nearest', behavior: reducedQuery.matches ? 'auto' : 'smooth' });
            const first = grid.querySelector('.ua-item:not(:disabled)');
            if (first) first.focus({ preventScroll: true });
        }

        // ----- 목록 다시 그리기 (모델이 바뀔 때) -----
        function buildCubes() {
            cubeRow.replaceChildren();
            if (!s.model.cubes.length) { cubeRow.append(h('p', 'ua-empty', '사용할 수 있는 큐브가 없습니다.')); return; }
            s.model.cubes.forEach(c => {
                const b = btn('ua-cube', null, () => { if (sid(s.cubeId) === sid(c.id)) return; s.cubeId = c.id; s.error = ''; sound.play('select'); syncSetup(); });
                b.dataset.id = sid(c.id);
                const count = Math.max(0, Math.round(Number(c.count) || 0));
                const well = h('span', 'ua-cube-well');
                well.setAttribute('aria-hidden', 'true');
                well.append(art('ua-cube-icon', c.iconUrl, '', true), h('span', 'ua-cube-count' + (count ? '' : ' is-empty'), '×' + fmt(count)));
                b.append(well, h('span', 'ua-cube-name', c.name || '바인드 큐브'));
                b.setAttribute('aria-label', (c.name || '바인드 큐브') + ', 보유 ' + fmt(count) + '개');
                cubeRow.append(b);
            });
        }
        function buildChars() {
            charRow.replaceChildren();
            if (!s.model.characters.length) { charRow.append(h('p', 'ua-empty', '고를 수 있는 캐릭터가 없습니다.')); return; }
            s.model.characters.forEach(c => {
                const b = btn('ua-char', null, () => { if (sid(s.characterId) === sid(c.id)) return; s.characterId = c.id; s.error = ''; sound.play('select'); announce('결과 캐릭터: ' + c.name); syncSetup(); });
                b.dataset.id = sid(c.id);
                const mark = h('span', 'ua-check');
                mark.append(icon('check'));
                const pic = art('ua-char-art', c.portraitUrl || c.imageUrl, '', false, c.name);
                pic.append(mark);
                b.append(pic, h('span', 'ua-char-name', c.name || ''));
                b.setAttribute('aria-label', (c.name || '') + ' 캐릭터');
                charRow.append(b);
            });
        }
        function buildFilter() {
            filterRow.replaceChildren();
            const counts = {};
            s.model.avatars.forEach(a => { const k = gradeKey(a.grade, a.name); counts[k] = (counts[k] || 0) + 1; });
            const keys = GRADE_KEYS.filter(([k]) => counts[k]);
            if (counts.other) keys.push(['other', '기타']);
            if (s.filter !== 'all' && !counts[s.filter]) s.filter = 'all';
            if (keys.length < 2) { filterRow.hidden = true; return; }
            filterRow.hidden = false;
            [['all', '전체']].concat(keys).forEach(([k, label]) => {
                const b = btn('ua-tab', null, () => { if (s.filter === k) return; s.filter = k; sound.play('select'); buildFilter(); buildGrid(); syncSetup(); });
                b.dataset.grade = k;
                b.append(h('span', null, label), h('span', 'ua-tab-n', fmt(k === 'all' ? s.model.avatars.length : counts[k])));
                b.setAttribute('aria-pressed', String(s.filter === k));
                filterRow.append(b);
            });
        }
        function buildGrid() {
            grid.replaceChildren();
            drawerMeta.textContent = '보유 ' + fmt(s.model.avatars.length) + '개';
            const list = s.model.avatars.filter(a => s.filter === 'all' || gradeKey(a.grade, a.name) === s.filter);
            if (!list.length) {
                const empty = h('div', 'ua-empty-box');
                empty.append(h('strong', null, s.model.avatars.length ? '이 등급의 아바타가 없습니다' : '재료로 쓸 아바타가 없습니다'), h('span', null, '아바타 2개가 있어야 합성할 수 있습니다.'));
                grid.append(empty);
                return;
            }
            list.forEach(a => {
                const b = btn('ua-item', null, () => toggleMaterial(a));
                b.dataset.id = sid(a.id);
                b.dataset.grade = gradeKey(a.grade, a.name);
                const mark = h('span', 'ua-check');
                mark.append(icon('check'));
                const pic = art('ua-item-art', synthesisAvatarImage(a), '', false, a.name);
                pic.append(mark);
                const meta = h('span', 'ua-item-meta', joinMeta(a.equipped ? '장착 중' : '', tradesText(a.remainingTrades)));
                pic.append(h('span', 'ua-item-order'));
                b.append(pic, h('span', 'ua-item-name', a.name || ''), meta);
                b.title = a.name || '';
                grid.append(b);
            });
        }
        function rebuild() { buildCubes(); buildChars(); buildFilter(); buildGrid(); }

        function toggleMaterial(a) {
            const id = sid(a.id);
            const at = s.materials.findIndex(m => sid(m) === id);
            s.error = '';
            if (at >= 0) {
                s.materials.splice(at, 1);
                sound.play('release');
                announce('재료 해제: ' + a.name);
            } else if (s.materials.length >= 2) {
                s.hint = '재료 칸이 가득 찼습니다. 재료 칸이나 선택한 아바타를 눌러 비우세요.';
                stage.classList.remove('is-full-shake');
                void stage.offsetWidth;
                stage.classList.add('is-full-shake');
                sound.play('error');
                announce(s.hint);
            } else {
                s.materials.push(a.id);
                sound.play('slot');
                announce('재료 ' + s.materials.length + ': ' + a.name);
            }
            syncSetup();
            s.hint = '';
        }

        function fillSlot(slot, a, i) {
            const id = a ? sid(a.id) : '';
            slot.el.classList.toggle('is-filled', !!a);
            slot.el.dataset.grade = a ? gradeKey(a.grade, a.name) : '';
            slot.el.setAttribute('aria-label', a ? '재료 ' + (i + 1) + ': ' + a.name + '. 눌러서 비우기' : '재료 ' + (i + 1) + ' 비어 있음. 눌러서 아바타 고르기');
            if (slot.el.dataset.id === id) return;
            slot.el.dataset.id = id;
            slot.inner.replaceChildren();
            if (!a) {
                const empty = h('span', 'ua-slot-empty');
                empty.append(icon('plus'), h('span', null, '아바타 선택'));
                slot.inner.append(empty);
                return;
            }
            slot.inner.append(art('ua-slot-art', synthesisAvatarImage(a), '', true, a.name), h('span', 'ua-slot-name', a.name || ''));
            const x = h('span', 'ua-slot-x');
            x.setAttribute('aria-hidden', 'true');
            x.append(icon('x'));
            slot.inner.append(x);
            slot.el.classList.remove('is-land');
            void slot.el.offsetWidth;
            slot.el.classList.add('is-land');
        }

        function blockReason() {
            if (s.model.blockedReason) return s.model.blockedReason;
            if (s.materials.length < 2) return '재료 아바타 2개를 고르세요 (' + s.materials.length + '/2)';
            const cube = findCube(s.cubeId);
            if (!cube) return '바인드 큐브를 고르세요';
            if (Number(cube.count) <= 0) return (cube.name || '바인드 큐브') + '가 없습니다. 상점에서 구매할 수 있습니다';
            if (!findChar(s.characterId)) return '결과 캐릭터를 고르세요';
            return '';
        }

        function syncSetup() {
            const m = s.model;
            const cube = findCube(s.cubeId);
            const pityOn = isPity();
            const ch = findChar(s.characterId);
            const sel = s.materials.map(findAvatar);

            slots.forEach((slot, i) => fillSlot(slot, sel[i], i));
            stage.classList.toggle('has-a', !!sel[0]);
            stage.classList.toggle('has-b', !!sel[1]);
            stage.classList.toggle('is-ready', sel.length === 2);

            const iconUrl = cube && cube.iconUrl ? sid(cube.iconUrl) : '';
            if (coreIcon.dataset.src !== iconUrl) {
                coreIcon.dataset.src = iconUrl;
                coreIcon.replaceChildren(art('ua-core-img', iconUrl, cube ? cube.name : '', true));
                goMark.replaceChildren(art('ua-go-cube', iconUrl, '', true));
            }
            core.classList.toggle('is-pity', pityOn);
            chamber.classList.toggle('is-pity', pityOn);
            // 고른 캐릭터의 전신을 큐브 뒤에 투영한다
            const destinyUrl = ch ? sid(ch.portraitUrl || ch.imageUrl) : '';
            if (destiny.dataset.src !== destinyUrl) {
                destiny.dataset.src = destinyUrl;
                destiny.replaceChildren();
                if (destinyUrl) destiny.append(art('ua-destiny-art', destinyUrl, '', true));
                destiny.classList.remove('is-in');
                void destiny.offsetWidth;
                destiny.classList.add('is-in');
            }

            // 확정 게이지
            if (pips.childElementCount !== m.guaranteedAt) {
                pips.replaceChildren();
                for (let i = 0; i < m.guaranteedAt; i++) pips.append(h('i', i === m.guaranteedAt - 1 ? 'is-cap' : null));
            }
            [...pips.children].forEach((p, i) => {
                p.classList.toggle('is-on', i < m.attempts);
                p.classList.toggle('is-next', i === m.attempts);
            });
            pips.setAttribute('aria-valuemin', '0');
            pips.setAttribute('aria-valuemax', String(m.guaranteedAt - 1));
            pips.setAttribute('aria-valuenow', String(m.attempts));
            const remain = m.guaranteedAt - m.attempts;
            pips.setAttribute('aria-valuetext', pityOn ? '다음 합성 유니크 확정' : '연속 실패 ' + m.attempts + '회, 확정까지 ' + remain + '회');
            pityMeta.textContent = '계정 공용 · 진행 ' + m.attempts + '칸';
            pityNum.textContent = pityOn ? '다음' : String(remain);
            pityUnit.textContent = pityOn ? '합성 유니크 확정' : '회 안에 유니크 확정';
            pity.el.classList.toggle('is-pity', pityOn);
            pityNote.textContent = pityOn
                ? '다음 합성은 큐브 종류와 상관없이 유니크 아바타가 나옵니다.'
                : '유니크가 나오지 않을 때마다 한 칸씩 오르고, 유니크가 나오면 처음부터 다시 셉니다.';

            [...cubeRow.querySelectorAll('.ua-cube')].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === sid(s.cubeId))));
            [...charRow.querySelectorAll('.ua-char')].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === sid(s.characterId))));

            const charName = ch ? ch.name : '고른 캐릭터';
            outUnique.desc.textContent = charName + ' 유니크 아바타' + (pityOn ? ' (다음 합성 확정)' : '');
            outNormal.desc.textContent = charName + ' 일반 아바타';
            outNormal.el.classList.toggle('is-off', pityOn);

            const full = s.materials.length >= 2;
            grid.classList.toggle('is-full', full);
            [...grid.querySelectorAll('.ua-item')].forEach(b => {
                const at = s.materials.findIndex(id => sid(id) === b.dataset.id);
                b.setAttribute('aria-pressed', String(at >= 0));
                b.querySelector('.ua-item-order').textContent = at >= 0 ? String(at + 1) : '';
                const a = findAvatar(b.dataset.id);
                b.setAttribute('aria-label', (a ? a.name + ', ' + (a.grade || '') : '') + (a && a.equipped ? ', 장착 중' : '') + (at >= 0 ? ', 재료 ' + (at + 1) + '로 선택됨' : ''));
            });

            // 실행 줄
            const reason = blockReason();
            const cubeName = cube ? (cube.name || '바인드 큐브') : '바인드 큐브';
            ctaCost.textContent = '재료 아바타 2개 + ' + cubeName + ' 1개 소모';
            ctaHint.textContent = s.hint || (reason || (sel[0].name + ', ' + sel[1].name + ' 아바타가 사라지고 ' + charName + ' 아바타 1개를 얻습니다.'));
            ctaHint.classList.toggle('is-warn', !!s.hint || (!!reason && !!m.blockedReason));
            const eq = sel.filter(a => a && a.equipped).length;
            ctaWarn.textContent = eq ? '장착 중인 아바타가 재료에 포함되어 있습니다.' : '';
            ctaWarn.hidden = !eq;
            ctaError.textContent = s.error;
            ctaError.hidden = !s.error;
            goBtn.disabled = s.busy || !!reason || s.view !== 'setup';
            goBtn.classList.toggle('is-busy', s.busy);
            goLabel.textContent = s.busy ? '합성 중…' : '합성하기';
            goSub.textContent = s.busy ? '서버 결과를 기다리는 중' : (pityOn ? '다음 합성 유니크 확정' : '유니크 확정까지 ' + remain + '회');
            cta.classList.toggle('is-ready', !reason && !s.busy);
            cta.classList.toggle('is-blocked', !!m.blockedReason);

            body.inert = s.busy;
            shell.inert = s.view !== 'setup';
            body.setAttribute('aria-busy', String(s.busy));
            closeBtn.disabled = s.busy;
            shopBtn.disabled = s.busy;
            overlay.classList.toggle('is-busy', s.busy);
        }

        // ----- 합성 요청 -----
        async function submit() {
            if (s.busy || s.view !== 'setup' || blockReason()) return;
            const payload = { cubeId: s.cubeId, avatarIds: s.materials.slice(0, 2), characterId: s.characterId };
            s.busy = true;
            s.error = '';
            syncSetup();
            const started = performance.now();
            overlay.classList.add('is-charging');
            if (glCore) glCore.setPhase('charge');
            sound.play('charge');
            announce('합성 중입니다.');
            let res = null, failure = null;
            try { res = await call(actions.synthesize, payload); } catch (err) { failure = err || new Error(''); }
            if (s.stale) return;
            const ok = !failure && res && res.result && res.result.avatar;
            if (!ok) {
                s.busy = false;
                overlay.classList.remove('is-charging');
                if (glCore) glCore.setPhase('idle');
                sound.stop();
                sound.play('error');
                s.error = (failure && failure.message) ? String(failure.message) : '합성하지 못했습니다. 재료와 큐브는 그대로입니다. 다시 시도해 주세요.';
                syncSetup();
                announce(s.error);
                if (!goBtn.disabled) goBtn.focus({ preventScroll: true });
                return;
            }
            s.busy = false;
            s.materials = [];
            if (res.state) { s.model = normModel(res.state); reconcile(); rebuild(); }
            startReveal(res.result, performance.now() - started);
        }

        // ----- 결과 공개 -----
        function startReveal(result, elapsed) {
            s.view = 'reveal';
            s.settled = false;
            s.impacted = false;
            s.result = result;
            overlay.dataset.view = 'reveal';
            syncSetup();
            skipBtn.hidden = false;
            skipBtn.focus({ preventScroll: true });
            if (reducedQuery.matches) { impact(); settle(); return; }
            later(Math.max(0, HOLD_MIN - elapsed), impact);
        }
        function impact() {
            if (s.impacted) return;
            s.impacted = true;
            const unique = !!s.result.unique;
            const tone = unique ? 'unique' : 'normal';
            overlay.classList.remove('is-charging');
            s.reveal = buildReveal(s.result);
            revealHost.replaceChildren(s.reveal.el);
            overlay.dataset.tone = tone;
            overlay.classList.remove('is-impact');
            void overlay.offsetWidth;
            overlay.classList.add('is-impact');
            if (glCore) glCore.setPhase('burst', tone);
            sound.play(unique ? 'unique' : 'impact');
            later(OPEN_AT, () => { if (glCore && s.reveal) { glCore.setAnchor(s.reveal.frame); glCore.setPhase('after', tone); } });
            later(REVEAL_END, settle);
        }
        function settle() {
            if (s.settled || !s.reveal) return;
            s.settled = true;
            clearTimers();
            s.reveal.el.classList.add('is-settled');
            overlay.classList.remove('is-impact');
            skipBtn.hidden = true;
            if (glCore) { glCore.setAnchor(s.reveal.frame); glCore.setPhase('after', s.result.unique ? 'unique' : 'normal'); }
            const av = s.result.avatar || {};
            announce((s.result.unique ? '유니크 아바타 획득: ' : '아바타 획득: ') + (av.name || ''));
            s.reveal.primary.focus({ preventScroll: true });
        }
        function skip() {
            if (s.view !== 'reveal' || s.settled) return;
            if (!s.impacted) impact();
            settle();
        }
        function backToSetup() {
            clearTimers();
            s.view = 'setup';
            s.reveal = null;
            s.result = null;
            revealHost.replaceChildren();
            overlay.dataset.view = 'setup';
            delete overlay.dataset.tone;
            overlay.classList.remove('is-impact');
            skipBtn.hidden = true;
            if (glCore) { glCore.setAnchor(core); glCore.setPhase('idle'); }
            syncSetup();
            if (!goBtn.disabled) goBtn.focus({ preventScroll: true });
            else { const first = grid.querySelector('.ua-item'); (first || title).focus({ preventScroll: true }); }
        }

        function buildReveal(result) {
            const av = result.avatar || {};
            const unique = !!result.unique;
            const el = h('section', 'ua-reveal');
            el.dataset.tone = unique ? 'unique' : 'normal';
            const nameId = uid();
            el.setAttribute('aria-labelledby', nameId);
            const seq = (node, ms) => { node.classList.add('ua-seq'); node.style.setProperty('--d', ms + 'ms'); return node; };

            // 화면 전체 섬광만 따로 두고, 광선과 충격파는 액자 중심에 붙인다
            const fx = h('div', 'ua-reveal-fx');
            fx.setAttribute('aria-hidden', 'true');
            fx.append(seq(h('div', 'ua-flash'), 0));

            const card = h('div', 'ua-reveal-card');
            const frame = seq(h('div', 'ua-frame'), 80);
            const halo = h('span', 'ua-frame-fx');
            halo.setAttribute('aria-hidden', 'true');
            if (unique) halo.append(seq(h('span', 'ua-rays'), 380));
            halo.append(seq(h('span', 'ua-shock'), 0), seq(h('span', 'ua-shock is-echo'), 120));
            frame.append(halo);
            const portrait = seq(art('ua-frame-art', av.imageUrl, av.name || '', true), OPEN_AT + 40);
            const glow = seq(h('span', 'ua-aperture-glow'), OPEN_AT - 40);
            const aperture = h('span', 'ua-aperture');
            for (let i = 0; i < 6; i++) {
                const a0 = (i * 60 - 90) * Math.PI / 180, a1 = ((i + 1) * 60 - 90) * Math.PI / 180, mid = (a0 + a1) / 2;
                const p = a => (50 + Math.cos(a) * 160).toFixed(1) + '% ' + (50 + Math.sin(a) * 160).toFixed(1) + '%';
                const blade = seq(h('i', 'ua-blade'), OPEN_AT + i * 18);
                blade.style.clipPath = 'polygon(50% 50%, ' + p(a0 + 0.018) + ', ' + p(a1 - 0.018) + ')';
                blade.style.setProperty('--bx', (Math.cos(mid) * 70).toFixed(1) + '%');
                blade.style.setProperty('--by', (Math.sin(mid) * 70).toFixed(1) + '%');
                aperture.append(blade);
            }
            aperture.setAttribute('aria-hidden', 'true');
            const slit = seq(h('span', 'ua-slit'), OPEN_AT - 120);
            slit.setAttribute('aria-hidden', 'true');
            frame.append(portrait, glow, aperture, slit);
            ['tl', 'tr', 'bl', 'br'].forEach(c => { const k = h('span', 'ua-corner is-' + c); k.setAttribute('aria-hidden', 'true'); frame.append(k); });
            if (unique) { const sheen = seq(h('span', 'ua-frame-sheen'), OPEN_AT + 500); sheen.setAttribute('aria-hidden', 'true'); frame.append(sheen); }

            const info = h('div', 'ua-reveal-info');
            const kicker = seq(h('p', 'ua-reveal-kicker'), 900);
            kicker.append(h('span', null, joinMeta(unique ? '유니크 아바타 획득' : '아바타 획득', result.guaranteed ? '확정 보상' : '')));
            const name = seq(h('h2', 'ua-reveal-name', av.name || ''), 1000);
            name.id = nameId;
            const meta = seq(h('p', 'ua-reveal-meta', av.grade || (unique ? '유니크' : '')), 1100);
            info.append(kicker, name, meta);
            if (unique) {
                const stats = h('ul', 'ua-reveal-stats');
                UNIQUE_STATS.forEach(([k, v], i) => { const li = seq(h('li'), 1200 + i * 90); li.append(h('span', null, k), h('b', null, v)); stats.append(li); });
                const li = seq(h('li', 'is-opt'), 1380);
                li.append(h('span', null, '추가 옵션'), h('b', null, UNIQUE_OPTION_COUNT + '종 중 1종'));
                stats.append(li);
                info.append(stats, seq(h('p', 'ua-reveal-note', '추가 옵션은 아바타 상세 화면에서 고릅니다. 변경은 전투 중이 아닐 때만 가능하고, 효과는 전투에 적용됩니다.'), 1450));
            }
            // 결과 이후 확정 게이지
            const G = s.model.guaranteedAt;
            const n = Number.isFinite(Number(result.attempts)) ? Math.max(0, Math.min(G - 1, Math.round(Number(result.attempts)))) : s.model.attempts;
            const mini = seq(h('div', 'ua-reveal-pity'), 1500);
            const mp = h('div', 'ua-pips is-mini');
            mp.setAttribute('aria-hidden', 'true');
            for (let i = 0; i < G; i++) { const p = h('i', i === G - 1 ? 'is-cap' : null); if (i < n) p.classList.add('is-on'); mp.append(p); }
            mini.append(h('span', null, unique ? '확정 게이지 초기화' : (n >= G - 1 ? '다음 합성 유니크 확정' : '유니크 확정까지 ' + (G - n) + '회')), mp);
            info.append(mini);

            const acts = seq(h('div', 'ua-reveal-actions'), 1600);
            const closeB = btn('ua-btn ua-btn-line', '닫기', requestClose);
            const again = btn('ua-btn ua-btn-gold', '계속 합성', () => { sound.play('select'); backToSetup(); });
            acts.append(closeB, again);
            info.append(acts);

            card.append(frame, info);
            el.append(fx, card);
            return { el, frame, primary: again };
        }

        // ----- 닫기 / 정리 -----
        function requestClose() {
            if (s.busy || s.stale) return;
            destroy();
            if (current === inst) current = null;
            call(actions.close);
        }
        function trapTab(e) {
            const items = [...overlay.querySelectorAll('button, [tabindex="0"]')].filter(b => !b.disabled && !b.closest('[inert]') && !b.closest('[hidden]') && b.getClientRects().length);
            if (!items.length) { e.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            const inside = overlay.contains(document.activeElement);
            if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === title)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
        }
        function onKey(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (s.view === 'reveal' && !s.settled) skip();
                else requestClose();
            } else if (e.key === 'Tab') trapTab(e);
        }
        function onVis() { if (document.hidden) sound.stop(); else if (glCore) glCore.wake(); }
        function onHide() { sound.stop(); }
        function onWake() { if (glCore) glCore.wake(); }

        function destroy() {
            if (s.stale) return;
            s.stale = true;
            clearTimers();
            sound.stop();
            if (glCore) glCore.destroy();
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('pagehide', onHide);
            window.removeEventListener('resize', onWake);
            overlay.removeEventListener('scroll', onWake, true);
            reducedQuery.removeEventListener('change', onWake);
            overlay.remove();
            document.documentElement.classList.remove('ua-locked');
            if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
        }

        // ----- 마운트 -----
        rebuild();
        syncSetup();
        document.body.append(overlay);
        document.documentElement.classList.add('ua-locked');
        const glCore = createCoreGl(canvas);
        if (!glCore) overlay.classList.add('ua-no-gl');
        else glCore.setAnchor(core);
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('pagehide', onHide);
        window.addEventListener('resize', onWake);
        overlay.addEventListener('scroll', onWake, { capture: true, passive: true });
        reducedQuery.addEventListener('change', onWake);
        title.focus({ preventScroll: true });

        const inst = { destroy };
        return inst;
    }

    function open(model, actions) {
        if (current) current.destroy();
        current = null;
        current = createInstance(model, actions || {});
    }
    function close() {
        if (current) current.destroy();
        current = null;
    }

    // ---------- 카드 모달 아바타 보관함 ----------
    function renderWardrobe(root, avatars, actions) {
        if (!root) return;
        actions = actions || {};
        const list = arr(avatars).filter(Boolean);

        const wrap = h('details', 'uaw');
        const head = h('summary', 'uaw-head');
        const body = h('div', 'uaw-body');
        const owned = list.filter(a => a.unlocked).length;
        const titleBox = h('span', 'uaw-title');
        titleBox.append(h('strong', null, '아바타'), h('span', 'uaw-count', '보유 ' + fmt(owned) + ' / ' + fmt(list.length)));
        const toggle = h('span', 'uaw-toggle');
        toggle.append(h('span', 'uaw-expand', '펼치기'), h('span', 'uaw-collapse', '접기'));
        head.append(titleBox, toggle);
        wrap.append(head, body);
        if (typeof actions.synthesis === 'function') {
            const toolbar = h('div', 'uaw-actions');
            const syn = btn('uaw-synth', null, () => actions.synthesis());
            syn.append(icon('cube'), h('span', null, '바인드 큐브 합성'));
            toolbar.append(syn);
            body.append(toolbar);
        }

        // 지금 입고 있는 아바타: 전신을 작은 무대에 세운다
        const worn = list.find(a => a.equipped);
        if (worn) {
            const hero = btn('uaw-hero', null, () => call(actions.select, worn), true);
            hero.dataset.grade = gradeKey(worn.grade, worn.name);
            const spot = h('span', 'uaw-hero-spot');
            spot.setAttribute('aria-hidden', 'true');
            const copy = h('span', 'uaw-hero-copy');
            copy.append(h('span', 'uaw-hero-kicker', '현재 외형'), h('span', 'uaw-hero-name', worn.name || ''), h('span', 'uaw-hero-grade', worn.grade || ''));
            const go = h('span', 'uaw-hero-go', '쇼룸');
            go.setAttribute('aria-hidden', 'true');
            hero.append(spot, art('uaw-hero-art', worn.portraitUrl || worn.imageUrl, '', false, worn.name), copy, go);
            hero.setAttribute('aria-label', '현재 외형 ' + (worn.name || '') + '. 상세 보기');
            body.append(hero);
        }

        const rank = a => (gradeKey(a.grade, a.name) === 'unique' ? 0 : 4) + (a.equipped ? 0 : 2) + (a.unlocked ? 0 : 1);
        const shown = list
            .map((a, i) => ({ a, i }))
            .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
            .map(({ a }) => a);

        const grid = h('div', 'uaw-grid');
        if (!shown.length) grid.append(h('p', 'uaw-empty', '아바타가 없습니다.'));
        shown.forEach(a => {
            const key = gradeKey(a.grade, a.name);
            const t = btn('uaw-tile', null, () => call(actions.select, a), true);
            t.dataset.grade = key;
            t.classList.toggle('is-unique', key === 'unique');
            t.classList.toggle('is-locked', !a.unlocked);
            t.classList.toggle('is-equipped', !!a.equipped);
            t.classList.toggle('is-blocked', !!a.unlocked && a.starOk === false);
            const cnt = Math.round(Number(a.ownedCount) || 0);
            // 카드 원화가 주인공: 상태는 카드 위 표식 하나와 이름 아래 한 줄로만
            const frame = h('span', 'uaw-frame');
            frame.append(art('uaw-art', a.imageUrl, '', false, a.name));
            if (!a.unlocked) { const seal = h('span', 'uaw-seal'); seal.setAttribute('aria-hidden', 'true'); seal.append(icon('lock')); frame.append(seal); }
            if (a.equipped) { const mark = h('span', 'uaw-worn', '장착'); mark.setAttribute('aria-hidden', 'true'); frame.append(mark); }
            if (a.unlocked && cnt > 1) { const q = h('span', 'uaw-qty', '×' + fmt(cnt)); q.setAttribute('aria-hidden', 'true'); frame.append(q); }
            const line = h('span', 'uaw-line');
            line.append(h('span', 'uaw-grade', a.grade || ''));
            let state = '';
            if (!a.unlocked) state = '미보유';
            else if (a.starOk === false && a.requireStarText) state = a.requireStarText + ' 필요';
            else if (a.statApplied) state = '능력치 적용';
            if (state) line.append(h('span', 'uaw-state' + (a.unlocked && a.starOk === false ? ' is-req' : ''), state));
            const info = h('span', 'uaw-info');
            info.append(h('span', 'uaw-name', a.name || ''), line);
            t.append(frame, info);
            const parts = [a.name || '', a.grade || ''];
            parts.push(a.unlocked ? '보유' + (cnt > 1 ? ' ' + cnt + '개' : '') : '미보유');
            if (a.equipped) parts.push('장착 중');
            if (a.statApplied) parts.push('능력치 적용 중');
            if (a.unlocked && a.starOk === false && a.requireStarText) parts.push(a.requireStarText + ' 이상 필요');
            t.setAttribute('aria-label', parts.filter(Boolean).join(', ') + '. 상세 보기');
            grid.append(t);
        });
        body.append(grid);

        root.replaceChildren(wrap);
    }

    // ---------- 아바타 쇼룸 (상세) ----------
    // app.js가 showroom(av, { setOption, apply, buy })로 연다. 서버 호출과 성공 후 닫기는 app.js가 맡고,
    // 실패하면 Error를 던진다. 이 화면은 전시·선택·대기 상태·오류 표시만 한다.
    const SHOP_UNITS = { point: 'P', gold: '골드', garnet: '가넷', mileage: '마일리지' };
    const UNIQUE_TRADE_LIMIT = 3;
    let room = null;

    const tradeLeft = entry => Math.max(0, UNIQUE_TRADE_LIMIT - Number(entry && entry.trades || 0));
    function priceText(p) {
        p = p || {};
        return p.goods === 'item' ? (p.name || '아이템') + ' ' + fmt(p.amount) + '개' : fmt(p.amount) + (SHOP_UNITS[p.goods] ? ' ' + SHOP_UNITS[p.goods] : '');
    }
    // 실제 재화 아이콘 + 수량. 아이콘이 없거나 깨지면 단위 글자로 대신한다
    function priceTag(p) {
        p = p || {};
        const tag = h('span', 'uas-price' + (p.goods === 'item' ? ' is-item' : '') + (p.iconUrl ? '' : ' no-icon'));
        tag.setAttribute('aria-hidden', 'true');
        if (p.iconUrl) {
            const coin = h('span', 'uas-coin');
            const i = document.createElement('img');
            i.alt = '';
            i.decoding = 'async';
            i.draggable = false;
            i.addEventListener('error', () => { coin.remove(); tag.classList.add('no-icon'); });
            i.src = p.iconUrl;
            coin.append(i);
            tag.append(coin);
        }
        tag.append(h('b', 'uas-amount', fmt(p.amount)));
        const unit = p.goods === 'item' ? (p.name || '') : (SHOP_UNITS[p.goods] || '');
        if (unit) tag.append(h('span', 'uas-unit', unit));
        return tag;
    }
    function parseStat(line) {
        const m = String(line).match(/^(.*?)\s*([+-][\d,.]+%?)$/);
        return m && m[1] ? [m[1].trim(), m[2]] : [String(line), ''];
    }

    function createShowroom(av, actions) {
        const key = gradeKey(av.grade, av.name);
        const unique = key === 'unique';
        const instances = arr(av.instances).filter(Boolean);
        const hasFigure = !!av.portraitUrl;
        const hasCine = !!av.cutsceneUrl;
        const s = {
            selected: instances.find(e => e.id === av.selectedAvatarId) || instances[0] || null,
            focus: hasFigure ? 'figure' : 'card', pending: '', busyBtn: null, error: '',
            stale: false, cineUrl: '', cineToken: 0, blob: null
        };
        const prevFocus = document.activeElement;
        const motion = () => !reducedQuery.matches;
        const plainName = String(av.name || '').replace(/^\[[^\]]*\]\s*/, '');

        const root = h('div', 'uas');
        root.dataset.grade = key;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-modal', 'true');
        const nameId = uid();
        root.setAttribute('aria-labelledby', nameId);
        const live = h('div', 'ua-sr');
        live.setAttribute('aria-live', 'polite');

        // ----- 무대 -----
        const stage = h('section', 'uas-stage');
        stage.setAttribute('aria-label', '아바타 전시');
        stage.dataset.focus = s.focus;
        const backdrop = h('div', 'uas-backdrop');
        backdrop.setAttribute('aria-hidden', 'true');
        backdrop.append(h('i', 'uas-spot'), h('i', 'uas-floor'), h('i', 'uas-ring'), h('span', 'uas-mark', plainName));

        let figure = null;
        if (hasFigure) {
            figure = btn('uas-figure', null, () => setFocus('figure'), true);
            figure.setAttribute('aria-label', '전신 크게 보기');
            const mirror = art('uas-figure-mirror', av.portraitUrl, '', true);
            mirror.setAttribute('aria-hidden', 'true');
            figure.append(mirror, art('uas-figure-art', av.portraitUrl, (av.name || '') + ' 전신', true, av.name));
        }

        const cardBtn = btn('uas-card', null, () => setFocus('card'), true);
        cardBtn.setAttribute('aria-label', '카드 크게 보기');
        const tilt = h('span', 'uas-card-tilt avatar-detail-preview' + (unique ? ' is-unique' : ''));
        const glare = h('span', 'uas-glare');
        glare.setAttribute('aria-hidden', 'true');
        tilt.append(art('uas-card-art', av.imageUrl, (av.name || '') + ' 카드', true, av.name), glare);
        cardBtn.append(tilt);
        cardBtn.addEventListener('pointermove', onTilt);
        cardBtn.addEventListener('pointerleave', resetTilt);

        // 컷씬: 고르면 그 자리에서 한 번 재생, 다시 재생은 새 객체 URL로
        let cine = null, screen = null, playBtn = null, replayBtn = null;
        if (hasCine) {
            cine = h('div', 'uas-cine');
            const poster = art('uas-cine-poster', av.portraitUrl || av.imageUrl, '', true);
            poster.setAttribute('aria-hidden', 'true');
            screen = h('div', 'uas-cine-screen');
            playBtn = btn('uas-cine-play', null, () => playCine(), true);
            playBtn.append(icon('play'), h('span', null, '궁극기 컷씬 재생'));
            replayBtn = btn('uas-cine-replay', null, () => playCine(), true);
            replayBtn.append(icon('replay'), h('span', null, '다시 재생'));
            const fail = h('p', 'uas-cine-fail', '컷씬을 불러오지 못했습니다.');
            cine.append(poster, screen, playBtn, replayBtn, fail);
        }

        const lens = h('div', 'uas-lens');
        lens.setAttribute('role', 'group');
        lens.setAttribute('aria-label', '보기 전환');
        const lensBtns = {};
        [['figure', '전신', 'figure', hasFigure], ['card', '카드', 'card', true], ['cine', '컷씬', 'film', hasCine]].forEach(([k, label, ic, on]) => {
            if (!on) return;
            const b = btn('uas-lens-btn', null, () => setFocus(k), true);
            b.dataset.focus = k;
            b.append(icon(ic), h('span', null, label));
            lensBtns[k] = b;
            lens.append(b);
        });
        lens.hidden = Object.keys(lensBtns).length < 2;

        const closeBtn = btn('uas-x', null, requestClose, true);
        closeBtn.setAttribute('aria-label', '아바타 상세 닫기');
        closeBtn.append(icon('x'));

        stage.append(backdrop);
        if (figure) stage.append(figure);
        stage.append(cardBtn);
        if (cine) stage.append(cine);
        stage.append(lens);

        // ----- 정보 패널 -----
        const panel = h('section', 'uas-panel');
        const scroll = h('div', 'uas-scroll');
        const head = h('header', 'uas-head');
        const gradeEl = h('p', 'uas-grade', av.grade || '');
        const name = h('h2', 'uas-name', av.name || '');
        name.id = nameId;
        name.tabIndex = -1;
        const own = h('p', 'uas-own');
        head.append(gradeEl, name, own);
        scroll.append(head);

        const statSec = h('section', 'uas-sec');
        statSec.append(h('h3', 'uas-h', '능력치'));
        const stats = h('div', 'uas-stats');
        const lines = arr(av.statLines);
        if (lines.length) lines.forEach(line => {
            const [k, v] = parseStat(line);
            const row = h('div', 'uas-stat');
            row.append(h('span', 'uas-stat-k', k), h('b', 'uas-stat-v', v));
            stats.append(row);
        });
        else stats.append(h('p', 'uas-stat-none', '추가 스탯 없음'));
        statSec.append(stats);
        if (Number(av.requireStar || 0) > 0) statSec.append(h('p', 'uas-cond' + (av.unlocked && !av.starOk ? ' is-bad' : ''), '장착 조건 · ' + (av.requireStarText || '') + ' 이상'));
        scroll.append(statSec);

        let copies = null;
        if (instances.length > 1) {
            const sec = h('section', 'uas-sec');
            sec.append(h('h3', 'uas-h', '보유 사본'));
            copies = h('div', 'uas-copies');
            copies.setAttribute('role', 'group');
            copies.setAttribute('aria-label', '사용할 아바타 사본');
            instances.forEach((entry, i) => {
                const b = btn('uas-copy', null, () => {
                    if (s.pending || s.selected === entry) return;
                    s.selected = entry;
                    s.error = '';
                    sync();
                    announce('사본 ' + (i + 1) + ' 선택');
                }, true);
                b.dataset.id = sid(entry.id);
                b.append(h('b', null, String(i + 1)), h('span', null, unique ? '거래 ' + tradeLeft(entry) + '회' : '사본'));
                b.setAttribute('aria-label', '사본 ' + (i + 1) + (unique ? ', 거래 가능 ' + tradeLeft(entry) + '회' : ''));
                copies.append(b);
            });
            sec.append(copies);
            scroll.append(sec);
        }

        const optionBox = h('div', 'unique-avatar-options');
        scroll.append(optionBox);

        const notes = h('div', 'uas-notes');
        if (unique && !s.selected && arr(av.uniqueOptions).length) notes.append(h('p', null, '획득하면 추가 옵션 ' + arr(av.uniqueOptions).length + '종 중 1종을 골라 적용합니다.'));
        if (unique) notes.append(h('p', null, '장착하면 궁극기에 유니크 전용 컷씬이 재생됩니다.'));
        notes.append(h('p', null, '아바타 능력치는 메인 카드에 장착했을 때만 적용됩니다.'));
        if (av.unlocked && !av.equipped && av.starOk) notes.append(h('p', null, '능력치만 적용: 외형은 지금 장착한 아바타를 유지하고, 능력치만 이 아바타로 적용합니다.'));
        if (av.shop && av.shop.price && av.shop.shopType && av.shop.shopType !== '아바타') notes.append(h('p', null, av.shop.shopType + ' 상점에서 판매 중입니다.'));
        scroll.append(notes);

        const dock = h('footer', 'uas-dock');
        const errEl = h('p', 'uas-error');
        errEl.setAttribute('role', 'alert');
        const acts = h('div', 'uas-acts');
        dock.append(errEl, acts);
        panel.append(scroll, dock);

        root.append(stage, panel, closeBtn, live);

        function announce(text) { live.textContent = ''; live.textContent = text; }

        function actBtn(text, body, primary) {
            return btn('uas-btn' + (primary ? ' is-primary' : ''), text, e => run('apply', () => call(actions.apply, Object.assign({ avatarId: s.selected ? s.selected.id : undefined }, body)), e.currentTarget), true);
        }
        function buyBtn(primary) {
            const sold = !!av.shop.soldOut;
            const label = sold ? '품절' : (primary ? '구매' : '하나 더 구매');
            const b = btn('uas-btn uas-buy' + (primary ? ' is-primary' : ''), null, e => run('buy', () => call(actions.buy), e.currentTarget), true);
            b.append(h('span', 'uas-buy-label', label), priceTag(av.shop.price));
            b.setAttribute('aria-label', label + ', ' + priceText(av.shop.price));
            if (sold) b.dataset.locked = '1';
            return b;
        }
        function buildDock() {
            acts.replaceChildren();
            const listed = !!(av.shop && av.shop.price);
            if (!av.unlocked) {
                if (listed) acts.append(buyBtn(true));
                else acts.append(h('p', 'uas-dock-note', '미보유'));
                return;
            }
            if (!av.equipped && !av.starOk) acts.append(h('p', 'uas-dock-note is-warn', (av.requireStarText || '') + ' 이상 카드에만 장착할 수 있습니다.'));
            else if (av.equipped) {
                acts.append(actBtn('해제', { name: '' }, false));
                if (instances.length > 1) acts.append(actBtn('선택한 아바타로 변경', { name: av.name }, true));
            } else {
                acts.append(actBtn('장착', { name: av.name }, true));
                acts.append(av.statApplied
                    ? actBtn('능력치 적용 해제', { name: '', statsOnly: true }, false)
                    : actBtn('능력치만 적용', { name: av.name, statsOnly: true }, false));
            }
            if (listed && !av.shop.soldOut) acts.append(buyBtn(false));
        }

        function renderOptions() {
            optionBox.replaceChildren();
            if (!unique || !s.selected) return;
            const optionHead = h('div', 'uas-opt-head');
            optionHead.append(h('p', 'unique-avatar-options-title', '추가 옵션'), h('p', 'uas-opt-note', '변경은 전투 중이 아닐 때만 · 효과는 전투에서 적용'));
            optionBox.append(optionHead);
            const target = s.selected;
            arr(av.uniqueOptions).forEach(option => {
                const on = target.option === option.id;
                const b = btn(on ? 'selected' : '', option.label, e => {
                    if (target.option === option.id) return;
                    run('option', async () => {
                        const next = await call(actions.setOption, target.id, option.id);
                        if (next != null) target.option = next;
                        announce('추가 옵션: ' + option.label);
                    }, e.currentTarget);
                }, true);
                b.dataset.id = sid(option.id);
                b.setAttribute('aria-pressed', String(on));
                b.disabled = !!s.pending;
                b.classList.toggle('is-busy', s.pending === 'option' && !!s.busyBtn && s.busyBtn.dataset.id === b.dataset.id);
                optionBox.append(b);
            });
        }

        function sync() {
            stage.dataset.focus = s.focus;
            Object.keys(lensBtns).forEach(k => lensBtns[k].setAttribute('aria-pressed', String(s.focus === k)));
            if (figure) figure.tabIndex = s.focus === 'figure' ? -1 : 0;
            cardBtn.tabIndex = s.focus === 'card' ? -1 : 0;
            if (s.focus !== 'card') resetTilt();

            own.replaceChildren();
            const cnt = Math.round(Number(av.ownedCount) || 0) || instances.length;
            const state = !av.unlocked ? '미보유' : av.equipped ? '장착 중' : av.statApplied ? '능력치 적용 중' : '보유';
            own.append(h('span', av.equipped ? 'is-on' : (!av.unlocked ? 'is-off' : null), state));
            if (av.unlocked && cnt > 1) own.append(h('span', null, fmt(cnt) + '개 보유'));
            if (unique && s.selected) own.append(h('span', null, '거래 가능 ' + tradeLeft(s.selected) + '회'));

            if (copies) [...copies.children].forEach(b => {
                b.setAttribute('aria-pressed', String(!!s.selected && b.dataset.id === sid(s.selected.id)));
                b.disabled = !!s.pending;
            });
            renderOptions();
            [...acts.querySelectorAll('button')].forEach(b => {
                b.disabled = !!s.pending || b.dataset.locked === '1';
                b.classList.toggle('is-busy', !!s.pending && b === s.busyBtn);
            });
            errEl.textContent = s.error;
            errEl.hidden = !s.error;
            closeBtn.disabled = !!s.pending;
            root.setAttribute('aria-busy', String(!!s.pending));
        }

        async function run(kind, task, button) {
            if (s.pending || s.stale) return;
            s.pending = kind;
            s.busyBtn = button || null;
            s.error = '';
            sync();
            try { await task(); } catch (err) {
                if (s.stale) return;
                s.error = err && err.message ? String(err.message) : '요청을 처리하지 못했습니다. 다시 시도해 주세요.';
            }
            if (s.stale) return;
            s.pending = '';
            s.busyBtn = null;
            sync();
            if (s.error) announce(s.error);
            // 옵션 줄은 다시 그려지므로 같은 줄로 초점을 돌려준다
            if (kind === 'option' && button && button.dataset.id) {
                const again = [...optionBox.querySelectorAll('button')].find(b => b.dataset.id === button.dataset.id);
                if (again) again.focus({ preventScroll: true });
            }
        }

        // ----- 보기 전환 / 카드 기울이기 / 컷씬 -----
        function setFocus(f) {
            if (!lensBtns[f] || s.focus === f) return;
            if (s.focus === 'cine') stopCine();
            s.focus = f;
            sync();
            if (f === 'cine' && motion()) playCine();
            else if (f === 'cine') playBtn.focus({ preventScroll: true });
        }
        function onTilt(e) {
            if (s.focus !== 'card' || !motion() || e.pointerType === 'touch') return;
            const r = tilt.getBoundingClientRect();
            if (!r.width) return;
            const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
            tilt.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
            tilt.style.setProperty('--ry', (x * 16).toFixed(2) + 'deg');
            tilt.style.setProperty('--gx', ((x + 0.5) * 100).toFixed(1) + '%');
            tilt.style.setProperty('--gy', ((y + 0.5) * 100).toFixed(1) + '%');
            tilt.classList.add('is-tilting');
        }
        function resetTilt() {
            ['--rx', '--ry', '--gx', '--gy'].forEach(p => tilt.style.removeProperty(p));
            tilt.classList.remove('is-tilting');
        }
        function clearFrame() {
            if (screen) screen.replaceChildren();
            if (s.cineUrl) { URL.revokeObjectURL(s.cineUrl); s.cineUrl = ''; }
            if (cine) cine.classList.remove('is-playing');
        }
        function stopCine() {
            s.cineToken++;
            clearFrame();
            if (cine) cine.classList.remove('is-loading');
        }
        async function playCine() {
            if (!hasCine || s.stale || s.focus !== 'cine') return;
            const token = ++s.cineToken;
            clearFrame();
            cine.classList.remove('is-failed');
            cine.classList.add('is-loading');
            try {
                if (!s.blob) s.blob = fetch(av.cutsceneUrl).then(r => { if (!r.ok) throw new Error('cutscene'); return r.blob(); });
                const blob = await s.blob;
                if (s.stale || token !== s.cineToken || s.focus !== 'cine' || document.hidden) return;
                // 한 번만 도는 애니메이션이므로 매번 새 객체 URL로 처음부터 재생한다
                s.cineUrl = URL.createObjectURL(blob);
                const img = document.createElement('img');
                img.alt = (av.name || '') + ' 궁극기 컷씬';
                img.decoding = 'async';
                img.draggable = false;
                img.src = s.cineUrl;
                screen.replaceChildren(img);
                cine.classList.add('is-playing');
                if (root.contains(document.activeElement) && document.activeElement === playBtn) replayBtn.focus({ preventScroll: true });
            } catch (_) {
                s.blob = null;
                if (!s.stale && token === s.cineToken) cine.classList.add('is-failed');
            } finally {
                if (token === s.cineToken) cine.classList.remove('is-loading');
            }
        }

        // ----- 닫기 / 키보드 -----
        function requestClose() {
            if (s.pending || s.stale) return;
            destroy();
        }
        function trapTab(e) {
            const items = [...root.querySelectorAll('button')].filter(b => !b.disabled && b.tabIndex >= 0 && !b.closest('[hidden]') && b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden');
            if (!items.length) { e.preventDefault(); return; }
            const first = items[0], last = items[items.length - 1];
            const inside = root.contains(document.activeElement);
            if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === name)) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
        }
        function onKey(e) {
            if (document.querySelector('.msg-modal-bg')) return;
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopImmediatePropagation();
                if (s.focus === 'cine') { setFocus(hasFigure ? 'figure' : 'card'); lensBtns.cine.focus({ preventScroll: true }); }
                else requestClose();
            } else if (e.key === 'Tab') trapTab(e);
        }
        function onVis() { if (document.hidden && s.focus === 'cine') stopCine(); }
        function onMotion() { if (!motion()) resetTilt(); }

        function destroy() {
            if (s.stale) return;
            s.stale = true;
            stopCine();
            s.blob = null;
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('visibilitychange', onVis);
            window.removeEventListener('pagehide', stopCine);
            reducedQuery.removeEventListener('change', onMotion);
            root.remove();
            document.documentElement.classList.remove('uas-locked');
            if (room === inst) room = null;
            if (prevFocus && prevFocus.isConnected && typeof prevFocus.focus === 'function') prevFocus.focus({ preventScroll: true });
        }

        buildDock();
        sync();
        document.body.append(root);
        document.documentElement.classList.add('uas-locked');
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('visibilitychange', onVis);
        window.addEventListener('pagehide', stopCine);
        reducedQuery.addEventListener('change', onMotion);
        name.focus({ preventScroll: true });

        const inst = { destroy };
        return inst;
    }

    function showroom(av, actions) {
        closeShowroom();
        room = createShowroom(av || {}, actions || {});
        return room;
    }
    function closeShowroom() {
        if (room) room.destroy();
        room = null;
    }

    window.UniqueAvatarUI = { open, close, renderWardrobe, showroom, closeShowroom };
})();
