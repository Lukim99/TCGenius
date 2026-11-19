// 천상 증강 장면집. 증강이 발동하는 순간의 장면(augment:*), 증강이 준 스킬의 장면, 그리고 전투 내내 살아 있는 지속 상태 연출을 그린다.
// 스킬 장면집(combat-fx-skills.js) 다음에 싣는다. 사건과 상태의 모양은 docs/paradise-augment-fx.md를 따른다.
// 천상에서는 플레이어가 늘 왼쪽이다. 적의 사건으로 불린 장면은 엔진이 뒤집어 그리므로, 장면은 side(S)로 주인(O)과 적(E)을 받아 쓴다.
(function (root) {
    'use strict';
    const F = typeof module == 'object' && module.exports ? require('./combat-fx.js') : root.CombatFX;
    if (!F || !F.kit || !F.sceneDef) return;
    const K = F.kit, C = K.C, path = K.path, dark = K.dark, lite = K.lite, mix = K.mix, clamp = K.clamp, lerp = K.lerp;
    const PI = Math.PI, TAU = PI * 2;
    const GOLD = [1, .82, .35], EMBER = [.85, .32, .08], FATE = [.78, .5, 1], FATE2 = [.28, .1, .6], ETERNAL = [.62, .95, 1], ETERNAL2 = [.08, .3, 1];
    const BLOOD = [.95, .1, .14], SOUL = [.55, .95, 1], SOUL2 = [.1, .35, .7], STEEL = [.82, .9, 1], THORN = [.55, .85, .4], ROSE = [1, .55, .75], TIME = [.5, .75, 1];
    const SEASON = { spring: [1, .62, .8], summer: [1, .78, .25], autumn: [1, .45, .15], winter: [.62, .88, 1] }, SEASONS = ['spring', 'summer', 'autumn', 'winter'];

    // ================= 무늬 =================
    // 피어나는 꽃. p0 핀 정도(0~1), p1 꽃잎 수, p2 도는 속도.
    F.shader('flowerbloom', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x)+uTime*uP.z+uSeed*6.,n=uP.y,o=uP.x;
  float p1=pow(abs(cos(a*n*.5)),.5),p2=pow(abs(cos((a+3.14159/n)*n*.5)),.7);
  float R1=o*(.44+.5*p1),R2=o*(.22+.34*p2);
  float outer=1.-smoothstep(R1-.07,R1,r),inner=1.-smoothstep(R2-.05,R2,r);
  float vein=.72+.28*cos(a*n)*smoothstep(.1,.9,r/max(R1,.01));
  float core=1.-smoothstep(.06*o,.13*o,r);
  vec3 col=mix(uColor2,uColor.rgb,smoothstep(.05,1.,r/max(R1,.01)))*vein;
  col=mix(col,mix(uColor.rgb,vec3(1.),.6),inner*.85);
  col=mix(col,vec3(1.,.86,.4),core);
  float glow=pow(max(0.,1.-r),3.)*.4*o;
  return vec4(col+glow,clamp(max(outer,inner)+glow,0.,1.));
}`);
    // 운명의 일곱 별. p0 켜진 별의 수, p1 별을 잇는 선(0~1), p2 도는 속도, p3 가운데로 모인 정도.
    F.shader('fatestar', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float R=.8*(1.-uP.w),t=uTime*uP.z,al=0.,core=0.;
  for(int i=0;i<7;i++){
    float fi=float(i),a=t+fi*.8975979-1.5708,lit=clamp(uP.x-fi,0.,1.);
    vec2 c=vec2(cos(a),sin(a))*R;float d=length(q-c);
    float g=exp(-d*d*mix(700.,70.,lit))*(.35+.65*lit)+lit*.012/(abs(q.x-c.x)*abs(q.y-c.y)*90.+.012)*max(0.,1.-d*5.);
    float j=mod(fi+3.,7.),a2=t+j*.8975979-1.5708;vec2 e=vec2(cos(a2),sin(a2))*R,pa=q-c,ba=e-c;
    float h=clamp(dot(pa,ba)/dot(ba,ba),0.,1.),dl=length(pa-ba*h);
    al+=(1.-smoothstep(0.,.02,dl))*lit*clamp(uP.x-j,0.,1.)*step(h,uP.y)*.55*uP.y+g;core+=g*lit;
  }
  float ring=(1.-smoothstep(0.,.016,abs(length(q)-R)))*.3;
  return vec4(mix(uColor.rgb,vec3(1.),clamp(core,0.,1.)),clamp(al+ring,0.,1.));
}`);
    // 한 줄로 늘어선 표지. p0 켜진 수, p1 전체 수, p2 모양(0 마름모, 1 방울).
    F.shader('pips', `vec4 fx(vec2 uv){
  float g=uv.x*uP.y,i=floor(g);vec2 l=vec2(fract(g)-.5,uv.y-.5)*2.;
  float d=uP.z<.5?abs(l.x)*1.25+abs(l.y):length(vec2(l.x*(1.25+max(0.,-l.y-.1)*2.4),l.y-.18))*1.25;
  float lit=clamp(uP.x-i,0.,1.),fill=1.-smoothstep(.6,.7,d),edge=fill*smoothstep(.42,.6,d);
  float shine=(1.-smoothstep(0.,.3,length(l-vec2(-.15,-.1))))*.6;
  return vec4(mix(uColor2,uColor.rgb+shine,lit),fill*lit+edge*.45*(1.-lit)+pow(max(0.,1.-d),2.)*.25*lit);
}`);
    // 월계관. 잎 열 장이 양쪽에서 번갈아 켜진다. p0 켜진 잎의 수, p1 완성의 빛.
    F.shader('laurel', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;q.x*=1.25;float al=0.,hot=0.;
  for(int i=0;i<10;i++){
    float fi=float(i),s=fi<5.?-1.:1.,m=mod(fi,5.),th=.42+m*.5,lit=clamp(uP.x-(m*2.+(s>0.?1.:0.)),0.,1.);
    vec2 c=vec2(s*sin(th),cos(th))*.78,tn=vec2(s*cos(th-.5),-sin(th-.5)),nm=vec2(-tn.y,tn.x),p=q-c;
    float lx=clamp(dot(p,tn)/.27,-1.5,1.5),ly=dot(p,nm)/.1,d=lx*lx+abs(ly)*(1.+.5*lx);
    float leaf=1.-smoothstep(.75,1.,d),rib=(1.-smoothstep(0.,.25,abs(ly)))*leaf*.5;
    al+=leaf*(.2+.8*lit);hot+=(leaf*.6+rib)*lit;
  }
  float ring=pow(max(0.,1.-abs(length(q)-.78)*3.2),2.)*uP.y;
  return vec4(mix(uColor2,uColor.rgb,clamp(hot,0.,1.))+hot*.35+ring,clamp(al+ring*.8,0.,1.));
}`);
    // 톱니바퀴. p0 톱니 수, p1 돈 각도, p2 달아오름(0~1).
    F.shader('cog', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x)+uP.y;
  float tooth=smoothstep(-.25,.25,cos(a*uP.x)),R=mix(.62,.84,tooth);
  float body=(1.-smoothstep(R-.04,R,r))*smoothstep(.2,.25,r);
  float spoke=1.-smoothstep(.06,.1,abs(sin(a*2.))*r);
  float web=body*mix(1.,max(spoke,step(.5,r)),step(r,.5));
  float shade=.45+.4*smoothstep(.3,.84,r)+.15*cos(a*uP.x);
  float glow=pow(max(0.,1.-r),2.)*uP.z*.8;
  return vec4(mix(uColor2,uColor.rgb,clamp(shade*(.5+uP.z*.6),0.,1.))+glow,clamp(web+glow,0.,1.));
}`);
    // 눈. p0 뜬 정도(0~1), p1 눈동자의 좌우, p2 경계의 빛.
    F.shader('eye', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float x=q.x/.92,o=max(uP.x,.001),k=max(0.,1.-x*x);
  float up=-pow(k,.8)*.78*o,lo=k*.6*o;
  float inside=step(up,q.y)*step(q.y,lo)*step(abs(x),1.);
  float lid=(1.-smoothstep(0.,.07,abs(q.y-up)))+(1.-smoothstep(0.,.05,abs(q.y-lo)));lid*=step(abs(x),1.02);
  vec2 ip=q-vec2(uP.y*.3,0.);float ir=length(ip),ia=atan(ip.y,ip.x);
  float iris=(1.-smoothstep(.36,.42,ir))*inside;
  float streak=.55+.45*noise(vec2(ia*5.+uSeed*9.,ir*7.-uTime*.8));
  float pupil=(1.-smoothstep(.2,.26,abs(ip.x)*3.4+abs(ip.y)*.75))*inside;
  float halo=pow(max(0.,1.-length(q*vec2(.8,1.3))),2.)*(.25+uP.z*.6);
  float lash=(1.-smoothstep(0.,.03,abs(fract(atan(q.y+.2,q.x)*3.2+.5)-.5)*length(q)))*step(q.y,up-.04)*step(up-.3*o,q.y)*o;
  vec3 col=mix(vec3(.03,.01,.04),uColor.rgb*streak*1.3,iris);col=mix(col,vec3(0.),pupil);
  col+=uColor2*(lid+lash*.7)+uColor.rgb*halo*.6+vec3(1.)*(1.-smoothstep(0.,.08,length(ip-vec2(-.1,-.12))))*inside*.9;
  return vec4(col,clamp(inside*.82+lid+lash*.6+halo,0.,1.));
}`);
    // 시계. p0 긴바늘의 각도, p1 그려진 정도, p2 되감기는 잔상.
    F.shader('clockface', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.x,-q.y);
  float ring=(1.-smoothstep(0.,.035,abs(r-.9)))+(1.-smoothstep(0.,.016,abs(r-.78)))*.5;
  float tk=abs(fract(a/6.28318*12.+.5)-.5),ticks=(1.-smoothstep(.04,.09,tk))*step(.62,r)*step(r,.78);
  float dm=abs(mod(a-uP.x+3.14159,6.28318)-3.14159),dh=abs(mod(a-uP.x/12.+3.14159,6.28318)-3.14159);
  float hm=(1.-smoothstep(0.,.05,dm*r))*step(r,.7)*step(dm,1.5),hh=(1.-smoothstep(0.,.075,dh*r))*step(r,.44)*step(dh,1.5);
  float ghost=(1.-smoothstep(0.,2.2,mod(a-uP.x,6.28318)))*uP.z*step(r,.7)*smoothstep(.08,.3,r)*.55;
  float hub=1.-smoothstep(.05,.08,r);
  float al=clamp(ring+ticks*.8+hm+hh+ghost+hub,0.,1.);
  return vec4(heat(clamp(al*.6+hm*.4+hub,0.,1.)),al*uP.y);
}`);
    // 선택의 표식: 반은 터지는 붉은 빛, 반은 되살리는 푸른 빛. p0 왼쪽의 밝기, p1 오른쪽의 밝기.
    F.shader('choicemark', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float d=abs(q.x)*1.2+abs(q.y)*.84,inside=1.-smoothstep(.7,.74,d),edge=1.-smoothstep(0.,.05,abs(d-.72));
  float seam=(1.-smoothstep(0.,.035,abs(q.x+sin(q.y*9.+uTime*5.)*.035)))*inside;
  float n=fbm2(q*3.+vec2(0.,uTime*(q.x<0.?-1.3:1.3))+uSeed*5.);
  float gl=q.x<0.?uP.x:uP.y;vec3 col=q.x<0.?uColor.rgb:uColor2;
  float body=inside*(.3+n*.7)*gl;
  return vec4(col*(.7+n*.6)+vec3(1.)*(edge*.5*gl+seam),clamp(body+edge*gl+seam,0.,1.));
}`);
    // 곁을 도는 혼불. p0 혼불의 수(최대 8), p1 도는 속도.
    F.shader('wisps', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float al=0.,core=0.;
  for(int i=0;i<8;i++){
    float fi=float(i),on=clamp(uP.x-fi,0.,1.),ph=uTime*uP.y*(.8+fract(fi*.37)*.5)+fi*2.4;
    vec2 c=vec2(cos(ph)*.74,sin(ph*1.31+fi)*.3+sin(ph)*.12),c2=vec2(cos(ph-.3)*.74,sin((ph-.3)*1.31+fi)*.3+sin(ph-.3)*.12),c3=vec2(cos(ph-.6)*.74,sin((ph-.6)*1.31+fi)*.3+sin(ph-.6)*.12);
    float g=exp(-dot(q-c,q-c)*420.)+exp(-dot(q-c,q-c)*70.)*.22,t1=exp(-dot(q-c2,q-c2)*600.)*.6,t2=exp(-dot(q-c3,q-c3)*900.)*.35;
    al+=(g+t1+t2)*on;core+=g*g*on;
  }
  return vec4(mix(uColor.rgb,vec3(1.),clamp(core*1.4,0.,1.)),clamp(al,0.,1.));
}`);
    // 가시덩굴의 고리. p0 반지름, p1 가시 수, p2 가시 길이, p3 도는 속도.
    F.shader('briar', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),a=atan(q.y,q.x)+uTime*uP.w,R=uP.x+sin(a*5.)*.025;
  float k=abs(fract(a*uP.y/6.28318)-.5)*2.,sp=max(0.,1.-k*3.4)*uP.z;
  float stem=1.-smoothstep(.02,.05,abs(r-R)),thorn=step(R,r)*step(r-R,sp)*step(.001,sp);
  float hi=smoothstep(R+sp*.35,R+sp,r)*thorn;
  return vec4(mix(uColor2,uColor.rgb,clamp(stem*.5+hi,0.,1.)),clamp(stem+thorn,0.,1.));
}`);
    // 차례로 높아지는 세 자루의 칼날. 꺼진 칼은 윤곽만 서 있고, 켜지면 밑동에서 빛이 차오른다. p0 켜진 수(0~3), p1 방금 켜진 칼의 번쩍임.
    F.shader('risers', `vec4 fx(vec2 uv){
  float g=uv.x*3.,i=floor(g),y=1.-uv.y,x=abs(fract(g)-.5),hgt=.42+i*.27,lit=clamp(uP.x-i,0.,1.);
  float hw=.2*clamp((hgt-y)/.16,0.,1.),span=step(.07,y)*step(y,hgt);
  float body=(1.-smoothstep(hw-.05,hw,x))*span,core=(1.-smoothstep(hw-.14,hw-.06,x))*span;
  float guard=(1.-smoothstep(.3,.35,x))*step(y,.07)*step(.01,y);
  float fill=(1.-smoothstep(hgt*lit-.03,hgt*lit+.03,y))*step(.001,lit),ridge=(1.-smoothstep(0.,.035,x))*span;
  float fresh=uP.y*(1.-step(.5,abs(i-(uP.x-1.))));
  vec3 tone=i>1.5?vec3(1.,.82,.35):uColor.rgb;
  vec3 col=mix(uColor2,tone,fill)+vec3(1.)*(ridge*.5*fill+fresh*fill);
  float al=(body-core*.8)*.8*(1.-fill)+body*fill+guard*(.4+.6*step(.5,lit));
  return vec4(col,clamp(al,0.,1.));
}`);
    // 방패 문장. 금이 위에서 아래로 번지고, 다 번지면 두 쪽으로 갈라져 벌어진다. p0 금이 번진 정도(0~1), p1 벌어진 정도(0~1), p2 맞은 순간의 번쩍임.
    F.shader('aegis', `float zg(float y){return (abs(fract(y*1.9+.15)-.5)-.25)*.36+y*.06;}
