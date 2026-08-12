(function () {
    'use strict';

    const sceneCanvas = document.getElementById('hfCanvas');
    const hudCanvas = document.getElementById('hfHud');
    if (!sceneCanvas || !hudCanvas) return;

    const uiAsset = file => '/rpg-ui?file=' + encodeURIComponent(file);
    const ASSETS = {
        background: uiAsset('필드/부타게임H.png'),
        buta: uiAsset('필드/hfield-buta.png'),
        pillar: uiAsset('필드/hfield-pillar.png'),
        impact: uiAsset('필드/hfield-impact-v2.png'),
        mythicSigil: uiAsset('필드/hfield-mythic-sigil.png'),
        transcendSigil: uiAsset('필드/hfield-transcend-sigil.png')
    };
    const SOUNDS = {
        bgm: uiAsset('sfx/부타게임H.mp3'), start: uiAsset('sfx/start.mp3'),
        hit0: uiAsset('sfx/hit_0.mp3'), hit1: uiAsset('sfx/hit_1.mp3'), hit2: uiAsset('sfx/hit_2.mp3'),
        crit: uiAsset('sfx/crit.mp3'), skill: uiAsset('sfx/skill.mp3'), clear: uiAsset('sfx/clear.mp3'),
        fail: uiAsset('sfx/fail.mp3'), count: uiAsset('sfx/count.mp3')
    };
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const ratio = (value, max) => clamp(Number(value || 0) / Math.max(1, Number(max || 1)), 0, 1);
    const number = value => Number(value || 0).toLocaleString('ko-KR');
    const cleanText = value => String(value || '')
        .replace(/\p{Extended_Pictographic}/gu, '').replace(/[\uFE0E\uFE0F\u200D]/g, '')
        .replace(/^[-•]\s*/, '').trim();

    let state = null;
    let busy = false;
    let clockOffset = 0;
    let pollTimer = null;
    let logs = [];
    let dialog = null;
    let rewards = null;

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
            try { this.muted = localStorage.getItem('hfield-muted') === '1'; } catch (_) { this.muted = false; }
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
            try { localStorage.setItem('hfield-muted', this.muted ? '1' : '0'); } catch (_) {}
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
                precision mediump float; uniform sampler2D uTexture; uniform vec4 uColor; uniform float uMode; uniform float uFlash; varying vec2 vUv;
                void main(){vec4 p;if(uMode<0.5){p=texture2D(uTexture,vUv);p.rgb*=uColor.rgb;p.a*=uColor.a;}else if(uMode<1.5){float d=length((vUv-.5)*2.0);p=vec4(uColor.rgb,(1.0-smoothstep(0.0,1.0,d))*uColor.a);}else if(uMode<2.5){float l=1.0-smoothstep(.025,.22,abs(vUv.y-.5));float e=smoothstep(0.0,.2,vUv.x)*smoothstep(0.0,.2,1.0-vUv.x);p=vec4(uColor.rgb,l*e*uColor.a);}else{p=uColor;}p.rgb=mix(p.rgb,vec3(1.0),uFlash);if(p.a<.01)discard;gl_FragColor=p;}`);
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
        setState(next) {
            if (next && next.player && next.player.spriteUrl && this.playerUrl !== next.player.spriteUrl) {
                this.playerUrl = next.player.spriteUrl; this.loadTexture('player', this.playerUrl);
            }
            this.state = next;
        }
        releaseHold() { this.holdState = null; }
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
        animate(event, previous) {
            const now = performance.now(); this.attackAt = now; this.attackKind = event.action || 'attack';
            if (event.damage > 0) {
                this.targetHitUntil = now + (event.criticalCount ? 520 : 360);
                this.impactStarted = now;
                this.impactUntil = now + (event.action === 'skill' ? 520 : 390);
                this.impactCritical = Number(event.criticalCount || 0) > 0;
                this.impactSkill = event.action === 'skill';
                this.impactX = previous && previous.phase === 'pillar' ? (event.pillarDestroyed === 0 ? .65 : .81) : .74;
                this.impactY = previous && previous.phase === 'pillar' ? .54 : .51;
                this.burst(this.impactX, this.impactY, event.criticalCount ? [1,.68,.12,1] : [1,.2,.12,1], event.criticalCount ? 52 : 34);
            }
            if (event.received > 0) { this.playerHitUntil = now + 320; this.burst(.25,.61,[1,.12,.24,1],20); }
            if (event.pillarDestroyed != null) {
                const x = event.pillarDestroyed === 0 ? .65 : .81;
                this.burst(x, .58, [1,.16,.05,1], 78);
                for(let i=0;i<18;i++) this.particle({x,y:.55,vx:(Math.random()-.5)*.28,vy:-.1-Math.random()*.2,life:.7+Math.random()*.6,maxLife:1.3,width:.008+Math.random()*.018,height:.012+Math.random()*.025,spin:(Math.random()-.5)*8,color:[.32,.15,.09,1],mode:3});
            }
            if (event.cleared && previous) { this.holdState = JSON.parse(JSON.stringify(previous)); this.holdState.target.pillars = [false, false]; }
        }
        rewardBurst(tier) {
            const colors = tier === 'mythic' ? [[.2,.78,1,1],[.75,.32,1,1],[1,.8,.2,1]] : [[1,.1,.2,1],[1,.55,.1,1],[1,.8,.2,1]];
            for (let i=0;i<(reducedMotion?16:tier==='mythic'?100:60);i++) { const a=Math.random()*Math.PI*2,s=.07+Math.random()*.34; this.particle({x:.5,y:.48,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.8+Math.random()*1.2,maxLife:2,width:.008+Math.random()*.018,height:.008+Math.random()*.028,spin:(Math.random()-.5)*5,color:colors[i%colors.length]}); }
        }
        render(time) {
            this.resize(); const gl = this.gl, dt = Math.min(.04, Math.max(0, (time-this.last)/1000)); this.last=time;
            gl.clearColor(.005,.01,.025,1); gl.clear(gl.COLOR_BUFFER_BIT); const bg=this.cover('background');this.draw(this.textures.background,.5,.5,bg.width,bg.height); this.draw(null,.5,.5,1,1,{mode:3,color:[.01,.02,.05,.16]});
            const display = this.holdState || this.state || {}, narrow = innerWidth < 700, phase = display.phase || 'elite';
            const idle = reducedMotion ? 0 : Math.sin(time/520)*.005, progress=clamp((time-this.attackAt)/(this.attackKind==='skill'?620:430),0,1), lunge=progress<1?Math.sin(progress*Math.PI)*.12:0;
            const playerFit=this.fit('player',narrow?.62:.78,narrow?.48:.36), playerX=(narrow?.24:.25)+lunge;
            this.draw(null,playerX,.83,narrow?.4:.27,.11,{mode:1,color:[.08,.45,1,.25]});
            this.draw(this.textures.player,playerX,narrow?.68:.66-idle,playerFit.width,playerFit.height,{flash:time<this.playerHitUntil?.75:0});
            if (phase === 'pillar') {
                const alive = display.target && display.target.pillars || [true,true];
                [0,1].forEach(index => { if (!alive[index]) return; const x=narrow?(index?.78:.61):(index?.81:.65), fit=this.fit('pillar',narrow?.48:.62,narrow?.34:.25),hit=time<this.targetHitUntil&&Math.abs(x-this.impactX)<.11; this.draw(null,x,.78,fit.width*.9,.12,{mode:1,color:[1,.08,.02,.25]}); this.draw(this.textures.pillar,x+(hit?Math.sin(time*.16)*.008:0),.62+idle,fit.width,fit.height,{flash:hit?.85:0}); });
            } else {
                const fit=this.fit('buta',narrow?.72:.88,narrow?.5:.44),hit=time<this.targetHitUntil; this.draw(null,narrow?.75:.74,.8,narrow?.43:.32,.13,{mode:1,color:[1,.04,.12,.24]}); this.draw(this.textures.buta,(narrow?.75:.74)+(hit?Math.sin(time*.18)*.006:0),narrow?.62:.61+idle,fit.width,fit.height,{flash:hit?.85:0,color:[1,1,1,display.inField?1:.82]});
            }
            if(time<this.impactUntil){const p=clamp((time-this.impactStarted)/Math.max(1,this.impactUntil-this.impactStarted),0,1),pulse=Math.sin(p*Math.PI),fit=this.fit('impact',(this.impactSkill?.52:.4)*(.72+pulse*.42),this.impactSkill?.42:.33),alpha=Math.pow(1-p,.42);this.draw(this.textures.impact,this.impactX,this.impactY,fit.width,fit.height,{color:[1,1,1,alpha],rotation:(this.impactSkill?-.08:.08)+p*.05});if(this.impactCritical)this.draw(this.textures.impact,this.impactX-.01,this.impactY+.01,fit.width*.72,fit.height*.72,{color:[1,.86,.52,alpha*.72],rotation:-.75});}
            if (time>this.ambientAt) { this.ambientAt=time+(reducedMotion?500:170); this.particle({x:Math.random()<.5?.04:.96,y:.55+Math.random()*.4,vx:(Math.random()-.5)*.01,vy:-.025,life:3,maxLife:3,width:.005+Math.random()*.008,height:.005+Math.random()*.008,color:Math.random()<.5?[.4,.2,1,.55]:[1,.15,.25,.5]}); }
            this.particles=this.particles.filter(p=>{p.life-=dt;if(p.life<=0)return false;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.07*dt;p.rotation+=p.spin*dt;const c=p.color.slice();c[3]*=clamp(p.life/p.maxLife*2.4,0,1);this.draw(null,p.x,p.y,p.width,p.height,{mode:p.mode,color:c,rotation:p.rotation});return true;});
            this.frame=requestAnimationFrame(next=>this.render(next));
        }
    }

    class Hud {
        constructor(canvas) {
            this.canvas=canvas;this.ctx=canvas.getContext('2d');this.regions=[];this.images=new Map();this.flashUntil=0;this.flashDuration=1;this.shakeUntil=0;this.banner=null;this.bannerSub='';this.bannerUntil=0;this.damagePops=[];this.rewardStarted=0;this.bossLagHp=null;this.bossKey='';this.entryTransition=null;this.frame=requestAnimationFrame(()=>this.draw());
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
        bossHud(w){if(!state||!state.inField)return;const narrow=w<650,bw=Math.min(narrow?w-120:720,w*.72),x=(w-bw)/2,y=narrow?13:16,key=state.phase+':'+state.target.maxHp;if(this.bossKey!==key){this.bossKey=key;this.bossLagHp=Number(state.target.hp||0);}this.bossLagHp+=(Number(state.target.hp||0)-this.bossLagHp)*.055;const meta=state.phase==='pillar'?'결계 기둥 '+(state.target.pillars||[]).filter(Boolean).length+' / 2':'';this.text(state.target.name,w/2,y+9,narrow?16:20,900,'center','#f7f2e8');if(meta)this.text(meta,w/2,y+27,9,800,'center','#e8b04b');const by=y+(meta?38:28),bh=narrow?15:19;this.bar(x,by,bw,bh,state.target.hp,state.target.maxHp,'#b92d2d',this.bossLagHp);this.text(number(state.target.hp)+' / '+number(state.target.maxHp),w/2,by+bh/2,narrow?9:11,800,'center','#fff');}
        playerHud(w,h){if(!state||!state.inField)return;const narrow=w<650,pw=narrow?Math.min(238,w*.61):304,ph=narrow?84:94,x=narrow?12:24,y=h-(narrow?184:178);this.panel(x,y,pw,ph,'rgba(232,176,75,.58)');const portrait=this.image(state.player.cardImageUrl),ps=narrow?50:58,px=x+8,py=y+8,infoX=px+ps+9,infoRight=x+pw-9,infoW=infoRight-infoX;this.ctx.save();this.cutPath(px,py,ps,ps,6);this.ctx.clip();if(portrait)this.ctx.drawImage(portrait,px,py,ps,ps);else{this.ctx.fillStyle='#11141b';this.ctx.fillRect(px,py,ps,ps);}this.ctx.restore();this.cutPath(px,py,ps,ps,6);this.ctx.strokeStyle='rgba(232,176,75,.72)';this.ctx.stroke();this.text(state.player.name,infoX,y+16,narrow?13:15,900,'left','#fff5df',infoW);const skin=['[𝛧]',state.player.cardSkin,state.player.cardName].filter(Boolean).join(' ');this.text(skin,infoX,y+34,narrow?8:10,700,'left','#aeb4bf',infoW);const hpTextY=y+(narrow?48:52),hpBarY=y+(narrow?54:59),mpTextY=y+(narrow?65:71),mpBarY=y+(narrow?71:78);this.text('HP',infoX,hpTextY,8,800,'left','#bbb1a0');this.text(number(state.player.hp),infoRight,hpTextY,8,800,'right','#e9e5dc');this.bar(infoX,hpBarY,infoW,6,state.player.hp,state.player.maxHp,'#b92d2d');this.text('MP',infoX,mpTextY,8,800,'left','#bbb1a0');this.text(number(state.player.mp),infoRight,mpTextY,8,800,'right','#e9e5dc');this.bar(infoX,mpBarY,infoW,6,state.player.mp,state.player.maxMp,'#147fc4');}
        combatLog(w,h){if(!state||!state.inField||!logs.length)return;const narrow=w<650,lines=logs.slice(-4),x=narrow?12:26,base=h-(narrow?201:196),lineH=narrow?14:16;lines.forEach((entry,index)=>{const alpha=.42+(index+1)/lines.length*.58,col=entry.tone==='bad'?'224,101,92':entry.tone==='good'?'240,197,110':'220,224,230';this.text(entry.text,x,base-(lines.length-1-index)*lineH,narrow?9:10,entry.tone==='good'?800:650,'left','rgba('+col+','+alpha+')',Math.min(narrow?w-24:460,w*.48));});}
        actions(w,h){if(!state||!state.inField)return;const narrow=w<650,now=Date.now()+clockOffset,actionLeft=Math.max(0,Number(state.nextActionAt||0)-now)/1000,skills=(state.skills||[]).slice(0,narrow?4:7),gap=narrow?5:7,maxW=Math.min(narrow?w-24:780,w-40),y=h-(narrow?82:76),ah=narrow?68:62,attackW=narrow?86:122,sw=skills.length?Math.min(narrow?62:94,(maxW-attackW-gap*skills.length)/skills.length):0,usedW=skills.length*sw+gap*skills.length+attackW,x=(w-usedW)/2;skills.forEach((skill,index)=>{const left=Math.max(actionLeft,(Number(skill.cooldownEnd||0)-now)/1000),mpLow=Number(state.player.mp)<Number(skill.mpCost||0),disabled=busy||left>0||mpLow;this.actionButton(x+index*(sw+gap),y,sw,ah,{label:skill.name.slice(0,6),sub:Number(skill.mpCost||0)+' MP',key:String(index+1),disabled,cooldown:Math.max(0,left),action:()=>useSkill(skill.name)});});const ax=x+usedW-attackW;this.actionButton(ax,y,attackW,ah,{label:'공격',sub:narrow?'J':'SPACE / J',key:'J',kind:'attack',disabled:busy||actionLeft>0,cooldown:actionLeft,action:()=>attack()});}
        lobby(w,h){if(!state||state.inField)return;const c=this.ctx,narrow=w<650,cx=w/2,cy=h*.46,top=c.createLinearGradient(0,0,0,h);top.addColorStop(0,'rgba(0,0,0,.18)');top.addColorStop(.55,'rgba(0,0,0,.02)');top.addColorStop(1,'rgba(0,0,0,.72)');c.fillStyle=top;c.fillRect(0,0,w,h);this.gameText('부타게임 [H]',cx,cy-(narrow?110:130),narrow?31:43,'center','#fff7e8');this.line(cx-(narrow?105:150),cy-(narrow?82:94),cx-30,cy-(narrow?82:94),'rgba(232,176,75,.8)',1);this.line(cx+30,cy-(narrow?82:94),cx+(narrow?105:150),cy-(narrow?82:94),'rgba(232,176,75,.8)',1);this.text('Lv. '+state.requirements.minLevel+'–'+state.requirements.maxLevel,cx,cy-(narrow?40:48),narrow?11:13,800,'center','#d8d2c8');if(state.entryError)this.text(state.entryError,cx,cy-(narrow?17:21),narrow?9:11,750,'center','#f0a39b',w-30);const bw=narrow?168:184,bh=narrow?66:72,by=cy+(narrow?34:48),bx=cx-bw/2;this.actionButton(bx,by,bw,bh,{label:state.canEnter?'입장':'입장 불가',labelYRatio:.35,key:'',kind:'gold',disabled:busy||!state.canEnter,action:()=>enter(false)});const iconSize=narrow?28:30,countText=number(state.ticket.count)+'/'+number(state.ticket.cost),countSize=narrow?10:11,rowY=by+bh*.72;c.font='900 '+countSize+'px Pretendard, sans-serif';const rowW=iconSize+6+c.measureText(countText).width,ix=cx-rowW/2,iy=rowY-iconSize/2,icon=this.image(state.ticket.iconUrl);if(icon)c.drawImage(icon,ix,iy,iconSize,iconSize);else{this.cutPath(ix,iy,iconSize,iconSize,3);c.fillStyle='rgba(38,24,5,.35)';c.fill();this.gameText('H',ix+iconSize/2,iy+iconSize/2,10,'center','#3e290c');}this.text(countText,ix+iconSize+6,rowY,countSize,900,'left',state.canEnter?'#2b1b05':'#6f6b62');this.text('E',bx+bw-8,by+9,7,900,'right',state.canEnter?'#4a2d08':'#73706a');}
        bannerLayer(w,h){if(!this.banner||this.bannerUntil<=performance.now())return;const remain=this.bannerUntil-performance.now(),age=1-clamp(remain/1250,0,1),alpha=clamp(Math.min(age*5,remain/220),0,1),narrow=w<650,c=this.ctx,cx=w/2,y=h*(narrow?.3:.33),bw=Math.min(w-40,narrow?310:460);c.save();c.globalAlpha=alpha;const glow=c.createRadialGradient(cx,y,0,cx,y,bw*.58);glow.addColorStop(0,'rgba(232,176,75,.2)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(cx-bw*.7,y-70,bw*1.4,140);this.line(cx-bw/2,y-22,cx-72,y-22,'rgba(232,176,75,.8)',1);this.line(cx+72,y-22,cx+bw/2,y-22,'rgba(232,176,75,.8)',1);this.text(this.banner,cx,y,narrow?25:36,900,'center','#fff8e8');if(this.bannerSub)this.text(this.bannerSub,cx,y+29,narrow?10:12,800,'center','#e8b04b');c.restore();}
        addDamage(event,previous){if(Number(event.damage||0)>0)this.damagePops.push({damage:Number(event.damage),critical:Number(event.criticalCount||0)>0,skill:event.skillName||'',start:performance.now(),x:previous&&previous.phase==='pillar'?(event.pillarDestroyed===0?.65:.81):.74,y:previous&&previous.phase==='pillar'?.46:.42,received:false});if(Number(event.received||0)>0)this.damagePops.push({damage:Number(event.received),critical:false,start:performance.now()+80,x:.25,y:.55,received:true});}
        damageLayer(w,h){const now=performance.now();this.damagePops=this.damagePops.filter(pop=>{const p=(now-pop.start)/950;if(p<0)return true;if(p>=1)return false;const ease=1-Math.pow(1-clamp(p,0,1),3),x=w*pop.x,y=h*pop.y-ease*(pop.received?45:82),alpha=clamp(Math.min(p*8,(1-p)*3.4),0,1),scale=.7+Math.sin(Math.min(1,p)*Math.PI)*.36;this.ctx.save();this.ctx.globalAlpha=alpha;this.ctx.translate(x,y);this.ctx.scale(scale,scale);if(pop.critical)this.text('치명타',0,-26,w<650?10:12,900,'center','#ffb0a8');this.text((pop.received?'-':'')+number(pop.damage),0,0,pop.received?(w<650?24:30):pop.critical?(w<650?39:53):(w<650?30:40),900,'center',pop.received?'#ff8f87':pop.critical?'#ff5d4d':'#ffe06e');if(pop.skill)this.text(pop.skill,0,25,w<650?9:11,800,'center','#efe4cd');this.ctx.restore();return true;});}
        dialogLayer(w,h){if(!dialog)return;this.regions=[];const c=this.ctx;c.fillStyle='rgba(0,0,0,.78)';c.fillRect(0,0,w,h);const narrow=w<650,bw=Math.min(w-28,narrow?350:440),bh=narrow?224:246,x=(w-bw)/2,y=(h-bh)/2;this.panel(x,y,bw,bh,'rgba(232,176,75,.65)',true);this.text(dialog.title,w/2,y+42,narrow?21:25,900,'center','#fff7e8');this.line(x+38,y+67,x+bw-38,y+67,'rgba(232,176,75,.34)',1);const lines=cleanText(dialog.message).split('\n').map(cleanText).filter(line=>line&&!line.startsWith('/RPGenius')).slice(0,5);lines.forEach((line,index)=>this.text(line,w/2,y+94+index*18,narrow?10:12,650,'center','#c9c8c5',bw-34));const gap=8,buttonW=(bw-52-gap)/2,by=y+bh-60;this.actionButton(x+26,by,buttonW,40,{label:'취소',disabled:false,action:dialog.cancel});this.actionButton(x+26+buttonW+gap,by,buttonW,40,{label:dialog.okLabel,kind:'attack',disabled:false,action:dialog.ok});}
        rewardCard(reward,cx,cy,size,reveal,featured){const c=this.ctx,s=clamp(reveal,0,1),cardH=featured?size:size*1.22,x=cx-size/2,y=cy-cardH/2;c.save();c.translate(cx,cy);c.scale(s,s);c.translate(-cx,-cy);const accent=String(reward.rarity||'').startsWith('신화')?'rgba(117,207,255,.95)':String(reward.rarity||'').startsWith('초월')?'rgba(255,103,87,.95)':'rgba(232,176,75,.68)';this.panel(x,y,size,cardH,accent,true);const art=featured?size*.78:size*.68,ax=cx-art/2,ay=y+(featured?size*.09:size*.08),frame=this.image(reward.frameUrl),icon=this.image(reward.iconUrl);if(frame)c.drawImage(frame,ax,ay,art,art);if(icon)c.drawImage(icon,ax,ay,art,art);if(!featured){this.text(String(reward.name||'').slice(0,10),cx,y+cardH-21,Math.max(8,size*.1),800,'center','#f2eee5',size-8);this.text('x'+number(reward.count||1),cx,y+cardH-9,Math.max(8,size*.09),800,'center','#e8b04b');}const sweep=(performance.now()-this.rewardStarted)%1300/1300;if(sweep<.48){c.save();this.cutPath(x,y,size,cardH,8);c.clip();const sx=x-size*.2+sweep/0.48*size*1.4,g=c.createLinearGradient(sx-24,0,sx+24,0);g.addColorStop(0,'rgba(255,255,255,0)');g.addColorStop(.5,'rgba(255,255,255,.23)');g.addColorStop(1,'rgba(255,255,255,0)');c.fillStyle=g;c.fillRect(sx-24,y,48,cardH);c.restore();}c.restore();}
        rewardLayer(w,h){if(!rewards)return;this.regions=[];const c=this.ctx,tier=rewardTier(rewards),now=performance.now(),elapsed=now-(this.rewardStarted||now),narrow=w<650,cx=w/2,high=tier!=='normal',tint=tier==='mythic'?'25,38,90':tier==='transcend'?'105,15,8':'50,35,12';c.fillStyle='rgba(2,3,6,.95)';c.fillRect(0,0,w,h);const glow=c.createRadialGradient(cx,h*.43,0,cx,h*.43,Math.min(w,h)*.65);glow.addColorStop(0,'rgba('+tint+',.72)');glow.addColorStop(1,'rgba(0,0,0,0)');c.fillStyle=glow;c.fillRect(0,0,w,h);for(let i=0;i<(narrow?24:42);i++){const a=i*2.399+now/2600,r=(i%7+1)/7*Math.min(w,h)*.5,px=cx+Math.cos(a)*r,py=h*.45+Math.sin(a)*r;c.fillStyle=tier==='mythic'?'rgba(144,190,255,.38)':'rgba(255,184,82,.35)';c.fillRect(px,py,i%3===0?3:1,i%3===0?3:1);}if(high){const sigil=this.image(tier==='mythic'?ASSETS.mythicSigil:ASSETS.transcendSigil),reveal=clamp(elapsed/700,0,1),sigilSize=Math.min(narrow?w*.9:520,h*.62);if(sigil){c.save();c.translate(cx,h*.43);c.rotate((tier==='mythic'?1:-1)*now/18000);c.globalAlpha=.22+.25*Math.sin(now/500);c.drawImage(sigil,-sigilSize/2,-sigilSize/2,sigilSize,sigilSize);c.restore();}const title=tier==='mythic'?'신화':'초월',color=tier==='mythic'?'#baddff':'#ffb080';this.text(title,cx,h*(narrow?.12:.13),narrow?34:50,900,'center',color);this.text('장비 획득',cx,h*(narrow?.17:.19),narrow?11:14,800,'center','#f3eadc');const featured=rewards.find(r=>String(r.rarity||'').startsWith(tier==='mythic'?'신화':'초월'))||rewards[0],fy=h*(narrow?.41:.43),fs=narrow?118:154;this.rewardCard(featured,cx,fy,fs,Math.min(1,reveal*1.14),true);this.text(featured.name,cx,fy+fs*.62,narrow?17:23,900,'center','#fff8ec',w-30);this.text(featured.rarity||'',cx,fy+fs*.82,narrow?10:12,800,'center',color);const rest=rewards.filter(r=>r!==featured).slice(0,narrow?4:6),rs=narrow?55:68,rg=8,start=cx-(rest.length*rs+Math.max(0,rest.length-1)*rg)/2+rs/2;rest.forEach((reward,index)=>this.rewardCard(reward,start+index*(rs+rg),h*.7,rs,clamp((elapsed-650-index*120)/340,0,1),false));}else{this.text('전리품 획득',cx,h*(narrow?.16:.18),narrow?27:38,900,'center','#ffe4a8');this.line(cx-Math.min(180,w*.34),h*(narrow?.2:.225),cx-45,h*(narrow?.2:.225),'rgba(232,176,75,.7)',1);this.line(cx+45,h*(narrow?.2:.225),cx+Math.min(180,w*.34),h*(narrow?.2:.225),'rgba(232,176,75,.7)',1);const list=rewards.slice(0,narrow?4:7),size=narrow?74:96,gap=narrow?7:10,start=cx-(list.length*size+Math.max(0,list.length-1)*gap)/2+size/2;list.forEach((reward,index)=>this.rewardCard(reward,start+index*(size+gap),h*.43,size,clamp((elapsed-250-index*110)/320,0,1),false));}const bw=narrow?190:220,by=h*(narrow?.84:.83);this.actionButton(cx-bw/2,by,bw,48,{label:elapsed>950?'확인':'보상 확인 중',kind:'gold',disabled:elapsed<=950,action:closeRewards});}
        startEntryTransition(ticket){
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
            if(elapsed>=transition.duration){this.entryTransition=null;audio.playBgm();audio.play('start',.76);this.showBanner('전투 시작','부타를 처치하세요');this.impact(true);return;}
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
        draw(){const{w,h}=this.resize(),c=this.ctx;c.clearRect(0,0,w,h);this.regions=[];const shake=this.shakeUntil>performance.now()&&!reducedMotion?(Math.random()-.5)*8:0;c.save();c.translate(shake,0);if(state){this.bossHud(w);this.playerHud(w,h);this.combatLog(w,h);this.actions(w,h);this.lobby(w,h);}this.topControls(w);this.damageLayer(w,h);this.bannerLayer(w,h);this.dialogLayer(w,h);this.rewardLayer(w,h);this.loading(w,h);this.entryTransitionLayer(w,h);if(this.flashUntil>performance.now()){const left=this.flashUntil-performance.now();c.fillStyle='rgba(255,255,255,'+clamp(left/this.flashDuration,0,.34)+')';c.fillRect(0,0,w,h);}c.restore();this.frame=requestAnimationFrame(()=>this.draw());}
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
    function applyState(next,options) { if(!next)return;state=next;clockOffset=Number(next.serverNow||Date.now())-Date.now();if(renderer)renderer.setState(next);if(next.inField&&!(options&&options.deferBgm))audio.playBgm();else audio.stopBgm(); }
    function setBusy(value){busy=value;}
    function showDialog(title,message,okLabel) { return new Promise(resolve=>{dialog={title,message,okLabel,cancel:()=>{dialog=null;resolve(false);},ok:()=>{dialog=null;resolve(true);}};}); }
    function rewardTier(list){if((list||[]).some(r=>String(r.rarity||'').startsWith('신화')))return'mythic';if((list||[]).some(r=>String(r.rarity||'').startsWith('초월')))return'transcend';return'normal';}
    function showRewards(list){rewards=list||[];const tier=rewardTier(rewards);hud.startRewards();hud.impact(true);if(renderer)renderer.rewardBurst(tier);audio.play('clear',.82);audio.fanfare(tier);}
    function closeRewards(){rewards=null;if(renderer)renderer.releaseHold();}
    async function enter(confirmed){if(busy||!state||(!confirmed&&!state.canEnter))return;audio.unlock();const ticket=state.ticket;setBusy(true);try{const result=await request('/api/hfield/enter',{confirmed:confirmed===true});applyState(result.state,{deferBgm:result.ok});addLog(result.message,result.ok?'good':'bad');if(result.ok)hud.startEntryTransition(ticket);else if(result.needsConfirmation){setBusy(false);const accepted=await showDialog('입장 경고',result.message,'입장');if(accepted)return enter(true);await request('/api/hfield/cancel-entry',{});addLog('필드 입장을 취소했습니다.');}else audio.play('fail',.42);}catch(error){addLog(error.message,'bad');audio.play('fail',.42);}finally{setBusy(false);}}
    async function action(path,body){if(busy||hud.inEntryTransition()||!state||!state.inField)return;audio.unlock();const previous=state;setBusy(true);try{const result=await request(path,body||{});applyState(result.state);addLog(result.message,result.ok?'':'bad');if(result.ok){const event=result.event||{};if(renderer)renderer.animate(event,previous);hud.addDamage(event,previous);if(event.action==='skill')audio.play('skill',.68);else if(event.damage>0)audio.hit();if(event.criticalCount){audio.play('crit',.82);hud.impact(true);}else if(event.damage>0)hud.impact(false);if(event.received>0)setTimeout(()=>audio.hit(),90);if(event.phaseChanged){hud.showBanner('결계 발동','기둥 두 개를 파괴하세요');audio.play('start',.68);hud.impact(true);}if(event.pillarDestroyed!=null){const last=event.pillarDestroyed===1;hud.showBanner(last?'결계 붕괴':'기둥 파괴',last?'보상 봉인이 해제됩니다':'남은 기둥 1 / 2');audio.play(last?'clear':'crit',last?.72:.62);hud.impact(true);}if(event.cleared)showRewards(event.rewards||[]);if(event.defeated){hud.showBanner('전투 패배');audio.play('fail',.72);hud.impact(true);}}else audio.play('fail',.32);}catch(error){addLog(error.message,'bad');audio.play('fail',.42);}finally{setBusy(false);}}
    function attack(){const now=Date.now()+clockOffset;if(hud.inEntryTransition()||!state||now<Number(state.nextActionAt||0))return;action('/api/hfield/attack',{});}
    function useSkill(name){const skill=state&&(state.skills||[]).find(s=>s.name===name),now=Date.now()+clockOffset;if(hud.inEntryTransition()||!skill||now<Number(skill.cooldownEnd||0)||now<Number(state.nextActionAt||0))return;action('/api/hfield/skill',{skillName:name});}
    async function leave(){if(!state||!state.inField)return;const accepted=await showDialog('필드 퇴장','보상을 받지 못하며 사용한 초대장은 반환되지 않습니다.','퇴장');if(!accepted)return;setBusy(true);try{const result=await request('/api/hfield/leave',{});applyState(result.state);addLog(result.message,result.ok?'':'bad');if(result.ok)audio.stopBgm();}catch(error){addLog(error.message,'bad');}finally{setBusy(false);}}
    function backOrLeave(){if(hud.inEntryTransition())return;if(dialog){dialog.cancel();return;}if(rewards){closeRewards();return;}if(state&&state.inField)leave();else location.href='/';}
    async function sync(quiet){if(busy)return;try{const previous=state,next=await request('/api/hfield');applyState(next,{deferBgm:hud.inEntryTransition()});if(quiet&&previous&&previous.inField&&!next.inField){addLog('전투가 종료되었습니다.');audio.stopBgm();}}catch(error){if(!quiet)addLog(error.message,'bad');}}

    document.addEventListener('keydown',event=>{if(event.repeat)return;audio.unlock();const key=event.key.toLowerCase();if(key===' '||key==='j'){event.preventDefault();attack();return;}if(key==='e'&&state&&!state.inField){enter(false);return;}if(key==='escape'){event.preventDefault();backOrLeave();return;}if(/^[1-9]$/.test(key)&&state&&state.inField){const skill=state.skills[Number(key)-1];if(skill)useSkill(skill.name);}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)audio.stopBgm();else{sync(true);if(!hud.inEntryTransition())audio.playBgm();}});
    window.addEventListener('beforeunload',()=>audio.stopBgm());

    addLog('전투 준비 완료');
    sync(false);
    pollTimer=setInterval(()=>{if(state&&state.inField)sync(true);},2000);
})();
