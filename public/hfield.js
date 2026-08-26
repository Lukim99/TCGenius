(function () {
    'use strict';

    const sceneCanvas = document.getElementById('hfCanvas');
    const hudCanvas = document.getElementById('hfHud');
    if (!sceneCanvas || !hudCanvas) return;

    const uiAsset = file => '/rpg-ui?file=' + encodeURIComponent(file);
    const effectCatalog = window.CombatEffects || null;
    const regularMode = window.FIELD_MODE === 'regular';
    const apiBase = regularMode ? '/api/field' : '/api/hfield';
    const ASSETS = {
        background: uiAsset(regularMode ? '필드/뉴비즈.png' : '필드/부타게임H.png'),
        buta: uiAsset('필드/hfield-buta.png'),
        pillar: uiAsset('필드/hfield-pillar.png'),
        impact: uiAsset('필드/hfield-impact-v2.png'),
        mythicSigil: uiAsset('필드/hfield-mythic-sigil.png'),
        transcendSigil: uiAsset('필드/hfield-transcend-sigil.png')
    };
    const SOUNDS = {
        bgm: uiAsset(regularMode ? 'sfx/사냥.mp3' : 'sfx/부타게임H.mp3'), start: uiAsset('sfx/start.mp3'),
        hit0: uiAsset('sfx/hit_0.mp3'), hit1: uiAsset('sfx/hit_1.mp3'), hit2: uiAsset('sfx/hit_2.mp3'),
        crit: uiAsset('sfx/crit.mp3'), skill: uiAsset('sfx/skill.mp3'), clear: uiAsset('sfx/clear.mp3'),
        fail: uiAsset('sfx/fail.mp3'), count: uiAsset('sfx/count.mp3'), potion: uiAsset('sfx/potion.mp3')
    };
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const CARD_AURA_COLORS = {
        9: [.5,1,.18,1],
        10: [.2,.76,1,1],
        11: [1,.12,.1,1]
    };
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const ratio = (value, max) => clamp(Number(value || 0) / Math.max(1, Number(max || 1)), 0, 1);
    const number = value => Number(value || 0).toLocaleString('ko-KR');
    const cleanText = value => String(value || '')
        .replace(/\p{Extended_Pictographic}/gu, '').replace(/[\uFE0E\uFE0F\u200D]/g, '')
        .replace(/^[-•]\s*/, '').trim();
    const ELEMENT_EFFECT_COLORS = {
        '화': [1,.2,.04,1], '수': [.05,.68,1,1], '명': [1,.86,.25,1], '암': [.58,.16,1,1]
    };
    function combatEffectProfile(event, hit) {
        const action = String(event && event.action || '');
        const name = String(event && (event.skillName || event.source) || '');
        const label = String(hit && hit.label || '');
        const text = name + ' ' + label;
        const element = event && event.effectElement || null;
        const explicit = event && event.effectKind;
        if (['burn','summon','element','equipment','skill'].includes(explicit)) return { kind: explicit, element };
        if (action === 'summon' || /익테봇|수나타|소환/.test(text)) return { kind: 'summon', element };
        if (/화상|겁화|장송곡/.test(text)) return { kind: 'burn', element: '화' };
        if (/그림자 공격|심판 폭발|천공 폭발|가시 반사/.test(text)) return { kind: 'equipment', element: /그림자|가시/.test(text) ? '암' : '명' };
        if (/프리즘|속성 추가 피해|추가 피해|고정 피해|000|Celestia|징수의 총|중퇴/.test(label)) return { kind: label.includes('속성') ? 'element' : 'equipment', element };
        if (action === 'skill' && hit && Number(hit.presentationIndex || 0) > 0) return { kind: 'hit', element };
        if (action === 'skill') return { kind: 'skill', element };
        if (action === 'dot' || action === 'tick') return { kind: 'skill', element };
        if (element) return { kind: 'element', element };
        return { kind: 'hit', element: null };
    }

    let state = null;
    let busy = false;
    let clockOffset = 0;
    let pollTimer = null;
    let logs = [];
    let dialog = null;
    let rewards = null;
    let selectedFieldName = '';

    async function request(url, body) {
        const options = body === undefined ? {} : {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
        };
        const response = await fetch(url, options);
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || '요청을 처리하지 못했습니다.');
        return payload;
    }

    class FieldAudio {
        constructor() {
            this.storageKey = regularMode ? 'field-muted' : 'hfield-muted';
            try { this.muted = localStorage.getItem(this.storageKey) === '1'; } catch (_) { this.muted = false; }
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
        playBgm() { if (!this.muted && state && state.inField) this.bgm.play().catch(() => {}); }
        stopBgm() { this.bgm.pause(); }
        toggle() {
            this.muted = !this.muted;
            try { localStorage.setItem(this.storageKey, this.muted ? '1' : '0'); } catch (_) {}
            if (this.muted) this.stopBgm(); else { this.unlock(); this.playBgm(); this.play('count', .32); }
        }
        fanfare(tier) {
            if (this.muted) return;
            this.unlock();
            if (!this.context) return;
            const now = this.context.currentTime;
            const notes = tier === 'mythic' ? [392, 523.25, 659.25, 783.99, 1046.5] : [329.63, 440, 554.37, 659.25];
            notes.forEach((frequency, index) => {
                const oscillator = this.context.createOscillator();
                const gain = this.context.createGain();
                oscillator.type = index % 2 ? 'triangle' : 'sine';
                oscillator.frequency.setValueAtTime(frequency, now + index * .09);
                gain.gain.setValueAtTime(.0001, now + index * .09);
                gain.gain.exponentialRampToValueAtTime(tier === 'mythic' ? .11 : .07, now + index * .09 + .025);
                gain.gain.exponentialRampToValueAtTime(.0001, now + index * .09 + .42);
                oscillator.connect(gain).connect(this.context.destination);
                oscillator.start(now + index * .09);
                oscillator.stop(now + index * .09 + .45);
            });
            const sweep=this.context.createOscillator(),sweepGain=this.context.createGain();
            sweep.type='sawtooth';sweep.frequency.setValueAtTime(tier==='mythic'?110:82,now);sweep.frequency.exponentialRampToValueAtTime(tier==='mythic'?880:660,now+.55);
            sweepGain.gain.setValueAtTime(.0001,now);sweepGain.gain.exponentialRampToValueAtTime(.045,now+.08);sweepGain.gain.exponentialRampToValueAtTime(.0001,now+.7);sweep.connect(sweepGain).connect(this.context.destination);sweep.start(now);sweep.stop(now+.72);
            const buffer=this.context.createBuffer(1,Math.floor(this.context.sampleRate*.32),this.context.sampleRate),data=buffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/data.length,2);const noise=this.context.createBufferSource(),noiseGain=this.context.createGain();noise.buffer=buffer;noiseGain.gain.setValueAtTime(.075,now);noiseGain.gain.exponentialRampToValueAtTime(.0001,now+.32);noise.connect(noiseGain).connect(this.context.destination);noise.start(now);
        }
    }

    class FieldRenderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false });
            if (!this.gl) throw new Error('WebGL을 지원하지 않는 브라우저입니다.');
            this.textures = {};
            this.particles = [];
            this.effectSprites = [];
            this.recentEffects = new Map();
            this.playerUrl = '';
            this.frame = 0;
            this.last = performance.now();
            this.ambientAt = 0;
            this.attackAt = 0;
            this.attackKind = 'attack';
            this.targetHitUntil = 0;
            this.playerHitUntil = 0;
            this.impactUntil = 0;
            this.impactStarted = 0;
            this.impactCritical = false;
            this.impactSkill = false;
            this.impactX = .74;
            this.impactY = .54;
            this.holdState = null;
            this.backgroundUrl = ASSETS.background;
            this.monsterAtlasUrl = '';
            this.mobFlights = [];
            this.mobImpactIndex = 1;
            this.mobLastImpactIndex = 1;
            this.mobHiddenUntil = [];
            this.mobRespawnAt = 0;
            this.eliteIntro = null;
            this.mobReturnAt = 0;
            this.initGl();
            Object.entries(ASSETS).forEach(([name, url]) => this.loadTexture(name, url));
            this.frame = requestAnimationFrame(time => this.render(time));
        }
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
                precision mediump float; uniform sampler2D uTexture; uniform vec4 uColor; uniform vec4 uUvRect; uniform float uMode; uniform float uFlash; varying vec2 vUv;
                void main(){vec4 p;if(uMode<0.5){p=texture2D(uTexture,uUvRect.xy+vUv*uUvRect.zw);p.rgb*=uColor.rgb;p.a*=uColor.a;}else if(uMode<1.5){float d=length((vUv-.5)*2.0);p=vec4(uColor.rgb,(1.0-smoothstep(0.0,1.0,d))*uColor.a);}else if(uMode<2.5){float l=1.0-smoothstep(.025,.22,abs(vUv.y-.5));float e=smoothstep(0.0,.2,vUv.x)*smoothstep(0.0,.2,1.0-vUv.x);p=vec4(uColor.rgb,l*e*uColor.a);}else if(uMode<3.5){p=uColor;}else if(uMode<4.5){float d=length((vUv-.5)*2.0);float ring=1.0-smoothstep(.04,.16,abs(d-.7));float glow=(1.0-smoothstep(.55,1.0,d))*.22;p=vec4(uColor.rgb,max(ring,glow)*uColor.a);}else if(uMode<5.5){float taper=1.0-abs(vUv.y*2.0-1.0);float width=.018+.12*taper*taper;float bend=(vUv.y-.5)*.12;float blade=1.0-smoothstep(width,width+.035,abs(vUv.x-.5+bend));float edge=smoothstep(0.0,.14,vUv.y)*smoothstep(0.0,.14,1.0-vUv.y);p=vec4(uColor.rgb,blade*edge*uColor.a);}else if(uMode<6.5){vec4 t=texture2D(uTexture,vUv);float b=0.0;b+=texture2D(uTexture,vUv+vec2(.006,0.0)).a*3.0;b+=texture2D(uTexture,vUv-vec2(.006,0.0)).a*3.0;b+=texture2D(uTexture,vUv+vec2(0.0,.004)).a*3.0;b+=texture2D(uTexture,vUv-vec2(0.0,.004)).a*3.0;b+=texture2D(uTexture,vUv+vec2(.012,.008)).a*2.0;b+=texture2D(uTexture,vUv+vec2(-.012,.008)).a*2.0;b+=texture2D(uTexture,vUv+vec2(.012,-.008)).a*2.0;b+=texture2D(uTexture,vUv-vec2(.012,.008)).a*2.0;b+=texture2D(uTexture,vUv+vec2(.022,0.0)).a;b+=texture2D(uTexture,vUv-vec2(.022,0.0)).a;b+=texture2D(uTexture,vUv+vec2(0.0,.015)).a;b+=texture2D(uTexture,vUv-vec2(0.0,.015)).a;b+=texture2D(uTexture,vUv+vec2(.026,.018)).a*.7;b+=texture2D(uTexture,vUv+vec2(-.026,.018)).a*.7;b+=texture2D(uTexture,vUv+vec2(.026,-.018)).a*.7;b+=texture2D(uTexture,vUv-vec2(.026,.018)).a*.7;b/=24.8;float glow=pow(clamp(b,0.0,1.0),1.35)*(1.0-t.a*.72);p=vec4(uColor.rgb,glow*uColor.a);}else{vec4 t=texture2D(uTexture,vUv);float b=0.0;b+=texture2D(uTexture,vUv+vec2(.018,0.0)).a*2.0;b+=texture2D(uTexture,vUv-vec2(.018,0.0)).a*2.0;b+=texture2D(uTexture,vUv+vec2(0.0,.012)).a*2.0;b+=texture2D(uTexture,vUv-vec2(0.0,.012)).a*2.0;b+=texture2D(uTexture,vUv+vec2(.035,.024)).a;b+=texture2D(uTexture,vUv+vec2(-.035,.024)).a;b+=texture2D(uTexture,vUv+vec2(.035,-.024)).a;b+=texture2D(uTexture,vUv-vec2(.035,.024)).a;b+=texture2D(uTexture,vUv+vec2(.052,.036)).a*.6;b+=texture2D(uTexture,vUv+vec2(-.052,.036)).a*.6;b+=texture2D(uTexture,vUv+vec2(.052,-.036)).a*.6;b+=texture2D(uTexture,vUv-vec2(.052,.036)).a*.6;b/=14.4;float glow=pow(clamp(b,0.0,1.0),1.18)*(1.0-t.a*.88);p=vec4(uColor.rgb,glow*uColor.a);}p.rgb=mix(p.rgb,vec3(1.0),uFlash);if(p.a<.01)discard;gl_FragColor=p;}`);
            const program = gl.createProgram();
            gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
            this.program = program;
            this.loc = {
                position: gl.getAttribLocation(program, 'aPosition'), rect: gl.getUniformLocation(program, 'uRect'),
                rotation: gl.getUniformLocation(program, 'uRotation'), texture: gl.getUniformLocation(program, 'uTexture'),
                color: gl.getUniformLocation(program, 'uColor'), uvRect: gl.getUniformLocation(program, 'uUvRect'),
                mode: gl.getUniformLocation(program, 'uMode'), flash: gl.getUniformLocation(program, 'uFlash')
            };
            this.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5,-.5,.5,-.5,-.5,.5,.5,.5]), gl.STATIC_DRAW);
            this.white = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.white);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255,255,255,255]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(program); gl.uniform1i(this.loc.texture, 0);
        }
        loadTexture(name, url, transparent) {
            const gl = this.gl;
            const previous = this.textures[name];
            const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(transparent ? [0,0,0,0] : [8,12,24,255]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            const entry = this.textures[name] = { texture, aspect: 1, ready: false };
            if (previous && previous.texture) gl.deleteTexture(previous.texture);
            const image = new Image(); image.decoding = 'async';
            image.onload = () => {
                if (this.textures[name] !== entry) { gl.deleteTexture(texture); return; }
                gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
                entry.aspect = image.naturalWidth / Math.max(1, image.naturalHeight); entry.ready = true;
            };
            image.onerror = () => { entry.failed = true; };
            image.src = url;
        }
        setState(next) {
            if (next && next.player && next.player.spriteUrl && this.playerUrl !== next.player.spriteUrl) {
                this.playerUrl = next.player.spriteUrl; this.loadTexture('player', this.playerUrl);
            }
            if (regularMode && next) {
                const active = next.activeField || next.currentField || (next.fields || []).find(field => field && field.name === next.fieldName);
                if (active) this.previewField(active);
            }
            this.state = next;
        }
        previewField(field) {
            if (!regularMode || !field) return;
            const backgroundUrl = field.backgroundUrl || field.background || '';
            const monster = field.monster || {};
            const atlasUrl = monster.atlasUrl || field.atlasUrl || '';
            if (backgroundUrl && backgroundUrl !== this.backgroundUrl) {
                this.backgroundUrl = backgroundUrl; this.loadTexture('background', backgroundUrl);
            }
            if (atlasUrl && atlasUrl !== this.monsterAtlasUrl) {
                this.monsterAtlasUrl = atlasUrl; this.loadTexture('monsterAtlas', atlasUrl);
            }
        }
        releaseHold() { this.holdState = null; }
        resize() {
            const dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(1, Math.round(innerWidth * dpr)), h = Math.max(1, Math.round(innerHeight * dpr));
            if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; this.gl.viewport(0, 0, w, h); }
        }
        draw(entry, x, y, w, h, options) {
            const gl = this.gl, opts = options || {}, color = opts.color || [1,1,1,1], uv = opts.uv || [0,0,1,1];
            gl.useProgram(this.program); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer); gl.enableVertexAttribArray(this.loc.position);
            gl.vertexAttribPointer(this.loc.position, 2, gl.FLOAT, false, 0, 0); gl.uniform4f(this.loc.rect, x, y, w, h);
            gl.uniform1f(this.loc.rotation, opts.rotation || 0); gl.uniform4f(this.loc.color, color[0], color[1], color[2], color[3] == null ? 1 : color[3]);
            gl.uniform4f(this.loc.uvRect, uv[0], uv[1], uv[2], uv[3]);
            gl.uniform1f(this.loc.mode, opts.mode || 0); gl.uniform1f(this.loc.flash, opts.flash || 0); gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, entry && entry.texture || this.white); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        fit(name, height, maxWidth) {
            const aspect = this.canvas.width / Math.max(1, this.canvas.height);
            let width = height * Number(this.textures[name] && this.textures[name].aspect || .7) / Math.max(.35, aspect);
            if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
            return { width, height };
        }
        fitAtlas(height, maxWidth, rows) {
            const aspect = this.canvas.width / Math.max(1, this.canvas.height);
            const cellAspect = Number(this.textures.monsterAtlas && this.textures.monsterAtlas.aspect || 1) * Math.max(1, Number(rows || 4)) / 2;
            let width = height * cellAspect / Math.max(.35, aspect);
            if (width > maxWidth) { height *= maxWidth / width; width = maxWidth; }
            return { width, height };
        }
        monsterUv(monster, elite) {
            const rows = Math.max(1, Number(monster && monster.rows || 4));
            const row = clamp(Number(monster && monster.row || 0), 0, rows - 1);
            return [elite ? .5 : 0, row / rows, .5, 1 / rows];
        }
        cover(name) {
            const sourceAspect=Number(this.textures[name]&&this.textures[name].aspect||1),canvasAspect=this.canvas.width/Math.max(1,this.canvas.height);
            return sourceAspect>canvasAspect?{width:sourceAspect/canvasAspect,height:1}:{width:1,height:canvasAspect/sourceAspect};
        }
        particle(p) {
            if (this.particles.length > 120 || (reducedMotion && this.particles.length > 24)) return;
            this.particles.push(Object.assign({x:.5,y:.5,vx:0,vy:0,life:.7,maxLife:.7,width:.014,height:.014,rotation:0,spin:0,gravity:.07,grow:0,delay:0,color:[1,.3,.2,1],mode:1}, p));
        }
        burst(x, y, color, count) {
            for (let i = 0; i < (reducedMotion ? 8 : count); i++) {
                const angle = Math.random() * Math.PI * 2, speed = .08 + Math.random() * .25;
                const spark = i % 3 === 0;
                this.particle({x,y,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed,life:.45+Math.random()*.55,maxLife:1,width:spark?.045+Math.random()*.05:.008+Math.random()*.014,height:spark?.0035:.008+Math.random()*.014,spin:spark?angle:(Math.random()-.5)*5,color,mode:spark?2:1});
            }
        }
        effectTexture(effectId) {
            if (!effectCatalog) return null;
            const url = effectCatalog.assetUrl(effectId);
            if (!url) return null;
            const key = 'effect:' + effectId;
            if (!this.textures[key]) this.loadTexture(key, url, true);
            return key;
        }
        playEffectAssets(x, y, effectIds, options) {
            if (!effectCatalog) return;
            const opts = options || {}, role = opts.role === 'actor' ? 'actor' : 'target', now = performance.now();
            if (this.recentEffects.size > 128) this.recentEffects.forEach((at, token) => { if (now - at > 5000) this.recentEffects.delete(token); });
            const candidates = effectCatalog.unique(effectIds || []).filter(effectId => {
                const token = role + ':' + Math.round(x * 20) + ':' + effectId;
                return now - Number(this.recentEffects.get(token) || 0) >= 760;
            });
            const visible = effectCatalog.presentationEffectIds ? effectCatalog.presentationEffectIds(candidates, opts.limit || 2) : candidates.slice(0, opts.limit || 2);
            visible.forEach((effectId, index) => {
                const key = this.effectTexture(effectId);
                if (!key) return;
                const profile = effectCatalog.motionProfile(effectId);
                const token = role + ':' + Math.round(x * 20) + ':' + effectId;
                this.recentEffects.set(token, now);
                this.effectSprites.push({ effectId, key, x, y, role, start: now + index * 80, duration: reducedMotion ? Math.max(320, profile.duration * .7) : profile.duration, profile });
            });
            this.effectSprites = this.effectSprites.slice(-8);
        }
        drawEffectAssets(time) {
            this.effectSprites = this.effectSprites.filter(sprite => {
                if (time < sprite.start) return true;
                const progress = (time - sprite.start) / Math.max(1, sprite.duration);
                if (progress >= 1) return false;
                const entry = this.textures[sprite.key];
                if (!entry || entry.failed) return false;
                if (!entry.ready) return true;
                const pulse = Math.sin(Math.min(1, progress) * Math.PI), profile = sprite.profile;
                const scale = (.72 + pulse * .3) * (profile.aura ? .92 + progress * .08 : 1);
                const alpha = clamp(Math.min(progress * 6, (1 - progress) * 2.8), 0, 1) * Number(profile.alpha || .5);
                const fit = this.fit(sprite.key, profile.size * scale, sprite.role === 'actor' ? .34 : .4);
                this.draw(entry, sprite.x, sprite.y - (profile.aura ? progress * .018 : 0), fit.width, fit.height, {
                    color: [1,1,1,alpha], rotation: profile.rotation * (1 - progress) + (profile.aura ? 0 : progress * .025)
                });
                return true;
            });
        }
        combatEffect(x, y, event, hit, originX) {
            const effectIds = effectCatalog && effectCatalog.effectIdsFor
                ? effectCatalog.effectIdsFor(event, 'target', hit)
                : hit && hit.effectIds && hit.effectIds.length ? hit.effectIds : event && event.effectIds;
            this.playEffectAssets(x, y, effectIds, { role: 'target' });
            const effect = combatEffectProfile(event, hit), color = ELEMENT_EFFECT_COLORS[effect.element] || [.35,.72,1,1];
            const count = reducedMotion ? 4 : 10;
            const ring = (ringColor, size, delay) => this.particle({x,y,life:.48,maxLife:.48,width:size,height:size,color:ringColor,mode:4,grow:.72,gravity:0,delay:delay||0});
            if (effect.kind === 'hit') { this.burst(x,y,[1,.2,.12,.68],14); return; }
            if (effect.kind === 'burn') {
                ring([1,.14,.02,.62],.1,0);
                for(let i=0;i<count;i++)this.particle({x:x+(Math.random()-.5)*.08,y:y+.055+Math.random()*.035,vx:(Math.random()-.5)*.025,vy:-.09-Math.random()*.13,life:.45+Math.random()*.35,maxLife:.8,width:.012+Math.random()*.016,height:.028+Math.random()*.035,color:i%3?[1,.16,.02,.66]:[1,.72,.08,.62],mode:i%4===0?5:1,gravity:-.025});
                return;
            }
            if (effect.kind === 'summon') {
                const origin = this.playerEffectPoint('actor'), fromX = Number.isFinite(originX) ? originX : origin.x, fromY = origin.y, dx=x-fromX, dy=y-fromY, distance=Math.sqrt(dx*dx+dy*dy);
                if(distance>.04)this.particle({x:(fromX+x)/2,y:(fromY+y)/2,life:.34,maxLife:.34,width:distance,height:.011,rotation:Math.atan2(dy,dx),color:[.25,1,.72,.55],mode:2,grow:.08,gravity:0});
                ring([.18,1,.68,.62],.11,0); ring([.4,.65,1,.48],.075,.08);
                this.burst(x,y,[.24,1,.72,.62],14);
                return;
            }
            if (effect.kind === 'equipment') {
                ring([1,.72,.12,.62],.095,0); ring([.82,.22,1,.5],.13,.07);
                for(let i=0;i<count;i++){const a=i/count*Math.PI*2;this.particle({x:x+Math.cos(a)*.08,y:y+Math.sin(a)*.08,vx:-Math.cos(a)*.09,vy:-Math.sin(a)*.09,life:.45,maxLife:.45,width:i%3===0?.05:.009,height:i%3===0?.003:.009,rotation:a,color:i%2?[1,.72,.12,.64]:[.8,.25,1,.58],mode:i%3===0?2:1,gravity:0});}
                return;
            }
            if (effect.kind === 'skill') {
                ring([color[0],color[1],color[2],.62],.115,0);
                for(let i=0;i<(reducedMotion?2:4);i++){const a=i*Math.PI/(reducedMotion?2:4)+.3;this.particle({x,y,life:.42,maxLife:.42,width:.16+Math.random()*.1,height:.005,rotation:a,color:i%2?[.65,.85,1,.55]:[color[0],color[1],color[2],.58],mode:2,grow:.18,gravity:0});}
                this.burst(x,y,[color[0],color[1],color[2],.6],12);
                return;
            }
            if (effect.element === '명') {
                ring([1,.88,.28,.62],.11,0);
                for(let i=0;i<(reducedMotion?3:7);i++)this.particle({x:x+(Math.random()-.5)*.11,y:y-.1+Math.random()*.05,life:.4,maxLife:.4,width:.13+Math.random()*.1,height:.005,rotation:Math.PI/2,color:[1,.9,.38,.6],mode:2,gravity:0,delay:i*.015});
            } else if (effect.element === '암') {
                ring([.55,.12,1,.62],.13,0);
                for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,r=.07+Math.random()*.08;this.particle({x:x+Math.cos(a)*r,y:y+Math.sin(a)*r,vx:-Math.cos(a)*.1,vy:-Math.sin(a)*.1,life:.5,maxLife:.5,width:.009,height:.009,color:[.62,.15,1,.6],mode:1,gravity:0});}
            } else if (effect.element === '수') {
                ring([.05,.7,1,.6],.1,0);
                for(let i=0;i<count;i++)this.particle({x:x+(Math.random()-.5)*.1,y:y-.05+Math.random()*.08,vx:(Math.random()-.5)*.08,vy:-.03-Math.random()*.08,life:.5,maxLife:.5,width:.007,height:.024,color:i%3?[.04,.68,1,.58]:[.55,.95,1,.6],mode:i%4===0?2:1,gravity:.18});
            } else {
                ring([1,.2,.03,.62],.105,0); this.burst(x,y,[1,.26,.04,.62],14);
            }
        }
        castEffect(x, y, event, role) {
            const side = role === 'target' ? 'target' : 'actor';
            const effectIds = effectCatalog && effectCatalog.effectIdsFor ? effectCatalog.effectIdsFor(event, side) : event && event.effectIds;
            if (!effectIds || !effectIds.length) return;
            this.playEffectAssets(x, y, effectIds, { role: side });
            const profile = combatEffectProfile(event, null), color = profile.kind === 'summon' ? [.2,1,.68,1] : ELEMENT_EFFECT_COLORS[profile.element] || [.38,.72,1,1];
            this.particle({x,y:y+.012,life:.48,maxLife:.48,width:.095,height:.095,color:[color[0],color[1],color[2],.42],mode:4,grow:.5,gravity:0});
            this.burst(x,y+.012,[color[0],color[1],color[2],.46],reducedMotion?4:7);
        }
        auraInfo(player) {
            const star=Number(player&&player.cardStar),tier=star>=11?11:star>=10?10:star>=9?9:0;
            return tier ? {color:CARD_AURA_COLORS[tier],job:player.cardType==='전직'} : null;
        }
  drawPlayerAura(player,x,y,fit,time) {
      const aura=this.auraInfo(player),texture=this.textures.player;
      if(!aura||!texture||!texture.ready)return;
      const color=aura.color,
        pulse=reducedMotion?.5:(Math.sin(time/(aura.job?300:520))+1)*.5,
        shimmer=reducedMotion?.5:(Math.sin(time/(aura.job?155:260)+1.2)+1)*.5,
        bright=[Math.min(1,color[0]*.72+.28),Math.min(1,color[1]*.72+.28),Math.min(1,color[2]*.72+.28),1],
        rgba=(source,alpha)=>[source[0],source[1],source[2],alpha],
        outerAlpha=(aura.job?.34:.25)+pulse*(aura.job?.2:.14),
        innerAlpha=(aura.job?.62:.46)+shimmer*(aura.job?.2:.14);
      this.draw(texture,x,y,fit.width,fit.height,{mode:7,color:rgba(color,outerAlpha)});
      this.draw(texture,x,y,fit.width,fit.height,{mode:6,color:rgba(bright,innerAlpha)});
  }
        regularField(display) {
            return display && (display.activeField || display.currentField || (display.fields || []).find(field => field && field.name === display.fieldName));
        }
        mobPositions(narrow) {
            return narrow
                ? [[.59,.72,.72],[.72,.66,.9],[.84,.73,.7],[.65,.82,.58],[.79,.83,.55],[.9,.82,.5]]
                : [[.57,.72,.68],[.67,.64,.88],[.78,.69,.78],[.88,.63,.86],[.61,.82,.52],[.73,.82,.56],[.84,.81,.52],[.94,.79,.46]];
        }
        playerEffectPoint(role) {
            const narrow = innerWidth < 700;
            return { x: narrow ? .24 : .25, y: role === 'target' ? (narrow ? .64 : .61) : .64 };
        }
        targetEffectPoint(display, event, advanceMob) {
            const narrow = innerWidth < 700, phase = display && display.phase;
            if (phase === 'pillar') {
                const destroyed = event && event.pillarDestroyed;
                let index = destroyed === 0 || destroyed === 1 ? destroyed : -1;
                if (index < 0) {
                    const alive = display && display.target && display.target.pillars || [true, true];
                    index = alive[0] ? 0 : 1;
                }
                return { x: narrow ? (index ? .78 : .61) : (index ? .81 : .65), y: narrow ? .58 : .54 };
            }
            if (regularMode && phase === 'normal') {
                const positions = this.mobPositions(narrow), start = Math.abs(Number(this.mobImpactIndex || 0)) % positions.length, now = performance.now();
                let index = start;
                for (let offset = 0; offset < positions.length; offset++) {
                    const candidate = (start + offset) % positions.length;
                    if (Number(this.mobHiddenUntil[candidate] || 0) <= now) { index = candidate; break; }
                }
                const position = positions[index];
                if (advanceMob) {
                    this.mobLastImpactIndex = index;
                    this.mobImpactIndex = (index + 1) % positions.length;
                }
                return { x: position[0], y: position[1] - (narrow ? .07 : .085) * position[2] };
            }
            if (regularMode && phase === 'elite') return { x: narrow ? .75 : .76, y: narrow ? .57 : .52 };
            return { x: narrow ? .75 : .74, y: narrow ? .57 : .52 };
        }
        drawAtlasMonster(monster, elite, x, y, height, maxWidth, options) {
            const entry = this.textures.monsterAtlas;
            if (!entry) return;
            const fit = this.fitAtlas(height, maxWidth, monster && monster.rows);
            const opts = Object.assign({}, options || {}, {uv:this.monsterUv(monster, elite)});
            this.draw(entry, x, y, fit.width, fit.height, opts);
        }
        scatterMobs(killedCount, strong) {
            if (!regularMode) return;
            const now = performance.now(), positions = this.mobPositions(innerWidth < 700);
            const killed = Math.max(0, Math.floor(Number(killedCount || 0)));
            const requested = strong ? Math.max(14, killed) : killed;
            const count = strong
                ? Math.min(reducedMotion ? 8 : 120, requested)
                : Math.min(killed, positions.length);
            if (count < 1) return;
            const impactIndex = Math.abs(Number(this.mobLastImpactIndex || 0)) % positions.length;
            const visibleSlots = positions.map((_, index) => (impactIndex + index) % positions.length)
                .filter(index => Number(this.mobHiddenUntil[index] || 0) <= now);
            const slots = strong
                ? Array.from({ length: count }, (_, index) => (impactIndex + index) % positions.length)
                : visibleSlots.slice(0, count);
            slots.forEach((slot, index) => {
                const start = positions[slot], side = index % 2 ? 1 : -1;
                this.mobFlights.push({
                    x:start[0]+(Math.random()-.5)*.035, y:start[1]+(Math.random()-.5)*.025,
                    vx:side*(strong?.34:.2)+side*Math.random()*(strong?.42:.28),
                    vy:-(strong?.58:.36)-Math.random()*(strong?.5:.34),
                    rotation:(Math.random()-.5)*.5, spin:side*(3+Math.random()*7),
                    scale:start[2]*(.72+Math.random()*.35), life:strong?1.45:1.18, maxLife:strong?1.45:1.18,
                    delay:Math.random()*(strong?.18:.09)
                });
                if (!strong) this.mobHiddenUntil[slot] = now + 780;
            });
            this.mobFlights = this.mobFlights.slice(-160);
            if (strong) this.mobRespawnAt = now + 2100;
        }
        startEliteIntro(killedCount) {
            const now = performance.now();
            this.scatterMobs(Math.max(18, Number(killedCount || 0)), true);
            this.eliteIntro = {start:now,duration:2200};
            this.mobReturnAt = 0;
            this.burst(.76,.56,[1,.08,.04,1],reducedMotion?24:96);
        }
        startMobReturn() {
            this.eliteIntro = null;
            this.mobFlights = [];
            this.mobHiddenUntil = [];
            this.mobRespawnAt = 0;
            this.mobReturnAt = performance.now();
            this.burst(.76,.57,[1,.72,.18,1],reducedMotion?20:70);
        }
        drawRegularMobs(display, time, narrow) {
            const field = this.regularField(display), monster = field && field.monster || {};
            const positions = this.mobPositions(narrow), returning = this.mobReturnAt > 0;
            const returnProgress = returning ? clamp((time-this.mobReturnAt)/1150,0,1) : 1;
            const settle = 1-Math.pow(1-returnProgress,3);
            const allHidden = time < this.mobRespawnAt && !returning;
            positions.forEach((position,index) => {
                const sway = reducedMotion ? 0 : Math.sin(time/(430+index*31)+index)*.005;
                const fromX = index%2 ? 1.18 : .42, fromY = .48+(index%3)*.15;
                const x = fromX+(position[0]-fromX)*settle;
                const y = fromY+(position[1]-fromY)*settle+sway;
                const slotReturnAt = Number(this.mobHiddenUntil[index] || 0);
                const slotHidden = time < slotReturnAt && !returning;
                const returnAt = allHidden ? this.mobRespawnAt : slotReturnAt;
                const alpha = allHidden || slotHidden ? clamp((time-(returnAt-220))/220,0,1) : clamp(returnProgress*2.4,0,1);
                const h = (narrow?.31:.37)*position[2];
                this.draw(null,x,y+.14*position[2],(narrow?.22:.15)*position[2],.055,{mode:1,color:[.05,.02,.01,.22*alpha]});
                this.drawAtlasMonster(monster,false,x,y,h,narrow?.24:.19,{color:[1,1,1,alpha]});
                if (slotReturnAt && time >= slotReturnAt) this.mobHiddenUntil[index] = 0;
            });
            if (returning && returnProgress >= 1) this.mobReturnAt = 0;
        }
        drawRegularElite(display, time, narrow) {
            const field = this.regularField(display), monster = field && field.monster || {}, intro = this.eliteIntro;
            let x=narrow?.75:.76,y=narrow?.62:.61,scale=1,alpha=1,introProgress=1,flash=time<this.targetHitUntil?.85:0;
            if (intro) {
                const elapsed=time-intro.start,p=clamp((elapsed-420)/1250,0,1),ease=1-Math.pow(1-p,3);
                introProgress=p;
                scale=.28+.72*ease; y=-.08+(.69)*ease; alpha=clamp(p*3,0,1);
                if(elapsed>=intro.duration)this.eliteIntro=null;
            }
            this.draw(null,x,.81,narrow?.46:.34,.14,{mode:1,color:[1,.02,.04,.32*alpha]});
            this.drawAtlasMonster(monster,true,x+(flash?Math.sin(time*.18)*.007:0),y,(narrow?.76:.91)*scale,narrow?.54:.46,{flash,color:[1,1,1,alpha]});
            if(intro){const pulse=.65+.35*Math.sin(time/90);this.draw(null,x,.56,.58*scale,.58*scale,{mode:4,color:[1,.08,.03,.28*pulse*alpha*introProgress]});}
        }
        drawMobFlights(display, dt) {
            const field=this.regularField(display),monster=field&&field.monster||{};
            this.mobFlights=this.mobFlights.filter(flight=>{
                if(flight.delay>0){flight.delay-=dt;return true;}
                flight.life-=dt;if(flight.life<=0)return false;
                flight.x+=flight.vx*dt;flight.y+=flight.vy*dt;flight.vy+=1.18*dt;flight.rotation+=flight.spin*dt;
                const alpha=clamp(flight.life/flight.maxLife*2.3,0,1),h=(innerWidth<700?.29:.34)*flight.scale;
                this.drawAtlasMonster(monster,false,flight.x,flight.y,h,innerWidth<700?.24:.18,{rotation:flight.rotation,color:[1,1,1,alpha],flash:.12});
                return flight.y<1.3;
            });
        }
        // 소환수/지속 피해 틱: 플레이어 공격 모션 없이 대상 피격 연출만
        tickHit(previous, event) {
            const now = performance.now();
            this.targetHitUntil = now + 360; this.impactStarted = now; this.impactUntil = now + 390; this.impactCritical = false; this.impactSkill = false;
            const target = this.targetEffectPoint(previous, event, true), player = this.playerEffectPoint('actor');
            this.impactX = target.x; this.impactY = target.y;
            this.combatEffect(target.x, target.y, event, event && event.hits && event.hits[0], player.x);
            if (regularMode && previous && previous.phase === 'normal' && !event.eliteEncountered && Number(event && event.killedCount || 0) > 0) setTimeout(() => this.scatterMobs(event.killedCount, false), 90);
        }
        receiveHit(hit, event) {
            const now = performance.now(), critical = !!(hit && hit.critical), destiny = !!(hit && hit.destiny);
            const player = this.playerEffectPoint('target'), target = this.targetEffectPoint(this.state || {}, event, false);
            this.playerHitUntil = now + (critical ? 440 : 320);
            this.combatEffect(player.x,player.y,{action:'attack',effectElement:event&&event.receivedEffectElement||null},hit,target.x);
            if(critical||destiny)this.burst(player.x,player.y,destiny?[.72,.3,1,.65]:[1,.58,.14,.65],critical?14:10);
        }
        animate(event, previous) {
            const now = performance.now();
            const skillAudience = event.action === 'skill' && effectCatalog && effectCatalog.skillTarget ? effectCatalog.skillTarget(event) : event.action === 'skill' ? 'target' : null;
            const player = this.playerEffectPoint('actor');
            this.attackAt = now; this.attackKind = skillAudience === 'actor' ? 'buff' : event.action || 'attack';
            const outgoingHits = Array.isArray(event.hits) ? event.hits.filter(hit => Number(hit && hit.damage || 0) > 0) : [];
            const receivedHits = Array.isArray(event.receivedHits) ? event.receivedHits.filter(hit => Number(hit && hit.damage || 0) > 0) : [];
            if (regularMode) {
                if (event.eliteEncountered) this.startEliteIntro(event.killedCount);
                else if (event.eliteDefeated) this.startMobReturn();
                else if (previous && previous.phase === 'normal' && Number(event.killedCount || 0) > 0) setTimeout(() => this.scatterMobs(event.killedCount, false), Math.max(90, outgoingHits.length * 95));
            }
            if (event.action === 'skill' && (skillAudience === 'actor' || skillAudience === 'both')) this.castEffect(player.x,player.y,event,'actor');
            if (event.damage > 0 || Number(event.killedCount || 0) > 0) {
                const target = this.targetEffectPoint(previous, event, true);
                this.targetHitUntil = now + (event.criticalCount ? 520 : 360);
                this.impactStarted = now;
                this.impactUntil = now + (event.action === 'skill' ? 520 : 390);
                this.impactCritical = Number(event.criticalCount || 0) > 0;
                this.impactSkill = event.action === 'skill';
                this.impactX = target.x;
                this.impactY = target.y;
                this.combatEffect(target.x, target.y, event, outgoingHits[0], player.x);
                if (event.criticalCount) this.burst(this.impactX,this.impactY,[1,.68,.12,.68],16);
                outgoingHits.slice(1).forEach((hit, index) => {
                    const presentationHit = Object.assign({}, hit, { presentationIndex: index + 1 });
                    setTimeout(() => this.tickHit(previous, Object.assign({},event,{hits:[presentationHit],damage:hit.damage,killedCount:0,eliteEncountered:false,eliteDefeated:false})), (index + 1) * 95);
                });
            } else if (event.action === 'skill' && (skillAudience === 'target' || skillAudience === 'both')) {
                const target = this.targetEffectPoint(previous, event, true);
                this.castEffect(target.x,target.y,event,'target');
            }
            const receivedDelay = Math.max(80, outgoingHits.length * 95 + 80);
            if (receivedHits.length) receivedHits.forEach((hit, index) => setTimeout(() => this.receiveHit(hit,event), receivedDelay + index * 95));
            else if (event.received > 0) setTimeout(() => this.receiveHit({ damage: event.received },event), receivedDelay);
            if (event.pillarDestroyed != null) {
                const pillar = this.targetEffectPoint(previous, event, false);
                this.burst(pillar.x, pillar.y, [1,.16,.05,1], 78);
                for(let i=0;i<18;i++) this.particle({x:pillar.x,y:pillar.y,vx:(Math.random()-.5)*.28,vy:-.1-Math.random()*.2,life:.7+Math.random()*.6,maxLife:1.3,width:.008+Math.random()*.018,height:.012+Math.random()*.025,spin:(Math.random()-.5)*8,color:[.32,.15,.09,1],mode:3});
            }
            if (!regularMode && event.cleared && previous) { this.holdState = JSON.parse(JSON.stringify(previous)); this.holdState.target.pillars = [false, false]; }
        }
        rewardBurst(tier) {
            const colors = tier === 'mythic' ? [[.2,.78,1,1],[.75,.32,1,1],[1,.8,.2,1]] : [[1,.1,.2,1],[1,.55,.1,1],[1,.8,.2,1]];
            for (let i=0;i<(reducedMotion?16:tier==='mythic'?100:60);i++) { const a=Math.random()*Math.PI*2,s=.07+Math.random()*.34; this.particle({x:.5,y:.48,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.8+Math.random()*1.2,maxLife:2,width:.008+Math.random()*.018,height:.008+Math.random()*.028,spin:(Math.random()-.5)*5,color:colors[i%colors.length]}); }
        }
        recoveryBurst(event) {
            const player = this.playerEffectPoint('actor');
            this.playEffectAssets(player.x, player.y, event && event.effectIds, { role: 'actor' });
            const hp=Number(event&&event.recoveredHp||0),mp=Number(event&&event.recoveredMp||0),colors=hp>0&&mp>0?[[.18,1,.5,1],[.2,.65,1,1]]:hp>0?[[.14,1,.42,1],[.7,1,.35,1]]:[[.18,.58,1,1],[.4,.85,1,1]];
            for(let i=0;i<(reducedMotion?8:18);i++){const a=Math.random()*Math.PI*2,s=.02+Math.random()*.08,color=colors[i%colors.length].slice();color[3]=.64;this.particle({x:player.x+(Math.random()-.5)*.055,y:player.y+.01+Math.random()*.09,vx:Math.cos(a)*s,vy:-.06-Math.random()*.12,life:.55+Math.random()*.5,maxLife:1.05,width:.006+Math.random()*.009,height:.006+Math.random()*.013,spin:(Math.random()-.5)*3,color,mode:i%4===0?2:1});}
        }
        render(time) {
            this.resize(); const gl = this.gl, dt = Math.min(.04, Math.max(0, (time-this.last)/1000)); this.last=time;
            gl.clearColor(.005,.01,.025,1); gl.clear(gl.COLOR_BUFFER_BIT); const bg=this.cover('background');this.draw(this.textures.background,.5,.5,bg.width,bg.height); this.draw(null,.5,.5,1,1,{mode:3,color:[.01,.02,.05,regularMode&&!(this.state&&this.state.inField)?.38:.16]});
            const display = this.holdState || this.state || {}, narrow = innerWidth < 700, phase = display.phase || 'elite';
            const idle = reducedMotion ? 0 : Math.sin(time/520)*.005, progress=clamp((time-this.attackAt)/(this.attackKind==='skill'?620:430),0,1), lunge=this.attackKind==='buff'?0:progress<1?Math.sin(progress*Math.PI)*.12:0;
            if (!regularMode || display.inField) {
                const playerFit=this.fit('player',narrow?.62:.78,narrow?.48:.36), playerX=(narrow?.24:.25)+lunge,playerY=narrow?.68:.66-idle;
                this.drawPlayerAura(display.player,playerX,playerY,playerFit,time);
                this.draw(null,playerX,.83,narrow?.4:.27,.11,{mode:1,color:[.08,.45,1,.25]});
                this.draw(this.textures.player,playerX,playerY,playerFit.width,playerFit.height,{flash:time<this.playerHitUntil?.75:0});
                if (regularMode) {
                    if (phase === 'elite') this.drawRegularElite(display,time,narrow);
                    else this.drawRegularMobs(display,time,narrow);
                    this.drawMobFlights(display,dt);
                } else if (phase === 'pillar') {
                    const alive = display.target && display.target.pillars || [true,true];
                    [0,1].forEach(index => { if (!alive[index]) return; const x=narrow?(index?.78:.61):(index?.81:.65), fit=this.fit('pillar',narrow?.48:.62,narrow?.34:.25),hit=time<this.targetHitUntil&&Math.abs(x-this.impactX)<.11; this.draw(null,x,.78,fit.width*.9,.12,{mode:1,color:[1,.08,.02,.25]}); this.draw(this.textures.pillar,x+(hit?Math.sin(time*.16)*.008:0),.62+idle,fit.width,fit.height,{flash:hit?.85:0}); });
                } else {
                    const fit=this.fit('buta',narrow?.72:.88,narrow?.5:.44),hit=time<this.targetHitUntil; this.draw(null,narrow?.75:.74,.8,narrow?.43:.32,.13,{mode:1,color:[1,.04,.12,.24]}); this.draw(this.textures.buta,(narrow?.75:.74)+(hit?Math.sin(time*.18)*.006:0),narrow?.62:.61+idle,fit.width,fit.height,{flash:hit?.85:0,color:[1,1,1,display.inField?1:.82]});
                }
            }
            if(display.inField&&time<this.impactUntil){const p=clamp((time-this.impactStarted)/Math.max(1,this.impactUntil-this.impactStarted),0,1),pulse=Math.sin(p*Math.PI),fit=this.fit('impact',(this.impactSkill?.36:.3)*(.76+pulse*.28),this.impactSkill?.32:.26),alpha=Math.pow(1-p,.5)*.68;this.draw(this.textures.impact,this.impactX,this.impactY,fit.width,fit.height,{color:[1,1,1,alpha],rotation:(this.impactSkill?-.06:.06)+p*.035});if(this.impactCritical)this.draw(this.textures.impact,this.impactX-.008,this.impactY+.008,fit.width*.66,fit.height*.66,{color:[1,.86,.52,alpha*.55],rotation:-.75});}
            this.drawEffectAssets(time);
            if (time>this.ambientAt) { this.ambientAt=time+(reducedMotion?500:170); this.particle({x:Math.random()<.5?.04:.96,y:.55+Math.random()*.4,vx:(Math.random()-.5)*.01,vy:-.025,life:3,maxLife:3,width:.005+Math.random()*.008,height:.005+Math.random()*.008,color:Math.random()<.5?[.4,.2,1,.55]:[1,.15,.25,.5]}); }
            this.particles=this.particles.filter(p=>{if(p.delay>0){p.delay-=dt;return true;}p.life-=dt;if(p.life<=0)return false;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=p.gravity*dt;p.rotation+=p.spin*dt;const progress=1-p.life/p.maxLife,scale=1+p.grow*progress,c=p.color.slice();c[3]*=clamp(p.life/p.maxLife*2.4,0,1);this.draw(null,p.x,p.y,p.width*scale,p.height*scale,{mode:p.mode,color:c,rotation:p.rotation});return true;});
            this.frame=requestAnimationFrame(next=>this.render(next));
        }
    }

    class Hud {
        constructor(canvas) {
            this.canvas=canvas;this.ctx=canvas.getContext('2d');this.regions=[];this.images=new Map();this.flashUntil=0;this.flashDuration=1;this.shakeUntil=0;this.banner=null;this.bannerSub='';this.bannerUntil=0;this.damagePops=[];this.rewardStarted=0;this.bossLagHp=null;this.bossKey='';this.entryTransition=null;this.consumableMenu=false;this.consumablePage=0;this.fieldPage=0;this.frame=requestAnimationFrame(()=>this.draw());
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
        bar(x,y,w,h,value,max,color,lagValue){const c=this.ctx;this.cutPath(x,y,w,h,3);c.fillStyle='rgba(0,0,0,.8)';c.fill();if(lagValue!=null){const lag=w*ratio(lagValue,max);if(lag>0){this.cutPath(x,y,lag,h,3);c.fillStyle='rgba(240,176,75,.62)';c.fill();}}const fill=w*ratio(value,max);if(fill>0){this.cutPath(x,y,fill,h,3);const g=c.createLinearGradient(x,y,x+w,y);g.addColorStop(0,color);g.addColorStop(1,color==='#b92d2d'?'#f25b42':'#37a4ec');c.fillStyle=g;c.fill();}this.cutPath(x,y,w,h,3);c.strokeStyle='rgba(255,255,255,.24)';c.lineWidth=1;c.stroke();this.line(x+2,y+2,x+Math.max(2,fill-2),y+2,'rgba(255,255,255,.28)',1);}
        actionButton(x,y,w,h,opts){
            const c=this.ctx,o=opts||{},kind=o.kind||'skill',disabled=!!o.disabled;
            this.cutPath(x,y,w,h,kind==='attack'?12:7);const g=c.createLinearGradient(x,y,x,y+h);
            if(kind==='attack'){g.addColorStop(0,disabled?'#3d3233':'#dd5a4e');g.addColorStop(.55,disabled?'#282327':'#9e241e');g.addColorStop(1,'#42100d');}
            else if(kind==='gold'){g.addColorStop(0,disabled?'#34312c':'#f0c56e');g.addColorStop(1,disabled?'#1b1b1d':'#a85f12');}
            else{g.addColorStop(0,disabled?'#272b32':'#252b36');g.addColorStop(1,disabled?'#15171c':'#11151d');}
            c.fillStyle=g;c.fill();c.strokeStyle=disabled?'rgba(100,105,115,.48)':kind==='attack'?'rgba(255,170,155,.85)':kind==='gold'?'rgba(255,225,154,.9)':'rgba(232,176,75,.58)';c.lineWidth=1;c.stroke();
            if(!disabled)this.line(x+8,y+1,x+w*.55,y+1,kind==='attack'?'rgba(255,210,190,.72)':'rgba(232,176,75,.75)',2);
            if(o.key)this.text(o.key,x+7,y+9,8,800,'left',disabled?'#656a74':'#b9ad92');
            const labelX=x+w*(Number(o.labelRatio)||.5),labelY=y+h*(Number(o.labelYRatio)||(o.sub?.42:.51)),labelSize=kind==='gold'?19:kind==='attack'?18:Math.min(13,w*.16),labelColor=disabled?'#747982':kind==='gold'?'#261704':'#f4f1e8';
            if(kind==='gold'||kind==='attack')this.gameText(o.label,labelX,labelY,labelSize,'center',labelColor,w-12);else this.text(o.label,labelX,labelY,labelSize,900,'center',labelColor,w-12);
            if(o.sub)this.text(o.sub,labelX,y+h*.72,9,700,'center',disabled?'#626771':kind==='gold'?'#3e290c':'#9da5b3',w-10);
            if(o.cooldown>0){this.cutPath(x,y,w,h,kind==='attack'?12:7);c.fillStyle='rgba(0,0,0,.64)';c.fill();this.gameText(o.cooldown<10?o.cooldown.toFixed(1):Math.ceil(o.cooldown),x+w/2,y+h/2,16,'center','#ffe28a');}
            if(!disabled)this.region(x,y,w,h,o.action);
        }
        topControls(w){const p=w<650?12:22,bw=42,bh=34;this.panel(p,p,bw,bh,'rgba(170,180,194,.45)');this.line(p+25,p+9,p+15,p+17,'#e4e8ed',2);this.line(p+15,p+17,p+25,p+25,'#e4e8ed',2);this.region(p,p,bw,bh,()=>backOrLeave());const x=w-p-bw;this.panel(x,p,bw,bh,'rgba(170,180,194,.45)');const sx=x+20;this.line(sx-7,p+14,sx-2,p+14,'#e4e8ed',2);this.line(sx-2,p+14,sx+4,p+9,'#e4e8ed',2);this.line(sx+4,p+9,sx+4,p+25,'#e4e8ed',2);if(!audio.muted){this.ctx.beginPath();this.ctx.arc(sx+5,p+17,8,-.8,.8);this.ctx.strokeStyle='#e4e8ed';this.ctx.stroke();}else this.line(sx-7,p+9,sx+10,p+26,'#e0655c',2);this.region(x,p,bw,bh,()=>audio.toggle());}
        bossHud(w){
            if(!state||!state.inField)return;
            const narrow=w<650,bw=Math.min(narrow?w-120:720,w*.72),x=(w-bw)/2,y=narrow?13:16;
            if(regularMode&&state.phase==='normal'){
                const field=state.activeField||state.currentField||{},kills=Number(state.killCount||0),progress=Math.min(100,kills);
                this.text(field.name||state.fieldName||'일반 필드',w/2,y+9,narrow?16:20,900,'center','#f7f2e8');
                this.text('누적 처치 '+number(kills)+'마리'+(kills>=100?' · 엘리트 조우 가능':''),w/2,y+27,9,800,'center',kills>=100?'#ffb36b':'#e8b04b');
                this.bar(x,y+38,bw,narrow?12:15,progress,100,'#b87924');
                return;
            }
            const target=state.target||{},key=state.phase+':'+target.maxHp;
            if(this.bossKey!==key){this.bossKey=key;this.bossLagHp=Number(target.hp||0);}
            this.bossLagHp+=(Number(target.hp||0)-this.bossLagHp)*.055;
            const meta=state.phase==='pillar'?'결계 기둥 '+(target.pillars||[]).filter(Boolean).length+' / 2':regularMode?'엘리트 몬스터':'';
            this.text(target.name||'엘리트',w/2,y+9,narrow?16:20,900,'center','#f7f2e8');
            if(meta)this.text(meta,w/2,y+27,9,800,'center',regularMode?'#ff8b78':'#e8b04b');
            const by=y+(meta?38:28),bh=narrow?15:19;
            this.bar(x,by,bw,bh,target.hp,target.maxHp,'#b92d2d',this.bossLagHp);
            this.text(number(target.hp)+' / '+number(target.maxHp),w/2,by+bh/2,narrow?9:11,800,'center','#fff');
        }
        playerHud(w,h){if(!state||!state.inField)return;const mobile=w<650||h<520,landscape=h<520&&w>=650,pw=mobile?Math.min(238,w*.61):304,ph=mobile?84:94,x=landscape?w-pw-12:mobile?12:24,y=mobile?72:h-178;this.panel(x,y,pw,ph,'rgba(232,176,75,.58)');const portrait=this.image(state.player.cardImageUrl),ps=mobile?50:58,px=x+8,py=y+8,infoX=px+ps+9,infoRight=x+pw-9,infoW=infoRight-infoX;this.ctx.save();this.cutPath(px,py,ps,ps,6);this.ctx.clip();if(portrait)this.ctx.drawImage(portrait,px,py,ps,ps);else{this.ctx.fillStyle='#11141b';this.ctx.fillRect(px,py,ps,ps);}this.ctx.restore();this.cutPath(px,py,ps,ps,6);this.ctx.strokeStyle='rgba(232,176,75,.72)';this.ctx.stroke();this.text(state.player.name,infoX,y+16,mobile?13:15,900,'left','#fff5df',infoW);const cardLabel=state.player.cardFormatted||[state.player.cardSkin,state.player.cardName].filter(Boolean).join(' ');this.text(cardLabel,infoX,y+34,mobile?8:10,700,'left','#aeb4bf',infoW);const hpTextY=y+(mobile?48:52),hpBarY=y+(mobile?54:59),mpTextY=y+(mobile?65:71),mpBarY=y+(mobile?71:78);this.text('HP',infoX,hpTextY,8,800,'left','#bbb1a0');this.text(number(state.player.hp),infoRight,hpTextY,8,800,'right','#e9e5dc');this.bar(infoX,hpBarY,infoW,6,state.player.hp,state.player.maxHp,'#b92d2d');this.text('MP',infoX,mpTextY,8,800,'left','#bbb1a0');this.text(number(state.player.mp),infoRight,mpTextY,8,800,'right','#e9e5dc');this.bar(infoX,mpBarY,infoW,6,state.player.mp,state.player.maxMp,'#147fc4');}
        combatLog(w,h){if(!state||!state.inField||!logs.length)return;const narrow=w<650,lines=logs.slice(-4),x=narrow?12:26,base=h-(narrow?201:196),lineH=narrow?14:16;lines.forEach((entry,index)=>{const alpha=.42+(index+1)/lines.length*.58,col=entry.tone==='bad'?'224,101,92':entry.tone==='good'?'240,197,110':'220,224,230';this.text(entry.text,x,base-(lines.length-1-index)*lineH,narrow?9:10,entry.tone==='good'?800:650,'left','rgba('+col+','+alpha+')',Math.min(narrow?w-24:460,w*.48));});}
        actions(w,h){if(!state||!state.inField)return;const narrow=w<650,now=Date.now()+clockOffset,actionLeft=Math.max(0,Number(state.nextActionAt||0)-now)/1000,skills=(state.skills||[]).slice(0,narrow?4:7),gap=narrow?5:7,maxW=Math.min(narrow?w-24:780,w-40),y=h-(narrow?82:76),ah=narrow?68:62,attackW=narrow?86:122,sw=skills.length?Math.min(narrow?62:94,(maxW-attackW-gap*skills.length)/skills.length):0,usedW=skills.length*sw+gap*skills.length+attackW,x=(w-usedW)/2;skills.forEach((skill,index)=>{const left=Math.max(actionLeft,(Number(skill.cooldownEnd||0)-now)/1000),mpLow=Number(state.player.mp)<Number(skill.mpCost||0),disabled=busy||left>0||mpLow;this.actionButton(x+index*(sw+gap),y,sw,ah,{label:skill.name.slice(0,6),sub:Number(skill.mpCost||0)+' MP',key:String(index+1),disabled,cooldown:Math.max(0,left),action:()=>useSkill(skill.name)});});const ax=x+usedW-attackW;this.actionButton(ax,y,attackW,ah,{label:'공격',sub:narrow?'J':'SPACE / J',key:'J',kind:'attack',disabled:busy||actionLeft>0,cooldown:actionLeft,action:()=>attack()});}
        consumableLauncher(w,h){if(!state||!state.inField)return;const c=this.ctx,mobile=w<650||h<520,bw=mobile?60:70,bh=34,x=mobile?12:24,y=mobile?h-126:h-66,list=state.consumables||[],disabled=list.length===0;this.cutPath(x,y,bw,bh,6);const g=c.createLinearGradient(x,y,x,y+bh);g.addColorStop(0,disabled?'#24282e':'#253b35');g.addColorStop(1,disabled?'#111318':'#0b211b');c.fillStyle=g;c.fill();c.strokeStyle=disabled?'rgba(100,105,115,.45)':'rgba(98,225,157,.72)';c.lineWidth=1;c.stroke();if(!disabled)this.line(x+7,y+1,x+bw*.64,y+1,'rgba(146,255,197,.78)',2);this.text('회복',x+bw/2,y+bh/2,12,900,'center',disabled?'#686d75':'#dffbea');if(!disabled&&!busy)this.region(x,y,bw,bh,()=>this.toggleConsumables());}
        toggleConsumables(){if(!state||!state.inField||this.inEntryTransition()||rewards||dialog)return;this.consumableMenu=!this.consumableMenu;if(this.consumableMenu)this.consumablePage=0;}
        closeConsumables(){this.consumableMenu=false;}
        inConsumableMenu(){return !!this.consumableMenu;}
        consumablePageSize(w,h){return w<650?6:10;}
        changeConsumablePage(delta,w,h){const list=state&&state.consumables||[],pages=Math.max(1,Math.ceil(list.length/this.consumablePageSize(w,h)));this.consumablePage=(this.consumablePage+delta+pages)%pages;}
        useConsumableAt(index,w,h){const list=state&&state.consumables||[],item=list[this.consumablePage*this.consumablePageSize(w,h)+index];if(item)useConsumable(item.id);}
        consumableLayer(w,h){if(!this.consumableMenu)return;this.regions=[];const c=this.ctx,narrow=w<650,compact=h<520,cols=narrow?(compact?3:2):5,perPage=this.consumablePageSize(w,h),list=state&&state.consumables||[],pages=Math.max(1,Math.ceil(list.length/perPage));this.consumablePage=clamp(this.consumablePage,0,pages-1);const bh=Math.min(h-20,narrow?(compact?310:460):330),bw=Math.min(w-20,narrow?560:760),x=(w-bw)/2,y=(h-bh)/2,gap=8,gridTop=y+62,rows=Math.ceil(perPage/cols),cellW=(bw-32-gap*(cols-1))/cols,cellH=(bh-122-gap*(rows-1))/rows;c.fillStyle='rgba(1,4,7,.84)';c.fillRect(0,0,w,h);this.panel(x,y,bw,bh,'rgba(98,225,157,.68)',true);this.gameText('회복 소모품',w/2,y+29,narrow?20:24,'center','#ecfff4');this.text('P',x+12,y+15,8,900,'left','#91cbaa');if(pages>1)this.text((this.consumablePage+1)+' / '+pages,w/2,y+49,9,800,'center','#9da5b3');const pageItems=list.slice(this.consumablePage*perPage,(this.consumablePage+1)*perPage);if(!pageItems.length)this.text('보유 중인 회복 소모품이 없습니다.',w/2,y+bh*.48,narrow?11:13,700,'center','#a9afb8');pageItems.forEach((item,index)=>{const col=index%cols,row=Math.floor(index/cols),cx=x+16+col*(cellW+gap),cy=gridTop+row*(cellH+gap),disabled=busy||Number(item.count||0)<1;this.panel(cx,cy,cellW,cellH,disabled?'rgba(95,101,110,.4)':'rgba(98,225,157,.48)',true);const art=Math.min(narrow?42:48,cellH-30),ax=cx+8,ay=cy+(cellH-art)/2,frame=this.image(item.frameUrl),icon=this.image(item.iconUrl);if(frame)c.drawImage(frame,ax,ay,art,art);if(icon)c.drawImage(icon,ax,ay,art,art);const tx=ax+art+8,tw=cellW-art-24,key=index===9?'0':String(index+1);this.text(key,cx+6,cy+8,7,900,'left',disabled?'#676c74':'#a5d8bb');this.text(item.name,tx,cy+cellH*.31,narrow?9:10,900,'left',disabled?'#737983':'#f0f5f1',tw);this.text(item.effect,tx,cy+cellH*.56,narrow?8:9,700,'left',disabled?'#636971':'#87d9aa',tw);this.text('x'+number(item.count),tx,cy+cellH*.78,8,800,'left',disabled?'#62676e':'#d6c28b',tw);if(!disabled)this.region(cx,cy,cellW,cellH,()=>useConsumable(item.id));});const footerY=y+bh-45,buttonW=narrow?68:82;if(pages>1){this.actionButton(x+16,footerY,buttonW,32,{label:'이전',disabled:busy,action:()=>this.changeConsumablePage(-1,w,h)});this.actionButton(x+bw-16-buttonW,footerY,buttonW,32,{label:'다음',disabled:busy,action:()=>this.changeConsumablePage(1,w,h)});}this.actionButton(w/2-42,footerY,84,32,{label:'닫기',disabled:busy,action:()=>this.closeConsumables()});}
        selectField(field){
            if(!field)return;
            selectedFieldName=field.name;
            if(renderer)renderer.previewField(field);
        }
        drawFieldCard(field,x,y,w,h,selected){
            const c=this.ctx,image=this.image(field.backgroundUrl||field.background),enabled=field.canEnter!==false&&!field.locked;
            c.save();this.cutPath(x,y,w,h,9);c.clip();
            if(image){const source=image.naturalWidth/image.naturalHeight,target=w/h;let sx=0,sy=0,sw=image.naturalWidth,sh=image.naturalHeight;if(source>target){sw=sh*target;sx=(image.naturalWidth-sw)/2;}else{sh=sw/target;sy=(image.naturalHeight-sh)/2;}c.drawImage(image,sx,sy,sw,sh,x,y,w,h);}else{c.fillStyle='#10151d';c.fillRect(x,y,w,h);}
            const gradient=c.createLinearGradient(0,y,0,y+h);gradient.addColorStop(0,selected?'rgba(10,10,14,.08)':'rgba(4,6,10,.22)');gradient.addColorStop(.55,'rgba(3,5,9,.16)');gradient.addColorStop(1,enabled?'rgba(2,4,8,.91)':'rgba(3,4,6,.95)');c.fillStyle=gradient;c.fillRect(x,y,w,h);
            if(!enabled){c.fillStyle='rgba(0,0,0,.42)';c.fillRect(x,y,w,h);}
            c.restore();this.cutPath(x,y,w,h,9);c.strokeStyle=selected?'#f0b84d':enabled?'rgba(190,199,214,.5)':'rgba(92,98,108,.45)';c.lineWidth=selected?2:1;c.stroke();
            this.gameText(field.name,x+14,y+h-38,Math.min(22,Math.max(15,w*.055)),'left',enabled?'#fff8e8':'#8b9099',w-28);
            const level=field.levelText||('Lv. '+number(field.requireLevel||1));
            this.text(level,x+14,y+h-16,10,800,'left',enabled?'#e8b04b':'#717680',w-80);
            if(field.recommendedPower)this.text('권장 '+number(field.recommendedPower),x+w-12,y+h-16,9,700,'right','#bdc3cd',w*.45);
            if(!enabled)this.text('잠김',x+w-13,y+18,10,900,'right','#d98d87');
            this.region(x,y,w,h,()=>this.selectField(field));
        }
        regularLobby(w,h){
            const fields=state&&state.fields||[];if(!fields.length){this.text('입장 가능한 필드가 없습니다.',w/2,h/2,15,800,'center','#c4c8ce');return;}
            if(!fields.some(field=>field.name===selectedFieldName)){const preferred=[...fields].reverse().find(field=>field.canEnter!==false&&!field.locked)||fields[0];this.selectField(preferred);}
            const selected=fields.find(field=>field.name===selectedFieldName)||fields[0],narrow=w<650,compact=h<610,cols=narrow?1:w<980?2:3,rows=narrow?(compact?2:3):(compact?2:3),perPage=cols*rows,pages=Math.max(1,Math.ceil(fields.length/perPage));
            this.fieldPage=clamp(this.fieldPage,0,pages-1);const selectedIndex=fields.indexOf(selected);if(Math.floor(selectedIndex/perPage)!==this.fieldPage&&selectedIndex>=0)this.fieldPage=Math.floor(selectedIndex/perPage);
            const c=this.ctx,top=c.createLinearGradient(0,0,0,h);top.addColorStop(0,'rgba(0,0,0,.7)');top.addColorStop(.35,'rgba(0,0,0,.14)');top.addColorStop(1,'rgba(0,0,0,.86)');c.fillStyle=top;c.fillRect(0,0,w,h);
            this.gameText('일반 필드',w/2,narrow?36:42,narrow?26:34,'center','#fff7e8');this.text('필드를 선택해 입장하세요',w/2,narrow?61:70,10,750,'center','#c7c9cd');
            const gridTop=narrow?82:91,gridBottom=h-(narrow?112:106),gap=narrow?8:11,gridW=Math.min(w-(narrow?24:44),1120),gridX=(w-gridW)/2,cellW=(gridW-gap*(cols-1))/cols,cellH=Math.max(82,(gridBottom-gridTop-gap*(rows-1))/rows);
            const pageFields=fields.slice(this.fieldPage*perPage,(this.fieldPage+1)*perPage),visibleBackgrounds=new Set(pageFields.map(field=>field.backgroundUrl||field.background).filter(Boolean));
            fields.forEach(field=>{const url=field.backgroundUrl||field.background;if(url&&!visibleBackgrounds.has(url))this.images.delete(url);});
            pageFields.forEach((field,index)=>{const col=index%cols,row=Math.floor(index/cols);this.drawFieldCard(field,gridX+col*(cellW+gap),gridTop+row*(cellH+gap),cellW,cellH,field.name===selectedFieldName);});
            const canEnter=selected&&selected.canEnter!==false&&!selected.locked&&!state.entryError,buttonW=narrow?176:210,buttonY=h-(narrow?69:66);
            if(pages>1){const navW=narrow?70:84;this.actionButton(gridX,buttonY,navW,42,{label:'이전',disabled:this.fieldPage<=0,action:()=>{this.fieldPage--;const field=fields[this.fieldPage*perPage];if(field)this.selectField(field);}});this.actionButton(gridX+gridW-navW,buttonY,navW,42,{label:'다음',disabled:this.fieldPage>=pages-1,action:()=>{this.fieldPage++;const field=fields[this.fieldPage*perPage];if(field)this.selectField(field);}});this.text((this.fieldPage+1)+' / '+pages,w/2,buttonY-14,9,800,'center','#9da5b3');}
            this.actionButton(w/2-buttonW/2,buttonY,buttonW,48,{label:canEnter?'입장':'입장 불가',sub:selected?selected.name:'',kind:'gold',disabled:busy||!canEnter,action:()=>enter(false)});
            if(state.entryError)this.text(state.entryError,w/2,h-10,9,750,'center','#f0a39b',w-30);
        }
        lobby(w,h){
            if(!state||state.inField)return;
            if(regularMode){this.regularLobby(w,h);return;}
            const c=this.ctx,narrow=w<650,cx=w/2,cy=h*.46,top=c.createLinearGradient(0,0,0,h);top.addColorStop(0,'rgba(0,0,0,.18)');top.addColorStop(.55,'rgba(0,0,0,.02)');top.addColorStop(1,'rgba(0,0,0,.72)');c.fillStyle=top;c.fillRect(0,0,w,h);this.gameText('부타게임 [H]',cx,cy-(narrow?110:130),narrow?31:43,'center','#fff7e8');this.line(cx-(narrow?105:150),cy-(narrow?82:94),cx-30,cy-(narrow?82:94),'rgba(232,176,75,.8)',1);this.line(cx+30,cy-(narrow?82:94),cx+(narrow?105:150),cy-(narrow?82:94),'rgba(232,176,75,.8)',1);this.text('Lv. '+state.requirements.minLevel+'–'+state.requirements.maxLevel,cx,cy-(narrow?40:48),narrow?11:13,800,'center','#d8d2c8');if(state.entryError)this.text(state.entryError,cx,cy-(narrow?17:21),narrow?9:11,750,'center','#f0a39b',w-30);const bw=narrow?168:184,bh=narrow?66:72,by=cy+(narrow?34:48),bx=cx-bw/2;this.actionButton(bx,by,bw,bh,{label:state.canEnter?'입장':'입장 불가',labelYRatio:.35,key:'',kind:'gold',disabled:busy||!state.canEnter,action:()=>enter(false)});const iconSize=narrow?28:30,countText=number(state.ticket.count)+'/'+number(state.ticket.cost),countSize=narrow?10:11,rowY=by+bh*.72;c.font='900 '+countSize+'px Pretendard, sans-serif';const rowW=iconSize+6+c.measureText(countText).width,ix=cx-rowW/2,iy=rowY-iconSize/2,icon=this.image(state.ticket.iconUrl);if(icon)c.drawImage(icon,ix,iy,iconSize,iconSize);else{this.cutPath(ix,iy,iconSize,iconSize,3);c.fillStyle='rgba(38,24,5,.35)';c.fill();this.gameText('H',ix+iconSize/2,iy+iconSize/2,10,'center','#3e290c');}this.text(countText,ix+iconSize+6,rowY,countSize,900,'left',state.canEnter?'#2b1b05':'#6f6b62');this.text('E',bx+bw-8,by+9,7,900,'right',state.canEnter?'#4a2d08':'#73706a');
        }
        bannerLayer(w,h){if(!this.banner||this.bannerUntil<=performance.now())return;const remain=this.bannerUntil-performance.now(),age=1-clamp(remain/1250,0,1),alpha=clamp(Math.min(age*5,remain/220),0,1),narrow=w<650,c=this.ctx,cx=w/2,y=h*(narrow?.3:.33),bw=Math.min(w-40,narrow?310:460);c.save();c.globalAlpha=alpha;const glow=c.createRadialGradient(cx,y,0,cx,y,bw*.58);glow.addColorStop(0,'rgba(232,176,75,.2)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(cx-bw*.7,y-70,bw*1.4,140);this.line(cx-bw/2,y-22,cx-72,y-22,'rgba(232,176,75,.8)',1);this.line(cx+72,y-22,cx+bw/2,y-22,'rgba(232,176,75,.8)',1);this.text(this.banner,cx,y,narrow?25:36,900,'center','#fff8e8');if(this.bannerSub)this.text(this.bannerSub,cx,y+29,narrow?10:12,800,'center','#e8b04b');c.restore();}
        addDamage(event,previous){
            const now=performance.now(),narrow=innerWidth<700,phase=previous&&previous.phase;
            const pillarIndex=event.pillarDestroyed===1?1:0;
            const x=phase==='pillar'?(narrow?(pillarIndex?.78:.61):(pillarIndex?.81:.65)):regularMode&&phase==='normal'?.72:(narrow?.75:.74);
            const y=phase==='pillar'?(narrow?.58:.46):regularMode&&phase==='normal'?(narrow?.62:.42):(narrow?.56:.42);
            const hits=Array.isArray(event.hits)?event.hits.filter(hit=>Number(hit&&hit.damage||0)>0):[],receivedHits=Array.isArray(event.receivedHits)?event.receivedHits.filter(hit=>Number(hit&&hit.damage||0)>0):[],receivedAt=now+Math.max(80,hits.length*95+80);
            if(hits.length)hits.forEach((hit,index)=>this.damagePops.push({damage:Number(hit.damage),critical:!!hit.critical,destiny:!!hit.destiny,skill:hit.label||(index===0?event.skillName||'':''),start:now+index*95,x,y,received:false}));
            else if(Number(event.damage||0)>0)this.damagePops.push({damage:Number(event.damage),critical:Number(event.criticalCount||0)>0,skill:event.skillName||'',start:now,x,y,received:false});
            if(regularMode&&Number(event.killedCount||0)>0)this.damagePops.push({kills:Number(event.killedCount),start:now+Math.max(120,hits.length*95),x:regularMode&&phase==='normal'?.72:x,y:narrow?.68:.54});
            const receivedX=narrow?.24:.25,receivedY=narrow?.68:.55;
            if(receivedHits.length)receivedHits.forEach((hit,index)=>this.damagePops.push({damage:Number(hit.damage),critical:!!hit.critical,destiny:!!hit.destiny,skill:hit.label||'',start:receivedAt+index*95,x:receivedX,y:receivedY,received:true}));
            else if(Number(event.received||0)>0)this.damagePops.push({damage:Number(event.received),critical:false,start:receivedAt,x:receivedX,y:receivedY,received:true});
        }
        addRecovery(event){const now=performance.now(),narrow=innerWidth<700,hp=Number(event&&event.recoveredHp||0),mp=Number(event&&event.recoveredMp||0),x=narrow?.24:.25;if(hp>0)this.damagePops.push({damage:hp,recovery:true,resource:'HP',start:now,x,y:narrow?.68:.56});if(mp>0)this.damagePops.push({damage:mp,recovery:true,resource:'MP',start:now+(hp>0?120:0),x,y:narrow?.72:.61});}
        damageLayer(w,h){const now=performance.now();this.damagePops=this.damagePops.filter(pop=>{const p=(now-pop.start)/950;if(p<0)return true;if(p>=1)return false;const ease=1-Math.pow(1-clamp(p,0,1),3),x=w*pop.x,y=h*pop.y-ease*(pop.received?45:pop.recovery?60:82),alpha=clamp(Math.min(p*8,(1-p)*3.4),0,1),scale=.7+Math.sin(Math.min(1,p)*Math.PI)*.36;this.ctx.save();this.ctx.globalAlpha=alpha;this.ctx.translate(x,y);this.ctx.scale(scale,scale);if(pop.kills)this.gameText('+'+number(pop.kills)+' 처치',0,0,w<650?20:27,'center','#ffcf68');else if(pop.recovery)this.text(pop.resource+' +'+number(pop.damage),0,0,w<650?22:28,900,'center',pop.resource==='HP'?'#63f29b':'#65b9ff');else{if(pop.critical||pop.destiny)this.text((pop.destiny?'운명'+(pop.critical?' · ':''):'')+(pop.critical?'치명타':''),0,-26,w<650?10:12,900,'center',pop.destiny?'#d6a8ff':'#ffb0a8');this.text((pop.received?'-':'')+number(pop.damage),0,0,pop.received?(w<650?24:30):pop.critical?(w<650?39:53):(w<650?30:40),900,'center',pop.destiny?'#c388ff':pop.received?'#ff8f87':pop.critical?'#ff5d4d':'#ffe06e');if(pop.skill)this.text(pop.skill,0,25,w<650?9:11,800,'center','#efe4cd');}this.ctx.restore();return true;});}
        dialogLayer(w,h){if(!dialog)return;this.regions=[];const c=this.ctx;c.fillStyle='rgba(0,0,0,.78)';c.fillRect(0,0,w,h);const narrow=w<650,bw=Math.min(w-28,narrow?350:440),bh=narrow?224:246,x=(w-bw)/2,y=(h-bh)/2;this.panel(x,y,bw,bh,'rgba(232,176,75,.65)',true);this.text(dialog.title,w/2,y+42,narrow?21:25,900,'center','#fff7e8');this.line(x+38,y+67,x+bw-38,y+67,'rgba(232,176,75,.34)',1);const lines=cleanText(dialog.message).split('\n').map(cleanText).filter(line=>line&&!line.startsWith('/RPGenius')).slice(0,5);lines.forEach((line,index)=>this.text(line,w/2,y+94+index*18,narrow?10:12,650,'center','#c9c8c5',bw-34));const gap=8,buttonW=(bw-52-gap)/2,by=y+bh-60;this.actionButton(x+26,by,buttonW,40,{label:'취소',disabled:false,action:dialog.cancel});this.actionButton(x+26+buttonW+gap,by,buttonW,40,{label:dialog.okLabel,kind:'attack',disabled:false,action:dialog.ok});}
        fragmentLayer(w,h){
            if(!regularMode||!state||!state.pendingFragment)return;
            this.regions=[];const c=this.ctx,narrow=w<650,bw=Math.min(w-28,narrow?360:470),bh=narrow?250:280,x=(w-bw)/2,y=(h-bh)/2,fragment=state.pendingFragment;
            c.fillStyle='rgba(0,0,0,.86)';c.fillRect(0,0,w,h);const glow=c.createRadialGradient(w/2,h*.42,0,w/2,h*.42,Math.min(w,h)*.46);glow.addColorStop(0,'rgba(89,47,152,.58)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(0,0,w,h);
            this.panel(x,y,bw,bh,'rgba(179,124,255,.78)',true);this.gameText('편린 발견',w/2,y+48,narrow?29:36,'center','#efe1ff');
            this.text(typeof fragment==='string'?fragment:(fragment.name||fragment.tier||'신비한 편린'),w/2,y+91,narrow?14:17,900,'center','#cfa8ff');
            this.text('편린을 확인하기 전에는 다른 행동을 할 수 없습니다.',w/2,y+126,narrow?10:12,700,'center','#cbc6d1',bw-34);
            this.actionButton(w/2-(narrow?86:102),y+bh-72,narrow?172:204,50,{label:'편린 확인',kind:'gold',disabled:busy,action:()=>claimFragment()});
        }
        rewardCard(reward,cx,cy,size,reveal,featured){const c=this.ctx,s=clamp(reveal,0,1),cardH=featured?size:size*1.22,x=cx-size/2,y=cy-cardH/2;c.save();c.translate(cx,cy);c.scale(s,s);c.translate(-cx,-cy);const accent=String(reward.rarity||'').startsWith('신화')?'rgba(117,207,255,.95)':String(reward.rarity||'').startsWith('초월')?'rgba(255,103,87,.95)':'rgba(232,176,75,.68)';this.panel(x,y,size,cardH,accent,true);const art=featured?size*.78:size*.68,ax=cx-art/2,ay=y+(featured?size*.09:size*.08),frame=this.image(reward.frameUrl),icon=this.image(reward.iconUrl);if(frame)c.drawImage(frame,ax,ay,art,art);if(icon)c.drawImage(icon,ax,ay,art,art);if(!featured){this.text(String(reward.name||'').slice(0,10),cx,y+cardH-21,Math.max(8,size*.1),800,'center','#f2eee5',size-8);this.text('x'+number(reward.count||1),cx,y+cardH-9,Math.max(8,size*.09),800,'center','#e8b04b');}const sweep=(performance.now()-this.rewardStarted)%1300/1300;if(sweep<.48){c.save();this.cutPath(x,y,size,cardH,8);c.clip();const sx=x-size*.2+sweep/0.48*size*1.4,g=c.createLinearGradient(sx-24,0,sx+24,0);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.5,'rgba(255,255,255,.23)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(sx-24,y,48,cardH);c.restore();}c.restore();}
        rewardLayer(w,h){if(!rewards)return;this.regions=[];const c=this.ctx,tier=rewardTier(rewards),now=performance.now(),elapsed=now-(this.rewardStarted||now),narrow=w<650,cx=w/2,high=tier!=='normal',tint=tier==='mythic'?'25,38,90':tier==='transcend'?'105,15,8':'50,35,12';c.fillStyle='rgba(2,3,6,.95)';c.fillRect(0,0,w,h);const glow=c.createRadialGradient(cx,h*.43,0,cx,h*.43,Math.min(w,h)*.65);glow.addColorStop(0,'rgba('+tint+',.72)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(0,0,w,h);for(let i=0;i<(narrow?24:42);i++){const a=i*2.399+now/2600,r=(i%7+1)/7*Math.min(w,h)*.5,px=cx+Math.cos(a)*r,py=h*.45+Math.sin(a)*r;c.fillStyle=tier==='mythic'?'rgba(144,190,255,.38)':'rgba(255,184,82,.35)';c.fillRect(px,py,i%3===0?3:1,i%3===0?3:1);}if(high){const sigil=this.image(tier==='mythic'?ASSETS.mythicSigil:ASSETS.transcendSigil),reveal=clamp(elapsed/700,0,1),sigilSize=Math.min(narrow?w*.9:520,h*.62);if(sigil){c.save();c.translate(cx,h*.43);c.rotate((tier==='mythic'?1:-1)*now/18000);c.globalAlpha=.22+.25*Math.sin(now/500);c.drawImage(sigil,-sigilSize/2,-sigilSize/2,sigilSize,sigilSize);c.restore();}const title=tier==='mythic'?'신화':'초월',color=tier==='mythic'?'#baddff':'#ffb080';this.text(title,cx,h*(narrow?.12:.13),narrow?34:50,900,'center',color);this.text('장비 획득',cx,h*(narrow?.17:.19),narrow?11:14,800,'center','#f3eadc');const featured=rewards.find(r=>String(r.rarity||'').startsWith(tier==='mythic'?'신화':'초월'))||rewards[0],fy=h*(narrow?.41:.43),fs=narrow?118:154;this.rewardCard(featured,cx,fy,fs,Math.min(1,reveal*1.14),true);this.text(featured.name,cx,fy+fs*.62,narrow?17:23,900,'center','#fff8ec',w-30);this.text(featured.rarity||'',cx,fy+fs*.82,narrow?10:12,800,'center',color);const rest=rewards.filter(r=>r!==featured).slice(0,narrow?4:6),rs=narrow?55:68,rg=8,start=cx-(rest.length*rs+Math.max(0,rest.length-1)*rg)/2+rs/2;rest.forEach((reward,index)=>this.rewardCard(reward,start+index*(rs+rg),h*.7,rs,clamp((elapsed-650-index*120)/340,0,1),false));}else{this.text('전리품 획득',cx,h*(narrow?.16:.18),narrow?27:38,900,'center','#ffe4a8');this.line(cx-Math.min(180,w*.34),h*(narrow?.2:.225),cx-45,h*(narrow?.2:.225),'rgba(232,176,75,.7)',1);this.line(cx+45,h*(narrow?.2:.225),cx+Math.min(180,w*.34),h*(narrow?.2:.225),'rgba(232,176,75,.7)',1);const list=rewards.slice(0,narrow?4:7),size=narrow?74:96,gap=narrow?7:10,start=cx-(list.length*size+Math.max(0,list.length-1)*gap)/2+size/2;list.forEach((reward,index)=>this.rewardCard(reward,start+index*(size+gap),h*.43,size,clamp((elapsed-250-index*110)/320,0,1),false));}const bw=narrow?190:220,by=h*(narrow?.84:.83);this.actionButton(cx-bw/2,by,bw,48,{label:elapsed>950?'확인':'보상 확인 중',kind:'gold',disabled:elapsed<=950,action:closeRewards});}
        startEntryTransition(ticket){
            if(regularMode){this.entryTransition={start:performance.now(),duration:1650,field:ticket||{}};audio.stopBgm();audio.play('count',.52);return;}
            const cards=Array.from({length:30},(_,index)=>{const edge=index%4;return{targetX:(index%6+.5)/6+(Math.random()-.5)*.045,targetY:(Math.floor(index/6)+.5)/5+(Math.random()-.5)*.055,fromX:edge===0?-.16:edge===1?1.16:Math.random(),fromY:edge===2?-.2:edge===3?1.15:Math.random()*.72,delay:Math.random()*220,rotation:(Math.random()-.5)*1.2,spin:(Math.random()-.5)*5.4,sway:(Math.random()-.5)*.12};});
            this.entryTransition={start:performance.now(),duration:1900,ticket:ticket||{},cards};
            audio.stopBgm();
            audio.play('count',.52);
        }
        inEntryTransition(){return !!this.entryTransition;}
        entryTransitionLayer(w,h){
            const transition=this.entryTransition;if(!transition)return;
            this.regions=[];
            const c=this.ctx,elapsed=performance.now()-transition.start;
            if(elapsed>=transition.duration){this.entryTransition=null;audio.playBgm();audio.play('start',.76);this.showBanner(regularMode?'사냥 시작':'전투 시작',regularMode?'몰려드는 몬스터를 처치하세요':'부타를 처치하세요');this.impact(true);return;}
            if(regularMode){
                const cover=clamp(Math.min(elapsed/220,(transition.duration-elapsed)/300),0,1),cx=w/2,cy=h*.46,field=transition.field||{};
                c.fillStyle='rgba(1,3,7,'+(.34+cover*.64)+')';c.fillRect(0,0,w,h);
                const sweep=clamp((elapsed-170)/690,0,1),lineW=Math.min(w*.74,680)*sweep;
                this.line(cx-lineW/2,cy-48,cx+lineW/2,cy-48,'rgba(232,176,75,'+cover+')',2);
                this.line(cx-lineW/2,cy+48,cx+lineW/2,cy+48,'rgba(232,176,75,'+cover+')',2);
                c.save();c.globalAlpha=clamp((elapsed-260)/330,0,1)*clamp((transition.duration-elapsed)/220,0,1);this.gameText(field.name||selectedFieldName||'일반 필드',cx,cy-6,w<650?31:46,'center','#fff7e8',w-36);this.text('FIELD HUNT',cx,cy+29,w<650?10:13,900,'center','#e8b04b');c.restore();
                return;
            }
            const cover=clamp(elapsed/240,0,1)*clamp((transition.duration-elapsed)/380,0,1);
            c.fillStyle='rgba(2,3,7,'+(.18+cover*.72)+')';c.fillRect(0,0,w,h);
            const size=Math.min(300,Math.max(64,Math.max(w/6.15,h/5.15))),icon=this.image(transition.ticket.iconUrl);
            transition.cards.forEach(card=>{
                const flight=clamp((elapsed-card.delay)/520,0,1),ease=1-Math.pow(1-flight,3),fall=clamp((elapsed-760-card.delay*.16)/900,0,1),fallEase=fall*fall;
                const startX=card.fromX*w,startY=card.fromY*h,targetX=card.targetX*w,targetY=card.targetY*h;
                const x=startX+(targetX-startX)*ease+Math.sin(fall*Math.PI*3+card.delay)*w*card.sway*fall;
                const y=startY+(targetY-startY)*ease+fallEase*(h*1.18+size-targetY);
                const alpha=clamp(flight*3,0,1)*clamp((1-fall)*3.5,0,1),rotation=card.rotation*(1-ease)+(reducedMotion?0:card.spin*fall);
                c.save();c.globalAlpha=alpha;c.translate(x,y);c.rotate(rotation);c.shadowColor='rgba(240,184,75,.6)';c.shadowBlur=size*.09;c.shadowOffsetY=size*.04;
                if(icon)c.drawImage(icon,-size/2,-size/2,size,size);
                if(!icon){this.cutPath(-size/2,-size/2,size,size,size*.08);c.fillStyle='#bd781d';c.fill();this.gameText('H',0,0,size*.35,'center','#2d1704');}
                c.restore();
            });
        }
        loading(w,h){if(state)return;this.ctx.fillStyle='rgba(0,0,0,.68)';this.ctx.fillRect(0,0,w,h);const a=performance.now()/450;this.ctx.beginPath();this.ctx.arc(w/2,h/2,26,a,a+Math.PI*1.35);this.ctx.strokeStyle='#e8b04b';this.ctx.lineWidth=3;this.ctx.stroke();}
        draw(){const{w,h}=this.resize(),c=this.ctx;c.clearRect(0,0,w,h);this.regions=[];const shake=this.shakeUntil>performance.now()&&!reducedMotion?(Math.random()-.5)*8:0;c.save();c.translate(shake,0);if(state){this.bossHud(w);this.playerHud(w,h);this.combatLog(w,h);this.actions(w,h);this.consumableLauncher(w,h);this.lobby(w,h);}this.topControls(w);this.damageLayer(w,h);this.bannerLayer(w,h);this.consumableLayer(w,h);this.dialogLayer(w,h);this.rewardLayer(w,h);this.fragmentLayer(w,h);this.loading(w,h);this.entryTransitionLayer(w,h);if(this.flashUntil>performance.now()){const left=this.flashUntil-performance.now();c.fillStyle='rgba(255,255,255,'+clamp(left/this.flashDuration,0,.34)+')';c.fillRect(0,0,w,h);}c.restore();this.frame=requestAnimationFrame(()=>this.draw());}
        impact(strong){this.flashDuration=strong?260:130;this.flashUntil=performance.now()+this.flashDuration;if(strong)this.shakeUntil=performance.now()+380;}
        showBanner(text,sub){this.banner=text;this.bannerSub=sub||'';this.bannerUntil=performance.now()+1250;}
        startRewards(){this.rewardStarted=performance.now();}
    }

    const audio = new FieldAudio();
    let renderer;
    try { renderer = new FieldRenderer(sceneCanvas); } catch (error) { console.error(error); }
    const hud = new Hud(hudCanvas);

    function addLog(message, tone) {
        String(message || '').split('\n').map(cleanText).filter(line => line && !line.startsWith('/RPGenius')).forEach(line => logs.push({text:line,tone:tone||(line.includes('피해를 입었습니다')||line.includes('실패')?'bad':line.includes('보상')||line.includes('처치')?'good':'')}));
        logs=logs.slice(-12);
    }
    function selectedField(){return state&&(state.fields||[]).find(field=>field&&field.name===selectedFieldName)||null;}
    function applyState(next,options) { if(!next)return;state=next;clockOffset=Number(next.serverNow||Date.now())-Date.now();if(regularMode&&!selectedFieldName){const fields=next.fields||[],preferred=[...fields].reverse().find(field=>field.canEnter!==false&&!field.locked)||fields[0];if(preferred)selectedFieldName=preferred.name;}if(renderer){renderer.setState(next);if(regularMode&&!next.inField){const preview=(next.fields||[]).find(field=>field.name===selectedFieldName);if(preview)renderer.previewField(preview);}}if(!next.inField)hud.closeConsumables();if(next.inField&&!(options&&options.deferBgm))audio.playBgm();else audio.stopBgm(); }
    function setBusy(value){busy=value;}
    function showDialog(title,message,okLabel) { return new Promise(resolve=>{dialog={title,message,okLabel,cancel:()=>{dialog=null;resolve(false);},ok:()=>{dialog=null;resolve(true);}};}); }
    function rewardTier(list){if((list||[]).some(r=>String(r.rarity||'').startsWith('신화')))return'mythic';if((list||[]).some(r=>String(r.rarity||'').startsWith('초월')))return'transcend';return'normal';}
    function showRewards(list){rewards=list||[];const tier=rewardTier(rewards);hud.startRewards();hud.impact(true);if(renderer)renderer.rewardBurst(tier);audio.play('clear',.82);audio.fanfare(tier);}
    function closeRewards(){rewards=null;if(renderer)renderer.releaseHold();}
    async function enter(confirmed){const field=regularMode?selectedField():null,canEnter=regularMode?field&&field.canEnter!==false&&!field.locked:state&&state.canEnter;if(busy||!state||(!confirmed&&!canEnter))return;audio.unlock();const transitionAsset=regularMode?field:state.ticket;setBusy(true);try{const body={confirmed:confirmed===true};if(regularMode)body.fieldName=field&&field.name||selectedFieldName;const result=await request(apiBase+'/enter',body);applyState(result.state,{deferBgm:result.ok});addLog(result.message,result.ok?'good':'bad');if(result.ok)hud.startEntryTransition((result.state&&result.state.activeField)||transitionAsset);else if(result.needsConfirmation){setBusy(false);const accepted=await showDialog('입장 경고',result.message,'입장');if(accepted)return enter(true);await request(apiBase+'/cancel-entry',regularMode?{fieldName:body.fieldName}:{});addLog('필드 입장을 취소했습니다.');}else audio.play('fail',.42);}catch(error){addLog(error.message,'bad');audio.play('fail',.42);}finally{setBusy(false);}}
    async function action(path,body){if(busy||hud.inEntryTransition()||hud.inConsumableMenu()||!state||!state.inField||state.pendingFragment)return;audio.unlock();const previous=state;setBusy(true);try{const result=await request(apiBase+path,body||{});applyState(result.state);addLog(result.message,result.ok?'':'bad');if(result.ok){const event=result.event||{};if(renderer)renderer.animate(event,previous);hud.addDamage(event,previous);if(event.action==='skill')audio.play('skill',.68);else if(event.damage>0||event.killedCount>0)audio.hit();if(event.criticalCount){audio.play('crit',.82);hud.impact(true);}else if(event.damage>0||event.killedCount>0)hud.impact(false);if(event.received>0)setTimeout(()=>audio.hit(),90);if(regularMode&&event.eliteEncountered){setTimeout(()=>hud.showBanner('엘리트 조우',event.eliteName||'잡몹들을 밀어내며 등장합니다'),350);audio.play('start',.82);hud.impact(true);}if(regularMode&&event.eliteDefeated){hud.showBanner('엘리트 처치','잡몹들이 다시 몰려듭니다');audio.play('clear',.82);hud.impact(true);if((event.rewards||[]).length)setTimeout(()=>showRewards(event.rewards),1450);}if(!regularMode&&event.phaseChanged){hud.showBanner('결계 발동','기둥 두 개를 파괴하세요');audio.play('start',.68);hud.impact(true);}if(!regularMode&&event.pillarDestroyed!=null){const last=event.pillarDestroyed===1;hud.showBanner(last?'결계 붕괴':'기둥 파괴',last?'보상 봉인이 해제됩니다':'남은 기둥 1 / 2');audio.play(last?'clear':'crit',last?.72:.62);hud.impact(true);}if(event.cleared)showRewards(event.rewards||[]);if(event.defeated){hud.showBanner('전투 패배');audio.play('fail',.72);hud.impact(true);}}else audio.play('fail',.32);}catch(error){addLog(error.message,'bad');audio.play('fail',.42);}finally{setBusy(false);}}
    async function useConsumable(itemId){if(busy||hud.inEntryTransition()||!state||!state.inField||state.pendingFragment)return;audio.unlock();setBusy(true);try{const result=await request(apiBase+'/use-consumable',{itemId:Number(itemId)});applyState(result.state);addLog(result.message,result.ok?'good':'bad');if(result.ok){const event=result.event||{};if(renderer)renderer.recoveryBurst(event);hud.addRecovery(event);audio.play('potion',.68);}else audio.play('fail',.32);}catch(error){addLog(error.message,'bad');audio.play('fail',.42);}finally{setBusy(false);}}
    function attack(){const now=Date.now()+clockOffset;if(hud.inEntryTransition()||hud.inConsumableMenu()||!state||state.pendingFragment||now<Number(state.nextActionAt||0))return;action('/attack',{});}
    function useSkill(name){const skill=state&&(state.skills||[]).find(s=>s.name===name),now=Date.now()+clockOffset;if(hud.inEntryTransition()||hud.inConsumableMenu()||state&&state.pendingFragment||!skill||now<Number(skill.cooldownEnd||0)||now<Number(state.nextActionAt||0))return;action('/skill',{skillName:name});}
    async function claimFragment(){if(!regularMode||busy||!state||!state.pendingFragment)return;setBusy(true);try{const result=await request(apiBase+'/fragment',{});applyState(result.state);addLog(result.message,result.ok?'good':'bad');if(result.ok){const fragmentEvent=result.event||{},fragmentRewards=Array.isArray(fragmentEvent.rewards)?fragmentEvent.rewards:[];audio.play('clear',.78);hud.showBanner('편린 보상 획득');if(fragmentRewards.length)showRewards(fragmentRewards);}}catch(error){addLog(error.message,'bad');audio.play('fail',.42);}finally{setBusy(false);}}
    async function leave(){if(!state||!state.inField||state.pendingFragment)return;const accepted=await showDialog('필드 퇴장',regularMode?'현재 사냥을 끝내고 필드 선택으로 돌아갑니다.':'보상을 받지 못하며 사용한 초대장은 반환되지 않습니다.','퇴장');if(!accepted)return;setBusy(true);try{const result=await request(apiBase+'/leave',{});applyState(result.state);addLog(result.message,result.ok?'':'bad');if(result.ok)audio.stopBgm();}catch(error){addLog(error.message,'bad');}finally{setBusy(false);}}
    function backOrLeave(){if(hud.inEntryTransition()||regularMode&&state&&state.pendingFragment)return;if(hud.inConsumableMenu()){hud.closeConsumables();return;}if(dialog){dialog.cancel();return;}if(rewards){closeRewards();return;}if(state&&state.inField)leave();else location.href='/';}
    // 소환수(익테봇/수나타)·지속 피해(유서새김/장비 효과) 틱은 서버에서 백그라운드로 처리되므로 폴링 응답의 events로 데미지 팝업·로그를 그린다
    function showTickEvents(events,previous){(events||[]).forEach((event,index)=>{const damage=Number(event.damage||0),kills=Number(event.killedCount||0);if(!(damage>0||kills>0||event.phaseChanged))return;setTimeout(()=>{hud.addDamage(Object.assign({criticalCount:0,skillName:event.source||''},event,{damage,killedCount:kills}),previous);if(damage>0||kills>0){hud.impact(false);audio.hit();if(renderer&&typeof renderer.tickHit==='function')renderer.tickHit(previous,event);}if(regularMode&&event.eliteEncountered){if(renderer)renderer.startEliteIntro(kills);hud.showBanner('엘리트 조우',event.eliteName||'잡몹들을 밀어내며 등장합니다');audio.play('start',.82);hud.impact(true);}else if(regularMode&&event.eliteDefeated){if(renderer)renderer.startMobReturn();hud.showBanner('엘리트 처치','잡몹들이 다시 몰려듭니다');audio.play('clear',.82);hud.impact(true);if((event.rewards||[]).length)setTimeout(()=>showRewards(event.rewards),1450);}else if(!regularMode&&event.phaseChanged){hud.showBanner('결계 발동','기둥 두 개를 파괴하세요');audio.play('start',.68);hud.impact(true);}},index*140);addLog((event.source||'소환수')+' → '+(damage>0?number(damage)+' 피해':'')+(kills>0?' · '+number(kills)+'마리 처치':''));});}
    async function sync(quiet){if(busy)return;try{const previous=state,next=await request(apiBase);applyState(next,{deferBgm:hud.inEntryTransition()});if(previous&&previous.inField&&next.inField&&!hud.inEntryTransition()){showTickEvents(next.events,previous);if(regularMode&&previous.phase!==next.phase&&!(next.events||[]).some(event=>event&&(event.eliteEncountered||event.eliteDefeated))){const event={action:'tick',eliteEncountered:previous.phase==='normal'&&next.phase==='elite',eliteDefeated:previous.phase==='elite'&&next.phase==='normal'};if(renderer)renderer.animate(event,previous);hud.showBanner(event.eliteEncountered?'엘리트 조우':'엘리트 처치',event.eliteEncountered?'잡몹들을 밀어내며 등장합니다':'잡몹들이 다시 몰려듭니다');}}if(quiet&&previous&&previous.inField&&!next.inField){addLog('전투가 종료되었습니다.');audio.stopBgm();}}catch(error){if(!quiet)addLog(error.message,'bad');}}

    document.addEventListener('keydown',event=>{if(event.repeat)return;audio.unlock();const key=event.key.toLowerCase();if(hud.inConsumableMenu()){event.preventDefault();if(key==='escape'||event.code==='KeyP'){hud.closeConsumables();return;}if(key==='arrowleft'){hud.changeConsumablePage(-1,innerWidth,innerHeight);return;}if(key==='arrowright'){hud.changeConsumablePage(1,innerWidth,innerHeight);return;}if(/^[0-9]$/.test(key)){hud.useConsumableAt(key==='0'?9:Number(key)-1,innerWidth,innerHeight);}return;}if(event.code==='KeyP'&&state&&state.inField){event.preventDefault();hud.toggleConsumables();return;}if(key===' '||key==='j'){event.preventDefault();attack();return;}if(key==='e'&&state&&!state.inField){enter(false);return;}if(key==='escape'){event.preventDefault();backOrLeave();return;}if(/^[1-9]$/.test(key)&&state&&state.inField){const skill=state.skills[Number(key)-1];if(skill)useSkill(skill.name);}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.stopBgm();else{sync(true);if(!hud.inEntryTransition())audio.playBgm();}});
    window.addEventListener('beforeunload',()=>audio.stopBgm());

    addLog('전투 준비 완료');
    sync(false);
    pollTimer=setInterval(()=>{if(state&&state.inField)sync(true);},2000);
})();
