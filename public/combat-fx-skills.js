// 스킬 장면집. 스킬마다 재료집(combat-fx-kit.js)의 실시간 재료로 한 편의 장면을 짠다.
// 장면집(combat-fx-scenes.js) 다음에 싣는다. 같은 id를 다시 등록하면 여기 것이 쓰인다.
// 장면의 meta: impact는 수치가 들어가는 순간(초), hits는 여러 번 때리는 스킬의 타수별 시각, cast는 전투를 멈춰 둘 길이다.
(function (root) {
    'use strict';
    const F = typeof module == 'object' && module.exports ? require('./combat-fx.js') : root.CombatFX;
    if (!F || !F.kit || !F.sceneDef) return;
    const K = F.kit, C = K.C, M = F.matter, def = F.sceneDef, path = K.path, mix = K.mix, dark = K.dark, lite = K.lite;
    const PI = Math.PI, TAU = PI * 2, clamp = K.clamp, lerp = K.lerp;
    const skill = name => 'skill:' + name;
    const sand = [.95, .82, .62], rock = [.3, .24, .22];

    // ---- 이 장면집만 쓰는 무늬 ----
    // 나인 멘스 모리스의 판: 세 겹의 정사각형과 그 변의 가운데를 잇는 선. p0 그려진 정도.
    F.shader('board', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;q.x*=1.45*(1.-q.y*.3);vec2 a=abs(q);float m=max(a.x,a.y),lw=.03,l=0.;
  l+=1.-smoothstep(0.,lw,abs(m-.9));l+=1.-smoothstep(0.,lw,abs(m-.6));l+=1.-smoothstep(0.,lw,abs(m-.3));
  l+=(1.-smoothstep(0.,lw,min(a.x,a.y)))*step(.3,m)*step(m,.9);
  float show=1.-smoothstep(uP.x*1.3-.12,uP.x*1.3,m);
  float al=clamp(l,0.,1.)*show;
  return vec4(heat(al*.8),al+(1.-smoothstep(0.,1.,m))*.14*show);
}`);
    // 태극. 보통 섞기로 쓴다. p0 크기(0~1), p1 도는 속도.
    F.shader('taiji', `vec4 fx(vec2 uv){
  vec2 q=rot2(uTime*uP.y)*(uv*2.-1.)/max(uP.x,.01);float r=length(q),disc=1.-smoothstep(.95,1.,r);
  float w=step(0.,q.x);
  w=mix(w,1.,1.-smoothstep(.48,.5,length(q-vec2(0.,.5))));w=mix(w,0.,1.-smoothstep(.48,.5,length(q+vec2(0.,.5))));
  w=mix(w,0.,1.-smoothstep(.13,.15,length(q-vec2(0.,.5))));w=mix(w,1.,1.-smoothstep(.13,.15,length(q+vec2(0.,.5))));
  return vec4(mix(uColor2,uColor.rgb,w)+smoothstep(.88,.97,r)*.5,disc);
}`);
    // 위험 표지: 세모와 느낌표. p0 채움.
    F.shader('warn', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.;q.y=-q.y-.18;
  float d=max(abs(q.x)*.866+q.y*.5,-q.y)-.42;
  float edge=1.-smoothstep(.0,.05,abs(d+.05)),fill=(1.-smoothstep(-.02,0.,d))*uP.x;
  float bar=(1.-smoothstep(.045,.06,abs(q.x)))*step(-.08,q.y)*step(q.y,.42);
  float dotm=1.-smoothstep(.05,.065,length(q-vec2(0.,-.2)));
  float mark=clamp(bar+dotm,0.,1.)*step(d,-.08);
  float al=clamp(edge+fill*.35+mark,0.,1.);
  return vec4(mix(uColor.rgb,vec3(1.),mark*.8+edge*.3),al);
}`);
    // 조준경. p0 조여든 정도(1에서 0으로), p1 도는 속도.
    F.shader('reticle', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.,aq=abs(q);float r=length(q),a=atan(q.y,q.x),lw=.024,l=0.;
  l+=(1.-smoothstep(0.,lw,abs(r-.84)))*step(.28,abs(fract((a+uTime*uP.y)/1.5708)-.5)*2.);
  l+=(1.-smoothstep(0.,lw*.8,abs(r-.58)))*step(abs(fract((a-uTime*uP.y*1.6)/1.0472)-.5)*2.,.7);
  l+=1.-smoothstep(0.,lw*.8,abs(r-.12-.3*uP.x));
  l+=(1.-smoothstep(0.,lw*.7,min(aq.x,aq.y)))*step(.2+.3*uP.x,max(aq.x,aq.y))*step(max(aq.x,aq.y),.98);
  l+=1.-smoothstep(.025,.05,r);
  float al=clamp(l,0.,1.);
  return vec4(heat(al*.9),al);
}`);
    // 인장: 네모 테두리 안의 전서 같은 획. 보통 섞기로 쓴다. p0 먹의 진하기.
    F.shader('seal', `vec4 fx(vec2 uv){
  vec2 q=uv*2.-1.,a=abs(q);float m=max(a.x,a.y),border=step(.76,m)*step(m,.95);
  vec2 g=(q*.5+.5)*5.,gi=floor(g),gf=fract(g);float h=texture2D(uNoise,(gi+.5+uSeed*23.)/256.).r;
  float bar=h<.5?step(abs(gf.x-.5),.17):step(abs(gf.y-.5),.17);
  float hook=step(abs(gf.x-.5),.36)*step(abs(gf.y-(h<.5?.2:.8)),.15);
  float n=noise(q*13.+uSeed*5.);
  float ink=clamp(border+clamp(bar+hook,0.,1.)*step(m,.68),0.,1.)*smoothstep(.1,.3,n+uP.x*.7);
  return vec4(mix(uColor2,uColor.rgb,n),ink);
}`);
    // 카드. 뒷면은 감청 바탕의 금빛 격자, 앞면은 흰 바탕의 스페이드 에이스.
    const cardShape = (g, w, h, r) => { g.beginPath(); g.moveTo(r, 0); g.arcTo(w, 0, w, h, r); g.arcTo(w, h, 0, h, r); g.arcTo(0, h, 0, 0, r); g.arcTo(0, 0, w, 0, r); g.closePath(); };
    F.paint('paint:card-back', 200, 280, (g, w, h) => {
        cardShape(g, w, h, 18); g.fillStyle = '#0d1a3a'; g.fill(); g.save(); g.clip();
        g.strokeStyle = 'rgba(240,200,110,.55)'; g.lineWidth = 2;
        for (let i = -h; i < w + h; i += 22) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + h, h); g.stroke(); g.beginPath(); g.moveTo(i + h, 0); g.lineTo(i, h); g.stroke(); }
        g.restore();
        g.strokeStyle = '#f1d28a'; g.lineWidth = 7; cardShape(g, w, h, 18); g.stroke();
        g.lineWidth = 2; g.strokeRect(20, 20, w - 40, h - 40);
        g.fillStyle = '#f1d28a'; g.beginPath(); g.moveTo(w / 2, h / 2 - 34); g.lineTo(w / 2 + 24, h / 2); g.lineTo(w / 2, h / 2 + 34); g.lineTo(w / 2 - 24, h / 2); g.closePath(); g.fill();
    });
    F.paint('paint:card-face', 200, 280, (g, w, h) => {
        const spade = (x, y, s) => { g.beginPath(); g.moveTo(x, y - s); g.bezierCurveTo(x + s * 1.3, y - s * .1, x + s * 1.05, y + s * .85, x + s * .12, y + s * .5); g.lineTo(x + s * .32, y + s); g.lineTo(x - s * .32, y + s); g.lineTo(x - s * .12, y + s * .5); g.bezierCurveTo(x - s * 1.05, y + s * .85, x - s * 1.3, y - s * .1, x, y - s); g.fill(); };
        cardShape(g, w, h, 18); g.fillStyle = '#fbf7ee'; g.fill();
        g.strokeStyle = '#c9b68a'; g.lineWidth = 5; cardShape(g, w, h, 18); g.stroke();
        g.fillStyle = '#12131c'; spade(w / 2, h / 2, 54); spade(30, 62, 13); spade(w - 30, h - 54, 13);
        g.font = '700 30px Georgia,serif'; g.textAlign = 'center'; g.fillText('A', 30, 40); g.fillText('A', w - 30, h - 76);
    });

    // ---- 몸짓 ----
    // 대상이 맞아 밀려났다 돌아온다. power 0~1.
    function knock(S, t, power, o) {
        const q = o || {}, u = S.U, p = power == null ? .6 : power;
        return S.pose('t', { flash: 1 }, t).to({ dx: u * (.025 + .085 * p), dy: -u * (q.lift || 0), rot: .04 + .09 * p, sx: .95, sy: 1.04 }, .06, 'out3').to({ flash: 0, sx: 1, sy: 1 }, .12).to({ dx: 0, dy: 0, rot: 0 }, .26 + .22 * p, 'elastic').end();
    }
    // 떤다(감전, 공명, 분노).
    function quake(S, who, t, dur, amp, flash) {
        return S.pose(who, {}, t).tick((p, time) => { const left = 1 - clamp(time / dur); p.dx = Math.sin(time * 96) * amp * left; if (flash) p.flash = flash * (.5 + .5 * Math.sin(time * 60)) * left; }).wait(dur).end();
    }
    // 시전자가 움츠렸다 대상 앞까지 뛰어들고, 머문 뒤 돌아온다. 돌려주는 값은 닿는 시각이다.
    function lunge(S, t, o) {
        const q = o || {}, u = S.U, dist = q.dist == null ? S.T.x - S.A.x - u * .24 : q.dist, wind = q.wind == null ? .16 : q.wind, go = q.go == null ? .09 : q.go;
        S.pose('a', {}, t).to({ dx: -u * .045, sx: .93, sy: 1.05, rot: -.08 }, wind, 'out').to({ dx: dist, sx: 1.1, sy: .95, rot: .12 }, go, 'in3').to({ sx: 1, sy: 1, rot: .03 }, .06).wait(q.stay == null ? .16 : q.stay).to({ dx: 0, rot: 0 }, q.back == null ? .24 : q.back, 'io').end();
        return t + wind + go;
    }
    // 시전하는 몸짓: 살짝 떠오르며 힘을 준다.
    function chant(S, t, dur, o) {
        const q = o || {}, u = S.U;
        return S.pose('a', {}, t).to({ dy: -u * (q.lift == null ? .02 : q.lift), sx: 1.03, sy: 1.03, flash: q.flash || 0 }, dur * .3, 'out').wait(dur * .4).to({ dy: 0, sx: 1, sy: 1, flash: 0 }, dur * .3, 'io').end();
    }
    // 그림의 화소를 타격 자리에서 흩는다(그림의 빛깔을 입자로만 빌려 쓴다).
    const scatter = (S, x, y, size, t, o) => M.shatter(S, S.id, x, y, size, t, Object.assign({ spread: size * .7, dur: .6, frac: .5 }, o));
    // 한 점으로 날아가 닿는 입자(훔친 금화, 빨아들인 피): 수명에 맞춰 속도를 정한다.
    const homing = (tx, ty, grav) => P => { P.vx = (tx - P.x) / P.life; P.vy = (ty - P.y) / P.life - .5 * (grav || 0) * P.life; };

    // ================= 일반 스킬 =================
    def(skill('정권'), { impact: .42, cast: .78, sounds: ['air_puff', 'air_whoosh', 'punch_a', 'boom_b'] }, S => {
        // 발밑의 기운을 주먹으로 끌어모아, 한 걸음에 거리를 지우고 꽂는다. 주먹이 지난 길에 음속의 고리가 차례로 터진다.
        const u = S.U, A = S.A, T = S.T, hx = T.x - u * .1, hy = T.y - u * .02, red = [1, .34, .18];
        S.sfx('air_puff', 0, { vol: .5, rate: .8 }); S.sfx('air_whoosh', .2, { vol: .6, rate: 1.5 }); S.sfx('punch_a', .42, { vol: 1 }); S.sfx('boom_b', .43, { vol: .6 });
        lunge(S, .1, { wind: .16, go: .1, stay: .18 });
        K.dust(S, A.x, S.gA, 8, sand, 0, { flat: .3, radius: u * .1, speed: .15 });
        S.burst({ x: A.x + u * .06, y: A.y, n: 26, t: .02, cell: 'spark', ring: u * .24, radial: -1, speed: [u * .9, u * 1.4], life: [.14, .2], size: [u * .02, u * .04], color: sand, color2: red, stretch: 1.2, over: .16 });
        K.glow(S, A.x + u * .06, A.y, u * .09, red, .14, .16);
        K.dart(S, A.x, A.y, hx, hy, .24, .32, { color: sand, color2: red, width: u * .2, props: { p0: 3, p1: 9 } });
        for (let i = 0; i < 3; i++) {
            const x = lerp(A.x + u * .2, hx - u * .06, i / 2);
            S.field('shock', { x, y: hy, w: u * .05, h: u * .16, color: sand, color2: red, p0: .5, p1: .16, p2: .4, seed: i }, .29 + i * .045).to({ w: u * .15 * (1 + i * .35), h: u * (.46 + i * .18), p0: .88, alpha: 0 }, .32, 'out3').end();
        }
        K.impact(S, hx, hy, .42, { power: .95, color: red, zoom: .05 });
        S.field('shock', { x: T.x + u * .08, y: hy, w: u * .1, h: u * .3, color: C.white, color2: red, p0: .6, p1: .12, p2: .8 }, .44).to({ x: T.x + u * .4, w: u * .34, h: u * .95, p0: .9, alpha: 0 }, .38, 'out3').end();
        knock(S, .42, 1);
        K.dust(S, T.x, S.gT, 12, sand, .44, { flat: .25, radius: u * .1, angle: 0, spread: 1.3, speed: .7 });
        K.shards(S, T.x, S.gT, 8, rock, .44, { speed: .8 });
        S.sprite({ x: hx - u * .06, y: hy, size: u * .44, pivot: [.8, .5], alpha: 0, glow: .8, edge: red, flash: .8 }, .4).to({ alpha: .85 }, .03).to({ flash: 0, alpha: 0, sx: 1.25, sy: 1.25 }, .2, 'out').end();
        scatter(S, hx, hy, u * .36, .44, { spread: u * .3, frac: .4 });
    });

    def(skill('럭키펀치'), { impact: .52, cast: .9, sounds: ['coins_b', 'air_puff', 'punch_a', 'glass_a', 'gem'] }, S => {
        // 동전을 튕겨 올리고, 떨어지는 동전을 그대로 후려친다. 동전은 황금 혜성이 되어 날아가 행운을 터뜨린다.
        const u = S.U, A = S.A, T = S.T, cx = A.x + u * .1, top = A.y - u * .3, hx = T.x - u * .06, hy = T.y;
        S.sfx('coins_b', 0, { vol: .5 }); S.sfx('gem', .14, { vol: .4 }); S.sfx('air_puff', .28, { vol: .55 }); S.sfx('punch_a', .52, { vol: .95 }); S.sfx('glass_a', .53, { vol: .5 });
        S.shape('disc', { x: cx, y: A.y, w: u * .05, h: u * .05, color: C.gold, add: .4, z: 3 }, 0)
            .tick((p, t) => { const s = clamp(t / .28); p.y = lerp(A.y, top, 1 - (2 * s - 1) ** 2); p.h = u * .05 * Math.abs(Math.cos(t * 34)) + u * .006; }).wait(.28).end();
        K.sparks(S, cx, A.y, 6, C.gold, 0, { speed: .3 });
        S.pose('a', {}, .16).to({ dx: -u * .03, rot: -.07 }, .1, 'out').to({ dx: u * .07, rot: .1 }, .05, 'in3').wait(.1).to({ dx: 0, rot: 0 }, .2, 'io').end();
        K.flare(S, cx, A.y - u * .02, u * .12, C.gold, .28, .22);
        const comet = S.field('comet', { x: cx, y: A.y, w: u * .5, h: u * .2, rot: Math.atan2(hy - A.y, hx - cx), color: C.gold, color2: C.amber, p0: .85, p1: .7, z: 3 }, .29);
        comet.to({ x: hx - u * .1, y: hy }, .23, 'in').to({ alpha: 0, w: u * .2 }, .05).end();
        S.burst({ x: cx, y: A.y, n: 18, t: .3, cell: 'star5', line: [hx - cx, hy - A.y], color: C.gold, color2: C.amber, speed: [u * .05, u * .25], life: [.3, .55], size: [u * .018, u * .04], grow: .1, spin: 8, over: .22, even: true });
        K.impact(S, hx, hy, .52, { power: .85, color: C.gold, zoom: .04 });
        knock(S, .52, .8);
        for (let i = 0; i < 4; i++) S.burst({ x: hx, y: hy, n: 1, t: .52, cell: 'petal', color: C.leaf, color2: C.moss, angle: -PI * .75 + i * PI / 2, spread: 0, speed: u * .42, life: .7, size: u * .16, grow: .7, drag: 4, rot: -PI * .75 + i * PI / 2, add: .3 });
        S.burst({ x: hx, y: hy, n: 16, t: .52, cell: 'star5', color: lite(C.gold), color2: C.gold, speed: [u * .4, u * 1.1], life: [.5, .9], size: [u * .025, u * .06], grow: .3, grav: u * 1.6, drag: 1.2, spin: 9 });
        S.burst({ x: hx, y: hy, n: 12, t: .53, cell: 'coin', add: .2, color: C.gold, color2: C.amber, angle: -PI / 2, spread: 2, speed: [u * .5, u * 1.1], life: [.6, 1], size: [u * .022, u * .036], grow: 1, grav: u * 2.6, spin: 14 });
        scatter(S, hx, hy, u * .4, .53, { frac: .35 });
    });

    def(skill('불사조'), { impact: .62, cast: 1.05, images: [skill('불사조')], sounds: ['fire_long', 'fire_big', 'air_whoosh'] }, S => {
        // 발밑의 불씨에서 불새가 날아올라 날개를 치며 솟았다가, 대상에게 곤두박질쳐 불기둥으로 터진다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, fly = path.bow(A.x + u * .05, A.y - u * .1, T.x, T.y, u * .62), t0 = .16, T1 = .46;
        S.sfx('air_whoosh', .12, { vol: .5 }); S.hit('fire_long', .62, { vol: .85 }); S.sfx('fire_big', .62, { vol: .7 });
        K.fire(S, A.x, S.gA, u * .26, u * .4, 0, .4); K.embers(S, A.x, S.gA - u * .1, 14, C.fire, 0, { over: .25 });
        chant(S, 0, .5, { lift: .015 });
        const bird = S.field('comet', { x: A.x, y: A.y, w: u * .42, h: u * .2, color: [1, .72, .25], color2: C.ember, p0: .9, p1: .9, z: 3 }, t0);
        const at = time => fly(K.clamp((time - 0) / T1) ** 1.6);
        bird.tick((p, time) => { const a = at(time), b = at(time + .02); p.x = a[0]; p.y = a[1]; p.rot = Math.atan2(b[1] - a[1], b[0] - a[0]); }).wait(T1).to({ alpha: 0 }, .04).end();
        [-1, 1].forEach(side => {
            S.trail('energy', { head: 1, tail: 0, width: u * .2, taper: .75, seg: 16, color: C.fire, color2: C.ember, p0: 3, p1: 5, p2: .5, z: 2, path: (s, time) => {
                const a = at(time), b = at(time + .02), ang = Math.atan2(b[1] - a[1], b[0] - a[0]), flap = Math.sin(time * 26) * .5, k = 1 - s, len = u * .34;
                const lx = -k * len * (.55 + .25 * flap * side), ly = side * (k * len * (.5 + .4 * flap) + Math.sin(k * PI) * len * .22), c = Math.cos(ang), n = Math.sin(ang);
                return [a[0] + lx * c - ly * n, a[1] + lx * n + ly * c];
            } }, t0).wait(T1).to({ alpha: 0 }, .05).end();
        });
        K.dart(S, A.x, A.y, T.x, T.y, t0, T1 + .12, { color: C.fire, color2: C.ember, lift: u * .62, width: u * .12, ease: 'in', lead: .78, lag: .3 });
        S.burst({ x: 0, y: 0, n: 30, t: t0, cell: 'flame', color: [1, .8, .3], color2: C.ember, speed: [u * .05, u * .3], life: [.3, .6], size: [u * .03, u * .06], grow: .1, grav: -u * .3, over: T1, even: true, each: (P, i, k) => { const a = fly(k ** 1.6); P.x = a[0]; P.y = a[1]; } });
        K.impact(S, T.x, T.y, .62, { power: .9, color: C.fire });
        K.fire(S, T.x, g, u * .62, u * 1.05, .62, .75, { fat: 1.05 });
        K.crack(S, T.x, g, u * .36, .62, .5, {});
        K.embers(S, T.x, T.y, 40, C.fire, .64, { radius: u * .2, speed: .5, over: .4, rise: .5 });
        S.burst({ x: T.x, y: T.y - u * .3, n: 12, t: .7, cell: 'petal', add: .5, color: [1, .7, .25], color2: C.ember, radius: u * .25, speed: [u * .05, u * .2], life: [.8, 1.3], size: [u * .03, u * .06], grow: .6, grav: u * .25, turb: u * .12, spin: 5, over: .3 });
        knock(S, .62, .8);
    });

    def(skill('빙결'), { impact: .5, cast: 1.12, sounds: ['ice_a', 'ice_b', 'glass_big'] }, S => {
        // 서리가 땅을 타고 달려가 대상을 얼음 속에 가둔다. 한 박자 뒤, 얼어붙은 세계째로 깨진다.
        const u = S.U, A = S.A, T = S.T, g = S.gT;
        S.sfx('ice_a', .02, { vol: .5 }); S.hit('ice_b', .5, { vol: .8 }); S.sfx('glass_big', .95, { vol: .8 });
        chant(S, 0, .4);
        const marks = [];
        for (let i = 0; i < 6; i++) {
            const k = i / 5, x = lerp(A.x + u * .16, T.x - u * .14, k), h = u * (.12 + k * .2), t = .04 + i * .06;
            marks.push(K.crystal(S, x, lerp(S.gA, g, k), u * (.07 + k * .05), h, t, .9 - t, { lean: (S.rnd(i) - .5) * .5 }));
            K.sparks(S, x, lerp(S.gA, g, k), 4, C.ice, t, { angle: -PI / 2, speed: .4 });
        }
        K.stroke(S, 'energy', path.line(A.x + u * .1, S.gA, T.x, g), .02, .5, { color: C.ice, color2: C.deep, width: u * .05, lead: .8 });
        const cage = [[-.2, .42, -.34], [-.09, .7, -.14], [.02, .86, 0], [.13, .66, .16], [.23, .4, .36]].map(([dx, h, lean], i) =>
            K.crystal(S, T.x + dx * u, g, u * .2, u * h, .44 + Math.abs(i - 2) * .025, .5 - Math.abs(i - 2) * .025, { lean, grow: .1, fat: .62 }));
        S.lens('frost', { x: T.x, y: T.y, p0: 0, p1: .85, color2: C.ice }, .46).to({ p0: .34 }, .16, 'out3').wait(.33).to({ alpha: 0 }, .04).end();
        K.ring(S, T.x, g, u * .4, C.ice, .5, { flat: .3 });
        S.pose('t', { flash: .7 }, .5).wait(.45).to({ flash: 0 }, .1).end();
        if (!S.minor) { S.shake(6, .2, .5); S.stop(60, .5); }
        K.embers(S, T.x, T.y, 16, C.ice, .5, { radius: u * .25, rise: -.05, speed: .1, life: [.5, .9] });
        // 깨짐
        marks.concat(cage).forEach(node => node.at(.95).to({ alpha: 0 }, .05).end());
        S.lens('shatter', { x: T.x, y: T.y, p0: 0, p1: 13, p2: .5, p3: 0, color: [.42, 0, 0], color2: C.ice }, .95).to({ p0: .5, p3: 1 }, .3, 'out').end();
        K.shards(S, T.x, T.y, 34, C.ice, .95, { speed: 1.3, radius: u * .14, spread: TAU, add: .3 });
        K.impact(S, T.x, T.y, .95, { power: .7, color: C.ice });
        knock(S, .95, .5);
    });

    def(skill('000'), { impact: .56, cast: .95, sounds: ['beep', 'zap_big', 'glass_b', 'tick'] }, S => {
        // 세계가 지직거리고, 대상 머리 위로 0이 셋 떨어져 맞물린다. 세 번째가 잠기는 순간 색이 뒤집힌다.
        const u = S.U, T = S.T, y = T.y - u * .36, white = [.92, .96, 1];
        S.sfx('beep', 0, { vol: .4, rate: 1.4 }); S.sfx('zap_big', .56, { vol: .8 }); S.sfx('glass_b', .58, { vol: .6 });
        S.lens('glitch', { p0: .03, p1: 26, p2: .006, live: true }, 0).to({ p0: 0, p2: 0 }, .24, 'in').end();
        S.burst({ x: T.x - u * .3, y: T.y - u * .7, n: 46, t: .02, cell: 'zero', line: [u * .6, 0], color: white, alpha: .55, speed: 0, vy: u * 1.5, life: [.4, .7], size: [u * .03, u * .05], grow: 1, over: .55, rot: 0 });
        S.burst({ x: T.x - u * .3, y: T.y - u * .7, n: 30, t: .04, cell: 'one', line: [u * .6, 0], color: white, alpha: .45, speed: 0, vy: u * 1.9, life: [.3, .6], size: [u * .03, u * .045], grow: 1, over: .55, rot: 0 });
        const rings = [-1, 0, 1].map((k, i) => {
            const t = .1 + i * .13, ring = S.shape('ring', { x: T.x + k * u * .19, y: y - u * .2, w: u * .2, h: u * .26, color: white, alpha: 0, p0: .78, p1: .2, z: 3 }, t);
            ring.to({ y, alpha: 1 }, .08, 'in3').to({ h: u * .2 }, .03).to({ h: u * .26 }, .08, 'out');
            S.sfx('tick', t + .08, { vol: .6, rate: 1 + i * .15 });
            K.ring(S, T.x + k * u * .19, y, u * .12, white, t + .08, { th: .08, dur: .2 });
            return ring;
        });
        rings.forEach(ring => ring.at(.5).to({ x: T.x, y: T.y, w: u * .3, h: u * .3 }, .06, 'in3').to({ w: u * .9, h: u * .9, alpha: 0 }, .18, 'out').end());
        S.lens('mono', { x: T.x, y: T.y, p0: 0, p1: 1, p2: 1, p3: .4, color2: [.62, .62, .62], live: true }, .56).to({ p0: .34 }, .07, 'out').to({ p2: 0, p0: 1.4 }, .12, 'out').wait(.1).to({ alpha: 0 }, .14).end();
        K.impact(S, T.x, T.y, .56, { power: .8, color: white, ripple: false });
        S.burst({ x: T.x, y: T.y, n: 24, t: .57, cell: 'zero', color: white, speed: [u * .5, u * 1.3], life: [.4, .8], size: [u * .03, u * .06], grow: .4, drag: 2, spin: 6 });
        knock(S, .56, .7);
    });

    def(skill('SUPER EASY'), { impact: .5, cast: .88, sounds: ['swish_s', 'firework', 'holy_a'] }, S => {
        // 손가락 한 번 튕기면 세 빛깔이 서로를 감으며 날아가, 별 모양으로 터진다.
        const u = S.U, A = S.A, T = S.T, x0 = A.x + u * .1, y0 = A.y - u * .08, tones = [C.pink, C.aqua, C.gold];
        S.sfx('swish_s', .04, { vol: .6 }); S.sfx('holy_a', .14, { vol: .4 }); S.sfx('firework', .5, { vol: .8 });
        chant(S, 0, .3, { lift: .01 }); K.flare(S, x0, y0, u * .08, C.white, .05, .16);
        const len = Math.hypot(T.x - x0, T.y - y0), nx = -(T.y - y0) / len, ny = (T.x - x0) / len;
        tones.forEach((tone, i) => {
            const braid = s => { const w = Math.sin(s * TAU * 1.5 + i * TAU / 3) * u * .09 * Math.sin(s * PI); return [lerp(x0, T.x, s) + nx * w, lerp(y0, T.y, s) + ny * w]; };
            K.stroke(S, 'energy', braid, .12, .46, { color: tone, color2: dark(tone, .6), width: u * .07, lead: .8, lag: .34, ease: 'in', props: { seg: 40 } });
            S.burst({ x: 0, y: 0, n: 9, t: .14, cell: 'star', color: lite(tone), color2: tone, speed: [0, u * .12], life: [.25, .45], size: [u * .02, u * .045], grow: .1, over: .34, even: true, each: (P, j, k) => { const a = braid(k ** 1.4); P.x = a[0]; P.y = a[1]; } });
            K.ring(S, T.x, T.y, u * (.2 + i * .1), tone, .5 + i * .05, { th: .08, dur: .36 });
            S.burst({ x: T.x, y: T.y, n: 9, t: .5, cell: 'star5', color: lite(tone, .3), color2: tone, speed: [u * .35, u * 1.2], life: [.5, .95], size: [u * .03, u * .07], grow: .3, grav: u * 1.2, drag: 1.4, spin: 10, seed: i });
        });
        K.impact(S, T.x, T.y, .5, { power: .7, color: C.pink });
        S.shape('flare', { x: T.x, y: T.y, w: u * .1, h: u * .1, color: C.white, p0: .02, z: 4 }, .5).to({ w: u * .8, h: u * .8, rot: .6 }, .1, 'out3').to({ alpha: 0, rot: 1 }, .24, 'in').end();
        knock(S, .5, .6);
    });

    def(skill('가속'), { impact: 0, cast: .5, sounds: ['tick', 'wind_a', 'air_puff'] }, S => {
        // 발밑의 시계가 돌기 시작하고, 바늘이 점점 빨라지다 세상이 뒤로 밀려난다.
        const u = S.U, A = S.A, g = S.gA, teal = [.3, 1, .86];
        [0, .14, .24, .31, .36, .4].forEach((t, i) => S.sfx('tick', t, { vol: .5, rate: 1 + i * .12, cool: 0 }));
        S.sfx('wind_a', .34, { vol: .5 }); S.sfx('air_puff', .42, { vol: .4 });
        K.circle(S, A.x, g, u * .3, 0, .6, { color: teal, sides: 12, spin: 5 });
        [[u * .22, .016, TAU * 3.5], [u * .14, .022, TAU * .6]].forEach(([len, w, turns]) =>
            S.shape('streak', { x: A.x, y: A.y, w: len * 2, h: u * w, rot: -PI / 2, color: teal, alpha: 0, p0: .3, z: 3 }, 0).to({ alpha: .9 }, .08).with({ rot: -PI / 2 + turns }, .56, 'in3').to({ alpha: 0 }, .12).end());
        K.ring(S, A.x, A.y, u * .26, teal, .0, { th: .06, dur: .3 });
        for (let i = 0; i < 12; i++) {
            const y = A.y + (S.rnd(i) - .5) * u * .5, t = .3 + S.rnd(i + 20) * .35, len = u * (.2 + S.rnd(i + 40) * .3);
            S.shape('streak', { x: A.x + u * .45, y, w: len, h: u * .008, color: i % 3 ? teal : C.white, alpha: .8, p0: .4, z: 2 }, t).to({ x: A.x - u * .5 }, .16, 'lin').end();
        }
        S.pose('a', {}, .3).to({ rot: .13, dx: u * .035, sx: 1.05 }, .1, 'out').wait(.25).to({ rot: 0, dx: 0, sx: 1 }, .2, 'io').end();
        K.aura(S, A.x, g, u * .3, u * .55, .34, .6, { color: teal, speed: 4 });
        K.embers(S, A.x, A.y, 14, teal, .34, { angle: PI, spread: .4, speed: 1.2, rise: 0, life: [.2, .4] });
    });

    def(skill('갈취'), { impact: .46, cast: 1, images: [skill('갈취')], sounds: ['chain_b', 'punch_m', 'coins_big', 'coins_b'] }, S => {
        // 그림자의 사슬이 날아가 감기고, 홱 잡아당기면 대상의 금화가 포물선을 그리며 주인에게 쏟아진다.
        const u = S.U, A = S.A, T = S.T, x0 = A.x + u * .08, y0 = A.y - u * .04, line = path.bow(x0, y0, T.x, T.y, u * .05);
        S.sfx('chain_b', .04, { vol: .7 }); S.sfx('punch_m', .46, { vol: .8 }); S.sfx('coins_big', .5, { vol: .7 }); S.sfx('coins_b', .96, { vol: .5 });
        chant(S, 0, .3, { lift: 0 });
        const chain = S.trail('chain', { path: line, head: 0, tail: 0, width: u * .075, taper: .04, seg: 30, color: [.85, .7, 1], color2: C.night, p0: 30, p1: 0, p2: .01, add: .15 }, .04);
        chain.to({ head: 1 }, .18, 'out3').wait(.26).to({ head: 0 }, .22, 'in').end();
        K.stroke(S, 'energy', line, .04, .3, { color: C.violet, color2: C.night, width: u * .09, lead: .6 });
        K.orb(S, T.x, T.y, u * .12, .2, { shader: 'hole', color: C.violet, color2: C.night, p0: .05, spin: .7, add: 0 }).to({ p0: .42 }, .12, 'back').wait(.14).to({ p0: 0, alpha: 0 }, .14, 'in').end();
        S.pose('t', {}, .4).to({ dx: -u * .07, rot: -.08, flash: .6 }, .07, 'in3').to({ flash: 0 }, .1).to({ dx: 0, rot: 0 }, .34, 'elastic').end();
        S.pose('a', {}, .38).to({ dx: -u * .04, rot: -.08 }, .08, 'out').to({ dx: 0, rot: 0 }, .25, 'io').end();
        K.impact(S, T.x, T.y, .46, { power: .6, color: C.violet });
        S.burst({ x: T.x, y: T.y, n: 20, t: .47, cell: 'coin', add: .25, color: C.gold, color2: C.amber, radius: u * .06, life: [.42, .62], size: [u * .02, u * .034], grow: 1, grav: u * 3, spin: 16, over: .12, each: homing(A.x, A.y - u * .05, u * 3) });
        K.sparks(S, T.x, T.y, 10, C.gold, .47, { speed: .6 });
        K.glow(S, A.x, A.y - u * .05, u * .14, C.gold, .96, .3, .7);
        K.embers(S, A.x, A.y, 10, C.gold, .96, { cell: 'star', speed: .3 });
    });

    def(skill('건력'), { impact: 0, cast: .72, sounds: ['earth_a', 'chain_a', 'growl'] }, S => {
        // 땅이 갈라지며 붉은 사슬이 솟아 몸을 엇갈려 묶는다. 묶인 채로 힘이 끓어오르다, 사슬이 터져 나간다.
        const u = S.U, A = S.A, g = S.gA, red = [1, .2, .14];
        S.sfx('earth_a', .02, { vol: .6 }); S.sfx('chain_a', .1, { vol: .7 }); S.sfx('chain_a', .22, { vol: .6, rate: 1.2, cool: 0 }); S.hit('growl', .56, { vol: .6 });
        K.crack(S, A.x, g, u * .32, .02, .7, { color: red, color2: C.wine, n: 7 });
        K.dust(S, A.x, g, 8, rock, .04, { flat: .3, radius: u * .14 });
        const chains = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy], i) => {
            const from = [A.x + sx * u * .3, g - (sy > 0 ? u * .02 : 0)], to = [A.x - sx * u * .13, A.y - u * (sy > 0 ? .2 : -.02)];
            return S.trail('chain', { path: path.bow(from[0], from[1], to[0], to[1], u * .05), head: 0, tail: 0, width: u * .05, taper: .04, seg: 20, color: [1, .55, .45], color2: C.wine, p0: 16, p1: 0, p2: .01, add: .2 }, .1 + i * .045).to({ head: 1 }, .13, 'out3');
        });
        S.pose('a', {}, .2).to({ sx: .94, sy: .97, flash: .2 }, .12, 'out').wait(.2).to({ sx: 1.07, sy: 1.07, flash: .9 }, .06, 'in3').to({ flash: 0, sx: 1, sy: 1 }, .3, 'elastic').end();
        K.aura(S, A.x, g, u * .34, u * .7, .2, .8, { color: red, color2: C.wine, speed: 3 });
        quake(S, 'a', .3, .26, u * .008);
        chains.forEach((chain, i) => { chain.at(.56).to({ width: u * .09 }, .03).to({ alpha: 0, width: u * .02 }, .08).end(); K.sparks(S, A.x + (i % 2 ? 1 : -1) * u * .08, A.y - u * (i > 1 ? .1 : -.06), 7, red, .58, { speed: .9 }); });
        K.ring(S, A.x, A.y, u * .36, red, .58, { dur: .36 });
        K.fire(S, A.x, g, u * .4, u * .62, .56, .5, { color: red, color2: C.wine, alpha: .8 });
        K.embers(S, A.x, A.y, 20, red, .58, { radius: u * .14, rise: .5, speed: .4 });
        if (!S.minor) S.shake(8, .25, .58);
    });

    def(skill('글버지'), { impact: .55, cast: .95, sounds: ['field', 'earth_a', 'rock_break', 'stone'] }, S => {
        // 비취빛 방벽이 몸을 두르고, 땅속의 결정이 줄지어 솟아 달려가 대상의 발밑에서 터져 오른다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, jade = [.45, 1, .62], deep = [.02, .35, .2];
        S.hit('field', .04, { vol: .6 }); S.sfx('earth_a', .1, { vol: .6 }); S.sfx('stone', .28, { vol: .5 }); S.sfx('rock_break', .55, { vol: .8 });
        S.shape('hex', { x: A.x, y: A.y, w: u * .1, h: u * .12, color: jade, alpha: 0, p0: 5, p1: .07, p2: .05, z: 2 }, 0).to({ w: u * .42, h: u * .5, alpha: .8 }, .18, 'back').wait(.5).to({ alpha: 0, w: u * .5, h: u * .58 }, .3, 'out').end();
        K.ring(S, A.x, A.y, u * .3, jade, .04, { th: .06 });
        chant(S, 0, .45);
        for (let i = 0; i < 5; i++) {
            const k = i / 4, x = lerp(A.x + u * .2, T.x - u * .16, k), y = lerp(S.gA, g, k), t = .14 + i * .07;
            K.crystal(S, x, y, u * (.08 + k * .04), u * (.14 + k * .16), t, .28, { color: jade, color2: deep, lean: (i % 2 ? .3 : -.3) }).to({ p0: 0 }, .16, 'in').end();
            K.shards(S, x, y, 4, rock, t, { speed: .5 }); K.dust(S, x, y, 2, sand, t, { speed: .15 });
        }
        [[-.12, .5, -.3], [0, .82, 0], [.13, .56, .32]].forEach(([dx, h, lean], i) =>
            K.crystal(S, T.x + dx * u, g, u * .2, u * h, .52 + Math.abs(i - 1) * .03, .22, { color: jade, color2: deep, lean, fat: .6 }).to({ alpha: 0 }, .25, 'in').end());
        K.impact(S, T.x, T.y + u * .05, .55, { power: .8, color: jade });
        K.crack(S, T.x, g, u * .3, .55, .3, { color: jade, color2: C.soot });
        K.shards(S, T.x, g, 14, rock, .55, { speed: 1.1 }); K.shards(S, T.x, T.y, 10, jade, .56, { add: .5, speed: 1 });
        knock(S, .55, .7, { lift: .03 });
    });

    def(skill('나인 멘스 모리스'), { impact: .64, cast: 1, sounds: ['chip', 'earth_b', 'punch_b'] }, S => {
        // 대상의 발밑에 판이 그려지고, 흑백의 말이 하나씩 놓인다. 마지막 세 개가 한 줄을 이루면 그 줄이 빛기둥으로 솟는다.
        const u = S.U, T = S.T, g = S.gT + u * .02, R = u * .34, flat = .34;
        const spot = (nx, ny) => [T.x + nx * R / (1 - ny * .3), g + ny * R * flat];
        const order = [[-.9, -.9], [.6, 0], [0, -.6], [.9, -.9], [-.3, 0], [0, .3], [-.9, .9], [.9, .9], [0, .9]];
        S.field('board', { x: T.x, y: g, w: R * 2.9, h: R * 2 * flat, color: C.bone, color2: C.amber, p0: 0, z: -3 }, 0).to({ p0: 1 }, .16, 'out').wait(.56).to({ alpha: 0 }, .25).end();
        order.forEach(([nx, ny], i) => {
            const p = spot(nx, ny), t = .08 + i * .055, tone = i % 2 ? [.12, .11, .14] : C.bone, size = u * .06;
            S.shape('disc', { x: p[0], y: p[1] - u * .3, w: size, h: size * .62, color: tone, add: 0, alpha: 0, z: 2 }, t).to({ y: p[1], alpha: 1 }, .08, 'in3').to({ h: size * .4 }, .03).to({ h: size * .62 }, .06)
                .at(.64).to({ y: p[1] - u * (.2 + S.rnd(i) * .4), x: p[0] + (nx || S.rnd(i + 3) - .5) * u * .2, alpha: 0 }, .3, 'out').end();
            S.shape('ring', { x: p[0], y: p[1], w: size * .8, h: size * .5, color: C.bone, alpha: .9, p0: .8, p1: .14, z: 1 }, t + .08).to({ w: size * 2.4, h: size * 1.5, alpha: 0 }, .2, 'out').end();
            if (i % 2 === 0 || i > 5) S.sfx('chip', t + .08, { vol: .5, rate: .9 + i * .04, cool: 0 });
        });
        const a = spot(-.9, .9), b = spot(.9, .9);
        S.shape('streak', { x: T.x, y: a[1], w: 0, h: u * .03, color: C.gold, p0: .3, z: 3 }, .58).to({ w: (b[0] - a[0]) * 1.3 }, .05, 'out3').wait(.06).to({ alpha: 0 }, .12).end();
        S.sfx('earth_b', .56, { vol: .6 }); S.sfx('punch_b', .64, { vol: .8 });
        K.beam(S, T.x, g + u * .03, T.x, g - u * 1.1, u * .5, .62, .34, { color: C.gold, color2: C.amber, thick: .8 });
        K.impact(S, T.x, T.y, .64, { power: .8, color: C.gold });
        K.embers(S, T.x, T.y, 22, C.gold, .64, { radius: u * .2, rise: .8, speed: .6 });
        knock(S, .64, .7, { lift: .04 });
    });

    def(skill('모드 전환'), { impact: 0, cast: .5, sounds: ['teleport', 'wind_a', 'cast_b'] }, S => {
        // 화면이 한 번 지직거리고, 몸이 한 줄로 접혔다가 다른 빛깔로 펴진다.
        const u = S.U, A = S.A, tone = [.55, .45, 1];
        S.sfx('wind_a', 0, { vol: .4 }); S.sfx('cast_b', .02, { vol: .5 }); S.hit('teleport', .2, { vol: .7 });
        S.lens('glitch', { p0: .008, p1: 30, p2: .003, live: true }, .08).to({ p0: .016 }, .1).to({ p0: 0, p2: 0 }, .16, 'in').end();
        S.field('vortex', { x: A.x, y: A.y, w: u * .2, h: u * .2, color: tone, color2: C.deep, p0: 1.2, p1: 3, p2: 9, p3: 0, alpha: 0, z: 0 }, 0).to({ w: u * .8, h: u * .8, alpha: .85 }, .18, 'out3').wait(.1).to({ w: u * .3, h: u * .3, alpha: 0 }, .22, 'in').end();
        S.pose('a', {}, .1).to({ sx: .04, sy: 1.12, flash: 1 }, .1, 'in3').to({ sx: 1.08, sy: .98 }, .1, 'out3').to({ sx: 1, sy: 1, flash: 0 }, .2, 'out').end();
        S.shape('streak', { x: A.x, y: A.y, w: u * .9, h: u * .014, rot: PI / 2, color: C.white, alpha: 0, p0: .3, z: 4 }, .16).to({ alpha: 1 }, .03).to({ alpha: 0, w: u * 1.4 }, .14).end();
        [tone, C.aqua].forEach((c, i) => K.ring(S, A.x, A.y, u * (.3 + i * .12), c, .2 + i * .06, { th: .06, dur: .34 }));
        K.sparks(S, A.x, A.y, 16, tone, .2, { speed: .8, grav: 0 });
        K.embers(S, A.x, S.gA, 12, C.aqua, .22, { radius: u * .12, rise: .6 });
    });

    def(skill('백억이요'), { impact: .5, cast: .95, images: [skill('백억이요')], sounds: ['holy_b', 'coins_big', 'coins_a', 'metal_b'] }, S => {
        // 하늘이 열리고 금화가 쏟아진다. 마지막에 떨어지는 한 닢이 유난히 크다.
        const u = S.U, T = S.T, g = S.gT, top = T.y - u * .95;
        S.hit('holy_b', .1, { vol: .5 }); S.sfx('coins_big', .12, { vol: .7 }); S.hit('coins_a', .5, { vol: .8 }); S.sfx('metal_b', .5, { vol: .7 });
        K.rays(S, T.x, top + u * .1, u * .8, 0, .9, { color: C.gold, n: 5, spin: .3, alpha: .6 });
        K.beam(S, T.x, top, T.x, g, u * .44, .04, .7, { color: C.gold, color2: C.amber, thick: .5, shoot: .16, fall: .3 });
        S.burst({ x: T.x, y: top, n: 44, t: .08, cell: 'coin', add: .25, color: C.gold, color2: C.amber, radius: u * .1, speed: 0, vy: u * 1.2, grav: u * 4.4, life: [.42, .56], size: [u * .02, u * .036], grow: 1, spin: 18, over: .42 });
        const coin = S.shape('disc', { x: T.x, y: top, w: u * .26, h: u * .26, color: C.gold, add: .35, alpha: 0, z: 3 }, .3);
        coin.to({ alpha: 1 }, .04).tick((p, t) => { if (t < .2) { p.y = lerp(top, T.y, (t / .2) ** 2); p.h = u * .26 * Math.abs(Math.cos(t * 26)) + u * .02; } }).wait(.16).to({ h: u * .06, w: u * .4 }, .03).to({ alpha: 0, w: u * .6 }, .1).end();
        K.impact(S, T.x, T.y, .5, { power: .85, color: C.gold });
        K.ring(S, T.x, g, u * .46, C.gold, .5, { flat: .3 });
        S.burst({ x: T.x, y: T.y, n: 26, t: .5, cell: 'coin', add: .25, color: C.gold, color2: C.amber, angle: -PI / 2, spread: 2.4, speed: [u * .5, u * 1.3], life: [.6, 1.05], size: [u * .02, u * .036], grow: 1, grav: u * 2.8, spin: 16 });
        S.burst({ x: T.x, y: T.y, n: 14, t: .5, cell: 'star', color: C.white, color2: C.gold, radius: u * .2, speed: [0, u * .2], life: [.3, .7], size: [u * .03, u * .07], grow: .1, over: .4 });
        scatter(S, T.x, T.y, u * .44, .5, { frac: .35 });
        knock(S, .5, .7);
    });

    def(skill('비리'), { impact: .3, cast: .62, sounds: ['coins_b', 'slash_d', 'earth_a'] }, S => {
        // 대상에 금빛 직인이 찍히고, 검은 손길이 그것을 비스듬히 그어 두 쪽으로 어긋낸다.
        const u = S.U, T = S.T, mag = [1, .25, .75];
        S.sfx('coins_b', 0, { vol: .5 }); S.sfx('slash_d', .24, { vol: .8 }); S.sfx('earth_a', .3, { vol: .5 });
        K.circle(S, T.x, T.y, u * .2, 0, .34, { color: C.gold, flat: 1, sides: 4, spin: 2, z: 1, draw: .14 });
        K.slash(S, T.x, T.y, u * .42, -2.4, .5, .22, .34, { kind: 'ink', color: mag, color2: C.night, w: .34, flat: .5, tilt: -.5, props: { add: 0, p0: 4, p1: 3, p2: .6, taper: .5, seg: 34 } });
        K.slash(S, T.x, T.y, u * .4, -2.4, .5, .24, .26, { color: mag, color2: C.night, w: .12, flat: .5, tilt: -.5 });
        S.lens('slice', { x: T.x, y: T.y, ang: -.95, p0: 0, p1: .004, p2: 1, p3: 0, color: [.4, 0, 0], color2: mag }, .3).to({ p0: .016 }, .05, 'out3').wait(.12).to({ p0: 0, p2: 0 }, .12, 'in').end();
        K.impact(S, T.x, T.y, .3, { power: .62, color: mag, ripple: false });
        S.burst({ x: T.x, y: T.y, n: 8, t: .3, cell: 'coin', add: .2, color: C.gold, color2: C.amber, angle: -PI / 2, spread: 2, speed: [u * .3, u * .8], life: [.5, .8], size: [u * .018, u * .03], grow: 1, grav: u * 2.6, spin: 14 });
        knock(S, .3, .55);
    });

    def(skill('수업끝'), { impact: .6, cast: .98, images: [skill('수업끝')], sounds: ['bell_a', 'bell_b', 'slash_a', 'metal_b'] }, S => {
        // 종이 두 번 울린다. 첫 울림은 공기를 흔들고, 두 번째 울림은 대상까지 밀려가 몸을 떨게 한다.
        const u = S.U, A = S.A, T = S.T, bx = (A.x + T.x) / 2, by = Math.min(A.y, T.y) - u * .42, blue = [.4, .62, 1], brass = [1, .86, .5];
        S.sfx('bell_a', .12, { vol: .8 }); S.sfx('bell_b', .42, { vol: .9 }); S.sfx('slash_a', .54, { vol: .5 }); S.sfx('metal_b', .6, { vol: .6 });
        const bell = S.part('bell', { x: bx, y: by - u * .2, size: u * .62, alpha: 0, glow: .5, edge: brass, z: 3 }, 0);
        bell.to({ alpha: 1, y: by }, .1, 'back').tick((p, t) => { p.rot = Math.sin(Math.max(0, t - .08) * 21) * .5 * clamp(1.2 - t); }).wait(.62).to({ alpha: 0, y: by - u * .1 }, .2).end();
        [[.12, .5], [.42, 1]].forEach(([t, k]) => {
            K.ring(S, bx, by + u * .1, u * (.3 + k * .3), brass, t, { th: .05, dur: .4 });
            K.ripple(S, bx, by + u * .1, t, { amp: .008 + k * .012, reach: .3 + k * .35, dur: .4 + k * .1, width: .03 });
            for (let i = 1; i < 3; i++) K.ring(S, bx, by + u * .1, u * (.3 + k * .3) * (1 - i * .28), brass, t + i * .05, { th: .08, dur: .4, dust: .3 });
            K.sparks(S, bx, by + u * .16, 6, brass, t, { speed: .5 });
        });
        K.slash(S, T.x, T.y, u * .34, 2.5, -.4, .52, .3, { color: blue, color2: C.deep, tilt: .3 });
        K.impact(S, T.x, T.y, .6, { power: .7, color: blue, ripple: false });
        quake(S, 't', .6, .34, u * .014, .5);
    });

    def(skill('시벌론'), { impact: 0, cast: .6, sounds: ['slash_b', 'wind_b', 'growl'] }, S => {
        // 붉은 손톱자국이 몸 둘레를 세 번 할퀴며 돌고, 발밑이 갈라지며 살기가 끓어오른다.
        const u = S.U, A = S.A, g = S.gA, red = [1, .16, .16];
        S.sfx('slash_b', .04, { vol: .7 }); S.hit('wind_b', .3, { vol: .5 }); S.hit('growl', .4, { vol: .7 });
        for (let i = 0; i < 3; i++) {
            const a0 = -2.6 + i * 2.1;
            K.slash(S, A.x, A.y - u * .02, u * (.26 + i * .03), a0, a0 + 4.2, .04 + i * .09, .34, { color: red, color2: C.wine, flat: .42 + i * .1, tilt: (i - 1) * .5, w: .42 });
            S.sfx('slash_b', .04 + i * .09, { vol: .45, rate: 1.1 + i * .12, cool: 0 });
        }
        K.crack(S, A.x, g, u * .3, .3, .4, { color: red, color2: C.wine });
        K.aura(S, A.x, g, u * .36, u * .7, .26, .7, { color: red, color2: C.wine, speed: 4, fine: .9 });
        quake(S, 'a', .26, .34, u * .01, .6);
        K.ring(S, A.x, A.y, u * .4, red, .38, { dur: .34 });
        K.embers(S, A.x, A.y, 24, red, .3, { radius: u * .16, rise: .7, speed: .5, over: .25 });
        if (!S.minor) S.shake(7, .3, .36);
    });

    def(skill('아이돌 할래?'), { impact: .46, cast: .85, sounds: ['holy_a', 'slash_a', 'firework', 'tick'] }, S => {
        // 플래시가 사방에서 터지고 두 줄기 조명이 대상을 잡는다. 그 한가운데를 반짝이는 한 획이 긋고 지나간다.
        const u = S.U, T = S.T, cyan = [.35, .95, 1];
        S.hit('holy_a', .2, { vol: .5 }); S.sfx('slash_a', .4, { vol: .7 }); S.sfx('firework', .46, { vol: .6, rate: 1.3 });
        for (let i = 0; i < 6; i++) {
            const a = S.rnd(i) * TAU, r = u * (.26 + S.rnd(i + 9) * .22), t = .02 + i * .055;
            K.flare(S, T.x + Math.cos(a) * r, T.y - u * .1 + Math.sin(a) * r * .7, u * .09, C.white, t, .16, S.rnd(i + 4));
            S.sfx('tick', t, { vol: .35, rate: 1.6 + S.rnd(i) * .5, cool: 0 });
        }
        [[-1, cyan], [1, C.pink]].forEach(([side, tone]) => {
            S.sprite({ x: T.x + side * u * .3, y: T.y - u * .95, size: u * 1.3, pivot: [.5, 0], rot: -side * .9, tint: tone, alpha: 0, add: 1, z: 0 }, .06, 'paint:spot-cone').to({ alpha: .7, rot: -side * .27 }, .22, 'out3').wait(.24).to({ alpha: 0 }, .2).end();
        });
        K.slash(S, T.x, T.y, u * .46, 2.6, -.6, .38, .34, { color: cyan, color2: C.deep, tilt: -.25, flat: .45 });
        S.burst({ x: T.x, y: T.y, n: 26, t: .44, cell: 'star', color: C.white, color2: cyan, radius: u * .24, speed: [u * .05, u * .5], life: [.3, .8], size: [u * .03, u * .08], grow: .1, over: .25 });
        S.burst({ x: T.x, y: T.y, n: 12, t: .46, cell: 'petal', color: C.pink, color2: C.rose, speed: [u * .3, u * .9], life: [.6, 1], size: [u * .025, u * .045], grow: .6, grav: u * .8, drag: 1.6, spin: 8, add: .4 });
        K.impact(S, T.x, T.y, .46, { power: .62, color: cyan });
        knock(S, .46, .5);
    });

    def(skill('유서새김'), { impact: .5, cast: .9, sounds: ['slash_b', 'plank', 'squish'] }, S => {
        // 붉은 먹이 대상의 몸 위에 세 획을 긋고, 그 곁에 인장이 내리찍힌다. 새겨진 글은 타들어 가며 남는다.
        const u = S.U, T = S.T, ink = [.95, .1, .12], x = T.x, y = T.y - u * .04;
        const strokes = [path.bow(x - u * .17, y - u * .13, x + u * .17, y - u * .16, u * .02), path.bow(x, y - u * .22, x - u * .02, y + u * .2, 0, u * .03), path.bow(x - u * .15, y + u * .02, x + u * .19, y + u * .19, -u * .08)];
        strokes.forEach((line, i) => {
            const t = .05 + i * .11;
            S.trail('ink', { path: line, head: 0, tail: 0, width: u * .07, taper: .5, color: ink, color2: C.wine, p0: 5, p1: 1, p2: .25, add: 0, z: 2 }, t).to({ head: 1 }, .09, 'out3').wait(.75 - t).to({ alpha: 0 }, .25).end();
            S.trail('energy', { path: line, head: 0, tail: 0, width: u * .03, color: [1, .5, .4], color2: ink, p2: .3, z: 3 }, t).to({ head: 1 }, .09, 'out3').to({ tail: 1 }, .14, 'in').end();
            S.sfx('slash_b', t, { vol: .5, rate: .9 + i * .14, cool: 0 });
            S.burst({ x: line(1)[0], y: line(1)[1], n: 5, t: t + .08, cell: 'drop', add: 0, color: ink, color2: C.wine, speed: [u * .1, u * .5], life: [.3, .5], size: [u * .012, u * .024], grav: u * 2, stretch: .4 });
        });
        const sx = x + u * .12, sy = y + u * .14;
        S.field('seal', { x: sx, y: sy - u * .1, w: u * .5, h: u * .5, rot: -.5, color: ink, color2: C.wine, p0: 1, add: 0, alpha: 0, z: 3 }, .42).to({ w: u * .2, h: u * .2, y: sy, rot: -.12, alpha: 1 }, .08, 'in3').wait(.4).to({ p0: 0, alpha: 0 }, .35, 'in').end();
        S.sfx('plank', .5, { vol: .8 }); S.sfx('squish', .52, { vol: .4 });
        K.ring(S, sx, sy, u * .2, ink, .5, { th: .08, dur: .3 }); K.sparks(S, sx, sy, 10, ink, .5, { speed: .5 });
        if (!S.minor) { S.shake(6, .16, .5); S.stop(40, .5); }
        S.pose('t', { flash: .5 }, .5).to({ flash: 0 }, .2).end();
        K.embers(S, x, y, 20, ink, .55, { radius: u * .16, rise: .3, speed: .2, over: .4 });
    });

    def(skill('자인'), { impact: .5, cast: .92, sounds: ['air_whoosh', 'ice_a', 'punch_b', 'swish_c'] }, S => {
        // 창끝에 빛이 맺히고, 다음 순간 시전자는 이미 대상의 등 뒤에 서 있다. 한 박자 늦게 벤 자리가 열린다.
        const u = S.U, A = S.A, T = S.T, far = T.x + u * .3, blue = [.5, .82, 1];
        S.sfx('air_whoosh', .08, { vol: .5, rate: 1.4 }); S.sfx('swish_c', .22, { vol: .7 }); S.hit('ice_a', .5, { vol: .8 }); S.sfx('punch_b', .5, { vol: .7 });
        S.pose('a', {}, 0).to({ dx: -u * .04, sy: .95, rot: -.06 }, .18, 'out').to({ alpha: 0, dx: far - A.x, sx: 1.4 }, .05, 'in').set({ sx: 1, rot: 0, sy: 1 }).wait(.08).to({ alpha: 1 }, .04).wait(.32).to({ alpha: 0 }, .05).set({ dx: 0 }).to({ alpha: 1 }, .1).end();
        K.flare(S, A.x + u * .1, A.y - u * .02, u * .1, blue, .1, .14);
        S.burst({ x: A.x + u * .1, y: A.y, n: 14, t: .04, cell: 'spark', ring: u * .18, radial: -1, speed: [u * .8, u * 1.2], life: [.12, .18], size: [u * .015, u * .03], color: C.white, color2: blue, stretch: 1, over: .12 });
        K.beam(S, A.x, A.y, far + u * .1, T.y, u * .13, .22, .22, { color: blue, color2: C.deep, thick: .55, shoot: .05, fall: .16 });
        S.shape('streak', { x: (A.x + far) / 2, y: (A.y + T.y) / 2, w: (far - A.x) * 1.5, h: u * .008, rot: Math.atan2(T.y - A.y, far - A.x), color: C.white, alpha: 0, p0: .2, z: 4 }, .24).to({ alpha: 1 }, .02).wait(.2).to({ alpha: 0, h: u * .002 }, .1).end();
        K.dust(S, far, S.gT, 6, sand, .28, { flat: .3, angle: 0, spread: 1, speed: .4 });
        // 늦게 열리는 상처
        S.lens('slice', { x: T.x, y: T.y, ang: Math.atan2(T.y - A.y, far - A.x), p0: 0, p1: .003, p2: 1, p3: 0, color: [.45, 0, 0], color2: blue }, .48).to({ p0: .014 }, .04, 'out3').wait(.1).to({ p0: 0, p2: 0 }, .12).end();
        K.slash(S, T.x, T.y, u * .4, 2.9, .2, .47, .28, { color: blue, color2: C.deep, flat: .3 });
        K.impact(S, T.x, T.y, .5, { power: .78, color: blue, ripple: false });
        K.shards(S, T.x, T.y, 12, blue, .5, { add: .5, speed: 1, spread: TAU });
        knock(S, .5, .6);
    });

    def(skill('청정수 투척'), { impact: .56, cast: .95, sounds: ['swish_b', 'glass_a', 'splash_big', 'water_a'] }, S => {
        // 맑은 물 한 덩이가 출렁이며 포물선을 그리고, 대상의 머리 위에서 터져 왕관 모양으로 솟는다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, arc = path.bow(A.x + u * .08, A.y - u * .12, T.x, T.y - u * .1, u * .4), t0 = .12, T1 = .44;
        S.sfx('swish_b', .1, { vol: .7 }); S.sfx('glass_a', .56, { vol: .5 }); S.hit('splash_big', .56, { vol: .9 }); S.hit('water_a', .56, { vol: .4 });
        S.pose('a', {}, 0).to({ rot: -.12, dx: -u * .02 }, .1, 'out').to({ rot: .12, dx: u * .03 }, .06, 'in3').to({ rot: 0, dx: 0 }, .25, 'io').end();
        K.orb(S, A.x, A.y, u * .07, t0, { color: C.ice, color2: C.deep, spin: 4, rough: .25 }).tick((p, t) => { const a = arc(clamp(t / T1)); p.x = a[0]; p.y = a[1]; const wob = 1 + Math.sin(t * 40) * .12; p.w = u * .28 * wob; p.h = u * .28 / wob; }).wait(T1).to({ alpha: 0 }, .03).end();
        K.stroke(S, 'water', arc, t0, T1 + .1, { color: C.ice, color2: C.deep, width: u * .09, lead: .82, lag: .2, ease: 'lin' });
        S.burst({ x: 0, y: 0, n: 14, t: t0, cell: 'drop', add: .6, color: C.white, color2: C.ice, speed: [0, u * .15], life: [.3, .5], size: [u * .012, u * .022], grav: u * 1.6, over: T1, even: true, each: (P, i, k) => { const a = arc(k); P.x = a[0]; P.y = a[1]; } });
        K.fire(S, T.x, g, u * .5, u * .8, .56, .42, { color: C.ice, color2: C.deep, speed: 3.4, rise: .1, fall: .26 });
        K.drops(S, T.x, T.y, 34, C.ice, .56, { speed: 1.3 });
        K.ring(S, T.x, g, u * .5, C.ice, .56, { flat: .28, dur: .5 });
        K.impact(S, T.x, T.y - u * .08, .56, { power: .72, color: C.ice });
        S.burst({ x: T.x, y: T.y, n: 10, t: .6, cell: 'ring', color: C.white, color2: C.ice, radius: u * .2, speed: [0, u * .1], life: [.4, .8], size: [u * .02, u * .05], grow: 1.6, grav: -u * .2, over: .3 });
        knock(S, .56, .55);
    });

    def(skill('카르마'), { impact: .6, cast: 1.05, sounds: ['metal_ring', 'swish_a', 'punch_b', 'glass_b'] }, S => {
        // 붉은 빛과 흰 빛이 손 위에서 서로를 쫓아 돌다 하나로 엮여 날아간다. 대상 위에서 태극이 돌고, 반으로 갈라진다.
        const u = S.U, A = S.A, T = S.T, cx = A.x + u * .13, cy = A.y - u * .06, red = [1, .22, .2];
        S.sfx('metal_ring', .02, { vol: .5 }); S.sfx('swish_a', .3, { vol: .7 }); S.sfx('punch_b', .6, { vol: .8 }); S.sfx('glass_b', .8, { vol: .7 });
        chant(S, 0, .34);
        [[red, 0], [C.white, PI]].forEach(([tone, phase]) => {
            K.orb(S, cx, cy, u * .035, 0, { color: tone, color2: dark(tone, .5), spin: 5 }).tick((p, t) => { const k = clamp(t / .3), a = phase + t * (10 + k * 34), r = u * .09 * (1 - k * .85); p.x = cx + Math.cos(a) * r; p.y = cy + Math.sin(a) * r * .6; }).wait(.3).to({ alpha: 0 }, .02).end();
            S.trail('energy', { head: 1, tail: 0, width: u * .03, seg: 14, color: tone, color2: dark(tone), p2: .8, path: (s, t) => { const tt = Math.max(0, t - (1 - s) * .07), k = clamp(tt / .3), a = phase + tt * (10 + k * 34), r = u * .09 * (1 - k * .85); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r * .6]; } }, 0).wait(.3).to({ alpha: 0 }, .03).end();
        });
        K.flare(S, cx, cy, u * .14, C.white, .3, .2);
        const len = Math.hypot(T.x - cx, T.y - cy), nx = -(T.y - cy) / len, ny = (T.x - cx) / len;
        [[red, 0], [C.white, PI]].forEach(([tone, phase]) => K.stroke(S, 'energy', s => { const w = Math.sin(s * TAU * 2 + phase) * u * .07 * Math.sin(s * PI); return [lerp(cx, T.x, s) + nx * w, lerp(cy, T.y, s) + ny * w]; }, .3, .4, { color: tone, color2: dark(tone, .5), width: u * .08, lead: .75, lag: .32, ease: 'in', props: { seg: 44 } }));
        const taiji = S.field('taiji', { x: T.x, y: T.y, w: u * .5, h: u * .5, color: C.bone, color2: [.5, .02, .04], p0: .05, p1: 14, add: 0, z: 2 }, .58);
        taiji.to({ p0: 1 }, .1, 'back').wait(.12).to({ alpha: 0, w: u * .7, h: u * .7 }, .12).end();
        K.impact(S, T.x, T.y, .6, { power: .82, color: red });
        knock(S, .6, .7);
        S.lens('slice', { x: T.x, y: T.y, ang: PI / 2 + .25, p0: 0, p1: .004, p2: 1, p3: 0, color: [.4, 0, 0] }, .8).to({ p0: .02 }, .05, 'out3').wait(.08).to({ p0: 0, p2: 0 }, .12).end();
        K.sparks(S, T.x, T.y, 14, C.white, .8, { angle: -PI / 2, spread: .8, speed: 1 }); K.sparks(S, T.x, T.y, 14, red, .8, { angle: PI / 2, spread: .8, speed: 1 });
    });

    def(skill('카운터'), { impact: 0, cast: .4, sounds: ['metal_b', 'ice_a'] }, S => {
        // 몸을 틀어 받아낼 자세를 잡는다. 날이 한 번 번뜩이며 몸 앞에 초승달 같은 막이 선다.
        const u = S.U, A = S.A, blue = [.55, .8, 1];
        S.sfx('metal_b', .08, { vol: .7 }); S.hit('ice_a', .12, { vol: .4 });
        S.pose('a', {}, 0).to({ dx: -u * .03, rot: -.1, sy: .96 }, .1, 'out').wait(.2).to({ dx: 0, rot: 0, sy: 1 }, .2, 'io').end();
        K.slash(S, A.x + u * .02, A.y, u * .26, -1.5, 1.5, .05, .4, { color: blue, color2: C.deep, flat: 1, w: .36, lead: .3, lag: .6, trail: .4 });
        S.shape('hex', { x: A.x + u * .14, y: A.y, w: u * .12, h: u * .46, color: blue, alpha: 0, p0: 4, p1: .08, p2: .04, z: 2 }, .06).to({ w: u * .2, alpha: .75 }, .08, 'out3').wait(.14).to({ alpha: 0 }, .2).end();
        S.shape('streak', { x: A.x + u * .16, y: A.y - u * .04, w: 0, h: u * .012, rot: -.5, color: C.white, p0: .3, z: 4 }, .08).to({ w: u * .6 }, .05, 'out3').to({ alpha: 0 }, .12).end();
        K.flare(S, A.x + u * .2, A.y - u * .08, u * .1, C.white, .08, .2, .4);
        K.sparks(S, A.x + u * .2, A.y - u * .06, 10, blue, .09, { angle: -.6, spread: 1.4, speed: .7 });
        K.ring(S, A.x + u * .1, A.y, u * .26, blue, .1, { th: .06, dur: .28 });
    });

    def(skill('피아스트'), { impact: .56, cast: .95, sounds: ['field', 'laser_rifle', 'ice_b', 'splash'] }, S => {
        // 물의 구가 몸을 감싸 일렁이고, 그 표면에서 한 줄기가 뽑혀 나가 대상을 꿰뚫는다.
        const u = S.U, A = S.A, T = S.T, blue = [.4, .78, 1], x0 = A.x + u * .16, y0 = A.y - u * .03;
        S.hit('field', .04, { vol: .6 }); S.hit('laser_rifle', .38, { vol: .5 }); S.hit('ice_b', .56, { vol: .6 }); S.sfx('splash', .56, { vol: .7 });
        K.orb(S, A.x, A.y, u * .3, 0, { color: blue, color2: C.deep, p0: .05, spin: 1.2, rough: .04 }).set({ alpha: .5 }).to({ p0: .5 }, .2, 'back').wait(.5).to({ alpha: 0, p0: .56 }, .3).end();
        K.ring(S, A.x, A.y, u * .34, blue, .06, { th: .05 });
        S.burst({ x: A.x, y: A.y, n: 14, t: .06, cell: 'ring', color: C.white, color2: blue, radius: u * .24, speed: [0, u * .1], life: [.4, .9], size: [u * .015, u * .04], grow: 1.5, grav: -u * .25, over: .4 });
        chant(S, 0, .5);
        K.glow(S, x0, y0, u * .1, C.white, .28, .16);
        K.dart(S, x0, y0, T.x, T.y, .36, .34, { kind: 'water', color: blue, color2: C.deep, width: u * .16, lead: .6, props: { p0: 5, p1: 8 } });
        K.beam(S, x0, y0, T.x, T.y, u * .07, .44, .16, { color: C.white, color2: blue, thick: .5, shoot: .1, fall: .1 });
        K.impact(S, T.x, T.y, .56, { power: .72, color: blue });
        K.drops(S, T.x, T.y, 26, blue, .56, { speed: 1.2, angle: 0, spread: 2.6 });
        K.ring(S, T.x, T.y, u * .3, blue, .58, { th: .06 });
        knock(S, .56, .6);
    });

    def(skill('피의 맛'), { impact: .5, cast: 1.1, sounds: ['growl', 'punch_m', 'squish', 'plant_a'] }, S => {
        // 대상의 위아래로 송곳니가 돋아 한 번에 맞물린다. 흘러나온 붉은 것은 방울방울 주인에게 돌아간다.
        const u = S.U, A = S.A, T = S.T, red = [.95, .1, .14], top = T.y - u * .52, bottom = T.y + u * .46;
        S.hit('growl', .34, { vol: .7 }); S.sfx('punch_m', .5, { vol: .9 }); S.sfx('squish', .5, { vol: .7 }); S.hit('plant_a', 1.02, { vol: .4 });
        S.dim(.4, .1, .5, T);
        const fangs = [];
        for (let i = 0; i < 5; i++) {
            const dx = (i - 2) * u * .1, h = u * (.5 - Math.abs(i - 2) * .09), w = u * .14;
            fangs.push(S.field('crystal', { x: T.x + dx, y: bottom - h / 2, w, h, color: [1, .82, .8], color2: red, p0: 0, p1: .6, p2: 0, p3: .3, add: .2, seed: i, z: 2 }, .3));
            fangs.push(S.field('crystal', { x: T.x + dx + u * .05, y: top + h / 2, w, h, rot: PI, color: [1, .82, .8], color2: red, p0: 0, p1: .6, p2: 0, p3: .3, add: .2, seed: i + 7, z: 2 }, .3));
        }
        fangs.forEach(f => f.to({ p0: .3 }, .14, 'out').to({ p0: 1 }, .06, 'in3').wait(.2).to({ p0: 0, alpha: 0 }, .2, 'in').end());
        K.impact(S, T.x, T.y, .5, { power: .85, color: red });
        S.flash(red, .25, .2, .5);
        K.drops(S, T.x, T.y, 30, red, .5, { speed: 1.1, spread: TAU, more: { add: 0, color: red, color2: C.wine } });
        knock(S, .5, .7);
        S.burst({ x: T.x, y: T.y, n: 26, t: .56, cell: 'dot', color: [1, .4, .4], color2: red, radius: u * .1, life: [.4, .55], size: [u * .02, u * .04], grow: .5, turb: u * .1, over: .2, each: homing(A.x, A.y - u * .04) });
        K.glow(S, A.x, A.y - u * .04, u * .16, red, 1.02, .34, .7);
        K.ring(S, A.x, A.y, u * .22, [1, .4, .4], 1.04, { th: .06 });
        S.pose('a', {}, 1.02).to({ flash: .5, sy: 1.04 }, .06).to({ flash: 0, sy: 1 }, .2).end();
    });

    def(skill('헤즈업'), { impact: .74, cast: .95, images: ['paint:card-back', 'paint:card-face'], sounds: ['card_fan', 'card_a', 'card_snap', 'shimmer', 'slash_c'] }, S => {
        // 세 장이 손 위로 펼쳐져 서로 자리를 바꾸고, 가운데 한 장이 뒤집힌다. 뽑힌 패는 빛으로 풀려 몸에 스민다.
        const u = S.U, A = S.A, T = S.T, cx = A.x + u * .02, cy = A.y - u * .34, size = u * .5, blue = [.45, .8, 1], strikes = S.event.damage > 0;
        S.hit('card_fan', .1, { vol: .7 }); S.sfx('card_a', .3, { vol: .6 }); S.sfx('card_snap', .52, { vol: .8 }); S.hit('shimmer', .7, { vol: .5 });
        chant(S, 0, .6, { lift: .01 });
        const slots = [-1, 0, 1].map(k => [cx + k * u * .15, cy + Math.abs(k) * u * .03, k * .22]);
        const cards = [0, 1, 2].map(i => {
            const card = S.sprite({ x: A.x, y: A.y, size, sx: .2, sy: .2, alpha: 0, rot: 0, z: 2 + i * .01 }, i * .03, 'paint:card-back');
            card.to({ x: slots[i][0], y: slots[i][1], rot: slots[i][2], sx: .5, sy: .5, alpha: 1 }, .16, 'back');
            return card;
        });
        // 섞기: 양 끝이 가운데를 넘어 자리를 바꾼다.
        cards[0].at(.3).to({ x: slots[2][0], rot: slots[2][2] }, .16, 'io'); cards[2].at(.3).to({ x: slots[0][0], rot: slots[0][2] }, .16, 'io');
        cards[1].at(.3).to({ y: cy - u * .06 }, .08, 'out').to({ y: cy }, .08, 'in');
        // 가운데 패가 뒤집힌다.
        cards[1].at(.5).to({ sx: .02, rot: 0 }, .07, 'in').to({ alpha: 0 }, .01).end();
        const face = S.sprite({ x: cx, y: cy, size, sx: .02, sy: .5, alpha: 0, glow: .7, edge: blue, z: 3 }, .57, 'paint:card-face');
        face.to({ alpha: 1 }, .01).to({ sx: .62, sy: .62, y: cy - u * .05 }, .08, 'back');
        K.flare(S, cx, cy - u * .05, u * .16, blue, .6, .26);
        [cards[0], cards[2]].forEach(card => card.at(.6).to({ alpha: 0, y: cy + u * .08 }, .16).end());
        if (strikes) {
            // 균형의 패: 그대로 날아가 벤다.
            face.wait(.04).to({ x: T.x, y: T.y, rot: TAU * 1.5, sx: .4, sy: .4 }, .09, 'in3').to({ alpha: 0 }, .04).end();
            K.dart(S, cx, cy, T.x, T.y, .65, .2, { color: blue, color2: C.deep, width: u * .06 });
            S.sfx('slash_c', .74, { vol: .8 });
            K.slash(S, T.x, T.y, u * .36, -2.6, .4, .72, .26, { color: blue, color2: C.deep });
            K.impact(S, T.x, T.y, .74, { power: .7, color: blue });
            knock(S, .74, .6);
        } else {
            face.wait(.1).to({ dis: 1, y: cy + u * .1, sx: .7, sy: .7 }, .3, 'in').end();
            S.burst({ x: cx, y: cy, n: 24, t: .76, cell: 'star', color: C.white, color2: blue, radius: u * .08, life: [.3, .5], size: [u * .02, u * .05], grow: .2, over: .2, each: homing(A.x, A.y) });
            K.aura(S, A.x, S.gA, u * .3, u * .6, .82, .5, { color: blue });
            S.pose('a', {}, .9).to({ flash: .5 }, .06).to({ flash: 0 }, .24).end();
        }
    });

    // ================= 궁극기 =================
    // 컷씬이 접힌 뒤에 시작한다. 무대를 어둡게 누르고, 쌓아 올린 뒤 한 번에 터뜨린다.
    def(skill('끝판왕'), { impact: 1.15, cast: 1.95, images: [skill('끝판왕')], sounds: ['gong', 'air_long', 'boom_low', 'boom_a', 'fire_big'] }, S => {
        // 왕관이 맺히고, 대상의 발밑에 낙인이 찍힌다. 하늘에서 겨눈 한 줄기가 거대한 빛의 날이 되어 화면째로 가른다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, red = [1, .3, .12], top = T.y - u * 1.25;
        S.dim(.74, 0, 1.55, T, .2, .4);
        S.sfx('gong', .05, { vol: .8 }); S.sfx('air_long', .5, { vol: .5, rate: 1.4 }); S.hit('boom_low', 1.15, { vol: 1 }); S.sfx('boom_a', 1.15, { vol: .9 }); S.hit('fire_big', 1.22, { vol: .7 });
        K.circle(S, A.x, A.y - u * .04, u * .27, .05, 1, { color: C.gold, flat: 1, sides: 8, spin: .6, z: -1, alpha: .75 });
        chant(S, .05, 1.05, { lift: .03, flash: .25 });
        K.aura(S, A.x, S.gA, u * .42, u * .95, .1, 1.1, { color: red, color2: C.wine, speed: 3 });
        M.gather(S, S.key('crown'), A.x, A.y - u * .44, u * .5, .1, { fx: A.x, fy: A.y, dur: .3, frac: .8 });
        S.part('crown', { x: A.x, y: A.y - u * .44, size: u * .5, alpha: 0, sx: .5, sy: .5, glow: .8, edge: C.gold, z: 3 }, .3).to({ alpha: 1, sx: 1, sy: 1 }, .16, 'back').wait(.42).to({ y: A.y - u * .64, alpha: 0, sx: 1.3, sy: 1.3 }, .22, 'in').end();
        K.circle(S, T.x, g, u * .46, .3, 1.05, { color: red, color2: C.wine, sides: 4, spin: -1.6, bold: .01 });
        K.rays(S, T.x, top + u * .2, u * 1, .45, .9, { color: C.gold, color2: red, n: 6, spin: .2, alpha: .7 });
        S.shape('streak', { x: T.x, y: (top + g) / 2, w: g - top, h: u * .006, rot: PI / 2, color: C.gold, alpha: 0, p0: .2, z: 4 }, .6).to({ alpha: .9 }, .1).tick((p, t) => { p.alpha = .5 + .5 * Math.sin(t * 50); }).wait(.4).to({ h: u * .03, alpha: 1 }, .05).end();
        S.burst({ x: T.x, y: top, n: 40, t: .6, cell: 'spark', line: [0, g - top], color: C.gold, color2: red, angle: PI / 2, spread: .1, speed: [u * 1.5, u * 3], life: [.15, .3], size: [u * .012, u * .03], stretch: 1.5, over: .5, radius: u * .03 });
        K.beam(S, T.x, top - u * .2, T.x, g + u * .06, u * .62, 1.09, .55, { color: C.gold, color2: red, thick: .95, shoot: .06, fall: .32 });
        S.lens('slice', { x: T.x, y: T.y, ang: PI / 2, p0: 0, p1: .006, p2: 1, p3: 0 }, 1.15).to({ p0: .035 }, .06, 'out3').wait(.16).to({ p0: 0, p2: 0 }, .22, 'io').end();
        S.flash(C.white, .51, .34, 1.15);
        K.impact(S, T.x, T.y, 1.15, { power: 1, color: red, zoom: .07 });
        K.crack(S, T.x, g, u * .66, 1.15, .6, { color: [1, .5, .2], n: 11 });
        [-2, -1, 1, 2].forEach(k => K.fire(S, T.x + k * u * .21, g, u * .28, u * (.78 - Math.abs(k) * .14), 1.2 + Math.abs(k) * .07, .62, { color: [1, .62, .2], color2: red }));
        K.shards(S, T.x, g, 26, rock, 1.15, { speed: 1.5 });
        K.embers(S, T.x, T.y, 54, C.gold, 1.2, { radius: u * .34, rise: .7, over: .5, speed: .7 });
        knock(S, 1.15, 1, { lift: .02 });
        if (!S.minor) S.shake(26, .6, 1.15);
    });

    def(skill('빅뱅'), { impact: 1.3, cast: 2.15, sounds: ['air_long', 'warp', 'boom_low', 'boom_a', 'bolt_a'] }, S => {
        // 허공에 검은 점이 열려 빛과 풍경을 삼킨다. 한 점으로 꺼진 뒤, 한 박자의 어둠. 그리고 처음의 빛이 터진다.
        const u = S.U, A = S.A, T = S.T, cx = (A.x + T.x) / 2 + u * .12, cy = Math.min(A.y, T.y) - u * .2, lilac = [.72, .62, 1], tones = [C.volt, C.pink, C.gold];
        S.dim(.82, 0, 1.75, { x: cx, y: cy }, .25, .45);
        S.sfx('air_long', .05, { vol: .6, rate: .8 }); S.hit('warp', 1.2, { vol: .6 }); S.hit('boom_low', 1.3, { vol: 1 }); S.sfx('boom_a', 1.3, { vol: 1 }); S.hit('bolt_a', 1.34, { vol: .6 });
        chant(S, 0, 1.2, { lift: .02 });
        K.orb(S, cx, cy, u * .3, .1, { shader: 'hole', color: lilac, color2: [1, .35, .75], p0: .02, spin: .9, add: 0 }).to({ p0: .44 }, .72, 'out').to({ p0: .02 }, .2, 'in3').to({ alpha: 0 }, .04).end();
        S.lens('pinch', { x: cx, y: cy, p0: 0, p1: .28, p2: 0, live: true }, .15).to({ p0: 1.1, p2: 2.4 }, .75, 'in').to({ p0: 2.4, p1: .5 }, .2, 'in3').to({ p0: -.7, p2: 0 }, .06).to({ p0: 0 }, .34, 'out').end();
        S.burst({ x: cx, y: cy, n: 90, t: .15, cell: 'spark', ring: u * 1, radial: -1, speed: [u * 1, u * 1.7], life: [.5, .75], size: [u * .015, u * .045], color: C.white, color2: lilac, stretch: 1.4, over: .85 });
        S.burst({ x: cx, y: cy, n: 40, t: .2, cell: 'star', ring: u * .8, radial: -1, speed: [u * .7, u * 1.1], life: [.6, .9], size: [u * .02, u * .05], color: C.gold, color2: C.pink, over: .8 });
        S.pose('t', {}, .4).to({ dx: -u * .06, dy: -u * .03, rot: -.05 }, .7, 'in').to({ dx: 0, dy: 0, rot: 0 }, .12).end();
        S.pose('a', {}, .4).to({ dx: u * .04 }, .7, 'in').to({ dx: 0 }, .12).end();
        K.flare(S, cx, cy, u * .12, C.white, 1.18, .12);
        S.flash(C.white, .57, .5, 1.3);
        K.ripple(S, cx, cy, 1.3, { amp: .04, reach: 1, dur: .7, width: .07 });
        K.impact(S, cx, cy, 1.3, { power: 1, color: lilac, zoom: .08, ripple: false });
        tones.forEach((tone, i) => K.ring(S, cx, cy, u * (.6 + i * .28), tone, 1.3 + i * .07, { dur: .62, th: .16 }));
        K.rays(S, cx, cy, u * 1.4, 1.3, .75, { color: C.white, color2: lilac, n: 9, sharp: .7 });
        S.burst({ x: cx, y: cy, n: 120, t: 1.3, cell: 'star', speed: [u * .3, u * 2.3], life: [.6, 1.35], size: [u * .015, u * .055], drag: 1.7, color: C.white, color2: C.violet, spin: 4 });
        tones.forEach((tone, i) => S.burst({ x: cx, y: cy, n: 26, t: 1.31, cell: 'dot', speed: [u * .4, u * 1.9], life: [.7, 1.4], size: [u * .02, u * .05], drag: 1.5, color: lite(tone), color2: tone, seed: i, turb: u * .04 }));
        K.impact(S, T.x, T.y, 1.34, { power: .8, color: C.pink, ripple: false, flash: false });
        knock(S, 1.3, 1);
        if (!S.minor) S.shake(30, .7, 1.3);
    });

    def(skill('유드 알레프'), { impact: 1.2, cast: 1.95, sounds: ['holy_big', 'metal_ring', 'holy_c', 'earth_a', 'shimmer'] }, S => {
        // 대상의 머리 위로 열 개의 빛이 생명의 나무를 그리며 차례로 켜진다. 빛이 나무를 타고 내려와 맨 아래에 닿는 순간, 하늘의 검이 그 길을 따라 꽂힌다.
        const u = S.U, T = S.T, g = S.gT, h = u * .5, base = T.y + u * .02, tree = [[0, 0], [.5, .12], [-.5, .12], [.5, .36], [-.5, .36], [0, .5], [.5, .68], [-.5, .68], [0, .82], [0, 1]];
        const at = i => [T.x + tree[i][0] * u * .34, base - h + tree[i][1] * h];
        S.dim(.7, 0, 1.55, T, .2, .4);
        S.hit('holy_big', .5, { vol: .7 }); S.sfx('metal_ring', .98, { vol: .6 }); S.hit('holy_c', 1.2, { vol: .9 }); S.sfx('earth_a', 1.2, { vol: .7 });
        chant(S, 0, 1.1, { lift: .03, flash: .2 });
        K.circle(S, T.x, g, u * .44, .05, 1.3, { color: C.gold, sides: 10, spin: .5 });
        tree.forEach((_, i) => {
            const p = at(i), t = .12 + i * .06;
            K.flare(S, p[0], p[1], u * .07, C.holy, t, .3, i);
            S.shape('glow', { x: p[0], y: p[1], w: u * .02, h: u * .02, color: C.holy, p0: 1.4, z: 3 }, t).to({ w: u * .11, h: u * .11 }, .1, 'back').at(1.2).to({ alpha: 0, w: u * .3, h: u * .3 }, .2).end();
            S.sfx('shimmer', t, { vol: .22, rate: .8 + i * .07, cool: 0 });
        });
        [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4], [1, 5], [2, 5], [3, 5], [4, 5], [3, 6], [4, 7], [5, 6], [5, 7], [6, 7], [6, 8], [7, 8], [5, 8], [8, 9]].forEach(([a, b]) => {
            const p = at(a), q = at(b);
            S.trail('energy', { path: path.line(p[0], p[1], q[0], q[1]), head: 0, tail: 0, width: u * .014, taper: .05, color: C.holy, color2: C.sun, p2: .05, z: 2 }, .16 + b * .06).to({ head: 1 }, .08, 'out').at(1.2).to({ alpha: 0 }, .12).end();
        });
        // 빛이 가운데 기둥을 타고 내려온다.
        [0, 5, 8, 9].reduce((a, b, i) => { const p = at(a), q = at(b); K.bolt(S, p[0], p[1], q[0], q[1], C.holy, .84 + i * .09, { flashes: 1, twigs: 1, width: u * .05, hold: .09 }); return b; });
        K.beam(S, T.x, T.y - u * 1.6, T.x, g + u * .04, u * .34, 1.14, .5, { color: C.holy, color2: C.sun, thick: .7, shoot: .07, fall: .3 });
        S.flash(C.holy, .36, .3, 1.2);
        K.impact(S, T.x, T.y, 1.2, { power: 1, color: C.holy, zoom: .06 });
        [.34, .56].forEach((r, i) => K.ring(S, T.x, g, u * r, C.gold, 1.2 + i * .08, { flat: .3, dur: .55 }));
        K.rays(S, T.x, T.y - u * .2, u * 1, 1.2, .6, { color: C.holy, color2: C.sun, n: 8 });
        S.burst({ x: T.x, y: T.y - u * .5, n: 22, t: 1.24, cell: 'petal', add: .6, color: C.white, color2: C.gold, radius: u * .3, speed: [u * .03, u * .15], life: [.8, 1.4], size: [u * .03, u * .06], grow: .7, grav: u * .3, turb: u * .14, spin: 4, over: .4 });
        knock(S, 1.2, .9);
    });

    def(skill('안면강타'), { impact: 1.05, cast: 1.75, images: [skill('안면강타')], sounds: ['air_puff', 'punch_c', 'punch_m', 'punch_a', 'boom_b', 'air_whoosh'] }, S => {
        // 한 걸음에 품으로 파고들어 여섯 번을 꽂고, 반 박자 당겼다가 마지막 한 방으로 날려 보낸다.
        const u = S.U, A = S.A, T = S.T, gap = T.x - A.x - u * .24, red = [1, .2, .16], hx = T.x - u * .06, hy = T.y - u * .08;
        S.dim(.55, 0, 1.3, T, .15, .35);
        S.sfx('air_puff', .2, { vol: .6 }); S.sfx('air_whoosh', .92, { vol: .6, rate: 1.6 }); S.sfx('punch_a', 1.05, { vol: 1 }); S.sfx('boom_b', 1.06, { vol: .8 });
        S.pose('a', {}, 0).to({ dx: -u * .04, sy: .93, rot: -.08 }, .22, 'out').to({ dx: gap, sy: 1, rot: .1 }, .08, 'in3')
            .tick((p, t) => { if (t > .32 && t < .88) p.dx = gap + Math.sin(t * 70) * u * .018; })
            .wait(.58).to({ dx: gap - u * .11, rot: -.12 }, .1, 'out').to({ dx: gap + u * .05, rot: .2 }, .06, 'in3').wait(.2).to({ dx: 0, rot: 0 }, .3, 'io').end();
        K.dart(S, A.x, A.y, hx - u * .1, hy, .2, .22, { color: red, color2: C.wine, width: u * .16 });
        K.dust(S, A.x, S.gA, 8, sand, .2, { flat: .3, angle: PI, spread: 1, speed: .5 });
        for (let i = 0; i < 6; i++) {
            const t = .36 + i * .086, x = hx + (S.rnd(i) - .4) * u * .16, y = hy + (S.rnd(i + 5) - .5) * u * .3;
            K.flare(S, x, y, u * .1, C.white, t, .12, S.rnd(i + 9) * 3);
            K.ring(S, x, y, u * .13, red, t, { th: .14, dur: .2 });
            K.sparks(S, x, y, 7, red, t, { angle: 0, spread: 2, speed: .9 });
            S.shape('streak', { x: x - u * .1, y, w: u * .26, h: u * .03, color: i % 2 ? red : C.white, p0: .6, z: 3 }, t - .03).to({ x, w: u * .1, alpha: 0 }, .07, 'in').end();
            S.sfx(i % 2 ? 'punch_m' : 'punch_c', t, { vol: .55, rate: 1.05 + i * .05, cool: 0 });
        }
        quake(S, 't', .36, .54, u * .012, .5);
        if (!S.minor) S.shake(5, .5, .36);
        K.glow(S, hx - u * .14, hy, u * .12, red, .92, .14);
        S.lens('zoom', { x: hx, y: hy, p0: 0, live: true }, 1.03).to({ p0: .08 }, .05, 'out').to({ p0: 0 }, .22, 'out').end();
        S.sprite({ x: hx, y: hy, size: u * .7, pivot: [.8, .5], alpha: 0, glow: .9, edge: red, flash: .9, z: 3 }, 1.02).to({ alpha: .95 }, .03).to({ flash: 0, alpha: 0, sx: 1.3, sy: 1.3 }, .24, 'out').end();
        K.impact(S, hx, hy, 1.05, { power: 1, color: red, zoom: .08 });
        S.field('shock', { x: T.x + u * .1, y: hy, w: u * .12, h: u * .4, color: C.white, color2: red, p0: .6, p1: .14, p2: .9 }, 1.07).to({ x: T.x + u * .5, w: u * .4, h: u * 1.2, p0: .9, alpha: 0 }, .42, 'out3').end();
        S.pose('t', { flash: 1 }, 1.05).to({ dx: u * .22, dy: -u * .05, rot: .3, sx: .94 }, .1, 'out3').to({ flash: 0 }, .1).wait(.1).to({ dx: 0, dy: 0, rot: 0, sx: 1 }, .4, 'io').end();
        K.dust(S, T.x + u * .1, S.gT, 16, sand, 1.08, { flat: .25, angle: 0, spread: .9, speed: .9, over: .2 });
        scatter(S, hx, hy, u * .5, 1.06, { frac: .5 });
        K.shards(S, T.x, S.gT, 12, rock, 1.07, { speed: 1 });
    });

    def(skill('감사합니다 친구야'), { impact: 1.15, cast: 1.9, sounds: ['holy_big', 'field', 'heal_b', 'holy_c'] }, S => {
        // 금빛은 발밑에서, 푸른빛은 하늘에서 온다. 둘이 맞잡는 자리에 방벽이 서고, 한 줄로 엮인 빛이 대상을 꿰뚫는다.
        const u = S.U, A = S.A, T = S.T, cx = A.x + u * .2, cy = A.y - u * .3, blue = [.4, .7, 1];
        S.dim(.6, 0, 1.5, A, .2, .4);
        S.hit('holy_big', .52, { vol: .8 }); S.hit('field', .6, { vol: .7 }); S.hit('heal_b', .85, { vol: .4 }); S.hit('holy_c', 1.15, { vol: .9 });
        chant(S, 0, 1.1, { lift: .02 });
        [[C.gold, [A.x, A.y + u * .1], 1], [blue, [A.x - u * .2, A.y - u * 1], -1]].forEach(([tone, from, side]) => {
            const move = t => { const k = clamp(t / .5), e = 1 - (1 - k) ** 2, a = side * (1 - e) * 5; return [lerp(from[0], cx, e) + Math.cos(a) * u * .16 * (1 - e), lerp(from[1], cy, e) + Math.sin(a) * u * .1 * (1 - e)]; };
            K.orb(S, from[0], from[1], u * .06, .02, { color: tone, color2: dark(tone, .5), spin: 4 }).tick((p, t) => { const q = move(t); p.x = q[0]; p.y = q[1]; }).wait(.5).to({ alpha: 0, w: u * .5, h: u * .5 }, .1).end();
            S.trail('energy', { head: 1, tail: 0, width: u * .06, seg: 18, color: tone, color2: dark(tone, .5), p2: .9, path: (s, t) => move(Math.max(0, t - (1 - s) * .14)) }, .02).wait(.5).to({ alpha: 0 }, .08).end();
        });
        K.flare(S, cx, cy, u * .22, C.white, .52, .3);
        [C.gold, blue].forEach((tone, i) => K.ring(S, cx, cy, u * (.3 + i * .14), tone, .52 + i * .05, { dur: .4 }));
        K.orb(S, cx, cy, u * .09, .54, { color: C.holy, color2: blue, spin: 5, arcs: .6 }).wait(.3).to({ w: u * .1, h: u * .1, alpha: 0 }, .12, 'in').end();
        [[C.gold, .46, .56], [blue, .56, .68]].forEach(([tone, w, h], i) => S.shape('hex', { x: A.x, y: A.y, w: u * .1, h: u * .1, color: tone, alpha: 0, p0: 5 + i, p1: .06, p2: .04, z: 2 }, .58 + i * .06).to({ w: u * w, h: u * h, alpha: .7 }, .18, 'back').wait(.8).to({ alpha: 0, w: u * (w + .1), h: u * (h + .1) }, .3).end());
        const len = Math.hypot(T.x - cx, T.y - cy), nx = -(T.y - cy) / len, ny = (T.x - cx) / len;
        [[C.gold, 0], [blue, PI]].forEach(([tone, phase]) => K.stroke(S, 'energy', s => { const w = Math.sin(s * TAU * 2.5 + phase) * u * .06; return [lerp(cx, T.x, s) + nx * w, lerp(cy, T.y, s) + ny * w]; }, .9, .45, { color: tone, color2: dark(tone, .5), width: u * .1, lead: .56, lag: .5, trail: .5, ease: 'in', props: { seg: 56 } }));
        K.beam(S, cx, cy, T.x, T.y, u * .1, 1.05, .28, { color: C.white, color2: C.gold, thick: .5, shoot: .1 });
        K.impact(S, T.x, T.y, 1.15, { power: .92, color: C.gold, zoom: .05 });
        K.ring(S, T.x, T.y, u * .5, blue, 1.2, { dur: .5 });
        S.burst({ x: T.x, y: T.y, n: 30, t: 1.15, cell: 'star', color: C.white, color2: C.gold, speed: [u * .2, u * 1.2], life: [.4, .9], size: [u * .02, u * .06], drag: 2 });
        knock(S, 1.15, .85);
    });

    def(skill('KICK BACK'), { impact: 1.2, cast: 1.9, sounds: ['wind_a', 'air_whoosh', 'swish_a', 'swish_b', 'punch_a', 'boom_b', 'metal_a'] }, S => {
        // 뛰어올라 허공에서 세 바퀴를 돈다. 톱니 선 날이 돌 때마다 불티가 갈리고, 마지막 뒤꿈치가 위에서 아래로 화면을 찢는다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, gap = T.x - A.x, jx = gap - u * .3, vio = [.62, .5, 1], blue = [.4, .75, 1], sx = T.x - u * .3, sy = T.y - u * .3;
        S.dim(.6, 0, 1.45, T, .15, .4);
        S.hit('wind_a', .2, { vol: .5 }); S.sfx('air_whoosh', 1.02, { vol: .7, rate: 1.5 }); S.sfx('punch_a', 1.2, { vol: 1 }); S.sfx('boom_b', 1.2, { vol: .9 });
        S.pose('a', {}, 0).to({ sy: .88, dx: -u * .02 }, .14, 'out').to({ dx: jx, dy: -u * .3, sy: 1 }, .26, 'out3')
            .tick((p, t) => { p.rot = t > .4 && t < 1.06 ? (t - .4) * TAU * 3 / .66 : 0; })
            .wait(.68).to({ dx: jx + u * .08, dy: -u * .04, rot: 0 }, .12, 'in3').wait(.3).to({ dx: 0, dy: 0 }, .32, 'io').end();
        K.dust(S, A.x, S.gA, 8, sand, .14, { flat: .3, radius: u * .08, speed: .4 });
        K.stroke(S, 'energy', path.bow(A.x, A.y, sx, sy, u * .2), .14, .34, { color: vio, color2: C.night, width: u * .1 });
        for (let i = 0; i < 3; i++) {
            const t = .44 + i * .2, tone = i % 2 ? blue : vio;
            K.slash(S, sx, sy, u * (.32 + i * .04), -PI * .9, PI * 1.05, t, .26, { color: tone, color2: C.night, flat: .7, tilt: -.3 + i * .25, w: .5, props: { jag: u * .014, seg: 44 } });
            S.sfx(i % 2 ? 'swish_b' : 'swish_a', t, { vol: .7, rate: 1 + i * .1, cool: 0 });
            S.sfx('metal_a', t + .1, { vol: .4, rate: 1.2 + i * .1, cool: 0 });
            K.sparks(S, T.x - u * .08, T.y - u * .16, 14, [1, .8, .4], t + .1, { angle: -2.2, spread: 1.2, speed: 1.2 });
            S.pose('t', { flash: .5 }, t + .1).to({ dx: u * .02, flash: 0 }, .05).to({ dx: 0 }, .1).end();
        }
        S.burst({ x: T.x - u * .1, y: T.y - u * .18, n: 50, t: .5, cell: 'spark', color: [1, .9, .6], color2: [1, .5, .15], angle: -2.3, spread: 1.1, speed: [u * .8, u * 1.9], life: [.2, .45], size: [u * .012, u * .03], grav: u * 2.4, drag: 1.5, stretch: 1.2, over: .55 });
        K.slash(S, T.x - u * .16, T.y - u * .05, u * .72, -PI * .62, PI * .42, 1.1, .34, { color: C.white, color2: vio, flat: 1, w: .34, lead: .34, props: { jag: u * .012, seg: 50 } });
        S.lens('slice', { x: T.x, y: T.y, ang: PI / 2 - .12, p0: 0, p1: .005, p2: 1, p3: 0, color: [.7, 0, 0], color2: vio }, 1.2).to({ p0: .03 }, .05, 'out3').wait(.14).to({ p0: 0, p2: 0 }, .2, 'io').end();
        S.flash(lite(vio, .6), .36, .26, 1.2);
        K.impact(S, T.x, T.y, 1.2, { power: 1, color: vio, zoom: .07 });
        K.crack(S, T.x, g, u * .56, 1.2, .5, { color: vio, color2: C.night, n: 9 });
        K.shards(S, T.x, g, 20, rock, 1.2, { speed: 1.4 });
        K.dust(S, T.x, g, 14, sand, 1.22, { flat: .3, radius: u * .2, speed: .7 });
        knock(S, 1.2, 1);
        if (!S.minor) S.shake(24, .5, 1.2);
    });

    def(skill('54버스트'), { impact: 1.15, cast: 1.85, sounds: ['swish_s', 'swish_a', 'chain_a', 'earth_b', 'punch_b', 'glass_big'] }, S => {
        // 등 뒤에 창 다섯 자루가 떠올라 차례로 날아가 대상에 박힌다. 박힌 자리에서 네 갈래의 붉은 날개가 터져 나온다.
        const u = S.U, A = S.A, T = S.T, vio = [.72, .32, 1], crim = [1, .14, .3];
        S.dim(.62, 0, 1.45, T, .15, .4);
        S.sfx('earth_b', 1.13, { vol: .8 }); S.sfx('punch_b', 1.15, { vol: 1 }); S.sfx('glass_big', 1.16, { vol: .7 });
        chant(S, 0, 1, { lift: .02 });
        for (let i = 0; i < 5; i++) {
            const k = (i - 2) / 2, sx = A.x - u * .06 + k * u * .16, sy = A.y - u * (.46 - Math.abs(k) * .12), tx = T.x + (S.rnd(i) - .5) * u * .14, ty = T.y + k * u * .14, ang = Math.atan2(ty - sy, tx - sx), born = .08 + i * .07, fire = .55 + i * .1;
            S.field('beam', { x: sx, y: sy + u * .08, w: u * .34, h: u * .07, rot: -PI / 2, color: vio, color2: C.night, p0: 0, p1: 0, p2: .5, alpha: 1, z: 3 }, born)
                .to({ p0: 1.05, y: sy }, .1, 'out3').to({ rot: ang }, .16, 'back').at(fire).to({ x: sx + Math.cos(ang) * u * .2, alpha: 0 }, .05, 'in').end();
            S.sfx('swish_s', born, { vol: .4, rate: 1 + i * .08, cool: 0 });
            K.dart(S, sx, sy, tx, ty, fire, .2, { color: vio, color2: crim, width: u * .07, lead: .5 });
            S.sfx(i % 2 ? 'chain_a' : 'swish_a', fire, { vol: .6, rate: 1 + i * .06, cool: 0 });
            K.ring(S, tx, ty, u * .12, vio, fire + .1, { th: .14, dur: .22 });
            K.sparks(S, tx, ty, 8, vio, fire + .1, { speed: .8 });
            S.shape('streak', { x: tx - Math.cos(ang) * u * .1, y: ty - Math.sin(ang) * u * .1, w: u * .22, h: u * .012, rot: ang, color: lite(vio), p0: .4, z: 3 }, fire + .1).at(1.15).to({ alpha: 0 }, .06).end();
            S.pose('t', { flash: .4 }, fire + .1).to({ dx: u * .014, flash: 0 }, .05).to({ dx: 0 }, .08).end();
        }
        [-.75, .75, PI - .75, PI + .75].forEach((a, i) => {
            const ex = T.x + Math.cos(a) * u * .62, ey = T.y + Math.sin(a) * u * .5;
            K.dart(S, T.x, T.y, ex, ey, 1.15, .4, { color: crim, color2: C.night, width: u * .24, lead: .4, lag: .4, ease: 'out3', side: (i % 2 ? 1 : -1) * u * .12, props: { p0: 3, p1: 5, taper: .6 } });
        });
        S.lens('shatter', { x: T.x, y: T.y, p0: 0, p1: 11, p2: .6, p3: 0, color: [.5, 0, 0], color2: vio }, 1.15).to({ p0: .45, p3: 1 }, .34, 'out').end();
        S.flash(lite(crim, .6), .3, .24, 1.15);
        K.impact(S, T.x, T.y, 1.15, { power: 1, color: crim, zoom: .07 });
        S.burst({ x: T.x, y: T.y, n: 30, t: 1.15, cell: 'petal', add: .7, color: lite(crim, .3), color2: vio, speed: [u * .4, u * 1.4], life: [.5, 1], size: [u * .03, u * .07], grow: .5, drag: 1.8, spin: 9 });
        knock(S, 1.15, 1);
    });

    def(skill('핫식스의정력'), { impact: 1.25, cast: 1.95, sounds: ['field', 'bolt_a', 'zap_big', 'thunder', 'boom_a'] }, S => {
        // 몸에 전류가 기어오르고, 과녁 같은 고리 셋이 앞에 선다. 고리를 꿰뚫고 나간 붉은 전류가 대상을 붙들고, 하늘이 마저 내리친다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, hot = [1, .42, .14], x0 = A.x + u * .12, y0 = A.y - u * .04;
        S.dim(.62, 0, 1.55, T, .15, .4);
        S.hit('field', .1, { vol: .5 }); S.hit('bolt_a', .86, { vol: .8 }); S.sfx('zap_big', .5, { vol: .5 }); S.hit('thunder', 1.25, { vol: 1 }); S.sfx('boom_a', 1.25, { vol: .8 });
        quake(S, 'a', .08, .7, u * .007, .6);
        K.aura(S, A.x, S.gA, u * .34, u * .7, .08, .9, { color: hot, color2: C.wine, speed: 5, fine: 1 });
        for (let i = 0; i < 7; i++) {
            const a = S.rnd(i) * TAU, b = a + 1 + S.rnd(i + 3), r = u * .16;
            K.bolt(S, A.x + Math.cos(a) * r, A.y + Math.sin(a) * r * 1.3, A.x + Math.cos(b) * r, A.y + Math.sin(b) * r * 1.3, C.gold, .1 + i * .09, { flashes: 1, twigs: 0, width: u * .03, jag: .16 });
        }
        for (let i = 0; i < 3; i++) {
            const x = x0 + u * (.1 + i * .11), size = u * (.26 + i * .1);
            S.field('shock', { x, y: y0, w: size * .1, h: size * .2, color: C.gold, color2: hot, p0: .8, p1: .1, p2: .6, p3: 0, alpha: 0, seed: i, z: 3 }, .4 + i * .1)
                .to({ w: size * .34, h: size, alpha: 1 }, .14, 'back').at(.86).to({ w: size * .5, h: size * 1.4, alpha: 0 }, .25, 'out').end();
        }
        K.orb(S, x0, y0, u * .06, .4, { color: C.gold, color2: hot, arcs: 1, spin: 6 }).to({ w: u * .44, h: u * .44 }, .44, 'in').to({ alpha: 0 }, .05).end();
        K.beam(S, x0, y0, T.x, T.y, u * .26, .86, .42, { color: hot, color2: C.wine, thick: .8, rush: 8 });
        [0, .12, .24].forEach((dt, i) => K.bolt(S, x0, y0, T.x, T.y, C.gold, .88 + dt, { flashes: 1, jag: .05, width: u * .06, seed: i }));
        quake(S, 't', .9, .34, u * .016, .9);
        K.sparks(S, T.x, T.y, 30, C.gold, .9, { speed: 1.1, more: { over: .3 } });
        [[-.06, 1.25], [.05, 1.31]].forEach(([dx, t]) => K.bolt(S, T.x + dx * u * 3, T.y - u * 1.3, T.x + dx * u, g, C.white, t, { flashes: 2, jag: .1, width: u * .12, twigs: 3, color2: hot }));
        S.flash(C.white, .45, .3, 1.25);
        K.impact(S, T.x, T.y, 1.25, { power: 1, color: hot, zoom: .07, flash: false });
        K.crack(S, T.x, g, u * .5, 1.25, .5, { color: C.gold, n: 9 });
        K.embers(S, T.x, T.y, 40, hot, 1.27, { radius: u * .25, rise: .6, over: .4 });
        S.shape('hex', { x: A.x, y: A.y, w: u * .1, h: u * .1, color: hot, alpha: 0, p0: 5, p1: .07, p2: .05, z: 2 }, 1.3).to({ w: u * .44, h: u * .54, alpha: .75 }, .16, 'back').wait(.3).to({ alpha: 0 }, .3).end();
        knock(S, 1.25, 1);
        if (!S.minor) S.shake(24, .5, 1.25);
    });

    def(skill('이어브피'), { impact: 1.2, cast: 1.95, sounds: ['ice_a', 'field', 'ice_big', 'ice_b', 'glass_big'] }, S => {
        // 눈꽃 무늬의 진이 서고 그 가운데 얼음의 심장이 뛴다. 쏘아진 냉기가 대상을 통째로 얼리고, 얼음은 한 박자 뒤에 스스로 갈라진다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, cx = A.x + u * .24, cy = A.y - u * .06, frost = [.62, .9, 1];
        S.dim(.6, 0, 1.6, T, .15, .4);
        S.sfx('ice_a', .08, { vol: .6 }); S.hit('field', .42, { vol: .5 }); S.hit('ice_big', 1.2, { vol: 1 }); S.hit('ice_b', .82, { vol: .5 }); S.sfx('glass_big', 1.58, { vol: .8 });
        chant(S, 0, 1, { lift: .02 });
        K.circle(S, cx, cy, u * .3, .05, 1.05, { color: frost, color2: C.deep, flat: 1, sides: 6, spin: 1.4, z: 0 });
        K.orb(S, cx, cy, u * .11, .12, { color: frost, color2: C.deep, p0: .05, spin: 3, rough: .1 }).to({ p0: .5 }, .5, 'out').tick((p, t) => { const beat = 1 + .12 * Math.max(0, Math.sin(t * 16)); p.w = p.h = u * .44 * beat; }).wait(.2).to({ alpha: 0, p0: .1 }, .08).end();
        S.burst({ x: cx, y: cy, n: 50, t: .12, cell: 'star', ring: u * .5, radial: -1, speed: [u * .6, u * 1], life: [.4, .6], size: [u * .015, u * .04], color: C.white, color2: frost, over: .6, spin: 6 });
        K.beam(S, cx, cy, T.x, T.y, u * .3, .82, .46, { color: frost, color2: C.deep, thick: .75, rush: 4 });
        S.burst({ x: cx, y: cy, n: 44, t: .84, cell: 'star', line: [T.x - cx, T.y - cy], radius: u * .08, color: C.white, color2: frost, speed: [0, u * .4], life: [.3, .6], size: [u * .015, u * .045], over: .36, spin: 6 });
        const cage = [[-.26, .5, -.4], [-.13, .84, -.16], [.01, 1.02, 0], [.14, .8, .18], [.27, .48, .42]].map(([dx, h, lean], i) =>
            K.crystal(S, T.x + dx * u, g, u * .24, u * h, 1.14 + Math.abs(i - 2) * .03, .4, { lean, grow: .1, fat: .62 }));
        S.lens('frost', { x: T.x, y: T.y, p0: 0, p1: .9, color2: frost }, 1.16).to({ p0: .4 }, .16, 'out3').wait(.26).to({ alpha: 0 }, .04).end();
        K.impact(S, T.x, T.y, 1.2, { power: .95, color: frost, zoom: .06 });
        K.ring(S, T.x, g, u * .56, frost, 1.2, { flat: .3, dur: .5 });
        S.pose('t', { flash: .8 }, 1.2).wait(.36).to({ flash: 0 }, .1).end();
        cage.forEach(node => node.at(1.58).to({ alpha: 0 }, .05).end());
        S.lens('shatter', { x: T.x, y: T.y, p0: 0, p1: 12, p2: .55, p3: 0, color: [.5, 0, 0], color2: frost }, 1.58).to({ p0: .5, p3: 1 }, .32, 'out').end();
        K.shards(S, T.x, T.y, 40, frost, 1.58, { speed: 1.4, radius: u * .16, spread: TAU, add: .35 });
        K.ring(S, T.x, T.y, u * .5, frost, 1.58, { dur: .4 });
        knock(S, 1.58, .6);
        S.shape('hex', { x: A.x, y: A.y, w: u * .1, h: u * .1, color: [.4, .6, 1], alpha: 0, p0: 5, p1: .07, p2: .05, z: 2 }, 1.3).to({ w: u * .44, h: u * .54, alpha: .75 }, .16, 'back').wait(.3).to({ alpha: 0 }, .3).end();
    });

    def(skill('댄져'), { impact: 1.25, cast: 1.95, sounds: ['beep', 'water_a', 'water_b', 'splash_big'] }, S => {
        // 대상 위에 붉은 경고 표지가 세 번 깜빡인다. 세 번째가 꺼지기 전에, 너무 맑은 물이 한 줄기로 밀려와 대상을 뒤로 민다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, red = [1, .16, .16], blue = [.45, .82, 1], x0 = A.x + u * .14, y0 = A.y - u * .04;
        S.dim(.55, 0, 1.6, T, .15, .4);
        [.1, .36, .62].forEach((t, i) => {
            S.sfx('beep', t, { vol: .6, rate: 1 + i * .12, cool: 0 });
            S.field('warn', { x: T.x, y: T.y - u * .12, w: u * (.7 - i * .08), h: u * (.7 - i * .08), color: red, p0: 1, add: .4, alpha: 0, z: 4 }, t).to({ alpha: 1, w: u * .5, h: u * .5 }, .06, 'out3').wait(.12).to({ alpha: 0 }, .06).end();
            S.flash(red, .16, .2, t);
        });
        chant(S, .2, .8, { lift: 0 });
        K.orb(S, x0, y0, u * .04, .3, { color: blue, color2: C.deep, spin: 5, rough: .2 }).to({ w: u * .5, h: u * .5 }, .6, 'out').to({ alpha: 0 }, .06).end();
        S.burst({ x: x0, y: y0, n: 40, t: .32, cell: 'drop', add: .6, ring: u * .4, radial: -1, speed: [u * .6, u * 1], life: [.35, .5], size: [u * .012, u * .03], color: C.white, color2: blue, stretch: .6, over: .55 });
        S.hit('water_a', .96, { vol: .9 }); S.hit('water_b', 1.25, { vol: .6 }); S.hit('splash_big', 1.25, { vol: 1 });
        S.pose('a', {}, .94).to({ dx: -u * .03, rot: -.05 }, .06, 'out').wait(.5).to({ dx: 0, rot: 0 }, .2).end();
        S.trail('water', { path: path.line(x0, y0, T.x, T.y), head: 0, tail: 0, width: u * .34, taper: .12, seg: 30, color: blue, color2: C.deep, p0: 5, p1: 9, p2: .2, z: 3 }, .96).to({ head: 1 }, .28, 'in').wait(.26).to({ tail: 1 }, .2, 'in').end();
        K.beam(S, x0, y0, T.x, T.y, u * .12, 1.1, .4, { color: C.white, color2: blue, thick: .5, shoot: .14, rush: 10 });
        S.burst({ x: x0, y: y0, n: 40, t: 1, cell: 'drop', add: .6, line: [T.x - x0, T.y - y0], radius: u * .08, color: C.white, color2: blue, speed: [u * .2, u * .7], angle: -PI / 2, spread: 2.4, life: [.3, .55], size: [u * .012, u * .028], grav: u * 2, over: .5 });
        S.lens('zoom', { x: T.x, y: T.y, p0: 0, live: true }, 1.23).to({ p0: .06 }, .05, 'out').to({ p0: 0 }, .22).end();
        K.impact(S, T.x, T.y, 1.25, { power: 1, color: blue, zoom: .06 });
        K.fire(S, T.x + u * .06, g, u * .6, u * 1, 1.25, .5, { color: blue, color2: C.deep, speed: 3.6, fall: .3 });
        K.drops(S, T.x, T.y, 50, blue, 1.25, { speed: 1.6, angle: -.5, spread: 2.6 });
        K.ring(S, T.x, g, u * .6, blue, 1.25, { flat: .28, dur: .55 });
        S.pose('t', { flash: 1 }, 1.25).to({ dx: u * .13, rot: .12 }, .08, 'out3').to({ flash: 0 }, .1).wait(.22).to({ dx: 0, rot: 0 }, .34, 'io').end();
        if (!S.minor) S.shake(20, .5, 1.25);
    });

    def(skill('초특급한탕'), { impact: 1.3, cast: 2, sounds: ['cannon', 'firework', 'coins_big', 'gem', 'gem_b', 'boom_a'] }, S => {
        // 금빛 포신 다섯이 하늘로 불을 뿜고, 밤하늘에 다섯 송이가 터진다. 쏟아지는 것은 불꽃이 아니라 금화와 보석이고, 맨 마지막에 가장 큰 별이 떨어진다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, bx = A.x + u * .26, by = S.gA, tones = [C.gold, C.pink, C.aqua, C.leaf, C.violet], sky = Math.max(u * .06, T.y - u * .6);
        S.dim(.66, 0, 1.6, T, .15, .4);
        S.sfx('cannon', .3, { vol: .8 }); S.sfx('cannon', .48, { vol: .7, rate: 1.15, cool: 0 }); S.sfx('coins_big', 1, { vol: .8 }); S.sfx('boom_a', 1.3, { vol: .9 });
        chant(S, 0, 1, { lift: .02 });
        K.circle(S, bx, by, u * .34, .04, 1, { color: C.gold, sides: 5, spin: 1.4 });
        for (let i = 0; i < 5; i++) {
            const k = (i - 2) / 2, t = .3 + i * .06, ex = lerp(A.x + u * .3, T.x + u * .2, i / 4), ey = sky + Math.abs(k) * u * .14 + u * .1;
            K.beam(S, bx + k * u * .12, by, ex, ey, u * .12, t, .26, { color: C.gold, color2: C.amber, thick: .6, shoot: .1, fall: .14 });
            K.sparks(S, bx + k * u * .12, by, 8, C.gold, t, { angle: -PI / 2, spread: 1.2, speed: .8 });
            const pop = .62 + i * .08, tone = tones[i];
            S.sfx('firework', pop, { vol: .55, rate: .9 + i * .08, cool: 0 });
            K.flare(S, ex, ey, u * .14, C.white, pop, .24);
            K.ring(S, ex, ey, u * .26, tone, pop, { dur: .4 });
            S.burst({ x: ex, y: ey, n: 26, t: pop, cell: 'star5', color: lite(tone, .4), color2: tone, speed: [u * .3, u * .9], life: [.6, 1.1], size: [u * .02, u * .045], drag: 2.2, grav: u * .7, spin: 8, seed: i });
            S.burst({ x: ex, y: ey, n: 16, t: pop, cell: 'spark', color: C.white, color2: tone, speed: [u * .5, u * 1.3], life: [.3, .6], size: [u * .012, u * .03], drag: 3, grav: u * .8, stretch: 1, seed: i + 9 });
        }
        S.burst({ x: T.x, y: sky, n: 60, t: .9, cell: 'coin', add: .25, color: C.gold, color2: C.amber, radius: u * .26, flat: .3, speed: 0, vy: u * .9, grav: u * 3.4, life: [.5, .7], size: [u * .02, u * .036], grow: 1, spin: 16, over: .5 });
        tones.forEach((tone, i) => S.burst({ x: T.x, y: sky, n: 9, t: .95, cell: 'shard', add: .5, color: lite(tone, .4), color2: tone, radius: u * .26, flat: .3, speed: 0, vy: u * 1, grav: u * 3.2, life: [.5, .7], size: [u * .02, u * .04], grow: 1, spin: 10, over: .45, seed: i }));
        S.sfx('gem', 1.02, { vol: .5 }); S.sfx('gem_b', 1.12, { vol: .5 });
        S.field('comet', { x: T.x + u * .3, y: sky - u * .3, w: u * .8, h: u * .36, rot: Math.atan2(T.y - sky + u * .3, -u * .3), color: C.gold, color2: C.amber, p0: .9, p1: .8, z: 3 }, 1.1).to({ x: T.x, y: T.y - u * .06 }, .2, 'in').to({ alpha: 0 }, .04).end();
        S.flash(C.holy, .42, .3, 1.3);
        K.impact(S, T.x, T.y, 1.3, { power: 1, color: C.gold, zoom: .07 });
        K.ring(S, T.x, g, u * .62, C.gold, 1.3, { flat: .3, dur: .55 });
        S.burst({ x: T.x, y: T.y, n: 40, t: 1.3, cell: 'coin', add: .25, color: C.gold, color2: C.amber, angle: -PI / 2, spread: 2.6, speed: [u * .6, u * 1.6], life: [.7, 1.2], size: [u * .02, u * .04], grow: 1, grav: u * 2.8, spin: 16 });
        S.burst({ x: T.x, y: T.y, n: 20, t: 1.3, cell: 'star5', color: C.white, color2: C.gold, speed: [u * .4, u * 1.4], life: [.6, 1.1], size: [u * .03, u * .07], drag: 1.6, grav: u, spin: 9 });
        K.rays(S, T.x, T.y, u * 1, 1.3, .6, { color: C.holy, color2: C.amber, n: 7 });
        knock(S, 1.3, 1);
    });

    const POKER = [.62, .71, .8, .89, .98, 1.07, 1.16, 1.25, 1.5];
    def(skill('포커 못 하시네'), { impact: .62, hits: POKER, cast: 2, images: ['paint:card-back', 'paint:card-face'], sounds: ['card_fan', 'card_a', 'card_snap', 'slash_c', 'punch_m', 'swish_c'] }, S => {
        // 아홉 장이 머리 위에 부채꼴로 펴진다. 여덟 장이 한 장씩 꽂히고, 남겨 둔 스페이드 에이스가 마지막에 화면을 긋는다.
        const u = S.U, A = S.A, T = S.T, red = [1, .2, .22], fan = i => { const a = -PI / 2 + (i - 4) * .2; return [A.x + u * .02 + Math.cos(a) * u * .34, A.y - u * .1 + Math.sin(a) * u * .34, a + PI / 2]; };
        S.dim(.55, 0, 1.75, T, .15, .4);
        S.hit('card_fan', .2, { vol: .8 });
        chant(S, 0, .6, { lift: .01 });
        POKER.forEach((hit, i) => {
            const last = i === 8, slot = fan(i), go = hit - (last ? .16 : .11), tx = T.x + (last ? 0 : (S.rnd(i) - .5) * u * .2), ty = T.y + (last ? 0 : (S.rnd(i + 11) - .5) * u * .34);
            const fly = path.bow(slot[0], slot[1], tx, ty, u * (last ? .1 : .04 + S.rnd(i + 3) * .1), (S.rnd(i + 7) - .5) * u * .2), born = .06 + i * .016;
            const card = S.sprite({ x: A.x, y: A.y - u * .1, size: u * (last ? .36 : .26), sx: .1, sy: .1, alpha: 0, rot: 0, glow: last ? .6 : 0, edge: red, z: 2 + i * .01 }, born, last ? 'paint:card-face' : 'paint:card-back');
            card.to({ x: slot[0], y: slot[1], rot: slot[2], sx: 1, sy: 1, alpha: 1 }, .16, 'back').at(go)
                .tick((p, t) => { const k = clamp((t + born - go) / (hit - go)); if (k > 0 && k < 1) { const q = fly(k * k); p.x = q[0]; p.y = q[1]; p.rot = slot[2] + k * TAU * (last ? 2 : 3); } })
                .wait(hit - go).to({ alpha: 0, sx: 1.3, sy: 1.3 }, .05).end();
            K.dart(S, slot[0], slot[1], tx, ty, go, (hit - go) * 1.5, { color: last ? C.white : lite(red, .4), color2: red, width: u * (last ? .08 : .04), lift: 0 });
            if (!last) {
                const a = S.rnd(i + 20) * PI;
                S.sfx(i % 2 ? 'card_snap' : 'slash_c', hit, { vol: .6, rate: 1 + i * .04, cool: 0 }); S.sfx('swish_c', go, { vol: .4, rate: 1 + i * .05, cool: 0 });
                K.slash(S, tx, ty, u * .2, a, a + 2.2, hit - .02, .18, { color: lite(red, .3), color2: red, w: .4 });
                K.sparks(S, tx, ty, 8, red, hit, { speed: .8 });
                K.ring(S, tx, ty, u * .12, red, hit, { th: .14, dur: .2 });
                S.pose('t', { flash: .6 }, hit).to({ dx: u * .016, flash: 0 }, .04).to({ dx: 0 }, .05).end();
                S.burst({ x: tx, y: ty, n: 3, t: hit, cell: 'card', add: 0, color: C.bone, speed: [u * .3, u * .8], angle: -PI / 2, spread: 2.4, life: [.5, .8], size: [u * .03, u * .05], grow: 1, grav: u * 2.4, spin: 14 });
                if (!S.minor) S.shake(4, .08, hit);
            }
        });
        S.sfx('card_a', 1.32, { vol: .7 }); S.sfx('slash_c', 1.5, { vol: 1, rate: .8, cool: 0 }); S.sfx('punch_m', 1.5, { vol: 1 });
        K.slash(S, T.x, T.y, u * .66, -2.5, .45, 1.44, .34, { color: C.white, color2: red, flat: .5, tilt: -.5, w: .3 });
        S.lens('slice', { x: T.x, y: T.y, ang: -.9, p0: 0, p1: .005, p2: 1, p3: 0, color: [.7, 0, 0], color2: red }, 1.5).to({ p0: .028 }, .05, 'out3').wait(.14).to({ p0: 0, p2: 0 }, .2, 'io').end();
        S.flash(lite(red, .7), .3, .24, 1.5);
        K.impact(S, T.x, T.y, 1.5, { power: 1, color: red, zoom: .07 });
        S.burst({ x: T.x, y: T.y, n: 16, t: 1.5, cell: 'card', add: 0, color: C.bone, speed: [u * .4, u * 1.3], life: [.6, 1.1], size: [u * .03, u * .06], grow: 1, grav: u * 2, drag: 1, spin: 14 });
        knock(S, 1.5, 1);
    });

    def(skill('범인은 이 안에'), { impact: 0, cast: 1.5, sounds: ['tick', 'lock', 'earth_b'] }, S => {
        // 세상의 색이 빠지고 조명 하나가 무대를 더듬는다. 조준경이 대상 위에서 조여들어 잠기는 순간, 색은 붉은 것부터 돌아온다.
        const u = S.U, A = S.A, T = S.T, red = [1, .14, .14];
        [.2, .4, .56, .68, .76].forEach((t, i) => S.sfx('tick', t, { vol: .5, rate: 1 + i * .1, cool: 0 }));
        S.sfx('lock', .86, { vol: 1 }); S.sfx('earth_b', .86, { vol: .7 });
        S.lens('mono', { x: A.x, y: A.y, p0: 0, p1: .92, p2: 0, p3: .5, color2: [.6, .62, .68], live: true }, 0).to({ p0: 1.8 }, .3, 'out').wait(.7).to({ alpha: 0 }, .3).end();
        S.sprite({ x: A.x, y: A.y - u * 1.1, size: u * 1.5, pivot: [.5, 0], rot: .3, alpha: 0, add: 1, z: 0 }, .1, 'paint:spot-cone').to({ alpha: .8, rot: 0 }, .16, 'out3').wait(.9).to({ alpha: 0 }, .25).end();
        S.sprite({ x: (A.x + T.x) / 2, y: A.y - u * 1.2, size: u * 1.6, pivot: [.5, 0], rot: .9, alpha: 0, add: 1, z: 0 }, .3, 'paint:spot-cone').to({ alpha: .6, rot: -.5 }, .22, 'io').to({ rot: -.2 }, .16, 'io').to({ rot: Math.atan2(-(T.x - (A.x + T.x) / 2), u * 1.2) }, .14, 'io').wait(.3).to({ alpha: 0 }, .25).end();
        S.pose('a', {}, .1).to({ rot: -.05 }, .2, 'out').wait(.5).to({ rot: .07, dx: u * .02 }, .08, 'in3').wait(.3).to({ rot: 0, dx: 0 }, .25, 'io').end();
        S.field('reticle', { x: T.x - u * .3, y: T.y - u * .2, w: u * 1.3, h: u * 1.3, color: red, color2: C.wine, p0: 1, p1: 3, alpha: 0, z: 3 }, .34)
            .to({ alpha: .9, x: T.x + u * .1, y: T.y + u * .08, w: u * .9, h: u * .9 }, .2, 'io').to({ x: T.x - u * .04, y: T.y - u * .05, w: u * .66, h: u * .66 }, .16, 'io').to({ x: T.x, y: T.y, w: u * .42, h: u * .42, p0: 0 }, .16, 'in3')
            .to({ w: u * .5, h: u * .5 }, .05).to({ w: u * .44, h: u * .44 }, .1).wait(.35).to({ alpha: 0, w: u * .7, h: u * .7 }, .2).end();
        S.punch(.05, .86, .4, T);
        S.flash(red, .3, .3, .86);
        K.ring(S, T.x, T.y, u * .4, red, .86, { dur: .4 });
        K.rays(S, T.x, T.y, u * .7, .86, .4, { color: red, color2: C.wine, n: 6, sharp: .8 });
        S.pose('t', { flash: .6 }, .86).to({ flash: 0 }, .25).end();
        S.burst({ x: A.x, y: A.y, n: 12, t: .9, cell: 'drop', add: 0, color: red, color2: C.wine, speed: [u * .1, u * .5], angle: -PI / 2, spread: 2, life: [.4, .7], size: [u * .012, u * .024], grav: u * 1.8 });
        K.aura(S, A.x, S.gA, u * .34, u * .7, .95, .55, { color: red, color2: C.wine, speed: 3.5 });
        K.embers(S, A.x, A.y, 16, red, .95, { radius: u * .14, rise: .5 });
    });

    def(skill('느억맘'), { impact: 1.2, cast: 1.9, sounds: ['slash_c', 'slash_d', 'chain_a', 'ice_a', 'glass_big', 'air_puff'] }, S => {
        // 두 번 스쳐 지나간다. 엇갈린 두 줄이 대상 위에 남고, 세상이 숨을 멈춘다. 칼집에 날이 닿는 소리와 함께 그 자리가 열린다.
        const u = S.U, A = S.A, T = S.T, tone = [.6, .7, 1], vio = [.55, .4, 1], tilts = [-.62, .62];
        S.dim(.62, 0, 1.5, T, .15, .4);
        S.sfx('air_puff', .12, { vol: .5 }); S.sfx('slash_c', .24, { vol: .9 }); S.sfx('slash_d', .46, { vol: .9 }); S.sfx('chain_a', 1.02, { vol: .7 }); S.hit('ice_a', 1.2, { vol: .9 }); S.sfx('glass_big', 1.2, { vol: .8 });
        S.pose('a', {}, 0).to({ dx: -u * .04, sy: .93, rot: -.07 }, .2, 'out').to({ alpha: 0, dx: u * .3, sx: 1.5 }, .05, 'in').set({ sx: 1, sy: 1, rot: 0, dx: 0 }).wait(.45).to({ alpha: 1 }, .08).wait(.2).to({ rot: .04 }, .06).to({ rot: 0 }, .2).end();
        tilts.forEach((tilt, i) => {
            const t = .24 + i * .22, dx = Math.cos(tilt) * u * .6, dy = Math.sin(tilt) * u * .6;
            K.slash(S, T.x, T.y, u * .6, i ? -.45 : -2.7, i ? -3.6 : .5, t - .03, .3, { color: i ? vio : tone, color2: C.night, flat: .32, tilt, w: .36 });
            K.dart(S, T.x - dx * 1.3, T.y - dy * 1.3, T.x + dx * 1.3, T.y + dy * 1.3, t - .04, .2, { color: C.white, color2: tone, width: u * .06, lead: .5 });
            S.shape('streak', { x: T.x, y: T.y, w: u * 1.3, h: u * .008, rot: tilt, color: C.white, alpha: 0, p0: .2, z: 4 }, t).to({ alpha: 1 }, .03).at(1.2).to({ alpha: 0, h: u * .04 }, .08).end();
            K.sparks(S, T.x, T.y, 8, tone, t, { speed: .8 });
            [-1, 1].forEach(side => K.dart(S, T.x, T.y, T.x + dx * 1.3 * side, T.y + dy * 1.3 * side, 1.2, .3, { color: vio, color2: C.night, width: u * .14, lead: .4, ease: 'out3' }));
        });
        S.lens('mono', { x: T.x, y: T.y, p0: 0, p1: .85, p2: 0, p3: .3, color2: [.55, .6, .8] }, .56).to({ p0: 1.6 }, .26, 'out').wait(.36).to({ alpha: 0 }, .04).end();
        K.flare(S, A.x + u * .08, A.y - u * .02, u * .1, C.white, 1.02, .2);
        S.lens('shatter', { x: T.x, y: T.y, p0: 0, p1: 11, p2: .6, p3: 0, color: [.55, 0, 0], color2: vio }, 1.2).to({ p0: .55, p3: 1 }, .36, 'out').end();
        S.flash(lite(vio, .7), .36, .26, 1.2);
        K.impact(S, T.x, T.y, 1.2, { power: 1, color: tone, zoom: .07 });
        K.shards(S, T.x, T.y, 34, tone, 1.2, { speed: 1.5, spread: TAU, add: .4, radius: u * .1 });
        knock(S, 1.2, 1);
        if (!S.minor) S.shake(22, .5, 1.2);
    });

    def(skill('원영적사고 모드 전환'), { impact: 0, cast: 1.4, sounds: ['shimmer', 'heal_b', 'holy_a', 'gem'] }, S => {
        // 분홍과 금빛 리본이 몸을 감아 오르고, 한 번 폴짝 뛰는 사이 온몸이 빛으로 바뀐다. 내려앉을 땐 이미 다른 사람이다.
        const u = S.U, A = S.A, g = S.gA, top = A.y - u * .5;
        S.hit('shimmer', .2, { vol: .6 }); S.hit('heal_b', .78, { vol: .7 }); S.hit('holy_a', .78, { vol: .5 }); S.sfx('gem', .9, { vol: .5 });
        K.circle(S, A.x, g, u * .36, .04, 1.1, { color: C.pink, color2: C.rose, sides: 5, spin: 2 });
        [[C.pink, 0], [C.gold, PI]].forEach(([tone, phase]) => K.stroke(S, 'energy', path.helix(A.x, g, top, u * .22, phase, 1.6, .32), .14, .9, { color: tone, color2: dark(tone, .6), width: u * .06, lead: .7, lag: .45, trail: .5, ease: 'io', props: { seg: 60 } }));
        K.embers(S, A.x, g, 34, C.pink, .14, { cell: 'star', radius: u * .18, flat: .3, rise: .9, speed: .5, over: .7, size: [u * .02, u * .05], spin: 5 });
        S.pose('a', {}, .46).to({ sy: .92 }, .1, 'out').to({ dy: -u * .08, sy: 1.04, flash: 1 }, .2, 'out3').wait(.08).to({ dy: 0, sy: 1 }, .18, 'in').to({ sy: .96, flash: .3 }, .05).to({ sy: 1, flash: 0 }, .25, 'out').end();
        K.flare(S, A.x, A.y - u * .08, u * .3, C.white, .76, .34);
        K.rays(S, A.x, A.y - u * .08, u * .8, .76, .6, { color: C.pink, color2: C.rose, n: 7 });
        [C.pink, C.gold].forEach((tone, i) => K.ring(S, A.x, A.y - u * .05, u * (.36 + i * .16), tone, .78 + i * .06, { dur: .45 }));
        S.burst({ x: A.x, y: top - u * .04, n: 14, t: .8, cell: 'star5', color: C.white, color2: C.gold, speed: [u * .3, u * .9], life: [.6, 1], size: [u * .03, u * .06], drag: 2, grav: u * .8, spin: 8 });
        S.burst({ x: A.x, y: top, n: 26, t: .84, cell: 'petal', add: .5, color: lite(C.pink), color2: C.pink, radius: u * .3, speed: [u * .02, u * .14], life: [.7, 1.2], size: [u * .025, u * .05], grow: .7, grav: u * .35, turb: u * .14, spin: 5, over: .35 });
        K.aura(S, A.x, g, u * .36, u * .8, .8, .6, { color: C.pink, color2: C.rose });
    });

    def(skill('카스 살포'), { impact: 1.15, cast: 1.9, sounds: ['air_long', 'bubble', 'water_b', 'splash', 'air_puff'] }, S => {
        // 힘껏 흔든다. 뚜껑이 튀는 순간 거품 섞인 줄기가 부채꼴로 뿜어져 대상을 뒤덮고, 남은 거품은 한참을 톡톡 터진다.
        const u = S.U, A = S.A, T = S.T, g = S.gT, x0 = A.x + u * .13, y0 = A.y - u * .08, teal = [.35, 1, .8], beer = [1, .85, .4], ang = Math.atan2(T.y - y0, T.x - x0), dist = Math.hypot(T.x - x0, T.y - y0);
        S.dim(.5, 0, 1.5, T, .15, .4);
        S.sfx('air_long', .08, { vol: .5, rate: 1.7 }); S.sfx('air_puff', .52, { vol: .9 }); S.hit('bubble', .56, { vol: .7 }); S.hit('water_b', 1.15, { vol: .9 }); S.sfx('splash', 1.15, { vol: .7 });
        S.pose('a', {}, .06).tick((p, t) => { if (t < .42) { p.dx = Math.sin(t * 80) * u * .012; p.rot = Math.sin(t * 80) * .04; } else { p.dx = -u * .03 * clamp(1 - (t - .46) / .7); p.rot = 0; } }).wait(1.2).end();
        K.glow(S, x0, y0, u * .1, beer, .1, .4, .6);
        K.flare(S, x0, y0, u * .16, C.white, .52, .2);
        S.burst({ x: x0, y: y0, n: 1, t: .52, cell: 'hard', add: 0, color: [.8, .82, .86], angle: -1.9, spread: .2, speed: u * 1.6, life: 1, size: u * .022, grow: 1, grav: u * 2.6, spin: 20 });
        [[u * .12, beer], [-u * .1, teal], [u * .02, C.white]].forEach(([lift, tone], i) => K.dart(S, x0, y0, T.x + (i - 1) * u * .06, T.y + (i - 1) * u * .1, .56 + i * .04, .62, { kind: 'water', color: tone, color2: i ? C.sea : C.amber, width: u * (.34 - i * .06), lift, lead: .7, lag: .5, trail: .5, props: { p0: 5, p1: 8, taper: .3 } }));
        [['ring', C.white, 60], ['drop', beer, 50], ['dot', teal, 44]].forEach(([cell, tone, n], i) =>
            S.burst({ x: x0, y: y0, n, t: .56, cell, add: .7, color: lite(tone, .4), color2: tone, angle: ang - .06, spread: .5, speed: [dist * 1.3, dist * 2.3], drag: 1.2, grav: u * .7, life: [.4, .7], size: [u * .022, u * (cell === 'ring' ? .07 : .05)], grow: cell === 'ring' ? 1.6 : .6, over: .62, seed: i, turb: u * .05 }));
        K.impact(S, T.x, T.y, 1.15, { power: .9, color: teal, zoom: .05 });
        K.fire(S, T.x, g, u * .6, u * .8, 1.15, .5, { color: [.9, 1, .9], color2: teal, speed: 3, fall: .3, alpha: .8 });
        K.dust(S, T.x, T.y, 14, C.white, 1.15, { add: .3, alpha: .6, radius: u * .2, speed: .4, layer: 1, rise: .2 });
        K.ring(S, T.x, g, u * .56, teal, 1.15, { flat: .28, dur: .55 });
        S.burst({ x: T.x, y: T.y + u * .1, n: 30, t: 1.2, cell: 'ring', color: C.white, color2: teal, radius: u * .26, speed: [0, u * .1], life: [.4, .9], size: [u * .02, u * .05], grow: 1.7, grav: -u * .3, turb: u * .06, over: .6 });
        K.aura(S, T.x, g, u * .44, u * .8, 1.25, .6, { color: teal, color2: C.sea, speed: 1.6 });
        knock(S, 1.15, .7); quake(S, 't', 1.4, .3, u * .006);
    });

    def(skill('수나타 소환'), { impact: 0, cast: 1.5, images: [skill('수나타 소환')], sounds: ['shimmer', 'warp', 'holy_big'] }, S => {
        // 허공에 오선이 물결치며 그어지고, 음표들이 그 줄을 타고 한 점으로 모인다. 마지막 음이 닿는 자리에 문이 열린다.
        const u = S.U, A = S.A, px = A.x - u * .16, py = A.y - u * .3, vio = [.72, .56, 1], x0 = A.x - u * .7, x1 = A.x + u * .7;
        S.hit('shimmer', .2, { vol: .5 }); S.hit('warp', .95, { vol: .7 }); S.hit('holy_big', .95, { vol: .7 });
        chant(S, 0, 1.1, { lift: .02 });
        for (let i = 0; i < 5; i++) {
            const y = py - u * .1 + i * u * .05;
            S.trail('energy', { head: 0, tail: 0, width: u * .012, taper: .1, seg: 40, color: lite(vio), color2: vio, p2: .05, z: 1, path: (s, t) => [lerp(x0, x1, s), y + Math.sin(s * 9 + t * 5 + i * .5) * u * .022 * Math.sin(s * PI)] }, .04 + i * .03).to({ head: 1 }, .3, 'out').at(.8).to({ tail: 1 }, .22, 'in').end();
        }
        S.burst({ x: x0, y: py, n: 26, t: .2, cell: 'note', color: C.white, color2: vio, line: [x1 - x0, 0], radius: u * .1, life: [.5, .7], size: [u * .035, u * .06], grow: .5, rot: 0, over: .45, each: homing(px, py) });
        K.circle(S, px, py, u * .22, .3, 1, { color: vio, color2: C.night, flat: 1, sides: 5, spin: 2.4, z: 0 });
        S.field('vortex', { x: px, y: py, w: u * .1, h: u * .1, color: vio, color2: C.night, p0: 1.4, p1: 3, p2: 7, p3: 0, alpha: 0, z: 0 }, .34).to({ w: u * .5, h: u * .5, alpha: .8 }, .4, 'out').wait(.2).to({ w: u * .1, h: u * .1, alpha: 0 }, .2, 'in').end();
        K.flare(S, px, py, u * .26, C.white, .95, .34);
        K.rays(S, px, py, u * .7, .95, .5, { color: vio, color2: C.night, n: 6 });
        [vio, C.gold].forEach((tone, i) => K.ring(S, px, py, u * (.3 + i * .14), tone, .95 + i * .06, { dur: .45 }));
        K.beam(S, px, py - u * .9, px, py + u * .1, u * .2, .9, .4, { color: lite(vio), color2: vio, thick: .6, shoot: .08, fall: .25 });
        S.burst({ x: px, y: py, n: 18, t: .96, cell: 'note', color: C.white, color2: vio, speed: [u * .2, u * .8], life: [.6, 1], size: [u * .03, u * .055], grow: .6, drag: 2, grav: -u * .2, spin: 3 });
    });
})(typeof globalThis != 'undefined' ? globalThis : this);