float seg(vec2 p,vec2 a,vec2 b){vec2 pa=p-a,ba=b-a;return length(pa-ba*clamp(dot(pa,ba)/dot(ba,ba),0.,1.));}
vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float k=uP.x,open=uP.y,sg=q.x-zg(q.y)<0.?-1.:1.;
  vec2 p=q-vec2(sg*open*.24,open*.05*sg*q.y);
  float sd=p.x-zg(p.y),keep=open>.001?step(0.,sd*sg):1.;
  float d1=p.y+.1,w=p.y<-.1?.7:.7*sqrt(max(0.,1.-d1*d1)),ax=abs(p.x);
  float inside=(1.-smoothstep(w-.05,w,ax))*step(-.8,p.y)*step(p.y,.9)*keep;
  float rim=1.-smoothstep(.1,.17,min(w-ax,p.y+.8));
  float boss=1.-smoothstep(.17,.21,ax*1.1+abs(p.y+.08)*.8);
  float end=-.8+1.75*k,wd=.03+.07*k*(1.-.7*smoothstep(-.8,end,p.y));
  float cr=(1.-smoothstep(wd*.4,wd,abs(sd)))*step(p.y,end)*step(.001,k);
  cr=max(cr,(1.-smoothstep(.015,.04,seg(p,vec2(zg(-.3),-.3),vec2(-.44,-.04))))*step(.5,k));
  cr=max(cr,(1.-smoothstep(.015,.04,seg(p,vec2(zg(.15),.15),vec2(.42,.36))))*step(.7,k));
  cr*=1.-open;
  float hot=(1.-smoothstep(0.,.1+.12*k,abs(sd)))*step(p.y,end+.06)*k;
  vec3 face=mix(uColor2,uColor.rgb,clamp(.2+.3*(.5-p.y*.5)+rim*.6+boss*.45,0.,1.))+vec3(1.)*uP.z*.7;
  vec3 col=mix(face,vec3(.03,.02,.05),cr)+vec3(1.,.5,.15)*hot*(.45+.55*open)*(1.-cr*.6);
  return vec4(col,inside*(1.-open*.45));
}`);
    // 벌어지는 상처. 찢긴 데는 벌어져 속이 보이고, 아직 남은 데는 점선으로만 그어져 있다. p0 찢긴 길이(0~1), p1 벌어진 정도(0~1), p2 방금 터진 번쩍임, p3 예정선의 밝기.
    F.shader('gash', `vec4 fx(vec2 uv){
  float x=uv.x,y=(uv.y-.5)*2.-(noise(vec2(x*9.+uSeed*7.,3.))-.5)*.3,len=uP.x,k=clamp(x/max(len,.001),0.,1.);
  float cut=step(x,len),wd=max(.001,uP.y*.85*sqrt(max(0.,1.-k))*sqrt(min(1.,x*16.)))*cut,ay=abs(y);
  float inner=(1.-smoothstep(wd*.5,wd*.8,ay))*cut,lip=(1.-smoothstep(wd*.8,wd+.09,ay))*cut;
  float glow=exp(-ay*ay/(wd*wd*2.5+.03))*.45*cut;
  float dash=step(.45,fract(x*13.-uTime*.5))*(1.-smoothstep(.04,.1,ay))*step(len+.02,x)*step(.02,x)*step(x,.98)*uP.w;
  float tip=exp(-((x-len)*(x-len)*700.+y*y*24.))*(.5+uP.z*2.);
  vec3 col=mix(uColor.rgb,mix(uColor2,vec3(.07,0.,.01),1.-smoothstep(0.,wd*.5,ay)),inner)+vec3(1.,.75,.65)*(lip*(.3+uP.z)*(1.-inner)+tip);
  return vec4(col,clamp(max(lip,dash*.6)+glow+tip,0.,1.));
}`);
    // 사계의 바퀴. 위에 온 칸이 지금의 계절이다. p0 돌린 각도, p1 드러난 정도.
    F.shader('seasonwheel', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),th=atan(q.x,-q.y),a=th+uP.x,s=mod(floor(a/1.5708+.5),4.),f=abs(fract(a/1.5708+.5)-.5)*2.;
  vec3 c=s<.5?vec3(1.,.62,.8):s<1.5?vec3(1.,.8,.25):s<2.5?vec3(1.,.45,.15):vec3(.6,.88,1.);
  float band=smoothstep(.56,.62,r)*(1.-smoothstep(.86,.92,r))*(1.-smoothstep(.84,.94,f));
  float top=1.-smoothstep(0.,.95,abs(th));
  float inner=(1.-smoothstep(0.,.02,abs(r-.5)))*.35+(1.-smoothstep(.05,.08,length(q-vec2(0.,-.97))))*1.;
  return vec4(c*(.6+.8*top)+inner,clamp(band*(.28+.72*top)+inner,0.,1.)*uP.y);
}`);
    // 줄어드는 고리. p0 남은 정도(0~1), p1 굵기.
    F.shader('gauge', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;float r=length(q),k=fract(atan(q.x,-q.y)/6.28318+1.),band=1.-smoothstep(uP.y*.5,uP.y,abs(r-.82));
  float on=step(k,uP.x),tip=(1.-smoothstep(0.,.03,abs(k-uP.x)))*band;
  return vec4(mix(uColor2,uColor.rgb,on)+tip,band*(.18+.82*on));
}`);

    // 결투의 표지: 맞댄 두 자루의 세검. 캔버스에 직접 그린다.
    F.paint('paint:aug-duel', 256, 256, g => {
        g.lineCap = 'round';
        for (const s of [-1, 1]) {
            g.save(); g.translate(128, 132); g.rotate(s * .62);
            const blade = g.createLinearGradient(0, 96, 0, -112); blade.addColorStop(0, '#9aa6b8'); blade.addColorStop(1, '#ffffff');
            g.fillStyle = blade; g.beginPath(); g.moveTo(-4, 70); g.lineTo(-2.5, -100); g.lineTo(0, -116); g.lineTo(2.5, -100); g.lineTo(4, 70); g.closePath(); g.fill();
            g.strokeStyle = '#e8b04b'; g.lineWidth = 5; g.beginPath(); g.arc(0, 78, 17, PI * 1.05, PI * 1.95); g.stroke();
            g.beginPath(); g.moveTo(-20, 74); g.quadraticCurveTo(0, 62, 20, 74); g.stroke();
            g.strokeStyle = '#5a4630'; g.lineWidth = 7; g.beginPath(); g.moveTo(0, 82); g.lineTo(0, 108); g.stroke();
            g.fillStyle = '#e8b04b'; g.beginPath(); g.arc(0, 113, 6, 0, TAU); g.fill();
            g.restore();
        }
    });

    // ================= 그림 =================
    // codex 이미지 생성으로 만든 그림. 엔진의 그림 표는 /rpg-ui 경로만 알기 때문에, 직접 받아 둔 뒤 캔버스 도형(F.paint)으로 등록한다.
    // 받기 전에 장면이 그 그림을 부르면 엔진이 실패로 적어 두므로, 반드시 pic()이 돌려준 뒤에만 쓴다. 없으면 빛으로만 그린다.
    const art = {};
    function loadArt(name) {
        const entry = art[name] || (art[name] = { ok: false, id: 'paint:aug-' + name, w: 1, h: 1 });
        if (entry.img || typeof Image == 'undefined') return entry;
        const img = entry.img = new Image(); img.decoding = 'async';
        img.onload = () => { entry.w = img.naturalWidth; entry.h = img.naturalHeight; F.paint(entry.id, entry.w, entry.h, (g, w, h) => g.drawImage(img, 0, 0, w, h)); entry.ok = true; };
        img.src = (F.augmentArtBase || '/static/assets/combat-fx/augments/') + name + '.webp';
        return entry;
    }
    const pic = name => { const entry = loadArt(name); return entry.ok ? entry : null; };
    // 엔진의 그림 크기는 512 기준이다. 그림의 높이(또는 너비)가 px이 되는 size를 돌려준다.
    const tall = (entry, px) => px * 512 / entry.h, wide = (entry, px) => px * 512 / entry.w;
    const ART_OF = { conqueror: ['cavalry'], flyingSword: ['sword'], swordDance: ['sword'], comboStaircase: ['sword'], soulReaper: ['reaper_body', 'scythe'], angelDescent: ['angel', 'wing'] };

    // ================= 공통 =================
    const registry = new WeakMap();
    const v = (S, volume) => S.minor ? volume * .55 : volume;
    // 주인과 적의 몸. 호스트가 실제 범위를 알려 주었으면(지속 상태 동기화) 그것을 쓰고, 아니면 중심에서 어림한다.
    function side(S) {
        const st = registry.get(S.host), f = st && st.fig, mir = !!S.scene.mirror, u = S.U, W = S.W, H = S.H;
        const box = (p, q) => {
            const b = q ? { x: mir ? 2 * S.scene.axis - q.x * W : q.x * W, y: p.y, top: q.top * H, bot: q.bottom * H, w: q.w * W } : { x: p.x, y: p.y, top: p.y - .27 * u, bot: p.y + .2 * u, w: .2 * u };
            b.h = b.bot - b.top; return b;
        };
        return { O: box(mir ? S.T : S.A, f && f.me), E: box(mir ? S.A : S.T, f && f.foe), d: mir ? -1 : 1, o: mir ? 't' : 'a', e: mir ? 'a' : 't', u: u * (S.minor ? .82 : 1), st };
    }
    // 타격의 공통 반응. who가 있으면 그쪽이 d 방향으로 밀린다.
    function hit(S, x, y, t, o) {
        const q = o || {}, u = S.U * (S.minor ? .7 : 1), p = q.power == null ? .4 : q.power, color = q.color || GOLD;
        K.ring(S, x, y, u * (.14 + .2 * p), color, t, { th: .14, dur: .26 + p * .14 });
        K.flare(S, x, y, u * (.07 + .1 * p), lite(color, .5), t, .2, q.rot == null ? S.rnd(t * 31 + 2) * 1.5 : q.rot);
        K.sparks(S, x, y, Math.round(8 + p * 16), color, t, { speed: .7 + p * .9, angle: q.angle, spread: q.spread });
        if (p > .55 && !S.minor) K.glow(S, x, y, u * (.05 + .07 * p), C.white, t, .14, .7);
        if (q.who) S.pose(q.who, { flash: .3 + p * .4 }, t).to({ dx: (q.dx || 1) * S.U * (.01 + .03 * p), flash: 0 }, .05, 'out3').to({ dx: 0 }, .16, 'out').end();
        if (S.minor) return;
        S.shake(3 + p * 12, .14 + p * .16, t);
        if (p >= .6) S.stop(30 + p * 40, t);
    }
    const homing = (tx, ty) => p => { p.vx = (tx - p.x) / p.life; p.vy = (ty - p.y) / p.life; };
    // 빛의 알갱이들이 한 점에서 다른 점으로 흘러간다(영혼, 생기, 빼앗은 보호막).
    function flow(S, x0, y0, x1, y1, n, color, t, o) {
        const q = o || {}, u = S.U;
        S.burst({ x: x0, y: y0, n: S.minor ? Math.ceil(n * .6) : n, t, cell: q.cell || 'dot', color: lite(color, .5), color2: color, radius: q.radius == null ? u * .08 : q.radius, life: q.life || [.4, .7], size: q.size || [u * .014, u * .03], grow: .4, over: q.over == null ? .25 : q.over, turb: u * .05, spin: q.spin || 0, add: q.add == null ? 1 : q.add, each: homing(x1, y1) });
    }
    const aug = (name, meta, run) => F.define('augment:' + name, Object.assign({ images: [] }, meta), run);
    // 그림 한 장이 길을 따라 날아간다. tick에서 위치를 직접 옮긴다.
    function ride(node, fly, dur, ease) { return node.tick((p, t) => { const k = clamp(t / dur), q = fly(ease ? ease(k) : k); p.x = q[0]; p.y = q[1]; }); }

    // ================= 발동 장면: 공격에 얹히는 것 =================
    // 결실: 어깨 위에서 익은 열매가 대상에게 떨어져 금빛 과즙으로 터진다.
    aug('fruition', { impact: .2, sounds: ['splat', 'punch_heavy'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, x0 = O.x + s.d * O.w * .4, y0 = O.top + O.h * .06, fly = path.bow(x0, y0, E.x, E.y, u * .16);
        S.sfx('splat', .2, { vol: v(S, .65) }); S.sfx('punch_heavy', .2, { vol: v(S, .4), rate: 1.1 });
        ride(K.orb(S, x0, y0, u * .03, 0, { color: [1, .78, .25], color2: [.95, .3, .12], spin: 3, z: 4 }), fly, .2, k => k * k).wait(.2).to({ alpha: 0, w: u * .5, h: u * .5 }, .1).end();
        K.stroke(S, 'energy', fly, 0, .32, { color: GOLD, color2: C.leaf, width: u * .05, lead: .64, lag: .4, trail: .6, ease: 'in' });
        K.rays(S, E.x, E.y, u * .5, .2, .4, { color: GOLD, color2: C.amber, n: 6, spin: 2 });
        S.burst({ x: E.x, y: E.y, n: 18, t: .2, cell: 'drop', add: .7, color: [1, .95, .7], color2: [1, .6, .15], speed: [u * .3, u * .9], life: [.4, .75], size: [u * .014, u * .032], grow: .5, drag: 1.4, grav: u * 1.8, stretch: .5 });
        S.burst({ x: E.x, y: E.y, n: 10, t: .2, cell: 'petal', add: .2, color: [.7, 1, .5], color2: C.moss, speed: [u * .25, u * .7], life: [.5, .9], size: [u * .022, u * .04], grow: .7, drag: 2, grav: u * .5, spin: 9, turb: u * .06 });
        hit(S, E.x, E.y, .2, { power: .65, color: GOLD, who: s.e, dx: s.d });
    });
    // 정복자 10중첩: 월계관이 완성되고 군기의 바람이 인다. 기병은 지속 상태 연출이 달려 들어오게 한다.
    aug('conqueror.max', { impact: .12, sounds: ['war_horn', 'horse_neigh', 'horse_gallop'] }, S => {
        const s = side(S), u = s.u, O = s.O;
        S.sfx('war_horn', 0, { vol: v(S, .7) }); S.sfx('horse_neigh', .3, { vol: v(S, .4) }); S.sfx('horse_gallop', .12, { vol: v(S, .4) });
        K.rays(S, O.x, O.top, u * .5, 0, .7, { color: GOLD, color2: [.8, .2, .1], n: 9, spin: 1.2, alpha: .8 });
        K.ring(S, O.x, O.bot, u * .5, GOLD, .05, { flat: .28, dur: .5 });
        K.aura(S, O.x, O.bot, u * .34, O.h * 1.1, 0, .8, { color: GOLD, color2: [.7, .15, .05], alpha: .7 });
        for (let i = 0; i < 5; i++) {
            const y = O.top + O.h * (.15 + i * .18), x0 = O.x - s.d * u * (.5 + S.rnd(i) * .2);
            K.dart(S, x0, y, O.x + s.d * u * (.3 + S.rnd(i + 5) * .3), y - u * .02, .05 + i * .04, .3, { color: i % 2 ? [1, .35, .2] : GOLD, width: u * .028, lead: .7 });
        }
        K.embers(S, O.x, O.y, 16, GOLD, .1, { radius: u * .16, rise: .7, speed: .4, cell: 'star' });
        if (!S.minor) S.shake(6, .3, .12);
    });
    // 정복자의 기병: 곁에 있던 기병이 창을 겨누고 대상을 꿰뚫고 지나간다.
    aug('conqueror.cavalry', { impact: .3, sounds: ['horse_gallop', 'metal_slam', 'punch_body'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, rider = s.st && s.st.items.get('conqueror'), y = rider && rider.pos ? rider.pos.y : E.bot - Math.min(E.h * .45, u * .24);
        S.sfx('horse_gallop', 0, { vol: v(S, .42), rate: 1.3, cool: 600 }); S.sfx('metal_slam', .3, { vol: v(S, .6) }); S.sfx('punch_body', .3, { vol: v(S, .5) });
        const x0 = rider && rider.pos ? rider.pos.x : O.x - s.d * u * .2;
        if (rider && rider.pos && s.d > 0) rider.charge(S.t0, .3, E.x);
        else { const e = pic('cavalry'); if (e) S.sprite({ x: x0, y, size: wide(e, u * .5), flip: s.d, alpha: 0, add: .3, glow: .3, edge: GOLD, z: 2 }, 0, e.id).to({ alpha: .9 }, .05).with({ x: E.x + s.d * u * .25 }, .38, 'in').seek(.3).to({ alpha: 0 }, .1).end(); }
        K.dart(S, x0 + s.d * u * .2, y, E.x + s.d * u * .22, y, .06, .32, { color: GOLD, color2: [.9, .3, .1], width: u * .06, lead: .75 });
        K.dust(S, lerp(x0, E.x, .5), E.bot, 10, [.75, .6, .4], .08, { radius: u * .22, flat: .08, speed: .3, alpha: .35, angle: s.d > 0 ? PI : 0, spread: 1 });
        K.flare(S, E.x, y, u * .2, C.white, .3, .25, 0);
        hit(S, E.x, y, .3, { power: .6, color: GOLD, who: s.e, dx: s.d, angle: s.d > 0 ? 0 : PI, spread: 1.6 });
    });
    // 운명의 처형: 일곱 별이 한 점으로 무너지고 별빛의 칼날이 위에서 떨어진다. 드문 순간이라 곁장면이어도 줄이지 않는다.
    aug('fatalDestiny.execute', { impact: .1, sounds: ['whoosh_heavy', 'blade_finish', 'metal_slam', 'boom_low'] }, S => {
        const s = side(S), u = S.U, E = s.E, top = Math.max(E.top - u * .1, u * .04);
        S.sfx('whoosh_heavy', 0, { vol: .5, rate: .9 }); S.sfx('blade_finish', .1, { vol: .75, rate: .85 }); S.sfx('metal_slam', .12, { vol: .6, rate: .85 }); S.hit('boom_low', .12, { vol: .7 });
        S.dim(.5, 0, .5, E, .06, .35);
        S.field('fatestar', { x: E.x, y: E.y, w: u * .6, h: u * .6, color: lite(FATE, .3), p0: 7, p1: 1, p2: 3, p3: 0, z: 2 }, 0).to({ p3: .92 }, .1, 'in').to({ alpha: 0 }, .05).end();
        S.shape('streak', { x: E.x, y: top, w: u * .04, h: u * .02, rot: PI / 2, color: C.white, alpha: 0, p0: .3, z: 5 }, 0).to({ alpha: 1, w: (E.bot - top) * 2.2, y: (top + E.bot) / 2, h: u * .05 }, .1, 'in').to({ h: u * .004, alpha: 0 }, .3, 'out').end();
        K.beam(S, E.x, top, E.x, E.bot, u * .2, .04, .3, { color: FATE, color2: FATE2, thick: .5, shoot: .06, fall: .2 });
        K.ring(S, E.x, E.bot, u * .6, FATE, .1, { flat: .26, dur: .5 });
        S.burst({ x: E.x, y: E.y, n: 30, t: .1, cell: 'shard', add: .6, color: C.white, color2: FATE, speed: [u * .4, u * 1.3], life: [.5, 1], size: [u * .015, u * .04], grow: .6, drag: 1.2, grav: u * 1.2, spin: 12 });
        S.burst({ x: E.x, y: E.y, n: 14, t: .1, cell: 'star', color: C.white, color2: FATE, speed: [u * .2, u * .7], life: [.6, 1.1], size: [u * .03, u * .06], drag: 2, spin: 6 });
        S.lens('slice', { x: E.x, y: E.y, ang: PI / 2, p0: 0, p1: .004, p2: .9, p3: 0, color: [.3, 0, 0], color2: C.white }, .1).to({ p0: .02 }, .08, 'out3').wait(.12).to({ p0: 0, p2: 0 }, .2).end();
        S.flash(lite(FATE, .5), .14, .25, .1);
        S.pose(s.e, {}, .1).to({ flash: 1, sx: .95 }, .03).to({ flash: 0, sx: 1, dx: s.d * u * .03 }, .12).to({ dx: 0 }, .3).end();
        S.shake(14, .35, .1); S.stop(90, .1);
    });
    // 신성한 번개: 머리 위에 모인 빛이 한 줄기로 떨어지고, 땅에 십자의 빛이 남는다.
    aug('holyLightning', { impact: .16, sounds: ['thunder_crack', 'holy_b'] }, S => {
        const s = side(S), u = s.u, E = s.E, top = Math.max(E.top - u * .16, u * .02), x0 = E.x + s.d * u * .05, c = [1, .95, .7];
        S.hit('thunder_crack', .16, { vol: v(S, .75), cool: 250 }); S.hit('holy_b', .16, { vol: v(S, .28) });
        K.glow(S, x0, top, u * .08, c, 0, .22, .9, 4);
        K.bolt(S, x0, top, E.x, E.y, c, .1, { width: u * .075, color2: [1, .7, .2], jag: .06, flashes: 2 });
        S.shape('streak', { x: E.x, y: (top + E.bot) / 2, w: (E.bot - top) * 1.1, h: u * .1, rot: PI / 2, color: c, alpha: 0, p0: .2, z: 1 }, .12).to({ alpha: .55 }, .04).to({ alpha: 0, h: u * .02 }, .3).end();
        K.flare(S, E.x, E.y, u * .22, C.white, .16, .32, 0);
        K.ring(S, E.x, E.bot, u * .42, GOLD, .16, { flat: .26, dur: .42 });
        K.crack(S, E.x, E.bot, u * .22, .16, .2, { color: [1, .9, .5], color2: [.3, .2, .05], n: 7, flat: .26 });
        K.embers(S, E.x, E.y, 12, c, .18, { radius: u * .1, rise: .8, speed: .5, cell: 'star' });
        hit(S, E.x, E.y, .16, { power: .7, color: c, who: s.e, dx: s.d });
        if (!S.minor) S.flash(c, .1, .2, .16);
    });
    // 취약: 지속 피해가 급소를 찔러, 유리 금 같은 빛이 톡 터진다.
    aug('dotCritical', { impact: .06, sounds: ['bone_crack'] }, S => {
        const s = side(S), u = s.u, E = s.E, x = E.x + (S.rnd(1) - .5) * u * .12, y = E.y + (S.rnd(2) - .5) * u * .14, c = [1, .5, .85];
        S.sfx('bone_crack', .06, { vol: v(S, .45), rate: 1.1, cool: 300 });
        K.crack(S, x, y, u * .11, .02, .12, { color: c, color2: [.3, .02, .2], n: 6, flat: 1, grow: .08, fade: .3 });
        K.flare(S, x, y, u * .12, C.white, .06, .22, .8);
        S.burst({ x, y, n: 9, t: .06, cell: 'shard', add: .7, color: C.white, color2: c, speed: [u * .2, u * .6], life: [.3, .55], size: [u * .01, u * .024], grav: u * 1.2, spin: 12, drag: 1.5 });
    });
    // 꺼지지 않는 불꽃: 흰 심지에 푸른 밑동. 전투가 시작되면 불씨 하나가 날아가 대상의 발밑에서 치솟는다.
    aug('eternalFlame.ignite', { impact: .3, sounds: ['fire_whoosh', 'fire_big'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E;
        S.hit('fire_whoosh', .3, { vol: v(S, .55) }); S.hit('fire_big', .3, { vol: v(S, .55) });
        K.dart(S, O.x + s.d * u * .08, O.y, E.x, E.bot - u * .03, 0, .34, { color: ETERNAL, color2: ETERNAL2, width: u * .05, lift: u * .2, lead: .8 });
        K.fire(S, E.x, E.bot, u * .42, E.h * 1.05, .3, .75, { color: ETERNAL, color2: ETERNAL2, speed: 3.2, fat: 1.1 });
        K.ring(S, E.x, E.bot, u * .4, ETERNAL, .3, { flat: .26, dur: .45, color2: ETERNAL2 });
        K.embers(S, E.x, E.y, 18, ETERNAL, .32, { radius: u * .14, rise: 1, speed: .5, over: .3 });
        hit(S, E.x, E.bot - u * .08, .3, { power: .35, color: ETERNAL, who: s.e, dx: s.d });
    });
    aug('eternalFlame', { impact: .06, sounds: ['flame_burst'] }, S => {
        const s = side(S), u = s.u, E = s.E;
        S.hit('flame_burst', .1, { vol: .3, rate: 1.15, cool: 500 });
        K.fire(S, E.x, E.bot, u * .3, E.h * .6, 0, .42, { color: ETERNAL, color2: ETERNAL2, speed: 3, rise: .1, fall: .26 });
        K.embers(S, E.x, E.bot - u * .1, 7, ETERNAL, .04, { radius: u * .09, rise: .9, speed: .4 });
        S.pose(s.e, { flash: .25 }, .06).to({ flash: 0 }, .16).end();
    });
    // 리플레이: 시간을 한 뼘 되감는 고리가 주인을 거꾸로 감고, 방금의 몸짓이 잔상으로 따라온다.
    aug('replay', { impact: .1, sounds: ['tape_rewind'] }, S => {
        const s = side(S), u = s.u, O = s.O;
        S.sfx('tape_rewind', 0, { vol: v(S, .42), rate: 1.6, cool: 400 });
        S.field('clockface', { x: O.x, y: O.y, w: u * .1, h: u * .1, color: TIME, color2: dark(TIME), p0: 0, p1: 0, p2: 1, z: 0 }, 0).to({ w: u * .46, h: u * .46, p1: .8 }, .12, 'out3').with({ p0: -TAU * 2 }, .5, 'out').seek(.3).to({ p1: 0 }, .25).end();
        [0, PI].forEach((a, i) => K.stroke(S, 'energy', path.arc(O.x, O.y, u * .2, u * .26, a + 2.4, a - 2.4), i * .04, .4, { color: TIME, color2: [.4, .3, 1], width: u * .035, lead: .6, lag: .4, trail: .6, props: { seg: 30 } }));
        [-1, 1].forEach(k => S.shape('streak', { x: O.x - s.d * u * .04 * k, y: O.y, w: u * .1, h: O.h * .7, rot: 0, color: TIME, alpha: .0, p0: .35, z: 1 }, .04).to({ alpha: .35, x: O.x - s.d * u * (.09 + .05 * k) }, .1, 'out').to({ alpha: 0, x: O.x }, .22, 'in').end());
    });
    // 선택의 시간.
    aug('timeOfChoice.mark', { impact: .12, sounds: ['stamp'] }, S => {
        const s = side(S), u = s.u, E = s.E, m = markAt(s);
        S.sfx('stamp', .1, { vol: v(S, .55) });
        K.ring(S, m.x, m.y, u * .16, BLOOD, .12, { dur: .3, th: .1 }); K.ring(S, m.x, m.y, u * .12, C.leaf, .16, { dur: .3, th: .1 });
        K.dart(S, E.x - s.d * u * .2, m.y - u * .2, m.x, m.y, 0, .14, { color: BLOOD, width: u * .03, lead: .8 }); K.dart(S, E.x + s.d * u * .2, m.y - u * .2, m.x, m.y, 0, .14, { color: C.leaf, width: u * .03, lead: .8 });
        K.sparks(S, m.x, m.y, 10, C.white, .12, { speed: .5, grav: 0 });
    });
    aug('timeOfChoice.burst', { impact: .12, sounds: ['glass_b', 'boom_b'] }, S => {
        const s = side(S), u = s.u, E = s.E, m = markAt(s);
        S.sfx('glass_b', .1, { vol: v(S, .5) }); S.sfx('boom_b', .12, { vol: v(S, .58) });
        K.dart(S, m.x, m.y, E.x, E.y, .02, .14, { color: BLOOD, color2: C.wine, width: u * .08, lead: .8 });
        K.rays(S, E.x, E.y, u * .56, .12, .36, { color: BLOOD, color2: C.wine, n: 8, sharp: .8 });
        S.burst({ x: E.x, y: E.y, n: 22, t: .12, cell: 'shard', add: .55, color: [1, .7, .65], color2: BLOOD, speed: [u * .4, u * 1.2], life: [.4, .8], size: [u * .014, u * .036], grow: .6, drag: 1.4, grav: u * 1.4, spin: 12 });
        hit(S, E.x, E.y, .12, { power: .75, color: BLOOD, who: s.e, dx: s.d });
    });
    aug('timeOfChoice.heal', { impact: .12, sounds: ['heal_a'] }, S => {
        const s = side(S), u = s.u, O = s.O, m = markAt(s), c = [.55, 1, .7];
        S.hit('heal_a', .5, { vol: v(S, .45) });
        K.ring(S, m.x, m.y, u * .14, c, .04, { dur: .3, th: .1 });
        flow(S, m.x, m.y, O.x, O.y, 26, c, .06, { radius: u * .05, life: [.4, .62], over: .2 });
        K.stroke(S, 'energy', path.bow(m.x, m.y, O.x, O.y, u * .14), .06, .5, { color: c, color2: C.moss, width: u * .035, lead: .7, lag: .4, trail: .55 });
        K.aura(S, O.x, O.bot, u * .28, O.h * .9, .46, .6, { color: c, color2: C.moss, alpha: .6 });
        K.ring(S, O.x, O.bot, u * .3, c, .5, { flat: .26, dur: .4 });
        K.embers(S, O.x, O.y, 12, c, .5, { radius: u * .12, rise: .8, speed: .4, cell: 'star' });
    });
    // 이기어검술: 뽑혀 나온 세 자루가 적에게 날아가 몸 둘레의 궤도에 든다. 검 자체는 지속 상태 연출이 날린다.
    aug('flyingSword.summon', { impact: .1, sounds: ['sword_draw', 'blade_ring'] }, S => {
        const s = side(S), u = s.u, d = s.d, O = s.O, E = s.E, ring = swordRing(E, S.U);
        S.sfx('sword_draw', 0, { vol: v(S, .55) }); S.sfx('blade_ring', .28, { vol: v(S, .3), rate: 1.15 });
        for (let i = 0; i < 3; i++) K.dart(S, O.x + d * O.w * .3, O.top + O.h * .22, ring.x + Math.cos(i * 2.1 + 2.6) * ring.rx, ring.y + Math.sin(i * 2.1 + 2.6) * ring.ry, i * .09, .44, { color: SOUL, color2: SOUL2, width: u * .024, lift: u * .09, lead: .8 });
        S.shape('ring', { x: ring.x, y: ring.y, w: ring.rx * 1.1, h: ring.ry * 1.1, color: SOUL, alpha: 0, p0: .9, p1: .08, z: 1 }, .32).to({ alpha: .85, w: ring.rx * 2.1, h: ring.ry * 2.1 }, .22, 'out3').to({ alpha: 0 }, .4).end();
        K.sparks(S, ring.x, ring.y, 8, STEEL, .5, { speed: .4, grav: -.2 });
    });
    // 떠다니는 검: 궤도를 돌던 한 자루가 옆으로 빠져 적을 겨눈 뒤, 몸을 곧게 꿰뚫고 반대편으로 사라진다.
    aug('flyingSword', { impact: .2, sounds: ['swish_s', 'stab', 'blade_cut_a'] }, S => {
        const s = side(S), u = s.u, E = s.E, ring = swordRing(E, S.U), it = s.st && !S.scene.mirror ? s.st.items.get('flyingSword') : null, from = it && it.take ? it.take() : null, e = pic('sword');
        const sg = from ? (from.x < ring.x ? -1 : 1) : S.rnd(1) < .5 ? -1 : 1, y0 = ring.y - u * .02 + (S.rnd(3) - .5) * u * .1, y1 = y0 + (S.rnd(4) - .5) * u * .1, ym = (y0 + y1) / 2;
        const x0 = ring.x + sg * ring.rx * 1.15, x1 = ring.x - sg * ring.rx * 1.45, ang = Math.atan2(y1 - y0, x1 - x0), start = from || { x: x0, y: y0 - u * .06, rot: 0 };
        S.sfx('swish_s', .12, { vol: v(S, .32), rate: 1.2, cool: 200 }); S.sfx('blade_cut_a', .16, { vol: v(S, .34), rate: 1.15, cool: 200 }); S.sfx('stab', .2, { vol: v(S, .62), cool: 200 });
        if (e) S.sprite({ x: start.x, y: start.y, size: tall(e, S.U * .27), rot: start.rot, alpha: from ? .95 : 0, glow: .6, edge: SOUL, z: 4 }, 0, e.id)
            .to({ x: x0 + sg * u * .03, y: y0, rot: wrap(ang + PI / 2), alpha: 1 }, .13, 'out').wait(.03).to({ x: x1, y: y1 }, .09, 'lin').to({ alpha: 0, x: x1 - sg * u * .06 }, .1, 'out').end();
        K.dart(S, x0, y0, x1, y1, .16, .12, { color: C.white, color2: SOUL, width: u * .03, lead: .8 });
        // 꿰뚫은 자리에 남는 한 줄의 빛.
        S.shape('streak', { x: ring.x, y: ym, w: u * .04, h: u * .014, rot: ang, color: lite(SOUL, .5), alpha: 0, p0: .3, z: 5 }, .19).to({ alpha: 1, w: ring.rx * 2.5 }, .05, 'out3').to({ alpha: 0, h: u * .002 }, .28, 'in').end();
        K.sparks(S, ring.x - sg * E.w * .3, lerp(y0, y1, .6), 8, SOUL, .22, { speed: 1, angle: ang, spread: .7 });
        hit(S, E.x, ym, .2, { power: .45, color: SOUL, who: s.e, dx: -sg, rot: ang });
    });
    // 결투 신청: 그 전투의 첫 일반 스킬에 얹힌다. 던진 장갑이 적의 발치에 떨어지고, 거기서 내 발밑까지 바닥에 결투선이 그어지며 둘 사이에서 세검이 맞물린다.
    // 곧바로 적의 반격(duelChallenge.counter)과 서로의 가속(duelChallenge.haste)이 같은 적 사건에 실려 온다. 셋이 차례로 닿아 한 번의 결투로 읽힌다.
    const DUEL = [1, .86, .55], DUEL2 = [.95, .28, .22];
    aug('duelChallenge', { impact: .2, images: ['paint:aug-duel'], sounds: ['sword_draw', 'glove_slap', 'land_thud'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, d = s.d, ground = Math.max(O.bot, E.bot) - u * .015, mx = (O.x + E.x) / 2, my = (O.y + E.y) / 2 - u * .08;
        const gx = E.x - d * E.w * .45, fly = path.bow(O.x + d * O.w * .4, O.top + O.h * .35, gx, ground, u * .22);
        S.sfx('sword_draw', 0, { vol: v(S, .42), rate: 1.1 }); S.sfx('glove_slap', .2, { vol: v(S, .62) }); S.sfx('land_thud', .2, { vol: v(S, .34), rate: 1.2 });
        // 던져진 장갑: 구르며 높은 포물선을 그린다.
        S.shape('shard', { x: fly(0)[0], y: fly(0)[1], w: u * .05, h: u * .036, color: [1, .96, .86], alpha: 1, add: .25, z: 4 }, 0).tick((p, t) => { const k = clamp(t / .2), q = fly(k * k); p.x = q[0]; p.y = q[1]; p.rot = t * 34; }).wait(.2).to({ alpha: 0 }, .3).end();
        K.stroke(S, 'energy', fly, 0, .3, { color: DUEL, color2: [.6, .4, .15], width: u * .03, lead: .66, lag: .4, trail: .6, ease: 'in' });
        K.dust(S, gx, ground, 8, [.8, .74, .62], .2, { radius: u * .06, flat: .1, speed: .3, alpha: .4 });
        K.ring(S, gx, ground, u * .22, DUEL, .2, { flat: .26, dur: .3 });
        // 결투선: 장갑이 떨어진 자리에서 번져 두 사람의 발밑을 잇는다.
        S.shape('streak', { x: gx, y: ground, w: u * .02, h: u * .014, color: C.white, alpha: 0, p0: .2, z: 1 }, .2).to({ alpha: .9, x: mx, w: Math.abs(E.x - O.x) * 1.15 }, .14, 'out3').wait(.3).to({ alpha: 0, h: u * .004 }, .4).end();
        // 맞물리는 세검.
        S.sprite({ x: mx, y: my, size: u * .34, sx: 1.7, sy: 1.7, rot: -.5 * d, alpha: 0, glow: .6, edge: DUEL, z: 4 }, .24, 'paint:aug-duel').to({ sx: 1, sy: 1, rot: 0, alpha: 1 }, .1, 'in3').set({ flash: .9 }).to({ flash: 0 }, .14).wait(.2).to({ alpha: 0, sx: 1.15, sy: 1.15 }, .25, 'in').end();
        K.flare(S, mx, my, u * .2, C.white, .34, .3, .78); K.sparks(S, mx, my, 12, DUEL, .34, { speed: .8 });
        S.pose(s.e, { flash: .4 }, .2).to({ flash: 0 }, .15).end();
    });
    // 적의 즉시 반격: 찔러 들어온 칼끝을 받아 흘린다. 칼빛의 대부분은 비껴 위로 흩어지고(피해 -75%), 가는 한 줄만 몸에 닿는다.
    aug('duelChallenge.counter', { impact: .16, sounds: ['blade_cut_b', 'blade_clash', 'shield_block'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, d = s.d, y = O.y - u * .03, px = O.x + d * O.w * .55, face = d > 0 ? 0 : PI;
        S.sfx('blade_cut_b', .04, { vol: v(S, .45), rate: 1.1 }); S.sfx('blade_clash', .16, { vol: v(S, .66) }); S.sfx('shield_block', .16, { vol: v(S, .3), rate: 1.1 });
        K.dart(S, E.x - d * E.w * .4, E.y - u * .02, px, y, .04, .14, { color: lite(DUEL2, .4), color2: DUEL2, width: u * .05, lead: .6 });
        // 받아낸 자리의 금빛 호와, 비껴 나간 세 갈래.
        K.slash(S, px - d * u * .03, y, u * .15, face - 1.15, face + 1.15, .1, .22, { color: lite(DUEL, .5), color2: DUEL, flat: .95, w: .32 });
        for (let i = 0; i < 3; i++) K.dart(S, px, y, px + d * u * (.1 + i * .08), y - u * (.22 + i * .05), .16, .24, { color: lite(DUEL2, .5), color2: dark(DUEL2, .5), width: u * (.03 - i * .006), lead: .5 });
        K.flare(S, px, y, u * .16, C.white, .16, .22, .4);
        K.sparks(S, px, y, 12, DUEL, .16, { speed: 1, angle: -PI / 2 + d * .5, spread: 1.2 });
        hit(S, O.x, y, .18, { power: .3, color: DUEL2, who: s.o, dx: -d });
    });
    // 서로 가속: 맞물렸던 세검이 튕겨 돌며 떠오르고, 두 사람의 발밑에서 바람이 감겨 오른다. 반격이 닿은 바로 뒤에 시작하고, 이어지는 10초는 지속 상태가 그린다.
    aug('duelChallenge.haste', { impact: .16, images: ['paint:aug-duel'], sounds: ['whoosh_heavy', 'wing_flap'] }, S => {
        const s = side(S), u = S.U, O = s.O, E = s.E, d = s.d, T = .3, mx = (O.x + E.x) / 2, my = (O.y + E.y) / 2 - u * .08;
        S.sfx('whoosh_heavy', T, { vol: .5, rate: 1.35 }); S.sfx('wing_flap', T + .06, { vol: .4, rate: 1.2 });
        S.sprite({ x: mx, y: my, size: u * .3, alpha: 0, glow: .7, edge: DUEL, z: 4 }, T - .06, 'paint:aug-duel').to({ alpha: 1 }, .06).to({ rot: d * TAU, sx: .55, sy: .55, y: my - u * .1 }, .36, 'out').with({ alpha: 0 }, .36, 'in').end();
        [O, E].forEach((B, i) => {
            const c = i ? DUEL2 : DUEL, t0 = T + i * .05, r = Math.max(B.w * .5, u * .11);
            for (let j = 0; j < 2; j++) S.trail('energy', { path: k => { const a = j * PI + k * TAU * 1.5; return [B.x + Math.cos(a) * r * (1 - k * .3), lerp(B.bot, B.top, k) + Math.sin(a) * u * .02]; }, width: u * .03, color: lite(c, .4), color2: c, seg: 40, p0: 5, p1: 4, p2: 1, taper: .3, z: 3 }, t0).to({ head: 1 }, .3, 'out').seek(.14).to({ tail: 1 }, .32, 'io').end();
            K.ring(S, B.x, B.bot, Math.max(B.w * 1.3, u * .3), c, t0, { flat: .24, dur: .4, th: .08 });
        });
        S.pose(s.o, { flash: .35 }, T).to({ flash: 0 }, .2).end(); S.pose(s.e, { flash: .35 }, T + .05).to({ flash: 0 }, .2).end();
    });
    // 원펀치 룰: 매 일반 공격에 붙는다. 짧고 묵직하게, 공기가 한 번 눌렸다 터진다.
    aug('onePunch', { impact: .1, sounds: ['punch_heavy', 'punch_body'] }, S => {
        const s = side(S), u = s.u, E = s.E, c = [1, .5, .25], a = s.d > 0 ? 0 : PI;
        S.sfx('punch_heavy', .1, { vol: v(S, .72) }); S.sfx('punch_body', .1, { vol: v(S, .5), cool: 90 });
        S.shape('sonic', { x: E.x - s.d * u * .02, y: E.y, w: u * .5, h: u * .5, rot: a, color: c, alpha: .9, p0: 0, p1: .9, p2: 14, z: 3 }, .08).tick((p, t) => { p.p0 = t * 46; }).to({ w: u * .8, h: u * .8, alpha: 0 }, .24, 'out3').end();
        K.ring(S, E.x, E.y, u * .34, c, .1, { th: .2, dur: .3 }); K.ring(S, E.x, E.y, u * .2, C.white, .1, { th: .1, dur: .2, dust: 0 });
        K.glow(S, E.x, E.y, u * .1, C.white, .1, .14, .9);
        K.sparks(S, E.x, E.y, 14, c, .1, { speed: 1.3, angle: a, spread: 1.8 });
        S.pose(s.e, { flash: .7 }, .1).to({ dx: s.d * S.U * .045, sx: .93, sy: 1.05, flash: 0 }, .05, 'out3').to({ dx: 0, sx: 1, sy: 1 }, .3, 'elastic').end();
        if (!S.minor) { S.shake(9, .22, .1); S.stop(55, .1); }
    });
    aug('onePunch.counter', { impact: .1, sounds: ['punch_body', 'glove_slap'] }, S => {
        const s = side(S), u = s.u, O = s.O, c = [1, .55, .45];
        S.sfx('punch_body', .1, { vol: v(S, .55), rate: .9 }); S.sfx('glove_slap', .1, { vol: v(S, .32), rate: .85 });
        // 맞는 자리는 주인이 지금 서 있는 곳이다. 검무처럼 주인이 자리를 떠나 있으면 그 몸짓만큼 따라간다(맞는 순간에 읽는다).
        S.at(.1, () => {
            const live = S.host && S.host.pose ? S.host.pose('me') : null, m = S.scene.mirror ? -1 : 1, x = O.x + (live ? live.dx * m : 0), y = O.y + (live ? live.dy : 0);
            K.ring(S, x, y, u * .24, c, .1, { th: .18, dur: .26 }); K.sparks(S, x, y, 10, c, .1, { speed: 1, angle: s.d > 0 ? PI : 0, spread: 1.8 });
        });
        S.pose(s.o, { flash: .5 }, .1).to({ dx: -s.d * S.U * .03, flash: 0 }, .05, 'out3').to({ dx: 0 }, .22, 'elastic').end();
        if (!S.minor) S.shake(5, .16, .1);
    });
    // 주문의 계절: 사계의 바퀴가 한 칸 돌고, 새 계절이 주인을 감싼다.
    function season(index) {
        const name = SEASONS[index], c = SEASON[name], sounds = [['bird_call', 'plant_b', 'whoosh_heavy'], ['flame_burst', 'cicada', 'whoosh_heavy'], ['leaf_rustle', 'wind_a', 'whoosh_heavy'], ['ice_crack', 'wind_b', 'whoosh_heavy']][index];
        aug('seasons.' + name, { impact: .1, sounds }, S => {
            const s = side(S), u = s.u, O = s.O, wy = Math.max(O.top - u * .02, u * .12);
            S.sfx('whoosh_heavy', 0, { vol: v(S, .3), rate: 1.1 + index * .06 });
            S.field('seasonwheel', { x: O.x - s.d * (O.w * .5 + u * .08), y: O.top + O.h * .16, w: u * .12, h: u * .12, p0: (index - 1) * PI / 2, p1: 0, z: 5 }, 0).to({ w: u * .3, h: u * .3, p1: 1 }, .12, 'out3').to({ p0: index * PI / 2 }, .26, 'back').wait(.25).to({ p1: 0, w: u * .36, h: u * .36 }, .25, 'in').end();
            K.ring(S, O.x, O.bot, u * .42, c, .2, { flat: .26, dur: .5 });
            if (index === 0) {           // 봄: 덩굴이 감겨 오르고 꽃잎이 흩날린다
                S.hit('plant_b', .34, { vol: v(S, .3) }); S.sfx('bird_call', .08, { vol: v(S, .42) });
                [0, PI].forEach(a => K.stroke(S, 'energy', path.helix(O.x, O.bot, O.top + O.h * .2, u * .16, a, 1.4, .3), .16, .6, { color: [.6, 1, .55], color2: C.moss, width: u * .03, lead: .7, lag: .5, trail: .5, props: { seg: 40 } }));
                S.burst({ x: O.x, y: O.y, n: 26, t: .28, cell: 'petal', add: .25, color: [1, .85, .92], color2: c, radius: u * .16, speed: [u * .1, u * .45], angle: -PI / 2, spread: 2.6, life: [.7, 1.3], size: [u * .02, u * .038], grow: .8, drag: 1.5, grav: u * .25, spin: 7, turb: u * .1, over: .3 });
                for (let i = 0; i < 3; i++) S.field('flowerbloom', { x: O.x + (i - 1) * u * .13, y: O.bot - u * .03 - (i % 2) * u * .02, w: u * .1, h: u * .1, color: c, color2: [.9, .3, .55], p0: 0, p1: 5, p2: .6, add: .15, seed: i * .3, z: 3 }, .3 + i * .07).to({ p0: 1 }, .22, 'back').wait(.25).to({ alpha: 0, p0: 1.2 }, .3).end();
            } else if (index === 1) {    // 여름: 한낮의 해가 머리 위에 뜨고 열기가 오른다
                S.hit('flame_burst', .3, { vol: v(S, .45) }); S.sfx('cicada', .04, { vol: v(S, .3) });
                K.rays(S, O.x, wy, u * .5, .2, .7, { color: c, color2: EMBER, n: 10, spin: 1.5, sharp: .7 });
                K.aura(S, O.x, O.bot, u * .34, O.h * 1.05, .22, .7, { color: c, color2: EMBER, alpha: .7, speed: 3 });
                K.embers(S, O.x, O.bot - u * .06, 20, c, .24, { radius: u * .16, flat: .3, rise: 1, speed: .5, over: .3, cell: 'flame', size: [u * .014, u * .03] });
            } else if (index === 2) {    // 가을: 낙엽의 회오리
                S.hit('wind_a', .3, { vol: v(S, .32) }); S.sfx('leaf_rustle', .12, { vol: v(S, .45) });
                S.field('vortex', { x: O.x, y: O.bot - u * .02, w: u * .2, h: u * .06, color: c, color2: [.5, .15, .02], p0: 1.4, p1: 3, p2: 5, p3: .12, alpha: 0, z: 0 }, .16).to({ alpha: .7, w: u * .6, h: u * .18 }, .2, 'out').wait(.2).to({ alpha: 0 }, .3).end();
                [0, PI].forEach(a => K.stroke(S, 'energy', path.helix(O.x, O.bot, O.top + O.h * .1, u * .2, a, 2.2, .3), .16, .7, { color: [1, .7, .3], color2: [.6, .2, .02], width: u * .024, lead: .7, lag: .5, trail: .5, props: { seg: 48 } }));
                S.burst({ x: O.x, y: O.top + O.h * .55, n: 34, t: .2, cell: 'petal', add: .2, color: [1, .8, .35], color2: [.85, .3, .05], radius: u * .2, speed: [u * .15, u * .5], life: [.8, 1.4], size: [u * .03, u * .055], grow: .8, drag: 1.2, grav: u * .12, spin: 10, turb: u * .2, over: .4 });
            } else {                     // 겨울: 서리 결정이 발밑에서 돋고 눈이 내린다
                S.sfx('ice_crack', .3, { vol: v(S, .5) }); S.sfx('wind_b', .05, { vol: v(S, .26) });
                for (let i = 0; i < 5; i++) K.crystal(S, O.x + (i - 2) * u * .075, O.bot, u * .07, u * (.14 + (i % 2) * .08), .2 + i * .03, .3, { lean: (i - 2) * .12 }).to({ alpha: 0 }, .3).end();
                S.burst({ x: O.x, y: O.top, n: 26, t: .2, cell: 'star', color: C.white, color2: c, radius: u * .22, flat: .2, speed: [0, u * .1], vy: u * .3, life: [.9, 1.5], size: [u * .02, u * .042], grow: .7, turb: u * .08, spin: 4, over: .4 });
                K.aura(S, O.x, O.bot, u * .3, O.h, .2, .8, { color: c, color2: [.1, .3, .8], alpha: .45, speed: 1.2 });
            }
        });
    }
    [0, 1, 2, 3].forEach(season);
    aug('seasons.burn', { impact: .06, sounds: ['flame_burst'] }, S => {
        const s = side(S), u = s.u, E = s.E, c = SEASON.summer;
        S.hit('flame_burst', .1, { vol: .27, rate: .95, cool: 500 });
        K.flare(S, E.x, E.y - u * .06, u * .14, c, .02, .3, .4);
        K.fire(S, E.x, E.bot, u * .26, E.h * .5, 0, .4, { color: c, color2: EMBER, rise: .1, fall: .24 });
        K.embers(S, E.x, E.y, 8, c, .04, { radius: u * .1, rise: .9, speed: .4, cell: 'flame', size: [u * .012, u * .024] });
        S.pose(s.e, { flash: .2 }, .06).to({ flash: 0 }, .16).end();
    });
    // 변속으로 만든 확정 치명타: 톱니가 맞물리며 한 단 올라가고, 톱니 모양의 충격이 대상에 박힌다.
    aug('manualShift.crit', { impact: .14, sounds: ['gear_shift', 'blade_cut_c'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, c = [1, .78, .4], gx = O.x + s.d * u * .1, gy = O.y + u * .08;
        S.hit('gear_shift', .14, { vol: v(S, .55) }); S.sfx('blade_cut_c', .14, { vol: v(S, .5) });
        S.field('cog', { x: gx, y: gy, w: u * .12, h: u * .12, color: c, color2: [.35, .2, .05], p0: 8, p1: 0, p2: 1, z: 4 }, 0).to({ p1: TAU, w: u * .16, h: u * .16 }, .12, 'in').to({ alpha: 0, x: lerp(gx, E.x, .3) }, .06).end();
        K.dart(S, gx, gy, E.x, E.y, .06, .16, { color: c, color2: C.amber, width: u * .06, lead: .7 });
        S.field('cog', { x: E.x, y: E.y, w: u * .16, h: u * .16, color: C.white, color2: c, p0: 10, p1: 0, p2: 1, z: 3 }, .14).to({ w: u * .62, h: u * .62, p1: 1.2, alpha: 0 }, .34, 'out3').end();
        hit(S, E.x, E.y, .14, { power: .7, color: c, who: s.e, dx: s.d });
    });
    // 움직일수록 깊게: 첫 일격이 몸통에 비스듬한 칼자국을 긋는다. 처음에는 한 뼘만 벌어지고, 나머지는 찢어질 자리로 남는다(지속 상태 연출).
    aug('deepeningBleed.apply', { impact: .1, sounds: ['blade_cut_b', 'flesh_rip'] }, S => {
        const s = side(S), u = s.u, E = s.E, g = gashAt(E, S.U), cx = Math.cos(g.rot), cy = Math.sin(g.rot), x0 = g.x - cx * g.len * .5, y0 = g.y - cy * g.len * .5;
        S.sfx('blade_cut_b', .04, { vol: v(S, .5) }); S.sfx('flesh_rip', .08, { vol: v(S, .42) });
        K.dart(S, x0 - cx * u * .1, y0 - cy * u * .1, g.x + cx * g.len * .62, g.y + cy * g.len * .62, .02, .16, { color: [1, .7, .7], color2: BLOOD, width: u * .045, lead: .8 });
        S.shape('streak', { x: x0, y: y0, w: u * .02, h: u * .03, rot: g.rot, color: C.white, alpha: 0, p0: .3, z: 5 }, .05).to({ alpha: 1, x: g.x, y: g.y, w: g.len * 1.5 }, .06, 'out3').to({ alpha: 0, h: u * .003 }, .24, 'in').end();
        S.burst({ x: x0 + cx * g.len * .1, y: y0 + cy * g.len * .1, n: 10, t: .1, cell: 'drop', add: .1, color: [1, .25, .25], color2: C.wine, angle: PI / 2 - .4, spread: 1.4, speed: [u * .2, u * .7], life: [.4, .8], size: [u * .012, u * .028], grav: u * 2.4, stretch: .6, drag: .8 });
        hit(S, x0 + cx * g.len * .12, y0 + cy * g.len * .12, .1, { power: .4, color: BLOOD, who: s.e, dx: s.d });
    });
    // 적이 움직일 때마다 상처가 한 마디씩 더 찢어진다. 뒤로 갈수록 크게 터지고 크게 휘청인다.
    aug('deepeningBleed', { impact: .06, sounds: ['blood_squirt', 'flesh_rip'] }, S => {
        const s = side(S), u = s.u, E = s.E, g = gashAt(E, S.U), it = s.st ? s.st.items.get('deepeningBleed') : null, k = it ? clamp((5 - (it.d.left || 0)) / 5, .2, 1) : .6;
        const cx = Math.cos(g.rot), cy = Math.sin(g.rot), f = .3 + .7 * k - .5, x = g.x + cx * g.len * f, y = g.y + cy * g.len * f;
        S.sfx('flesh_rip', .02, { vol: v(S, .14 + .2 * k), rate: 1.5 - .4 * k, cool: 200 }); S.sfx('blood_squirt', .04, { vol: v(S, .22 + .25 * k), rate: 1.15 - .3 * k, cool: 200 });
        S.shape('streak', { x: x - cx * g.len * .16, y: y - cy * g.len * .16, w: u * .02, h: u * (.02 + .03 * k), rot: g.rot, color: [1, .8, .75], alpha: 1, p0: .3, z: 5 }, 0).to({ x, y, w: g.len * (.3 + .3 * k) }, .06, 'out3').to({ alpha: 0, h: u * .003 }, .2, 'in').end();
        K.glow(S, x, y, u * (.05 + .08 * k), BLOOD, .04, .3, .7);
        S.burst({ x, y, n: Math.round(5 + k * 15), t: .06, cell: 'drop', add: .1, color: [1, .25, .25], color2: C.wine, angle: PI / 2 - .3, spread: 1.2 + k, speed: [u * .12, u * (.35 + .6 * k)], life: [.4, .8], size: [u * .012, u * (.022 + .016 * k)], grav: u * 2.2, stretch: .6 });
        S.pose(s.e, { flash: .2 + .3 * k }, .06).to({ dx: s.d * S.U * (.006 + .02 * k), rot: s.d * .05 * k, flash: 0 }, .05).to({ dx: 0, rot: 0 }, .18).end();
        if (k >= .8 && !S.minor) S.shake(3 + 4 * k, .16, .06);
    });
    // 영혼 수확자: 허공에서 나타난 낫이 쓰러진 적을 아래에서 위로 걷어 올리고, 날에 걸려 나온 혼불이 주인 곁의 낫으로 날아든다.
    aug('soulReaper.harvest', { impact: .1, sounds: ['swish_c', 'soul_breath', 'soul_hit', 'heal_b'] }, S => {
        const s = side(S), u = s.u, d = s.d, O = s.O, E = s.E, e = pic('scythe'), L = clamp(E.h * 1.1, u * .34, u * .5), R = L * BLADE_R;
        const px = E.x - d * R * .8, py = E.y + R * .45, A0 = 1.7, A1 = -1.3, sx = E.x + d * u * .02, sy = E.y - u * .08, home = soulHome(O, S.U, d), fly = path.bow(sx, sy, home.x, home.y, u * .22, 0);
        S.sfx('swish_c', .06, { vol: v(S, .4), rate: .8 }); S.sfx('soul_breath', .1, { vol: v(S, .42) }); S.sfx('soul_hit', .8, { vol: v(S, .45) }); S.hit('heal_b', .8, { vol: v(S, .22) });
        if (e) S.sprite({ x: px, y: py, size: tall(e, L), pivot: SCYTHE_PIVOT, flip: d, rot: d * A0, alpha: 0, add: .5, glow: .5, edge: SOUL, tint: [.7, .95, 1], z: 3 }, 0, e.id)
            .tick((p, t) => { p.rot = d * lerp(A0, A1, S.ease.io(clamp((t - .02) / .2))); }).to({ alpha: .9 }, .05).wait(.2).to({ alpha: 0 }, .16).end();
        S.trail('slash', { path: k => { const a = BLADE_A + lerp(A0, A1, k); return [px + d * Math.cos(a) * R, py + Math.sin(a) * R]; }, width: R * .5, color: C.white, color2: SOUL, p0: 5, p1: 3, p2: .8, taper: .5, seg: 30, z: 3.5 }, .02).to({ head: 1 }, .2, 'io').seek(.1).to({ tail: 1 }, .22, 'io').end();
        K.glow(S, E.x, E.y, u * .16, SOUL, .1, .4, .7);
        ride(K.orb(S, sx, sy, u * .034, .14, { color: SOUL, color2: SOUL2, spin: 4, z: 4 }), fly, .6, k => k * k * (3 - 2 * k)).wait(.6).to({ alpha: 0, w: u * .3, h: u * .3 }, .12).end();
        K.stroke(S, 'energy', fly, .14, .78, { color: SOUL, color2: SOUL2, width: u * .045, lead: .78, lag: .3, trail: .7, ease: 'io', props: { seg: 40 } });
        flow(S, E.x, E.y, home.x, home.y, 14, SOUL, .16, { life: [.5, .72], over: .3, radius: u * .1 });
        K.ring(S, home.x, home.y, u * .16, SOUL, .74, { dur: .36, th: .1 });
        K.aura(S, O.x, O.bot, u * .26, O.h * .85, .72, .6, { color: [.6, 1, .85], color2: SOUL2, alpha: .5 });
    });
    // 악마 사냥꾼: 은빛 말뚝이 비스듬히 날아와 박히고, 검은 기운이 빠져나간다.
    aug('demonHunter', { impact: .14, sounds: ['crossbow', 'bolt_impact', 'holy_a'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, c = [.86, .84, 1], x0 = O.x + s.d * u * .1, y0 = Math.max(O.top - u * .02, u * .1), ang = Math.atan2(E.y - y0, E.x - x0);
        S.sfx('crossbow', .04, { vol: v(S, .6) }); S.sfx('bolt_impact', .14, { vol: v(S, .6), rate: .9 }); S.hit('holy_a', .14, { vol: v(S, .3) });
        K.flare(S, x0, y0, u * .1, c, .02, .16, ang);
        K.beam(S, x0, y0, E.x, E.y, u * .035, .04, .16, { color: C.white, color2: c, thick: .5, shoot: .08, fall: .1 });
        S.shape('flare', { x: E.x, y: E.y, w: u * .1, h: u * .1, color: C.white, alpha: 1, p0: .006, z: 4 }, .14).to({ w: u * .5, h: u * .7 }, .08, 'out3').to({ alpha: 0 }, .3, 'in').end();
        S.field('reticle', { x: E.x, y: E.y, w: u * .5, h: u * .5, color: c, color2: [.4, .3, .8], p0: .3, p1: 2, alpha: .9, z: 2 }, .08).to({ p0: 0, w: u * .2, h: u * .2 }, .08, 'in').to({ alpha: 0 }, .2).end();
        K.dust(S, E.x, E.y, 8, [.3, .1, .45], .16, { speed: .5, alpha: .5, color2: [.08, .02, .12], rise: .3, layer: 1 });
        hit(S, E.x, E.y, .14, { power: .6, color: c, who: s.e, dx: s.d, rot: 0 });
    });
    // 한 칸씩 오르는 검무의 3연격: 세 자루의 검이 한 칸씩 높은 자리를 찌르고, 꽂힌 검이 그대로 세 칸의 계단으로 남는다. 소리도 한 음씩 오른다.
    aug('comboStaircase.3', { impact: .08, sounds: ['blade_cut_a', 'blade_cut_c', 'blade_ring'] }, S => {
        const s = side(S), u = s.u, d = s.d, E = s.E, e = pic('sword'), len = u * .3, rise = Math.min(u * .1, E.h * .22), run = u * .07, PITCH = [1, 1.19, 1.5];
        for (let i = 0; i < 3; i++) {
            const t = .03 + i * .11, hold = .44 - i * .11, y = E.y + rise * (1 - i), x = E.x + d * run * (i - 1), tone = i === 2 ? GOLD : STEEL;
            S.sfx(i === 2 ? 'blade_cut_c' : 'blade_cut_a', t, { vol: v(S, .3 + i * .07), rate: 1 + i * .15, cool: 0 }); S.sfx('blade_ring', t + .05, { vol: v(S, .2 + i * .05), rate: PITCH[i], cool: 0, vary: 0 });
            if (e) S.sprite({ x: x - d * len * 1.4, y, size: tall(e, len), rot: d * PI / 2, alpha: 0, add: .15, glow: .5, edge: tone, z: 4 }, t, e.id).to({ alpha: 1, x: x - d * len * .2 }, .05, 'in').to({ x: x - d * len * .26 }, .08, 'out').wait(hold).to({ alpha: 0, y: y - u * .02 }, .18).end();
            // 디딤판과 챌판: 검이 지나간 자리에 남는 빛의 단.
            S.shape('streak', { x: x - d * len * .5, y, w: u * .02, h: u * .034, color: lite(tone, .4), alpha: 0, p0: .4, z: 3 }, t).to({ alpha: 1, x: x - d * len * .1, w: len * 1.6 }, .05, 'out3').to({ h: u * .009, alpha: .6 }, .1).wait(hold).to({ alpha: 0 }, .2).end();
            if (i < 2) S.shape('streak', { x: x + d * len * .3, y: y - rise / 2, w: rise * 1.3, h: u * .007, rot: PI / 2, color: STEEL, alpha: 0, p0: .4, z: 3 }, t + .08).to({ alpha: .75 }, .04).wait(hold + .04).to({ alpha: 0 }, .2).end();
            K.sparks(S, x + d * len * .24, y, 5 + i * 3, tone, t + .05, { speed: .6 + i * .25, angle: d > 0 ? 0 : PI, spread: 1.2 });
        }
        K.flare(S, E.x + d * (run + len * .24), E.y - rise, u * .16, GOLD, .3, .3, 0);
        K.sparks(S, E.x + d * (run + len * .24), E.y - rise, 10, GOLD, .3, { speed: .9, angle: -PI / 2, spread: 1.6 });
    });
    // 고통스러운 상처.
    aug('painfulWound.apply', { impact: .12, sounds: ['blade_finish', 'flesh_rip', 'growl'] }, S => {
        const s = side(S), u = s.u, E = s.E;
        S.sfx('blade_finish', .06, { vol: v(S, .55) }); S.sfx('flesh_rip', .1, { vol: v(S, .48) }); S.hit('growl', .2, { vol: v(S, .24), rate: 1.2 });
        [[-1, 0], [1, .06]].forEach(([k, t]) => {
            K.stroke(S, 'ink', path.bow(E.x - k * u * .17, E.y - u * .17, E.x + k * u * .17, E.y + u * .17, 0, 0), .04 + t, .4, { color: BLOOD, color2: C.wine, width: u * .09, lead: .25, lag: .55, trail: .9, props: { add: 0, taper: .6 } });
            K.slash(S, E.x, E.y, u * .26, -2.4, -.7, .04 + t, .2, { color: [1, .7, .65], color2: BLOOD, flat: .9, tilt: k > 0 ? .9 : PI - .9 });
        });
        K.crack(S, E.x, E.y, u * .2, .12, .3, { color: BLOOD, color2: C.wine, n: 4, flat: 1, add: .4 });
        S.burst({ x: E.x, y: E.y, n: 18, t: .12, cell: 'drop', add: .1, color: [1, .25, .25], color2: C.wine, speed: [u * .3, u * 1], life: [.4, .8], size: [u * .014, u * .032], grav: u * 2.2, stretch: .6 });
        hit(S, E.x, E.y, .12, { power: .65, color: BLOOD, who: s.e, dx: s.d });
    });
    aug('painfulWound', { impact: .06, sounds: ['blood_squirt'] }, S => {
        const s = side(S), u = s.u, E = s.E;
        S.sfx('blood_squirt', .04, { vol: v(S, .34), rate: 1.1, cool: 300 });
        K.glow(S, E.x, E.y, u * .14, BLOOD, 0, .4, .6);
        S.burst({ x: E.x, y: E.y, n: 8, t: .06, cell: 'drop', add: .1, color: [1, .25, .25], color2: C.wine, angle: PI / 2, spread: 2, speed: [u * .1, u * .45], life: [.4, .7], size: [u * .012, u * .026], grav: u * 2, stretch: .6 });
        S.pose(s.e, { flash: .3 }, .06).to({ flash: 0 }, .18).end();
    });
    // 보호막 흡수: 뜯겨 나온 방벽의 조각이 주인에게 날아와 다시 방벽이 된다.
    aug('shieldSiphon', { impact: .1, sounds: ['glass_b', 'reverse_swell', 'shield_block'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, c = [.45, .9, 1];
        S.sfx('glass_b', .08, { vol: v(S, .32), rate: 1.3 }); S.hit('reverse_swell', .5, { vol: v(S, .3) }); S.sfx('shield_block', .5, { vol: v(S, .42) });
        S.shape('hex', { x: E.x, y: E.y, w: u * .34, h: u * .44, color: c, alpha: .8, p0: 5, p1: .08, p2: .06, z: 3 }, .06).to({ alpha: 0, w: u * .42, h: u * .54 }, .22).end();
        flow(S, E.x, E.y, O.x, O.y, 18, c, .1, { cell: 'shard', life: [.34, .5], size: [u * .016, u * .034], spin: 9, add: .7, radius: u * .1 });
        S.shape('hex', { x: O.x, y: O.y, w: u * .2, h: u * .3, color: c, alpha: 0, p0: 5, p1: .07, p2: .05, z: 3 }, .46).to({ alpha: .8, w: u * .34, h: u * .48 }, .12, 'back').wait(.12).to({ alpha: 0 }, .3).end();
        K.ring(S, O.x, O.y, u * .22, c, .5, { dur: .3, th: .1 });
    });
    // 갑옷 깎아내기 -30%: 금이 끝까지 내려간 방패 문장이 눈앞에 크게 떠올랐다가 두 쪽으로 갈라지며 산산이 터진다.
    aug('armorShred.max', { impact: .12, sounds: ['armor_crack', 'metal_slam', 'rock_break'] }, S => {
        const s = side(S), u = s.u, E = s.E, m = shieldAt(E, S.U);
        S.sfx('armor_crack', .04, { vol: v(S, .5) }); S.sfx('metal_slam', .1, { vol: v(S, .65) }); S.sfx('rock_break', .1, { vol: v(S, .42) });
        S.field('aegis', { x: m.x, y: m.y, w: m.r * 2, h: m.r * 2.3, color: STEEL, color2: SHIELD2, p0: 1, p1: 0, p2: 1, add: 0, z: 6 }, 0).to({ w: m.r * 4.4, h: m.r * 5.06, p2: .2 }, .12, 'out3').to({ p1: 1, w: m.r * 6, h: m.r * 6.9, alpha: 0 }, .26, 'out').end();
        K.crack(S, E.x, E.y, u * .26, .1, .2, { color: [1, .6, .25], color2: [.2, .2, .25], n: 8, flat: 1, add: .5 });
        K.shards(S, m.x, m.y, 24, STEEL, .12, { speed: 1.2, color2: [.4, .45, .55], spread: TAU, size: [u * .016, u * .042], add: .1 });
        K.ring(S, m.x, m.y, u * .34, [1, .6, .25], .12, { dur: .36 });
        hit(S, E.x, E.y, .12, { power: .65, color: STEEL, who: s.e, dx: s.d });
    });
    // 백화요란: 맺혀 있던 꽃이 한꺼번에 피고, 꽃잎의 폭풍이 지나간 뒤 생기가 주인에게 돌아온다.
    aug('hundredFlowers.bloom', { impact: .2, sounds: ['plant_b', 'firework', 'leaf_rustle'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, tones = [ROSE, [1, .8, .9], [.85, .6, 1], [1, .7, .5]];
        S.hit('plant_b', .2, { vol: v(S, .5) }); S.sfx('firework', .2, { vol: v(S, .28), rate: 1.3 }); S.sfx('leaf_rustle', .2, { vol: v(S, .4), rate: .9 });
        for (let i = 0; i < 8; i++) {
            const p = flowerSlot(E, i), t = .04 + (i % 4) * .045 + (i > 3 ? .02 : 0), tone = tones[i % 4], size = u * (.15 + (i % 3) * .035);
            S.field('flowerbloom', { x: p.x, y: p.y, w: size * .5, h: size * .5, color: tone, color2: [.75, .15, .4], p0: .3, p1: 5 + (i % 3), p2: (i % 2 ? 1 : -1) * 1.2, add: .2, seed: i * .13, z: 3 }, t).to({ p0: 1, w: size, h: size }, .2, 'back').wait(.1).to({ alpha: 0, w: size * 1.5, h: size * 1.5, p0: 1.25 }, .26, 'in').end();
            S.burst({ x: p.x, y: p.y, n: 7, t: t + .16, cell: 'petal', add: .25, color: lite(tone, .4), color2: tone, speed: [u * .25, u * .8], life: [.7, 1.3], size: [u * .022, u * .042], grow: .8, drag: 1.6, grav: u * .35, spin: 9, turb: u * .12, seed: i });
        }
        K.glow(S, E.x, E.y, u * .4, ROSE, .18, .5, .5, 0);
        K.ring(S, E.x, E.y, u * .5, ROSE, .2, { dur: .5, th: .1, color2: [.8, .3, .6] });
        hit(S, E.x, E.y, .2, { power: .6, color: ROSE, who: s.e, dx: s.d });
        flow(S, E.x, E.y, O.x, O.y, 14, [.7, 1, .7], .4, { cell: 'petal', life: [.5, .75], size: [u * .018, u * .03], spin: 8, add: .5, radius: u * .16 });
        K.embers(S, O.x, O.y, 8, [.7, 1, .7], .95, { radius: u * .1, rise: .7, cell: 'star' });
    });
    // 죽음을 초월하는 자: 부활. 꺼졌던 몸에 금빛이 다시 차오른다.
    aug('transcendDeath.revive', { impact: .1, sounds: ['holy_big', 'heal_b', 'reverse_swell', 'wing_flap'] }, S => {
        const s = side(S), u = S.U, O = s.O;
        S.hit('reverse_swell', .5, { vol: .35 }); S.sfx('wing_flap', .5, { vol: .45, rate: .7 }); S.hit('holy_big', .5, { vol: .55 }); S.hit('heal_b', .6, { vol: .35 });
        K.beam(S, O.x, Math.max(0, O.top - u * .3), O.x, O.bot, u * .3, .1, .9, { color: [1, .95, .75], color2: GOLD, thick: .8, shoot: .2, fall: .4, z: 0 });
        K.aura(S, O.x, O.bot, u * .4, O.h * 1.3, .2, 1.1, { color: GOLD, color2: [1, .5, .2], alpha: .85, speed: 3 });
        K.rays(S, O.x, O.y, u * .7, .4, .8, { color: [1, .95, .75], color2: GOLD, n: 9, spin: 1 });
        K.ring(S, O.x, O.bot, u * .6, GOLD, .5, { flat: .26, dur: .6 }); K.ripple(S, O.x, O.y, .5, { amp: .012, reach: .4 });
        S.burst({ x: O.x, y: O.bot, n: 30, t: .3, cell: 'petal', color: C.white, color2: GOLD, radius: u * .18, flat: .2, angle: -PI / 2, spread: 1, speed: [u * .3, u * .9], life: [.8, 1.4], size: [u * .02, u * .04], grow: .7, drag: 1.4, grav: -u * .1, spin: 6, turb: u * .1, over: .5 });
        S.pose(s.o, { flash: 1, alpha: .4 }, .3).to({ alpha: 1 }, .2).to({ flash: 0 }, .5).end();
        S.flash(C.holy, .12, .4, .5);
    });
    aug('transcendDeath.fail', { impact: .1, sounds: ['soul_breath', 'metal_slam', 'land_thud'] }, S => {
        const s = side(S), u = S.U, O = s.O;
        S.sfx('metal_slam', 0, { vol: .55, rate: .7 }); S.sfx('soul_breath', .05, { vol: .4, rate: .8 }); S.sfx('land_thud', .5, { vol: .5, rate: .8 });
        S.dim(.5, 0, .7, O, .2, .6);
        K.smoke(S, O.x, O.y, u * .34, .05, 1.1, { color: [.5, .45, .55], color2: [.1, .08, .12], dense: .7 });
        K.dust(S, O.x, O.top, 10, [.5, .45, .55], .1, { speed: .25, rise: .5, alpha: .5, life: [.8, 1.4] });
        S.pose(s.o, {}, .05).to({ alpha: .35, sy: .96 }, .5, 'in').wait(.4).to({ alpha: 1, sy: 1 }, .3).end();
    });

    // ================= 발동 장면: 적의 공격에 얹히는 것(주인은 맞는 쪽) =================
    // 죽을 각오로: 핏빛 기운이 몸에서 터져 나오고 발밑이 갈라진다.
    aug('deathWish.awaken', { impact: .12, sounds: ['growl', 'fire_big', 'fire_whoosh', 'heartbeat', 'land_thud', 'boom_low'] }, S => {
        const s = side(S), u = S.U, O = s.O, c2 = [.35, 0, .05];
        S.sfx('growl', 0, { vol: .5, rate: .8 }); S.sfx('heartbeat', 0, { vol: .7 }); S.sfx('land_thud', 0, { vol: .32, rate: .75 }); S.hit('fire_whoosh', .2, { vol: .45 }); S.hit('fire_big', .2, { vol: .5, rate: .85 }); S.hit('boom_low', .12, { vol: .6 });
        S.dim(.45, .02, .6, O, .1, .4);
        K.crack(S, O.x, O.bot, u * .44, .1, .6, { color: BLOOD, color2: C.soot, n: 9, flat: .26 });
        K.fire(S, O.x, O.bot, u * .5, O.h * 1.35, .1, .9, { color: BLOOD, color2: c2, speed: 3.4, fat: 1.2, rough: .2 });
        K.ring(S, O.x, O.y, u * .6, BLOOD, .12, { dur: .5, color2: c2 }); K.ripple(S, O.x, O.y, .12, { amp: .014, reach: .45 });
        K.embers(S, O.x, O.y, 26, BLOOD, .14, { radius: u * .18, rise: 1.2, speed: .7, over: .4 });
        S.pose(s.o, { flash: .9 }, .1).to({ sx: 1.06, sy: 1.06, flash: 0 }, .12, 'out').to({ sx: 1, sy: 1 }, .4, 'elastic').end();
        S.shake(12, .4, .12); S.flash(BLOOD, .12, .3, .12);
    });
    // 간파: 읽어 둔 궤적을 금빛 호가 받아 흘리고, 적은 헛친 채 물러난다.
    aug('readIntent.parry', { impact: .12, sounds: ['blade_clash', 'shield_block'] }, S => {
        const s = side(S), u = S.U, O = s.O, E = s.E, x = O.x + s.d * u * .1, y = O.y - u * .03;
        S.sfx('blade_clash', .1, { vol: .72 }); S.sfx('shield_block', .1, { vol: .4, rate: .9 });
        K.dart(S, E.x - s.d * u * .1, E.y, x, y, 0, .14, { color: [1, .4, .4], color2: BLOOD, width: u * .04, lead: .8 });
        K.slash(S, O.x, O.y, u * .2, -1.5, 1.5, .08, .2, { color: C.white, color2: GOLD, flat: 1, w: .35, tilt: s.d > 0 ? 0 : PI });
        S.field('eye', { x, y: y - u * .14, w: u * .22, h: u * .14, color: GOLD, color2: [1, .95, .8], p0: 1, p1: 0, p2: 1, add: .5, z: 5 }, .04).to({ w: u * .3, h: u * .19 }, .1, 'out3').wait(.2).to({ p0: 0, alpha: 0 }, .25, 'in').end();
        K.flare(S, x, y, u * .22, C.white, .12, .3, .5); K.sparks(S, x, y, 16, GOLD, .12, { speed: 1.2, angle: s.d > 0 ? -.5 : PI + .5, spread: 2 });
        K.dart(S, x, y, x + s.d * u * .3, y - u * .34, .12, .26, { color: [1, .5, .45], color2: BLOOD, width: u * .03, lead: .6 });
        S.pose(s.e, {}, .14).to({ dx: s.d * u * .04, rot: s.d * .05 }, .1, 'out').to({ dx: 0, rot: 0 }, .4, 'io').end();
        K.aura(S, O.x, O.bot, u * .26, O.h * .85, .3, .6, { color: [.6, 1, .7], color2: C.moss, alpha: .5 });
        S.stop(60, .12); S.shake(5, .2, .12);
    });
    // 되감기: 시계의 바늘이 거꾸로 돌고, 주인의 시간이 3초 전으로 끌려간다.
    aug('timeRewind', { impact: .15, sounds: ['tape_rewind', 'reverse_swell'] }, S => {
        const s = side(S), u = S.U, O = s.O;
        S.sfx('tape_rewind', .12, { vol: .6 }); S.sfx('reverse_swell', .12, { vol: .3, offset: .5 });
        S.lens('glitch', { p0: .02, p1: 30, p2: .005, live: true }, .15).to({ p0: 0, p2: 0 }, .5, 'in').end();
        S.field('clockface', { x: O.x, y: O.y, w: u * .2, h: u * .2, color: TIME, color2: [.2, .25, .8], p0: 0, p1: 0, p2: 1, z: 0 }, .12).to({ w: u * .72, h: u * .72, p1: 1 }, .16, 'out3').with({ p0: -TAU * 3 }, 1, 'io').seek(.9).to({ p1: 0, w: u * .8, h: u * .8 }, .3).end();
        for (let i = 0; i < 4; i++) S.shape('streak', { x: O.x, y: O.y, w: u * .12, h: O.h * .8, rot: 0, color: TIME, alpha: 0, p0: .35, z: 1 }, .2 + i * .08).to({ alpha: .4, x: O.x - s.d * u * (.05 + i * .035) }, .1, 'out').to({ alpha: 0, x: O.x }, .3, 'in').end();
        [0, 2.1, 4.2].forEach((a, i) => K.stroke(S, 'energy', path.arc(O.x, O.y, u * .26, u * .3, a + 3, a - 3), .2 + i * .08, .6, { color: TIME, color2: [.4, .3, 1], width: u * .03, lead: .6, lag: .4, trail: .6, props: { seg: 36 } }));
        S.burst({ x: O.x, y: O.y, n: 22, t: .25, cell: 'dot', color: C.white, color2: TIME, ring: u * .34, speed: [u * .2, u * .4], radial: -1, life: [.5, .8], size: [u * .012, u * .026], over: .3 });
        S.shape('hex', { x: O.x, y: O.y, w: u * .2, h: u * .3, color: TIME, alpha: 0, p0: 5, p1: .07, p2: .05, z: 3 }, .8).to({ alpha: .8, w: u * .4, h: u * .56 }, .16, 'back').to({ alpha: 0 }, .4).end();
        K.aura(S, O.x, O.bot, u * .3, O.h, .7, .7, { color: [.6, 1, .8], color2: [.1, .4, .6], alpha: .5 });
        S.pose(s.o, { flash: .6 }, .15).to({ flash: 0, alpha: .6 }, .2).to({ alpha: 1 }, .5).end();
    });
    // 천사 강림: 하늘이 열리고 빛기둥과 깃털이 내린다. 천사 자신은 지속 상태 연출이 내려보낸다.
    aug('angelDescent.descend', { impact: .2, sounds: ['wind_a', 'reverse_swell', 'holy_big', 'wing_flap'] }, S => {
        const s = side(S), u = S.U, O = s.O, x = O.x + s.d * u * .15, c = [1, .96, .8];
        S.sfx('wind_a', 0, { vol: .45, rate: .8 }); S.hit('reverse_swell', .9, { vol: .4 }); S.sfx('wing_flap', .45, { vol: .45, rate: .8 }); S.sfx('wing_flap', .72, { vol: .5, rate: .75, cool: 0 }); S.hit('holy_big', .9, { vol: .45 });
        S.dim(.42, 0, 1.3, { x, y: O.y }, .25, .6);
        K.beam(S, x, 0, x, O.bot, u * .34, .05, 1.4, { color: c, color2: GOLD, thick: .7, shoot: .35, fall: .5, z: 0 }).set({ alpha: .7 });
        S.field('rays', { x, y: Math.max(u * .02, O.top - u * .3), w: u * 1.3, h: u * 1.3, color: c, color2: GOLD, p0: 9, p1: .5, p2: .6, p3: 0, alpha: 0, z: 0 }, .1).to({ alpha: .7 }, .4).wait(.6).to({ alpha: 0 }, .5).end();
        K.circle(S, x, O.bot, u * .34, .2, 1, { color: GOLD, sides: 8, spin: .8, flat: .24 });
        S.burst({ x, y: Math.max(0, O.top - u * .3), n: 34, t: .2, cell: 'petal', add: .7, color: C.white, color2: GOLD, radius: u * .3, flat: .15, speed: [0, u * .12], vy: u * .32, life: [1.1, 1.9], size: [u * .022, u * .044], grow: .8, turb: u * .14, spin: 5, over: 1.1 });
        K.ripple(S, x, O.y, .9, { amp: .01, reach: .5, color: c }); K.ring(S, x, O.bot, u * .7, GOLD, .9, { flat: .24, dur: .6 });
        S.flash(c, .1, .5, .9);
    });
    // 천사의 공격: 빛의 창이 대상을 꿰뚫는다.
    aug('angelDescent', { impact: .22, sounds: ['holy_c', 'wing_flap', 'blade_cut_a'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, angel = s.st && s.st.items.get('angelDescent'), c = [1, .96, .78];
        const x0 = angel && angel.tip ? angel.tip.x : O.x + s.d * u * .3, y0 = angel && angel.tip ? angel.tip.y : O.y - u * .22, ang = Math.atan2(E.y - y0, E.x - x0);
        if (angel && angel.strike) angel.strike(S.t0, .22);
        S.hit('holy_c', .22, { vol: v(S, .5) }); S.sfx('wing_flap', .08, { vol: v(S, .42), rate: 1.1 }); S.sfx('blade_cut_a', .2, { vol: v(S, .34) });
        K.glow(S, x0, y0, u * .07, c, 0, .26, 1, 5);
        K.beam(S, x0, y0, E.x + Math.cos(ang) * u * .25, E.y + Math.sin(ang) * u * .25, u * .12, .16, .3, { color: c, color2: GOLD, thick: .55, shoot: .06, fall: .2, rush: 6 });
        S.shape('flare', { x: E.x, y: E.y, w: u * .1, h: u * .1, color: C.white, alpha: 1, p0: .008, z: 4 }, .22).to({ w: u * .7, h: u * .7 }, .08, 'out3').to({ alpha: 0, rot: .3 }, .34, 'in').end();
        K.ring(S, E.x, E.y, u * .5, GOLD, .22, { dur: .45 }); K.rays(S, E.x, E.y, u * .6, .22, .4, { color: c, color2: GOLD, n: 8, spin: 2 });
        S.burst({ x: E.x, y: E.y, n: 12, t: .22, cell: 'petal', add: .7, color: C.white, color2: GOLD, speed: [u * .2, u * .7], life: [.6, 1.1], size: [u * .02, u * .04], grow: .8, drag: 1.6, grav: u * .3, spin: 7, turb: u * .1 });
        hit(S, E.x, E.y, .22, { power: .85, color: c, who: s.e, dx: s.d });
        // 입힌 피해가 생기로 돌아온다.
        flow(S, E.x, E.y, O.x, O.y, 8, [.7, 1, .75], .3, { life: [.4, .6], cell: 'star' });
    });
    // 천사가 막아 낸 공격: 금빛 날개가 앞으로 접혀 방벽이 된다.
    aug('angelDescent.guard', { impact: .12, sounds: ['wing_flap', 'shield_block', 'holy_b'] }, S => {
        const s = side(S), u = S.U, O = s.O, E = s.E, x = O.x + s.d * u * .2, y = O.y - u * .06, c = [1, .95, .75], angel = s.st && s.st.items.get('angelDescent');
        if (angel && angel.guard) angel.guard(S.t0, .5);
        S.sfx('wing_flap', .04, { vol: .45 }); S.sfx('shield_block', .12, { vol: .65 }); S.hit('holy_b', .14, { vol: .3 });
        K.dart(S, E.x - s.d * u * .1, E.y, x, y, 0, .14, { color: [1, .45, .4], color2: BLOOD, width: u * .05, lead: .8 });
        [-1, 1].forEach(k => K.slash(S, x - s.d * u * .1, y, u * .3, k * 1.9, k * .15, .04, .34, { color: C.white, color2: GOLD, flat: 1, w: .5, tilt: s.d > 0 ? 0 : PI, lag: .5, trail: .8 }));
        S.shape('hex', { x, y, w: u * .16, h: u * .3, color: c, alpha: 0, p0: 5, p1: .08, p2: .08, z: 3 }, .06).to({ alpha: .95, w: u * .3, h: u * .54 }, .08, 'out').to({ alpha: 0 }, .34).end();
        K.sparks(S, x, y, 16, GOLD, .12, { speed: 1.1, angle: s.d > 0 ? 0 : PI, spread: 2.2 }); K.flare(S, x, y, u * .2, C.white, .12, .3, 0);
        S.burst({ x, y, n: 8, t: .12, cell: 'petal', add: .7, color: C.white, color2: GOLD, speed: [u * .2, u * .6], life: [.6, 1], size: [u * .02, u * .036], grow: .8, drag: 1.6, grav: u * .4, spin: 7 });
        S.pose(s.e, {}, .14).to({ dx: s.d * u * .03 }, .08, 'out').to({ dx: 0 }, .3, 'io').end();
        S.shake(6, .2, .12); S.stop(45, .12);
    });
    // 죽음을 초월하는 자: 세상이 유리처럼 깨지고, 꺼지지 않은 몸에 마지막 불이 붙는다.
    aug('transcendDeath.trigger', { impact: .2, sounds: ['glass_big', 'metal_slam', 'boom_low', 'heartbeat', 'land_thud', 'fire_long'] }, S => {
        const s = side(S), u = S.U, O = s.O, c = [1, .86, .5], c2 = [.3, .02, .32];
        S.sfx('glass_big', .2, { vol: .7 }); S.sfx('metal_slam', .2, { vol: .5, rate: .75 }); S.hit('boom_low', .2, { vol: .6 }); [.55, 1.15].forEach(t => { S.sfx('heartbeat', t, { vol: .7, cool: 0 }); S.sfx('land_thud', t, { vol: .34, rate: .75, cool: 0 }); }); S.hit('fire_long', .9, { vol: .45 });
        S.lens('mono', { x: O.x, y: O.y, p0: 0, p1: 1, p2: 0, p3: .5, color2: [.6, .58, .7], live: true }, .2).to({ p0: 1.6 }, .22, 'out').wait(.5).to({ alpha: 0 }, .5).end();
        S.lens('shatter', { x: O.x, y: O.y, p0: 0, p1: 12, p2: .5, p3: 0, color: [.34, 0, 0], color2: [.7, .6, 1] }, .2).to({ p0: .4, p3: 1 }, .5, 'out').end();
        K.ring(S, O.x, O.y, u * .7, C.white, .2, { dur: .5, th: .08, dust: 0 });
        S.shape('glow', { x: O.x, y: O.y, w: u * .1, h: u * .1, color: [0, 0, 0], add: 0, alpha: .9, p0: 1.4, z: 1 }, .2).to({ w: u * .9, h: u * .9 }, .12, 'out3').to({ alpha: 0 }, .7, 'in').end();
        K.fire(S, O.x, O.bot, u * .46, O.h * 1.3, .5, 1, { color: c, color2: c2, speed: 2.4, fat: 1.1, rise: .4 });
        K.crack(S, O.x, O.bot, u * .4, .2, .9, { color: c, color2: C.soot, n: 8, flat: .26 });
        K.embers(S, O.x, O.y, 26, c, .6, { radius: u * .18, rise: 1, speed: .5, over: .6 });
        S.pose(s.o, { flash: 1 }, .2).to({ flash: 0, alpha: .35, sy: .94 }, .25, 'out').wait(.15).to({ alpha: 1, sy: 1, flash: .5 }, .3, 'out').to({ flash: 0 }, .4).end();
        S.shake(16, .5, .2); S.stop(110, .2);
    });
    // 가시 갑옷: 맞는 순간 몸에서 가시가 돋아 때린 쪽을 찌른다.
    aug('thornArmor', { impact: .12, sounds: ['plant_a', 'branch_snap', 'stab'] }, S => {
        const s = side(S), u = s.u, O = s.O, E = s.E, base = s.d > 0 ? 0 : PI;
        S.hit('plant_a', .12, { vol: v(S, .3), rate: 1.4, cool: 250 }); S.sfx('stab', .12, { vol: v(S, .3), rate: 1.3 }); S.sfx('branch_snap', .12, { vol: v(S, .48), cool: 250 });
        S.field('briar', { x: O.x, y: O.y, w: u * .3, h: u * .42, color: THORN, color2: [.12, .25, .08], p0: .5, p1: 11, p2: 0, p3: .6, add: .1, z: 3 }, .02).to({ p2: .46 }, .08, 'out3').wait(.08).to({ p2: 0, alpha: 0 }, .24, 'in').end();
        for (let i = 0; i < 5; i++) {
            const a = base + (i - 2) * .26, x1 = O.x + Math.cos(a) * u * .1, y1 = O.y + Math.sin(a) * u * .1;
            K.dart(S, x1, y1, lerp(x1, E.x, .9), lerp(y1, E.y, .9) + (i - 2) * u * .05, .04 + i * .012, .14, { color: lite(THORN, .4), color2: [.2, .4, .1], width: u * .022, lead: .8 });
        }
        K.sparks(S, E.x, E.y, 10, THORN, .14, { speed: .8, angle: base, spread: 2 });
        S.pose(s.e, { flash: .4 }, .14).to({ dx: s.d * S.U * .012, flash: 0 }, .05).to({ dx: 0 }, .14).end();
    });

    // ================= 증강이 준 스킬 =================
    const def = F.sceneDef, skill = name => 'skill:' + name;
    // 운명: 대상 위의 일곱 별이 이어져 운명의 실이 되고, 주인의 손끝에서 그 실이 끊긴다.
    def(skill('운명'), { impact: .62, cast: 1.05, images: [], sounds: ['whoosh_heavy', 'boom_low', 'metal_slam', 'blade_cut_c'] }, S => {
        const s = side(S), u = S.U, O = s.O, E = s.E, hx = O.x + s.d * u * .1, hy = O.y - u * .04;
        S.dim(.5, 0, .85, E, .14, .35);
        for (let i = 0; i < 4; i++) S.sfx('whoosh_heavy', .04 + i * .11, { vol: .24 + i * .05, rate: 1.2 + i * .16, cool: 0 });
        S.sfx('metal_slam', .62, { vol: .6 }); S.hit('boom_low', .62, { vol: .55 }); S.sfx('blade_cut_c', .6, { vol: .62, rate: 1.1 });
        S.pose(s.o, {}, 0).to({ dy: -u * .015, sx: 1.03, sy: 1.03 }, .3, 'out').wait(.28).to({ dx: s.d * u * .02, sx: 1, sy: 1 }, .05).to({ dx: 0, dy: 0 }, .3, 'io').end();
        S.field('fatestar', { x: E.x, y: E.y, w: u * .66, h: u * .66, color: FATE, p0: 0, p1: 0, p2: .8, p3: 0, z: 2 }, 0).to({ p0: 7 }, .38, 'lin').with({ p1: 1 }, .5, 'in').to({ p2: 5, p3: .9 }, .14, 'in').to({ alpha: 0 }, .05).end();
        // 운명의 실: 별이 모인 자리에서 주인의 손까지 팽팽하게 당겨진다.
        S.trail('energy', { path: path.bow(E.x, E.y, hx, hy, u * .05), head: 0, tail: 0, width: u * .014, color: C.white, color2: FATE, p0: 9, p1: 6, p2: .2, seg: 30, z: 4 }, .36).to({ head: 1 }, .2, 'out').wait(.06).to({ tail: 1 }, .1, 'in').end();
        K.orb(S, hx, hy, u * .02, .4, { color: C.white, color2: FATE, spin: 5, z: 5 }).to({ w: u * .16, h: u * .16 }, .2, 'out').to({ alpha: 0 }, .06).end();
        K.slash(S, lerp(hx, E.x, .5), lerp(hy, E.y, .5), u * .2, -2.2, -.9, .58, .16, { color: C.white, color2: FATE, flat: 1, tilt: s.d > 0 ? .6 : PI - .6, w: .35 });
        S.lens('slice', { x: E.x, y: E.y, ang: -.5 * s.d, p0: 0, p1: .003, p2: 1, p3: 0, color: [.36, 0, 0], color2: FATE }, .62).to({ p0: .014 }, .05, 'out3').wait(.1).to({ p0: 0, p2: 0 }, .14).end();
        K.impact(S, E.x, E.y, .62, { power: .8, color: FATE, zoom: .04 });
        S.burst({ x: E.x, y: E.y, n: 16, t: .62, cell: 'star', color: C.white, color2: FATE, speed: [u * .2, u * .8], life: [.5, 1], size: [u * .024, u * .05], drag: 2, spin: 6 });
        S.pose(s.e, { flash: 1 }, .62).to({ dx: s.d * u * .05, rot: s.d * .06, flash: 0 }, .07, 'out3').to({ dx: 0, rot: 0 }, .4, 'elastic').end();
    });
    // 명계의 부름: 바친 혼불이 땅의 문을 열고, 문에서 솟은 사신이 낫을 등 뒤로 끌어 올렸다가 대상을 한 번에 베어 넘긴다.
    def(skill('명계의 부름'), { impact: .98, cast: 1.5, images: [], sounds: ['metal_slam', 'soul_breath', 'wind_b', 'chain_a', 'growl', 'whoosh_heavy', 'blade_finish', 'boom_low'] }, S => {
        const s = side(S), u = S.U, d = s.d, O = s.O, E = s.E, body = pic('reaper_body'), blade = body && pic('scythe'), c = [.62, .4, 1], c2 = [.12, .03, .3], home = soulHome(O, u, d);
        const h = clamp(E.h * 1.1, u * .38, u * .56), L = h * 1.2, R = L * BLADE_R;
        // 휘두른 날의 한가운데가 대상의 몸을 지나도록 손의 자리를 잡는다. 문은 사신의 발밑에 열린다.
        const hand = { x: E.x - d * R * .8, y: E.y - R * .5 }, gx = hand.x - d * h * .3, gy = Math.max(E.bot, hand.y + h * .66) - u * .01;
        // 낫의 각도: 솟으며 치켜들고(-1.75), 등 뒤로 더 당겼다가(A0), .98초에 대상을 지나(AH) 끝까지 돌아가 멈춘다(A1).
        const A0 = -2.3, AH = wrap(Math.atan2(.5, .8) - BLADE_A), A1 = 2.75, part = a => clamp((a - A0) / (A1 - A0));
        const swing = t => t < .62 ? lerp(-1.1, -1.75, S.ease.out3(clamp((t - .34) / .28))) : t < .86 ? lerp(-1.75, A0, S.ease.out(clamp((t - .62) / .2))) : t < .98 ? lerp(A0, AH, ((t - .86) / .12) ** 2.2) : lerp(AH, A1, S.ease.out3(clamp((t - .98) / .2))) - .2 * clamp((t - 1.18) / .2);
        S.dim(.68, 0, 1.3, E, .2, .4);
        S.sfx('metal_slam', 0, { vol: .5, rate: .7 }); S.sfx('soul_breath', .15, { vol: .3, rate: .85 }); S.sfx('wind_b', .1, { vol: .4, rate: .8 }); S.sfx('chain_a', .4, { vol: .35, rate: .8 }); S.hit('growl', .7, { vol: .5, rate: .7 }); S.sfx('whoosh_heavy', .76, { vol: .65 }); S.sfx('blade_finish', .9, { vol: .8, rate: .8 }); S.hit('boom_low', .98, { vol: .8 });
        S.pose(s.o, {}, 0).to({ dy: -u * .012, flash: .25 }, .2).wait(.5).to({ dy: 0, flash: 0 }, .3).end();
        // 곁의 낫에 모아 둔 혼불이 문으로 빨려 든다.
        flow(S, home.x, home.y, gx, gy, 22, SOUL, .04, { life: [.4, .7], over: .3, radius: u * .1 });
        K.circle(S, gx, gy, u * .34, .1, 1.15, { color: c, color2: c2, sides: 7, spin: -1.2, flat: .24, draw: .3 });
        S.field('hole', { x: gx, y: gy, w: u * .1, h: u * .03, color: c, color2: c2, p0: .5, p1: 1.2, add: 0, z: -2 }, .2).to({ w: u * .58, h: u * .16 }, .3, 'out3').wait(.8).to({ w: u * .1, h: u * .02, alpha: 0 }, .25, 'in').end();
        K.smoke(S, gx, gy - u * .1, u * .36, .35, 1, { color: [.3, .15, .5], color2: [.03, 0, .08], dense: .7, lift: .5 });
        K.embers(S, gx, gy, 20, c, .3, { radius: u * .2, flat: .2, rise: .8, speed: .4, over: .6 });
        let grip = hand;
        if (blade) {
            // 몸은 두 손을 축으로 기운다: 당길 때는 뒤로 젖히고, 벨 때는 앞으로 덮친다.
            grip = S.sprite({ x: hand.x - d * u * .03, y: hand.y + h * .4, size: tall(body, h), pivot: REAPER_GRIP, flip: d, rot: -.05 * d, alpha: 0, glow: .3, edge: c, z: 2 }, .34, body.id)
                .to({ alpha: 1, y: hand.y }, .28, 'out3').to({ x: hand.x - d * u * .045, y: hand.y - u * .02, rot: -.2 * d }, .22, 'out').wait(.02)
                .to({ x: hand.x + d * u * .05, y: hand.y + u * .025, rot: .14 * d }, .12, 'in').set({ flash: .5 }).to({ flash: 0, x: hand.x + d * u * .07, rot: .2 * d }, .2, 'out3')
                .to({ rot: .12 * d }, .14, 'io').to({ alpha: 0, dis: 1, y: hand.y + u * .05 }, .34, 'in').end().p;
            S.sprite({ x: grip.x, y: grip.y, size: tall(blade, L), pivot: SCYTHE_PIVOT, flip: d, rot: d * swing(.34), alpha: 0, glow: .35, edge: SOUL, z: 2.5 }, .34, blade.id)
                .tick((p, t) => { p.x = grip.x; p.y = grip.y; p.rot = d * swing(t + .34); }).to({ alpha: 1 }, .28, 'out3').wait(.7).to({ alpha: 0, dis: 1 }, .34, 'in').end();
        } else K.fire(S, gx, gy, u * .4, u * .8, .4, .8, { color: c, color2: c2, speed: 1.6 });
        // 당긴 끝에서 날이 한 번 번뜩인다.
        K.flare(S, hand.x + d * Math.cos(BLADE_A + A0) * R, hand.y + Math.sin(BLADE_A + A0) * R, u * .1, SOUL, .8, .18, .6);
        // 날이 지나간 자리: 낫의 각도를 그대로 따라가는 두 겹의 궤적.
        const arc = k => { const a = BLADE_A + lerp(A0, A1, k); return [grip.x + d * Math.cos(a) * R, grip.y + Math.sin(a) * R]; };
        [[R * .42, C.white, SOUL, .05, 3.2], [R * .9, c, c2, .1, 3]].forEach(([width, color, color2, lag, z]) => S.trail('slash', { path: arc, width, color, color2, p0: 5, p1: 3, p2: .8, taper: .5, seg: 40, z }, .86)
            .tick((p, t) => { const T = t + .86; p.head = part(swing(T)); p.tail = Math.min(p.head, part(swing(T - lag * (1 - clamp((T - 1.02) / .3))))); }).wait(.5).end());
        S.lens('slice', { x: E.x, y: E.y, ang: d > 0 ? .6 : PI - .6, p0: 0, p1: .005, p2: 1, p3: 0, color: [.5, 0, 0], color2: c }, .98).to({ p0: .028 }, .05, 'out3').wait(.14).to({ p0: 0, p2: 0 }, .2, 'io').end();
        K.impact(S, E.x, E.y, .98, { power: 1, color: c, zoom: .06, flash: false });
        S.flash([.5, .3, .9], .16, .3, .98);
        flow(S, E.x, E.y, E.x, E.top - u * .2, 18, SOUL, 1, { life: [.6, 1], over: .2, radius: u * .16 });
        S.pose(s.e, { flash: 1 }, .98).to({ dx: d * u * .07, rot: d * .09, sx: .95, flash: 0 }, .07, 'out3').to({ dx: 0, rot: 0, sx: 1 }, .45, 'elastic').end();
    });
    // 검무: 칼춤. 주인이 붉은 한삼 자락을 끌며 대상의 둘레를 한 바퀴 반 돌고, 0.1초마다 높이를 달리해 한 번씩 벤다.
    // 베인 자리마다 가는 칼금이 남아 쌓였다가, 춤을 맺으며 칼을 거두는 순간 한꺼번에 터진다.
    // 타수는 사건의 strikes를 따른다(적이 도중에 쓰러지면 거기서 맺는다). 타격 시각은 DANCE이고 호스트가 수치와 증강 장면을 여기에 맞춘다.
    const DANCE = [.3, .4, .5, .6, .7, .8, .9, 1], SILK = [1, .2, .3], SILK2 = [.45, .02, .12];
    // 효과음은 이 표에서만 고른다. 소리를 바꿀 때는 여기만 바꾼다.
    // cuts는 타마다 번갈아 쓰는 세 가지 베기(같은 소리가 0.1초마다 겹치지 않게), ring은 쌓인 칼금이 터질 때의 칼 울림, sheath는 칼을 거두는 소리(끝의 딸깍이 맺는 순간에 온다)다.
    const DANCE_SFX = { draw: 'sword_draw', cuts: ['blade_cut_a', 'blade_cut_b', 'blade_cut_c'], step: 'swish_a', last: 'blade_finish', sheath: 'blade_sheath', ring: 'blade_ring', bloom: 'wing_flap' };
    def(skill('검무'), { impact: DANCE[0], hits: DANCE, cast: 1.45, images: [], sounds: Object.values(DANCE_SFX).flat() }, S => {
        const s = side(S), u = S.U, O = s.O, E = s.E, e = pic('sword'), d = s.d, gap = Math.abs(E.x - O.x), X = DANCE_SFX;
        const n = clamp(S.event && Array.isArray(S.event.strikes) ? S.event.strikes.length : 8, 1, 8), t0 = DANCE[0], tn = DANCE[n - 1], tf = tn + .2;
        // 춤꾼의 자리: 대상의 발밑을 도는 납작한 원. 각 0은 대상의 앞(주인 쪽)이고, 0.8초에 한 바퀴 반을 돈다.
        const R = Math.min(u * .2, gap * .42), start = t0 - .05, phi = t => (t - start) * 3 * PI / .8;
        const body = Math.max(E.h, u * .3), rx = clamp(E.w * .62, u * .13, u * .24), psi = t => d > 0 ? PI + phi(t) : -phi(t);
        const height = k => lerp(E.bot - body * .16, E.top + body * .22, k);
        S.dim(.5, 0, tf + .05, E, .15, .3);
        S.sfx(X.draw, 0, { vol: .6 });

        // 몸짓: 미끄러지듯 다가서서, 돌면서 벨 때마다 발을 딛고, 앞으로 빠져나와 칼을 거둔 뒤 돌아간다.
        const home = tf + .12, back = .24;
        let fx = 0, fy = 0, fs = 1;
        S.pose(s.o, {}, 0).tick((p, t) => {
            p.rot = 0; p.alpha = 1; p.sy = 1;
            if (t < start) {
                const k = clamp((t - (start - .12)) / .12), m = k * k * (3 - 2 * k);
                p.dx = d * (gap - R) * m; p.dy = -Math.sin(k * PI) * u * .018; p.sx = 1; p.sy = 1 - Math.sin(k * PI) * .04;
            } else if (t < tn + .04) {
                const q = phi(t), c = Math.cos(q), beat = Math.abs(Math.sin(PI * (t - t0) / .1));
                fx = p.dx = d * (gap - c * R); fy = p.dy = -Math.sin(q) * R * .16 - beat * u * .024;
                // 대상을 바라보며 돈다: 옆을 지날 때 몸이 접혔다가 반대로 펴진다.
                fs = p.sx = (c < 0 ? -1 : 1) * Math.max(.16, Math.pow(Math.abs(c), .55));
                p.rot = Math.sin(q * 2) * .09; p.alpha = Math.sin(q) > .2 ? .82 : 1; p.sy = 1 - (1 - beat) * .035;
            } else if (t < tf) {
                const k = clamp((t - tn - .04) / .12), m = 1 - Math.pow(1 - k, 3);
                p.dx = lerp(fx, d * (gap - R * 1.3), m); p.dy = lerp(fy, 0, m) - Math.sin(k * PI) * u * .03; p.sx = lerp(fs, 1, m);
            } else if (t < home) {
                const k = clamp((t - tf) / .08);
                p.dx = d * (gap - R * 1.3); p.dy = 0; p.sx = 1; p.sy = 1 - Math.sin(k * PI) * .06;
            } else {
                const k = clamp((t - home) / back), m = k * k * (3 - 2 * k);
                p.dx = d * (gap - R * 1.3) * (1 - m); p.dy = -Math.sin(k * PI) * u * .012; p.sx = 1;
            }
        }).wait(home + back).end();

        // 한삼 자락: 춤꾼을 따라 대상을 감아 오르는 붉은 비단과, 한 박자 늦은 금빛 가닥.
        const span = tn + .04 - start;
        [[SILK, SILK2, 1.12, 0, u * .05], [GOLD, [.6, .25, .05], .92, .05, u * .018]].forEach(([c, c2, wide, late, width], i) => {
            const fly = k => { const t = start + k * span, q = psi(t); return [E.x + Math.cos(q) * R * wide, height(k * (n - 1) / 7) + Math.sin(q) * R * .2 + u * .05 * (1 - i)]; };
            S.trail('energy', { path: fly, width, color: c, color2: c2, seg: 56, p0: 5, p1: 4, p2: .9, taper: .3, alpha: .9, z: i ? 4 : 2 }, start + late).to({ head: 1 }, span, 'lin').seek(.2).to({ tail: 1 }, span, 'lin').end();
        });
        K.ring(S, E.x, E.bot, R * 2.3, SILK, start, { flat: .2, dur: span + .1, th: .05 });

        for (let i = 0; i < n; i++) {
            const t = DANCE[i], last = i === n - 1, q = psi(t), g = d > 0 ? 1 : -1, y = height(i / 7), tilt = (i % 2 ? -1 : 1) * (.2 + i * .035), r = rx * (last ? 1.25 : 1);
            const c = i % 2 ? [1, .86, .8] : STEEL, c2 = i % 2 ? SILK : [.3, .55, 1], a0 = q - g * 1.5, a1 = q + g * 1.15;
            S.sfx(last ? X.last : X.cuts[i % X.cuts.length], t - .02, { vol: last ? .8 : .46 + (i % 3 === 0 ? .08 : 0), rate: last ? .95 : 1 + i * .04, cool: 0 });
            if (i % 2 === 0) S.sfx(X.step, t - .08, { vol: .2, rate: 1.2 + i * .04, cool: 0 });
            // 칼날의 호: 춤꾼이 지나는 쪽에서 대상의 몸을 감아 벤다. 높이와 기울기가 타마다 달라 서로 엇갈린다.
            K.slash(S, E.x, y, r, a0, a1, t - .07, last ? .26 : .2, { color: lite(c, .4), color2: c2, flat: .36, tilt, w: last ? .5 : .4 });
            if (e) {
                // 검 그림은 날끝이 위를 본다. 호의 진행 방향으로 날끝을 돌려 호를 따라 훑는다.
                const arc = path.arc(E.x, y, r, r * .36, a0, a1, tilt), p0 = arc(0), p1 = arc(1), pa = arc(.08), pb = arc(.92);
                const r0 = Math.atan2(pa[1] - p0[1], pa[0] - p0[0]) + PI / 2, turn = Math.atan2(p1[1] - pb[1], p1[0] - pb[0]) + PI / 2 - r0, r1 = r0 + turn - Math.round(turn / TAU) * TAU;
                S.sprite({ x: p0[0], y: p0[1], size: tall(e, u * .2), rot: r0, alpha: 0, glow: .5, edge: c, z: 4 }, t - .09, e.id).to({ alpha: 1 }, .02).with({ x: p1[0], y: p1[1], rot: r1 }, .12, 'out').to({ alpha: 0 }, .08).end();
            }
            // 남는 칼금. 춤을 맺을 때 벤 차례대로 터진다.
            const mark = tilt * 1.5 + (i % 2 ? .45 : -.45), wait = tf - t - .13 + i * .014;
            S.shape('streak', { x: E.x, y, w: rx * 1.5, h: u * .03, rot: mark, color: lite(c, .6), alpha: 0, p0: .22, z: 4 }, t).to({ alpha: 1 }, .03).to({ alpha: .5, h: u * .009, w: rx * 2.1 }, .1, 'out').wait(wait).to({ alpha: 1, h: u * .034 }, .03).to({ alpha: 0, w: rx * 3.4, h: u * .004 }, .24, 'out').end();
            const hx = E.x + Math.cos(q) * r * .45, hy = y + Math.sin(q) * r * .16;
            K.sparks(S, hx, hy, last ? 14 : 7, c, t, { speed: last ? 1.2 : .9, angle: q + g * PI / 2, spread: 1.3 });
            if (last) K.flare(S, hx, hy, u * .16, C.white, t, .2, tilt);
            S.pose(s.e, { flash: last ? .8 : .45 }, t).to({ dx: d * u * (last ? .02 : .011) * (i % 2 ? 1 : -1), flash: 0 }, .04).to({ dx: 0 }, .05).end();
            S.shake(last ? 7 : 3 + i * .3, last ? .14 : .08, t);
        }

        // 맺음: 칼을 거두는 쇳소리와 함께 쌓인 칼금이 터지고, 꽃잎 같은 비단 조각이 흩날린다.
        S.hit(X.sheath, tf + .1, { vol: .6 }); S.sfx(X.ring, tf, { vol: .4, rate: 1.15 }); S.sfx(X.bloom, tf, { vol: .38, rate: 1.1 });
        K.flare(S, E.x - d * (R * 1.3 - u * .07), O.y - u * .04, u * .09, C.white, tf, .22, .6);
        S.lens('slice', { x: E.x, y: E.y, ang: -.5, p0: 0, p1: .004, p2: 1, p3: 0, color: [.45, 0, .05], color2: STEEL }, tf).to({ p0: .018 }, .05, 'out3').wait(.1).to({ p0: 0, p2: 0 }, .18, 'io').end();
        K.ring(S, E.x, E.y, u * .5, [1, .9, .86], tf, { th: .1, dur: .34 });
        S.burst({ x: E.x, y: E.y, n: 12 + n * 2, t: tf, cell: 'petal', add: .25, color: [1, .5, .56], color2: SILK2, radius: rx * .5, speed: [u * .25, u * .8], life: [.5, 1], size: [u * .018, u * .036], grow: .6, drag: 2.2, grav: u * .5, spin: 9, turb: u * .07 });
        K.sparks(S, E.x, E.y, 8 + n * 2, STEEL, tf, { speed: 1.3 });
        S.pose(s.e, { flash: 1 }, tf).to({ sy: .95, sx: 1.04, flash: 0 }, .06, 'out3').to({ sy: 1, sx: 1 }, .32, 'elastic').end();
        S.shake(8, .2, tf);
    });
    // 변속: 톱니 셋 가운데 하나가 금빛으로 달아올라 다음 단에 물린다.
    def(skill('변속'), { impact: .22, cast: .5, images: [], sounds: ['ratchet', 'gear_shift'] }, S => {
        const s = side(S), u = S.U, O = s.O, c = [1, .78, .4], c2 = [.35, .2, .05], x = O.x + s.d * u * .12, y = O.y;
        S.sfx('ratchet', 0, { vol: .3, rate: 1.25 }); S.hit('gear_shift', .22, { vol: .75 });
        [[0, 0, .2, 8, 1], [.115, -.07, .14, 6, -1], [.1, .09, .12, 6, -1]].forEach(([dx, dy, size, teeth, dir], i) => {
            S.field('cog', { x: x + s.d * dx * u, y: y + dy * u, w: size * u * .3, h: size * u * .3, color: c, color2: c2, p0: teeth, p1: 0, p2: 0, alpha: 0, z: 4 }, i * .03)
                .to({ w: size * u, h: size * u, alpha: 1 }, .1, 'back').with({ p1: dir * TAU * 8 / teeth * .75 }, .2, 'in').set({ p2: i ? .3 : 1 }).to({ p1: dir * TAU * 8 / teeth * .75 + dir * .2 }, .05, 'out').wait(.12).to({ alpha: 0, w: size * u * 1.2, h: size * u * 1.2 }, .2).end();
        });
        K.flare(S, x, y, u * .22, C.white, .22, .3, .3); K.ring(S, x, y, u * .3, c, .22, { dur: .32, th: .1 });
        K.sparks(S, x, y, 14, c, .22, { speed: .8 });
        K.aura(S, O.x, O.bot, u * .26, O.h * .9, .22, .5, { color: c, color2: EMBER, alpha: .5 });
        S.pose(s.o, {}, .18).to({ dx: -s.d * u * .012, flash: .4 }, .04).to({ dx: 0, flash: 0 }, .2).end();
    });
    // 간파: 눈이 크게 떠지고, 적에게서 뻗어 오던 붉은 궤적이 금빛으로 굳어 부서진다.
    def(skill('간파'), { impact: .3, cast: .62, images: [], sounds: ['soul_breath', 'whoosh_heavy', 'wing_flap'] }, S => {
        const s = side(S), u = S.U, O = s.O, E = s.E, x = lerp(O.x, E.x, .5), y = Math.min(O.y, E.y) - u * .1, line = path.bow(E.x - s.d * u * .1, E.y, O.x + s.d * u * .06, O.y, u * .1);
        S.sfx('soul_breath', 0, { vol: .3, rate: 1.25 }); S.sfx('whoosh_heavy', .22, { vol: .45, rate: 1.15 }); S.sfx('wing_flap', .3, { vol: .36, rate: 1.2 });
        S.dim(.35, 0, .45, { x, y }, .1, .25);
        S.field('eye', { x, y, w: u * .5, h: u * .3, color: [1, .3, .3], color2: [1, .9, .8], p0: 0, p1: -s.d * .8, p2: .3, add: .5, z: 5 }, 0).to({ p0: 1 }, .16, 'out3').with({ p1: s.d * .8 }, .3, 'io').to({ p2: 1 }, .02).wait(.14).to({ p0: 0, alpha: 0 }, .2, 'in').end();
        const read = S.trail('energy', { path: line, head: 0, tail: 0, width: u * .02, color: [1, .3, .3], color2: BLOOD, p0: 9, p1: 5, p2: .2, seg: 30, z: 4 }, .04);
        read.to({ head: 1 }, .24, 'out').set({ width: u * .034 }).wait(.14).to({ alpha: 0 }, .08).end();
        S.at(.3, () => { read.p.color = GOLD; read.p.color2 = C.amber; });
        S.shape('streak', { x, y, w: u * .1, h: u * .008, color: C.white, alpha: 0, p0: .3, z: 6 }, .28).to({ alpha: 1, w: u * 1.2 }, .05, 'out3').to({ alpha: 0 }, .25).end();
        for (let i = 0; i < 6; i++) { const q = line(.15 + i * .14); K.sparks(S, q[0], q[1], 5, GOLD, .42, { speed: .5, grav: .8 }); }
        K.ring(S, O.x, O.y, u * .26, GOLD, .3, { dur: .34, th: .08 });
        K.aura(S, O.x, O.bot, u * .26, O.h * .9, .3, .5, { color: GOLD, color2: C.amber, alpha: .45 });
    });

    // ================= 지속 상태 =================
    // 대상 위의 자리들. 장면과 지속 상태 연출이 같은 자리를 쓴다.
    const markAt = s => ({ x: s.E.x + s.d * s.E.w * .38, y: s.E.top + s.E.h * .3 });
    // 낫 그림에서 자루를 쥐는 자리(회전축)와, 그 축에서 본 날 한가운데의 거리(그림 높이 대비)와 방향. 사신 그림에서는 두 주먹이 모인 자리.
    const SCYTHE_PIVOT = [.302, .55], BLADE_R = .47, BLADE_A = -.77, REAPER_GRIP = [.944, .235], SHIELD2 = [.2, .26, .42];
    const wrap = a => a - TAU * Math.round(a / TAU);
    // 주인 곁에 떠 있는 낫: 축의 자리와 크기, 그리고 혼불이 모이는 날의 품.
    const soulScythe = (O, u) => ({ x: O.w * .46, y: O.top + O.h * .42, size: clamp(O.h * .62, u * .2, u * .3) });
    const soulHome = (O, u, d) => { const q = soulScythe(O, u); return { x: O.x - d * (q.x - q.size * .41), y: q.y - q.size * .23 }; };
    // 떠다니는 검의 궤도: 적의 몸통을 납작하게 감는 고리.
    const swordRing = (E, u) => { const rx = Math.max(E.w * .62, u * .2); return { x: E.x, y: E.top + E.h * .52, rx, ry: rx * .27 }; };
    const shieldAt = (E, u) => ({ x: E.x + E.w * .24, y: E.top + E.h * .3, r: u * .052 });
    const gashAt = (E, u) => ({ x: E.x + E.w * .05, y: E.top + E.h * .6, len: clamp(E.w * .75, u * .22, u * .36), rot: .42 });
    const flowerSlot = (E, i) => { const a = i * 2.39996 + .6, r = Math.sqrt((i + .6) / 8.4); return { x: E.x + Math.cos(a) * r * E.w * .36, y: E.top + E.h * (.46 + Math.sin(a) * r * .32) }; };
    const ease = (from, to, dt, rate) => from + (to - from) * Math.min(1, dt * (rate || 7));

    // 증강마다 지속 상태를 그리는 법. c는 만들기 도구(c.field 등은 계속 남는 노드를 만든다), it.d는 지금의 상태다.
    const AURA = {
        // 정복자: 머리 위의 월계관이 잎을 한 장씩 얻고, 다 차면 기병이 곁으로 달려와 선다.
        conqueror(c, it) {
            const { S, u, me } = c, wy = Math.max(me.top - u * .045, S.H * .2); let rider = null, born = 0, home = null;
            c.field('laurel', { x: me.x, y: wy, w: u * .2, h: u * .13, color: GOLD, color2: [.5, .34, .12], p0: 0, p1: 0, alpha: 0, add: .55, z: 5 }).tick((p, t, dt) => {
                const d = it.d, full = d.stacks >= (d.max || 10), now = c.now();
                p.p0 = ease(p.p0, d.stacks, dt); p.alpha = ease(p.alpha, d.stacks > 0 ? .95 : 0, dt, 5);
                p.p1 = Math.max(0, 1 - (now - it.gain) * 2.4) * .8 + (full ? .25 + .12 * Math.sin(t * 3) : 0); p.y = wy + Math.sin(t * 1.7) * u * .004;
                const e = full && !rider ? pic('cavalry') : null;
                if (e) {
                    const w = Math.min(u * .5, me.h * .72, S.W * .4), h = w * e.h / e.w; home = { x: Math.max(me.x - me.w * .2 - w * .32, w * .36), y: me.top + me.h * .66 - h * .47 };
                    born = it.first ? now - 9 : now; it.pos = { x: home.x, y: home.y };
                    rider = c.sprite({ x: home.x, y: home.y, size: wide(e, w), alpha: 0, add: .28, glow: .3, edge: GOLD, z: 1.5 }, e.id);
                    rider.tick(q => {
                        const time = c.now(), intro = clamp((time - born) / .6), k = 1 - (1 - intro) ** 3, r = it.run;
                        let x = lerp(-w * .6, home.x, k), a = .85 * clamp(intro * 3) * (it.d.stacks >= (it.d.max || 10) ? 1 : 0);
                        if (r && time >= r.t0) {
                            const g = (time - r.t0) / r.dur;
                            if (g < 1.3) { x = lerp(home.x, r.x, g * g); a *= clamp((1.3 - g) * 6); }
                            else { const b = clamp((time - r.t0 - r.dur * 1.3 - .2) / .4); x = home.x - (1 - b) * u * .12; a *= b; if (b >= 1) it.run = null; }
                        }
                        q.x = x; q.y = home.y - Math.abs(Math.sin(time * 8.5)) * u * (intro < 1 || r ? .014 : .005); q.alpha = ease(q.alpha, a, .016, 14); q.rot = Math.sin(time * 8.5) * .014; if (it.pos) it.pos.x = x;
                    });
                }
                if (!full && rider && rider.p.alpha < .02) { rider.dead = true; rider = null; it.pos = null; }
            });
            it.charge = (t0, dur, x) => { if (rider) it.run = { t0, dur, x: x - u * .14 }; };
            it.set = (d, old) => { if (old && d.stacks > old.stacks) it.gain = c.now(); };
        },
        // 치명적인 운명: 대상을 두른 일곱 별이 치명타마다 하나씩 켜지고, 일곱이 차면 별 사이에 선이 이어진다.
        fatalDestiny(c, it) {
            const { u, foe } = c;
            c.field('fatestar', { x: foe.x, y: foe.top + foe.h * .5, w: Math.max(foe.w * 1.2, u * .5), h: u * .3, color: FATE, p0: 0, p1: 0, p2: .35, p3: 0, alpha: 0, z: 1 }).tick((p, t, dt) => {
                const n = it.d.stacks || 0; p.p0 = ease(p.p0, n, dt, 6); p.p1 = ease(p.p1, n >= 7 ? 1 : 0, dt, 3);
                p.alpha = ease(p.alpha, n > 0 ? (n >= 7 ? .85 + .15 * Math.sin(t * 5) : .7) : 0, dt, 5) + Math.max(0, 1 - (c.now() - it.gain) * 3) * .02;
            });
            it.set = (d, old) => { if (old && d.stacks > old.stacks) { it.gain = c.now(); c.pop(foe.x, foe.top + foe.h * .5, FATE, 'star', 6); } };
        },
        // 주문의 계절: 발밑의 고리와 흩날리는 것들이 계절을 따라 바뀐다. 겨울에는 적의 발밑에 서리가 낀다.
        seasons(c, it) {
            const { S, u, me, foe } = c, color = SEASON.spring.slice(); let next = 0;
            c.field('circle', { x: me.x, y: me.bot - u * .01, w: u * .44, h: u * .11, color, color2: [.2, .2, .2], p0: 1, p1: 4, p2: .5, p3: 0, alpha: 0, z: -3 }).tick((p, t, dt) => {
                const name = it.d.season, tone = SEASON[name]; if (!tone) { p.alpha = ease(p.alpha, 0, dt); return; }
                for (let i = 0; i < 3; i++) color[i] = ease(color[i], tone[i], dt, 4);
                p.alpha = ease(p.alpha, .5, dt, 4);
                if (S.reduced || t < next) return;
                next = t + .3;
                const o = name === 'spring' ? { cell: 'petal', y: me.bot - u * .04, vy: -u * .16, grav: -u * .05, color: [1, .85, .92], spin: 6 }
                    : name === 'summer' ? { cell: 'flame', y: me.bot - u * .03, vy: -u * .3, grav: -u * .1, color: [1, .9, .5], spin: 0, rot: 0 }
                    : name === 'autumn' ? { cell: 'petal', y: me.top + me.h * .1, vy: u * .2, grav: u * .08, color: [1, .7, .3], spin: 8 }
                    : { cell: 'star', y: me.top + me.h * .05, vy: u * .18, grav: 0, color: C.white, spin: 3 };
                S.burst({ x: me.x, y: o.y, n: 2, t: c.late(), cell: o.cell, add: name === 'summer' || name === 'winter' ? 1 : .3, color: o.color, color2: tone, radius: u * .16, flat: .2, vy: o.vy, grav: o.grav, speed: [0, u * .05], life: [1, 1.6], size: [u * .012, u * .024], grow: .8, turb: u * .09, spin: o.spin, rot: o.rot, alpha: .8 });
            });
            c.shape('ring', { x: foe.x, y: foe.bot - u * .01, w: Math.max(foe.w, u * .3), h: u * .08, color: SEASON.winter, alpha: 0, p0: .8, p1: .16, z: -3 }).tick((p, t, dt) => { p.alpha = ease(p.alpha, it.d.season === 'winter' ? .45 + .15 * Math.sin(t * 2) : 0, dt, 4); });
        },
        // 운명의 수동변속: 허리께의 톱니 셋. 중첩만큼 불이 들어오고, 변속을 걸면 금빛으로 빠르게 돈다.
        manualShift(c, it) {
            const { u, me } = c;
            [[0, 0, .07, 8, 1], [.047, -.028, .05, 6, -1], [.047, .034, .044, 6, -1]].forEach(([dx, dy, size, teeth, dir], i) => {
                let turn = 0;
                c.field('cog', { x: me.x + me.w * .42 + dx * u, y: me.top + me.h * .62 + dy * u, w: size * u, h: size * u, color: [1, .78, .4], color2: [.3, .22, .16], p0: teeth, p1: 0, p2: 0, alpha: 0, z: 4 }).tick((p, t, dt) => {
                    const d = it.d, lit = i < (d.stacks || 0) ? 1 : 0;
                    turn += dt * dir * (d.armed ? 7 : .5) * 8 / teeth; p.p1 = turn;
                    p.p2 = ease(p.p2, d.armed ? 1 : lit * .55, dt, 8); p.alpha = ease(p.alpha, d.armed ? 1 : .4 + lit * .5, dt, 6);
                });
            });
            it.set = (d, old) => { if (old && d.stacks > old.stacks) c.pop(me.x + me.w * .42 + u * .03, me.top + me.h * .62, [1, .78, .4], 'spark', 5); };
        },
        // 영혼 수확자: 어깨 뒤에 떠 있는 낫. 거둔 영혼은 혼불이 되어 날의 품을 돌고, 하나 거둘 때마다 낫이 한 번 끄덕인다.
        soulReaper(c, it) {
            const { u, me } = c, q = soulScythe(me, u), home = soulHome(me, u, 1); let made = false;
            c.field('wisps', { x: home.x, y: home.y, w: q.size * 1.15, h: q.size * .8, color: SOUL, p0: 0, p1: 1.1, alpha: 0, z: 4 }).tick((p, t, dt) => {
                const n = Math.min(8, it.d.souls || 0); p.p0 = ease(p.p0, n, dt, 3); p.alpha = ease(p.alpha, n > 0 ? .95 : 0, dt, 4);
                const e = made ? null : pic('scythe'); if (!e) return; made = true;
                c.sprite({ x: me.x - q.x, y: q.y, size: tall(e, q.size), pivot: SCYTHE_PIVOT, rot: .25, alpha: 0, add: .5, glow: .6, edge: SOUL, tint: [.8, .97, 1], z: 1.4 }, e.id).tick((sp, t2, dt2) => {
                    const since = c.now() - it.gain, nod = since > 0 && since < .45 ? Math.sin(since / .45 * PI) : 0;
                    sp.alpha = ease(sp.alpha, it.d.souls > 0 ? .95 : .35, dt2, 4); sp.rot = .25 + Math.sin(t2 * 1.4) * .04 - nod * .6; sp.y = q.y + Math.sin(t2 * 1.1) * u * .006; sp.glow = .6 + nod * .4;
                });
            });
            // 혼불이 날아와 닿는 때(거두는 장면의 .74초)에 맞춰 끄덕인다.
            it.set = (d, old) => { if (old && d.souls > old.souls) it.gain = c.now() + .6; };
        },
        // 읽어 낸 살의: 적의 어깨 위에 눈이 맺힌다. 두 번 맞는 동안 조금씩 떠지고, 다 뜨면 다음 공격의 궤적이 붉은 실로 보인다.
        readIntent(c, it) {
            const { S, u, me, foe, st } = c, ex = foe.x - foe.w * .34, ey = foe.top + foe.h * .12, iris = [1, .25, .25], lid = [1, .8, .75], line = [1, .2, .2];
            st.hud.eye = { x: ex, y: ey, size: u };
            c.field('eye', { x: ex, y: ey, w: u * .17, h: u * .105, color: iris, color2: lid, p0: 0, p1: -.6, p2: 0, alpha: 0, add: .45, z: 6 }).tick((p, t, dt) => {
                const d = it.d, fore = d.foresight, open = fore ? 1 : Math.min(2, d.count || 0) * .28, tone = d.parry ? GOLD : fore && fore.avoided ? TIME : BLOOD;
                for (let i = 0; i < 3; i++) { iris[i] = ease(iris[i], tone[i], dt, 6); line[i] = iris[i]; }
                p.p0 = ease(p.p0, open + (fore ? Math.sin(t * 2.2) * .04 : 0), dt, 7); p.p1 = fore ? -.75 + Math.sin(t * 1.3) * .1 : Math.sin(t * .8) * .5;
                p.p2 = ease(p.p2, fore ? .6 + .3 * Math.sin(t * 4) : 0, dt, 5); p.alpha = ease(p.alpha, fore ? 1 : open > 0 ? .7 : .28, dt, 5);
                st.hud.fore = fore || null; st.hud.parry = !!d.parry;
            });
            // 살의의 궤적: 눈에서 주인의 가슴까지. 간파를 걸어 두면 금빛이 되어 중간에서 끊긴다.
            const fly = path.bow(ex, ey + u * .05, me.x + me.w * .1, me.top + me.h * .38, u * .08);
            if (!S.reduced) c.trail('energy', { path: fly, head: 0, tail: 0, width: u * .012, color: line, color2: [.4, 0, .05], p0: 12, p1: 7, p2: .12, seg: 26, alpha: 0, z: 5 }).tick((p, t, dt) => {
                const d = it.d, on = !!d.foresight; p.head = ease(p.head, on ? (d.parry ? .62 : 1) : 0, dt, on ? 5 : 12); p.alpha = ease(p.alpha, on ? .55 + .2 * Math.sin(t * 6) : 0, dt, 6);
            });
            c.shape('flare', { x: me.x + me.w * .1, y: me.top + me.h * .38, w: u * .09, h: u * .09, color: line, alpha: 0, p0: .01, z: 5 }).tick((p, t, dt) => { const d = it.d; p.alpha = ease(p.alpha, d.foresight && !d.parry && !d.foresight.avoided ? .5 + .3 * Math.sin(t * 6) : 0, dt, 6); p.rot = t * .8; });
            it.set = (d, old) => { if (old && !old.foresight && d.foresight) { c.pop(ex, ey, BLOOD, 'spark', 8); c.sfx('soul_hit', { vol: .24 }); } };
            it.end = () => { st.hud.fore = null; st.hud.eye = null; };
        },
        // 선택의 시간: 대상 위에 떠 있는 두 빛깔의 표식.
        timeOfChoice(c, it) {
            const s = { E: c.foe, d: 1 }, m = markAt(s), { u } = c;
            c.field('choicemark', { x: m.x, y: m.y, w: u * .1, h: u * .14, color: BLOOD, color2: [.4, 1, .6], p0: 1, p1: 1, alpha: 0, add: .6, z: 5 }).tick((p, t, dt) => {
                p.alpha = ease(p.alpha, it.d.marked ? 1 : 0, dt, 8); p.y = m.y + Math.sin(t * 2) * u * .008; p.p0 = 1 + .3 * Math.sin(t * 3); p.p1 = 1 + .3 * Math.sin(t * 3 + PI);
            });
        },
        // 이기어검술: 적의 몸 둘레를 도는 검. 한 번 부르면 세 자루가 주인에게서 날아가 궤도에 들고, 칠 때마다 한 자루씩 빠져나간다(공격 장면이 take로 가져간다).
        // 서버는 불러 둔 묶음의 수만 알려 주므로 남은 자루는 여기서 센다. 준비가 되면 주인의 어깨 뒤에 검의 윤곽이 어른거린다.
        flyingSword(c, it) {
            const { u, me, foe, st } = c, ring = swordRing(foe, u), mem = st.mem || (st.mem = {}), slots = [], x0 = me.x + me.w * .3, y0 = me.top + me.h * .22; let made = false, count = 0, trim = null;
            for (let i = 0; i < 6; i++) slots.push({ on: false, taken: false, born: -9, ph: i * TAU / 3 + (i > 2 ? PI / 3 : 0), x: null, y: 0, rot: 0 });
            const add = (n, now, fly) => { let j = 0; for (const q of slots) if (!q.on && n > 0) { q.on = true; q.taken = false; q.born = fly ? now + j++ * .09 : now - 9; n--; count++; } mem.swords = count; };
            const cut = max => { for (let i = slots.length - 1; i >= 0 && count > max; i--) if (slots[i].on) { slots[i].on = false; count--; } mem.swords = count; };
            add(Math.min(mem.swords == null ? 6 : mem.swords, 3 * (it.d.swords || 0)), c.now(), false);
            c.shape('ring', { x: ring.x, y: ring.y, w: ring.rx * 2, h: ring.ry * 2, color: SOUL, alpha: 0, p0: .92, p1: .05, z: .4 }).tick((p, t, dt) => {
                if (trim && c.now() >= trim.at) { cut(trim.max); trim = null; }
                p.alpha = ease(p.alpha, count > 0 ? .2 : 0, dt, 5);
                const e = made ? null : pic('sword'); if (!e) return; made = true;
                slots.forEach(q => c.sprite({ x: x0, y: y0, size: tall(e, u * .27), alpha: 0, glow: .6, edge: SOUL, z: 4 }, e.id).tick((sp, t2, dt2) => {
                    const T = c.now(), a = T * 1.5 + q.ph, depth = Math.sin(a), near = depth * .5 + .5, k = clamp((T - q.born) / .5), kk = 1 - (1 - k) ** 3;
                    sp.x = lerp(x0, ring.x + Math.cos(a) * ring.rx, kk); sp.y = lerp(y0, ring.y + depth * ring.ry, kk) - Math.sin(k * PI) * u * .08;
                    sp.rot = lerp(PI / 2, -depth * .3, kk); sp.sx = sp.sy = .8 + .2 * near; sp.z = depth > 0 ? 4 : .6;
                    sp.alpha = q.on ? (T >= q.born ? ease(sp.alpha, .7 + .3 * near, dt2, 10) : 0) : q.taken ? 0 : ease(sp.alpha, 0, dt2, 6);
                    q.x = sp.x; q.y = sp.y; q.rot = sp.rot;
                }));
                c.sprite({ x: me.x - me.w * .4, y: me.top + me.h * .2, size: tall(e, u * .15), rot: -.2, alpha: 0, add: 1, glow: .4, edge: SOUL, z: 1.6 }, e.id).tick((sp, t2, dt2) => { sp.alpha = ease(sp.alpha, it.d.ready ? .26 + .14 * Math.sin(t2 * 4) : 0, dt2, 8); sp.y = me.top + me.h * .2 + Math.sin(t2 * 2) * u * .006; });
            });
            // 궤도에 든 검 가운데 옆으로 가장 멀리 나와 있는 한 자루를 내준다.
            it.take = () => {
                const T = c.now(); let best = null, far = -1;
                for (const q of slots) { if (!q.on || q.x == null || T < q.born + .5) continue; const f = Math.abs(q.x - ring.x); if (f > far) { far = f; best = q; } }
                if (!best) return null;
                best.on = false; best.taken = true; count--; mem.swords = count;
                return { x: best.x, y: best.y, rot: best.rot };
            };
            // 묶음이 사라졌다는 소식은 마지막 공격과 함께 오므로, 그 검이 떠난 뒤에 남은 것을 거둔다.
            it.set = (d, old) => { const a = d.swords || 0, b = old ? old.swords || 0 : 0; if (a > b) { trim = null; add(3 * (a - b), c.now(), true); } else if (a < b) trim = { at: c.now() + .7, max: 3 * a }; };
        },
        // 죽을 각오로: HP가 20% 아래로 내려간 동안 핏빛 기운이 몸을 감싼다.
        deathWish(c, it) {
            const { u, me } = c;
            c.field('aura', { x: me.x, y: me.bot - me.h * .55, w: Math.max(me.w * 1.3, u * .3), h: me.h * 1.1, color: BLOOD, color2: [.3, 0, .04], p0: 1, p1: 2.6, p2: .6, alpha: 0, z: 0 }).tick((p, t, dt) => { p.alpha = ease(p.alpha, it.d.active ? .6 + .12 * Math.sin(t * 5) : 0, dt, 4); });
        },
        // 꺼지지 않는 불꽃: 대상의 발밑에서 타는 푸른 불.
        eternalFlame(c, it) {
            const { u, foe } = c, w = Math.max(u * .16, foe.w * .5), h = Math.min(u * .22, foe.h * .4);
            c.field('flame', { x: foe.x + foe.w * .12, y: foe.bot - h / 2, w, h, color: ETERNAL, color2: ETERNAL2, p0: .7, p1: 2.2, p2: 1, p3: 0, alpha: 0, z: 1 }).tick((p, t, dt) => { p.alpha = ease(p.alpha, it.d.burning ? .85 : 0, dt, 4); });
        },
        // 움직일수록 깊게: 몸통에 남은 칼자국. 터질 때마다 한 마디씩 더 찢어지며 더 넓게 벌어지고, 아직 남은 발동은 찢어질 자리의 점선으로 보인다. 깊어질수록 피가 잦게 듣는다.
        deepeningBleed(c, it) {
            const { S, u, foe } = c, g = gashAt(foe, u), cx = Math.cos(g.rot), cy = Math.sin(g.rot); let next = 0;
            c.field('gash', { x: g.x, y: g.y, w: g.len, h: u * .085, rot: g.rot, color: [1, .16, .2], color2: [.35, 0, .04], p0: .3, p1: 0, p2: 0, p3: 0, add: .25, alpha: 0, seed: .4, z: 3 }).tick((p, t, dt) => {
                const left = it.d.left || 0, on = left > 0, k = (5 - left) / 5, since = c.now() - it.gain, burst = since >= 0 && since < .35 ? 1 - since / .35 : 0;
                if (on && p.alpha < .03) { p.p0 = .3; p.p1 = 0; }
                p.p0 = ease(p.p0, on ? .3 + .7 * k : 1, dt, 14); p.p1 = ease(p.p1, .3 + .7 * (on ? k : 1) + burst * .3, dt, 12); p.p2 = burst; p.p3 = on ? 1 : 0;
                p.alpha = ease(p.alpha, on ? 1 : 0, dt, on ? 8 : 2);
                if (!on || S.reduced || t < next) return;
                next = t + 1.1 - k * .7;
                const f = (.3 + .7 * k) * (.2 + .5 * Math.abs(Math.sin(t * 7.3))) - .5;
                S.burst({ x: g.x + cx * g.len * f, y: g.y + cy * g.len * f + u * .01, n: 1 + Math.round(k * 2), t: c.late(), cell: 'drop', add: .1, color: [1, .25, .25], color2: C.wine, vy: u * .05, speed: [0, u * .04], life: [.5, .8], size: [u * .012, u * .022], grav: u * 1.6, stretch: .5 });
            });
            it.set = (d, old) => { if (old && d.left < old.left) it.gain = c.now(); };
        },
        // 천사강림: 천사가 내려와 주인 앞에 떠서 싸운다. 날개는 따로 움직인다.
        angelDescent(c, it) {
            const { S, u, me, st } = c; let parts = null, born = 0;
            c.shape('glow', { x: me.x, y: me.y, w: u * .1, h: u * .1, color: [1, .95, .75], alpha: 0, p0: 1.3, z: 1.2 }).tick((halo, t, dt) => {
                const active = it.d.until > st.clock(), now = c.now(), body = active && !parts ? pic('angel') : null, wing = body && pic('wing');
                if (body && wing) {
                    const h = Math.min(u * .46, me.h * .85), k = h / body.h, hx = Math.min(me.x + me.w * .5 + u * .1, S.W * .5), hy = Math.max(me.top + me.h * .3, h * .5 + u * .16), ww = h * .8;
                    born = it.first ? now - 9 : now; parts = { nodes: [], hx, hy };
                    // 날개 뿌리는 그림 속 등(어깨뼈)의 자리다.
                    const rootX = (.4 - .5) * body.w * k, rootY = (.2 - .5) * body.h * k, pose = { x: hx, y: hy, a: 0, lift: 0 };
                    [1, -1].forEach(dir => {
                        const node = c.sprite({ x: hx, y: hy, size: wide(wing, ww), pivot: [.06, .8], flip: dir, alpha: 0, glow: .25, edge: GOLD, flow: .004, z: dir > 0 ? 1.7 : 1.8 }, wing.id);
                        node.tick((p, time) => {
                            const fold = it.fold && now2() < it.fold.until ? Math.sin(clamp((now2() - it.fold.t0) / (it.fold.until - it.fold.t0)) * PI) : 0, beat = Math.sin(time * 2.6 + (dir > 0 ? 0 : .35));
                            p.x = pose.x + rootX + dir * h * .02; p.y = pose.y + rootY; p.alpha = pose.a;
                            p.rot = dir * (.12 - beat * .15 - pose.lift * .55 + fold * .55);
                            p.sx = p.sy = 1 - fold * .12;
                        });
                        parts.nodes.push(node);
                    });
                    const now2 = c.now, main = c.sprite({ x: hx, y: hy, size: tall(body, h), alpha: 0, glow: .3, edge: [1, .9, .6], flow: .003, fvy: -.3, z: 2 }, body.id);
                    main.tick(p => {
                        const time = c.now(), intro = clamp((time - born) / 1.1), k2 = 1 - (1 - intro) ** 3, gone = it.d.until <= st.clock();
                        const hitK = it.jab && time >= it.jab.t0 - .12 && time < it.jab.t0 + .3 ? Math.sin(clamp((time - it.jab.t0 + .12) / .42) * PI) : 0;
                        pose.x = hx + hitK * u * .05; pose.y = lerp(-h * .6, hy, k2) + Math.sin(time * 1.4) * u * .008 - (gone ? (1 - pose.a) * u * .2 : 0);
                        pose.a = ease(pose.a, gone ? 0 : clamp(intro * 2.5), .016, gone ? 3 : 20); pose.lift = (1 - k2) + hitK * .4;
                        p.x = pose.x; p.y = pose.y; p.alpha = pose.a; p.flash = hitK * .35 + Math.max(0, .5 - intro) * .8;
                        it.tip = it.tip || { x: 0, y: 0 }; it.tip.x = pose.x + (.97 - .5) * body.w * k; it.tip.y = pose.y + (.14 - .5) * body.h * k;
                        if (gone && pose.a < .02) { parts.nodes.forEach(node => { node.dead = true; }); parts = null; it.tip = null; }
                    });
                    parts.nodes.push(main);
                    if (!it.first) S.burst({ x: hx, y: 0, n: 16, t: c.late(), cell: 'petal', add: .7, color: C.white, color2: GOLD, radius: u * .2, flat: .1, vy: u * .3, speed: [0, u * .1], life: [1.2, 2], size: [u * .02, u * .04], grow: .8, turb: u * .12, spin: 5, over: 1 });
                }
                // 뒤에서 번지는 후광.
                const on = parts ? 1 : 0; halo.x = parts ? parts.hx : me.x; halo.y = parts ? parts.hy - u * .05 : me.y; halo.w = halo.h = u * (.7 + .05 * Math.sin(t * 2));
                halo.alpha = ease(halo.alpha, on && active ? .32 : 0, dt, 3);
                if (parts && active && !S.reduced && t > (it.next || 0)) { it.next = t + .45; S.burst({ x: parts.hx, y: parts.hy, n: 1, t: c.late(), cell: 'petal', add: .7, color: C.white, color2: GOLD, radius: u * .2, vy: u * .1, speed: [0, u * .05], life: [1.2, 1.8], size: [u * .016, u * .03], grow: .8, turb: u * .1, spin: 4, alpha: .8 }); }
            });
            it.strike = (t0, at) => { it.jab = { t0: t0 + at }; };
            it.guard = (t0, dur) => { it.fold = { t0, until: t0 + dur }; };
        },
        // 죽음을 초월하는 자: 마지막 기회 동안 세상이 어두워지고, 남은 공격만큼의 촛불과 줄어드는 시간의 고리가 머리 위에 뜬다.
        transcendDeath(c, it) {
            const { S, u, me, st } = c, cx = me.x, cy = Math.max(me.top - u * .06, u * .2), gold = [1, .86, .5], total = 10000;
            const live = () => it.d.until > st.clock();
            c.shape('rect', { x: me.x, y: me.y, w: Math.max(S.W, S.H) * 1.5, h: Math.max(S.W, S.H) * 1.5, color: [.03, 0, .06], alpha: 0, add: 0, p0: .1, p1: .72, white: 0, z: -60 }).tick((p, t, dt) => { p.alpha = ease(p.alpha, live() ? .78 : 0, dt, 3); });
            c.field('aura', { x: me.x, y: me.bot - me.h * .6, w: Math.max(me.w * 1.4, u * .32), h: me.h * 1.2, color: gold, color2: [.3, .02, .32], p0: 1, p1: 1.8, p2: .7, alpha: 0, z: 0 }).tick((p, t, dt) => { p.alpha = ease(p.alpha, live() ? .9 : 0, dt, 3); });
            c.field('gauge', { x: cx, y: cy, w: u * .15, h: u * .15, color: gold, color2: [.4, .3, .5], p0: 1, p1: .09, alpha: 0, add: .6, z: 5 }).tick((p, t, dt) => {
                const left = clamp((it.d.until - st.clock()) / total); p.p0 = left; p.alpha = ease(p.alpha, live() ? 1 : 0, dt, 5);
                const w = u * .15 * (left < .3 ? 1 + .08 * Math.sin(t * 14) : 1); p.w = p.h = w;
            });
            [-1, 1].forEach((k, i) => {
                let was = 0;
                c.field('flame', { x: cx + k * u * .028, y: cy - u * .012, w: u * .05, h: u * .085, color: gold, color2: [1, .4, .1], p0: .8, p1: 2.4, p2: 1, p3: 0, alpha: 0, seed: i * .4, z: 6 }).tick((p, t, dt) => {
                    const on = live() && (it.d.attacksLeft || 0) > i ? 1 : 0;
                    if (was && !on && live()) S.burst({ x: p.x, y: p.y, n: 5, t: c.late(), cell: 'smoke', add: 0, layer: 1, color: [.6, .55, .65], color2: [.2, .18, .22], alpha: .6, vy: -u * .12, speed: [0, u * .04], life: [.6, 1], size: [u * .02, u * .04], grow: 2 });
                    was = on; p.alpha = ease(p.alpha, on, dt, on ? 6 : 12);
                });
            });
        },
        // 백화요란: 공격마다 대상의 몸에 꽃망울이 맺힌다. 여섯이 차면 한꺼번에 핀다(만개 장면).
        hundredFlowers(c, it) {
            const { u, foe } = c, tones = [ROSE, [1, .8, .9], [.85, .6, 1], [1, .7, .5]];
            for (let i = 0; i < 8; i++) {
                const slot = flowerSlot(foe, i), size = u * (.07 + (i % 3) * .012);
                c.field('flowerbloom', { x: slot.x, y: slot.y, w: size, h: size, color: tones[i % 4], color2: [.7, .15, .4], p0: 0, p1: 5 + (i % 3), p2: i % 2 ? .5 : -.5, alpha: 0, add: .15, seed: i * .13, z: 3 }).tick((p, t, dt) => {
                    const on = i < (it.d.flowers || 0); p.p0 = ease(p.p0, on ? .72 + .08 * Math.sin(t * 2.2 + i) : 0, dt, on ? 9 : 16); p.alpha = ease(p.alpha, on ? 1 : 0, dt, on ? 9 : 16);
                });
            }
            it.set = (d, old) => { if (old && d.flowers > old.flowers) for (let i = old.flowers; i < Math.min(8, d.flowers); i++) { const slot = flowerSlot(foe, i); c.pop(slot.x, slot.y, tones[i % 4], 'petal', 4); } };
        },
        // 갑옷 깎아내기: 대상의 가슴께에 뜬 작은 방패 문장. 깎일 때마다 금이 한 마디씩 내려가고, 30%에서 두 쪽으로 갈라진 채 달아올라 남는다.
        armorShred(c, it) {
            const { u, foe } = c, m = shieldAt(foe, u);
            c.field('aegis', { x: m.x, y: m.y, w: m.r * 2, h: m.r * 2.3, color: STEEL, color2: SHIELD2, p0: 0, p1: 0, p2: 0, add: 0, alpha: 0, z: 5 }).tick((p, t, dt) => {
                const pct = it.d.percent || 0, k = clamp(pct / 30), broken = k >= 1, since = c.now() - it.gain, kick = since >= 0 && since < .3 ? 1 - since / .3 : 0, size = 1 + kick * .22;
                if (p.alpha < .03) { p.p0 = 0; p.p1 = 0; }
                p.p0 = ease(p.p0, k, dt, 12); p.p1 = ease(p.p1, broken ? .8 + .08 * Math.sin(t * 3) : 0, dt, 9); p.p2 = kick * .8;
                p.alpha = ease(p.alpha, pct > 0 ? (broken ? .7 : .95) : 0, dt, 6);
                p.x = m.x + Math.sin(t * 80) * u * .005 * kick; p.y = m.y + Math.sin(t * 1.6) * u * .004; p.w = m.r * 2 * size; p.h = m.r * 2.3 * size;
            });
            it.set = (d, old) => { if (old && d.percent > old.percent) { it.gain = c.now(); c.pop(m.x, m.y, STEEL, 'shard', 3 + Math.round(d.percent / 8)); if (d.percent < 30) c.sfx('armor_crack', { vol: .34, rate: .8 + d.percent / 60, cool: 80 }); } };
        },
        // 고통스러운 상처: 벌어진 상처가 남아 있는 동안 붉게 뛴다. 아래의 눈금은 다음 상처까지 쌓인 치명타다.
        painfulWound(c, it) {
            const { u, foe, st } = c;
            c.field('crack', { x: foe.x - foe.w * .08, y: foe.top + foe.h * .62, w: u * .22, h: u * .22, rot: .7, color: BLOOD, color2: C.wine, p0: 0, p1: 4, p2: 1, add: .4, alpha: 0, seed: .61, z: 2 }).tick((p, t, dt) => {
                const on = it.d.until > st.clock(); p.p0 = ease(p.p0, on ? .8 + .12 * Math.sin(t * 6) : 0, dt, 6); p.alpha = ease(p.alpha, on ? .9 : 0, dt, 5);
            });
            c.field('pips', { x: foe.x - foe.w * .36, y: foe.top + foe.h * .34 + u * .034, w: u * .12, h: u * .022, color: [1, .5, .4], color2: [.5, .2, .18], p0: 0, p1: 5, p2: 0, alpha: 0, add: .3, z: 5 }).tick((p, t, dt) => { const n = it.d.crits || 0; p.p0 = ease(p.p0, n, dt, 8); p.alpha = ease(p.alpha, n > 0 ? .9 : 0, dt, 5); });
        },
        // 한 칸씩 오르는 검무: 어깨 앞에 차례로 높아지는 세 자루의 칼날. 다음 일반 공격의 연격 수만큼 빛이 차오르고, 한 칸 오를 때마다 한 음 높은 쇳소리가 난다. 셋째는 금빛이다.
        comboStaircase(c, it) {
            const { u, me } = c, x = me.x + me.w * .5 + u * .075, y = me.top + me.h * .2;
            c.field('risers', { x, y, w: u * .15, h: u * .135, color: STEEL, color2: [.3, .38, .56], p0: 0, p1: 0, alpha: 0, add: .4, z: 4 }).tick((p, t, dt) => {
                const step = it.d.step || 1, since = c.now() - it.gain;
                p.p0 = ease(p.p0, step, dt, step < p.p0 ? 5 : 12); p.p1 = since >= 0 && since < .3 ? 1 - since / .3 : 0; p.alpha = ease(p.alpha, .95, dt, 4); p.y = y + Math.sin(t * 1.5) * u * .003;
            });
            it.set = (d, old) => { if (old && d.step > old.step) { it.gain = c.now(); c.pop(x + (d.step - 2) * u * .05, y - u * .02, d.step > 2 ? GOLD : STEEL, 'spark', 4); c.sfx('blade_ring', { vol: .18, rate: d.step > 2 ? 1.5 : 1.19, cool: 80, vary: 0 }); } };
        },
        // 결실: 어깨 위의 열매. 공격할수록 익어 가고, 다 익으면 다음 공격이 확정 치명타다.
        fruition(c, it) {
            const { u, me } = c, x = me.x + me.w * .4, y = me.top + me.h * .06, tone = [.5, .9, .35], deep = [.1, .4, .1], RIPE = [[.5, .9, .35], [1, .85, .3], [1, .5, .2]], DEEP = [[.1, .4, .1], [.8, .45, .05], [.85, .12, .08]];
            c.field('orb', { x, y, w: u * .05, h: u * .05, color: tone, color2: deep, p0: .5, p1: .8, p2: 0, p3: 0, alpha: 0, z: 4 }).tick((p, t, dt) => {
                const n = clamp(it.d.count || 0, 0, 2), size = u * (.05 + n * .028) * (n >= 2 ? 1 + .08 * Math.sin(t * 6) : 1);
                for (let i = 0; i < 3; i++) { tone[i] = ease(tone[i], RIPE[n][i], dt, 5); deep[i] = ease(deep[i], DEEP[n][i], dt, 5); }
                p.w = p.h = ease(p.w, size, dt, 8); p.alpha = ease(p.alpha, .95, dt, 4); p.y = y + Math.sin(t * 1.6) * u * .005; p.p2 = n >= 2 ? .5 : 0;
            });
            c.shape('streak', { x: x + u * .012, y: y - u * .03, w: u * .045, h: u * .016, rot: -.7, color: [.5, 1, .45], alpha: .8, p0: .8, z: 4 });
        },
        // 신성한 번개: 대상의 머리 위에 모이는 빛. 세 번째 공격이 가까울수록 커지고 튄다.
        holyLightning(c, it) {
            const { u, foe } = c;
            c.field('orb', { x: foe.x + foe.w * .3, y: foe.top + foe.h * .06, w: u * .04, h: u * .04, color: [1, .95, .7], color2: [.9, .6, .15], p0: .5, p1: 3, p2: 0, p3: .1, alpha: 0, z: 4 }).tick((p, t, dt) => {
                const n = clamp(it.d.count || 0, 0, 2); p.w = p.h = ease(p.w, u * (.035 + n * .03), dt, 8); p.p2 = ease(p.p2, n * .55, dt, 6); p.alpha = ease(p.alpha, .35 + n * .3, dt, 5);
            });
        },
        // 악마 사냥꾼: 대상에 걸린 조준. 세 번째 공격이 가까울수록 조여든다.
        demonHunter(c, it) {
            const { u, foe } = c;
            c.field('reticle', { x: foe.x, y: foe.top + foe.h * .4, w: u * .22, h: u * .22, color: [.86, .84, 1], color2: [.4, .3, .8], p0: 1, p1: .5, alpha: 0, z: 2 }).tick((p, t, dt) => {
                const n = clamp(it.d.count || 0, 0, 2); p.p0 = ease(p.p0, 1 - n * .5, dt, 8); p.alpha = ease(p.alpha, .16 + n * .22, dt, 5); p.w = p.h = ease(p.w, u * (.24 - n * .04), dt, 8);
            });
        },
        // 되감기: 쓰기 전에는 등 뒤에서 작은 시계가 간다. 발동 뒤 6초 동안은 시간의 막이 몸을 감싼다.
        timeRewind(c, it) {
            const { u, me, st } = c;
            c.field('clockface', { x: me.x - me.w * .5, y: me.top + me.h * .7, w: u * .075, h: u * .075, color: TIME, color2: [.2, .25, .8], p0: 0, p1: 0, p2: 0, z: 4 }).tick((p, t, dt) => {
                const guard = it.d.guardUntil > st.clock(); p.p0 = guard ? -t * 9 : Math.floor(t) * TAU / 12; p.p2 = guard ? 1 : 0; p.p1 = ease(p.p1, guard ? 1 : it.d.used ? 0 : .7, dt, 4);
            });
            c.shape('hex', { x: me.x, y: me.top + me.h * .5, w: Math.max(me.w * 1.25, u * .3), h: me.h * 1.02, color: TIME, alpha: 0, p0: 6, p1: .06, p2: .02, z: 3 }).tick((p, t, dt) => { p.alpha = ease(p.alpha, it.d.guardUntil > st.clock() ? .3 + .08 * Math.sin(t * 3) : 0, dt, 4); });
        },
        // 결투 신청: 둘 사이에 놓인 세검. 결투가 걸리면 떠올라 돌고, 서로 가속하는 10초 동안에는 두 사람의 발밑에 남은 시간만큼의 고리가 놓이고
        // 발목과 허리 사이를 바람 두 줄기가 오르내리며 감아 돈다(나는 금빛, 적은 붉은빛, 서로 반대로 돈다). until이 되면 고리가 닫히며 함께 걷히고, 천이 한 번 스치는 소리만 난다.
        duelChallenge(c, it) {
            const { S, u, me, foe, st } = c, mx = (me.x + foe.x) / 2, low = Math.max(me.bot, foe.bot) - u * .1, high = (me.top + me.h * .5 + foe.top + foe.h * .5) / 2 - u * .1;
            const left = () => it.d.stage === 'haste' ? clamp((Number(it.d.until || 0) - st.clock()) / 10000) : 0;
            let on = 0, was = left();
            c.sprite({ x: mx, y: low, size: u * .16, alpha: 0, glow: 0, edge: DUEL, z: 1 }, 'paint:aug-duel').tick((p, t, dt) => {
                // 가속의 고리와 바람은 반격이 닿고 가속 장면이 지나간 뒤(약 0.7초)에 나타난다. 상태는 스킬을 쓴 순간에 이미 haste로 온다.
                const stage = it.d.stage, k = left(), fast = k > 0 && k < .93, lifted = k > 0 || stage === 'pending';
                on = ease(on, fast ? 1 : 0, dt, 5);
                // 끝: 소리는 한 번만, 작게.
                if (was > 0 && k <= 0) c.sfx('wing_flap', { vol: .3, rate: .8 });
                was = k;
                p.alpha = ease(p.alpha, stage === 'ready' ? .5 : lifted ? .9 : 0, dt, 5); p.glow = ease(p.glow, lifted ? .6 + .25 * Math.sin(t * 7) : 0, dt, 6);
                p.y = ease(p.y, lifted ? high : low, dt, 5) + Math.sin(t * 2) * u * .0006; p.sx = p.sy = ease(p.sx, lifted ? 1.2 : 1, dt, 6);
                p.rot = fast ? p.rot + dt * 2.4 : ease(p.rot, 0, dt, 6);
            });
            [[me, DUEL, 1], [foe, DUEL2, -1]].forEach(([B, color, dir]) => {
                const w = Math.max(B.w * 1.25, u * .3), r = Math.max(B.w * .48, u * .11);
                c.field('gauge', { x: B.x, y: B.bot - u * .012, w, h: w * .26, color, color2: dark(color, .25), p0: 1, p1: .1, alpha: 0, add: .7, z: -1 }).tick(p => { p.p0 = left(); p.alpha = on * .8; });
                if (!S.reduced) for (let j = 0; j < 2; j++) c.trail('energy', { path: (k, t) => { const a = dir * (t * 9 + k * 2.6) + j * PI; return [B.x + Math.cos(a) * r, B.bot - B.h * (.08 + .3 * (.5 + .5 * Math.sin(t * 1.3 + j * PI))) + Math.sin(a) * u * .022]; }, head: 1, tail: 0, width: u * .026, color: lite(color, .4), color2: color, p0: 5, p1: 4, p2: 1.3, seg: 18, alpha: 0, z: 2 }).tick(p => { p.alpha = on * .8; });
            });
            it.set = (d, old) => { if (old && old.stage === 'ready' && d.stage !== 'ready' && d.stage !== 'done') c.pop(mx, low, DUEL, 'spark', 8); };
        },
        // 가시 갑옷: 발밑을 도는 가시덩굴.
        thornArmor(c) { const { u, me } = c; c.field('briar', { x: me.x, y: me.bot - u * .012, w: Math.max(me.w * 1.2, u * .3), h: u * .085, color: THORN, color2: [.14, .28, .1], p0: .62, p1: 13, p2: .2, p3: .25, alpha: .7, add: .1, z: -2 }); },
        // 가속: 발목을 감아 도는 바람.
        haste(c) { const { S, u, me } = c; if (!S.reduced) c.trail('energy', { path: (s, t) => { const a = t * 5.5 + s * 3.6; return [me.x + Math.cos(a) * Math.max(me.w * .5, u * .12), me.bot - u * .04 + Math.sin(a) * u * .026]; }, head: 1, tail: 0, width: u * .016, color: [.8, 1, 1], color2: [.3, .7, 1], p0: 5, p1: 4, p2: 1.4, seg: 18, alpha: .5, z: 1 }); },
        // 원펀치 룰: 주먹에 맺힌 붉은 빛.
        onePunch(c) { const { u, me } = c; c.shape('flare', { x: me.x + me.w * .46, y: me.top + me.h * .46, w: u * .07, h: u * .07, color: [1, .45, .25], alpha: .4, p0: .02, z: 4 }).tick((p, t) => { p.alpha = .3 + .16 * Math.sin(t * 4); p.rot = t * .6; }); },
        // 취약: 대상의 몸 위를 옮겨 다니는 급소의 반짝임.
        dotCritical(c) { const { u, foe } = c; c.shape('flare', { x: foe.x, y: foe.y, w: u * .06, h: u * .06, color: [1, .55, .88], alpha: 0, p0: .008, z: 4 }).tick((p, t) => { const k = Math.floor(t / 1.1), q = (t / 1.1) % 1, a = k * 2.4; p.x = foe.x + Math.cos(a) * foe.w * .2; p.y = foe.top + foe.h * (.5 + Math.sin(a * 1.7) * .2); p.alpha = Math.sin(q * PI) ** 3 * .6; p.rot = q; }); },
        // 보호막 흡수: 손목 곁의 작은 육각.
        shieldSiphon(c) { const { u, me } = c; c.shape('hex', { x: me.x + me.w * .34, y: me.top + me.h * .34, w: u * .055, h: u * .055, color: [.45, .9, 1], alpha: .32, p0: 1.6, p1: .12, p2: .04, z: 4 }).tick((p, t) => { p.rot = t * .5; }); },
        // 리플레이: 등 뒤에서 무한히 도는 고리.
        replay(c) { const { S, u, me } = c; if (!S.reduced) c.trail('energy', { path: (s, t) => { const a = t * 2.2 + s * 2.4, k = u * .045 / (1 + Math.sin(a) ** 2); return [me.x - me.w * .4 + Math.cos(a) * k, me.top + me.h * .86 + Math.sin(a) * Math.cos(a) * k]; }, head: 1, tail: 0, width: u * .012, color: TIME, color2: [.45, .3, 1], p0: 4, p1: 3, p2: 1.2, seg: 20, alpha: .55, z: 1 }); },
        // 두 가지 정체성: 어깨 뒤에서 도는 흑백의 한 쌍.
        dualIdentity(c) { const { u, me } = c; c.field('taiji', { x: me.x - me.w * .46, y: me.top + me.h * .52, w: u * .05, h: u * .05, color: [.96, .94, 1], color2: [.12, .08, .25], p0: 1, p1: 1.2, alpha: .7, add: 0, z: 4 }); }
    };

    // 한 엔진에 하나의 지속 무대를 둔다. list가 그대로이고 화면 배치도 그대로이면 아무 일도 하지 않는다(호스트는 매 프레임 부른다).
    function sync(fx, list, options) {
        if (!fx) return;
        let st = registry.get(fx);
        if (!st) registry.set(fx, st = { list: null, items: new Map(), handle: null, fig: null, geo: '', checkAt: 0, clock: () => Date.now(), hud: { fore: null, eye: null, parry: false }, owned: '' });
        const o = options || {}, real = typeof performance == 'object' ? performance.now() : Date.now();
        if (o.clock) st.clock = o.clock;
        if (list === st.list && real < st.checkAt) return;
        st.checkAt = real + 400;
        const size = fx.size, fig = o.fig ? o.fig() : null, geo = fig ? [size.W, size.H, fig.me.x, fig.me.top, fig.me.bottom, fig.me.w, fig.foe.x, fig.foe.top, fig.foe.bottom, fig.foe.w].map(n => Math.round(n * 500)).join() : size.W + ',' + size.H;
        const moved = geo !== st.geo, entries = Array.isArray(list) ? list.filter(entry => entry && AURA[entry.id]) : [];
        if (list === st.list && !moved) return;
        st.list = list; st.fig = fig;
        // 가진 증강의 그림과 소리를 미리 받아 둔다.
        const owned = entries.map(entry => entry.id).join();
        if (owned !== st.owned) {
            st.owned = owned;
            entries.forEach(entry => (ART_OF[entry.id] || []).forEach(loadArt));
            fx.preload(scenesOf(entries.map(entry => entry.id)));
        }
        if (moved || !entries.length) { if (st.handle) st.handle.stop(); st.handle = null; st.items.clear(); st.hud.fore = null; st.hud.eye = null; st.geo = geo; }
        if (!entries.length) return;
        const first = !st.handle;
        if (first) {
            const me = fig ? fig.me : { x: .25, top: .4, bottom: .83, w: .16 }, foe = fig ? fig.foe : { x: .74, top: .25, bottom: .8, w: .22 };
            st.handle = fx.persist('augment:aura', { images: [], src: o.src || { x: me.x, y: me.top + (me.bottom - me.top) * .4 }, dst: o.dst || { x: foe.x, y: foe.top + (foe.bottom - foe.top) * .4 } }, S => { st.S = S; });
        }
        const S = st.S, box = (q, p) => { const b = q ? { x: q.x * S.W, y: p.y, top: q.top * S.H, bot: q.bottom * S.H, w: q.w * S.W } : { x: p.x, y: p.y, top: p.y - .27 * S.U, bot: p.y + .2 * S.U, w: .2 * S.U }; b.h = b.bot - b.top; return b; };
        const me = box(fig && fig.me, S.A), foe = box(fig && fig.foe, S.T), late = () => S.host.time - S.t0;
        const seen = new Set();
        entries.forEach(data => {
            seen.add(data.id);
            let it = st.items.get(data.id);
            if (!it) {
                it = { d: data, nodes: [], gain: -9, first: first || moved };
                const add = node => { it.nodes.push(node); return node; };
                const c = {
                    S, st, u: S.U, me, foe, late, now: () => S.host.time,
                    field: (name, props) => add(S.field(name, Object.assign({ keep: true }, props), late())),
                    shape: (kind, props) => add(S.shape(kind, Object.assign({ keep: true }, props), late())),
                    trail: (name, props) => add(S.trail(name, Object.assign({ keep: true }, props), late())),
                    sprite: (props, key) => add(S.sprite(Object.assign({ keep: true }, props), late(), key)),
                    // 상태가 바뀐 자리에서 튀는 작은 빛.
                    pop: (x, y, color, cell, n) => { if (!it.first) S.burst({ x, y, n, t: late(), cell, color: lite(color, .5), color2: color, speed: [S.U * .1, S.U * .32], life: [.3, .6], size: [S.U * .012, S.U * .028], grow: .5, drag: 2, spin: 8, grav: cell === 'drop' ? S.U * 1.4 : 0 }); },
                    sfx: (name, opts) => { if (!it.first) S.sfx(name, late(), opts); }
                };
                AURA[data.id](c, it);
                st.items.set(data.id, it);
            } else if (it.d !== data) {
                const old = it.d; it.d = data; it.first = false;
                if (it.set) it.set(data, old);
            }
        });
        for (const [id, it] of Array.from(st.items)) if (!seen.has(id)) { it.nodes.forEach(node => { node.dead = true; }); if (it.end) it.end(); st.items.delete(id); }
        fx.kick();
    }
    // 증강 하나가 쓰는 장면들(미리 받기용).
    const SCENE_IDS = [];
    function scenesOf(ids) { const out = []; ids.forEach(id => SCENE_IDS.forEach(scene => { if (scene.startsWith('augment:' + id + '.') || scene === 'augment:' + id) out.push(scene); })); ids.forEach(id => (SKILL_OF[id] || []).forEach(name => out.push('skill:' + name))); return out; }
    const SKILL_OF = { fatalDestiny: ['운명'], soulReaper: ['명계의 부름'], swordDance: ['검무'], manualShift: ['변속'], readIntent: ['간파'] };

    // ================= 글자가 필요한 표시 (HUD 캔버스) =================
    // 읽어 낸 살의의 예정 피해. 눈 아래에 판독한 수치가 어른거린다: 색이 갈라진 겹글자, 훑고 지나가는 주사선, 좌우의 눈금.
    function hud(fx, g, w, h, time) {
        const st = fx && registry.get(fx), info = st && st.hud;
        if (!info || !info.fore || !info.eye) return;
        const fore = info.fore, t = (time || 0) / 1000, u = info.eye.size, x = Math.max(70, Math.min(w - 70, info.eye.x)), y = info.eye.y + u * .095, narrow = w < 650;
        const size = Math.round(Math.max(15, Math.min(26, u * .034))), parry = info.parry, avoid = !!fore.avoided;
        const main = parry ? '#ffd985' : avoid ? '#a9d4ff' : '#ff6b62', text = Number(fore.damage || 0).toLocaleString('ko-KR');
        const flicker = .82 + .18 * Math.sin(t * 17) * Math.sin(t * 5.3), jitter = Math.sin(t * 31) > .93 ? 1.5 : 0;
        g.save();
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = '800 ' + Math.round(size * .42) + 'px Pretendard, sans-serif'; g.globalAlpha = .85; g.fillStyle = main;
        const caption = parry ? '간 파' : avoid ? '빗 나 감' : fore.critical ? '살 의   치 명' : '살 의';
        g.fillText(caption, x, y - size * .78);
        g.font = 'italic 900 ' + size + 'px Pretendard, sans-serif';
        const tw = g.measureText(text).width;
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = .4 * flicker; g.fillStyle = '#ff2a3c'; g.fillText(text, x - 1.6 - jitter, y);
        g.fillStyle = '#39c8ff'; g.fillText(text, x + 1.6 + jitter, y + .5);
        g.globalCompositeOperation = 'source-over';
        g.globalAlpha = flicker; g.fillStyle = parry || avoid ? main : '#ffe9e4'; g.shadowColor = main; g.shadowBlur = 10; g.fillText(text, x, y); g.shadowBlur = 0;
        // 훑는 주사선.
        const scan = (t * .9) % 1.6;
        if (scan < 1) { g.globalAlpha = .5 * Math.sin(scan * PI); g.fillStyle = '#fff'; g.fillRect(x - tw / 2 - 4 + (tw + 8) * scan, y - size * .5, 1.5, size); }
        // 좌우의 눈금과, 막아 낼 공격이면 그어 지운 줄.
        g.globalAlpha = .7; g.strokeStyle = main; g.lineWidth = 1.2; g.beginPath();
        for (const k of [-1, 1]) { const bx = x + k * (tw / 2 + 9); g.moveTo(bx + k * 4, y - size * .46); g.lineTo(bx, y - size * .46); g.lineTo(bx, y + size * .46); g.lineTo(bx + k * 4, y + size * .46); }
        if (parry || avoid) { g.moveTo(x - tw / 2 - 3, y + 1); g.lineTo(x + tw / 2 + 3, y - 1); }
        g.stroke();
        if (!narrow && fore.critical && !parry && !avoid) { g.globalAlpha = .55 + .3 * Math.sin(t * 8); g.fillStyle = '#ffcf68'; g.beginPath(); g.moveTo(x, y + size * .78); g.lineTo(x - 4, y + size * .62); g.lineTo(x + 4, y + size * .62); g.fill(); }
        g.restore();
    }
    // 마지막 기회(죽음을 초월하는 자)가 진행 중인지. 호스트가 HP를 0으로 보일 때 쓴다.
    function lastStand(list, now) { const entry = Array.isArray(list) ? list.find(item => item && item.id === 'transcendDeath') : null; return entry && entry.until > now ? entry : null; }

    // 적의 사건에 얹히는 장면들(실험실과 테스트가 방향을 고를 때 쓴다).
    const ENEMY_SIDE = ['deathWish.awaken', 'duelChallenge.counter', 'duelChallenge.haste', 'onePunch.counter', 'readIntent.parry', 'timeRewind', 'angelDescent.descend', 'angelDescent.guard', 'transcendDeath.trigger', 'thornArmor'];
    ['fruition', 'conqueror.max', 'conqueror.cavalry', 'fatalDestiny.execute', 'holyLightning', 'dotCritical', 'eternalFlame.ignite', 'eternalFlame', 'replay', 'timeOfChoice.mark', 'timeOfChoice.burst', 'timeOfChoice.heal',
        'flyingSword.summon', 'flyingSword', 'duelChallenge', 'duelChallenge.counter', 'duelChallenge.haste', 'onePunch', 'onePunch.counter', 'seasons.spring', 'seasons.summer', 'seasons.autumn', 'seasons.winter', 'seasons.burn',
        'manualShift.crit', 'deepeningBleed.apply', 'deepeningBleed', 'soulReaper.harvest', 'readIntent.parry', 'timeRewind', 'demonHunter', 'angelDescent.descend', 'angelDescent', 'angelDescent.guard',
        'transcendDeath.trigger', 'transcendDeath.revive', 'transcendDeath.fail', 'comboStaircase.3', 'painfulWound.apply', 'painfulWound', 'shieldSiphon', 'armorShred.max', 'thornArmor', 'hundredFlowers.bloom', 'deathWish.awaken']
        .forEach(name => SCENE_IDS.push('augment:' + name));
    Object.assign(F.soundHits, { horse_neigh: .1, sword_draw: .12, thunder_crack: .12, blade_sheath: .44, gear_shift: .22, reverse_swell: 1.36, fire_whoosh: .18, flame_burst: .12 });

    // 2마리 전투의 적 교체(호스트가 그린다)에 쓰는 효과음: fall 쓰러진 적이 흩어지는 숨, arrive 다음 적이 들어서는 바람, land 착지,
    // end 마지막 적이 빛으로 부서지는 순간의 낮은 울림, endGrand 큰 적(엘리트, 보스 등)일 때 그 위에 겹치는 무너지는 소리.
    const WAVE_SFX = { fall: 'soul_breath', arrive: 'whoosh_heavy', land: 'land_thud', end: 'boom_low', endGrand: 'rock_break' };
    F.augmentAuras = sync;
    F.augmentHud = hud;
    F.augments = { wave: WAVE_SFX, scenes: SCENE_IDS, skills: ['운명', '명계의 부름', '검무', '변속', '간파'], enemySide: ENEMY_SIDE.map(name => 'augment:' + name), auras: Object.keys(AURA), lastStand, loadArt, art: Object.keys({ angel: 1, wing: 1, reaper_body: 1, scythe: 1, cavalry: 1, sword: 1 }), state: fx => registry.get(fx) };
})(typeof globalThis != 'undefined' ? globalThis : this);
