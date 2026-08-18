(function () {
    'use strict';

    const sceneCanvas = document.getElementById('pvpCanvas');
    const hudCanvas = document.getElementById('pvpHud');
    if (!sceneCanvas || !hudCanvas) return;

    const uiAsset = file => '/rpg-ui?file=' + encodeURIComponent(file);
    const ASSETS = {
        background: uiAsset('필드/뉴비즈.png'),
        impact: uiAsset('필드/hfield-impact-v2.png')
    };
    const SOUNDS = {
        bgm: uiAsset('boss fight.mp3'), start: uiAsset('sfx/start.mp3'),
        hit0: uiAsset('sfx/hit_0.mp3'), hit1: uiAsset('sfx/hit_1.mp3'), hit2: uiAsset('sfx/hit_2.mp3'),
        crit: uiAsset('sfx/crit.mp3'), skill: uiAsset('sfx/skill.mp3'), clear: uiAsset('sfx/clear.mp3'),
        fail: uiAsset('sfx/fail.mp3'), count: uiAsset('sfx/count.mp3')
    };
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const CARD_AURA_COLORS = { 9: [.5,1,.18,1], 10: [.2,.76,1,1], 11: [1,.12,.1,1] };
    const REASON_LABELS = { ko: 'KO', timeout: '시간 종료', forfeit: '전투 포기' };
    const DASHBOARD_URL = '/?tab=pvp';
    const OPPONENT = String(window.PVP_OPPONENT || '');

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const ratio = (value, max) => clamp(Number(value || 0) / Math.max(1, Number(max || 1)), 0, 1);
    const number = value => Number(value || 0).toLocaleString('ko-KR');
    const cleanText = value => String(value || '')
        .replace(/\p{Extended_Pictographic}/gu, '').replace(/[\uFE0E\uFE0F\u200D]/g, '')
        .replace(/^[-•]\s*/, '').trim();
    // 내 캐릭터는 왼쪽, 상대는 오른쪽(좌우 반전)
    const sideX = (key, narrow) => key === 'opp' ? (narrow ? .76 : .75) : (narrow ? .24 : .25);

    let stage = 'loading';      // loading | lobby | battle | result
    let view = null;            // BattleView
    let lobby = null;           // { me, opponent } (GET /api/pvp)
    let lobbyError = '';
    let busy = false;
    let polling = false;
    let clockOffset = 0;
    let lastSeq = 0;
    let logs = [];
    let dialog = null;

    const now = () => Date.now() + clockOffset;

    async function request(url, body) {
        const options = body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
        };
        const response = await fetch(url, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '요청을 처리하지 못했습니다.');
        return payload;
    }

    // GET /api/pvp/battle는 BattleView를 그대로, POST들은 {ok,message,battle}로 돌려준다
    function extractView(payload) {
        if (!payload || typeof payload !== 'object') return null;
        const candidate = payload.battle && typeof payload.battle === 'object' ? payload.battle : payload;
        if (!candidate || candidate.active === false || !candidate.phase) return null;
        return candidate;
    }

    class PvpAudio {
        constructor() {
            try { this.muted = localStorage.getItem('pvp-muted') === '1'; } catch (_) { this.muted = false; }
            this.context = null;
            this.bgm = new Audio(SOUNDS.bgm);
            this.bgm.loop = true;
            this.bgm.volume = .2;
        }
        unlock() {
            if (this.muted) return;
            const Context = window.AudioContext || window.webkitAudioContext;
            if (Context && !this.context) this.context = new Context();
            if (this.context && this.context.state === 'suspended') this.context.resume().catch(() => {});
        }
        play(name, volume) {
            if (this.muted || !SOUNDS[name]) return;
            const sound = new Audio(SOUNDS[name]);
            sound.volume = volume == null ? .5 : volume;
            sound.play().catch(() => {});
        }
        hit() { this.play('hit' + Math.floor(Math.random() * 3), .48); }
        playBgm() { if (!this.muted && stage === 'battle') this.bgm.play().catch(() => {}); }
        stopBgm() { this.bgm.pause(); }
        toggle() {
            this.muted = !this.muted;
            try { localStorage.setItem('pvp-muted', this.muted ? '1' : '0'); } catch (_) {}
            if (this.muted) this.stopBgm(); else { this.unlock(); this.playBgm(); this.play('count', .32); }
        }
    }

    class FieldRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false });
            if (!this.gl) throw new Error('WebGL을 지원하지 않는 브라우저입니다.');
            this.textures = {};
            this.particles = [];
            this.spriteUrls = { me: '', opp: '' };
            this.sides = { me: null, opp: null };
            this.anim = { me: this.newAnim(), opp: this.newAnim() };
            this.frame = 0;
            this.last = performance.now();
            this.ambientAt = 0;
            this.impactKey = 'opp';
            this.impactUntil = 0;
            this.impactStarted = 0;
            this.impactCritical = false;
            this.impactSkill = false;
            this.initGl();
            Object.entries(ASSETS).forEach(([name, url]) => this.loadTexture(name, url));
            this.frame = requestAnimationFrame(time => this.render(time));
        }
        newAnim() { return { attackAt: -9999, kind: 'attack', hitUntil: 0, defendAt: -9999 }; }
        compile(type, source) {
            const shader = this.gl.createShader(type);
            this.gl.shaderSource(shader, source);
            this.gl.compileShader(shader);
            if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) throw new Error(this.gl.getShaderInfoLog(shader));
            return shader;
        }
        initGl() {
            const gl = this.gl;
            const vertex = this.compile(gl.VERTEX_SHADER, `
                attribute vec2 aPosition; uniform vec4 uRect; uniform float uRotation; varying vec2 vUv;
                void main(){float c=cos(uRotation),s=sin(uRotation);vec2 p=vec2(aPosition.x*c-aPosition.y*s,aPosition.x*s+aPosition.y*c)*uRect.zw;vec2 w=uRect.xy+p;gl_Position=vec4(w.x*2.0-1.0,1.0-w.y*2.0,0.0,1.0);vUv=aPosition+0.5;}`);
            const fragment = this.compile(gl.FRAGMENT_SHADER, `
                precision mediump float; uniform sampler2D uTexture; uniform vec4 uColor; uniform float uMode; uniform float uFlash; varying vec2 vUv;
                void main(){vec4 p;if(uMode<0.5){p=texture2D(uTexture,vUv);p.rgb*=uColor.rgb;p.a*=uColor.a;}else if(uMode<1.5){float d=length((vUv-.5)*2.0);p=vec4(uColor.rgb,(1.0-smoothstep(0.0,1.0,d))*uColor.a);}else if(uMode<2.5){float l=1.0-smoothstep(.025,.22,abs(vUv.y-.5));float e=smoothstep(0.0,.2,vUv.x)*smoothstep(0.0,.2,1.0-vUv.x);p=vec4(uColor.rgb,l*e*uColor.a);}else if(uMode<3.5){p=uColor;}else if(uMode<4.5){float d=length((vUv-.5)*2.0);float ring=1.0-smoothstep(.04,.16,abs(d-.7));float glow=(1.0-smoothstep(.55,1.0,d))*.22;p=vec4(uColor.rgb,max(ring,glow)*uColor.a);}else if(uMode<5.5){float taper=1.0-abs(vUv.y*2.0-1.0);float width=.018+.12*taper*taper;float bend=(vUv.y-.5)*.12;float blade=1.0-smoothstep(width,width+.035,abs(vUv.x-.5+bend));float edge=smoothstep(0.0,.14,vUv.y)*smoothstep(0.0,.14,1.0-vUv.y);p=vec4(uColor.rgb,blade*edge*uColor.a);}else if(uMode<6.5){vec4 t=texture2D(uTexture,vUv);float b=0.0;b+=texture2D(uTexture,vUv+vec2(.006,0.0)).a*3.0;b+=texture2D(uTexture,vUv-vec2(.006,0.0)).a*3.0;b+=texture2D(uTexture,vUv+vec2(0.0,.004)).a*3.0;b+=texture2D(uTexture,vUv-vec2(0.0,.004)).a*3.0;b+=texture2D(uTexture,vUv+vec2(.012,.008)).a*2.0;b+=texture2D(uTexture,vUv+vec2(-.012,.008)).a*2.0;b+=texture2D(uTexture,vUv+vec2(.012,-.008)).a*2.0;b+=texture2D(uTexture,vUv-vec2(.012,.008)).a*2.0;b+=texture2D(uTexture,vUv+vec2(.022,0.0)).a;b+=texture2D(uTexture,vUv-vec2(.022,0.0)).a;b+=texture2D(uTexture,vUv+vec2(0.0,.015)).a;b+=texture2D(uTexture,vUv-vec2(0.0,.015)).a;b+=texture2D(uTexture,vUv+vec2(.026,.018)).a*.7;b+=texture2D(uTexture,vUv+vec2(-.026,.018)).a*.7;b+=texture2D(uTexture,vUv+vec2(.026,-.018)).a*.7;b+=texture2D(uTexture,vUv-vec2(.026,.018)).a*.7;b/=24.8;float glow=pow(clamp(b,0.0,1.0),1.35)*(1.0-t.a*.72);p=vec4(uColor.rgb,glow*uColor.a);}else{vec4 t=texture2D(uTexture,vUv);float b=0.0;b+=texture2D(uTexture,vUv+vec2(.018,0.0)).a*2.0;b+=texture2D(uTexture,vUv-vec2(.018,0.0)).a*2.0;b+=texture2D(uTexture,vUv+vec2(0.0,.012)).a*2.0;b+=texture2D(uTexture,vUv-vec2(0.0,.012)).a*2.0;b+=texture2D(uTexture,vUv+vec2(.035,.024)).a;b+=texture2D(uTexture,vUv+vec2(-.035,.024)).a;b+=texture2D(uTexture,vUv+vec2(.035,-.024)).a;b+=texture2D(uTexture,vUv-vec2(.035,.024)).a;b+=texture2D(uTexture,vUv+vec2(.052,.036)).a*.6;b+=texture2D(uTexture,vUv+vec2(-.052,.036)).a*.6;b+=texture2D(uTexture,vUv+vec2(.052,-.036)).a*.6;b+=texture2D(uTexture,vUv-vec2(.052,.036)).a*.6;b/=14.4;float glow=pow(clamp(b,0.0,1.0),1.18)*(1.0-t.a*.88);p=vec4(uColor.rgb,glow*uColor.a);}p.rgb=mix(p.rgb,vec3(1.0),uFlash);if(p.a<.01)discard;gl_FragColor=p;}`);
            const program = gl.createProgram();
            gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            this.program = program;
            this.loc = {
                position: gl.getAttribLocation(program, 'aPosition'), rect: gl.getUniformLocation(program, 'uRect'),
                rotation: gl.getUniformLocation(program, 'uRotation'), texture: gl.getUniformLocation(program, 'uTexture'),
                color: gl.getUniformLocation(program, 'uColor'), mode: gl.getUniformLocation(program, 'uMode'), flash: gl.getUniformLocation(program, 'uFlash')
            };
            this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5,-.5,.5,-.5,-.5,.5,.5,.5]), gl.STATIC_DRAW);
            this.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(program); gl.uniform1i(this.loc.texture, 0);
        }
        loadTexture(name, url) {
            const gl = this.gl;
            const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8,12,24,255]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            const entry = this.textures[name] = { texture, aspect: 1, ready: false };
            const image = new Image(); image.decoding = 'async';
            image.onload = () => {
                gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                entry.aspect = image.naturalWidth / Math.max(1, image.naturalHeight); entry.ready = true;
            };
            image.src = url;
        }
        setSides(me, opp) {
            this.sides.me = me || null; this.sides.opp = opp || null;
            [['me', me], ['opp', opp]].forEach(([key, side]) => {
                const url = side && side.spriteUrl || '';
                if (url && this.spriteUrls[key] !== url) { this.spriteUrls[key] = url; this.loadTexture(key, url); }
            });
        }
        resize() {
            const dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
            if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.gl.viewport(0, 0, w, h); }
        }
        draw(entry, x, y, w, h, options) {
            const gl = this.gl, opts = options || {}, color = opts.color || [1,1,1,1];
            gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.enableVertexAttribArray(this.loc.position);
            gl.vertexAttribPointer(this.loc.position, 2, gl.FLOAT, false, 0, 0); gl.uniform4f(this.loc.rect, x, y, w, h);
            gl.uniform1f(this.loc.rotation, opts.rotation || 0); gl.uniform4f(this.loc.color, color[0], color[1], color[2], color[3] == null ? 1 : color[3]);
            gl.uniform1f(this.loc.mode, opts.mode || 0); gl.uniform1f(this.loc.flash, opts.flash || 0); gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, entry && entry.texture || this.white); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        fit(name, height, maxWidth) {
            const aspect = this.canvas.width / Math.max(1, this.canvas.height);
            let width = height * Number(this.textures[name] && this.textures[name].aspect || .7) / Math.max(.35, aspect);
            if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
            return { width, height };
        }
        cover(name) {
            const sourceAspect=Number(this.textures[name]&&this.textures[name].aspect||1),canvasAspect=this.canvas.width/Math.max(1,this.canvas.height);
            return sourceAspect>canvasAspect?{width:sourceAspect/canvasAspect,height:1}:{width:1,height:canvasAspect/sourceAspect};
        }
        particle(p) {
            if (reducedMotion && this.particles.length > 24) return;
            this.particles.push(Object.assign({x:.5,y:.5,vx:0,vy:0,life:.7,maxLife:.7,width:.014,height:.014,rotation:0,spin:0,color:[1,.3,.2,1],mode:1}, p));
        }
        burst(x, y, color, count) {
            for (let i = 0; i < (reducedMotion ? 8 : count); i++) {
                const angle = Math.random() * Math.PI * 2, speed = .08 + Math.random() * .25;
                const spark = i % 3 === 0;
                this.particle({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:.45+Math.random()*.55,maxLife:1,width:spark?.045+Math.random()*.05:.008+Math.random()*.014,height:spark?.0035:.008+Math.random()*.014,spin:spark?angle:(Math.random()-.5)*5,color,mode:spark?2:1});
            }
        }
        drawAura(info, key, x, y, w, h, time) {
            const star = Number(info && info.cardStar), tier = star >= 11 ? 11 : star >= 10 ? 10 : star >= 9 ? 9 : 0;
            const texture = this.textures[key];
            if (!tier || !texture || !texture.ready) return;
            const color = CARD_AURA_COLORS[tier], job = info.cardType === '전직',
                pulse = reducedMotion ? .5 : (Math.sin(time / (job ? 300 : 520)) + 1) * .5,
                shimmer = reducedMotion ? .5 : (Math.sin(time / (job ? 155 : 260) + 1.2) + 1) * .5,
                bright = [Math.min(1, color[0]*.72+.28), Math.min(1, color[1]*.72+.28), Math.min(1, color[2]*.72+.28), 1],
                rgba = (source, alpha) => [source[0], source[1], source[2], alpha];
            this.draw(texture, x, y, w, h, { mode: 7, color: rgba(color, (job?.34:.25) + pulse*(job?.2:.14)) });
            this.draw(texture, x, y, w, h, { mode: 6, color: rgba(bright, (job?.62:.46) + shimmer*(job?.2:.14)) });
        }
        // 공격 모션(대상 쪽으로 돌진)
        lunge(key, kind) { const anim = this.anim[key]; anim.attackAt = performance.now(); anim.kind = kind || 'attack'; }
        // 피격 연출: 대상 플래시 + 임팩트 스프라이트 + 파티클
        strike(key, event) {
            const now = performance.now(), critical = Number(event && event.criticalCount || 0) > 0, skill = event && event.action === 'skill';
            this.anim[key].hitUntil = now + (critical ? 520 : 360);
            this.impactKey = key; this.impactStarted = now; this.impactUntil = now + (skill ? 520 : 390);
            this.impactCritical = critical; this.impactSkill = skill;
            this.burst(sideX(key, innerWidth < 700), .51, critical ? [1,.68,.12,1] : [1,.2,.12,1], critical ? 52 : 34);
        }
        // 소환수/지속 피해 틱: 공격 모션 없이 대상 피격 연출만
        tickHit(key) {
            const now = performance.now();
            this.anim[key].hitUntil = now + 360;
            this.impactKey = key; this.impactStarted = now; this.impactUntil = now + 390; this.impactCritical = false; this.impactSkill = false;
            this.burst(sideX(key, innerWidth < 700), .51, [1,.2,.12,1], 26);
        }
        defendPulse(key) {
            this.anim[key].defendAt = performance.now();
            this.burst(sideX(key, innerWidth < 700), .62, [.55,.82,1,1], 18);
        }
        drawSide(key, narrow, idle, time) {
            const texture = this.textures[key];
            if (!texture || !texture.ready) return;
            const info = this.sides[key], anim = this.anim[key], mirror = key === 'opp';
            const fit = this.fit(key, narrow ? .62 : .78, narrow ? .46 : .36);
            const progress = clamp((time - anim.attackAt) / (anim.kind === 'skill' ? 620 : 430), 0, 1);
            const lunge = progress < 1 ? Math.sin(progress * Math.PI) * .12 * (mirror ? -1 : 1) : 0;
            const x = sideX(key, narrow) + lunge, y = (narrow ? .68 : .66) - idle;
            const width = mirror ? -fit.width : fit.width;
            this.drawAura(info, key, x, y, width, fit.height, time);
            this.draw(null, x, .83, narrow ? .4 : .27, .11, { mode: 1, color: mirror ? [1,.14,.2,.24] : [.08,.45,1,.25] });
            this.draw(texture, x, y, width, fit.height, { flash: time < anim.hitUntil ? .75 : 0 });
            const pulse = time - anim.defendAt < 620 ? 1 - (time - anim.defendAt) / 620 : 0;
            if (info && info.defending) {
                const wave = reducedMotion ? .5 : (Math.sin(time / 380) + 1) * .5;
                this.draw(null, x, y + .02, Math.abs(fit.width) * 1.5, fit.height * 1.16, { mode: 4, color: [.45,.78,1, .3 + wave * .24 + pulse * .4] });
            } else if (pulse > 0) {
                this.draw(null, x, y + .02, Math.abs(fit.width) * 1.5, fit.height * 1.16, { mode: 4, color: [.45,.78,1, pulse * .5] });
            }
        }
        render(time) {
            this.resize();
            const gl = this.gl, dt = Math.min(.04, Math.max(0, (time - this.last) / 1000));
            this.last = time;
            gl.clearColor(.005,.01,.025,1); gl.clear(gl.COLOR_BUFFER_BIT);
            const bg = this.cover('background');
            this.draw(this.textures.background, .5, .5, bg.width, bg.height);
            this.draw(null, .5, .5, 1, 1, { mode: 3, color: [.01,.02,.05,.2] });
            const narrow = innerWidth < 700, idle = reducedMotion ? 0 : Math.sin(time / 520) * .005;
            this.drawSide('me', narrow, idle, time);
            this.drawSide('opp', narrow, idle, time);
            if (time < this.impactUntil) {
                const p = clamp((time - this.impactStarted) / Math.max(1, this.impactUntil - this.impactStarted), 0, 1), pulse = Math.sin(p * Math.PI),
                    fit = this.fit('impact', (this.impactSkill ? .52 : .4) * (.72 + pulse * .42), this.impactSkill ? .42 : .33),
                    alpha = Math.pow(1 - p, .42), ix = sideX(this.impactKey, narrow);
                this.draw(this.textures.impact, ix, .51, fit.width, fit.height, { color: [1,1,1,alpha], rotation: (this.impactSkill ? -.08 : .08) + p * .05 });
                if (this.impactCritical) this.draw(this.textures.impact, ix - .01, .52, fit.width * .72, fit.height * .72, { color: [1,.86,.52,alpha*.72], rotation: -.75 });
            }
            if (time > this.ambientAt) {
                this.ambientAt = time + (reducedMotion ? 500 : 170);
                this.particle({x:Math.random()<.5?.04:.96,y:.55+Math.random()*.4,vx:(Math.random()-.5)*.01,vy:-.025,life:3,maxLife:3,width:.005+Math.random()*.008,height:.005+Math.random()*.008,color:Math.random()<.5?[.4,.2,1,.55]:[1,.15,.25,.5]});
            }
            this.particles = this.particles.filter(p => {
                p.life -= dt; if (p.life <= 0) return false;
                p.x += p.vx*dt; p.y += p.vy*dt; p.vy += .07*dt; p.rotation += p.spin*dt;
                const c = p.color.slice(); c[3] *= clamp(p.life/p.maxLife*2.4, 0, 1);
                this.draw(null, p.x, p.y, p.width, p.height, { mode: p.mode, color: c, rotation: p.rotation });
                return true;
            });
            this.frame = requestAnimationFrame(next => this.render(next));
        }
    }

    class Hud {
        constructor(canvas) {
            this.canvas=canvas;this.ctx=canvas.getContext('2d');this.regions=[];this.images=new Map();this.flashUntil=0;this.flashDuration=1;this.shakeUntil=0;this.banner=null;this.bannerSub='';this.bannerUntil=0;this.damagePops=[];this.countTick=0;this.resultStarted=0;this.frame=requestAnimationFrame(()=>this.draw());
            canvas.addEventListener('pointerdown',event=>{audio.unlock();this.pointer={x:event.clientX,y:event.clientY,id:event.pointerId};canvas.setPointerCapture(event.pointerId);});
            canvas.addEventListener('pointerup',event=>{if(!this.pointer||this.pointer.id!==event.pointerId)return;const hit=this.regions.slice().reverse().find(r=>event.clientX>=r.x&&event.clientX<=r.x+r.w&&event.clientY>=r.y&&event.clientY<=r.y+r.h);this.pointer=null;if(hit&&!busy)hit.action();});
            canvas.addEventListener('pointercancel',()=>{this.pointer=null;});
        }
        resize(){const dpr=Math.min(2,devicePixelRatio||1),w=Math.round(innerWidth*dpr),h=Math.round(innerHeight*dpr);if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;this.canvas.style.width=innerWidth+'px';this.canvas.style.height=innerHeight+'px';}this.ctx.setTransform(dpr,0,0,dpr,0,0);return{w:innerWidth,h:innerHeight};}
        image(url){if(!url)return null;if(!this.images.has(url)){const img=new Image();img.decoding='async';img.src=url;this.images.set(url,img);}const img=this.images.get(url);return img.complete&&img.naturalWidth?img:null;}
        text(value,x,y,size,weight,align,color,maxWidth){const c=this.ctx;c.font=(weight||700)+' '+size+'px Pretendard, sans-serif';c.textAlign=align||'left';c.textBaseline='middle';c.fillStyle=color||'#fff';if(maxWidth)c.fillText(String(value||''),x,y,maxWidth);else c.fillText(String(value||''),x,y);}
        gameText(value,x,y,size,align,color,maxWidth){const c=this.ctx;c.font='400 '+size+'px "Black Han Sans", Pretendard, sans-serif';c.textAlign=align||'center';c.textBaseline='middle';c.fillStyle=color||'#fff';if(maxWidth)c.fillText(String(value||''),x,y,maxWidth);else c.fillText(String(value||''),x,y);}
        line(x1,y1,x2,y2,color,width){const c=this.ctx;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.strokeStyle=color;c.lineWidth=width||1;c.stroke();}
        cutPath(x,y,w,h,cut){const c=this.ctx,k=Math.min(cut||7,w*.2,h*.35);c.beginPath();c.moveTo(x+k,y);c.lineTo(x+w,y);c.lineTo(x+w,y+h-k);c.lineTo(x+w-k,y+h);c.lineTo(x,y+h);c.lineTo(x,y+k);c.closePath();}
        panel(x,y,w,h,accent,solid){const c=this.ctx,g=c.createLinearGradient(x,y,x,y+h);g.addColorStop(0,solid?'rgba(26,29,36,.98)':'rgba(18,21,28,.91)');g.addColorStop(1,solid?'rgba(8,10,14,.99)':'rgba(6,8,13,.82)');this.cutPath(x,y,w,h,9);c.fillStyle=g;c.fill();c.strokeStyle=accent||'rgba(92,100,116,.72)';c.lineWidth=1;c.stroke();this.line(x+10,y+.5,x+Math.min(w*.44,150),y+.5,accent||'rgba(232,176,75,.72)',2);this.line(x+w-14,y+h-.5,x+w-3,y+h-11,accent||'rgba(232,176,75,.45)',1);}
        region(x,y,w,h,action){this.regions.push({x,y,w,h,action});}
        // 보호막은 party.js와 동일하게 HP 바 위 흰색 구간으로 표시
        bar(x,y,w,h,value,max,color,shield){const c=this.ctx;this.cutPath(x,y,w,h,3);c.fillStyle='rgba(0,0,0,.8)';c.fill();const guard=Math.max(0,Number(shield||0)),total=Math.max(Number(max||1),Number(value||0)+guard),fill=w*ratio(value,total);if(fill>0){this.cutPath(x,y,fill,h,3);const g=c.createLinearGradient(x,y,x+w,y);g.addColorStop(0,color);g.addColorStop(1,color==='#b92d2d'?'#f25b42':'#37a4ec');c.fillStyle=g;c.fill();}if(guard>0){c.save();this.cutPath(x,y,w,h,3);c.clip();c.fillStyle='rgba(238,244,255,.88)';c.fillRect(x+fill,y,Math.max(2,w*ratio(guard,total)),h);c.restore();}this.cutPath(x,y,w,h,3);c.strokeStyle='rgba(255,255,255,.24)';c.lineWidth=1;c.stroke();this.line(x+2,y+2,x+Math.max(2,fill-2),y+2,'rgba(255,255,255,.28)',1);}
        badge(right,y,label,color){const c=this.ctx;c.font='800 9px Pretendard, sans-serif';const bw=c.measureText(label).width+12,x=right-bw;this.cutPath(x,y,bw,14,3);c.fillStyle='rgba(10,14,22,.82)';c.fill();c.strokeStyle=color;c.lineWidth=1;c.stroke();this.text(label,x+bw/2,y+7,9,800,'center',color);}
        actionButton(x,y,w,h,opts){
            const c=this.ctx,o=opts||{},kind=o.kind||'skill',disabled=!!o.disabled;
            this.cutPath(x,y,w,h,kind==='attack'?12:7);const g=c.createLinearGradient(x,y,x,y+h);
            if(kind==='attack'){g.addColorStop(0,disabled?'#3d3233':'#dd5a4e');g.addColorStop(.55,disabled?'#282327':'#9e241e');g.addColorStop(1,'#42100d');}
            else if(kind==='gold'){g.addColorStop(0,disabled?'#34312c':'#f0c56e');g.addColorStop(1,disabled?'#1b1b1d':'#a85f12');}
            else if(kind==='defend'){g.addColorStop(0,disabled?'#252a32':'#23303f');g.addColorStop(1,disabled?'#15171c':'#0d1622');}
            else{g.addColorStop(0,disabled?'#272b32':'#252b36');g.addColorStop(1,disabled?'#15171c':'#11151d');}
            c.fillStyle=g;c.fill();c.strokeStyle=disabled?'rgba(100,105,115,.48)':kind==='attack'?'rgba(255,170,155,.85)':kind==='gold'?'rgba(255,225,154,.9)':kind==='defend'?'rgba(126,196,255,.9)':'rgba(232,176,75,.58)';c.lineWidth=1;c.stroke();
            if(!disabled)this.line(x+8,y+1,x+w*.55,y+1,kind==='attack'?'rgba(255,210,190,.72)':kind==='defend'?'rgba(126,196,255,.8)':'rgba(232,176,75,.75)',2);
            if(o.key)this.text(o.key,x+7,y+9,8,800,'left',disabled?'#656a74':'#b9ad92');
            const labelX=x+w*.5,labelY=y+h*(Number(o.labelYRatio)||(o.sub?.42:.51)),labelSize=kind==='gold'?19:kind==='attack'?18:Math.min(13,Math.max(9,w*.16)),labelColor=disabled?'#747982':kind==='gold'?'#261704':kind==='defend'?'#dcecff':'#f4f1e8';
            if(kind==='gold'||kind==='attack')this.gameText(o.label,labelX,labelY,labelSize,'center',labelColor,w-12);else this.text(o.label,labelX,labelY,labelSize,900,'center',labelColor,w-12);
            if(o.sub)this.text(o.sub,labelX,y+h*.72,9,700,'center',disabled?'#626771':kind==='gold'?'#3e290c':'#9da5b3',w-10);
            if(o.cooldown>0){this.cutPath(x,y,w,h,kind==='attack'?12:7);c.fillStyle='rgba(0,0,0,.64)';c.fill();this.gameText(o.cooldown<10?o.cooldown.toFixed(1):Math.ceil(o.cooldown),x+w/2,y+h/2,16,'center','#ffe28a');}
            if(!disabled)this.region(x,y,w,h,o.action);
        }
        topControls(w){const p=w<700?12:22,bw=42,bh=34;this.panel(p,p,bw,bh,'rgba(170,180,194,.45)');this.line(p+25,p+9,p+15,p+17,'#e4e8ed',2);this.line(p+15,p+17,p+25,p+25,'#e4e8ed',2);this.region(p,p,bw,bh,()=>backOrForfeit());const x=w-p-bw;this.panel(x,p,bw,bh,'rgba(170,180,194,.45)');const sx=x+20;this.line(sx-7,p+14,sx-2,p+14,'#e4e8ed',2);this.line(sx-2,p+14,sx+4,p+9,'#e4e8ed',2);this.line(sx+4,p+9,sx+4,p+25,'#e4e8ed',2);if(!audio.muted){this.ctx.beginPath();this.ctx.arc(sx+5,p+17,8,-.8,.8);this.ctx.strokeStyle='#e4e8ed';this.ctx.stroke();}else this.line(sx-7,p+9,sx+10,p+26,'#e0655c',2);this.region(x,p,bw,bh,()=>audio.toggle());}
        timerHud(w){
            if(stage!=='battle'||!view)return;
            const narrow=w<700,remain=Math.max(0,Number(view.endsAt||0)-now()),danger=remain<10000&&view.phase==='fight';
            const label=Math.floor(remain/60000)+':'+String(Math.floor(remain%60000/1000)).padStart(2,'0');
            const bw=narrow?86:108,bh=narrow?30:34,x=(w-bw)/2,y=narrow?12:22;
            this.panel(x,y,bw,bh,danger?'rgba(224,101,92,.85)':'rgba(232,176,75,.5)');
            this.gameText(label,w/2,y+bh/2,narrow?17:20,'center',danger?'#ff9a90':'#f7f2e8');
        }
        oppPlate(w){
            if(stage!=='battle'||!view||!view.opp)return;
            const side=view.opp,narrow=w<700,pw=narrow?Math.min(226,w*.6):300,ph=narrow?86:94,p=narrow?12:22,x=w-pw-p,y=p+(narrow?40:44),c=this.ctx;
            this.panel(x,y,pw,ph,'rgba(224,101,92,.6)');
            const ps=narrow?46:54,px=x+8,py=y+8,infoX=px+ps+9,infoRight=x+pw-9,infoW=infoRight-infoX,portrait=this.image(side.cardImageUrl);
            c.save();this.cutPath(px,py,ps,ps,6);c.clip();if(portrait)c.drawImage(portrait,px,py,ps,ps);else{c.fillStyle='#11141b';c.fillRect(px,py,ps,ps);}c.restore();
            this.cutPath(px,py,ps,ps,6);c.strokeStyle='rgba(224,101,92,.7)';c.stroke();
            this.text(side.name,infoX,y+15,narrow?12:14,900,'left','#ffeae5',infoW-52);
            this.text('Lv. '+number(side.level),infoRight,y+15,9,800,'right','#c9c8c5');
            this.text('레이팅 '+number(side.rating),infoX,y+32,9,700,'left','#e8b04b',infoW-52);
            if(side.defending)this.badge(infoRight,y+25,'방어 중','#7ec4ff');
            const hpY=y+(narrow?46:52),mpY=y+(narrow?66:72);
            this.bar(infoX,hpY,infoW,6,side.hp,side.maxHp,'#b92d2d',side.shield);
            this.text(number(side.hp)+' / '+number(side.maxHp),infoRight,hpY-8,8,800,'right','#e9e5dc');
            this.bar(infoX,mpY,infoW,6,side.mp,side.maxMp,'#147fc4');
            this.text('MP '+number(side.mp),infoRight,mpY-8,8,800,'right','#a9b6c4');
        }
        myPlate(w,h){
            if(stage!=='battle'||!view||!view.me)return;
            const side=view.me,narrow=w<700,c=this.ctx,pw=narrow?Math.min(238,w*.62):304,ph=narrow?84:94,x=narrow?12:24,y=h-(narrow?172:178);
            this.panel(x,y,pw,ph,'rgba(232,176,75,.58)');
            const ps=narrow?50:58,px=x+8,py=y+8,infoX=px+ps+9,infoRight=x+pw-9,infoW=infoRight-infoX,portrait=this.image(side.cardImageUrl);
            c.save();this.cutPath(px,py,ps,ps,6);c.clip();if(portrait)c.drawImage(portrait,px,py,ps,ps);else{c.fillStyle='#11141b';c.fillRect(px,py,ps,ps);}c.restore();
            this.cutPath(px,py,ps,ps,6);c.strokeStyle='rgba(232,176,75,.72)';c.stroke();
            this.text(side.name,infoX,y+16,narrow?13:15,900,'left','#fff5df',infoW-52);
            if(side.defending)this.badge(infoRight,y+9,'방어 중','#7ec4ff');
            this.text(side.cardFormatted||[side.cardSkin,side.cardName].filter(Boolean).join(' '),infoX,y+34,narrow?8:10,700,'left','#aeb4bf',infoW);
            const hpTextY=y+(narrow?48:52),hpBarY=y+(narrow?54:59),mpTextY=y+(narrow?65:71),mpBarY=y+(narrow?71:78);
            this.text('HP',infoX,hpTextY,8,800,'left','#bbb1a0');
            this.text(number(side.hp)+(Number(side.shield||0)>0?' +'+number(side.shield):''),infoRight,hpTextY,8,800,'right','#e9e5dc');
            this.bar(infoX,hpBarY,infoW,6,side.hp,side.maxHp,'#b92d2d',side.shield);
            this.text('MP',infoX,mpTextY,8,800,'left','#bbb1a0');
            this.text(number(side.mp),infoRight,mpTextY,8,800,'right','#e9e5dc');
            this.bar(infoX,mpBarY,infoW,6,side.mp,side.maxMp,'#147fc4');
        }
        // 소환수·표식·버프 배지를 각 캐릭터 머리 위에 표시
        sideBadges(w,h){
            if(stage!=='battle'||!view)return;
            ['me','opp'].forEach(key=>{
                const side=view[key];if(!side)return;
                const list=[];
                if(side.summon&&side.summon.name)list.push('소환 '+side.summon.name);
                if(side.mark)list.push('표식');
                (side.buffs||[]).slice(0,2).forEach(buff=>{if(buff&&buff.name)list.push(buff.name);});
                list.slice(0,3).forEach((label,index)=>{
                    const cx=w*sideX(key,w<700);
                    this.ctx.font='800 9px Pretendard, sans-serif';
                    this.badge(cx+(this.ctx.measureText(label).width+12)/2,h*.3+index*17,label,key==='opp'?'#f0a39b':'#9fd7a8');
                });
            });
        }
        combatLog(w,h){
            if(stage!=='battle'||!logs.length)return;
            const narrow=w<700,lines=logs.slice(-4),x=narrow?12:26,base=h-(narrow?182:196),lineH=narrow?14:16;
            lines.forEach((entry,index)=>{
                const alpha=.42+(index+1)/lines.length*.58,col=entry.tone==='bad'?'224,101,92':entry.tone==='good'?'240,197,110':'220,224,230';
                this.text(entry.text,x,base-(lines.length-1-index)*lineH,narrow?9:10,entry.tone==='good'?800:650,'left','rgba('+col+','+alpha+')',Math.min(narrow?w-24:460,w*.48));
            });
        }
        actions(w,h){
            if(stage!=='battle'||!view||!view.me)return;
            const narrow=w<700,locked=view.phase!=='fight',current=now(),actionLeft=Math.max(0,Number(view.me.nextActionAt||0)-current)/1000;
            const skills=(view.me.skills||[]).slice(0,narrow?4:7),gap=narrow?5:7,maxW=Math.min(narrow?w-24:820,w-40);
            const attackW=narrow?72:118,defendW=narrow?52:82,y=h-(narrow?82:76),ah=narrow?68:62;
            const sw=skills.length?Math.max(40,Math.min(narrow?58:92,(maxW-attackW-defendW-gap*(skills.length+1))/skills.length)):0;
            const usedW=skills.length*(sw+gap)+defendW+gap+attackW,x=(w-usedW)/2;
            skills.forEach((skill,index)=>{
                const left=Math.max(actionLeft,(Number(skill.cooldownEnd||0)-current)/1000),mpLow=Number(view.me.mp)<Number(skill.mpCost||0);
                this.actionButton(x+index*(sw+gap),y,sw,ah,{label:String(skill.name||'').slice(0,6),sub:number(skill.mpCost)+' MP',key:String(index+1),disabled:busy||locked||left>0||mpLow,cooldown:Math.max(0,left),action:()=>useSkill(skill.name)});
            });
            const dx=x+skills.length*(sw+gap);
            this.actionButton(dx,y,defendW,ah,{label:'방어',sub:'D',kind:'defend',disabled:busy||locked||actionLeft>0,cooldown:actionLeft,action:()=>defend()});
            this.actionButton(dx+defendW+gap,y,attackW,ah,{label:'공격',sub:narrow?'J':'SPACE / J',key:'J',kind:'attack',disabled:busy||locked||actionLeft>0,cooldown:actionLeft,action:()=>attack()});
        }
        vsCard(side,x,y,cw,ch,accent,narrow){
            const c=this.ctx;this.panel(x,y,cw,ch,accent,true);
            const art=Math.min(cw-26,ch*.52),ax=x+(cw-art)/2,ay=y+16,portrait=this.image(side&&side.cardImageUrl);
            c.save();this.cutPath(ax,ay,art,art,8);c.clip();if(portrait)c.drawImage(portrait,ax,ay,art,art);else{c.fillStyle='#11141b';c.fillRect(ax,ay,art,art);}c.restore();
            this.cutPath(ax,ay,art,art,8);c.strokeStyle=accent;c.lineWidth=1;c.stroke();
            this.text(side&&side.name||'-',x+cw/2,ay+art+20,narrow?13:16,900,'center','#f7f2e8',cw-16);
            this.text('Lv. '+number(side&&side.level),x+cw/2,ay+art+40,narrow?9:11,700,'center','#aeb4bf',cw-16);
            this.text('레이팅 '+number(side&&side.rating),x+cw/2,ay+art+58,narrow?10:12,900,'center','#e8b04b',cw-16);
            const card=side&&(side.cardFormatted||side.cardName);
            if(card)this.text(card,x+cw/2,ay+art+76,narrow?8:9,700,'center','#8d94a0',cw-16);
        }
        lobbyLayer(w,h){
            if(stage!=='lobby')return;
            const c=this.ctx,narrow=w<700,cx=w/2,top=c.createLinearGradient(0,0,0,h);
            top.addColorStop(0,'rgba(0,0,0,.42)');top.addColorStop(.55,'rgba(0,0,0,.2)');top.addColorStop(1,'rgba(0,0,0,.78)');
            c.fillStyle=top;c.fillRect(0,0,w,h);
            this.gameText('PVP 대전',cx,h*(narrow?.13:.14),narrow?30:42,'center','#fff7e8');
            if(!OPPONENT){
                const pw=Math.min(w-40,narrow?300:420),ph=narrow?152:166,px=cx-pw/2,py=h*.38,bw=narrow?168:196;
                this.panel(px,py,pw,ph,'rgba(232,176,75,.55)',true);
                this.text('대시보드에서 상대를 선택하세요',cx,py+(narrow?46:52),narrow?12:14,800,'center','#f0e6d2',pw-28);
                this.actionButton(cx-bw/2,py+ph-(narrow?66:72),bw,52,{label:'돌아가기',disabled:busy,action:()=>{location.href=DASHBOARD_URL;}});
                return;
            }
            const me=lobby&&lobby.me||null,opponent=lobby&&lobby.opponent||null;
            const cw=narrow?Math.min(150,(w-52)/2):230,ch=narrow?232:270,cy=h*(narrow?.24:.25),gap=narrow?26:78;
            this.vsCard(me,cx-gap/2-cw,cy,cw,ch,'rgba(232,176,75,.62)',narrow);
            this.vsCard(opponent,cx+gap/2,cy,cw,ch,'rgba(224,101,92,.62)',narrow);
            this.gameText('VS',cx,cy+ch*.42,narrow?26:40,'center','#f0a39b');
            if(lobbyError)this.text(lobbyError,cx,cy+ch+22,narrow?9:11,750,'center','#f0a39b',w-30);
            const bw=narrow?168:200,bh=narrow?60:66,by=cy+ch+(narrow?36:44),bx=cx-bw-8;
            this.actionButton(bx,by,bw,bh,{label:'전투 시작',labelYRatio:.42,sub:'E',kind:'gold',disabled:busy||!opponent,action:()=>startBattle()});
            this.actionButton(cx+8,by,bw,bh,{label:'돌아가기',disabled:busy,action:()=>{location.href=DASHBOARD_URL;}});
        }
        countdownLayer(w,h){
            if(stage!=='battle'||!view||view.phase!=='countdown')return;
            const remain=Number(view.startedAt||0)-now();
            if(remain<=0)return;
            const count=Math.max(1,Math.ceil(remain/1000)),frac=(remain%1000)/1000,c=this.ctx,narrow=w<700;
            if(this.countTick!==count){this.countTick=count;audio.play('count',.5);}
            c.save();c.globalAlpha=clamp(frac*1.8,.2,1);c.translate(w/2,h*.42);
            const scale=reducedMotion?1:.72+(1-frac)*.46;c.scale(scale,scale);
            this.gameText(String(count),0,0,narrow?78:112,'center','#fff7e8');
            c.restore();
            this.text('전투 준비',w/2,h*.42+(narrow?62:84),narrow?11:13,800,'center','#e8b04b');
        }
        addPop(pop){this.damagePops.push(Object.assign({start:performance.now()+(Number(pop&&pop.delay)||0),side:'opp',y:.44,size:30,color:'#ffe06e',label:'',sub:''},pop));}
        damageLayer(w,h){
            const time=performance.now(),narrow=w<700;
            this.damagePops=this.damagePops.filter(pop=>{
                const p=(time-pop.start)/950;
                if(p<0)return true;
                if(p>=1)return false;
                const ease=1-Math.pow(1-clamp(p,0,1),3),x=w*sideX(pop.side,narrow),y=h*pop.y-ease*62,
                    alpha=clamp(Math.min(p*8,(1-p)*3.4),0,1),scale=.7+Math.sin(Math.min(1,p)*Math.PI)*.36;
                this.ctx.save();this.ctx.globalAlpha=alpha;this.ctx.translate(x,y);this.ctx.scale(scale,scale);
                if(pop.label)this.text(pop.label,0,-26,narrow?10:12,900,'center','#ffb0a8');
                this.text(pop.text,0,0,narrow?pop.size*.76:pop.size,900,'center',pop.color);
                if(pop.sub)this.text(pop.sub,0,25,narrow?9:11,800,'center','#efe4cd');
                this.ctx.restore();
                return true;
            });
        }
        bannerLayer(w,h){
            if(!this.banner||this.bannerUntil<=performance.now())return;
            const remain=this.bannerUntil-performance.now(),age=1-clamp(remain/1250,0,1),alpha=clamp(Math.min(age*5,remain/220),0,1),narrow=w<700,c=this.ctx,cx=w/2,y=h*(narrow?.3:.33),bw=Math.max(60,Math.min(w-40,narrow?310:460));
            c.save();c.globalAlpha=alpha;
            const glow=c.createRadialGradient(cx,y,0,cx,y,bw*.58);glow.addColorStop(0,'rgba(232,176,75,.2)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(cx-bw*.7,y-70,bw*1.4,140);
            this.line(cx-bw/2,y-22,cx-72,y-22,'rgba(232,176,75,.8)',1);this.line(cx+72,y-22,cx+bw/2,y-22,'rgba(232,176,75,.8)',1);
            this.text(this.banner,cx,y,narrow?25:36,900,'center','#fff8e8');
            if(this.bannerSub)this.text(this.bannerSub,cx,y+29,narrow?10:12,800,'center','#e8b04b');
            c.restore();
        }
        resultLayer(w,h){
            if(stage!=='result'||!view||!view.result)return;
            this.regions=[];
            const c=this.ctx,result=view.result,narrow=w<700,win=result.outcome==='win',cx=w/2,delta=Number(result.ratingDelta||0);
            c.fillStyle='rgba(2,3,6,.88)';c.fillRect(0,0,w,h);
            const glow=c.createRadialGradient(cx,h*.3,0,cx,h*.3,Math.min(w,h)*.6);
            glow.addColorStop(0,win?'rgba(232,176,75,.28)':'rgba(120,26,22,.34)');glow.addColorStop(1,'rgba(0,0,0,0)');
            c.fillStyle=glow;c.fillRect(0,0,w,h);
            this.gameText(win?'승리':'패배',cx,h*.28,narrow?52:76,'center',win?'#ffe4a8':'#e0655c');
            this.text(REASON_LABELS[result.reason]||'',cx,h*.28+(narrow?44:60),narrow?12:14,800,'center','#c9c8c5');
            this.line(cx-Math.min(180,w*.34),h*.46,cx-40,h*.46,'rgba(232,176,75,.6)',1);
            this.line(cx+40,h*.46,cx+Math.min(180,w*.34),h*.46,'rgba(232,176,75,.6)',1);
            this.text('레이팅',cx,h*.52,narrow?10:12,800,'center','#9da5b3');
            this.text(number(result.ratingBefore)+'  →  '+number(result.ratingAfter),cx,h*.52+26,narrow?20:26,900,'center','#f7f2e8');
            this.text('('+(delta>0?'+':'')+number(delta)+')',cx,h*.52+52,narrow?12:14,900,'center',delta>=0?'#7fe0a4':'#e0655c');
            const bw=narrow?190:220;
            this.actionButton(cx-bw/2,h*.78,bw,48,{label:'확인',kind:'gold',disabled:busy,action:()=>closeBattle()});
        }
        dialogLayer(w,h){
            if(!dialog)return;
            this.regions=[];
            const c=this.ctx;c.fillStyle='rgba(0,0,0,.78)';c.fillRect(0,0,w,h);
            const narrow=w<700,bw=Math.min(w-28,narrow?340:420),bh=narrow?196:212,x=(w-bw)/2,y=(h-bh)/2;
            this.panel(x,y,bw,bh,'rgba(232,176,75,.65)',true);
            this.text(dialog.title,w/2,y+42,narrow?21:25,900,'center','#fff7e8');
            this.line(x+38,y+67,x+bw-38,y+67,'rgba(232,176,75,.34)',1);
            cleanText(dialog.message).split('\n').map(cleanText).filter(Boolean).slice(0,4).forEach((line,index)=>this.text(line,w/2,y+96+index*18,narrow?10:12,650,'center','#c9c8c5',bw-34));
            const gap=8,buttonW=(bw-52-gap)/2,by=y+bh-60;
            this.actionButton(x+26,by,buttonW,40,{label:'취소',action:dialog.cancel});
            this.actionButton(x+26+buttonW+gap,by,buttonW,40,{label:dialog.okLabel,kind:'attack',action:dialog.ok});
        }
        loading(w,h){if(stage!=='loading')return;this.ctx.fillStyle='rgba(0,0,0,.68)';this.ctx.fillRect(0,0,w,h);const a=performance.now()/450;this.ctx.beginPath();this.ctx.arc(w/2,h/2,26,a,a+Math.PI*1.35);this.ctx.strokeStyle='#e8b04b';this.ctx.lineWidth=3;this.ctx.stroke();}
        draw(){
            const{w,h}=this.resize(),c=this.ctx;c.clearRect(0,0,w,h);this.regions=[];
            const shake=this.shakeUntil>performance.now()&&!reducedMotion?(Math.random()-.5)*8:0;
            c.save();c.translate(shake,0);
            this.timerHud(w);this.oppPlate(w);this.myPlate(w,h);this.sideBadges(w,h);this.combatLog(w,h);this.actions(w,h);
            this.lobbyLayer(w,h);this.topControls(w);
            this.damageLayer(w,h);this.countdownLayer(w,h);this.bannerLayer(w,h);
            this.resultLayer(w,h);this.dialogLayer(w,h);this.loading(w,h);
            if(this.flashUntil>performance.now()){const left=this.flashUntil-performance.now();c.fillStyle='rgba(255,255,255,'+clamp(left/this.flashDuration,0,.34)+')';c.fillRect(0,0,w,h);}
            c.restore();
            this.frame=requestAnimationFrame(()=>this.draw());
        }
        impact(strong){this.flashDuration=strong?260:130;this.flashUntil=performance.now()+this.flashDuration;if(strong)this.shakeUntil=performance.now()+380;}
        showBanner(text,sub){this.banner=text;this.bannerSub=sub||'';this.bannerUntil=performance.now()+1250;}
    }

    const audio = new PvpAudio();
    let renderer;
    try { renderer = new FieldRenderer(sceneCanvas); } catch (error) { console.error(error); }
    const hud = new Hud(hudCanvas);

    function addLog(message, tone) {
        String(message || '').split('\n').map(cleanText).filter(Boolean).forEach(line => logs.push({ text: line, tone: tone || '' }));
        logs = logs.slice(-12);
    }
    function setBusy(value) { busy = value; }
    function showDialog(title, message, okLabel) {
        return new Promise(resolve => { dialog = { title, message, okLabel, cancel: () => { dialog = null; resolve(false); }, ok: () => { dialog = null; resolve(true); } }; });
    }

    function applyView(next, options) {
        if (!next) return;
        const silent = !!(options && options.silent);
        clockOffset = Number(next.serverNow || Date.now()) - Date.now();
        const events = (next.events || []).filter(event => Number(event.seq || 0) > lastSeq).sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
        lastSeq = events.reduce((max, event) => Math.max(max, Number(event.seq || 0)), Math.max(lastSeq, Number(next.seq || 0)));
        const hadResult = !!(view && view.result);
        view = next;
        stage = next.result ? 'result' : 'battle';
        if (renderer) renderer.setSides(next.me, next.opp);
        if (silent) events.forEach(event => addLog(event.text));
        else events.forEach((event, index) => setTimeout(() => playEvent(event), index * 140));
        if (stage === 'battle') audio.playBgm(); else audio.stopBgm();
        if (next.result && !hadResult) showResult(next.result, silent);
    }

    function showResult(result, silent) {
        audio.stopBgm();
        if (silent) return;
        setTimeout(() => {
            hud.impact(true);
            audio.play(result.outcome === 'win' ? 'clear' : 'fail', .8);
        }, 260);
    }

    function playEvent(event) {
        if (!event) return;
        const actor = event.actor === 'opp' ? 'opp' : 'me', target = actor === 'me' ? 'opp' : 'me', action = event.action || 'attack';
        addLog(event.text, actor === 'opp' && Number(event.damage || 0) > 0 ? 'bad' : action === 'start' ? 'good' : '');
        if (action === 'start') { hud.showBanner('전투 시작', view && view.opp ? view.opp.name : ''); audio.play('start', .76); hud.impact(true); return; }
        if (action === 'ko' || action === 'timeout' || action === 'forfeit') return;
        if (action === 'defend') { if (renderer) renderer.defendPulse(actor); audio.play('count', .3); return; }
        if (action === 'shield') {
            const amount = Number(event.shield || event.heal || 0);
            if (amount > 0) hud.addPop({ side: actor, text: '+' + number(amount) + ' 보호막', color: '#eaf2ff', size: 22, y: .5 });
            return;
        }
        if (event.dodged) { hud.addPop({ side: target, text: '회피', color: '#cdd6e2', size: 26 }); return; }
        const damage = Number(event.damage || 0), critical = Number(event.criticalCount || 0) > 0;
        if (action === 'summon' || action === 'dot') {
            if (damage > 0) {
                if (renderer) renderer.tickHit(target);
                hud.addPop({ side: target, text: (target === 'me' ? '-' : '') + number(damage), color: target === 'me' ? '#ff8f87' : '#ffd88a', size: 24, sub: event.skillName || (action === 'dot' ? '지속 피해' : '소환수') });
                hud.impact(false); audio.hit();
            }
            return;
        }
        if (renderer) renderer.lunge(actor, action);
        if (damage > 0) {
            if (renderer) renderer.strike(target, event);
            hud.addPop({
                side: target, text: (target === 'me' ? '-' : '') + number(damage),
                color: target === 'me' ? '#ff8f87' : critical ? '#ff5d4d' : '#ffe06e',
                size: target === 'me' ? 28 : critical ? 46 : 34, label: critical ? '치명타' : '', sub: event.skillName || ''
            });
            if (action === 'skill') audio.play('skill', .68); else audio.hit();
            if (critical) { audio.play('crit', .82); hud.impact(true); } else hud.impact(false);
        } else if (action === 'skill') audio.play('skill', .68);
        if (Number(event.selfDamage || 0) > 0) hud.addPop({ side: actor, text: '-' + number(event.selfDamage), color: '#ff8f87', size: 22, y: .5, delay: 120 });
        if (Number(event.heal || 0) > 0) hud.addPop({ side: actor, text: 'HP +' + number(event.heal), color: '#63f29b', size: 22, y: .5, delay: 120 });
    }

    async function loadLobby() {
        stage = 'lobby';
        try {
            const payload = await request('/api/pvp');
            const opponents = payload.daily && payload.daily.opponents || [];
            lobby = { me: lobbyMe(payload.me), opponent: opponents.find(entry => entry.name === OPPONENT) || null };
            if (OPPONENT && !lobby.opponent) lobbyError = '오늘의 상대 목록에서 찾을 수 없는 상대입니다.';
            if (renderer) renderer.setSides(lobby.me, lobby.opponent);
        } catch (error) {
            lobbyError = error.message;
        }
    }
    // GET /api/pvp의 me.mainCard를 상대 슬롯과 같은 필드 이름으로 정규화
    function lobbyMe(me) {
        if (!me) return null;
        const card = me.mainCard || {};
        return {
            name: me.name, level: me.level, rating: me.rating, spriteUrl: card.spriteUrl || '',
            cardName: card.name, cardFormatted: card.formatted, cardImageUrl: card.imageUrl, cardStar: card.star, cardType: card.type
        };
    }

    async function poll() {
        if (busy || polling) return;
        polling = true;
        try {
            const next = extractView(await request('/api/pvp/battle?since=' + lastSeq));
            if (next) applyView(next);
            else if (view && !view.result) { view = null; lastSeq = 0; audio.stopBgm(); loadLobby(); }
        } catch (_) { /* 폴링 실패는 무시하고 다음 주기에 재시도 */ }
        finally { polling = false; }
    }

    async function startBattle() {
        if (busy || stage !== 'lobby' || !OPPONENT) return;
        audio.unlock(); setBusy(true);
        try {
            const payload = await request('/api/pvp/battle/start', { opponent: OPPONENT });
            const next = extractView(payload);
            if (next) applyView(next);
            else { addLog(payload.message || '전투를 시작하지 못했습니다.', 'bad'); audio.play('fail', .42); }
        } catch (error) { addLog(error.message, 'bad'); audio.play('fail', .42); }
        finally { setBusy(false); }
        if (stage === 'battle') poll();
    }

    async function act(path, body) {
        if (busy || dialog || stage !== 'battle' || !view || view.phase !== 'fight') return;
        audio.unlock(); setBusy(true);
        try {
            const payload = await request(path, body || {});
            if (payload && payload.ok === false) { addLog(payload.message, 'bad'); audio.play('fail', .38); }
            const next = extractView(payload);
            if (next) applyView(next);
        } catch (error) { addLog(error.message, 'bad'); audio.play('fail', .42); }
        finally { setBusy(false); }
    }
    function ready() { return view && view.me && now() >= Number(view.me.nextActionAt || 0); }
    function attack() { if (ready()) act('/api/pvp/battle/attack', {}); }
    function defend() { if (ready()) act('/api/pvp/battle/defend', {}); }
    function useSkill(name) {
        const skill = view && view.me && (view.me.skills || []).find(entry => entry.name === name);
        if (!skill || !ready() || now() < Number(skill.cooldownEnd || 0)) return;
        act('/api/pvp/battle/skill', { skillName: name });
    }

    async function forfeit() {
        if (busy || !view || view.result) return;
        const accepted = await showDialog('전투 포기', '패배로 기록됩니다.', '포기');
        if (!accepted) return;
        setBusy(true);
        try {
            const next = extractView(await request('/api/pvp/battle/forfeit', {}));
            if (next) applyView(next);
        } catch (error) { addLog(error.message, 'bad'); }
        finally { setBusy(false); }
    }

    async function closeBattle() {
        if (busy) return;
        setBusy(true);
        try { await request('/api/pvp/battle/close', {}); } catch (_) { /* 결과 화면은 닫고 대시보드로 */ }
        location.href = DASHBOARD_URL;
    }

    function backOrForfeit() {
        if (dialog) { dialog.cancel(); return; }
        if (stage === 'result') { closeBattle(); return; }
        if (stage === 'battle' && view && !view.result) { forfeit(); return; }
        location.href = DASHBOARD_URL;
    }

    document.addEventListener('keydown', event => {
        if (event.repeat) return;
        audio.unlock();
        const key = event.key.toLowerCase();
        if (key === 'escape') { event.preventDefault(); backOrForfeit(); return; }
        if (dialog) { if (key === 'enter') dialog.ok(); return; }
        if (stage === 'result') { if (key === 'enter' || key === ' ') { event.preventDefault(); closeBattle(); } return; }
        if (stage === 'lobby') { if (key === 'e') startBattle(); return; }
        if (stage !== 'battle') return;
        if (key === ' ' || key === 'j') { event.preventDefault(); attack(); return; }
        if (key === 'd') { event.preventDefault(); defend(); return; }
        if (/^[1-9]$/.test(key)) {
            const skill = view && view.me && (view.me.skills || [])[Number(key) - 1];
            if (skill) useSkill(skill.name);
        }
    });
    document.addEventListener('visibilitychange', () => { if (document.hidden) audio.stopBgm(); else { audio.playBgm(); poll(); } });
    window.addEventListener('beforeunload', () => audio.stopBgm());

    (async function boot() {
        try {
            const next = extractView(await request('/api/pvp/battle?since=0'));
            if (next) applyView(next, { silent: true });
            else await loadLobby();
        } catch (error) {
            lobbyError = error.message;
            stage = 'lobby';
        }
        if (stage === 'battle') addLog('전투를 이어서 진행합니다.');
        setInterval(() => { if (view && (view.phase === 'countdown' || view.phase === 'fight')) poll(); }, 1000);
    })();
})();
