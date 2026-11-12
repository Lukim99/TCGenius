// 전투 연출 엔진. 정적 이펙트 그림(512×512)을 조각, 입자, 흐름으로 풀어 장면 단위로 재생한다.
// 판정과 수치는 다루지 않는다. 호스트(필드, PVP, 월드보스)가 넘긴 사건을 보이는 것으로 옮길 뿐이다.
// 장면 정의는 combat-fx-scenes.js가 CombatFX.define으로 등록한다.
(function (root) {
    'use strict';

    const TAU = Math.PI * 2;
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const EASE = {
        lin: t => t,
        in: t => t * t,
        in3: t => t * t * t,
        out: t => 1 - (1 - t) * (1 - t),
        out3: t => 1 - (1 - t) ** 3,
        out5: t => 1 - (1 - t) ** 5,
        io: t => t < .5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t),
        back: t => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
        elastic: t => t <= 0 || t >= 1 ? clamp(t) : 2 ** (-10 * t) * Math.sin((t * 10 - .75) * TAU / 3) + 1,
        bounce: t => { const n = 7.5625, d = 2.75; return t < 1 / d ? n * t * t : t < 2 / d ? n * (t -= 1.5 / d) * t + .75 : t < 2.5 / d ? n * (t -= 2.25 / d) * t + .9375 : n * (t -= 2.625 / d) * t + .984375; }
    };
    const SIZE = 512;
    const SHAPE = { glow: 0, ring: 1, streak: 2, arc: 3, flare: 4, wave: 5, lines: 6, hex: 7, rect: 8, shard: 9, sonic: 10, disc: 11 };
    const MATTER = { gather: 0, shatter: 1, stream: 2, rise: 3, implode: 4 };

    const PRECISION = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
    const QUAD_VS = 'attribute vec2 aPos;uniform mat3 uM;varying vec2 vUv;void main(){vec3 p=uM*vec3(aPos,1.);gl_Position=vec4(p.xy,0.,1.);vUv=aPos+.5;}';
    const NOISE = 'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}' +
        'float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}';
    // 그림 한 장을 흐름, 드러내기, 소용돌이, 흩어짐으로 변형해 그린다. 출력은 곱해진 알파다.
    const SPRITE_FS = PRECISION + NOISE + `
uniform sampler2D uTex;uniform vec4 uColor;uniform float uFlash,uTime,uAdd,uSwirl,uChroma,uMode,uDis;
uniform vec4 uFlow,uReveal;uniform vec2 uPivot;uniform vec3 uEdge;varying vec2 vUv;
vec4 tex(vec2 uv){vec2 e=step(vec2(0.),uv)*step(uv,vec2(1.));return texture2D(uTex,uv)*e.x*e.y;}
void main(){
  vec2 uv=vUv;
  if(uSwirl!=0.){vec2 c=uv-uPivot;float r=length(c);float a=uSwirl*(1.-smoothstep(0.,.62,r));float s=sin(a),co=cos(a);uv=uPivot+vec2(c.x*co-c.y*s,c.x*s+c.y*co);}
  if(uFlow.x>0.){
    vec2 q=uv*uFlow.y+uFlow.zw*uTime;
    vec2 d=vec2(noise(q),noise(q+17.3))-.5;d+=(vec2(noise(q*2.3+5.1),noise(q*2.3+9.7))-.5)*.5;
    vec4 b=texture2D(uTex,uv);float energy=smoothstep(.3,.95,max(b.r,max(b.g,b.b)));
    uv+=d*uFlow.x*(.3+.7*energy);
  }
  vec4 c=tex(uv);
  if(uChroma>0.){c.r=tex(uv+vec2(uChroma,0.)).r;c.b=tex(uv-vec2(uChroma,0.)).b;}
  float k;
  if(uMode<.5){k=dot(vUv-.5,vec2(cos(uReveal.z),sin(uReveal.z)))+.5;}
  else if(uMode<1.5){k=length(vUv-uPivot)*1.6;}
  else{vec2 v=vUv-uPivot;k=fract((atan(v.y,v.x)-uReveal.z)/6.2831853);}
  float soft=uReveal.w;k+=(noise(vUv*9.+uTime*.8)-.5)*soft*1.4;
  float m=smoothstep(uReveal.y-soft,uReveal.y,k)*(1.-smoothstep(uReveal.x-soft,uReveal.x,k));
  float lead=smoothstep(uReveal.x-soft*2.,uReveal.x-soft,k)*(1.-smoothstep(uReveal.x-soft,uReveal.x,k));
  float dm=1.,de=0.;
  if(uDis>0.){float n=noise(vUv*7.)*.62+noise(vUv*19.)*.38;float a=uDis*1.25-.12;dm=smoothstep(a,a+.1,n);de=(1.-smoothstep(a+.1,a+.24,n))*dm;}
  c*=m*dm;
  vec3 rgb=c.rgb*uColor.rgb;
  rgb=mix(rgb,vec3(c.a),uFlash);
  rgb+=uEdge*(lead*.8+de*1.5)*c.a;
  gl_FragColor=vec4(rgb,c.a*(1.-uAdd))*uColor.a;
}`;
    // 그림 없이 그리는 빛: 번짐, 고리, 줄기, 호, 섬광, 충격파, 집중선, 육각 방벽, 장막, 파편, 음파, 원반.
    const SHAPE_FS = PRECISION + `
uniform float uMode,uTime,uAdd,uWhite;uniform vec4 uColor,uP;varying vec2 vUv;
float h1(float n){return fract(sin(n*91.345)*43758.5453);}
void main(){
  vec2 q=vUv*2.-1.;float r=length(q),a=0.,core=0.;
  if(uMode<.5){a=pow(max(0.,1.-r),uP.x);core=pow(max(0.,1.-r*2.4),2.);}
  else if(uMode<1.5){float d=abs(r-uP.x);a=(1.-smoothstep(uP.y*.35,uP.y,d))*smoothstep(1.,.94,r);core=1.-smoothstep(0.,uP.y*.4,d);}
  else if(uMode<2.5){float w=pow(max(0.,1.-abs(q.x)),uP.x)*.9+.02,y=abs(q.y);a=(1.-smoothstep(w*.25,w,y))*(1.-smoothstep(.7,1.,abs(q.x)));core=(1.-smoothstep(0.,w*.3,y))*(1.-smoothstep(.45,1.,abs(q.x)));}
  else if(uMode<3.5){float ang=atan(q.y,q.x),k=(ang+uP.y)/(2.*uP.y),inside=step(0.,k)*step(k,1.),taper=sin(clamp(k,0.,1.)*3.14159),th=uP.w*taper+.001;
    float d=abs(r-uP.x+(1.-taper)*uP.w*.6),vis=(1.-smoothstep(uP.z-.1,uP.z,k))*smoothstep(uP.z-.9,uP.z-.15,k);
    a=inside*(1.-smoothstep(th*.4,th,d))*vis;core=inside*(1.-smoothstep(0.,th*.32,d))*vis;}
  else if(uMode<4.5){float f=max(0.,1.-r);a=f*f*clamp(uP.x/(abs(q.x*q.y)+uP.x),0.,1.)+pow(max(0.,1.-r*2.6),3.);core=pow(max(0.,1.-r*4.),2.);}
  else if(uMode<5.5){float d=r-uP.x;a=smoothstep(-uP.y*3.,0.,d)*(1.-smoothstep(0.,uP.y*.5,d));a*=a*smoothstep(1.,.92,r);core=(1.-smoothstep(0.,uP.y*.4,abs(d)))*.7;}
  else if(uMode<6.5){float ang=(atan(q.y,q.x)+3.14159)*uP.y,seg=floor(ang),n=h1(seg+uP.z*17.),f=abs(fract(ang)-.5)*2.;
    float inner=uP.x+n*.3;a=step(.58,n)*(1.-smoothstep(0.,.55*(1.1-n),f))*smoothstep(inner,inner+.35,r)*smoothstep(1.5,1.05,r);core=a*.35;}
  else if(uMode<7.5){vec2 p=q*uP.x,h=vec2(1.,1.7320508),a1=mod(p,h)-h*.5,b1=mod(p-h*.5,h)-h*.5,g=dot(a1,a1)<dot(b1,b1)?a1:b1;
    float hd=max(abs(g.x),dot(abs(g),vec2(.5,.8660254))),edge=smoothstep(.5-uP.y,.5,hd),sweep=1.-smoothstep(0.,.16,abs(fract(q.y*.5-uTime*.55)-.5));
    a=(edge*.85+uP.z+sweep*.3)*smoothstep(1.,.86,r)*(.3+.7*smoothstep(.15,1.,r));core=edge*.35*smoothstep(.5,1.,r);}
  else if(uMode<8.5){a=mix(1.,smoothstep(uP.x,uP.x+.9,r),uP.y);}
  else if(uMode<9.5){a=1.-smoothstep(0.,.1,max(abs(q.x)*1.7+q.y*.85-.72,-q.y-.86));}
  else if(uMode<10.5){float ang=atan(q.y,q.x),m=1.-smoothstep(uP.y*.55,uP.y,abs(ang)),w=pow(sin(r*uP.z-uP.x)*.5+.5,5.);a=m*w*smoothstep(.04,.22,r)*smoothstep(1.,.55,r);core=a*.45;}
  else{a=1.-smoothstep(.55,1.,r);}
  float al=clamp(a,0.,1.)*uColor.a;
  vec3 rgb=mix(uColor.rgb,vec3(1.),clamp(core,0.,1.)*uWhite);
  gl_FragColor=vec4(rgb*al,al*(1.-uAdd));
}`;
    // 그림의 화소를 입자로 옮긴다. 모이고, 터지고, 흘러가고, 떠오르고, 빨려 든다.
    const MATTER_VS = `
attribute vec2 aHome;attribute vec4 aRnd;attribute vec4 aCol;
uniform vec2 uRes,uCenter,uSize,uFrom,uTo;uniform float uRot,uFlip,uT,uMode,uTime,uPx,uGrav,uSpread,uAlpha,uHot;varying vec4 vCol;varying float vAng;
void main(){
  vec2 l=(aHome-.5)*uSize;l.x*=uFlip;float s=sin(uRot),c=cos(uRot);
  vec2 H=uCenter+vec2(l.x*c-l.y*s,l.x*s+l.y*c),P=H;float a=1.,sz=1.,t=uT;
  if(uMode<.5){float tt=clamp((t-aRnd.x*.42)/.58,0.,1.),e=1.-pow(1.-tt,3.),ang=aRnd.y*6.2832;
    vec2 S0=uFrom+vec2(cos(ang),sin(ang))*uSpread*(.15+aRnd.z),d=H-S0,n=vec2(-d.y,d.x);
    P=mix(S0,H,e)+n*sin(e*3.1416)*(aRnd.w-.5)*.55;a=smoothstep(0.,.12,tt)*(1.-smoothstep(.8,1.,tt));sz=mix(1.7,.6,e);}
  else if(uMode<1.5){vec2 d=H-uFrom;vec2 dir=d/(length(d)+.001);float ang=(aRnd.y-.5)*1.4,cs=cos(ang),sn=sin(ang);dir=vec2(dir.x*cs-dir.y*sn,dir.x*sn+dir.y*cs);
    float sp=uSpread*(.25+aRnd.z*1.15),k=1.-exp(-t*3.4);
    P=H+dir*sp*k+vec2(0.,uGrav*t*t)+vec2(sin(t*8.+aRnd.w*40.),cos(t*6.+aRnd.x*40.))*uSpread*.02*t;
    a=1.-smoothstep(.35+aRnd.x*.45,1.,t);sz=(1.35-.8*t)*(.55+aRnd.w*.9);}
  else if(uMode<2.5){float tt=clamp((t-aRnd.x*.5)/.5,0.,1.),e=tt*tt*(3.-2.*tt);
    vec2 d=uTo-H,n=vec2(-d.y,d.x),C=H+d*.5+n*(aRnd.y-.5)*.9+vec2(0.,-length(d)*.18);float u=1.-e;
    P=u*u*H+2.*u*e*C+e*e*uTo;a=smoothstep(0.,.1,tt)*(1.-smoothstep(.85,1.,tt));sz=mix(1.3,.7,e);}
  else if(uMode<3.5){float tt=clamp(t*(.6+aRnd.x*.8),0.,1.);
    P=H+vec2(sin(uTime*2.4+aRnd.y*30.)*uSpread*.08*tt,-uSpread*tt*(.35+aRnd.z));a=smoothstep(0.,.1,tt)*(1.-tt);sz=.6+aRnd.w*.8;}
  else{float tt=clamp((t-aRnd.x*.3)/.7,0.,1.),e=tt*tt,ang=e*(2.5+aRnd.y*2.5),cs=cos(ang),sn=sin(ang);vec2 d=H-uTo;
    P=uTo+vec2(d.x*cs-d.y*sn,d.x*sn+d.y*cs)*(1.-e);a=smoothstep(0.,.15,tt)*(1.-smoothstep(.9,1.,tt));sz=mix(1.2,.5,e);}
  vCol=vec4(mix(aCol.rgb,vec3(1.),uHot*(1.-t)),aCol.a*a*uAlpha);vAng=aRnd.w*6.2832+t*(aRnd.x-.5)*16.;
  gl_Position=vec4(P.x/uRes.x*2.-1.,1.-P.y/uRes.y*2.,0.,1.);gl_PointSize=max(1.,uPx*sz);
}`;
    const MATTER_FS = PRECISION + 'uniform float uShard;varying vec4 vCol;varying float vAng;void main(){vec2 q=gl_PointCoord-.5;float d=length(q)*2.,cs=cos(vAng),sn=sin(vAng);' +
        'vec2 r=vec2(q.x*cs-q.y*sn,q.x*sn+q.y*cs);float sh=1.-smoothstep(.34,.44,abs(r.x)*2.6+abs(r.y));float a=mix(pow(max(0.,1.-d),2.4),sh,uShard);' +
        'vec3 c=vCol.rgb*mix(1.,.72+.6*step(0.,r.x),uShard);gl_FragColor=vec4(c*a*vCol.a,a*vCol.a*uShard);}';

    // ---- 실시간으로 계산하는 재료: 절차 셰이더(면, 리본, 렌즈)와 입자 ----
    // 장면집이 CombatFX.shader(이름, 본문)으로 등록한다. 본문은 vec4 fx(vec2 uv)를 정의하고 곧은(곱하지 않은) 색과 알파를 돌려준다.
    // 노이즈는 한 번 만든 256² 텍스처에서 읽는다(화소마다 sin 해시를 돌리는 것보다 훨씬 싸다).
    const FX_HEAD = PRECISION + `
uniform float uTime,uAdd,uSeed,uFlip;uniform vec4 uColor,uP,uQ;uniform vec3 uColor2;uniform sampler2D uNoise,uScene;varying vec2 vUv;
vec4 ntex(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return texture2D(uNoise,(i+f+.5)/256.);}
float noise(vec2 p){return ntex(p).r;}
float fbm(vec2 p){return ntex(p).r*.5+ntex(p*2.03+17.1).g*.25+ntex(p*4.11+41.7).b*.125+ntex(p*8.27+7.3).a*.0625;}
float fbm2(vec2 p){return ntex(p).r*.62+ntex(p*2.07+17.1).g*.38;}
mat2 rot2(float a){float c=cos(a),s=sin(a);return mat2(c,-s,s,c);}
vec3 heat(float h){return h<.6?mix(uColor2,uColor.rgb,h/.6):mix(uColor.rgb,vec3(1.),(h-.6)*2.5);}
vec4 scene(vec2 uv){if(uFlip<0.)uv.x=1.-uv.x;vec2 e=step(vec2(0.),uv)*step(uv,vec2(1.));return texture2D(uScene,uv)*e.x*e.y;}
`;
    const FX_MAIN = '\nvoid main(){vec4 c=fx(vUv);float al=clamp(c.a,0.,1.)*uColor.a;gl_FragColor=vec4(c.rgb*al,al*(1.-uAdd));}';
    // 렌즈는 전투 화면을 찍은 그림을 다시 그리므로 본문이 곱해진 알파를 그대로 돌려준다.
    const LENS_MAIN = '\nvoid main(){gl_FragColor=fx(vUv)*uColor.a;}';
    const STRIP_VS = 'attribute vec2 aPos,aUv;uniform vec2 uRes;varying vec2 vUv;void main(){gl_Position=vec4(aPos.x/uRes.x*2.-1.,1.-aPos.y/uRes.y*2.,0.,1.);vUv=aUv;}';
    // 입자는 태어날 때 한 번만 버퍼에 쓰고, 그 뒤의 운동(속도, 감쇠, 중력, 흔들림, 크기와 색의 변화)은 정점 셰이더가 나이로 계산한다.
    const PARTICLE_VS = `
attribute vec4 aA,aB,aC,aD,aE,aF;uniform vec2 uRes;uniform float uNow,uLayer;varying vec2 vUv;varying vec4 vCol;varying float vAdd;
void main(){
  float age=uNow-aB.x,t=age/aB.y,layer=floor(aD.y*.5);
  if(aB.y<=0.||age<0.||t>=1.||layer!=uLayer){gl_Position=vec4(2.,2.,0.,1.);return;}
  float idx=floor(aD.x+.5),corner=mod(idx,4.),cell=floor(idx*.25);
  vec2 q=vec2(mod(corner,2.),floor(corner*.5))-.5;
  float drag=aC.w,k=drag>0.?(1.-exp(-drag*age))/drag:age;
  vec2 pos=aA.xy+aA.zw*k+vec2(0.,.5*aC.z*age*age);
  float sd=aA.z*.013+aA.w*.017+aA.x*.031;
  pos+=vec2(sin(age*5.1+sd*37.),cos(age*4.3+sd*51.))*aD.w*age;
  float size=mix(aB.z,aB.w,1.-(1.-t)*(1.-t)),ang=aC.x+aC.y*age;vec2 sc=vec2(size);
  if(aD.z>0.){vec2 vel=aA.zw*exp(-drag*age)+vec2(0.,aC.z*age);ang=atan(vel.y,vel.x);sc.x=size*(1.+aD.z*length(vel)*.01);}
  float s=sin(ang),c=cos(ang);vec2 o=q*sc;pos+=vec2(o.x*c-o.y*s,o.x*s+o.y*c);
  vUv=(vec2(mod(cell,4.),floor(cell*.25))+q+.5)*.25;
  vCol=mix(aE,aF,t);vCol.a*=smoothstep(0.,.06,t)*(1.-smoothstep(.7,1.,t));vAdd=aD.y-layer*2.;
  gl_Position=vec4(pos.x/uRes.x*2.-1.,1.-pos.y/uRes.y*2.,0.,1.);
}`;
    const PARTICLE_FS = PRECISION + 'uniform sampler2D uTex;varying vec2 vUv;varying vec4 vCol;varying float vAdd;void main(){vec4 t=texture2D(uTex,vUv);gl_FragColor=vec4(vCol.rgb*t.rgb*vCol.a,t.a*vCol.a*(1.-vAdd));}';
    const PARTICLE_CAP = 2048, PARTICLE_STRIDE = 72;
    const CELL = { dot: 0, hard: 1, spark: 2, smoke: 3, shard: 4, star: 5, ring: 6, flame: 7, drop: 8, petal: 9, zero: 10, one: 11, star5: 12, coin: 13, card: 14, note: 15 };
    const FIELD_DEFAULTS = { x: 0, y: 0, w: 100, h: 100, rot: 0, alpha: 1, add: 1, p0: 0, p1: 0, p2: 0, p3: 0, q0: 0, q1: 0, q2: 0, q3: 0, seed: 0, z: 1 };
    const TRAIL_DEFAULTS = { head: 0, tail: 0, width: 20, alpha: 1, add: 1, seg: 28, p0: 4, p1: 2, p2: 1.2, p3: 0, q0: 0, q1: 0, q2: 0, q3: 0, jag: 0, taper: .35, seed: 0, z: 3 };
    const POSE_DEFAULTS = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, alpha: 1, flash: 0, z: 0 };
    const LENS_DEFAULTS = { x: 0, y: 0, ang: 0, alpha: 1, p0: 0, p1: 0, p2: 0, p3: 0, q0: 0, q1: 0, seed: 0, z: -40 };
    const shaderBodies = new Map();
    let atlasPainter = null;

    const SPRITE_DEFAULTS = { x: 0, y: 0, size: 100, sx: 1, sy: 1, rot: 0, alpha: 1, flip: 1, add: 0, flash: 0, glow: 0, flow: 0, ff: 3, fvx: 0, fvy: -.6, head: 2, tail: -1, ang: 0, soft: .08, mode: 0, dis: 0, swirl: 0, chroma: 0, z: 0 };
    const SHAPE_DEFAULTS = { x: 0, y: 0, w: 100, h: 100, rot: 0, alpha: 1, add: 1, white: .85, p0: 2, p1: .1, p2: 0, p3: .1, z: 0 };
    const MATTER_DEFAULTS = { x: 0, y: 0, size: 100, rot: 0, flip: 1, t: 0, fx: 0, fy: 0, tx: 0, ty: 0, spread: 120, grav: 0, px: 5, alpha: 1, hot: .5, frac: 1, shard: 0, z: 1 };

    const definitions = new Map();
    const parts = new Map();
    const painters = new Map();
    let fallback = null;

    class Node {
        constructor(kind, props, born, scene) {
            this.kind = kind; this.p = props; this.born = born; this.cur = born; this.tr = []; this.die = null;
            this.scene = scene; this.fn = null; this.seq = 0;
        }
        to(props, duration, ease) {
            const e = typeof ease === 'function' ? ease : EASE[ease || 'out'];
            for (const key in props) this.tr.push({ key, t0: this.cur, d: duration, to: props[key], ease: e, from: undefined });
            this.cur += duration; return this;
        }
        // 직전 to와 동시에 진행한다.
        with(props, duration, ease) {
            const cursor = this.cur, start = this.prev == null ? cursor : this.prev;
            this.cur = start; this.to(props, duration, ease); this.cur = Math.max(cursor, this.cur); return this;
        }
        set(props) { return this.to(props, 0, 'lin'); }
        wait(duration) { this.prev = this.cur; this.cur += duration; return this; }
        seek(time) { this.cur = this.born + time; return this; }
        // 장면 시작부터의 시각으로 옮긴다(seek은 이 노드가 태어난 때부터의 시각).
        at(time) { this.cur = (this.scene && this.scene.start != null ? this.scene.start : this.born) + time; return this; }
        end(extra) { this.die = this.cur + (extra || 0); return this; }
        tick(fn) { this.fn = fn; return this; }
    }
    const baseTo = Node.prototype.to;
    Node.prototype.to = function (props, duration, ease) { this.prev = this.cur; return baseTo.call(this, props, duration, ease); };

    // 입자가 쓰는 4×4 도형판. 흰색으로 그려 두고 입자마다 색을 입힌다.
    function paintAtlas(g, N) {
        const R = N / 2 - 3;
        const cell = (i, draw) => { g.save(); g.beginPath(); g.rect((i % 4) * N, Math.floor(i / 4) * N, N, N); g.clip(); g.translate((i % 4) * N + N / 2, Math.floor(i / 4) * N + N / 2); draw(); g.restore(); };
        const radial = (r, stops) => { const fill = g.createRadialGradient(0, 0, 0, 0, 0, r); stops.forEach(([at, a]) => fill.addColorStop(at, 'rgba(255,255,255,' + a + ')')); return fill; };
        const poly = pts => { g.beginPath(); pts.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x * R, y * R)); g.closePath(); };
        cell(0, () => { g.fillStyle = radial(R, [[0, 1], [.2, .8], [.5, .28], [1, 0]]); g.fillRect(-R, -R, R * 2, R * 2); });
        cell(1, () => { g.fillStyle = radial(R * .8, [[0, 1], [.78, 1], [1, 0]]); g.fillRect(-R, -R, R * 2, R * 2); });
        cell(2, () => { g.scale(1, .2); g.fillStyle = radial(R, [[0, 1], [.3, .85], [.7, .3], [1, 0]]); g.fillRect(-R, -R, R * 2, R * 2); g.scale(1, .35); g.fillStyle = radial(R * .7, [[0, 1], [1, 0]]); g.fillRect(-R, -R, R * 2, R * 2); });
        cell(3, () => { [[0, 0, .62], [-.34, .1, .42], [.3, -.14, .46], [.06, .32, .4], [-.12, -.34, .38]].forEach(([x, y, r]) => { g.save(); g.translate(x * R, y * R); g.fillStyle = radial(r * R, [[0, .5], [.6, .26], [1, 0]]); g.fillRect(-R, -R, R * 2, R * 2); g.restore(); }); });
        cell(4, () => { poly([[-.7, .5], [-.2, -.8], [.75, -.1], [.3, .7]]); g.fillStyle = '#fff'; g.fill(); poly([[-.7, .5], [-.2, -.8], [.05, .1]]); g.fillStyle = 'rgba(0,0,0,.34)'; g.fill(); poly([[.05, .1], [.75, -.1], [.3, .7]]); g.fillStyle = 'rgba(0,0,0,.16)'; g.fill(); });
        cell(5, () => { g.fillStyle = radial(R * .5, [[0, .9], [1, 0]]); g.fillRect(-R, -R, R * 2, R * 2); g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4, r = i % 2 ? .09 : 1; g.lineTo(Math.cos(a) * r * R, Math.sin(a) * r * R); } g.closePath(); g.fill(); });
        cell(6, () => { g.strokeStyle = '#fff'; g.lineWidth = R * .16; g.shadowColor = '#fff'; g.shadowBlur = 4; g.beginPath(); g.arc(0, 0, R * .78, 0, TAU); g.stroke(); });
        cell(7, () => { const fill = g.createLinearGradient(0, R, 0, -R); fill.addColorStop(0, 'rgba(255,255,255,.95)'); fill.addColorStop(.55, 'rgba(255,255,255,.7)'); fill.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = fill; g.beginPath(); g.moveTo(0, -R); g.bezierCurveTo(R * .25, -R * .3, R * .7, R * .1, R * .5, R * .55); g.bezierCurveTo(R * .3, R, -R * .3, R, -R * .5, R * .55); g.bezierCurveTo(-R * .7, R * .1, -R * .2, -R * .3, 0, -R); g.fill(); });
        cell(8, () => { g.fillStyle = 'rgba(255,255,255,.82)'; g.beginPath(); g.moveTo(0, -R * .95); g.bezierCurveTo(R * .2, -R * .3, R * .62, R * .1, R * .62, R * .42); g.arc(0, R * .38, R * .62, 0, Math.PI); g.bezierCurveTo(-R * .62, R * .1, -R * .2, -R * .3, 0, -R * .95); g.fill(); g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-R * .2, R * .28, R * .14, R * .24, .5, 0, TAU); g.fill(); });
        cell(9, () => { const fill = g.createLinearGradient(-R, 0, R, 0); fill.addColorStop(0, 'rgba(255,255,255,.55)'); fill.addColorStop(1, '#fff'); g.fillStyle = fill; g.beginPath(); g.moveTo(-R * .95, 0); g.quadraticCurveTo(0, -R * .7, R * .95, 0); g.quadraticCurveTo(0, R * .5, -R * .95, 0); g.fill(); });
        g.font = '700 ' + Math.round(N * .8) + 'px ui-monospace,Consolas,Menlo,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        cell(10, () => { g.fillStyle = '#fff'; g.fillText('0', 0, N * .04); });
        cell(11, () => { g.fillStyle = '#fff'; g.fillText('1', 0, N * .04); });
        cell(12, () => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .42 : 1; g.lineTo(Math.cos(a) * r * R, Math.sin(a) * r * R); } g.closePath(); g.fillStyle = '#fff'; g.fill(); g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? .2 : .5; g.lineTo(Math.cos(a) * r * R, Math.sin(a) * r * R); } g.closePath(); g.fillStyle = 'rgba(0,0,0,.14)'; g.fill(); });
        cell(13, () => { g.fillStyle = '#fff'; g.beginPath(); g.arc(0, 0, R * .9, 0, TAU); g.fill(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = R * .12; g.beginPath(); g.arc(0, 0, R * .62, 0, TAU); g.stroke(); g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(-R * .08, -R * .36, R * .16, R * .72); });
        cell(14, () => { const w = R * 1.25, h = R * 1.8, r = R * .16; g.fillStyle = '#fff'; g.beginPath(); g.moveTo(-w / 2 + r, -h / 2); g.arcTo(w / 2, -h / 2, w / 2, h / 2, r); g.arcTo(w / 2, h / 2, -w / 2, h / 2, r); g.arcTo(-w / 2, h / 2, -w / 2, -h / 2, r); g.arcTo(-w / 2, -h / 2, w / 2, -h / 2, r); g.fill(); g.strokeStyle = 'rgba(0,0,0,.4)'; g.lineWidth = R * .07; g.strokeRect(-w * .36, -h * .38, w * .72, h * .76); poly([[0, -.34], [.22, 0], [0, .34], [-.22, 0]]); g.fillStyle = 'rgba(0,0,0,.45)'; g.fill(); });
        cell(15, () => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(-R * .22, R * .55, R * .34, R * .25, -.4, 0, TAU); g.fill(); g.fillRect(R * .02, -R * .8, R * .13, R * 1.35); g.beginPath(); g.moveTo(R * .15, -R * .8); g.quadraticCurveTo(R * .75, -R * .55, R * .6, R * .05); g.quadraticCurveTo(R * .55, -R * .3, R * .15, -R * .42); g.fill(); });
    }

    function create(options) {
        const opts = options || {}, host = opts.scene;
        if (!host || !host.parentNode) return null;
        const canvas = document.createElement('canvas');
        canvas.className = 'cfx-canvas'; canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:' + (getComputedStyle(host).zIndex || 'auto');
        host.parentNode.insertBefore(canvas, host.nextSibling);
        const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: !!opts.preserve });
        if (!gl) { canvas.remove(); return null; }
        const catalog = root.CombatEffects || null;
        const motion = root.matchMedia ? root.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
        const reduced = () => !!motion.matches;
        const cameraTargets = [host, canvas].concat(opts.cameraTargets || []);

        // ---- GL ----
        function program(vs, fs, uniforms, attributes) {
            const p = gl.createProgram();
            for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
                const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
                gl.attachShader(p, shader);
            }
            gl.linkProgram(p);
            if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
            const u = {}, a = {};
            uniforms.forEach(name => { u[name] = gl.getUniformLocation(p, 'u' + name); });
            attributes.forEach(name => { a[name] = gl.getAttribLocation(p, 'a' + name); });
            return { p, u, a };
        }
        let sprites, shapes, matter, quad, bound = null, lost = false;
        function initGl() {
            sprites = program(QUAD_VS, SPRITE_FS, ['M', 'Tex', 'Color', 'Flash', 'Time', 'Add', 'Swirl', 'Chroma', 'Mode', 'Dis', 'Flow', 'Reveal', 'Pivot', 'Edge'], ['Pos']);
            shapes = program(QUAD_VS, SHAPE_FS, ['M', 'Mode', 'Time', 'Add', 'White', 'Color', 'P'], ['Pos']);
            matter = program(MATTER_VS, MATTER_FS, ['Res', 'Center', 'Size', 'From', 'To', 'Rot', 'Flip', 'T', 'Mode', 'Time', 'Px', 'Grav', 'Spread', 'Alpha', 'Hot', 'Shard'], ['Home', 'Rnd', 'Col']);
            quad = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, quad);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
            gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            bound = null;
        }
        try { initGl(); } catch (error) { console.warn('[combat-fx] shader', error); canvas.remove(); return null; }
        // 탭이 오래 가려졌다 돌아오면 브라우저가 GL 컨텍스트를 버릴 수 있다. 되찾으면 셰이더를 다시 만들고 그림은 다시 받는다.
        canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; });
        canvas.addEventListener('webglcontextrestored', () => { try { initGl(); resetLive(); textures.clear(); lost = false; kick(); } catch (error) { console.warn('[combat-fx] restore', error); } });

        // ---- 절차 셰이더, 노이즈, 입자, 리본, 화면 캡처: 처음 쓰일 때 만든다 ----
        const fxPrograms = new Map();
        const live = { noise: null, particles: null, strip: null, snap: null, snapOk: false, snapAt: -1 };
        function resetLive() { fxPrograms.clear(); live.noise = live.particles = live.strip = live.snap = live.fbo = null; live.snapOk = false; }
        function fxProgram(name) {
            let prog = fxPrograms.get(name);
            if (prog !== undefined) return prog;
            const body = shaderBodies.get(name);
            prog = null;
            if (body) {
                const strip = name.startsWith('trail:'), lens = name.startsWith('lens:');
                try { prog = program(strip ? STRIP_VS : QUAD_VS, FX_HEAD + body + (lens ? LENS_MAIN : FX_MAIN), ['M', 'Res', 'Time', 'Add', 'Seed', 'Flip', 'Color', 'Color2', 'P', 'Q', 'Noise', 'Scene'], strip ? ['Pos', 'Uv'] : ['Pos']); }
                catch (error) { console.warn('[combat-fx] shader ' + name, error); }
            }
            fxPrograms.set(name, prog);
            return prog;
        }
        function noiseTexture() {
            if (live.noise) return live.noise;
            const N = 256, bytes = new Uint8Array(N * N * 4);
            let seed = 20261112;
            for (let i = 0; i < bytes.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; bytes[i] = seed >> 16 & 255; }
            live.noise = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, live.noise);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            return live.noise;
        }
        // 입자 버퍼. 고리 모양으로 돌려 쓰며, 가장 오래된 입자부터 덮어쓴다.
        function particleStore() {
            if (live.particles) return live.particles;
            const bytes = new ArrayBuffer(PARTICLE_CAP * 4 * PARTICLE_STRIDE), index = new Uint16Array(PARTICLE_CAP * 6);
            for (let i = 0; i < PARTICLE_CAP; i++) index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
            const store = { bytes, f: new Float32Array(bytes), b: new Uint8Array(bytes), head: 0, lo: PARTICLE_CAP, hi: -1, end: [0, 0, 0], buffer: gl.createBuffer(), index: gl.createBuffer(), tex: gl.createTexture(), prog: null };
            gl.bindBuffer(gl.ARRAY_BUFFER, store.buffer); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.DYNAMIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, store.index); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, index, gl.STATIC_DRAW);
            store.prog = program(PARTICLE_VS, PARTICLE_FS, ['Res', 'Now', 'Layer', 'Tex'], ['A', 'B', 'C', 'D', 'E', 'F']);
            const sheet = document.createElement('canvas');
            sheet.width = sheet.height = 256;
            (atlasPainter || paintAtlas)(sheet.getContext('2d'), 64);
            gl.bindTexture(gl.TEXTURE_2D, store.tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            bound = null;
            live.particles = store;
            return store;
        }
        const pick = (value, r, fallbackValue) => value == null ? fallbackValue : typeof value === 'number' ? value : value[0] + (value[1] - value[0]) * r;
        let emitSeed = 7;
        // 입자 한 무리를 낸다. 좌표와 속도는 화면 픽셀(초당)이고, 태어나는 시각을 미리 적어 두므로 장면 시작에 한꺼번에 불러도 된다.
        function emit(o, scene, bornAt) {
            if (lost) return;
            let store;
            try { store = particleStore(); } catch (error) { console.warn('[combat-fx] particles', error); return; }
            const count = Math.max(1, Math.round((o.n || 12) * (quality < 1 ? .55 : 1) * (opts.density || 1) * (reduced() ? .35 : 1)));
            const mirror = scene && scene.mirror, axis = scene ? scene.axis : 0, f = store.f, b = store.b;
            const c0 = o.color || WHITE, c1 = o.color2 || c0, a0 = (o.alpha == null ? 1 : o.alpha) * (c0[3] == null ? 1 : c0[3]), a1 = o.color2 ? (c1[3] == null ? a0 : c1[3] * (o.alpha == null ? 1 : o.alpha)) : a0;
            const cell = CELL[o.cell] == null ? 0 : CELL[o.cell], layer = o.layer == null ? 1 : o.layer, add = o.add == null ? 1 : o.add;
            let s = emitSeed = (emitSeed * 16807 + (o.seed | 0) * 131 + 11) % 2147483647 || 7;
            const rnd = () => { s = s * 16807 % 2147483647; return s / 2147483647; };
            const P = { x: 0, y: 0, vx: 0, vy: 0, life: 0, size: 0, end: 0, rot: 0, spin: 0, t: 0 };
            let last = 0;
            for (let i = 0; i < count; i++) {
                const u = count > 1 ? i / (count - 1) : 0, dir = o.angle == null ? rnd() * TAU : o.angle + (rnd() - .5) * (o.spread == null ? .6 : o.spread);
                const speed = pick(o.speed, rnd(), 0);
                P.x = o.x; P.y = o.y; P.vx = Math.cos(dir) * speed + (o.vx || 0); P.vy = Math.sin(dir) * speed + (o.vy || 0);
                if (o.radius) { const a = rnd() * TAU, r = Math.sqrt(rnd()) * o.radius; P.x += Math.cos(a) * r; P.y += Math.sin(a) * r * (o.flat || 1); }
                if (o.ring) { const a = o.angle == null ? rnd() * TAU : dir, cs = Math.cos(a), sn = Math.sin(a); P.x += cs * o.ring; P.y += sn * o.ring * (o.flat || 1); if (o.radial) { P.vx = cs * speed * o.radial + (o.vx || 0); P.vy = sn * speed * o.radial * (o.flat || 1) + (o.vy || 0); } }
                if (o.line) { const k = rnd(); P.x += o.line[0] * k; P.y += o.line[1] * k; }
                P.life = pick(o.life, rnd(), .5); P.size = pick(o.size, rnd(), 8); P.end = P.size * (o.grow == null ? .25 : o.grow);
                P.rot = o.rot == null ? rnd() * TAU : o.rot; P.spin = (rnd() - .5) * 2 * (o.spin || 0); P.t = (o.over || 0) * (o.even ? u : rnd());
                if (o.each) o.each(P, i, u, rnd);
                if (mirror) { P.x = 2 * axis - P.x; P.vx = -P.vx; P.rot = Math.PI - P.rot; P.spin = -P.spin; }
                const born = bornAt + P.t, slot = store.head;
                store.head = (store.head + 1) % PARTICLE_CAP;
                if (slot < store.lo) store.lo = slot; if (slot > store.hi) store.hi = slot;
                for (let corner = 0; corner < 4; corner++) {
                    const v = (slot * 4 + corner) * PARTICLE_STRIDE, k = v / 4;
                    f[k] = P.x; f[k + 1] = P.y; f[k + 2] = P.vx; f[k + 3] = P.vy;
                    f[k + 4] = born; f[k + 5] = P.life; f[k + 6] = P.size; f[k + 7] = P.end;
                    f[k + 8] = P.rot; f[k + 9] = P.spin; f[k + 10] = o.grav || 0; f[k + 11] = o.drag || 0;
                    f[k + 12] = cell * 4 + corner; f[k + 13] = add + layer * 2; f[k + 14] = o.stretch || 0; f[k + 15] = o.turb || 0;
                    b[v + 64] = c0[0] * 255; b[v + 65] = c0[1] * 255; b[v + 66] = c0[2] * 255; b[v + 67] = a0 * 255;
                    b[v + 68] = c1[0] * 255; b[v + 69] = c1[1] * 255; b[v + 70] = c1[2] * 255; b[v + 71] = a1 * 255;
                }
                if (born + P.life > last) last = born + P.life;
            }
            if (last > store.end[layer]) store.end[layer] = last;
            kick();
        }
        function drawParticles(layer) {
            const store = live.particles;
            if (!store || now >= store.end[layer]) return;
            const prog = store.prog, a = prog.a;
            bound = prog; gl.useProgram(prog.p);
            gl.bindBuffer(gl.ARRAY_BUFFER, store.buffer);
            if (store.hi >= store.lo) {
                const from = store.lo * 4 * PARTICLE_STRIDE, to = (store.hi + 1) * 4 * PARTICLE_STRIDE;
                gl.bufferSubData(gl.ARRAY_BUFFER, from, new Uint8Array(store.bytes, from, to - from));
                store.lo = PARTICLE_CAP; store.hi = -1;
            }
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, store.index);
            ['A', 'B', 'C', 'D'].forEach((name, i) => { gl.enableVertexAttribArray(a[name]); gl.vertexAttribPointer(a[name], 4, gl.FLOAT, false, PARTICLE_STRIDE, i * 16); });
            gl.enableVertexAttribArray(a.E); gl.vertexAttribPointer(a.E, 4, gl.UNSIGNED_BYTE, true, PARTICLE_STRIDE, 64);
            gl.enableVertexAttribArray(a.F); gl.vertexAttribPointer(a.F, 4, gl.UNSIGNED_BYTE, true, PARTICLE_STRIDE, 68);
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, store.tex); gl.uniform1i(prog.u.Tex, 0);
            gl.uniform2f(prog.u.Res, W, H); gl.uniform1f(prog.u.Now, now); gl.uniform1f(prog.u.Layer, layer);
            gl.drawElements(gl.TRIANGLES, PARTICLE_CAP * 6, gl.UNSIGNED_SHORT, 0);
            ['A', 'B', 'C', 'D', 'E', 'F'].forEach(name => gl.disableVertexAttribArray(a[name]));
        }
        // 전투 화면(호스트 캔버스)을 한 장 찍어 렌즈 셰이더의 재료로 쓴다. 찍을 수 없으면 렌즈는 그리지 않는다.
        // WebGL 캔버스는 화면에 내보낸 뒤 그림 버퍼가 비워진다. 호스트가 그리기 전에 찍히면 빈 그림이 되므로,
        // 장면마다 처음 찍을 때 몇 점을 읽어 비었는지 확인하고, 비어 있으면 그 렌즈는 그리지 않는다(두 번 이어지면 렌즈를 끈다).
        const probe = new Uint8Array(4);
        function blank(width, height) {
            if (!live.fbo) live.fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, live.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, live.snap, 0);
            let sum = 1;
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
                sum = 0;
                for (const [fx, fy] of [[.5, .5], [.3, .62], [.72, .38]]) { gl.readPixels(Math.floor(width * fx), Math.floor(height * fy), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, probe); sum += probe[0] + probe[1] + probe[2] + probe[3]; }
            }
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return sum === 0;
        }
        function capture(check) {
            const source = opts.snapshot ? opts.snapshot() : host.tagName === 'CANVAS' ? host : null;
            if (!source || !source.width || !source.height) return false;
            try {
                if (!live.snap) {
                    live.snap = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, live.snap);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                } else gl.bindTexture(gl.TEXTURE_2D, live.snap);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
                live.snapOk = true; live.snapAt = now;
                if (check && blank(source.width, source.height)) { live.snapOk = false; live.blanks = (live.blanks || 0) + 1; if (live.blanks >= 2) live.failed = true; }
                else if (check) live.blanks = 0;
            } catch (_) { live.snapOk = false; live.failed = true; }
            return live.snapOk;
        }

        let W = 1, H = 1, dpr = 1, U = 1, quality = 1, slow = 0;
        function resize() {
            const rect = canvas.getBoundingClientRect();
            W = Math.max(1, rect.width); H = Math.max(1, rect.height);
            dpr = Math.min(root.devicePixelRatio || 1, quality < 1 ? 1 : 2, Math.sqrt(2400000 / (W * H)));
            const w = Math.round(W * dpr), h = Math.round(H * dpr);
            if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
            gl.viewport(0, 0, w, h);
            U = Math.min(H, W * 1.15);
        }

        // ---- 그림과 조각 ----
        const textures = new Map();
        function upload(entry, source) {
            entry.tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, entry.tex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            entry.source = source; entry.ready = true;
        }
        function image(effectId) {
            let entry = textures.get(effectId);
            if (entry) { entry.used = performance.now(); return entry; }
            entry = { id: effectId, ready: false, failed: false, w: SIZE, h: SIZE, ox: 0, oy: 0, pivot: [.5, .5], used: performance.now(), waiting: [] };
            textures.set(effectId, entry);
            const painter = painters.get(effectId);
            if (painter) {
                // 그림 파일이 아니라 장면집이 직접 그린 도형(실루엣 등)
                const sheet = document.createElement('canvas');
                sheet.width = entry.w = painter.width; sheet.height = entry.h = painter.height;
                painter.draw(sheet.getContext('2d'), painter.width, painter.height);
                upload(entry, sheet);
                return entry;
            }
            const url = opts.assetUrl ? opts.assetUrl(effectId) : catalog && catalog.assetUrl(effectId);
            if (!url) { entry.failed = true; return entry; }
            const img = new Image(); img.decoding = 'async';
            img.onload = () => { upload(entry, img); entry.waiting.splice(0).forEach(fn => fn(true)); kick(); };
            img.onerror = () => { entry.failed = true; entry.waiting.splice(0).forEach(fn => fn(false)); };
            img.src = url;
            sweep();
            return entry;
        }
        // 다각형으로 잘라낸 조각. '~rest'는 모든 조각을 뺀 나머지 그림이다.
        function part(effectId, name) {
            const key = effectId + '#' + name;
            let entry = textures.get(key);
            if (entry) { entry.used = performance.now(); return entry; }
            const base = image(effectId), spec = parts.get(effectId);
            if (!base.ready || !spec) return base;
            const scratch = document.createElement('canvas'), g = scratch.getContext('2d');
            const trace = (poly, dx, dy) => { g.beginPath(); poly.forEach(([x, y], i) => g[i ? 'lineTo' : 'moveTo'](x + dx, y + dy)); g.closePath(); };
            if (name === '~rest') {
                scratch.width = scratch.height = SIZE;
                g.drawImage(base.source, 0, 0, SIZE, SIZE);
                g.globalCompositeOperation = 'destination-out';
                g.shadowColor = '#000'; g.shadowBlur = 5;
                for (const piece of Object.values(spec)) if (!piece.keep) { trace(piece.poly, 0, 0); g.fill(); }
                entry = { id: key, w: SIZE, h: SIZE, ox: 0, oy: 0, pivot: [.5, .5] };
            } else {
                const piece = spec[name];
                if (!piece) return base;
                const xs = piece.poly.map(p => p[0]), ys = piece.poly.map(p => p[1]), pad = 5;
                const x0 = Math.max(0, Math.floor(Math.min(...xs)) - pad), y0 = Math.max(0, Math.floor(Math.min(...ys)) - pad);
                const x1 = Math.min(SIZE, Math.ceil(Math.max(...xs)) + pad), y1 = Math.min(SIZE, Math.ceil(Math.max(...ys)) + pad);
                scratch.width = x1 - x0; scratch.height = y1 - y0;
                g.shadowColor = '#000'; g.shadowBlur = 3;
                trace(piece.poly, -x0, -y0); g.fill();
                g.shadowBlur = 0; g.globalCompositeOperation = 'source-in';
                g.drawImage(base.source, -x0, -y0, SIZE, SIZE);
                const pivot = piece.pivot || [(x0 + x1) / 2, (y0 + y1) / 2];
                entry = { id: key, w: x1 - x0, h: y1 - y0, ox: x0, oy: y0, pivot: [(pivot[0] - x0) / (x1 - x0), (pivot[1] - y0) / (y1 - y0)] };
            }
            entry.used = performance.now();
            upload(entry, scratch);
            textures.set(key, entry);
            return entry;
        }
        function sweep() {
            if (textures.size < 56) return;
            const now = performance.now();
            for (const [key, entry] of textures) {
                if (now - entry.used < 25000 || entry.waiting && entry.waiting.length) continue;
                if (entry.tex) gl.deleteTexture(entry.tex);
                if (entry.points) gl.deleteBuffer(entry.points.buffer);
                textures.delete(key);
            }
        }
        // 그림의 화소를 뽑아 입자 버퍼로 만든다. 밝은 화소일수록 뽑힐 확률이 높다.
        function points(entry) {
            if (entry.points) return entry.points;
            const N = 104, scratch = document.createElement('canvas'), g = scratch.getContext('2d', { willReadFrequently: true });
            scratch.width = scratch.height = N;
            g.drawImage(entry.source, 0, 0, N, N);
            let data;
            try { data = g.getImageData(0, 0, N, N).data; } catch (_) { return null; }
            let seed = 1;
            const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
            const picked = [];
            for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
                const i = (y * N + x) * 4, a = data[i + 3];
                if (a < 70) continue;
                const lum = (data[i] + data[i + 1] + data[i + 2]) / 765;
                if (rnd() < .22 + lum * .6) picked.push(i);
            }
            for (let i = picked.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = picked[i]; picked[i] = picked[j]; picked[j] = t; }
            const count = Math.min(picked.length, 2200), stride = 28, bytes = new ArrayBuffer(count * stride), f = new Float32Array(bytes), b = new Uint8Array(bytes);
            for (let n = 0; n < count; n++) {
                const i = picked[n], px = (i / 4) % N, py = Math.floor(i / 4 / N), o = n * 7;
                f[o] = (px + rnd()) / N; f[o + 1] = (py + rnd()) / N;
                f[o + 2] = rnd(); f[o + 3] = rnd(); f[o + 4] = rnd(); f[o + 5] = rnd();
                b[n * stride + 24] = data[i]; b[n * stride + 25] = data[i + 1]; b[n * stride + 26] = data[i + 2]; b[n * stride + 27] = data[i + 3];
            }
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, bytes, gl.STATIC_DRAW);
            entry.points = { buffer, count, stride };
            return entry.points;
        }
        const resolveTexture = key => !key ? null : typeof key === 'string' ? image(key) : key.part ? part(key.id, key.part) : image(key.id);
        // 그림에서 가장 눈에 띄는 빛의 색. 고리와 불티가 그림마다 제 색을 띠게 한다.
        function tone(entry) {
            if (entry.tone) return entry.tone;
            if (!entry.ready) return null;
            const N = 28, scratch = document.createElement('canvas'), g = scratch.getContext('2d', { willReadFrequently: true });
            scratch.width = scratch.height = N;
            g.drawImage(entry.source, 0, 0, N, N);
            let data, r = 0, gr = 0, b = 0, total = 0;
            try { data = g.getImageData(0, 0, N, N).data; } catch (_) { return null; }
            for (let i = 0; i < data.length; i += 4) {
                const hi = Math.max(data[i], data[i + 1], data[i + 2]), lo = Math.min(data[i], data[i + 1], data[i + 2]);
                if (data[i + 3] < 120 || hi < 120) continue;
                const weight = .08 + ((hi - lo) / hi) ** 2;
                r += data[i] * weight; gr += data[i + 1] * weight; b += data[i + 2] * weight; total += weight;
            }
            if (!total) return null;
            const peak = Math.max(r, gr, b) || 1;
            entry.tone = [.25 + .75 * r / peak, .25 + .75 * gr / peak, .25 + .75 * b / peak];
            return entry.tone;
        }

        // ---- 소리: 녹음된 음원만 재생한다 ----
        const audio = { context: null, buffers: new Map(), last: new Map(), voices: 0 };
        const soundUrl = name => (opts.soundBase || '/static/assets/combat-fx/sfx/') + name + '.mp3';
        // 오디오 컨텍스트는 첫 입력 뒤에 만든다. 그 전에 요청된 소리는 이름만 적어 두었다가 그때 받는다.
        function audioContext() {
            if (audio.context || audio.failed || !audio.unlocked) return audio.context;
            const Context = root.AudioContext || root.webkitAudioContext;
            if (!Context) { audio.failed = true; return null; }
            try { audio.context = new Context(); audio.master = audio.context.createGain(); audio.master.connect(audio.context.destination); }
            catch (_) { audio.failed = true; }
            return audio.context;
        }
        function fetchSound(name, entry) {
            const context = audioContext();
            if (!context || entry.requested) return;
            entry.requested = true;
            fetch(soundUrl(name)).then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status))))
                .then(bytes => new Promise((resolve, reject) => context.decodeAudioData(bytes, resolve, reject)))
                .then(buffer => { entry.buffer = buffer; }).catch(() => { entry.failed = true; });
        }
        function unlock() {
            audio.unlocked = true;
            const context = audioContext();
            if (!context) return;
            if (context.state === 'suspended') context.resume().catch(() => {});
            audio.buffers.forEach((entry, name) => fetchSound(name, entry));
        }
        function loadSound(name) {
            let entry = audio.buffers.get(name);
            if (!entry) { entry = { buffer: null, requested: false }; audio.buffers.set(name, entry); }
            fetchSound(name, entry);
            return entry;
        }
        function sound(name, options) {
            const o = options || {};
            if (!name || opts.muted && opts.muted() || document.hidden) return;
            const context = audioContext();
            if (!context || context.state !== 'running') return;
            const entry = loadSound(name), nowMs = performance.now();
            if (!entry.buffer || audio.voices >= 14) return;
            if (nowMs - (audio.last.get(name) || -1e9) < (o.cool == null ? 45 : o.cool)) return;
            audio.last.set(name, nowMs);
            const source = context.createBufferSource(), gain = context.createGain();
            source.buffer = entry.buffer;
            source.playbackRate.value = (o.rate || 1) * (1 + (Math.random() - .5) * (o.vary == null ? .08 : o.vary));
            const master = opts.volume ? Number(opts.volume()) : .6;
            gain.gain.value = clamp((o.vol == null ? .6 : o.vol) * master, 0, 1);
            source.connect(gain).connect(audio.master);
            audio.voices++;
            source.onended = () => { audio.voices = Math.max(0, audio.voices - 1); };
            source.start(0, o.offset || 0);
        }
        const onGesture = () => unlock();
        root.addEventListener('pointerdown', onGesture, { passive: true });
        root.addEventListener('keydown', onGesture);

        // ---- 시간과 장면 ----
        let now = 0, lastReal = 0, frozenUntil = 0, raf = 0, sequence = 0, pauseAt = null;
        let nodes = [], timers = [], keepers = 0;
        const camera = { amp: 0, start: 0, dur: 0, zoom: 0, zoomStart: 0, zoomDur: 0, ox: .5, oy: .5, applied: '' };
        const recent = new Map();
        const poses = [], poseOut = { dx: 0, dy: 0, nx: 0, ny: 0, sx: 1, sy: 1, rot: 0, alpha: 1, flash: 0 };
        function pose(tag) {
            let any = false;
            poseOut.dx = poseOut.dy = poseOut.rot = poseOut.flash = 0; poseOut.sx = poseOut.sy = poseOut.alpha = 1;
            for (let i = poses.length - 1; i >= 0; i--) {
                const node = poses[i], p = node.p;
                if (node.gone || node.dead) { poses.splice(i, 1); continue; }
                if (p.who !== tag || now < node.born) continue;
                const m = node.scene && node.scene.mirror ? -1 : 1;
                any = true; poseOut.dx += p.dx * m; poseOut.dy += p.dy; poseOut.rot += p.rot * m; poseOut.sx *= p.sx; poseOut.sy *= p.sy; poseOut.alpha *= p.alpha; if (p.flash > poseOut.flash) poseOut.flash = p.flash;
            }
            if (!any) return null;
            poseOut.nx = poseOut.dx / W; poseOut.ny = poseOut.dy / H;
            return poseOut;
        }

        function makeNode(kind, defaults, props, born, scene) {
            const node = new Node(kind, Object.assign({}, defaults, props), born, scene);
            node.seq = sequence++;
            nodes.push(node);
            if (node.p.keep) keepers++;
            return node;
        }
        function scheduleAt(time, fn) { timers.push({ t: time, fn }); }

        // 장면이 쓰는 도구. 모든 좌표는 화면 픽셀이고, 왼쪽의 시전자가 오른쪽의 대상을 치는 방향으로 적는다.
        function stage(context, start) {
            const scene = { mirror: context.mirror, axis: context.axis, impact: 0, stopped: false, nodes: [], start };
            const S = {
                t0: start,
                id: context.id, A: context.A, T: context.T, gA: context.gA, gT: context.gT, U, W, H,
                role: context.role, event: context.event || {}, hit: context.hit || null, minor: !!context.minor, scale: context.scale || 1, reduced: reduced(),
                tone: context.tone || [1, .86, .5], seed: context.seed, scene, ease: EASE,
                rnd(i) { const n = Math.sin((context.seed + i) * 61.37 + 17.8) * 43758.54; return n - Math.floor(n); },
                key(name, id) { return name ? { id: id || context.id, part: name } : id || context.id; },
                sprite(props, t0, key) {
                    const p = Object.assign({ key: key === undefined ? context.id : key }, props);
                    const node = makeNode('sprite', SPRITE_DEFAULTS, p, start + (t0 || 0), scene); scene.nodes.push(node); return node;
                },
                part(name, props, t0, id) { return S.sprite(props, t0, { id: id || context.id, part: name }); },
                shape(kind, props, t0) {
                    const p = Object.assign({ shape: SHAPE[kind], color: S.tone }, props);
                    const node = makeNode('shape', SHAPE_DEFAULTS, p, start + (t0 || 0), scene); scene.nodes.push(node); return node;
                },
                matter(kind, props, t0, key) {
                    if (S.reduced) return new Node('none', {}, 0, scene);
                    const p = Object.assign({ key: key === undefined ? context.id : key, matter: MATTER[kind] }, props);
                    const node = makeNode('matter', MATTER_DEFAULTS, p, start + (t0 || 0), scene); scene.nodes.push(node); return node;
                },
                // 절차 셰이더로 그리는 면. name은 CombatFX.shader로 등록한 이름이다.
                field(name, props, t0) {
                    const p = Object.assign({ shader: name, color: S.tone }, props);
                    const node = makeNode('field', FIELD_DEFAULTS, p, start + (t0 || 0), scene); scene.nodes.push(node); return node;
                },
                // 경로를 따라 그리는 리본. path(s)는 0~1의 s에 화면 좌표 [x, y]를 돌려주고, tail~head 구간만 보인다.
                trail(name, props, t0) {
                    const p = Object.assign({ shader: 'trail:' + (name || 'energy'), color: S.tone }, props);
                    const node = makeNode('trail', TRAIL_DEFAULTS, p, start + (t0 || 0), scene); scene.nodes.push(node); return node;
                },
                // 전투 화면을 찍어 일그러뜨리는 렌즈. 찍을 수 없는 화면에서는 아무것도 그리지 않는다.
                lens(name, props, t0) {
                    if (S.reduced || live.failed || opts.lens === false) return new Node('none', {}, 0, scene);
                    const p = Object.assign({ shader: 'lens:' + name, x: W / 2, y: H / 2 }, props);
                    const node = makeNode('lens', LENS_DEFAULTS, p, start + (t0 || 0), scene); scene.nodes.push(node); return node;
                },
                // 시전자('a')나 대상('t')의 몸짓. 호스트가 fx.pose(이름)으로 읽어 캐릭터 그림에 반영한다.
                // dx, dy는 화면 픽셀(시전자에서 대상 쪽이 +x), sx·sy는 발을 기준으로 한 배율, rot은 몸 가운데를 축으로 한 기울기,
                // alpha는 투명도, flash는 흰 번쩍임이다. 끝날 때는 제자리로 돌려놓는다.
                pose(who, props, t0) {
                    const tag = context.tags[who === 'a' ? 'a' : 't'];
                    if (!tag || S.reduced) return new Node('none', {}, 0, scene);
                    const node = makeNode('pose', POSE_DEFAULTS, Object.assign({ who: tag }, props), start + (t0 || 0), scene); scene.nodes.push(node); poses.push(node); return node;
                },
                // 입자 무리. spec.t는 장면 시작부터의 시각이다.
                burst(spec) { if (!scene.stopped) emit(spec, scene, start + (spec.t || 0)); },
                at(t, fn) { scheduleAt(start + t, () => { if (!scene.stopped) fn(); }); },
                sfx(name, t0, options) { if (!context.silent) scheduleAt(start + (t0 || 0), () => sound(name, options)); },
                // 소리의 타격점이 t0에 떨어지도록 앞당겨 튼다. 앞소리가 있는 음원은 날아가는 동안 그 앞소리가 깔린다.
                hit(name, t0, options) {
                    if (context.silent) return;
                    const o = options || {}, lead = (api.soundHits[name] || 0) / (o.rate || 1), at = (t0 || 0) - lead;
                    if (at >= 0) scheduleAt(start + at, () => sound(name, o));
                    else scheduleAt(start, () => sound(name, Object.assign({}, o, { offset: -at * (o.rate || 1) })));
                },
                shake(amp, duration, t0) { scheduleAt(start + (t0 || 0), () => shake(amp, duration)); },
                punch(amount, t0, duration, at) { scheduleAt(start + (t0 || 0), () => punch(amount, duration, at || S.T, scene)); },
                stop(ms, t0) { scheduleAt(start + (t0 || 0), () => hitstop(ms)); },
                flash(color, alpha, duration, t0) {
                    if (S.reduced) return;
                    S.shape('rect', { x: W / 2, y: H / 2, w: W * 1.2, h: H * 1.2, color, alpha, p0: 0, p1: 0, z: 40 }, t0).to({ alpha: 0 }, duration, 'out');
                },
                // 화면을 잠깐 어둡게 눌러 연출을 띄운다. 초점 주변은 덜 어둡다.
                dim(alpha, t0, hold, at, fadeIn, fadeOut) {
                    const p = at || S.T, size = Math.max(W, H) * 2.6;
                    return S.shape('rect', { x: p.x, y: p.y, w: size, h: size, color: [0, 0, 0], alpha: 0, add: 0, p0: .1, p1: .55, z: -60 }, t0)
                        .to({ alpha }, fadeIn == null ? .12 : fadeIn, 'out').wait(hold).to({ alpha: 0 }, fadeOut == null ? .3 : fadeOut, 'io');
                },
                color(id) { return tone(image(id || context.id)) || S.tone; },
                get host() { return instance; },
                ready(key) { const entry = resolveTexture(key); return !!(entry && entry.ready); }
            };
            return S;
        }

        function shake(amp, duration) {
            if (reduced() || !(amp > 0)) return;
            const left = camera.amp * clamp(1 - (now - camera.start) / Math.max(.001, camera.dur));
            if (amp < left) return;
            camera.amp = amp; camera.start = now; camera.dur = duration || .3;
        }
        function punch(amount, duration, at, scene) {
            if (reduced()) return;
            let x = at.x;
            if (scene && scene.mirror) x = 2 * scene.axis - x;
            camera.zoom = amount; camera.zoomStart = now; camera.zoomDur = duration || .32; camera.ox = clamp(x / W); camera.oy = clamp(at.y / H);
        }
        function hitstop(ms) { if (!reduced()) frozenUntil = Math.max(frozenUntil, performance.now() + Math.min(110, ms)); }
        function applyCamera() {
            let dx = 0, dy = 0, zoom = 1;
            const s = clamp(1 - (now - camera.start) / Math.max(.001, camera.dur));
            if (camera.amp > 0 && s > 0) {
                const a = camera.amp * s * s, t = performance.now();
                dx = Math.sin(t * .09) * a + Math.sin(t * .23 + 1.3) * a * .5; dy = Math.cos(t * .11 + .7) * a * .8 + Math.sin(t * .31) * a * .4;
            } else camera.amp = 0;
            const z = clamp((now - camera.zoomStart) / Math.max(.001, camera.zoomDur));
            if (camera.zoom > 0 && z < 1) zoom = 1 + camera.zoom * (z < .22 ? EASE.out(z / .22) : 1 - EASE.io((z - .22) / .78));
            else camera.zoom = 0;
            const value = dx || dy || zoom !== 1 ? 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px) scale(' + zoom.toFixed(4) + ')' : '';
            if (value === camera.applied) return;
            camera.applied = value;
            const origin = (camera.ox * 100).toFixed(1) + '% ' + (camera.oy * 100).toFixed(1) + '%';
            cameraTargets.forEach(element => { element.style.transformOrigin = origin; element.style.transform = value; });
        }

        // ---- 그리기 ----
        const matrix = new Float32Array(9);
        function setMatrix(location, x, y, w, h, rot, px, py) {
            const c = Math.cos(rot), s = Math.sin(rot), pox = px - .5, poy = py - .5;
            matrix[0] = c * w * 2 / W; matrix[1] = -s * w * 2 / H; matrix[2] = 0;
            matrix[3] = -s * h * 2 / W; matrix[4] = -c * h * 2 / H; matrix[5] = 0;
            matrix[6] = (x - c * w * pox + s * h * poy) * 2 / W - 1; matrix[7] = 1 - (y - s * w * pox - c * h * poy) * 2 / H; matrix[8] = 1;
            gl.uniformMatrix3fv(location, false, matrix);
        }
        function useQuad(prog) {
            if (bound === prog) return;
            bound = prog; gl.useProgram(prog.p);
            gl.bindBuffer(gl.ARRAY_BUFFER, quad);
            gl.enableVertexAttribArray(prog.a.Pos); gl.vertexAttribPointer(prog.a.Pos, 2, gl.FLOAT, false, 0, 0);
        }
        const WHITE = [1, 1, 1], NONE = [0, 0, 0];
        function drawSprite(node) {
            const p = node.p, entry = resolveTexture(p.key);
            if (!entry || !entry.ready || p.alpha <= .003) return;
            const scene = node.scene, mirror = scene && scene.mirror, k = p.size / SIZE;
            const x = mirror ? 2 * scene.axis - p.x : p.x, rot = mirror ? -p.rot : p.rot, flip = (mirror ? -1 : 1) * (p.flip < 0 ? -1 : 1);
            const pivot = p.pivot || entry.pivot, w = entry.w * k * p.sx * flip, h = entry.h * k * p.sy, tint = p.tint || WHITE, edge = p.edge || NONE;
            useQuad(sprites);
            const u = sprites.u;
            gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, entry.tex); gl.uniform1i(u.Tex, 0);
            gl.uniform1f(u.Time, now + node.seq * 1.7);
            gl.uniform1f(u.Flash, p.flash); gl.uniform1f(u.Swirl, p.swirl); gl.uniform1f(u.Chroma, p.chroma); gl.uniform1f(u.Mode, p.mode); gl.uniform1f(u.Dis, p.dis);
            gl.uniform4f(u.Flow, p.flow, p.ff, p.fvx, p.fvy); gl.uniform4f(u.Reveal, p.head, p.tail, p.ang, Math.max(.001, p.soft));
            const center = p.center || [.5, .5];
            gl.uniform2f(u.Pivot, center[0], center[1]); gl.uniform3f(u.Edge, edge[0], edge[1], edge[2]);
            if (p.glow > 0) {
                // 같은 그림을 조금 키워 빛으로만 한 번 더 얹는다.
                gl.uniform1f(u.Add, 1); gl.uniform4f(u.Color, tint[0], tint[1], tint[2], p.alpha * p.glow);
                setMatrix(u.M, x, p.y, w * 1.09, h * 1.09, rot, pivot[0], pivot[1]);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            gl.uniform1f(u.Add, p.add); gl.uniform4f(u.Color, tint[0], tint[1], tint[2], p.alpha);
            setMatrix(u.M, x, p.y, w, h, rot, pivot[0], pivot[1]);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        function drawShape(node) {
            const p = node.p;
            if (p.alpha <= .003) return;
            const scene = node.scene, mirror = scene && scene.mirror, color = p.color || WHITE;
            useQuad(shapes);
            const u = shapes.u;
            gl.uniform1f(u.Mode, p.shape); gl.uniform1f(u.Time, now); gl.uniform1f(u.Add, p.add); gl.uniform1f(u.White, p.white);
            gl.uniform4f(u.Color, color[0], color[1], color[2], p.alpha); gl.uniform4f(u.P, p.p0, p.p1, p.p2, p.p3);
            setMatrix(u.M, mirror ? 2 * scene.axis - p.x : p.x, p.y, mirror ? -p.w : p.w, p.h, mirror ? -p.rot : p.rot, .5, .5);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        function drawMatter(node) {
            const p = node.p, entry = resolveTexture(p.key);
            if (!entry || !entry.ready || p.alpha <= .003 || p.t <= 0 || p.t >= 1) return;
            const buffer = points(entry);
            if (!buffer) return;
            const scene = node.scene, mirror = scene && scene.mirror, k = p.size / SIZE, u = matter.u, a = matter.a;
            const mx = value => mirror ? 2 * scene.axis - value : value;
            // 조각이면 조각의 중심이 기준점에서 떨어진 만큼 옮겨 그림 위 제자리에 놓는다.
            const pivot = p.pivot || entry.pivot, flip = (mirror ? -1 : 1) * (p.flip < 0 ? -1 : 1), rot = mirror ? -p.rot : p.rot;
            const lx = (.5 - pivot[0]) * entry.w * k * flip, ly = (.5 - pivot[1]) * entry.h * k, c = Math.cos(rot), s = Math.sin(rot);
            bound = matter; gl.useProgram(matter.p);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buffer);
            gl.enableVertexAttribArray(a.Home); gl.vertexAttribPointer(a.Home, 2, gl.FLOAT, false, buffer.stride, 0);
            gl.enableVertexAttribArray(a.Rnd); gl.vertexAttribPointer(a.Rnd, 4, gl.FLOAT, false, buffer.stride, 8);
            gl.enableVertexAttribArray(a.Col); gl.vertexAttribPointer(a.Col, 4, gl.UNSIGNED_BYTE, true, buffer.stride, 24);
            gl.uniform2f(u.Res, W, H); gl.uniform2f(u.Center, mx(p.x) + lx * c - ly * s, p.y + lx * s + ly * c);
            gl.uniform2f(u.Size, entry.w * k, entry.h * k); gl.uniform2f(u.From, mx(p.fx), p.fy); gl.uniform2f(u.To, mx(p.tx), p.ty);
            gl.uniform1f(u.Rot, rot); gl.uniform1f(u.Flip, flip); gl.uniform1f(u.T, p.t); gl.uniform1f(u.Mode, p.matter); gl.uniform1f(u.Time, now);
            gl.uniform1f(u.Px, p.px * dpr); gl.uniform1f(u.Grav, p.grav); gl.uniform1f(u.Spread, p.spread); gl.uniform1f(u.Alpha, p.alpha); gl.uniform1f(u.Hot, p.hot); gl.uniform1f(u.Shard, p.shard);
            gl.drawArrays(gl.POINTS, 0, Math.max(1, Math.floor(buffer.count * clamp(p.frac) * quality * (opts.density || 1))));
            gl.disableVertexAttribArray(a.Rnd); gl.disableVertexAttribArray(a.Col);
        }

        function fxUniforms(prog, node, mirror) {
            const p = node.p, u = prog.u, color = p.color || WHITE, second = p.color2 || color;
            gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, noiseTexture()); gl.uniform1i(u.Noise, 1);
            gl.uniform1f(u.Time, now - node.born + p.seed * 3.7); gl.uniform1f(u.Add, p.add == null ? 0 : p.add); gl.uniform1f(u.Seed, p.seed); gl.uniform1f(u.Flip, mirror ? -1 : 1);
            gl.uniform4f(u.Color, color[0], color[1], color[2], p.alpha); gl.uniform3f(u.Color2, second[0], second[1], second[2]);
            gl.uniform4f(u.P, p.p0, p.p1, p.p2, p.p3); gl.uniform4f(u.Q, p.q0, p.q1, p.q2 || 0, p.q3 || 0);
        }
        function drawField(node) {
            const p = node.p;
            if (p.alpha <= .003) return;
            const prog = fxProgram(p.shader);
            if (!prog) return;
            const scene = node.scene, mirror = scene && scene.mirror;
            useQuad(prog);
            fxUniforms(prog, node, mirror);
            setMatrix(prog.u.M, mirror ? 2 * scene.axis - p.x : p.x, p.y, mirror ? -p.w : p.w, p.h, mirror ? -p.rot : p.rot, .5, .5);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        // 화면 전체를 덮는 렌즈. 초점(x, y)과 각도는 좌우 반전에 맞춰 넘긴다.
        function drawLens(node) {
            const p = node.p;
            if (p.alpha <= .003) return;
            const prog = fxProgram(p.shader);
            if (!prog) return;
            if (node.skip) return;
            if (!node.shot) { node.shot = true; if (!capture(true)) { node.skip = true; return; } }
            else if (p.live && live.snapAt !== now && !capture(false)) return;
            if (!live.snapOk) return;
            const scene = node.scene, mirror = scene && scene.mirror, x = mirror ? 2 * scene.axis - p.x : p.x;
            useQuad(prog);
            fxUniforms(prog, node, false);
            gl.uniform4f(prog.u.Q, x / W, p.y / H, mirror ? Math.PI - p.ang : p.ang, W / H);
            gl.uniform1f(prog.u.Add, 0);
            gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, live.snap); gl.uniform1i(prog.u.Scene, 2);
            setMatrix(prog.u.M, W / 2, H / 2, W, H, 0, .5, .5);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        const STRIP_MAX = 96, stripData = new Float32Array((STRIP_MAX + 1) * 8);
        function drawTrail(node) {
            const p = node.p, span = p.head - p.tail;
            if (p.alpha <= .003 || span <= .001 || !p.path) return;
            const prog = fxProgram(p.shader);
            if (!prog) return;
            if (!live.strip) live.strip = gl.createBuffer();
            const scene = node.scene, mirror = scene && scene.mirror, axis = scene ? scene.axis : 0;
            const n = Math.max(2, Math.min(STRIP_MAX, Math.round(p.seg * (quality < 1 ? .6 : 1)))), t = now - node.born, tick = Math.floor(t * 28) + p.seed * 13;
            let nx = 0, ny = 1;
            for (let i = 0; i <= n; i++) {
                const u = i / n, s = p.tail + span * u, point = p.path(s, t);
                let x = point[0], y = point[1];
                if (i < n) { const next = p.path(Math.min(1, s + span / n), t), dx = next[0] - x, dy = next[1] - y, len = Math.hypot(dx, dy); if (len > .0001) { nx = -dy / len; ny = dx / len; } }
                if (p.jag) { const h = Math.sin((i * 12.9898 + tick * 78.233) % 6.2831853) * 43758.5453, j = (h - Math.floor(h) - .5) * 2 * p.jag * Math.sin(u * Math.PI); x += nx * j; y += ny * j; }
                // 꼬리는 가늘게 시작해 머리 쪽으로 굵어지고, 맨 앞에서 다시 뾰족해진다.
                const half = p.width * .5 * (p.shapeFn ? p.shapeFn(u) : Math.pow(Math.sin(Math.min(1, u / (1 - p.taper * .5)) * Math.PI * .5), .7) * (u > 1 - p.taper ? Math.sqrt(Math.max(0, (1 - u) / p.taper)) : 1));
                const ax = x + nx * half, ay = y + ny * half, bx = x - nx * half, by = y - ny * half, o = i * 8;
                stripData[o] = mirror ? 2 * axis - ax : ax; stripData[o + 1] = ay; stripData[o + 2] = u; stripData[o + 3] = 0;
                stripData[o + 4] = mirror ? 2 * axis - bx : bx; stripData[o + 5] = by; stripData[o + 6] = u; stripData[o + 7] = 1;
            }
            bound = prog; gl.useProgram(prog.p);
            gl.bindBuffer(gl.ARRAY_BUFFER, live.strip);
            gl.bufferData(gl.ARRAY_BUFFER, stripData.subarray(0, (n + 1) * 8), gl.DYNAMIC_DRAW);
            gl.enableVertexAttribArray(prog.a.Pos); gl.vertexAttribPointer(prog.a.Pos, 2, gl.FLOAT, false, 16, 0);
            gl.enableVertexAttribArray(prog.a.Uv); gl.vertexAttribPointer(prog.a.Uv, 2, gl.FLOAT, false, 16, 8);
            fxUniforms(prog, node, mirror);
            gl.uniform2f(prog.u.Res, W, H);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, (n + 1) * 2);
            gl.disableVertexAttribArray(prog.a.Uv);
        }

        function step(dt) {
            if (timers.length) {
                const due = timers.filter(timer => timer.t <= now);
                if (due.length) { timers = timers.filter(timer => timer.t > now); due.forEach(timer => timer.fn()); }
            }
            let alive = 0;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (now < node.born) { nodes[alive++] = node; continue; }
                const tracks = node.tr;
                for (let j = 0; j < tracks.length; j++) {
                    const k = tracks[j];
                    if (now < k.t0) continue;
                    if (k.from === undefined) k.from = node.p[k.key];
                    const t = k.d <= 0 ? 1 : clamp((now - k.t0) / k.d);
                    node.p[k.key] = k.from + (k.to - k.from) * k.ease(t);
                    if (t >= 1) { tracks.splice(j, 1); j--; }
                }
                if (node.fn) node.fn(node.p, now - node.born, dt, node);
                const dead = node.dead || (node.die != null ? now >= node.die : !node.p.keep && !tracks.length && now >= node.cur);
                if (dead) { if (node.p.keep) keepers--; node.gone = true; continue; }
                nodes[alive++] = node;
            }
            nodes.length = alive;
        }
        const drawList = [], byDepth = (a, b) => a.p.z - b.p.z || a.seq - b.seq;
        function draw() {
            if (lost) return;
            resize();
            gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
            drawList.length = 0;
            let sorted = true, prev = null;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (now < node.born) continue;
                if (prev && (prev.p.z > node.p.z || prev.p.z === node.p.z && prev.seq > node.seq)) sorted = false;
                drawList.push(node); prev = node;
            }
            if (!sorted) drawList.sort(byDepth);
            // 입자는 두 겹으로 그린다: 그림 뒤(z 0 앞)와 그림 앞(z 6 뒤).
            let layer = 0;
            for (let i = 0; i < drawList.length; i++) {
                const node = drawList[i], kind = node.kind;
                while (layer < 2 && node.p.z >= (layer ? 6.5 : 0)) drawParticles(layer++);
                if (kind === 'sprite') drawSprite(node);
                else if (kind === 'shape') drawShape(node);
                else if (kind === 'field') drawField(node);
                else if (kind === 'trail') drawTrail(node);
                else if (kind === 'matter') drawMatter(node);
                else if (kind === 'lens') drawLens(node);
            }
            while (layer < 2) drawParticles(layer++);
            applyCamera();
        }
        const busy = () => nodes.length > 0 || timers.length > 0 || camera.amp > 0 || camera.zoom > 0 || !!live.particles && now < Math.max(live.particles.end[0], live.particles.end[1]);
        function frame(real) {
            raf = 0;
            const elapsed = Math.max(0, (real - lastReal) / 1000), dtReal = Math.min(.05, elapsed);
            lastReal = real;
            // 프레임이 계속 밀리는 기기에서는 해상도와 입자 수를 절반으로 낮춘다. 창이 가려져 멈췄던 프레임은 세지 않는다.
            if (quality === 1 && elapsed < .12) { slow = slow * .96 + (elapsed > .03 ? .04 : 0); if (slow > .6) quality = .5; }
            const dt = real < frozenUntil || pauseAt != null && now >= pauseAt ? 0 : dtReal;
            now += dt;
            step(dt);
            draw();
            if (busy() && !document.hidden) raf = requestAnimationFrame(frame);
            else if (!busy() && !lost) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); applyCamera(); }
        }
        function kick() { if (!raf && !document.hidden) { lastReal = performance.now(); raf = requestAnimationFrame(frame); } }

        // ---- 재생 ----
        const point = value => ({ x: Number(value.x) * W, y: Number(value.y) * H });
        function context(effectId, options) {
            resize();
            const o = options || {}, src = point(o.src || o.dst), dst = point(o.dst || o.src);
            const mirror = dst.x < src.x - 1, axis = (src.x + dst.x) / 2;
            const A = mirror ? { x: 2 * axis - src.x, y: src.y } : src, T = mirror ? { x: 2 * axis - dst.x, y: dst.y } : dst;
            const half = (o.bodyHeight == null ? .36 : o.bodyHeight) * U / 2;
            return {
                id: effectId, A, T, mirror, axis, gA: A.y + (o.srcHalf == null ? half : o.srcHalf * U), gT: T.y + (o.dstHalf == null ? half : o.dstHalf * U),
                role: o.role === 'actor' ? 'actor' : 'target', event: o.event, hit: o.hit, minor: !!o.minor, silent: !!o.silent,
                tone: o.tone, scale: o.scale || 1, tags: o.tags || {}, seed: (sequence * 7.13 + (o.seed || 0)) % 997
            };
        }
        function run(effectId, options, delay) {
            const definition = definitions.get(effectId) || (fallback && fallback(effectId));
            if (!definition) return null;
            const ctx = context(effectId, options), startAt = now + (delay || 0);
            const S = stage(ctx, startAt);
            const needs = (definition.images || [effectId]).filter(Boolean).map(id => image(id));
            const begin = () => { try { definition.run(S); } catch (error) { console.warn('[combat-fx]', effectId, error); } kick(); };
            const pending = needs.filter(entry => !entry.ready && !entry.failed);
            if (!pending.length) begin();
            else {
                // 그림이 아직 오지 않았으면 잠깐 기다린다. 너무 늦으면 그 장면은 건너뛴다.
                let left = pending.length;
                const started = performance.now();
                pending.forEach(entry => entry.waiting.push(() => { if (--left === 0 && performance.now() - started < 900) { const fresh = stage(ctx, Math.max(now, startAt)); fresh.late = true; try { definition.run(fresh); } catch (error) { console.warn('[combat-fx]', effectId, error); } kick(); } }));
            }
            return definition;
        }
        // 한 사건의 이펙트 묶음을 재생한다. 가장 무게 있는 것 하나가 주 장면, 나머지는 작은 곁장면이다.
        // 돌려주는 delay(ms)는 주 장면이 대상에 닿는 순간이다. 호스트는 그때 수치와 피격 반응을 낸다.
        const resolve = effectId => definitions.get(effectId) || (fallback && fallback(effectId)) || null;
        // 주 장면이 대상에 닿을 시각. 같은 사건(같은 스킬이나 출처)의 이어지는 타격만 그 순간에 맞춰 터뜨린다.
        const staged = { until: 0, x: -1, key: '', hits: null, cast: 0 };
        // 장면의 길이(다시 시작하지 않을 시간)와, 전투를 멈춰 둘 시간.
        const span = definition => definition ? (definition.dur != null ? definition.dur : Math.max(definition.impact || 0, definition.hits ? definition.hits[definition.hits.length - 1] : 0) + .7) : .7;
        const castOf = definition => definition ? (definition.cast != null ? definition.cast : Math.max(definition.impact || 0, definition.hits ? definition.hits[definition.hits.length - 1] : 0) + .22) : 0;
        const eventKey = event => event ? String(event.skillName || event.source || event.action || '') : '';
        function play(effectIds, options) {
            const o = options || {}, real = performance.now(), after = Math.max(0, Number(o.after) || 0) / 1000;
            if (recent.size > 160) recent.forEach((until, token) => { if (real > until + 3000) recent.delete(token); });
            const role = o.role === 'actor' ? 'actor' : 'target', anchor = role === 'actor' ? o.src || o.dst : o.dst || o.src;
            const ids = Array.from(new Set((effectIds || []).filter(Boolean))).filter(effectId => {
                const own = effectId.startsWith('skill:') || effectId.startsWith('summon:');
                const token = (own ? '' : role + ':' + Math.round(Number(anchor.x) * 16) + ':') + effectId;
                if (real < (recent.get(token) || 0)) return false;
                const definition = resolve(effectId);
                // 여러 번 맞는 스킬은 타수마다 다시 불린다. 장면이 끝날 때까지는 다시 시작하지 않는다.
                recent.set(token, real + (o.cool != null ? o.cool : own ? after * 1000 + span(definition) * 1000 : 520));
                return true;
            });
            const ranked = (catalog && catalog.presentationEffectIds ? catalog.presentationEffectIds(ids, o.limit || 3) : ids.slice(0, o.limit || 3)).filter(resolve);
            const lead = ranked.length ? resolve(ranked[0]).impact || 0 : 0, target = Number((o.dst || o.src).x);
            // 앞선 주 장면이 아직 대상에 닿지 않았으면, 뒤따르는 치명타나 속성 같은 곁장면은 그 순간에 맞춰 터뜨린다.
            const key = eventKey(o.event), waits = role === 'target' && real < staged.until && Math.abs(target - staged.x) < .08 && key === staged.key ? (staged.until - real) / 1000 : 0;
            // after(ms): 궁극기 컷씬처럼 먼저 보여줄 것이 있으면 그만큼 뒤에 장면을 시작한다.
            const base = Math.max(waits ? 0 : after, waits - lead);
            let sounded = false, count = 0;
            ranked.forEach((effectId, index) => {
                const minor = index > 0 || !!o.minor || waits > 0;
                if (minor && nodes.length > 220) return;
                const own = resolve(effectId).impact || 0;
                const delay = !index ? base : role === 'target' ? Math.max(0, base + lead - own) + index * .03 : base + .06 + index * .09;
                if (!run(effectId, Object.assign({}, o, { minor, seed: index * 31 }), delay)) return;
                count++;
                if (!index) sounded = resolve(effectId).sound !== false;
            });
            // 이미 재생 중이라 건너뛴 경우에도, 앞선 주 장면이 닿을 때까지 남은 시간을 알려 준다.
            const delay = count ? Math.round((base + lead) * 1000) : Math.round(Math.max(waits, 0) * 1000);
            const main = count && ranked.length ? resolve(ranked[0]) : null;
            if (count && !waits && lead > .12) { staged.until = real + delay; staged.x = target; staged.key = key; staged.hits = main && main.hits ? main.hits.map(t => real + (base + t) * 1000) : null; staged.cast = real + (base + castOf(main)) * 1000; }
            kick();
            // hits: 타수마다 수치를 낼 시각(ms). cast: 이 장면이 끝나 전투를 다시 흘려도 되는 시각(ms). 이미 재생 중이면 앞선 장면의 것을 돌려준다.
            const joined = !count && waits > 0 || count && waits > 0;
            const hits = joined ? (staged.hits ? staged.hits.map(at => Math.max(0, Math.round(at - real))) : null) : main && main.hits ? main.hits.map(t => Math.round((base + t) * 1000)) : null;
            const cast = joined ? Math.max(0, Math.round(staged.cast - real)) : main ? Math.round((base + castOf(main)) * 1000) : 0;
            return { delay, sound: sounded, count, hits, cast };
        }
        // 소환수처럼 계속 남는 장면. 돌려받은 손잡이로 끝낸다.
        function persist(effectId, options, runner) {
            const ctx = context(effectId, options), S = stage(ctx, now);
            S.live = true;
            const handle = { S, stop() { S.scene.stopped = true; S.scene.nodes.forEach(node => { node.dead = true; }); kick(); } };
            const needs = (options.images || [effectId]).map(id => image(id)), pending = needs.filter(entry => !entry.ready && !entry.failed);
            const begin = () => { if (!S.scene.stopped) { runner(S, handle); kick(); } };
            if (!pending.length) begin();
            else { let left = pending.length; pending.forEach(entry => entry.waiting.push(() => { if (--left === 0) begin(); })); }
            return handle;
        }
        function warm(effectId) {
            const entry = image(effectId);
            const build = () => {
                if (!entry.ready || lost) return;
                tone(entry);
                const spec = parts.get(effectId);
                if (spec) Object.keys(spec).concat('~rest').forEach(name => { const piece = part(effectId, name); if (name !== '~rest') points(piece); });
                else points(entry);
            };
            const later = () => root.requestIdleCallback ? root.requestIdleCallback(build, { timeout: 1500 }) : setTimeout(build, 200);
            if (entry.ready) later(); else if (!entry.failed) entry.waiting.push(ok => { if (ok) later(); });
        }
        function preload(effectIds, sounds) {
            (effectIds || []).forEach(effectId => {
                const definition = definitions.get(effectId) || (fallback && fallback(effectId));
                ((definition && definition.images) || [effectId]).forEach(warm);
                if (definition && definition.sounds) definition.sounds.forEach(loadSound);
            });
            (sounds || []).forEach(loadSound);
        }
        function clear() {
            nodes.forEach(node => { node.dead = true; }); nodes = []; timers = []; keepers = 0; camera.amp = 0; camera.zoom = 0; poses.length = 0;
            if (live.particles) { live.particles.f.fill(0); live.particles.lo = 0; live.particles.hi = PARTICLE_CAP - 1; live.particles.end = [0, 0, 0]; }
            gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); applyCamera();
        }
        function onVisibility() { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else kick(); }
        document.addEventListener('visibilitychange', onVisibility);
        function destroy() {
            clear(); cancelAnimationFrame(raf);
            document.removeEventListener('visibilitychange', onVisibility);
            root.removeEventListener('pointerdown', onGesture); root.removeEventListener('keydown', onGesture);
            canvas.remove();
        }
        resize();
        // 셰이더는 처음 쓰일 때 컴파일하지만, 그 순간의 끊김을 없애려고 한가한 틈에 하나씩 미리 만들어 둔다.
        (function warmShaders() {
            const names = Array.from(shaderBodies.keys());
            let index = -2;
            const idle = fn => root.requestIdleCallback ? root.requestIdleCallback(fn, { timeout: 2500 }) : setTimeout(fn, 120);
            const next = () => {
                if (lost || !canvas.isConnected) return;
                try { if (index === -2) noiseTexture(); else if (index === -1) particleStore(); else fxProgram(names[index]); } catch (_) { return; }
                if (++index < names.length) idle(next);
            };
            setTimeout(() => idle(next), 900);
        })();
        const instance = {
            canvas, play, persist, preload, clear, destroy, sound, unlock, shake, hitstop, loadSound, kick, pose,
            get time() { return now; }, get unit() { return U; }, get size() { return { W, H }; },
            get busy() { return busy(); }, get count() { return nodes.length; },
            // 검증용: 지금부터 seconds 뒤의 화면에서 시간을 멈춘다. null이면 다시 흐른다.
            freezeAfter(seconds) { pauseAt = seconds == null ? null : now + seconds; kick(); }
        };
        return instance;
    }

    const api = {
        create, EASE, SHAPE, MATTER, soundHits: {},
        // 장면 등록. meta: { impact: 타격 시각(초), images: 필요한 그림들, sounds: 미리 받을 소리들 }
        define(effectId, meta, run) { definitions.set(effectId, Object.assign({ run }, meta)); },
        parts(effectId, spec) { parts.set(effectId, spec); },
        partSpecs: () => parts,
        // 그림 파일 없이 캔버스에 직접 그려 쓰는 텍스처. draw(ctx, width, height)
        paint(id, width, height, draw) { painters.set(id, { width, height, draw }); },
        // 절차 셰이더 등록. 이름이 'trail:'로 시작하면 리본용, 'lens:'로 시작하면 화면 렌즈용이다.
        shader(name, body) { shaderBodies.set(name, body); },
        shaders: () => shaderBodies,
        atlas(painter) { atlasPainter = painter; },
        CELL,
        fallback(fn) { fallback = fn; },
        defined: effectId => definitions.has(effectId),
        resolve: effectId => definitions.get(effectId) || (fallback && fallback(effectId)) || null
    };
    if (typeof module == 'object' && module.exports) module.exports = api;
    else root.CombatFX = api;
})(typeof globalThis != 'undefined' ? globalThis : this);
