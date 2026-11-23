/* RPGENIUS 계정 화면: 거울 호수.
   로그인은 물에 잠긴 밤의 세계, 캐릭터 선택은 물 건너 황금빛 세계다. 물은 위에 있는 세계가 아니라 반대편 세계를 비춘다.
   account_screens.js가 만든 문서에서만 실행된다. 서버 문자열은 textContent로만 넣는다.
   그림은 public/assets/account-stage/의 생성 이미지, 효과음은 같은 폴더의 녹음 파일만 쓴다(CREDITS.md 참고). */
(function () {
  'use strict';

  const doc = document, body = doc.body;
  const screen = body.getAttribute('data-screen');
  const ASSET = '/static/assets/account-stage/';
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => reduceQuery.matches;
  const $ = id => doc.getElementById(id);
  const fmt = n => (Number.isFinite(Number(n)) ? Number(n) : 0).toLocaleString('ko-KR');

  function el(tag, cls, text) {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  }
  // 이미지 주소는 같은 출처 경로나 http(s)만 받는다.
  function safeUrl(url) {
    return typeof url == 'string' && (/^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url)) ? url : '';
  }

  /* ---------- 소리 ---------- */
  const Sound = (() => {
    const AC = window.AudioContext || window.webkitAudioContext;
    const KEY = 'rpgAccountStageMuted';
    let ctx = null, master = null, unlocked = false, opening = null;
    let muted = false;
    try { muted = localStorage.getItem(KEY) == '1'; } catch (_) { /* 저장소를 못 쓰면 켠 채로 둔다 */ }
    const buffers = {}, loops = {}, wanted = {};

    function ensure() {
      if (!AC) return null;
      if (!ctx) {
        try { ctx = new AC(); } catch (_) { return null; }
        master = ctx.createGain();
        master.gain.value = muted ? 0 : 1;
        master.connect(ctx.destination);
      }
      return ctx;
    }
    function load(name) {
      if (!buffers[name]) {
        buffers[name] = fetch(ASSET + name + '.mp3')
          .then(res => { if (!res.ok) throw new Error('sound'); return res.arrayBuffer(); })
          .then(data => new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject)))
          .catch(() => null);
      }
      return buffers[name];
    }
    function running() { return !!ctx && ctx.state == 'running'; }
    function play(name, volume, rate) {
      if (muted || !ctx) return;
      // 첫 입력 직후에는 장치가 아직 열리는 중이므로 열린 뒤에 튼다.
      (running() ? Promise.resolve() : opening || Promise.reject()).then(() => load(name)).then(buffer => {
        if (!buffer || muted || !running()) return;
        const source = ctx.createBufferSource(), gain = ctx.createGain();
        source.buffer = buffer;
        if (rate) source.playbackRate.value = rate;
        gain.gain.value = volume == null ? 1 : volume;
        source.connect(gain); gain.connect(master);
        source.start();
      }, () => {});
    }
    function startLoops() {
      if (!running()) return;
      Object.keys(wanted).forEach(name => {
        if (loops[name]) return;
        loops[name] = true;
        load(name).then(buffer => {
          if (!buffer || !ctx) { loops[name] = null; return; }
          const source = ctx.createBufferSource(), gain = ctx.createGain();
          source.buffer = buffer; source.loop = true;
          gain.gain.setValueAtTime(0, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(wanted[name], ctx.currentTime + 2);
          source.connect(gain); gain.connect(master);
          source.start();
          loops[name] = source;
        });
      });
    }
    function loop(name, volume) { wanted[name] = volume; startLoops(); }
    // 브라우저가 소리를 막아 두므로 첫 입력에서 연다.
    function unlock() {
      if (!ensure()) return;
      unlocked = true;
      if (ctx.state == 'suspended') { opening = ctx.resume(); opening.then(startLoops, () => {}); }
      else startLoops();
    }
    function tryAuto() {
      if (!ensure()) return;
      if (running()) { unlocked = true; startLoops(); }
    }
    function setMuted(next) {
      muted = !!next;
      try { localStorage.setItem(KEY, muted ? '1' : '0'); } catch (_) { /* 무시 */ }
      if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.08);
    }
    doc.addEventListener('visibilitychange', () => {
      if (!ctx || !unlocked) return;
      if (doc.hidden) ctx.suspend().catch(() => {});
      else ctx.resume().then(startLoops, () => {});
    });
    const firstInput = () => { unlock(); if (running() || !AC) { doc.removeEventListener('pointerdown', firstInput, true); doc.removeEventListener('keydown', firstInput, true); } };
    doc.addEventListener('pointerdown', firstInput, true);
    doc.addEventListener('keydown', firstInput, true);
    return { play, loop, unlock, tryAuto, setMuted, isMuted: () => muted };
  })();

  function bindMute() {
    const button = $('asMute');
    if (!button) return;
    const paint = () => {
      button.setAttribute('aria-pressed', Sound.isMuted() ? 'true' : 'false');
      button.setAttribute('aria-label', Sound.isMuted() ? '소리 켜기' : '소리 끄기');
    };
    button.addEventListener('click', () => { Sound.setMuted(!Sound.isMuted()); paint(); Sound.play('tap', 0.5); });
    paint();
  }


  /* ---------- 무대(WebGL): 거울 호수 ----------
     물 위에는 한 세계, 물에 비친 쪽에는 다른 세계를 그린다.
     1) 비칠 세계(하늘, 먼 풍경, 문, 물 위에 선 것들의 그림자)를 작은 버퍼에 바로 선 모습으로 그리고
     2) 화면에는 물 위 세계를 그린 뒤, 물 부분은 셰이더가 그 버퍼를 물결과 함께 뒤집어 읽는다. */
  const WORLD = {
    night: {
      sky: 'sky-night', horizon: 'horizon-night', gate: 'gate-ruin', clear: [0.03, 0.04, 0.13],
      // 이 세계가 물에 비칠 때의 물빛
      tint: [0.72, 0.78, 1.0], deep: [0.012, 0.02, 0.07], deepAmt: 0.4, line: [0.5, 0.66, 1.0],
      grade: [0.55, 0.66, 1.0, 0.72], gradeMul: 0.62
    },
    realm: {
      sky: 'sky-realm', horizon: 'horizon-realm', gate: 'gate-realm', clear: [0.2, 0.52, 0.62],
      tint: [1.0, 0.96, 0.9], deep: [0.42, 0.24, 0.13], deepAmt: 0.22, line: [1.0, 0.88, 0.6],
      grade: [1.0, 0.86, 0.6, 0.3], gradeMul: 1.0
    }
  };
  const otherWorld = name => (name == 'night' ? 'realm' : 'night');

  const STAGE_VERT = [
    'attribute vec2 aPos;',
    'uniform vec4 uRect;uniform vec4 uView;uniform vec2 uTurn;uniform vec4 uUV;uniform float uAngle;',
    'varying vec2 vUV;varying vec2 vQ;varying vec2 vPos;',
    'void main(){',
    ' vec2 p=uRect.xy+aPos*uRect.zw;vPos=p;',
    ' p.y=uTurn.x+(p.y-uTurn.x)*uTurn.y;',
    ' gl_Position=vec4((p.x-uView.x)/uView.z*2.-1.,1.-(p.y-uView.y)/uView.w*2.,0.,1.);',
    ' vec2 q=aPos-.5;float c=cos(uAngle),s=sin(uAngle);q=vec2(q.x*c-q.y*s,q.x*s+q.y*c)+.5;',
    ' vQ=q;vUV=mix(uUV.xy,uUV.zw,q);}'
  ].join('\n');
  const SPRITE_FRAG = [
    'precision mediump float;',
    'uniform sampler2D uTex;uniform vec4 uMul;uniform vec4 uGrade;',
    'varying vec2 vUV;varying vec2 vQ;',
    'void main(){',
    ' vec2 inb=step(vec2(0.),vQ)*step(vQ,vec2(1.));',
    ' vec4 c=texture2D(uTex,vUV)*inb.x*inb.y;',
    ' float l=dot(c.rgb,vec3(.3,.59,.11));',
    ' c.rgb=mix(c.rgb,uGrade.rgb*l,uGrade.a);',
    ' gl_FragColor=c*uMul;}'
  ].join('\n');
  const WATER_FRAG = [
    '#ifdef GL_FRAGMENT_PRECISION_HIGH',
    'precision highp float;',
    '#else',
    'precision mediump float;',
    '#endif',
    'uniform sampler2D uTex;uniform vec2 uSize;uniform float uWaterY;uniform float uSpan;uniform float uTime;uniform float uBand;',
    'uniform vec3 uTint;uniform vec3 uDeep;uniform float uDeepAmt;uniform vec3 uLine;uniform vec4 uRip[4];',
    'varying vec2 vPos;',
    'float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}',
    'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);',
    ' return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}',
    'void main(){',
    ' float d=vPos.y-uWaterY;float dn=clamp(d/uSpan,0.,2.);',
    // 멀수록(물가에 가까울수록) 잔물결이 촘촘하게 눌려 보인다.
    ' float persp=1./(.07+dn);',
    ' vec2 w=vec2((vPos.x-uSize.x*.5)/uSpan*persp*.8,persp*1.2);',
    ' float n1=noise(w*vec2(2.6,6.)+vec2(uTime*.22,uTime*.55));',
    ' float n2=noise(w*vec2(6.5,14.)+vec2(-uTime*.31,uTime*.9)+7.3);',
    ' float wave=(n1-.5)*1.25+(n2-.5)*.75;',
    ' vec2 off=vec2(wave*.7,wave)*(1.5+dn*uSpan*.07);',
    ' float ring=0.;',
    ' for(int i=0;i<4;i++){vec4 r=uRip[i];',
    '  vec2 dp=(vPos-r.xy)*vec2(1.,2.7);float dist=length(dp)+.001;',
    '  float band=dist-r.z*uSpan*.5;',
    '  float env=exp(-band*band/(uSpan*uSpan*.0016))*r.w*exp(-r.z*1.25);',
    '  float s=sin(band*.17);off+=dp/dist*s*env*13.;ring+=s*env;}',
    ' float my=max(d+off.y,.5);',
    ' vec2 uv=vec2(clamp((vPos.x+off.x)/uSize.x,.001,.999),clamp(my/uBand,.002,.998));',
    ' vec3 col=texture2D(uTex,uv).rgb*uTint;',
    ' col=mix(col,uDeep,clamp(uDeepAmt*(.2+.8*smoothstep(0.,1.1,dn)),0.,1.));',
    ' float g=noise(vec2(vPos.x*.55,d*2.6)+vec2(uTime*.7,uTime*1.9));',
    ' float sparkle=pow(max(g*n1*2.6-.95,0.),2.)*(1.-smoothstep(0.,.5,dn));',
    ' col+=uLine*(exp(-d/2.2)*.55+exp(-d/26.)*.1+sparkle*.7+max(ring,0.)*.22);',
    ' gl_FragColor=vec4(col,1.);}'
  ].join('\n');

  const ART = name => ASSET + name + '.webp';

  function createStage(cfg) {
    const canvas = $('asStage');
    const coarse = window.matchMedia('(pointer:coarse)').matches;
    let gl = null, sprite = null, water = null, quadBuffer = null, fbo = null, fboTex = null, fboW = 0, fboH = 0;
    let W = 1, H = 1, quality = 1, slow = 0, raf = 0, lastTime = 0, time = 0, pending = 3, dead = false;
    let turn = cfg.turn || 0, turnAnim = null;
    const handles = new Map(), states = new Map(), ripples = [];
    const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
    let textHandle = null, nextAmbient = 2;

    /* 그림 */
    function upload(h) {
      if (!gl || !h.img) return;
      let source = h.img;
      const max = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 2048);
      if (source.width > max || source.height > max) {
        const k = max / Math.max(source.width, source.height), c = doc.createElement('canvas');
        c.width = Math.max(1, Math.round(source.width * k)); c.height = Math.max(1, Math.round(source.height * k));
        c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
        source = c;
      }
      if (!h.tex) h.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, h.tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (gl.isV2) { gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }
      else gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      h.ready = true;
    }
    // 캐릭터 그림은 여백이 제각각이라, 실제로 그려진 부분의 경계와 대표 색을 재서 발을 물 위에 맞춘다.
    function measure(h) {
      try {
        const k = 96 / Math.max(h.w, h.h), c = doc.createElement('canvas');
        c.width = Math.max(1, Math.round(h.w * k)); c.height = Math.max(1, Math.round(h.h * k));
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(h.img, 0, 0, c.width, c.height);
        const px = g.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, x1 = 0, y0 = c.height, y1 = 0, r = 0, gg = 0, b = 0, n = 0;
        for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
          const i = (y * c.width + x) * 4, a = px[i + 3];
          if (a < 40) continue;
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
          const hi = Math.max(px[i], px[i + 1], px[i + 2]), lo = Math.min(px[i], px[i + 1], px[i + 2]), sat = (hi - lo) / 255 + 0.02;
          r += px[i] * sat; gg += px[i + 1] * sat; b += px[i + 2] * sat; n += sat;
        }
        if (x1 > x0 && y1 > y0) h.box = [x0 / c.width, y0 / c.height, (x1 + 1) / c.width, (y1 + 1) / c.height];
        if (n > 0) {
          const m = Math.max(r, gg, b) || 1;
          h.tint = [0.35 + 0.65 * r / m, 0.35 + 0.65 * gg / m, 0.35 + 0.65 * b / m];
        }
      } catch (_) { /* 재지 못하면 그림 전체를 쓴다 */ }
    }
    function load(url, wantMeasure) {
      let h = handles.get(url);
      if (h) return h;
      h = { url, img: null, tex: null, ready: false, failed: false, w: 1, h: 1, box: [0, 0, 1, 1], tint: [1, 0.9, 0.7] };
      handles.set(url, h);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        h.img = img; h.w = img.naturalWidth || 1; h.h = img.naturalHeight || 1;
        if (wantMeasure) measure(h);
        upload(h); dirty();
      };
      img.onerror = () => { h.failed = true; dirty(); };
      img.src = url;
      return h;
    }
    const art = name => load(ART(name), false);

    /* 준비 */
    function compile(type, src) { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; }
    function program(frag, names) {
      const vs = compile(gl.VERTEX_SHADER, STAGE_VERT), fs = compile(gl.FRAGMENT_SHADER, frag);
      if (!vs || !fs) return null;
      const p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs); gl.bindAttribLocation(p, 0, 'aPos'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return null;
      const u = {};
      names.forEach(n => { u[n] = gl.getUniformLocation(p, n); });
      return { p, u };
    }
    function build() {
      const options = { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, powerPreference: 'default' };
      gl = null;
      try { gl = canvas.getContext('webgl2', options); if (gl) gl.isV2 = true; } catch (_) { gl = null; }
      if (!gl) { try { gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options); } catch (_) { gl = null; } }
      if (!gl) return false;
      sprite = program(SPRITE_FRAG, ['uRect', 'uView', 'uTurn', 'uUV', 'uAngle', 'uTex', 'uMul', 'uGrade']);
      water = program(WATER_FRAG, ['uRect', 'uView', 'uTurn', 'uUV', 'uAngle', 'uTex', 'uSize', 'uWaterY', 'uSpan', 'uTime', 'uBand', 'uTint', 'uDeep', 'uDeepAmt', 'uLine', 'uRip[0]']);
      if (!sprite || !water) { gl = null; return false; }
      quadBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      fbo = gl.createFramebuffer(); fboTex = gl.createTexture(); fboW = fboH = 0;
      handles.forEach(h => { h.tex = null; h.ready = false; upload(h); });
      if (textHandle) { textHandle.tex = null; }
      return true;
    }
    function resize() {
      const cw = canvas.clientWidth || 1, ch = canvas.clientHeight || 1;
      const dpr = Math.min(window.devicePixelRatio || 1, cw * ch > 2600000 ? 1 : 1.5) * quality;
      const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
      W = cw; H = ch;
      if (canvas.width != pw || canvas.height != ph) { canvas.width = pw; canvas.height = ph; }
      const fw = Math.max(2, Math.round(pw * 0.5)), fh = Math.max(2, Math.round(ph * 0.5));
      if (fw != fboW || fh != fboH) {
        fboW = fw; fboH = fh;
        gl.bindTexture(gl.TEXTURE_2D, fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
    }

    /* 그리기 */
    let view = [0, 0, 1, 1], turnU = [0, 1];
    const NONE = [1, 1, 1, 0];
    // o: { a 불투명도, mul [r,g,b], add 더하기 합성, uv, angle, grade }
    function quad(h, x, y, w, hh, o) {
      if (!h || !h.ready) return;
      const u = sprite.u, a = o && o.a != null ? o.a : 1, m = o && o.mul || NONE;
      if (a <= 0.003) return;
      gl.blendFunc(gl.ONE, o && o.add ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
      gl.bindTexture(gl.TEXTURE_2D, h.tex);
      gl.uniform4f(u.uRect, x, y, w, hh);
      const uv = o && o.uv;
      gl.uniform4f(u.uUV, uv ? uv[0] : 0, uv ? uv[1] : 0, uv ? uv[2] : 1, uv ? uv[3] : 1);
      gl.uniform1f(u.uAngle, o && o.angle || 0);
      gl.uniform4f(u.uMul, m[0] * a, m[1] * a, m[2] * a, a);
      const g = o && o.grade || NONE;
      gl.uniform4f(u.uGrade, g[0], g[1], g[2], g[3]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    function useSprite() {
      gl.useProgram(sprite.p);
      gl.uniform1i(sprite.u.uTex, 0);
      gl.uniform4f(sprite.u.uView, view[0], view[1], view[2], view[3]);
      gl.uniform2f(sprite.u.uTurn, turnU[0], turnU[1]);
    }
    // 한 세계의 하늘, 먼 풍경, 문. 바닥은 모두 물가(waterY)에 닿는다.
    function drawWorld(name, S, mirror) {
      const w = WORLD[name], sky = art(w.sky), hor = art(w.horizon), gate = art(w.gate);
      if (sky.ready) {
        const need = Math.max(S.waterBase, H - S.waterBase, H * 0.6);
        const s = Math.max(W / sky.w, need / sky.h) * 1.05, sw = sky.w * s, sh = sky.h * s;
        // 물에 비칠 때는 지평선 안개를 덜 보이게 내려, 별과 구름이 물가 가까이에 비치게 한다.
        quad(sky, (W - sw) / 2 + pointer.x * -5, S.waterY - sh * (mirror ? 0.8 : 0.955), sw, sh);
      }
      if (hor.ready) {
        const hh = Math.max(70, Math.min(S.waterBase * 0.4, S.gateW * 0.34)), s = hh / hor.h, hw = hor.w * s;
        const y = S.waterY - hh + 1, cx = W / 2 + pointer.x * -10;
        quad(hor, cx - hw / 2, y, hw, hh);
        // 넓은 화면은 좌우를 뒤집어 이어 붙인다(이음매가 같은 그림이라 티가 나지 않는다).
        for (let i = 1; cx - hw / 2 - (i - 1) * hw > 0 && i < 4; i++) {
          const flip = i % 2 ? [1, 0, 0, 1] : null;
          quad(hor, cx - hw / 2 - i * hw + i, y, hw, hh, { uv: flip });
          quad(hor, cx + hw / 2 + (i - 1) * hw - i, y, hw, hh, { uv: flip });
        }
      }
      if (gate.ready) {
        const gw = S.gateW, gh = gw * gate.h / gate.w;
        quad(gate, W / 2 - gw / 2 + pointer.x * -16, S.waterY - gh * 0.985, gw, gh);
      }
    }
    // 물 위에 선 것(캐릭터, 봉오리)의 화면 자리
    function place(item) {
      const h = item.handle, b = h.box, vw = (b[2] - b[0]) * h.w, vh = (b[3] - b[1]) * h.h;
      const st = states.get(item.key), sel = st ? st.sel : 0;
      const s = Math.min(item.boxH / vh, item.boxW / vw) * (item.kind == 'hero' ? 0.93 + 0.07 * sel : 1);
      const w = h.w * s, hh = h.h * s;
      return { x: item.cx - (b[0] + b[2]) / 2 * w, y: item.feetY - b[3] * hh, w, h: hh, vw: vw * s, vh: vh * s, sel, a: st ? st.a : 1 };
    }

    const particles = [];
    function seedParticles() {
      const count = coarse ? 22 : 44;
      for (let i = 0; i < count; i++) {
        const mote = i % 2 == 0;
        particles.push({ mote, kind: mote ? 3 : i % 3, x: Math.random(), y: Math.random(), z: 0.45 + Math.random() * 0.55,
          vx: mote ? (Math.random() - 0.5) * 0.008 : 0.012 + Math.random() * 0.03, vy: mote ? -0.004 - Math.random() * 0.01 : 0.02 + Math.random() * 0.035,
          rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 1.6, phase: Math.random() * 6.28 });
      }
    }
    function drawParticles(worldName, dt) {
      const atlas = art('petals');
      if (!atlas.ready) return;
      const realm = worldName == 'realm', unit = Math.max(0.7, Math.min(2.6, H / 900));
      for (const p of particles) {
        if (!realm && !p.mote) continue;
        p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        if (p.x > 1.08) p.x = -0.08; if (p.x < -0.08) p.x = 1.08;
        if (p.y > 1.08) p.y = -0.08; if (p.y < -0.08) p.y = 1.08;
        const cx = p.kind % 2, cy = p.kind > 1 ? 1 : 0, uv = [cx * 0.5, cy * 0.5, cx * 0.5 + 0.5, cy * 0.5 + 0.5];
        const sway = Math.sin(time * 0.8 + p.phase) * 14 * p.z;
        const x = p.x * W + sway + pointer.x * -30 * p.z, y = p.y * H;
        if (p.mote) {
          const size = (26 + 46 * p.z) * unit, tw = 0.35 + 0.3 * Math.sin(time * 1.3 + p.phase);
          quad(atlas, x - size / 2, y - size / 2, size, size, { uv, add: true, a: tw * (realm ? 0.8 : 0.55), mul: realm ? [1, 0.92, 0.75] : [0.5, 0.75, 1.3] });
        } else {
          const size = (22 + 34 * p.z) * unit;
          quad(atlas, x - size / 2, y - size / 2, size, size, { uv, angle: p.rot, a: 0.55 + 0.45 * p.z });
        }
      }
    }
    function drawFore(worldName) {
      if (worldName == 'realm') {
        const l = art('fore-left'), r = art('fore-right');
        if (l.ready) {
          let hh = Math.max(170, H * 0.5), w = hh * l.w / l.h;
          if (w > W * 0.46) { w = W * 0.46; hh = w * l.h / l.w; }
          quad(l, -w * 0.1 + pointer.x * -34, -hh * 0.08 + pointer.y * -10, w, hh);
        }
        if (r.ready && W > H * 0.9) {
          let hh = H * 0.94, w = hh * r.w / r.h;
          if (w > W * 0.2) { w = W * 0.2; hh = w * r.h / r.w; }
          quad(r, W - w * 0.7 + pointer.x * -40, H - hh * 0.99 + pointer.y * -10, w, hh);
        }
      } else {
        const n = art('fore-night');
        if (n.ready) {
          let hh = Math.max(180, H * 0.52), w = hh * n.w / n.h;
          if (w > W * 0.62) { w = W * 0.62; hh = w * n.h / n.w; }
          quad(n, -w * 0.06 + pointer.x * -34, H - hh * 0.97 + pointer.y * -8, w, hh);
          const w2 = w * 0.62, h2 = hh * 0.62;
          quad(n, W - w2 * 0.9 + pointer.x * -44, H - h2 * 0.9 + pointer.y * -8, w2, h2, { uv: [1, 0, 0, 1], a: 0.9 });
        }
      }
    }

    function render(dt) {
      const S = cfg.scene(W, H);
      if (!S) return;
      const turned = turn >= 0.5, above = turned ? otherWorld(cfg.above) : cfg.above, below = otherWorld(above);
      const sy = Math.max(0.004, Math.abs(Math.cos(turn * Math.PI)));
      const items = (turned == !!cfg.itemsWhenTurned ? S.items || [] : []).filter(it => it.handle && it.handle.ready);
      items.sort((p, q) => p.feetY - q.feetY);
      for (const it of items) {
        let st = states.get(it.key);
        if (!st) { st = { sel: it.sel ? 1 : 0, a: reduced() ? 1 : 0 }; states.set(it.key, st); }
        const k = reduced() ? 1 : Math.min(1, dt * 7);
        st.sel += ((it.sel ? 1 : 0) - st.sel) * k; st.a += (1 - st.a) * (reduced() ? 1 : Math.min(1, dt * 3));
        it.at = place(it);
      }

      // 1) 비칠 세계를 버퍼에 그린다. 버퍼는 물가 바로 위 화면 한 장 높이를 담는다.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, fboW, fboH);
      const wb = WORLD[below];
      gl.clearColor(wb.clear[0], wb.clear[1], wb.clear[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      view = [0, S.waterY - H, W, H]; turnU = [0, 1];
      useSprite();
      drawWorld(below, S, true);
      // 물 위에 선 것은 발밑에서 뒤집혀 비친다: 발이 물가에서 내려온 만큼의 두 배를 올려 그리면 된다.
      for (const it of items) {
        const p = it.at, lift = 2 * (it.feetY - S.waterY);
        quad(it.handle, p.x, p.y - lift, p.w, p.h, { a: p.a * wb.gradeMul, grade: wb.grade });
      }
      if (S.text && textHandle && textHandle.ready) {
        const r = S.text;
        quad(textHandle, r.x, r.y, r.w, r.h, { a: r.a == null ? 1 : r.a });
      }

      // 2) 화면
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(1, 0.9, 0.7, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      view = [0, 0, W, H]; turnU = [S.waterY, sy];
      useSprite();
      drawWorld(above, S, false);

      const span = Math.max(160, H - S.waterBase);
      gl.useProgram(water.p);
      gl.blendFunc(gl.ONE, gl.ZERO);
      gl.bindTexture(gl.TEXTURE_2D, fboTex);
      const u = water.u;
      gl.uniform1i(u.uTex, 0);
      gl.uniform4f(u.uView, 0, 0, W, H); gl.uniform2f(u.uTurn, S.waterY, sy);
      // 뒤집히는 동안에도 물이 화면 아래까지 닿게 넉넉히 그린다.
      gl.uniform4f(u.uRect, 0, S.waterY, W, Math.min(Math.max(H - S.waterY, 0) / sy + 2, H * 8));
      gl.uniform4f(u.uUV, 0, 0, 1, 1); gl.uniform1f(u.uAngle, 0);
      gl.uniform2f(u.uSize, W, H); gl.uniform1f(u.uWaterY, S.waterY); gl.uniform1f(u.uSpan, span);
      gl.uniform1f(u.uTime, time); gl.uniform1f(u.uBand, H);
      gl.uniform3f(u.uTint, wb.tint[0], wb.tint[1], wb.tint[2]);
      gl.uniform3f(u.uDeep, wb.deep[0], wb.deep[1], wb.deep[2]);
      gl.uniform1f(u.uDeepAmt, wb.deepAmt);
      gl.uniform3f(u.uLine, wb.line[0], wb.line[1], wb.line[2]);
      const rip = new Float32Array(16);
      for (let i = ripples.length - 1; i >= 0; i--) if (time - ripples[i].t > 3.4) ripples.splice(i, 1);
      ripples.slice(-4).forEach((r, i) => { rip[i * 4] = r.x(); rip[i * 4 + 1] = r.y(); rip[i * 4 + 2] = time - r.t; rip[i * 4 + 3] = r.s; });
      gl.uniform4fv(u['uRip[0]'], rip);
      if (H - S.waterY > -2) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      useSprite();
      const sigil = art('sigil'), atlas = art('petals'), MOTE = [0.5, 0.5, 1, 1];
      for (const it of items) {
        const p = it.at;
        if (it.sigil) {
          const sw = Math.max(64, Math.min(p.vw * 1.1, it.boxW * 1.05)) * (1 + 0.1 * p.sel), sh = sw * 0.2, pulse = 0.85 + 0.15 * Math.sin(time * 2.2);
          quad(sigil, it.cx - sw / 2, it.feetY - sh * 0.62, sw, sh, { add: true, angle: time * 0.22 * (it.spin || 1), mul: it.handle.tint, a: p.a * (0.3 + 0.7 * p.sel * pulse) });
        }
      }
      for (const it of items) {
        const p = it.at;
        if (p.sel > 0.02 && atlas.ready) {
          const gw = p.vw * 2.1, gh = p.vh * 1.35;
          quad(atlas, it.cx - gw / 2, it.feetY - gh * 0.9, gw, gh, { uv: MOTE, add: true, mul: it.handle.tint, a: 0.34 * p.sel * p.a });
        }
        const dim = it.kind == 'hero' ? 0.74 + 0.26 * p.sel : 1;
        quad(it.handle, p.x, p.y, p.w, p.h, { a: p.a, mul: [dim, dim, dim], grade: it.kind == 'hero' ? [0.8, 0.86, 1, 0.22 * (1 - p.sel)] : null });
      }
      drawParticles(above, reduced() ? 0 : dt);
      drawFore(above);
      // 고른 캐릭터 머리 위의 표식은 꽃가지에 가리지 않게 맨 위에 그린다.
      const marked = items.find(it => it.sel && it.kind == 'hero'), marker = art('marker');
      if (marked && marker.ready) {
        const p = marked.at, mh = Math.max(34, Math.min(74 * Math.max(1, H / 900), p.vh * 0.2)), mw = mh * marker.w / marker.h;
        quad(marker, marked.cx - mw / 2, marked.feetY - p.vh - mh * 1.02 + Math.sin(time * 2) * 4, mw, mh, { a: p.sel * p.a });
      }
    }

    function frame(now) {
      raf = 0;
      if (!gl || dead || doc.hidden) return;
      const gap = coarse ? 30 : 0;
      if (lastTime && now - lastTime < gap) { raf = requestAnimationFrame(frame); return; }
      const dt = lastTime ? Math.min(0.08, (now - lastTime) / 1000) : 0.016;
      lastTime = now;
      if (!reduced()) {
        time += dt;
        pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 3); pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 3);
        // 가끔 호수에 잔 파문이 인다.
        if (time > nextAmbient && ripples.length < 3) {
          nextAmbient = time + 2.5 + Math.random() * 3;
          const rx = Math.random() * W, ry = Math.random();
          ripples.push({ x: () => rx, y: () => lastWater + (H - lastWater) * (0.15 + ry * 0.7), t: time, s: 0.3 });
        }
      }
      if (turnAnim) {
        const q = Math.min(1, (now - turnAnim.start) / turnAnim.ms), e = q < 0.5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
        turn = turnAnim.from + (turnAnim.to - turnAnim.from) * e;
        if (q >= 1) { const done = turnAnim.done; turnAnim = null; if (done) done(); }
      }
      resize();
      const t0 = performance.now();
      render(dt);
      // 느린 기기에서는 해상도를 낮춰 움직임을 지킨다.
      if (performance.now() - t0 > 22) { if (++slow > 24 && quality > 0.6) { quality *= 0.8; slow = 0; } } else if (slow > 0) slow--;
      if (pending > 0) pending--;
      if (!reduced() || pending > 0 || turnAnim) raf = requestAnimationFrame(frame);
    }
    let lastWater = 0;
    function dirty() { pending = 3; if (!raf && gl && !dead) raf = requestAnimationFrame(frame); }

    const api = {
      ok: false, load, art, dirty,
      water(y) { lastWater = y; },
      ripple(xf, yf, strength) { if (reduced()) return; ripples.push({ x: xf, y: yf, t: time, s: strength || 1 }); if (ripples.length > 6) ripples.shift(); },
      forget(keys) { states.forEach((_, k) => { if (!keys.has(k)) states.delete(k); }); },
      // 물가를 축으로 세계를 뒤집는다(0 = 그대로, 1 = 반대 세계가 위).
      turnTo(value, ms, done) {
        if (!gl || reduced() || !ms) { turn = value; turnAnim = null; dirty(); if (done) done(); return; }
        turnAnim = { from: turn, to: value, start: performance.now(), ms, done }; dirty();
      },
      // 물에 비칠 글자(로그인 이름). 2D 캔버스에 쓴 글자를 그대로 올린다.
      setText(source) {
        if (!gl) return;
        if (!textHandle) textHandle = { tex: null, ready: false, w: 1, h: 1 };
        if (!textHandle.tex) textHandle.tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, textHandle.tex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        textHandle.ready = true; textHandle.source = source;
        dirty();
      }
    };

    function fail() { body.classList.add('as-nogl'); api.ok = false; }
    if (!build()) { fail(); return api; }
    api.ok = true;
    body.classList.add('as-gl');
    seedParticles();
    ['sky-night', 'sky-realm', 'horizon-night', 'horizon-realm', 'gate-ruin', 'gate-realm', 'petals'].forEach(art);
    canvas.addEventListener('webglcontextlost', ev => { ev.preventDefault(); gl = null; body.classList.remove('as-gl'); fail(); });
    canvas.addEventListener('webglcontextrestored', () => {
      if (!build()) return;
      api.ok = true; body.classList.remove('as-nogl'); body.classList.add('as-gl');
      if (textHandle && textHandle.source) api.setText(textHandle.source);
      lastTime = 0; dirty();
    });
    window.addEventListener('resize', dirty);
    window.addEventListener('scroll', dirty, { passive: true, capture: true });
    doc.addEventListener('visibilitychange', () => { if (!doc.hidden) { lastTime = 0; dirty(); } });
    window.addEventListener('pointermove', ev => {
      if (ev.pointerType == 'touch') return;
      pointer.tx = (ev.clientX / Math.max(1, window.innerWidth) - 0.5) * 2; pointer.ty = (ev.clientY / Math.max(1, window.innerHeight) - 0.5) * 2;
    }, { passive: true });
    window.addEventListener('deviceorientation', ev => {
      if (ev.gamma == null || ev.beta == null) return;
      pointer.tx = Math.max(-1, Math.min(1, ev.gamma / 28)); pointer.ty = Math.max(-1, Math.min(1, (ev.beta - 45) / 28));
    }, { passive: true });
    window.addEventListener('pagehide', () => { dead = true; });
    if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', dirty);
    dirty();
    return api;
  }

  /* ---------- API ---------- */
  async function api(method, url, payload) {
    let res;
    try {
      res = await fetch(url, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        body: payload ? JSON.stringify(payload) : undefined
      });
    } catch (_) {
      const err = new Error('서버에 닿지 못했습니다. 다시 시도해 주세요.');
      err.retryable = true;
      throw err;
    }
    let data = null;
    try { data = await res.json(); } catch (_) { /* JSON이 아니면 아래 기본 문구를 쓴다 */ }
    if (!res.ok) {
      const err = new Error(data && typeof data.error == 'string' && data.error ? data.error : '요청을 처리하지 못했습니다.');
      err.status = res.status;
      err.retryable = res.status >= 500;
      throw err;
    }
    return data || {};
  }
  // 같은 요청을 다시 보낼 때(연결 끊김, 서버 오류)는 같은 requestId를 쓴다.
  // 서버가 거절(4xx)했거나 성공하면 그 요청은 끝난 것이므로 다음에는 새 번호를 쓴다.
  const requestIds = new Map();
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }
  async function write(url, payload) {
    const key = url + '|' + JSON.stringify(payload);
    if (!requestIds.has(key)) requestIds.set(key, newRequestId());
    try {
      const out = await api('POST', url, Object.assign({}, payload, { requestId: requestIds.get(key) }));
      requestIds.delete(key);
      return out;
    } catch (err) {
      if (!err.retryable) requestIds.delete(key);
      throw err;
    }
  }

  function setBusy(button, on) {
    if (!button) return;
    button.disabled = !!on;
    button.classList.toggle('is-busy', !!on);
    if (on) button.setAttribute('aria-busy', 'true'); else button.removeAttribute('aria-busy');
  }
  // 화면을 덮고 다음 화면으로 넘어간다.
  function leaveTo(url, light) {
    const veil = $('asVeil');
    veil.classList.toggle('as-veil-dark', !light);
    body.classList.add('is-leaving');
    if (reduced()) { veil.classList.add('as-veil-on'); setTimeout(() => location.assign(url), 200); return; }
    veil.classList.add('as-veil-on');
    setTimeout(() => location.assign(url), light ? 1000 : 800);
  }
  // 뒤로 가기로 돌아왔을 때 가려진 채 남지 않게 한다.
  window.addEventListener('pageshow', ev => { if (ev.persisted) location.reload(); });

  /* ---------- 로그인: 밤의 호수 ---------- */
  function initLogin() {
    const brand = $('asBrand'), wakeButton = $('asWake'), gate = $('asGate'), plate = $('asPlate');
    const nameForm = $('asNameForm'), keyForm = $('asKeyForm');
    const nameInput = $('asName'), codeInput = $('asCode'), otpInput = $('asOtp');
    const nameSubmit = $('asNameSubmit'), keySubmit = $('asKeySubmit');
    const errorBox = $('asError'), hint = $('asHint'), keyHint = $('asKeyHint'), plateLabel = $('asPlateLabel');
    const modeLogin = $('asModeLogin'), modeRegister = $('asModeRegister'), otpToggle = $('asOtpToggle');
    let mode = 'login', pending = false, savedName = '', useOtp = false, typed = 0;

    const GATE_ASPECT = 1400 / 896;
    function layout(W, H) {
      const waterY = Math.round(H * (W < H ? 0.46 : 0.5));
      const gateW = Math.min(W * 0.96, waterY * 0.84 * GATE_ASPECT, 1500);
      return { waterY, gateW, gateH: gateW / GATE_ASPECT };
    }
    // 물에 비칠 이름. 입력란과 같은 자리, 같은 글꼴로 2D 캔버스에 쓰고 무대가 물 아래로 뒤집어 비춘다.
    const ink = doc.createElement('canvas');
    let inkRect = null, inkKey = '';
    function drawInk() {
      if (!stage.ok || plate.hidden) { inkRect = null; return; }
      const r = nameInput.hidden ? plate.getBoundingClientRect() : nameInput.getBoundingClientRect();
      if (!r.width || !r.height) { inkRect = null; return; }
      const text = (nameInput.hidden ? savedName : nameInput.value).trim();
      const size = parseFloat(getComputedStyle(nameInput).fontSize) || 32;
      const key = [text, Math.round(r.width), Math.round(r.height), size].join('|');
      inkRect = { x: r.left, y: r.top, w: r.width, h: r.height, a: text ? 1 : 0 };
      if (key == inkKey) return;
      inkKey = key;
      const k = 2;
      ink.width = Math.max(2, Math.round(r.width * k)); ink.height = Math.max(2, Math.round(r.height * k));
      const g = ink.getContext('2d');
      g.clearRect(0, 0, ink.width, ink.height);
      if (text) {
        g.font = '800 ' + size * k + 'px "AS Serif", serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        try { g.letterSpacing = size * k * 0.06 + 'px'; } catch (_) { /* 지원하지 않으면 기본 자간 */ }
        // 금빛 물 위에서도 또렷하도록 짙은 호박색 테두리 안에 밝은 글자를 쓴다.
        const cx = ink.width / 2, cy = ink.height / 2, mw = ink.width * 0.96;
        g.lineJoin = 'round';
        g.shadowColor = 'rgba(60,22,0,.95)'; g.shadowBlur = size * k * 0.35;
        g.strokeStyle = 'rgba(74,30,4,.95)'; g.lineWidth = size * k * 0.14;
        g.strokeText(text, cx, cy, mw);
        g.shadowBlur = 0;
        const fill = g.createLinearGradient(0, ink.height * 0.2, 0, ink.height * 0.8);
        fill.addColorStop(0, '#ffffff'); fill.addColorStop(0.55, '#fff3c4'); fill.addColorStop(1, '#ffd67e');
        g.fillStyle = fill;
        g.fillText(text, cx, cy, mw);
      }
      stage.setText(ink);
    }
    const stage = createStage({
      above: 'night', turn: 0, itemsWhenTurned: true,
      scene(W, H) {
        const L = layout(W, H);
        stage.water(L.waterY);
        return { waterY: L.waterY, waterBase: L.waterY, gateW: L.gateW, items: [], text: inkRect };
      }
    });
    function applyLayout() {
      const L = layout(window.innerWidth, window.innerHeight);
      body.style.setProperty('--water', L.waterY + 'px');
      body.style.setProperty('--gate-w', L.gateW + 'px');
      body.style.setProperty('--gate-h', L.gateH + 'px');
      inkKey = '';
      drawInk();
      stage.dirty();
    }
    window.addEventListener('resize', applyLayout);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(applyLayout);
    applyLayout();

    function showError(message) {
      errorBox.textContent = message || '';
      if (!message) return;
      Sound.play('deny', 0.7);
      gate.classList.remove('is-denied');
      void gate.offsetWidth;
      gate.classList.add('is-denied');
    }
    function drawName() {
      const count = Array.from(nameInput.value.trim()).length;
      if (count > typed) {
        Sound.play('star', 0.5, 0.96 + Math.random() * 0.08);
        if (inkRect) { const r = inkRect, L = layout(window.innerWidth, window.innerHeight); stage.ripple(() => r.x + r.w / 2, () => 2 * L.waterY - (r.y + r.h / 2), 0.7); }
      }
      typed = count;
      drawInk();
    }
    function showInput(which) {
      nameInput.hidden = which != nameInput; codeInput.hidden = which != codeInput; otpInput.hidden = which != otpInput;
      plateLabel.textContent = which == nameInput ? (mode == 'login' ? '닉네임' : '새 닉네임') : which == codeInput ? '로그인 코드' : 'OTP 코드';
      drawInk();
    }
    function setMode(next) {
      mode = next;
      modeLogin.setAttribute('aria-pressed', mode == 'login' ? 'true' : 'false');
      modeRegister.setAttribute('aria-pressed', mode == 'register' ? 'true' : 'false');
      hint.textContent = mode == 'login' ? '' : '한글, 영문, 숫자로 10자까지. 이 이름이 첫 캐릭터가 됩니다.';
      hint.hidden = mode == 'login';
      nameSubmit.querySelector('.as-btn-label').textContent = mode == 'login' ? '로그인' : '등록';
      nameInput.maxLength = mode == 'login' ? 20 : 10;
      nameInput.autocomplete = mode == 'login' ? 'username' : 'off';
      nameInput.setAttribute('aria-label', mode == 'login' ? '닉네임' : '새 닉네임');
      if (nameInput.value.length > nameInput.maxLength) nameInput.value = nameInput.value.slice(0, nameInput.maxLength);
      gate.setAttribute('aria-label', mode == 'login' ? '로그인' : '계정 등록');
      keyForm.hidden = true; nameForm.hidden = false;
      errorBox.textContent = '';
      showInput(nameInput);
      drawName();
    }
    function showKeyStep() {
      keyHint.textContent = useOtp ? '인증 앱에 보이는 숫자 6자리를 입력하세요.' : '처음 보는 기기입니다. 로그인 코드를 입력하세요.';
      otpToggle.textContent = useOtp ? '로그인 코드로 로그인' : 'OTP 코드로 로그인';
      nameForm.hidden = true; keyForm.hidden = false;
      showInput(useOtp ? otpInput : codeInput);
      (useOtp ? otpInput : codeInput).focus();
    }
    function wake(byKeyboard) {
      if (body.getAttribute('data-phase') != 'title') return;
      Sound.unlock();
      Sound.loop('night', 0.4);
      Sound.loop('lake', 0.4);
      Sound.play('whoosh', 0.55);
      const before = brand.getBoundingClientRect();
      body.setAttribute('data-phase', 'name');
      gate.hidden = false; plate.hidden = false;
      const after = brand.getBoundingClientRect();
      if (!reduced() && brand.animate && after.width) {
        brand.animate([
          { transform: 'translate(' + (before.left - after.left) + 'px,' + (before.top - after.top) + 'px) scale(' + before.width / after.width + ')' },
          { transform: 'none' }
        ], { duration: 900, easing: 'cubic-bezier(.3,0,.1,1)' });
      }
      applyLayout();
      // 터치 기기에서는 자판이 장면을 가리지 않게 눌렀을 때만 연다.
      if (byKeyboard || window.matchMedia('(hover:hover) and (pointer:fine)').matches) nameInput.focus({ preventScroll: true });
    }
    function enter() {
      Sound.play('whoosh', 0.6);
      // 회전 중 장면이 납작해지는 구간은 페이드로 덮고 다음 장면에서 이어 밝힌다.
      stage.turnTo(1, 1500);
      leaveTo('/characters', true);
    }

    wakeButton.addEventListener('click', ev => wake(ev.detail === 0));
    doc.addEventListener('pointerdown', ev => { if (!(ev.target.closest && ev.target.closest('.as-tools'))) wake(false); });
    doc.addEventListener('keydown', ev => {
      if (body.getAttribute('data-phase') != 'title' || ev.key == 'Tab' || ev.key == 'Shift' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.target.closest && ev.target.closest('.as-tools')) return;
      ev.preventDefault();
      wake(true);
    });

    modeLogin.addEventListener('click', () => { if (pending || mode == 'login' && !nameForm.hidden) return; Sound.play('tap', 0.5); setMode('login'); nameInput.focus(); });
    modeRegister.addEventListener('click', () => { if (pending || mode == 'register') return; Sound.play('tap', 0.5); setMode('register'); nameInput.focus(); });
    nameInput.addEventListener('input', drawName);
    $('asBack').addEventListener('click', () => { if (pending) return; setMode('login'); nameInput.focus(); });
    otpToggle.addEventListener('click', () => { if (pending) return; errorBox.textContent = ''; useOtp = !useOtp; Sound.play('tap', 0.5); showKeyStep(); });

    nameForm.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (pending) return;
      const name = nameInput.value.trim();
      if (!name) { showError('닉네임을 입력하세요.'); nameInput.focus(); return; }
      pending = true; setBusy(nameSubmit, true); errorBox.textContent = '';
      try {
        const out = await api('POST', mode == 'login' ? '/api/login' : '/api/register', { name });
        if (out.ok) { enter(); return; }
        if (out.needCode) {
          savedName = name; useOtp = false;
          otpToggle.hidden = !out.canOtp;
          codeInput.value = ''; otpInput.value = '';
          Sound.play('whoosh', 0.5);
          showKeyStep();
        } else showError('로그인하지 못했습니다.');
      } catch (err) { showError(err.message); }
      pending = false; setBusy(nameSubmit, false);
    });
    keyForm.addEventListener('submit', async ev => {
      ev.preventDefault();
      if (pending) return;
      const input = useOtp ? otpInput : codeInput, value = input.value.trim();
      if (!value) { showError(useOtp ? 'OTP 코드를 입력하세요.' : '로그인 코드를 입력하세요.'); input.focus(); return; }
      pending = true; setBusy(keySubmit, true); errorBox.textContent = '';
      try {
        const out = await api('POST', '/api/login', useOtp ? { name: savedName, otp: value } : { name: savedName, code: value });
        if (out.ok) { enter(); return; }
        showError('로그인하지 못했습니다.');
      } catch (err) { showError(err.message); input.select(); }
      pending = false; setBusy(keySubmit, false);
    });
  }

  /* ---------- 캐릭터 선택: 물 건너 세계 ---------- */
  function initCharacters() {
    const roster = $('asRoster'), statusBox = $('asStatus');
    const startButton = $('asStart'), renameButton = $('asRename'), transferButton = $('asTransfer'), linksButton = $('asLinks');
    const NAME_RULE = /^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{1,10}$/;
    let data = null, selectedId = null, starting = false, lastClick = { id: null, at: 0 }, known = null, toastTimer = 0, tiles = [];

    const sameId = (a, b) => String(a) == String(b);
    const characters = () => (data && Array.isArray(data.characters) ? data.characters : []);
    const selected = () => characters().find(c => sameId(c.id, selectedId)) || null;
    const classText = c => [c.type, c.characterName].filter(Boolean).join(' ');

    function toast(message, bad) {
      const box = $('asToast');
      box.textContent = message;
      box.classList.toggle('is-bad', !!bad);
      box.classList.add('is-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => box.classList.remove('is-on'), 3400);
    }

    // 장면: DOM이 정한 자리(각 칸의 그림 상자)를 읽어 그 자리에 캐릭터를 세운다.
    // 그래서 배치와 스크롤은 CSS가 맡고, WebGL은 같은 자리에 그림과 물그림자를 그린다.
    const GATE_ASPECT = 1400 / 937;
    const stage = createStage({
      above: 'night', turn: 1, itemsWhenTurned: true,
      scene(W, H) {
        let feet = Infinity, figH = 0;
        const items = [];
        tiles.forEach((t, i) => {
          const r = t.fig.getBoundingClientRect();
          if (!r.width) return;
          if (r.bottom < feet) { feet = r.bottom; figH = r.height; }
          if (r.right < -200 || r.left > W + 200 || r.top > H + 200) return;
          const hero = t.kind == 'hero';
          items.push({ key: t.key, handle: t.handle, kind: t.kind, cx: r.left + r.width / 2, feetY: r.bottom,
            boxH: hero ? r.height : Math.min(r.height * 0.5, 170), boxW: r.width * (hero ? 0.96 : 0.86),
            sel: hero && sameId(t.id, selectedId), sigil: t.sigil, spin: i % 2 ? -1 : 1 });
        });
        const scroll = window.scrollY || 0;
        const waterY = feet == Infinity ? Math.round(H * 0.56) : Math.round(feet - Math.max(24, Math.min(96, figH * 0.2)));
        const waterBase = Math.max(120, waterY + scroll);
        stage.water(waterY);
        return { waterY, waterBase, gateW: Math.min(W * 0.96, waterBase * 0.82 * GATE_ASPECT, 1500), items };
      }
    });
    ['sigil', 'marker', 'lotus-bud', 'lotus-sealed', 'fore-left', 'fore-right'].forEach(stage.art);

    /* 창 */
    const modal = $('asModal'), panel = $('asModalPanel'), modalBody = $('asModalBody'), camp = $('asCamp');
    let modalState = null;
    function closeModal(force) {
      if (!modalState || (modalState.busy && !force)) return;
      const back = modalState.back;
      modalState = null;
      modal.hidden = true;
      modalBody.textContent = '';
      camp.inert = false; camp.removeAttribute('aria-hidden');
      if (back && doc.contains(back)) back.focus();
    }
    function openModal(title, wide, build) {
      if (modalState) closeModal(true);
      const state = modalState = { busy: false, back: doc.activeElement };
      $('asModalTitle').textContent = title;
      panel.classList.toggle('is-wide', !!wide);
      panel.classList.remove('is-links');
      modalBody.textContent = '';
      const errorBox = el('p', 'as-m-error');
      errorBox.setAttribute('role', 'alert');
      const handle = {
        body: modalBody, errorBox,
        error(message) { errorBox.textContent = message || ''; if (message) Sound.play('deny', 0.7); },
        busy(on, button) { state.busy = !!on; setBusy(button, on); },
        isBusy: () => state.busy,
        alive: () => modalState === state,
        close: () => closeModal(true)
      };
      build(handle);
      modal.hidden = false;
      camp.inert = true; camp.setAttribute('aria-hidden', 'true');
      Sound.play('tap', 0.5);
      const first = modalBody.querySelector('[data-autofocus]') || panel;
      first.focus();
      return handle;
    }
    modal.addEventListener('click', ev => { if (ev.target.getAttribute('data-close')) closeModal(); });
    $('asModalClose').addEventListener('click', () => closeModal());
    // 창 안의 단추가 다시 그려지며 초점이 문서로 빠져도 Esc와 Tab이 창을 벗어나지 않게 문서에서 듣는다.
    doc.addEventListener('keydown', ev => {
      if (!modalState) return;
      if (ev.key == 'Escape') { ev.preventDefault(); closeModal(); return; }
      if (ev.key != 'Tab') return;
      const items = Array.from(panel.querySelectorAll('button:not(:disabled),input:not(:disabled),[href]')).filter(n => n.offsetParent !== null);
      if (!items.length) { ev.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!panel.contains(doc.activeElement)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
      else if (ev.shiftKey && (doc.activeElement == first || doc.activeElement == panel)) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && doc.activeElement == last) { ev.preventDefault(); first.focus(); }
    });

    function actions(handle, label, onSubmit) {
      const row = el('div', 'as-m-actions');
      const cancel = el('button', 'as-btn', '취소'); cancel.type = 'button';
      cancel.addEventListener('click', () => closeModal());
      const submit = el('button', 'as-plaque as-plaque-s'); submit.type = 'submit';
      submit.appendChild(el('span', 'as-btn-label', label));
      row.appendChild(cancel); row.appendChild(submit);
      return { row, submit };
    }
    function bill(rows) {
      const list = el('dl', 'as-bill');
      rows.forEach(r => { list.appendChild(el('dt', '', r[0])); list.appendChild(el('dd', r[2] || '', r[1])); });
      return list;
    }
    // 하나만 고르는 그림 단추 묶음
    function picks(legend, items, tall, onPick) {
      const set = el('fieldset', 'as-m-set');
      set.appendChild(el('legend', 'as-m-legend', legend));
      const grid = el('div', 'as-picks');
      set.appendChild(grid);
      let current = null;
      if (!items.length) grid.appendChild(el('p', 'as-pick-none', '고를 수 있는 항목이 없습니다.'));
      items.forEach(item => {
        const button = el('button', 'as-pick' + (tall ? ' is-tall' : ''));
        button.type = 'button'; button.setAttribute('aria-pressed', 'false');
        const src = safeUrl(item.imageUrl);
        if (src) { const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.addEventListener('error', () => img.remove()); img.src = src; button.appendChild(img); }
        button.appendChild(el('span', '', item.name));
        button.addEventListener('click', () => {
          if (current) current.setAttribute('aria-pressed', 'false');
          current = button; button.setAttribute('aria-pressed', 'true');
          Sound.play('tap', 0.5);
          onPick(item);
        });
        grid.appendChild(button);
      });
      return set;
    }
    function nameField(handle, value) {
      const wrap = el('div');
      const label = el('label', 'as-m-label', '닉네임'); label.htmlFor = 'asModalName';
      const input = el('input', 'as-m-input');
      input.id = 'asModalName'; input.type = 'text'; input.maxLength = 10; input.value = value || '';
      input.autocomplete = 'off'; input.spellcheck = false; input.setAttribute('autocapitalize', 'off'); input.setAttribute('data-autofocus', '1');
      input.setAttribute('enterkeyhint', 'done');
      wrap.appendChild(label); wrap.appendChild(input);
      wrap.appendChild(el('p', 'as-m-note', '한글, 영문, 숫자, 띄어쓰기로 1~10자. 이미 있는 이름은 쓸 수 없습니다.'));
      return { wrap, input };
    }
    async function submitWrite(handle, button, url, payload) {
      if (handle.isBusy()) return false;
      handle.busy(true, button); handle.error('');
      try { await write(url, payload); }
      catch (err) { handle.busy(false, button); if (handle.alive()) handle.error(err.message); return false; }
      handle.busy(false, button);
      return true;
    }

    function openCreate() {
      if (!data) return;
      openModal('새 캐릭터', true, handle => {
        const form = el('form'); form.noValidate = true; form.style.display = 'contents';
        let cardId = null;
        form.appendChild(el('p', 'as-m-lead', '닉네임과 시작 카드를 고르세요.'));
        const field = nameField(handle, '');
        form.appendChild(field.wrap);
        form.appendChild(picks('시작 카드', Array.isArray(data.starters) ? data.starters : [], true, item => { cardId = item.id; }));
        form.appendChild(handle.errorBox);
        const act = actions(handle, '캐릭터 만들기');
        form.appendChild(act.row);
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          const name = field.input.value.trim();
          if (!NAME_RULE.test(name)) { handle.error('닉네임은 한글, 영문, 숫자, 띄어쓰기로 1~10자입니다.'); field.input.focus(); return; }
          if (cardId == null) { handle.error('시작 카드를 고르세요.'); return; }
          if (!await submitWrite(handle, act.submit, '/api/characters/create', { name, cardId })) return;
          handle.close();
          toast(name + ' 캐릭터를 만들었습니다.');
          await loadList({ selectName: name });
        });
        handle.body.appendChild(form);
      });
    }
    function openStarter(character) {
      openModal('시작 카드 선택', true, handle => {
        const form = el('form'); form.noValidate = true; form.style.display = 'contents';
        let cardId = null;
        const lead = el('p', 'as-m-lead');
        lead.textContent = character.name + ' 캐릭터의 시작 카드를 고르세요.';
        form.appendChild(lead);
        form.appendChild(picks('시작 카드', Array.isArray(data.starters) ? data.starters : [], true, item => { cardId = item.id; }));
        form.appendChild(handle.errorBox);
        const act = actions(handle, '이 카드로 시작');
        form.appendChild(act.row);
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          if (cardId == null) { handle.error('시작 카드를 고르세요.'); return; }
          if (!await submitWrite(handle, act.submit, '/api/characters/starter', { id: character.id, cardId })) return;
          handle.close();
          toast('시작 카드를 정했습니다.');
          await loadList({});
        });
        handle.body.appendChild(form);
      });
    }
    function openRename() {
      const character = selected();
      if (!character) return;
      const tickets = Math.max(0, Number(character.renameTickets) || 0), cost = Number(data.renameCost) || 0;
      const point = Number(data.wallet && data.wallet.point) || 0, short = !tickets && point < cost;
      openModal('이름 변경', false, handle => {
        const form = el('form'); form.noValidate = true; form.style.display = 'contents';
        const field = nameField(handle, character.name);
        form.appendChild(field.wrap);
        form.appendChild(bill(tickets
          ? [['쓰는 것', '닉네임 변경권 1장', 'is-spend'], ['보유 변경권', fmt(tickets) + '장 → ' + fmt(tickets - 1) + '장']]
          : [['쓰는 것', fmt(cost) + ' 포인트', 'is-spend'], ['보유 포인트', short ? fmt(point) + ' (부족)' : fmt(point) + ' → ' + fmt(point - cost), short ? 'is-short' : '']]));
        if (!tickets) form.appendChild(el('p', 'as-m-note', '닉네임 변경권이 없어 포인트로 변경권을 사서 바로 씁니다.'));
        form.appendChild(handle.errorBox);
        const act = actions(handle, tickets ? '변경권 쓰고 변경' : fmt(cost) + ' 포인트 쓰고 변경');
        act.submit.disabled = short;
        form.appendChild(act.row);
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          const name = field.input.value.trim();
          if (!NAME_RULE.test(name)) { handle.error('닉네임은 한글, 영문, 숫자, 띄어쓰기로 1~10자입니다.'); field.input.focus(); return; }
          if (name == character.name) { handle.error('지금 이름과 같습니다.'); field.input.focus(); return; }
          // 화면에 보여 준 지불 수단을 그대로 보낸다. 그사이 변경권이 없어졌다면 서버가 거절하고, 말없이 포인트를 쓰지 않는다.
          if (!await submitWrite(handle, act.submit, '/api/characters/rename', { id: character.id, name, payment: tickets ? 'ticket' : 'point' })) return;
          handle.close();
          Sound.play('coin', 0.7);
          toast('이름을 ' + name + '(으)로 바꿨습니다.');
          await loadList({});
        });
        handle.body.appendChild(form);
      });
    }
    function openExpand() {
      if (!data) return;
      const cost = Number(data.slotCost) || 0, point = Number(data.wallet && data.wallet.point) || 0, capacity = Number(data.capacity) || 0;
      const short = point < cost;
      openModal('캐릭터 자리 확장', false, handle => {
        const form = el('form'); form.noValidate = true; form.style.display = 'contents';
        form.appendChild(el('p', 'as-m-lead', '포인트를 써서 캐릭터 자리를 한 칸 늘립니다. 되돌릴 수 없습니다.'));
        form.appendChild(bill([
          ['쓰는 것', fmt(cost) + ' 포인트', 'is-spend'],
          ['보유 포인트', short ? fmt(point) + ' (부족)' : fmt(point) + ' → ' + fmt(point - cost), short ? 'is-short' : ''],
          ['캐릭터 자리', fmt(capacity) + '칸 → ' + fmt(capacity + 1) + '칸']
        ]));
        form.appendChild(handle.errorBox);
        const act = actions(handle, fmt(cost) + ' 포인트 쓰고 확장');
        act.submit.disabled = short;
        if (!short) act.submit.setAttribute('data-autofocus', '1');
        form.appendChild(act.row);
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          if (!await submitWrite(handle, act.submit, '/api/characters/expand', {})) return;
          handle.close();
          Sound.play('coin', 0.7);
          toast('캐릭터 자리가 한 칸 늘었습니다.');
          await loadList({});
        });
        handle.body.appendChild(form);
      });
    }
    function openTransfer() {
      const source = selected();
      if (!source) return;
      const others = characters().filter(c => !sameId(c.id, source.id));
      const KIND = { card: '카드', equipment: '장비' };
      openModal('물품 이전', true, handle => {
        const form = el('form'); form.noValidate = true; form.style.display = 'contents';
        let kind = 'card', item = null, target = others.length == 1 ? others[0] : null, list = null;
        let tickets = Object.assign({ card: 0, equipment: 0 }, data.transferItems || {});
        const lead = el('p', 'as-m-lead');
        lead.textContent = source.name + '의 장착하지 않은 카드나 초월 장비 하나를 다른 캐릭터로 옮깁니다. 한 번 옮길 때마다 해당 전송기 1개를 쓰고, 거래권은 쓰지 않습니다.';
        const tabs = el('div', 'as-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '옮길 종류');
        const tabButtons = {};
        Object.keys(KIND).forEach(k => {
          const tab = el('button', 'as-tab'); tab.type = 'button';
          tab.addEventListener('click', () => { if (handle.isBusy() || kind == k) return; kind = k; item = null; Sound.play('tap', 0.5); paint(); });
          tabButtons[k] = tab; tabs.appendChild(tab);
        });
        const itemsBox = el('div'), route = el('p', 'as-route'), billBox = el('div');
        const targetSet = picks('받을 캐릭터', others.map(c => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })), false, picked => { target = others.find(c => sameId(c.id, picked.id)); paintSummary(); });
        if (target) { const only = targetSet.querySelector('.as-pick'); if (only) only.setAttribute('aria-pressed', 'true'); }
        const act = actions(handle, '이전하기');

        function paintSummary() {
          const have = Math.max(0, Number(tickets[kind]) || 0);
          route.textContent = '';
          route.appendChild(el('span', '', source.name));
          route.appendChild(el('i', '', '→'));
          route.appendChild(el('span', '', item ? item.name : KIND[kind] + '를 고르세요'));
          route.appendChild(el('i', '', '→'));
          route.appendChild(el('span', '', target ? target.name : '받을 캐릭터를 고르세요'));
          billBox.textContent = '';
          billBox.appendChild(bill([
            ['쓰는 것', KIND[kind] + ' 전송기 1개', 'is-spend'],
            ['보유 전송기', have ? fmt(have) + '개 → ' + fmt(have - 1) + '개' : '0개 (부족)', have ? '' : 'is-short']
          ]));
          act.submit.disabled = !item || !target || !have || handle.isBusy();
        }
        function paint() {
          Object.keys(KIND).forEach(k => {
            const tab = tabButtons[k];
            tab.setAttribute('aria-pressed', kind == k ? 'true' : 'false');
            tab.textContent = KIND[k];
            tab.appendChild(el('small', '', '전송기 ' + fmt(tickets[k]) + '개'));
          });
          itemsBox.textContent = '';
          if (!list) itemsBox.appendChild(el('p', 'as-pick-none', '옮길 수 있는 물품을 찾는 중입니다.'));
          else {
            const rows = Array.isArray(list[kind]) ? list[kind] : [];
            const set = picks('옮길 ' + KIND[kind], rows, false, picked => { item = picked; paintSummary(); });
            if (!rows.length) set.querySelector('.as-pick-none').textContent = '옮길 수 있는 ' + KIND[kind] + '가 없습니다. 장착 중인 것은 먼저 해제해야 합니다.';
            itemsBox.appendChild(set);
          }
          paintSummary();
        }
        async function loadItems() {
          list = null; item = null; paint();
          try {
            const out = await api('GET', '/api/characters/transferable?sourceId=' + encodeURIComponent(source.id));
            if (!handle.alive()) return;
            list = { card: out.cards || [], equipment: out.equipment || [] };
            if (out.tickets) tickets = Object.assign({ card: 0, equipment: 0 }, out.tickets);
          } catch (err) {
            if (!handle.alive()) return;
            list = { card: [], equipment: [] };
            handle.error(err.message);
          }
          paint();
        }
        form.addEventListener('submit', async ev => {
          ev.preventDefault();
          if (!item || !target) return;
          const moved = item.name, to = target.name;
          if (!await submitWrite(handle, act.submit, '/api/characters/transfer', { sourceId: source.id, targetId: target.id, kind, index: item.index, itemToken: item.token })) { paintSummary(); return; }
          Sound.play('coin', 0.7);
          toast(moved + ' → ' + to + ' 이전을 마쳤습니다.');
          loadList({});
          if (handle.alive()) await loadItems();
        });
        [lead, tabs, itemsBox, targetSet, route, billBox, handle.errorBox, act.row].forEach(n => form.appendChild(n));
        handle.body.appendChild(form);
        loadItems();
      });
    }

    /* 목록 */
    // 좁은 화면은 좌우로 넘기고, 넓은 화면은 너비에 맞춰 칸 수를 정한다.
    function layoutRoster() {
      const count = Number(roster.getAttribute('data-tiles')) || 0, field = roster.parentNode, width = field.clientWidth;
      if (!count || !width) return;
      const style = getComputedStyle(field), inner = width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      // 넓은 화면은 한 칸을 130px까지 좁혀서라도 한 줄에 세운다(아홉 칸까지).
      const fit = width < 560 ? 2 : width < 820 ? 3 : Math.max(4, Math.min(9, Math.floor(inner / 130)));
      const cols = Math.min(fit, count);
      roster.style.setProperty('--cols', String(cols));
      roster.style.setProperty('--rows', String(Math.ceil(count / cols)));
      if (count <= fit && width >= 560) roster.setAttribute('data-few', '1'); else roster.removeAttribute('data-few');
      fitPlates();
      // 가로 목록의 그림 높이를 남은 공간에 맞춰 모든 이름표를 입장 단추 위에 둔다.
      const slots = Array.from(roster.querySelectorAll('.as-slot'));
      if (getComputedStyle(roster).display == 'flex' && slots.length) {
        const rosterStyle = getComputedStyle(roster);
        const extra = Math.max(...slots.map(slot => slot.getBoundingClientRect().height - slot.querySelector('.as-slot-fig').getBoundingClientRect().height));
        const available = field.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
          - parseFloat(rosterStyle.paddingTop) - parseFloat(rosterStyle.paddingBottom) - extra;
        roster.style.setProperty('--fig', Math.floor(Math.max(48, Math.min(430, available))) + 'px');
      } else roster.style.removeProperty('--fig');
      stage.dirty();
    }
    // 이름표의 각 줄이 제 칸 너비를 넘으면 글자 크기를 줄여 한 줄에 맞춘다(열 글자 이름, 긴 카드 이름).
    function fitPlates() {
      roster.querySelectorAll('.as-slot-plate > span').forEach(line => {
        line.style.fontSize = '';
        const room = line.parentNode.clientWidth - 2, need = line.scrollWidth;
        if (room > 0 && need > room) line.style.fontSize = Math.max(9, parseFloat(getComputedStyle(line).fontSize) * room / need) + 'px';
      });
    }
    window.addEventListener('resize', layoutRoster);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(layoutRoster);
    function paintDock() {
      const c = selected();
      startButton.disabled = !c || starting;
      startButton.querySelector('.as-btn-label').textContent = c && c.needsStarter ? '시작 카드 고르기' : '게임 시작';
      renameButton.disabled = !c || starting;
      transferButton.disabled = !c || starting || characters().length < 2;
      transferButton.title = c && characters().length < 2 ? '캐릭터가 둘 이상일 때 쓸 수 있습니다' : '';
      linksButton.disabled = !data || starting;
    }
    function rippleAt(tile, strength) {
      stage.ripple(() => { const r = tile.fig.getBoundingClientRect(); return r.left + r.width / 2; }, () => tile.fig.getBoundingClientRect().bottom, strength);
    }
    function select(id) {
      if (sameId(id, selectedId)) return;
      selectedId = id;
      roster.querySelectorAll('.as-slot[data-id]').forEach(b => b.setAttribute('aria-pressed', sameId(b.getAttribute('data-id'), id) ? 'true' : 'false'));
      paintDock();
      const tile = tiles.find(t => sameId(t.id, id));
      if (tile) {
        rippleAt(tile, 1);
        if (getComputedStyle(roster).display == 'flex') tile.fig.parentNode.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduced() ? 'instant' : 'smooth' });
      }
      stage.dirty();
    }
    async function start() {
      const c = selected();
      if (!c || starting || modalState) return;
      if (c.needsStarter) { openStarter(c); return; }
      starting = true; paintDock(); setBusy(startButton, true);
      try {
        await write('/api/characters/select', { id: c.id });
      } catch (err) {
        starting = false; setBusy(startButton, false); paintDock();
        Sound.play('deny', 0.7);
        toast(err.message, true);
        return;
      }
      const tile = tiles.find(t => sameId(t.id, c.id));
      if (tile) rippleAt(tile, 1.6);
      Sound.play('plunge', 0.7);
      leaveTo('/', false);
    }
    // 칸 하나: 그림 상자(무대가 이 자리에 캐릭터를 세운다)와 이름표
    function slot(kind, artName, imageUrl) {
      const button = el('button', 'as-slot' + (kind ? ' as-slot-' + kind : ''));
      button.type = 'button';
      const fig = el('span', 'as-slot-fig');
      // WebGL을 못 쓰는 기기에서는 이 그림이 그대로 보인다.
      const img = el('img', 'as-slot-img');
      img.alt = ''; img.decoding = 'async'; img.draggable = false;
      img.addEventListener('error', () => img.remove());
      img.src = imageUrl || ASSET + artName + '.webp';
      fig.appendChild(img);
      button.appendChild(fig);
      return { button, fig };
    }
    function paintRoster(fresh) {
      const list = characters(), capacity = Math.max(Number(data.capacity) || 0, list.length);
      roster.textContent = '';
      tiles = [];
      list.forEach(c => {
        const src = c.needsStarter ? '' : safeUrl(c.imageUrl);
        const li = el('li'), made = slot('', 'lotus-bud', src), button = made.button;
        button.setAttribute('data-id', String(c.id));
        button.setAttribute('aria-pressed', sameId(c.id, selectedId) ? 'true' : 'false');
        const plate = el('span', 'as-slot-plate');
        if (c.needsStarter) plate.appendChild(el('span', 'as-slot-flag is-warn', '시작 카드 선택 필요'));
        else if (c.isActive) plate.appendChild(el('span', 'as-slot-flag', '플레이 중'));
        // 이름 한 줄, 카드 한 줄([9성] 각성 빵귤처럼 서버가 준 표기 그대로), 레벨과 전투력 한 줄.
        // 줄마다 한 줄로만 쓰고, 칸보다 길면 fitPlates()가 글자를 줄여 맞춘다.
        const nameRow = el('span', 'as-slot-name');
        nameRow.appendChild(el('span', 'as-slot-nick', c.name));
        plate.appendChild(nameRow);
        if (!c.needsStarter) {
          const label = typeof c.cardLabel == 'string' && c.cardLabel ? c.cardLabel : classText(c);
          const cardName = el('span', 'as-slot-class'), halloween = label.indexOf('할로윈 ');
          if (halloween < 0) cardName.textContent = label;
          else cardName.append(label.slice(0, halloween), el('span', 'card-name-halloween', '할로윈'), label.slice(halloween + 3));
          plate.appendChild(cardName);
        }
        const power = el('span', 'as-slot-power');
        power.appendChild(el('span', 'as-slot-lv', 'Lv.' + fmt(c.level)));
        if (!c.needsStarter) { power.appendChild(doc.createTextNode(' 전투력 ')); power.appendChild(el('b', '', fmt(c.power))); }
        plate.appendChild(power);
        button.appendChild(plate);
        button.addEventListener('click', ev => {
          const now = performance.now();
          // 고른 캐릭터를 연달아 두 번 누르면(더블 클릭, 더블 탭) 바로 시작한다.
          const twice = ev.detail >= 2 || ev.detail !== 0 && sameId(lastClick.id, c.id) && now - lastClick.at < 450;
          lastClick = { id: c.id, at: now };
          select(c.id);
          if (twice) { lastClick.at = 0; start(); }
        });
        li.appendChild(button); roster.appendChild(li);
        const tile = { key: 'c:' + c.id, id: c.id, kind: src ? 'hero' : 'bud', fig: made.fig, sigil: true, handle: src ? stage.load(src, true) : stage.art('lotus-bud') };
        tiles.push(tile);
        if (fresh && known && !known.has(String(c.id))) rippleAt(tile, 1.4);
      });
      for (let i = list.length; i < capacity; i++) {
        const li = el('li'), made = slot('empty', 'lotus-bud', '');
        const plate = el('span', 'as-slot-plate');
        plate.appendChild(el('span', 'as-slot-name', '빈 자리'));
        plate.appendChild(el('span', 'as-slot-class', '새 캐릭터 만들기'));
        made.button.appendChild(plate);
        made.button.addEventListener('click', openCreate);
        li.appendChild(made.button); roster.appendChild(li);
        tiles.push({ key: 'e:' + i, id: null, kind: 'bud', fig: made.fig, sigil: false, handle: stage.art('lotus-bud') });
      }
      const li = el('li'), more = slot('more', 'lotus-sealed', '');
      const plate = el('span', 'as-slot-plate');
      plate.appendChild(el('span', 'as-slot-name', '자리 늘리기'));
      plate.appendChild(el('span', 'as-slot-class', fmt(data.slotCost) + ' 포인트'));
      more.button.appendChild(plate);
      more.button.addEventListener('click', openExpand);
      li.appendChild(more.button); roster.appendChild(li);
      tiles.push({ key: 'more', id: null, kind: 'bud', fig: more.fig, sigil: false, handle: stage.art('lotus-sealed') });

      roster.setAttribute('data-tiles', String(capacity + 1));
      layoutRoster();
      stage.forget(new Set(tiles.map(t => t.key)));
      known = new Set(list.map(c => String(c.id)));
    }
    // 재화는 꼬리표가 아니라 한 줄 장부로 보여 준다: 그림과 숫자가 가는 금선 위에 나란히 놓인다.
    function paintWallet() {
      const box = $('asWallet'), wallet = data.wallet || {}, cap = data.goldCap, capButton = $('asCap');
      box.textContent = '';
      [['골드', wallet.gold], ['가넷', wallet.garnet], ['포인트', wallet.point]].forEach(row => {
        const cell = el('span', 'as-cell');
        const icon = el('img');
        icon.alt = '';
        icon.addEventListener('error', () => { icon.remove(); cell.classList.add('no-icon'); });
        icon.src = '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent(row[0] + '.png');
        cell.appendChild(icon);
        cell.appendChild(el('span', 'as-cell-name', row[0]));
        cell.appendChild(el('b', '', fmt(row[1])));
        box.appendChild(cell);
      });
      const has = cap && Number.isFinite(Number(cap.limit)) && Number(cap.limit) > 0;
      capButton.hidden = !has;
      if (!has) return;
      capButton.textContent = '';
      capButton.appendChild(el('span', 'as-cap-name', '오늘 사냥 골드'));
      capButton.appendChild(el('b', '', fmt(cap.used) + ' / ' + fmt(cap.limit)));
      const bar = el('i', 'as-cap-bar');
      bar.style.setProperty('--fill', Math.max(0, Math.min(1, Number(cap.used) / Number(cap.limit))).toFixed(4));
      capButton.appendChild(bar);
      capButton.setAttribute('aria-label', '오늘 사냥 골드 ' + fmt(cap.used) + ' / ' + fmt(cap.limit) + ', 한도 설명 보기');
    }
    function openCap() {
      const cap = data && data.goldCap;
      if (!cap) return;
      openModal('사냥 골드 한도', false, handle => {
        handle.body.appendChild(el('p', 'as-m-lead', '계정의 모든 캐릭터가 하루 사냥 골드 한도를 함께 씁니다.'));
        handle.body.appendChild(bill([
          ['오늘 얻은 기본 골드', fmt(cap.used)],
          ['오늘 한도', fmt(cap.limit)],
          ['남은 한도', fmt(cap.remaining), Number(cap.remaining) > 0 ? 'is-spend' : 'is-short']
        ]));
        const notes = el('ul', 'as-m-list');
        ['보너스가 붙기 전의 기본 사냥 골드로 셉니다. 보너스 골드는 한도를 줄이지 않습니다.',
          '매일 자정(한국 시간)에 0으로 돌아갑니다.',
          '한도는 계정에서 레벨이 가장 높은 캐릭터(지금 Lv.' + fmt(cap.level) + ')를 기준으로 정해집니다.'
        ].forEach(text => notes.appendChild(el('li', '', text)));
        handle.body.appendChild(notes);
        const row = el('div', 'as-m-actions'), ok = el('button', 'as-btn', '확인');
        ok.type = 'button'; ok.setAttribute('data-autofocus', '1');
        ok.addEventListener('click', () => closeModal());
        row.appendChild(ok);
        handle.body.appendChild(row);
      });
    }
    // 현재 플레이 중인 캐릭터의 슬롯을 편성한다.
    function openLinks() {
      if (!data) return;
      openModal('슬롯 연결', true, handle => {
        panel.classList.add('is-links');
        const board = el('div', 'as-links'), main = el('div', 'as-link-main');
        const formation = el('div', 'as-link-formation'), heading = el('div', 'as-link-heading');
        const count = el('span', 'as-link-count'), nav = el('div', 'as-link-nav');
        count.setAttribute('role', 'status'); nav.setAttribute('role', 'group'); nav.setAttribute('aria-label', '슬롯 선택');
        heading.append(el('h3', '', '연결 슬롯'), count);
        const slotsBox = el('div', 'as-link-slots');
        slotsBox.setAttribute('role', 'group'); slotsBox.setAttribute('aria-label', '연결된 캐릭터');
        formation.append(heading, nav, slotsBox);
        const editor = el('div', 'as-link-editor'), editorHead = el('div', 'as-link-heading');
        const target = el('h3'), clear = el('button', 'as-btn as-link-clear', '연결 해제');
        clear.type = 'button'; clear.addEventListener('click', () => commit(null));
        editorHead.append(target, clear);
        const candidates = el('div', 'as-link-candidates');
        candidates.setAttribute('role', 'group'); candidates.setAttribute('aria-label', '연결할 부캐 선택');
        const command = el('div', 'as-link-command'), detail = el('div', 'as-link-preview'), bonus = el('dl', 'as-link-bonus');
        const connect = el('button', 'as-btn as-link-connect'); connect.type = 'button';
        connect.addEventListener('click', () => commit(chosen()));
        command.append(bonus, detail, connect);
        editor.append(editorHead, candidates, command);
        board.append(main, formation, editor);
        handle.body.append(board, handle.errorBox);
        let view = null, index = 0, chosenId = null, scrollTimer = 0;
        const current = () => view && view.slots[index];
        const chosen = () => current()?.candidates.find(c => sameId(c.id, chosenId)) || null;

        function portrait(src, className) {
          const box = el('span', className), url = safeUrl(src);
          if (url) {
            const img = el('img'); img.alt = ''; img.draggable = false;
            img.addEventListener('error', () => img.remove()); img.src = url; box.appendChild(img);
          }
          return box;
        }
        function cardLabel(text) {
          const label = el('span', 'as-link-card-title');
          const parts = (text || '').match(/^(\[[^\]]+\])\s*(?:(각성|전직|광폭)\s+)?(.*)$/);
          if (!parts) { label.appendChild(el('strong', 'as-slot-class', text || '카드 없음')); return label; }
          label.append(el('span', 'as-link-grade', parts[1] + (parts[2] ? ' ' + parts[2] : '')), doc.createTextNode(' '));
          const name = el('strong', 'as-slot-class');
          parts[3].split(' ').filter(Boolean).forEach((word, i) => {
            if (i) name.appendChild(doc.createTextNode(' '));
            name.appendChild(el('span', word === '할로윈' ? 'card-name-halloween' : '', word));
          });
          label.appendChild(name); return label;
        }
        function effects(rows, inactive) {
          const list = el('dl', 'as-link-effects');
          (rows || []).forEach(effect => {
            const row = el('div', (effect.negative ? 'is-negative ' : '') + (effect.grade ? 'is-grade ' : '') + (!effect.active || inactive ? 'is-inactive' : ''));
            row.append(el('dt', '', effect.name), el('dd', '', effect.value));
            if (effect.condition) row.appendChild(el('small', '', effect.condition));
            list.appendChild(row);
          });
          return list;
        }
        function paintFormation() {
          const character = view.character;
          const identity = el('div', 'as-link-main-name');
          identity.append(el('span', 'as-link-eyebrow', '플레이 중'), cardLabel(character.cardLabel), el('small', '', 'Lv.' + fmt(character.level)));
          main.replaceChildren(portrait(character.imageUrl, 'as-link-main-art'), identity, effects(character.effects));
          count.textContent = view.slots.filter(slot => slot.linkedId).length + ' / 5 연결';
          nav.textContent = '';
          view.slots.forEach(slot => {
            const button = el('button', 'as-link-seal' + (slot.linkedId ? ' is-linked' : '') + (slot.error ? ' is-invalid' : ''), String(slot.index + 1));
            button.type = 'button'; button.dataset.index = slot.index;
            button.setAttribute('aria-label', '슬롯 ' + (slot.index + 1) + ', ' + (slot.linkedId ? slot.name : '빈 슬롯'));
            button.addEventListener('click', () => selectSlot(slot.index));
            nav.appendChild(button);
          });
          const sum = Math.max(0, Number(view.levelSum) || 0), percent = (sum / 10).toLocaleString('ko-KR', { maximumFractionDigits: 1 });
          bonus.textContent = '';
          [['체력', '+' + fmt(sum)], ['골드 경험치 드롭', '+' + percent + '%']].forEach(([label, value]) => {
            const stat = el('div'); stat.append(el('dt', '', label), el('dd', '', value)); bonus.appendChild(stat);
          });
          paintSlots();
        }
        function paintSlots() {
          const left = slotsBox.scrollLeft, option = chosen();
          slotsBox.textContent = '';
          view.slots.forEach(slot => {
            const preview = slot.index === index && option && !option.error && !sameId(option.id, slot.linkedId);
            const shown = preview ? { name: option.cardLabel, imageUrl: option.imageUrl, level: option.level, effects: option.effects } : slot;
            const button = el('button', 'as-link-slot' + (slot.error ? ' is-invalid' : '') + (preview ? ' is-preview' : '') + (!shown.imageUrl ? ' is-empty' : ''));
            button.type = 'button'; button.dataset.index = slot.index;
            button.setAttribute('aria-pressed', slot.index === index ? 'true' : 'false');
            button.setAttribute('aria-label', '슬롯 ' + (slot.index + 1) + ', ' + shown.name + (preview ? ', 연결 전 미리보기' : ''));
            const number = el('span', 'as-link-number'); number.append(el('b', '', String(slot.index + 1)), el('span', '', preview ? '연결 전' : slot.error ? '연결 확인' : slot.linkedId ? '연결됨' : '빈 슬롯'));
            const art = portrait(shown.imageUrl, 'as-link-slot-art');
            if (!shown.imageUrl) art.appendChild(el('span', 'as-link-empty', '+'));
            const inscription = el('span', 'as-link-inscription');
            inscription.appendChild(cardLabel(shown.imageUrl ? shown.name : '부캐 선택'));
            if (shown.imageUrl) inscription.append(el('small', 'as-link-level', 'Lv.' + fmt(shown.level)), effects(shown.effects, !!slot.error && !preview));
            button.append(number, art, inscription);
            button.addEventListener('click', () => selectSlot(slot.index));
            slotsBox.appendChild(button);
          });
          nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', Number(button.dataset.index) === index ? 'true' : 'false'));
          slotsBox.scrollLeft = left;
        }
        function paintCandidates() {
          const slot = current(), left = candidates.scrollLeft;
          target.replaceChildren(el('span', 'as-link-target', '슬롯 ' + (index + 1)), el('span', '', '연결할 부캐'));
          clear.disabled = !slot.linkedId;
          candidates.textContent = '';
          slot.candidates.forEach(option => {
            const assigned = view.slots.find(s => sameId(s.linkedId, option.id));
            const button = el('button', 'as-link-option' + (option.error ? ' is-unavailable' : ''));
            button.type = 'button'; button.dataset.id = option.id;
            const state = assigned ? '슬롯 ' + (assigned.index + 1) + ' 연결됨' : option.error ? '연결 불가' : '연결 가능';
            button.setAttribute('aria-label', option.cardLabel + ', ' + option.name + ', ' + state);
            const words = el('span', 'as-link-option-name');
            words.append(cardLabel(option.cardLabel), el('small', 'as-link-owner', option.name + ' Lv.' + fmt(option.level)));
            button.append(el('span', 'as-link-state' + (assigned ? ' is-linked' : ''), state), portrait(option.imageUrl, 'as-link-option-art'), words);
            button.addEventListener('click', () => { if (handle.isBusy()) return; chosenId = option.id; paintSlots(); paintCommand(); });
            candidates.appendChild(button);
          });
          if (!slot.candidates.length) candidates.appendChild(el('p', 'as-pick-none', '아직 부캐가 없습니다.'));
          candidates.scrollLeft = left;
          paintCommand();
        }
        function paintCommand() {
          const slot = current(), option = chosen(), on = option && sameId(option.id, slot.linkedId);
          candidates.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', sameId(button.dataset.id, chosenId) ? 'true' : 'false'));
          detail.textContent = option?.error || (!option && slot.error) || '';
          command.classList.toggle('has-error', !!detail.textContent);
          connect.textContent = on && !option.error ? '연결됨' : '슬롯 ' + (index + 1) + '에 ' + (slot.linkedId ? '교체' : '연결');
          connect.disabled = !option || !!option.error || on;
        }
        function selectSlot(next, fromScroll) {
          if (!view || handle.isBusy()) return;
          index = next; chosenId = current().linkedId;
          paintSlots(); paintCandidates();
          if (!fromScroll) {
            nav.querySelector('[data-index="' + index + '"]').focus({ preventScroll: true });
            slotsBox.querySelector('[data-index="' + index + '"]').scrollIntoView({ block: 'nearest', inline: 'center' });
          }
          candidates.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
        nav.addEventListener('keydown', ev => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(ev.key)) return;
          ev.preventDefault();
          const from = Number(ev.target.closest('button')?.dataset.index ?? index);
          selectSlot(ev.key === 'Home' ? 0 : ev.key === 'End' ? 4 : Math.max(0, Math.min(4, from + (ev.key === 'ArrowLeft' ? -1 : 1))));
        });
        slotsBox.addEventListener('scroll', () => {
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
            if (!handle.alive() || handle.isBusy() || !matchMedia('(max-width:1000px)').matches) return;
            const center = slotsBox.getBoundingClientRect().left + slotsBox.clientWidth / 2;
            const nearest = Array.from(slotsBox.children).sort((a, b) => Math.abs(a.getBoundingClientRect().left + a.clientWidth / 2 - center) - Math.abs(b.getBoundingClientRect().left + b.clientWidth / 2 - center))[0];
            if (nearest && Number(nearest.dataset.index) !== index) selectSlot(Number(nearest.dataset.index), true);
          }, 120);
        }, { passive: true });
        async function commit(option) {
          if (!view || handle.isBusy() || option?.error) return;
          const slot = current();
          if (sameId(slot.linkedId, option?.id) || !option && !slot.linkedId) return;
          handle.busy(true); handle.error(''); board.setAttribute('aria-busy', 'true');
          board.querySelectorAll('button').forEach(button => { button.disabled = true; });
          connect.textContent = '적용 중';
          try {
            await write('/api/characters/link', { characterId: view.characterId, index, linkedId: option ? option.id : null });
            await load(); await loadList({});
          } catch (err) {
            if (!handle.alive()) return;
            handle.error(err.message);
            if (err.status === 409) await load().catch(() => {});
          } finally {
            handle.busy(false); board.removeAttribute('aria-busy');
            if (handle.alive()) selectSlot(index);
          }
        }
        async function load() {
          const fresh = await api('GET', '/api/characters/links');
          if (!handle.alive()) return;
          if (!view) {
            const requested = Number(new URLSearchParams(location.search).get('slot'));
            index = Number.isInteger(requested) && requested >= 1 && requested <= 5 ? requested - 1 : Math.max(0, fresh.slots.findIndex(slot => !slot.linkedId));
          }
          view = fresh; chosenId = current().linkedId;
          paintFormation(); paintCandidates();
          slotsBox.querySelector('[data-index="' + index + '"]').scrollIntoView({ block: 'nearest', inline: 'center' });
          candidates.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
        }
        target.textContent = '불러오는 중'; connect.disabled = clear.disabled = true;
        load().catch(err => { if (handle.alive()) handle.error(err.message); });
      });
    }
    function paint(fresh) {
      const list = characters();
      $('asAccount').textContent = data.accountName || '';
      $('asCount').textContent = list.length + ' / ' + Math.max(Number(data.capacity) || 0, list.length);
      paintWallet(); paintRoster(fresh); paintDock();
    }
    async function loadList(opts) {
      let next;
      try { next = await api('GET', '/api/characters'); }
      catch (err) {
        if (err.status == 401 || err.status == 403) { location.replace('/'); return; }
        if (data) { toast(err.message, true); return; }
        statusBox.hidden = false; statusBox.textContent = err.message;
        const retry = el('button', 'as-btn', '다시 불러오기'); retry.type = 'button';
        retry.addEventListener('click', () => { statusBox.textContent = '캐릭터를 불러오는 중입니다.'; loadList({}); });
        statusBox.appendChild(doc.createElement('br')); statusBox.appendChild(retry);
        body.setAttribute('data-phase', 'error');
        revealStage();
        return;
      }
      const first = !data;
      data = next;
      const list = characters();
      const byName = opts && opts.selectName ? list.find(c => c.name == opts.selectName) : null;
      if (byName) selectedId = byName.id;
      if (!selected()) {
        const active = list.find(c => sameId(c.id, data.activeId)) || list.find(c => c.isActive) || list[0];
        selectedId = active ? active.id : null;
      }
      statusBox.hidden = true;
      body.setAttribute('data-phase', 'ready');
      paint(!first);
      if (first) {
        // 도착 화면은 회전을 반복하지 않고 완성된 장면을 서서히 드러낸다.
        revealStage();
        const chosen = roster.querySelector('.as-slot[aria-pressed="true"]');
        if (chosen) { chosen.focus({ preventScroll: true }); if (chosen.scrollIntoView) chosen.scrollIntoView({ block: 'nearest', inline: 'center' }); }
        if (location.hash == '#links') openLinks();
      }
    }

    function revealStage() {
      requestAnimationFrame(() => requestAnimationFrame(() => $('asVeil').classList.remove('as-veil-on')));
    }

    startButton.addEventListener('click', start);
    renameButton.addEventListener('click', openRename);
    transferButton.addEventListener('click', openTransfer);
    linksButton.addEventListener('click', openLinks);
    $('asCap').addEventListener('click', openCap);
    $('asLogout').addEventListener('click', async ev => {
      setBusy(ev.currentTarget, true);
      try { await api('POST', '/api/logout', {}); } catch (err) { setBusy($('asLogout'), false); toast(err.message, true); return; }
      location.assign('/');
    });
    roster.addEventListener('keydown', ev => {
      const button = ev.target.closest && ev.target.closest('.as-slot');
      if (!button) return;
      const id = button.getAttribute('data-id');
      if (ev.key == 'Enter' && id != null && sameId(id, selectedId)) { ev.preventDefault(); start(); return; }
      const step = ev.key == 'ArrowRight' || ev.key == 'ArrowDown' ? 1 : ev.key == 'ArrowLeft' || ev.key == 'ArrowUp' ? -1 : 0;
      if (!step) return;
      const all = Array.from(roster.querySelectorAll('.as-slot'));
      const next = all[all.indexOf(button) + step];
      if (!next) return;
      ev.preventDefault();
      next.focus();
      if (next.hasAttribute('data-id')) select(next.getAttribute('data-id'));
    });
    doc.addEventListener('keydown', ev => {
      if (ev.key != 'Enter' || modalState || ev.defaultPrevented) return;
      if (ev.target.closest && ev.target.closest('button,input,a,select,textarea')) return;
      ev.preventDefault();
      start();
    });
    roster.addEventListener('scroll', stage.dirty, { passive: true });

    Sound.loop('lake', 0.5);
    Sound.tryAuto();
    loadList({});
  }

  bindMute();
  if (screen == 'login') initLogin();
  else if (screen == 'characters') initCharacters();
})();
