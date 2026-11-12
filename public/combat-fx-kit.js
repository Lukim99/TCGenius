// 전투 연출 재료집. 그림 없이 실시간으로 계산하는 재료(불, 구체, 광선, 충격파, 소용돌이, 마법진, 균열, 결정, 번개, 참격 궤적,
// 화면 렌즈)의 셰이더와, 장면이 그것들을 한 줄로 부르는 도우미를 모아 둔다. 엔진(combat-fx.js) 다음, 장면집보다 먼저 싣는다.
(function (root) {
    'use strict';
    const F = typeof module == 'object' && module.exports ? require('./combat-fx.js') : root.CombatFX;
    if (!F) return;
    const PI = Math.PI, TAU = PI * 2;
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    // ---- 면 셰이더: vec4 fx(vec2 uv). uv는 왼쪽 위가 (0,0)이다. heat(h)는 uColor2 → uColor → 흰색으로 달아오르는 색이다. ----
    // 불기둥. 아래에서 위로 타오른다. p0 굵기, p1 오르는 속도, p2 높이(0~1), p3 갈라짐.
    F.shader('flame', `vec4 fx(vec2 uv){
  float y=1.-uv.y,x=(uv.x-.5)*2.;
  vec2 p=vec2(x*1.6,y*2.2-uTime*uP.y);
  float n=fbm(p*2.+uSeed*7.),n2=noise(p*3.7+uSeed*3.+9.);
  float w=mix(.82,.1,pow(y/max(uP.z,.01),.85))*uP.x;
  float d=abs(x+(n2-.5)*.55*y)+(n-.5)*(.34+uP.w)*(.35+y);
  float body=1.-smoothstep(w*.3,w,d);
  float h=body*(1.-smoothstep(uP.z*.5,uP.z,y+(n-.5)*.5))*smoothstep(0.,.06,y);
  float lick=smoothstep(.5,.8,n)*h;
  return vec4(heat(clamp(pow(h,1.5)*(1.-y*.72)-lick*.2,0.,1.)),h);
}`);
    // 기운의 구체. p0 반지름(0~.5 권장), p1 소용돌이 속도, p2 전류, p3 테두리의 거칠기.
    F.shader('orb', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),R=max(uP.x,.001);
  vec2 p=rot2(uTime*uP.y+r*3.5)*q;
  float sw=fbm(p*3.2/max(R*2.,.2)+uSeed*9.);
  float edge=r+(sw-.5)*(.1+uP.w)*R*2.;
  float body=1.-smoothstep(R*.72,R,edge);
  float rim=smoothstep(R*.5,R*.95,r)*body;
  float core=pow(max(0.,1.-r/(R*.62)),2.);
  float glow=pow(max(0.,1.-r/min(1.,R*2.2)),2.4)*.75;
  float arcs=smoothstep(.66,.74,noise(rot2(-uTime*3.)*q*7./max(R*2.,.2)+uTime*2.))*body*uP.z;
  float h=clamp(body*(.25+sw*.55)+rim*.45+core+arcs,0.,1.);
  return vec4(heat(max(h,glow*.5)),clamp(max(body*.94,glow)+core,0.,1.));
}`);
    // 광선. 왼쪽에서 오른쪽으로 뻗는다(면을 돌려 방향을 잡는다). p0 머리(0~1), p1 꼬리(0~1), p2 굵기(0~1), p3 결의 속도.
    F.shader('beam', `vec4 fx(vec2 uv){
  float y=abs(uv.y-.5)*2.;
  float m=smoothstep(uP.y,uP.y+.1,uv.x)*(1.-smoothstep(uP.x-.1,uP.x,uv.x));
  float n=fbm2(vec2(uv.x*5.-uTime*(6.+uP.w),uv.y*4.+uSeed*5.));
  float w=uP.z*(.72+n*.56);
  float core=1.-smoothstep(w*.16,w*.4,y);
  float body=1.-smoothstep(w*.38,w,y);
  float haze=pow(max(0.,1.-y),3.)*.3;
  float st=smoothstep(.5,.92,noise(vec2(uv.x*13.-uTime*(20.+uP.w*2.),uv.y*16.)))*body*.55;
  float tip=smoothstep(uP.x-.12,uP.x,uv.x)*body*.6;
  return vec4(heat(clamp(body*.42+core*.7+st+tip,0.,1.)),clamp(body+haze,0.,1.)*m);
}`);
    // 충격파 고리. p0 반지름(0~1), p1 두께, p2 먼지의 양.
    F.shader('shock', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x),d=r-uP.x;
  float n=fbm2(q*2.4+uSeed*9.);
  float front=1.-smoothstep(0.,uP.y*.3,abs(d));
  float spoke=smoothstep(.25,.95,sin(a*9.+uSeed*30.)*sin(a*17.-uSeed*13.)*.5+.5+(n-.5)*.8);
  float tail=smoothstep(-uP.y*2.6,0.,d)*step(d,0.)*(.25+.75*spoke);
  float brk=mix(1.,smoothstep(.3,.62,n+.18*sin(a*4.+uSeed*17.)),uP.w);
  float al=(front+tail*uP.z)*brk*smoothstep(1.,.93,r);
  return vec4(heat(clamp(front+tail*.4,0.,1.)),al);
}`);
    // 소용돌이. p0 감김, p1 팔 수, p2 도는 속도, p3 가운데 구멍.
    F.shader('vortex', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x);
  float s=sin(a*uP.y+log(r+.03)*uP.x*4.-uTime*uP.z);
  float n=fbm2(rot2(uTime*uP.z*.3+r*uP.x)*q*3.+uSeed*4.);
  float arm=smoothstep(.05,.95,s*.5+.5)*(.5+n*.8);
  float fall=smoothstep(1.,.3,r)*smoothstep(uP.w,uP.w+.16,r);
  float core=uP.w>0.?0.:pow(max(0.,1.-r/.28),2.);
  float h=clamp(arm*fall*1.15+core,0.,1.);
  return vec4(heat(h*.72),h);
}`);
    // 검은 구멍. 어두운 원반과 그 둘레를 도는 빛. 보통 섞기(add 0)로 쓴다. p0 사건의 지평선 반지름, p1 고리의 밝기.
    F.shader('hole', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),R=max(uP.x,.001);
  float disc=1.-smoothstep(R*.9,R,r);
  vec2 p=rot2(uTime*2.2+1.6/(r+.15))*q;
  float n=fbm2(p*4.+uSeed*3.);
  float k=(r-R*1.3)/(R*.34);
  float ring=exp(-k*k)*(.45+n*1.1)*uP.y;
  float wisp=smoothstep(.55,.9,n)*smoothstep(1.,R*1.2,r)*smoothstep(R,R*1.6,r)*.5*uP.y;
  float halo=pow(max(0.,1.-r),3.)*.35;
  return vec4(heat(clamp(ring+wisp,0.,1.))*(1.-disc),clamp(disc+ring+wisp+halo,0.,1.));
}`);
    // 마법진. p0 그려지는 정도(0~1), p1 안쪽 별의 각 수, p2 도는 속도, p3 선의 굵기.
    F.shader('circle', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x),t=uTime*uP.z;
  float ang=fract((a+3.14159)/6.28318+.25),show=smoothstep(ang-.03,ang,uP.x*1.04);
  float lw=.014+uP.w,line=0.;
  line+=1.-smoothstep(0.,lw,abs(r-.93));
  line+=1.-smoothstep(0.,lw*.7,abs(r-.85));
  line+=1.-smoothstep(0.,lw,abs(r-.55));
  float tk=abs(fract((a+t)*3.8197)-.5);
  line+=(1.-smoothstep(.08,.14,tk))*step(.85,r)*step(r,.93)*.8;
  vec2 g=vec2((a-t*.6)*5.7296,(r-.63)/.15),gi=floor(g),gf=fract(g);
  vec4 hs=texture2D(uNoise,(gi+.5+uSeed*31.)/256.);
  float stem=(1.-smoothstep(.05,.11,abs(gf.x-.25-hs.g*.5)))*step(.15,gf.y)*step(gf.y,.85);
  float span=step(.2,gf.x)*step(gf.x,.8);
  float bars=(1.-smoothstep(.05,.11,abs(gf.y-.2-hs.b*.25)))*span+(1.-smoothstep(.05,.11,abs(gf.y-.6-hs.a*.25)))*span*step(hs.r,.6);
  float glyph=clamp(stem+bars,0.,1.)*step(.25,hs.r)*step(0.,g.y)*step(g.y,1.);
  vec2 pq=rot2(-t*.8)*q;float pa=atan(pq.y,pq.x),seg=6.28318/max(uP.y,3.),pr=length(pq);
  float d1=cos(floor(.5+pa/seg)*seg-pa)*pr,pb=pa+seg*.5,d2=cos(floor(.5+pb/seg)*seg-pb)*pr;
  float poly=((1.-smoothstep(0.,lw,abs(d1-.38)))+(1.-smoothstep(0.,lw,abs(d2-.38))))*step(r,.55);
  float al=clamp(line+glyph*.9+poly,0.,1.)*show;
  float glow=pow(max(0.,1.-abs(r-.72)*2.4),2.)*.2*show;
  return vec4(heat(clamp(al*.75+.25,0.,1.)),al+glow);
}`);
    // 바닥의 균열. 가운데에서 갈라져 나간다. p0 번진 정도(0~1), p1 갈래 수, p2 틈의 빛.
    F.shader('crack', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x);
  float n=fbm2(q*2.6+uSeed*9.),n2=noise(q*7.+uSeed*5.);
  float aa=a+(n-.5)*1.5+(n2-.5)*.3;
  float k=abs(fract(aa*uP.y/6.28318+uSeed)-.5)*2.;
  float w=.11*(1.-r*.75)+.012;
  float line=1.-smoothstep(w*.25,w,k*(r+.12));
  float reach=1.-smoothstep(uP.x*.75,uP.x,r+(n-.5)*.25);
  float pit=(1.-smoothstep(0.,.16*uP.x,r));
  float h=clamp(max(line,pit)*reach,0.,1.);
  float glow=pow(h,.6)*uP.z;
  return vec4(heat(clamp(h*.3+glow*.34,0.,1.)),h*(.75+uP.z*.25)+pow(max(0.,1.-r/max(uP.x,.01)),2.)*.2*uP.z);
}`);
    // 연기와 먼지. 보통 섞기로 쓴다. p0 짙기, p1 오르는 속도, p2 흩어진 정도(0~1).
    F.shader('smoke', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q);
  float n=fbm(q*2.+vec2(0.,uTime*uP.y)+uSeed*11.);
  float a=smoothstep(1.,.15,r+(n-.5)*1.)*smoothstep(.2+uP.z*.5,.7+uP.z*.3,n);
  return vec4(mix(uColor2,uColor.rgb,n),a*uP.x);
}`);
    // 방사하는 빛줄기. p0 굵은 줄기의 수, p1 도는 속도, p2 날카로움(0~1), p3 안쪽 반지름.
    F.shader('rays', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x);
  float s=sin(a*uP.x+uTime*uP.y+uSeed*5.)*.5+sin(a*(uP.x*2.+3.)-uTime*uP.y*1.7+uSeed*3.)*.3+sin(a*(uP.x*4.+1.)+uTime*uP.y*.6)*.2;
  float ray=smoothstep(uP.z-.5,1.,s+.5);
  float fall=pow(max(0.,1.-r),1.6)*smoothstep(uP.w,uP.w+.12,r);
  float core=pow(max(0.,1.-r/.34),2.5);
  float h=clamp(ray*fall+core,0.,1.);
  return vec4(heat(h),h);
}`);
    // 솟는 기운의 기둥(강화, 변신). p0 높이(0~1), p1 오르는 속도, p2 줄기의 굵기.
    F.shader('aura', `vec4 fx(vec2 uv){
  float x=(uv.x-.5)*2.,y=1.-uv.y;
  float n=fbm2(vec2(x*2.6+uSeed*5.,y*1.8-uTime*uP.y));
  float st=noise(vec2(x*(7.+uP.z*6.)+uSeed*3.,y*1.3-uTime*uP.y*1.9));
  float env=(1.-smoothstep(.3,1.,abs(x)+(n-.5)*.3))*smoothstep(0.,.08,y)*(1.-smoothstep(uP.x*.45,uP.x,y+(n-.5)*.3));
  float h=clamp((n*.7+smoothstep(.3,.95,st)*.55)*env,0.,1.);
  return vec4(heat(h*.85),h);
}`);
    // 솟아오르는 결정(얼음, 보석). p0 자란 높이(0~1), p1 밑동의 굵기, p2 기울기, p3 반짝임.
    F.shader('crystal', `vec4 fx(vec2 uv){
  float y=1.-uv.y,x=(uv.x-.5)*2.-uP.z*y;
  float g=max(uP.x,.001),k=clamp(y/g,0.,1.);
  float w=uP.y*(1.-pow(k,1.25));
  float inside=(1.-smoothstep(w-.02,w,abs(x)))*step(y,g)*smoothstep(0.,.02,y);
  float side=x<0.?.62:1.;
  float ridge=1.-smoothstep(0.,.03,abs(x+w*.2));
  float band=.75+.25*sin(y*26.+x*9.+uSeed*5.);
  float n=noise(vec2(x*5.+uSeed*7.,y*9.-uTime*.6));
  float glint=smoothstep(.72,.9,n)*uP.w+pow(max(0.,1.-abs(k-fract(uTime*.9+uSeed))*6.),2.)*uP.w*.7;
  float rim=smoothstep(w-.09,w,abs(x));
  float h=clamp(side*band*.55+ridge*.5+rim*.4+glint,0.,1.);
  return vec4(heat(h),inside*(.82+rim*.18));
}`);
    // 떨어지는 유성의 머리(혜성). 오른쪽이 머리다. p0 꼬리 길이, p1 흔들림.
    F.shader('comet', `vec4 fx(vec2 uv){
  float x=uv.x,y=(uv.y-.5)*2.,t=.86-x;
  float n=fbm2(vec2(x*5.+uTime*9.,y*2.6+uSeed*5.));
  float w=.62*exp(-max(t,0.)*2.4)+.03;
  float body=(1.-smoothstep(w*.15,w,abs(y)+(n-.5)*.5*max(t,0.)))*smoothstep(0.,.3,x-(1.-uP.x))*step(0.,t);
  vec2 hq=vec2((x-.84)*2.6,y);float head=exp(-dot(hq,hq)*7.);
  float h=clamp(body*(.12+.75*exp(-max(t,0.)*3.2)+n*.3*uP.y)+head*1.1,0.,1.);
  return vec4(heat(h),clamp(body*(1.-max(t,0.)*.6)+head,0.,1.));
}`);

    // ---- 리본 셰이더: uv.x는 꼬리(0)에서 머리(1), uv.y는 폭 방향(0~1). p0 결의 촘촘함, p1 흐르는 속도, p2 꼬리의 사라짐. ----
    F.shader('trail:energy', `vec4 fx(vec2 uv){
  float y=abs(uv.y-.5)*2.;
  float n=fbm2(vec2(uv.x*uP.x-uTime*uP.y,uv.y*2.5+uSeed*7.));
  float body=1.-smoothstep(.2+n*.55,1.,y),core=1.-smoothstep(0.,.3,y),fade=pow(uv.x,uP.z);
  return vec4(heat(clamp(body*(.28+n*.5)+core*.8,0.,1.)*fade),clamp(body+core,0.,1.)*fade);
}`);
    // 참격. 바깥날(uv.y=0)이 날카롭고 안쪽으로 결이 풀린다.
    F.shader('trail:slash', `vec4 fx(vec2 uv){
  float y=uv.y,n=noise(vec2(uv.x*uP.x*3.-uTime*uP.y,y*4.+uSeed*3.));
  float edge=1.-smoothstep(0.,.16,y),body=(1.-smoothstep(.1,1.,y+(n-.5)*.5))*(.55+n*.45),fade=pow(uv.x,uP.z);
  return vec4(heat(clamp(edge*.9+body*.62,0.,1.)),clamp(edge+body,0.,1.)*fade);
}`);
    F.shader('trail:bolt', `vec4 fx(vec2 uv){
  float y=abs(uv.y-.5)*2.,core=1.-smoothstep(.1,.34,y),glow=pow(max(0.,1.-y),2.2)*.8;
  float flick=.65+.35*noise(vec2(uTime*31.+uSeed*9.,uv.x*5.)),ends=smoothstep(0.,.04,uv.x)*smoothstep(1.,.96,uv.x);
  return vec4(heat(clamp(core+glow*.6,0.,1.)),(core+glow)*flick*ends);
}`);
    // 물줄기. 거품 낀 가장자리와 반짝이는 결.
    F.shader('trail:water', `vec4 fx(vec2 uv){
  float y=abs(uv.y-.5)*2.,n=fbm2(vec2(uv.x*uP.x-uTime*uP.y,uv.y*3.+uSeed*7.));
  float body=1.-smoothstep(.55+n*.3,1.,y),foam=smoothstep(.45,.9,y+(n-.5)*.6)*body;
  float glint=smoothstep(.72,.86,noise(vec2(uv.x*uP.x*2.4-uTime*uP.y*1.6,uv.y*7.)))*(1.-y);
  float fade=pow(uv.x,uP.z);
  return vec4(heat(clamp(.3+foam*.5+glint*.8+(1.-y)*.15,0.,1.)),clamp(body*.85+glint,0.,1.)*fade);
}`);
    // 사슬. 고리가 번갈아 정면과 옆으로 이어진다. p0 고리 수.
    F.shader('trail:chain', `vec4 fx(vec2 uv){
  float g=uv.x*uP.x-uTime*uP.y,i=floor(g);vec2 l=vec2(fract(g)-.5,uv.y-.5);
  float odd=mod(i,2.);
  float ringd=abs(length(vec2(l.x*1.25,l.y*2.3))-.42),face=1.-smoothstep(.07,.13,ringd);
  float sidev=(1.-smoothstep(.1,.16,abs(l.y)))*(1.-smoothstep(.44,.5,abs(l.x)));
  float link=mix(face,sidev,odd);
  float shade=.55+.45*(1.-smoothstep(0.,.5,abs(l.y+.12)));
  float fade=pow(uv.x,uP.z);
  return vec4(heat(clamp(link*shade,0.,1.)),link*fade);
}`);
    // 먹빛 궤적(어둠, 피). 보통 섞기로 쓴다: 어두운 몸과 빛나는 가장자리.
    F.shader('trail:ink', `vec4 fx(vec2 uv){
  float y=abs(uv.y-.5)*2.,n=fbm2(vec2(uv.x*uP.x-uTime*uP.y,uv.y*3.+uSeed*7.));
  float body=1.-smoothstep(.5+n*.4,.95,y),rim=smoothstep(.35,.8,y+(n-.5)*.4)*body,fade=pow(uv.x,uP.z);
  return vec4(mix(uColor2*.25,uColor.rgb,rim),body*fade);
}`);

    // ---- 렌즈 셰이더: 전투 화면을 찍은 그림(scene)을 일그러뜨린다. uQ = (초점 x, 초점 y, 각도, 화면비). 곱해진 알파를 돌려준다. ----
    // 퍼지는 충격파가 화면을 굴절시킨다. p0 반지름, p1 폭, p2 세기, p3 물마루의 빛.
    F.shader('lens:ripple', `vec4 fx(vec2 uv){
  vec2 d=uv-uQ.xy;d.x*=uQ.w;float r=length(d),k=(r-uP.x)/max(uP.y,.001),f=exp(-k*k)*uP.z;
  vec2 dir=d/(r+.0001);dir.x/=uQ.w;
  vec4 c=scene(uv-dir*f*(k<0.?1.:-.5));
  c.rgb+=uColor2*f*uP.w*c.a;
  return c*smoothstep(.0004,.004,f);
}`);
    // 화면을 한 줄로 베어 두 쪽을 어긋나게 민다. p0 어긋남, p1 벤 자리의 폭, p2 벤 자리의 빛, p3 벌어진 틈. color[0]은 베이는 범위의 반지름(0이면 화면 전체).
    F.shader('lens:slice', `vec4 fx(vec2 uv){
  vec2 d=uv-uQ.xy;d.x*=uQ.w;vec2 t=vec2(cos(uQ.z),sin(uQ.z));
  float side=dot(d,vec2(-t.y,t.x)),s=side<0.?-1.:1.;
  float near=uColor.r>0.?1.-smoothstep(uColor.r*.55,uColor.r,length(d)):1.;
  vec2 off=(t*uP.x+vec2(-t.y,t.x)*uP.w)*s*near;off.x/=uQ.w;
  vec4 c=scene(uv-off);
  float gap=1.-smoothstep(uP.w*.6,uP.w+.0015,abs(side));
  c=mix(c,vec4(uColor2,1.),gap*step(.0001,uP.w));
  float seam=1.-smoothstep(0.,max(uP.y,.0005),abs(abs(side)-uP.w));
  c.rgb=mix(c.rgb,vec3(1.),seam*uP.z*near);
  return c*smoothstep(0.,.02,near);
}`);
    // 화면이 유리처럼 깨져 바깥으로 흩어진다. p0 흩어진 정도, p1 조각의 촘촘함, p2 조각의 틴트, p3 사라짐.
    // 렌즈의 color는 색이 아니라 여분의 숫자다: color[0]은 깨지는 범위의 반지름(화면 높이 기준, 0이면 화면 전체).
    F.shader('lens:shatter', `vec4 fx(vec2 uv){
  vec2 p=uv;p.x*=uQ.w;vec2 f0=vec2(uQ.x*uQ.w,uQ.y);
  vec2 P=f0+(p-f0)/(1.+uP.x*.6);
  vec2 g=P*uP.y,gi=floor(g),gf=fract(g);
  float best=9.,second=9.;vec4 id=vec4(0.);vec2 cen=vec2(0.);
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){
    vec2 o=vec2(float(i),float(j));vec4 h=texture2D(uNoise,(gi+o+.5+uSeed*17.)/256.);
    vec2 c=o+h.xy*.84+.08;float dd=length(c-gf);
    if(dd<best){second=best;best=dd;id=h;cen=(gi+c)/uP.y;}else if(dd<second)second=dd;
  }
  float edge=second-best,gapw=uP.x*(.1+id.z*.5);
  float vis=smoothstep(gapw,gapw+.03,edge)*(1.-smoothstep(.55,1.,uP.w+id.w*.5*uP.w));
  if(uColor.r>0.)vis*=1.-smoothstep(uColor.r*.7,uColor.r,length(cen-f0)+id.z*.06);
  vec2 away=cen-f0;float ang=(id.z-.5)*uP.x*1.6;
  vec2 loc=rot2(ang)*(P-cen)+cen-away*uP.x*(.25+id.w*.9)+vec2(0.,uP.x*uP.x*.22*(id.z-.3));
  loc.x/=uQ.w;
  vec4 c=scene(loc);
  c.rgb=mix(c.rgb,uColor2*c.a,uP.z*(.35+id.z*.5));
  c.rgb+=(1.-smoothstep(gapw+.02,gapw+.09,edge))*.55*c.a*(.4+id.w);
  return c*vis;
}`);
    // 한 점으로 빨려 들거나(p0 양수) 밀려난다(음수). p1 범위, p2 비틀림.
    F.shader('lens:pinch', `vec4 fx(vec2 uv){
  vec2 d=uv-uQ.xy;d.x*=uQ.w;float r=length(d),e=exp(-r*r/max(uP.y*uP.y,.0001));
  vec2 q=rot2(uP.z*e)*d*(1.+uP.x*e);q.x/=uQ.w;
  vec4 c=scene(uQ.xy+q);
  c.rgb*=1.-clamp(uP.x,0.,1.)*e*.5;
  return c*smoothstep(.002,.03,(abs(uP.x)+abs(uP.z))*e);
}`);
    // 세계의 색이 빠진다(시간 정지, 느와르). 초점에서 원으로 번진다. p0 번진 반지름, p1 무채색 정도, p2 반전, p3 대비.
    F.shader('lens:mono', `vec4 fx(vec2 uv){
  vec2 d=uv-uQ.xy;d.x*=uQ.w;float r=length(d);
  vec4 c=scene(uv);float l=dot(c.rgb,vec3(.3,.59,.11));
  l=clamp((l-.5*c.a)*(1.+uP.w)+.5*c.a,0.,c.a);
  vec3 g=mix(vec3(l),c.a-vec3(l),uP.z)*mix(vec3(1.),uColor2*1.6,.75);
  float m=1.-smoothstep(uP.x-.035,uP.x,r);
  float rim=smoothstep(uP.x-.05,uP.x-.01,r)*m;
  c.rgb=mix(c.rgb,g,uP.y)+rim*.6*c.a;
  return c*m;
}`);
    // 화면이 가로줄로 어긋나고 색이 갈라진다(전환, 고장). p0 어긋남, p1 줄의 수, p2 색 갈라짐.
    F.shader('lens:glitch', `vec4 fx(vec2 uv){
  float band=floor(uv.y*uP.y),tk=floor(uTime*22.);
  vec4 h=texture2D(uNoise,(vec2(band,tk)+.5+uSeed*13.)/256.);
  float off=(h.r-.5)*2.*uP.x*step(.55,h.g);
  vec2 u=uv+vec2(off,0.);
  vec4 c=scene(u);c.r=scene(u+vec2(uP.z,0.)).r;c.b=scene(u-vec2(uP.z,0.)).b;
  c.rgb+=step(.95,h.b)*.08*c.a;
  return c;
}`);
    // 초점을 향해 빨려 드는 방사형 번짐(돌진, 폭발). p0 세기.
    F.shader('lens:zoom', `vec4 fx(vec2 uv){
  vec2 d=uv-uQ.xy;vec4 acc=vec4(0.);
  for(int i=0;i<6;i++){acc+=scene(uv-d*uP.x*float(i)/6.);}
  acc/=6.;float r=length(d*vec2(uQ.w,1.));
  return acc*smoothstep(.01,.06,uP.x*r*8.);
}`);
    // 서리가 초점에서 번져 화면을 얼린다. p0 번진 반지름, p1 서리의 짙기.
    F.shader('lens:frost', `vec4 fx(vec2 uv){
  vec2 d=uv-uQ.xy;d.x*=uQ.w;float r=length(d);
  vec2 p=uv*vec2(uQ.w,1.)*9.,gi=floor(p),gf=fract(p);float best=9.,second=9.;
  for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 o=vec2(float(i),float(j));vec2 h=texture2D(uNoise,(gi+o+.5+uSeed*7.)/256.).xy;float dd=length(o+h-gf);if(dd<best){second=best;best=dd;}else if(dd<second)second=dd;}
  float vein=1.-smoothstep(0.,.07,second-best);
  float n=fbm2(uv*vec2(uQ.w,1.)*5.+uSeed*3.);
  float m=1.-smoothstep(uP.x-.12,uP.x,r+(n-.5)*.16);
  vec2 off=(vec2(best,second)-.5)*.012*m;
  vec4 c=scene(uv+off);float l=dot(c.rgb,vec3(.3,.59,.11));
  vec3 ice=mix(vec3(l)*uColor2*1.5,vec3(1.),vein*.7+pow(n,3.)*.5);
  c.rgb=mix(c.rgb,ice*c.a,uP.y*m);
  return c*m;
}`);

    // ---- 색 ----
    const C = {
        white: [1, 1, 1], fire: [1, .5, .12], ember: [.75, .1, .02], gold: [1, .8, .28], amber: [.85, .42, .05], blood: [.9, .08, .1], wine: [.3, 0, .04],
        ice: [.6, .88, 1], deep: [.1, .3, .9], aqua: [.25, .9, .95], sea: [.02, .25, .5], volt: [.7, .85, 1], violet: [.7, .35, 1], night: [.18, .05, .4],
        pink: [1, .5, .8], rose: [.8, .15, .45], leaf: [.45, 1, .4], moss: [.05, .4, .12], holy: [1, .93, .6], sun: [.9, .55, .1], ash: [.42, .4, .44], soot: [.1, .09, .12], bone: [.95, .92, .82]
    };
    const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const dark = (c, k) => [c[0] * (k == null ? .35 : k), c[1] * (k == null ? .35 : k), c[2] * (k == null ? .35 : k)];
    const lite = (c, k) => mix(c, C.white, k == null ? .5 : k);

    // ---- 경로 ----
    const path = {
        line: (x0, y0, x1, y1) => s => [lerp(x0, x1, s), lerp(y0, y1, s)],
        // 두 점 사이를 lift만큼 들어 올린 곡선
        bow: (x0, y0, x1, y1, lift, side) => { const mx = (x0 + x1) / 2 + (side || 0), my = (y0 + y1) / 2 - (lift || 0); return s => { const u = 1 - s; return [u * u * x0 + 2 * u * s * mx + s * s * x1, u * u * y0 + 2 * u * s * my + s * s * y1]; }; },
        arc: (cx, cy, rx, ry, a0, a1, tilt) => { const c = Math.cos(tilt || 0), n = Math.sin(tilt || 0); return s => { const a = lerp(a0, a1, s), x = Math.cos(a) * rx, y = Math.sin(a) * ry; return [cx + x * c - y * n, cy + x * n + y * c]; }; },
        spiral: (cx, cy, r0, r1, a0, turns, flat) => s => { const a = a0 + s * turns * TAU, r = lerp(r0, r1, s); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * (flat || 1)]; },
        // 위로 감겨 오르는 나선(기둥을 감는 띠)
        helix: (cx, y0, y1, r, a0, turns, flat) => s => { const a = a0 + s * turns * TAU; return [cx + Math.cos(a) * r * (1 - s * .35), lerp(y0, y1, s) + Math.sin(a) * r * (flat || .3)]; }
    };

    const K = {
        C, mix, dark, lite, path, clamp, lerp,
        // 리본을 한 번 긋는다: 머리가 먼저 달리고 꼬리가 따라가 지운다.
        stroke(S, kind, pathFn, t, dur, o) {
            const q = o || {}, node = S.trail(kind, Object.assign({ path: pathFn, width: q.width || S.U * .05, color: q.color, color2: q.color2 || (q.color ? dark(q.color) : undefined), seed: q.seed || S.rnd(t * 91 + 3), z: q.z == null ? 3 : q.z }, q.props), t);
            node.to({ head: 1 }, dur * (q.lead || .55), q.ease || 'out3');
            node.seek(dur * (q.lag == null ? .3 : q.lag)).to({ tail: 1 }, dur * (q.trail || .7), q.easeTail || 'io').end();
            return node;
        },
        // 호를 긋는 참격. a0에서 a1로 r 반지름의 호를 그린다.
        slash(S, cx, cy, r, a0, a1, t, dur, o) {
            const q = o || {}, flat = q.flat == null ? .55 : q.flat;
            return K.stroke(S, q.kind || 'slash', path.arc(cx, cy, r, r * flat, a0, a1, q.tilt || 0), t, dur, Object.assign({ width: r * (q.w || .5), lead: .45, lag: .28, trail: .72 }, q, { props: Object.assign({ p0: 5, p1: 3, p2: .8, taper: .5, seg: 34 }, q.props) }));
        },
        // 날아가는 줄기(탄, 창, 물줄기).
        dart(S, x0, y0, x1, y1, t, dur, o) {
            const q = o || {};
            return K.stroke(S, q.kind || 'energy', path.bow(x0, y0, x1, y1, q.lift || 0, q.side || 0), t, dur, Object.assign({ lead: .62, lag: .34, trail: .66, ease: 'in' }, q, { props: Object.assign({ p0: 6, p1: 5, p2: 1.1, taper: .22 }, q.props) }));
        },
        // 번개. 굵은 줄기가 두세 번 다른 모양으로 번쩍이고 잔가지가 갈라진다.
        bolt(S, x0, y0, x1, y1, color, t, o) {
            const q = o || {}, flashes = S.reduced ? 1 : q.flashes || 2, len = Math.hypot(x1 - x0, y1 - y0), w = q.width || S.U * .07;
            for (let f = 0; f < flashes; f++) {
                const at = t + f * (q.gap || .075), seed = S.rnd(f * 17 + t * 53 + 1) * 9;
                S.trail('bolt', { path: path.line(x0, y0, x1, y1), head: 1, tail: 0, width: w * (f ? .7 : 1), jag: len * (q.jag || .07), seg: 22, taper: .05, color, color2: q.color2 || dark(color, .5), seed, z: 4 }, at).wait(q.hold || .06).to({ alpha: 0 }, .1).end();
                const twigs = S.minor ? 0 : q.twigs == null ? 2 : q.twigs;
                for (let i = 0; i < twigs; i++) {
                    const s = .25 + S.rnd(f * 31 + i * 7 + 2) * .5, bx = lerp(x0, x1, s), by = lerp(y0, y1, s), a = Math.atan2(y1 - y0, x1 - x0) + (S.rnd(f * 13 + i * 5 + 3) - .5) * 2, l = len * (.16 + S.rnd(i + f * 3 + 5) * .2);
                    S.trail('bolt', { path: path.line(bx, by, bx + Math.cos(a) * l, by + Math.sin(a) * l), head: 1, tail: 0, width: w * .42, jag: l * .12, seg: 10, taper: .6, color, color2: q.color2 || dark(color, .5), seed: seed + i + 1, z: 4 }, at).wait(.04).to({ alpha: 0 }, .08).end();
                }
            }
        },
        // 불티: 속도 방향으로 늘어난 선이 튀어 나가 떨어진다.
        sparks(S, x, y, n, color, t, o) {
            const q = o || {}, u = S.U;
            S.burst(Object.assign({ x, y, n: S.minor ? Math.ceil(n * .5) : n, t, cell: 'spark', color: lite(color, .35), color2: color, speed: [u * (q.speed || .9) * .35, u * (q.speed || .9)], angle: q.angle, spread: q.spread == null ? (q.angle == null ? TAU : 1.1) : q.spread, life: q.life || [.22, .5], size: q.size || [u * .012, u * .03], grow: .3, drag: q.drag == null ? 3.2 : q.drag, grav: u * (q.grav == null ? 1.1 : q.grav), stretch: q.stretch == null ? .9 : q.stretch }, q.more));
        },
        // 천천히 떠오르는 불씨, 빛가루.
        embers(S, x, y, n, color, t, o) {
            const q = o || {}, u = S.U;
            S.burst(Object.assign({ x, y, n: S.minor ? Math.ceil(n * .5) : n, t, cell: q.cell || 'dot', color: lite(color, .3), color2: color, radius: q.radius == null ? u * .08 : q.radius, flat: q.flat, angle: q.angle == null ? -PI / 2 : q.angle, spread: q.spread == null ? 1.2 : q.spread, speed: [u * (q.speed || .25) * .4, u * (q.speed || .25)], life: q.life || [.5, 1.1], size: q.size || [u * .008, u * .02], grow: q.grow == null ? .2 : q.grow, drag: 1.2, grav: -u * (q.rise == null ? .12 : q.rise), turb: u * (q.turb == null ? .05 : q.turb), over: q.over || 0, spin: q.spin || 0 }, q.more));
        },
        // 먼지와 연기. 그림 뒤에 깔린다.
        dust(S, x, y, n, color, t, o) {
            const q = o || {}, u = S.U;
            S.burst(Object.assign({ x, y, n: S.minor ? Math.ceil(n * .5) : n, t, cell: 'smoke', add: q.add || 0, layer: q.layer == null ? 0 : q.layer, alpha: q.alpha || .5, color, color2: q.color2 || dark(color, .6), radius: q.radius == null ? u * .03 : q.radius, flat: q.flat, angle: q.angle, spread: q.spread == null ? (q.angle == null ? TAU : 1.4) : q.spread, speed: [u * (q.speed || .3) * .3, u * (q.speed || .3)], life: q.life || [.5, 1], size: q.size || [u * .06, u * .13], grow: q.grow == null ? 2 : q.grow, drag: q.drag == null ? 2.6 : q.drag, grav: -u * (q.rise == null ? .04 : q.rise), spin: 1.2, over: q.over || 0 }, q.more));
        },
        // 튀어 올랐다 떨어지는 파편(돌, 얼음, 유리).
        shards(S, x, y, n, color, t, o) {
            const q = o || {}, u = S.U;
            if (S.reduced) return;
            S.burst(Object.assign({ x, y, n: S.minor ? Math.ceil(n * .5) : n, t, cell: q.cell || 'shard', add: q.add || 0, color, color2: q.color2 || color, angle: q.angle == null ? -PI / 2 : q.angle, spread: q.spread == null ? 2.2 : q.spread, speed: [u * (q.speed || 1) * .4, u * (q.speed || 1)], life: q.life || [.5, .95], size: q.size || [u * .014, u * .034], grow: q.grow == null ? .8 : q.grow, drag: q.drag == null ? .6 : q.drag, grav: u * (q.grav == null ? 2.6 : q.grav), spin: q.spin == null ? 12 : q.spin, radius: q.radius || 0 }, q.more));
        },
        // 물방울.
        drops(S, x, y, n, color, t, o) {
            const q = o || {}, u = S.U;
            S.burst(Object.assign({ x, y, n: S.minor ? Math.ceil(n * .5) : n, t, cell: 'drop', add: .6, color: lite(color, .5), color2: color, angle: q.angle == null ? -PI / 2 : q.angle, spread: q.spread == null ? 2.4 : q.spread, speed: [u * (q.speed || .9) * .35, u * (q.speed || .9)], life: q.life || [.4, .8], size: q.size || [u * .012, u * .028], grow: .6, drag: .8, grav: u * (q.grav == null ? 2.4 : q.grav), stretch: .5 }, q.more));
        },
        // 번지는 빛(짧은 섬광).
        glow(S, x, y, r, color, t, dur, alpha, z) {
            const d = dur || .3;
            return S.shape('glow', { x, y, w: r * .6, h: r * .6, color, alpha: alpha == null ? .9 : alpha, p0: 1.6, z: z == null ? 2 : z }, t).to({ w: r * 2, h: r * 2 }, d * .3, 'out3').to({ alpha: 0, w: r * 2.5, h: r * 2.5 }, d * .7, 'out');
        },
        flare(S, x, y, r, color, t, dur, rot) {
            const d = dur || .3, a = rot || 0;
            return S.shape('flare', { x, y, w: r * .4, h: r * .4, rot: a, color, alpha: 1, p0: .012, z: 4 }, t).to({ w: r * 2.6, h: r * 2.6 }, d * .3, 'out3').to({ alpha: 0, w: r * 1.5, h: r * 1.5, rot: a + .4 }, d * .7, 'in');
        },
        // 거친 가장자리의 충격파 고리.
        ring(S, x, y, r, color, t, o) {
            const q = o || {}, flat = q.flat || 1;
            return S.field('shock', { x, y, w: r * 2, h: r * 2 * flat, color, color2: q.color2 || dark(color, .7), p0: .12, p1: q.th || .12, p2: q.dust == null ? .8 : q.dust, p3: q.whole ? 0 : .7, alpha: q.alpha || 1, seed: S.rnd(t * 37 + 5), z: q.z == null ? 2 : q.z }, t)
                .to({ p0: .92 }, q.dur || .42, 'out3').with({ alpha: 0 }, (q.dur || .42) * 1.05, 'in').with({ p1: (q.th || .12) * .4 }, q.dur || .42, 'out').end();
        },
        // 화면을 굴절시키는 충격파.
        ripple(S, x, y, t, o) {
            const q = o || {};
            if (S.minor) return null;
            return S.lens('ripple', { x, y, p0: .01, p1: q.width || .035, p2: q.amp || .012, p3: q.shine == null ? .25 : q.shine, color2: q.color || C.white, live: true, z: -40 }, t)
                .to({ p0: q.reach || .5 }, q.dur || .42, 'out3').with({ p2: 0 }, q.dur || .42, 'lin').end();
        },
        // 타오르는 불기둥.
        fire(S, x, y, w, h, t, dur, o) {
            const q = o || {};
            return S.field('flame', { x, y: y - h / 2, w, h, color: q.color || C.fire, color2: q.color2 || C.ember, p0: .2, p1: q.speed || 2.6, p2: .05, p3: q.rough || 0, seed: S.rnd(t * 71 + 9), alpha: q.alpha || 1, rot: q.rot || 0, z: q.z == null ? 1 : q.z }, t)
                .to({ p0: q.fat || 1, p2: 1 }, q.rise || .16, 'out3').wait(Math.max(0, dur - (q.rise || .16) - (q.fall || .3))).to({ p2: 0, p0: .3, alpha: 0 }, q.fall || .3, 'in').end();
        },
        // 구체. 돌려받은 노드에 장면이 직접 움직임을 붙인다.
        orb(S, x, y, r, t, o) {
            const q = o || {};
            return S.field(q.shader || 'orb', { x, y, w: r * 4, h: r * 4, color: q.color || C.volt, color2: q.color2 || dark(q.color || C.volt), p0: q.p0 == null ? .5 : q.p0, p1: q.spin == null ? 2 : q.spin, p2: q.arcs || 0, p3: q.rough || 0, seed: S.rnd(t * 13 + 2), add: q.add == null ? 1 : q.add, z: q.z == null ? 2 : q.z }, t);
        },
        // 두 점을 잇는 광선.
        beam(S, x0, y0, x1, y1, width, t, dur, o) {
            const q = o || {}, len = Math.hypot(x1 - x0, y1 - y0);
            return S.field('beam', { x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: len, h: width, rot: Math.atan2(y1 - y0, x1 - x0), color: q.color, color2: q.color2 || (q.color ? dark(q.color) : undefined), p0: 0, p1: 0, p2: q.thick || .7, p3: q.rush || 0, seed: S.rnd(t * 29 + 4), z: q.z == null ? 3 : q.z }, t)
                .to({ p0: 1.05 }, q.shoot || .08, 'out').wait(Math.max(0, dur - (q.shoot || .08) - (q.fall || .18))).to({ p1: 1.05, p2: .1 }, q.fall || .18, 'in').end();
        },
        // 바닥의 마법진.
        circle(S, x, y, r, t, hold, o) {
            const q = o || {}, flat = q.flat == null ? .3 : q.flat;
            return S.field('circle', { x, y, w: r * 2, h: r * 2 * flat, color: q.color, color2: q.color2 || (q.color ? dark(q.color, .6) : undefined), p0: 0, p1: q.sides || 6, p2: q.spin == null ? 1 : q.spin, p3: q.bold || 0, seed: q.seed || S.rnd(t * 19 + 7), alpha: q.alpha || 1, z: q.z == null ? -3 : q.z }, t)
                .to({ p0: 1 }, q.draw || .22, 'out').wait(hold).to({ alpha: 0, w: r * 2.3, h: r * 2.3 * flat }, q.fade || .3, 'in').end();
        },
        rays(S, x, y, r, t, dur, o) {
            const q = o || {};
            return S.field('rays', { x, y, w: r * 2, h: r * 2, color: q.color, color2: q.color2 || (q.color ? dark(q.color) : undefined), p0: q.n || 7, p1: q.spin == null ? .8 : q.spin, p2: q.sharp == null ? .55 : q.sharp, p3: q.hole || 0, alpha: 0, seed: S.rnd(t * 43 + 1), z: q.z == null ? 0 : q.z }, t)
                .to({ alpha: q.alpha || .9 }, dur * .2, 'out').wait(dur * .4).to({ alpha: 0, w: r * 2.5, h: r * 2.5 }, dur * .4, 'in').end();
        },
        crack(S, x, y, r, t, hold, o) {
            const q = o || {}, flat = q.flat == null ? .32 : q.flat;
            return S.field('crack', { x, y, w: r * 2, h: r * 2 * flat, color: q.color || C.fire, color2: q.color2 || C.soot, p0: .05, p1: q.n || 9, p2: q.glow == null ? 1 : q.glow, add: q.add == null ? .7 : q.add, seed: S.rnd(t * 23 + 8), z: q.z == null ? -2 : q.z }, t)
                .to({ p0: 1 }, q.grow || .16, 'out3').wait(hold).to({ p2: 0 }, .25).with({ alpha: 0 }, q.fade || .45, 'in').end();
        },
        smoke(S, x, y, r, t, dur, o) {
            const q = o || {};
            return S.field('smoke', { x, y, w: r * 1.2, h: r * 1.2, color: q.color || C.ash, color2: q.color2 || C.soot, p0: 0, p1: q.rise == null ? .5 : q.rise, p2: 0, add: q.add || 0, seed: S.rnd(t * 61 + 6), z: q.z == null ? 0 : q.z }, t)
                .to({ p0: q.dense || .8, w: r * 2, h: r * 2 }, dur * .25, 'out3').to({ p2: 1, p0: 0, w: r * 2.6, h: r * 2.6, y: y - r * (q.lift == null ? .3 : q.lift) }, dur * .75, 'out').end();
        },
        // 솟는 기운의 기둥.
        aura(S, x, ground, w, h, t, dur, o) {
            const q = o || {};
            return S.field('aura', { x, y: ground - h / 2, w, h, color: q.color, color2: q.color2 || (q.color ? dark(q.color) : undefined), p0: .05, p1: q.speed || 2.2, p2: q.fine || .5, alpha: q.alpha || .9, seed: S.rnd(t * 83 + 3), z: q.z == null ? 1 : q.z }, t)
                .to({ p0: 1 }, dur * .3, 'out3').wait(dur * .35).to({ alpha: 0, p0: 1.3 }, dur * .35, 'in').end();
        },
        // 솟아오르는 결정 하나.
        crystal(S, x, ground, w, h, t, hold, o) {
            const q = o || {};
            return S.field('crystal', { x, y: ground - h / 2, w, h, color: q.color || C.ice, color2: q.color2 || C.deep, p0: 0, p1: q.fat || .55, p2: q.lean || 0, p3: q.glint == null ? .6 : q.glint, add: q.add == null ? .25 : q.add, seed: S.rnd(t * 47 + x * .01), z: q.z == null ? 1 : q.z }, t)
                .to({ p0: 1 }, q.grow || .12, q.ease || 'back').wait(hold);
        },
        // 타격의 순간: 충격파, 섬광, 불티, 화면 굴절과 반동을 한꺼번에 낸다. power 0~1.
        impact(S, x, y, t, o) {
            const q = o || {}, u = S.U, power = (q.power == null ? .6 : q.power) * (S.minor ? .5 : 1), color = q.color || S.color();
            K.ring(S, x, y, u * (.16 + .26 * power), color, t, { th: .16, dur: .34 + power * .16 });
            K.glow(S, x, y, u * (.06 + .1 * power), q.core || C.white, t, .2, .9);
            if (power > .3) K.flare(S, x, y, u * (.08 + .14 * power), lite(color, .3), t, .3, q.rot);
            if (power > .5 && !S.reduced) S.field('rays', { x, y, w: u * (.3 + power * .5), h: u * (.3 + power * .5), color: lite(color, .5), color2: color, p0: 5, p1: 0, p2: .9, p3: .05, seed: S.rnd(t * 77 + 2), z: 3 }, t).to({ w: u * (.7 + power * .9), h: u * (.7 + power * .9) }, .08, 'out3').to({ alpha: 0 }, .14, 'in').end();
            K.sparks(S, x, y, Math.round(8 + power * 22), color, t, { speed: .7 + power * .9, angle: q.angle, spread: q.spread });
            if (power > .45 && q.ripple !== false) K.ripple(S, x, y, t, { amp: .008 + power * .014, reach: .2 + power * .34, dur: .3 + power * .16 });
            if (!S.minor) { S.shake(5 + power * 18, .2 + power * .25, t); if (power >= .45) S.stop(30 + power * 70, t); if (q.zoom) S.punch(q.zoom, t, .36, { x, y }); }
            if (power > .7 && q.flash !== false) S.flash(lite(color, .7), .1 + power * .12, .22, t);
        }
    };
    F.kit = K;
})(typeof globalThis != 'undefined' ? globalThis : this);
