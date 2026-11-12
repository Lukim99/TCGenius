// 전투 연출 장면집. 이펙트 하나마다 무대 위에서 벌어지는 일을 적는다.
// 모든 장면은 왼쪽의 시전자(A)가 오른쪽의 대상(T)을 치는 방향으로 쓰고, 반대 방향은 엔진이 뒤집어 그린다.
(function (root) {
    'use strict';
    const F = typeof module == 'object' && module.exports ? require('./combat-fx.js') : root.CombatFX;
    if (!F) return;
    const PI = Math.PI, TAU = PI * 2;
    // 실시간 재료(리본, 입자, 절차 셰이더). 재료집(combat-fx-kit.js)이 먼저 실려 있어야 한다. 처형박수와 익테봇 계열이 쓰는 함수에는 넣지 않는다.
    if (!F.kit && typeof module == 'object' && module.exports) require('./combat-fx-kit.js');
    const K = F.kit;
    if (!K) return;
    const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
    const lerp = (a, b, t) => a + (b - a) * t;

    // 음원마다 타격점까지 걸리는 시간(초). S.hit이 이만큼 앞당겨 튼다.
    Object.assign(F.soundHits, { fire_a: .18, fire_b: .37, fire_big: .47, fire_long: .51, ice_a: .14, ice_b: .47, ice_big: .53, water_a: .36, water_b: .5, bolt_a: .46, earth_a: .16, earth_b: .37, wind_a: .2, wind_b: .33, plant_a: .19, plant_b: .39, heal_a: .44, heal_b: .37, holy_a: .27, holy_b: .28, holy_c: .34, holy_big: .43, shimmer: .19, laser_a: .08, laser_rifle: .25, boom_low: .22, cannon: .08, rocket: .41, chain_a: .08, coins_a: .1, card_fan: .47, field: .09, teleport: .13, warp: .83, splash_big: .14, bubble: .09, thunder: .84, growl: .24, execution_clap: .47 });

    // 그림에서 따로 움직일 조각들(512 좌표의 다각형과 회전축).
    F.parts('skill:처형박수', {
        handL: { poly: [[133, 100], [193, 113], [220, 200], [217, 287], [200, 333], [143, 337], [80, 293], [63, 220], [73, 153], [107, 113]], pivot: [167, 327] },
        handR: { poly: [[373, 170], [427, 200], [480, 267], [490, 313], [460, 360], [400, 393], [340, 393], [313, 353], [320, 287], [340, 220]], pivot: [373, 387] }
    });
    F.parts('skill:익테봇 소환', {
        bot: { poly: [[177, 193], [187, 153], [200, 133], [193, 107], [213, 63], [233, 67], [230, 127], [257, 133], [300, 137], [320, 147], [327, 87], [350, 70], [360, 93], [347, 147], [333, 167], [340, 207], [320, 240], [280, 257], [233, 260], [193, 233]], pivot: [257, 200] },
        d0: { poly: [[41, 293], [67, 223], [137, 197], [140, 220], [107, 270], [53, 293]], pivot: [91, 245] },
        d1: { poly: [[127, 267], [157, 259], [180, 313], [175, 347], [160, 343]], pivot: [155, 303] },
        d2: { poly: [[310, 287], [333, 267], [373, 293], [410, 363], [400, 367], [327, 313]], pivot: [360, 313] },
        d3: { poly: [[373, 157], [400, 140], [433, 160], [460, 230], [440, 220], [400, 193], [390, 170]], pivot: [417, 183] }
    });
    F.parts('summon:익테봇 공격', { beam: { poly: [[220, 220], [280, 200], [400, 267], [497, 313], [500, 393], [427, 413], [320, 373], [233, 307]], pivot: [257, 263] } });
    F.parts('skill:수나타 소환', {
        sunata: { poly: [[100, 313], [120, 220], [113, 133], [173, 113], [193, 27], [233, 20], [253, 60], [293, 73], [333, 33], [363, 60], [347, 107], [373, 153], [427, 220], [433, 280], [400, 313], [373, 373], [313, 387], [267, 320], [220, 393], [153, 393], [107, 360]], pivot: [257, 200] }
    });
    F.parts('summon:수나타 공격', { cone: { poly: [[177, 133], [280, 120], [400, 113], [497, 253], [500, 313], [400, 427], [253, 400], [177, 373]], pivot: [193, 257] } });
    F.parts('skill:끝판왕', { crown: { poly: [[157, 223], [200, 240], [220, 220], [257, 267], [280, 193], [300, 240], [323, 233], [320, 313], [253, 340], [200, 350], [167, 293]], pivot: [243, 287] } });
    F.parts('skill:수업끝', { bell: { poly: [[150, 63], [180, 57], [207, 80], [260, 110], [293, 160], [267, 173], [233, 213], [193, 240], [167, 227], [157, 167], [163, 107]], pivot: [167, 73], keep: true } });

    // 합장한 손의 왼쪽 반. 손끝부터 손바닥까지는 가운데 선(오른쪽 변)에 맞붙고, 그 아래로 팔이 바깥으로 벌어진다.
    // 검은 면에 흰 테두리. 오른손은 뒤집어 쓴다. 둘을 붙이면 손끝이 하나의 아치로 이어진 합장이 되고,
    // 팔 끝을 축으로 바깥으로 젖히면 벌린 손이 된다.
    // 좌표는 가운데 선에서의 거리(dx)와 손끝에서의 거리(dy), 전체 높이 525 기준이다.
    F.paint('paint:clap-hand', 260, 600, g => {
        const k = 1.06, X = dx => 244 + dx * k, Y = dy => 22 + dy * k;
        const outline = () => {
            g.moveTo(X(0), Y(0));
            g.bezierCurveTo(X(-20), Y(0), X(-32), Y(12), X(-38), Y(36));        // 손끝의 아치
            g.bezierCurveTo(X(-52), Y(60), X(-64), Y(84), X(-68), Y(110));      // 손가락 끝마디
            g.bezierCurveTo(X(-74), Y(160), X(-80), Y(210), X(-86), Y(250));    // 손가락 바깥선
            g.bezierCurveTo(X(-88), Y(268), X(-94), Y(282), X(-100), Y(296));   // 엄지 밑동
            g.lineTo(X(-196), Y(446));                                          // 팔 바깥선
            g.quadraticCurveTo(X(-203), Y(457), X(-193), Y(464));               // 팔 끝 바깥 모서리
            g.lineTo(X(-99), Y(522));                                           // 팔 끝
            g.quadraticCurveTo(X(-89), Y(527), X(-83), Y(516));                 // 팔 끝 안쪽 모서리
            g.lineTo(X(0), Y(403));                                             // 팔 안쪽 선, 두 팔이 갈라지는 곳까지
        };
        g.lineJoin = g.lineCap = 'round';
        g.beginPath(); outline(); g.closePath(); g.fillStyle = '#060304'; g.fill();
        g.strokeStyle = '#fff'; g.lineWidth = 15; g.beginPath(); outline(); g.stroke();
        // 맞닿는 면의 테두리는 가늘다. 두 손이 붙으면 가운데 선 하나로 겹친다.
        g.lineWidth = 9; g.beginPath(); g.moveTo(X(0), Y(403)); g.lineTo(X(0), Y(0)); g.stroke();
        // 포개진 손가락: 안쪽 손가락일수록 낮게 시작하는 두 겹의 호가 바깥선을 따라 내려온다.
        g.lineWidth = 5;
        g.beginPath(); g.moveTo(X(0), Y(38)); g.bezierCurveTo(X(-16), Y(38), X(-34), Y(50), X(-44), Y(78)); g.bezierCurveTo(X(-54), Y(110), X(-60), Y(180), X(-66), Y(268)); g.stroke();
        g.beginPath(); g.moveTo(X(0), Y(78)); g.bezierCurveTo(X(-10), Y(78), X(-22), Y(88), X(-28), Y(108)); g.bezierCurveTo(X(-36), Y(140), X(-42), Y(200), X(-46), Y(262)); g.stroke();
    });

    // 처형의 십자가. 아래에서 올려다본 검은 실루엣: 기둥은 밑으로 갈수록 넓어지고 가로대의 끝은 비스듬하다.
    // 둘레로 붉은 기운이 번지고, 조명이 닿는 윗모서리와 나뭇결, 가로대를 묶은 밧줄만 어둡게 비친다.
    F.paint('paint:execution-cross', 400, 680, g => {
        const c = 200, shape = () => {
            g.beginPath();
            g.moveTo(c - 19, 40); g.lineTo(c + 19, 40);             // 기둥 머리
            g.lineTo(c + 24, 150); g.lineTo(c + 112, 150);          // 가로대 윗변
            g.lineTo(c + 128, 214); g.lineTo(c + 28, 214);          // 가로대 끝과 아랫변
            g.lineTo(c + 48, 650); g.lineTo(c - 48, 650);           // 기둥 밑동
            g.lineTo(c - 28, 214); g.lineTo(c - 128, 214);
            g.lineTo(c - 112, 150); g.lineTo(c - 24, 150);
            g.closePath();
        };
        g.fillStyle = '#050203';
        g.shadowColor = 'rgba(255,24,24,.95)'; g.shadowBlur = 30; shape(); g.fill(); g.fill();
        g.shadowBlur = 0; shape(); g.fill();
        g.save(); shape(); g.clip();
        g.strokeStyle = 'rgba(110,8,10,.28)'; g.lineWidth = 2.5;
        [-7, 9].forEach(dx => { g.beginPath(); g.moveTo(c + dx, 46); g.lineTo(c + dx * 2.2, 648); g.stroke(); });
        g.beginPath(); g.moveTo(c - 124, 184); g.lineTo(c + 124, 184); g.stroke();
        g.strokeStyle = 'rgba(170,20,22,.55)'; g.lineWidth = 5; g.lineCap = 'round';
        g.beginPath(); g.moveTo(c - 30, 146); g.lineTo(c + 30, 218); g.moveTo(c + 30, 146); g.lineTo(c - 30, 218); g.stroke();
        g.restore();
        g.strokeStyle = 'rgba(255,70,60,.75)'; g.lineWidth = 3; g.lineJoin = 'round';
        g.beginPath(); g.moveTo(c - 112, 150); g.lineTo(c - 24, 150); g.lineTo(c - 19, 40); g.lineTo(c + 19, 40); g.lineTo(c + 24, 150); g.lineTo(c + 112, 150); g.stroke();
    });
    // 무대 조명. 위의 좁은 광원에서 아래로 퍼지며 옅어진다. 폭을 달리해 겹쳐 칠해 가장자리를 푼다.
    F.paint('paint:spot-cone', 256, 512, g => {
        for (let i = 0; i < 6; i++) {
            const k = 1 - i * .14, top = 12 * k, bottom = 122 * k, fill = g.createLinearGradient(0, 0, 0, 512);
            fill.addColorStop(0, 'rgba(255,255,255,' + (.12 + i * .03) + ')'); fill.addColorStop(.6, 'rgba(255,255,255,' + (.07 + i * .02) + ')'); fill.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = fill; g.beginPath(); g.moveTo(128 - top, 0); g.lineTo(128 + top, 0); g.lineTo(128 + bottom, 512); g.lineTo(128 - bottom, 512); g.closePath(); g.fill();
        }
    });

    // ---- 빛으로만 그리는 소품 ----
    const v = (S, volume) => S.minor ? volume * .5 : volume;
    // 곁장면과 작은 대상(잡몹)에는 그림을 줄여 쓴다.
    const k = S => (S.minor ? .62 : 1) * S.scale;
    const at = S => S.role === 'actor' ? S.A : S.T;
    const ground = S => S.role === 'actor' ? S.gA : S.gT;
    const P = {
        ring(S, x, y, r, color, t0, o) {
            const q = o || {}, flat = q.flat || 1;
            return S.shape('wave', { x, y, w: r * .5, h: r * .5 * flat, color, alpha: q.alpha || .9, p0: .72, p1: q.th || .16, z: q.z == null ? 2 : q.z }, t0).to({ w: r * 2, h: r * 2 * flat, alpha: 0 }, q.dur || .38, 'out3');
        },
        glow(S, x, y, r, color, t0, duration, alpha) {
            const d = duration || .3;
            return S.shape('glow', { x, y, w: r * .6, h: r * .6, color, alpha: alpha || .9, p0: 1.6, z: 2 }, t0).to({ w: r * 2, h: r * 2 }, d * .35, 'out3').to({ alpha: 0, w: r * 2.4, h: r * 2.4 }, d * .65, 'out');
        },
        flare(S, x, y, r, color, t0, duration, rot) {
            const d = duration || .3, a = rot || 0;
            return S.shape('flare', { x, y, w: r * .4, h: r * .4, rot: a, color, alpha: 1, p0: .012, z: 3 }, t0).to({ w: r * 2.4, h: r * 2.4 }, d * .3, 'out3').to({ alpha: 0, w: r * 1.5, h: r * 1.5, rot: a + .5 }, d * .7, 'in');
        },
        // 사방으로 튀는 불티. cone이 있으면 그 방향으로만 튄다.
        sparks(S, x, y, count, color, t0, o) {
            const q = o || {}, n = S.reduced ? Math.ceil(count / 3) : S.minor ? Math.ceil(count * .6) : count, u = S.U;
            for (let i = 0; i < n; i++) {
                const a = q.cone == null ? S.rnd(i * 3 + 1) * TAU : q.cone + (S.rnd(i * 3 + 1) - .5) * (q.spread || 1.2);
                const dist = (q.dist || .2) * u * (.45 + S.rnd(i * 3 + 2)), len = (q.len || .07) * u * (.5 + S.rnd(i * 3 + 3)), d = (q.dur || .34) * (.7 + S.rnd(i + 9) * .6);
                S.shape('streak', { x, y, w: len, h: len * .16, rot: a, color, alpha: 1, p0: 1.2, z: 3 }, (t0 || 0) + S.rnd(i + 5) * .03)
                    .to({ x: x + Math.cos(a) * dist, y: y + Math.sin(a) * dist + (q.fall || 0) * u, alpha: 0, w: len * .35 }, d, 'out3');
            }
        },
        // 포물선으로 튀어 떨어지는 파편.
        debris(S, x, y, count, color, t0, o) {
            const q = o || {}, n = S.reduced ? 0 : S.minor ? Math.ceil(count / 2) : count, u = S.U;
            for (let i = 0; i < n; i++) {
                const a = -PI * (.12 + S.rnd(i * 7 + 2) * .76), speed = (q.speed || .9) * u * (.5 + S.rnd(i * 7 + 3)), size = (q.size || .013) * u * (.5 + S.rnd(i * 7 + 4)), spin = (S.rnd(i + 11) - .5) * 14;
                const vx = Math.cos(a) * speed, vy = Math.sin(a) * speed, gravity = (q.grav || 2.6) * u, life = .5 + S.rnd(i + 13) * .35;
                S.shape('shard', { x, y, w: size, h: size * 1.2, color, add: q.add || 0, white: 0, alpha: 1, z: 3 }, (t0 || 0) + S.rnd(i + 17) * .04)
                    .tick((p, t) => { p.x = x + vx * t; p.y = y + vy * t + gravity * t * t / 2; p.rot = spin * t; p.alpha = clamp((life - t) / .18); }).wait(life).end();
            }
        },
        lines(S, x, y, t0, duration, color, alpha) {
            if (S.reduced || S.minor) return null;
            const size = Math.max(S.W, S.H) * 1.7;
            return S.shape('lines', { x, y, w: size, h: size, color: color || [1, 1, 1], alpha: 0, p0: .22, p1: 11, p2: 0, white: 0, z: 30 }, t0)
                .tick((p, t) => { p.p2 = Math.floor(t * 20); }).to({ alpha: (alpha || .5) * .75 }, .04).wait(duration * .6).to({ alpha: 0 }, .1).end();
        },
        line(S, x1, y1, x2, y2, thickness, color, t0, duration, o) {
            const q = o || {}, len = Math.hypot(x2 - x1, y2 - y1);
            return S.shape('streak', { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: len * (q.from || .2), h: thickness, rot: Math.atan2(y2 - y1, x2 - x1), color, alpha: q.alpha || 1, p0: q.sharp || .5, z: q.z == null ? 3 : q.z }, t0)
                .to({ w: len * 1.1 }, (duration || .2) * .3, 'out3').to({ alpha: 0, h: thickness * .3 }, (duration || .2) * .7, 'in');
        },
        // 갈라지는 번개. 두 번 다른 모양으로 번쩍인다.
        bolt(S, x1, y1, x2, y2, color, t0, o) {
            const q = o || {}, flashes = S.reduced ? 1 : q.flashes || 2;
            for (let f = 0; f < flashes; f++) {
                let pts = [[x1, y1], [x2, y2]];
                for (let level = 0; level < 4; level++) {
                    const next = [pts[0]];
                    for (let i = 1; i < pts.length; i++) {
                        const a = pts[i - 1], b = pts[i], j = (S.rnd(f * 91 + level * 37 + i * 13) - .5) * (q.jag || .34) / 2 ** level;
                        next.push([(a[0] + b[0]) / 2 - (b[1] - a[1]) * j, (a[1] + b[1]) / 2 + (b[0] - a[0]) * j], b);
                    }
                    pts = next;
                }
                for (let i = 1; i < pts.length; i++) {
                    const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
                    S.shape('streak', { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, w: len * 1.5, h: (q.width || .012) * S.U, rot: Math.atan2(b[1] - a[1], b[0] - a[0]), color, alpha: 1, p0: .25, z: 4 }, (t0 || 0) + f * .07)
                        .wait(.035).to({ alpha: 0 }, .09).end();
                }
            }
        },
        arc(S, x, y, r, rot, color, t0, duration, o) {
            const q = o || {};
            return S.shape('arc', { x, y, w: r * 2, h: r * 2 * (q.flat || 1), rot, color, alpha: 1, p0: .78, p1: q.span || 1.25, p2: 0, p3: q.th || .13, z: 3 }, t0)
                .to({ p2: 1.2 }, duration || .12, 'out').to({ alpha: 0 }, .16, 'in');
        },
        decal(S, x, y, r, color, t0, duration, o) {
            const q = o || {};
            return S.shape('ring', { x, y, w: r * .8, h: r * .25, color, alpha: 0, p0: .8, p1: .12, z: -2 }, t0)
                .to({ w: r * 2, h: r * .62, alpha: q.alpha || .8 }, .14, 'out3').wait(duration || .3).to({ alpha: 0, w: r * 2.3, h: r * .7 }, .3, 'out');
        },
        beam(S, x, y, length, thickness, color, t0, duration) {
            return S.shape('streak', { x, y, w: length * .3, h: thickness, rot: PI / 2, color, alpha: 0, p0: .12, z: 1 }, t0).to({ alpha: .95, w: length }, .06, 'out').wait(duration || .2).to({ alpha: 0, h: thickness * .2 }, .22, 'in');
        }
    };
    // 그림의 화소가 입자로 움직이는 장면들.
    const M = {
        shatter(S, key, x, y, size, t0, o) {
            const q = o || {};
            return S.matter('shatter', Object.assign({ x, y, size, fx: q.fx == null ? x : q.fx, fy: q.fy == null ? y : q.fy, spread: q.spread || size * .7, grav: q.grav == null ? size * .5 : q.grav, px: q.px || Math.max(2.4, size * .0095), frac: S.minor ? .3 : q.frac || .7, hot: q.hot == null ? .3 : q.hot, shard: q.shard || 0, t: .001, rot: q.rot || 0, pivot: q.pivot }, q.extra), t0, key)
                .to({ t: .999 }, q.dur || .7, 'lin').end();
        },
        gather(S, key, x, y, size, t0, o) {
            const q = o || {};
            return S.matter('gather', { x, y, size, fx: q.fx == null ? x : q.fx, fy: q.fy == null ? y : q.fy, spread: q.spread || size * .5, px: q.px || Math.max(2.4, size * .01), frac: S.minor ? .3 : q.frac || .7, hot: q.hot == null ? .45 : q.hot, t: .001, pivot: q.pivot }, t0, key)
                .to({ t: .999 }, q.dur || .36, 'lin').end();
        },
        stream(S, key, x, y, size, tx, ty, t0, o) {
            const q = o || {};
            return S.matter('stream', { x, y, size, tx, ty, px: q.px || Math.max(2.6, size * .011), frac: S.minor ? .25 : q.frac || .5, hot: q.hot == null ? .2 : q.hot, shard: q.shard || 0, t: .001, pivot: q.pivot }, t0, key)
                .to({ t: .999 }, q.dur || .6, 'lin').end();
        },
        rise(S, key, x, y, size, t0, o) {
            const q = o || {};
            return S.matter('rise', { x, y, size, spread: q.spread || size * .45, px: q.px || Math.max(2.2, size * .009), frac: S.minor ? .15 : q.frac || .3, hot: .25, t: .001, pivot: q.pivot }, t0, key)
                .to({ t: .999 }, q.dur || .9, 'lin').end();
        },
        implode(S, key, x, y, size, t0, o) {
            const q = o || {};
            return S.matter('implode', { x, y, size, tx: q.tx == null ? x : q.tx, ty: q.ty == null ? y : q.ty, px: q.px || Math.max(2.4, size * .01), frac: q.frac || .8, hot: .35, t: .001 }, t0, key)
                .to({ t: .999 }, q.dur || .34, 'in').end();
        }
    };
    // 타격 순간에 겹치는 공통 반응: 고리, 섬광, 불티, 화면 반동.
    function strike(S, x, y, t, o) {
        const q = o || {}, u = S.U, power = (q.power == null ? .6 : q.power) * (S.minor ? .5 : 1), color = q.color || S.color();
        P.ring(S, x, y, u * (.12 + .2 * power), color, t, { th: .2 });
        P.glow(S, x, y, u * (.045 + .07 * power), q.core || [1, 1, 1], t, .18, .8);
        if (power > .35) P.flare(S, x, y, u * (.07 + .12 * power), color, t, .28, q.rot);
        P.sparks(S, x, y, Math.round(6 + power * 12), color, t, { dist: .14 + power * .2 });
        if (!S.minor) { S.shake(4 + power * 14, .18 + power * .2, t); if (power >= .5) S.stop(30 + power * 60, t); }
        if (q.zoom && !S.minor) S.punch(q.zoom, t, .34, { x, y });
    }

    // 한 점에서 터져 나오는 그림. 중심부터 드러나고 중심부터 비어 나간다.
    function pop(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .46) * u * k(S), p = at(S), x = q.x == null ? p.x : q.x, y = q.y == null ? p.y : q.y, color = q.color || S.color();
        const node = S.sprite({ x, y, size, mode: 1, head: 0, soft: .22, sx: .5, sy: .5, rot: q.rot == null ? -.3 : q.rot, flow: q.flow == null ? .01 : q.flow, fvx: 0, fvy: -.4, glow: q.glow == null ? .6 : q.glow, edge: color, center: q.center, swirl: q.swirl || 0, z: 1 }, q.t0);
        node.to({ head: 1.8, sx: 1.08, sy: 1.08, rot: 0 }, q.t || .16, 'out3').with({ swirl: 0 }, (q.t || .16) * 2.2, 'out').to({ sx: 1, sy: 1 }, .12, 'io').wait(q.hold == null ? .16 : q.hold).to({ tail: 1.8, sx: 1.16, sy: 1.16 }, q.fade || .3, 'in').end();
        if (q.strike !== false) strike(S, x, y, (q.t0 || 0) + .03, { power: q.power == null ? .55 : q.power, color, zoom: q.zoom });
        return node;
    }
    const catalog = typeof module == 'object' && module.exports ? require('./combat-effects.js') : root.CombatEffects;
    const skill = name => 'skill:' + name, combat = name => 'combat:' + name;
    // 스킬 장면은 호스트가 어느 쪽 사건으로 불렀든 같은 무대를 쓴다: 자기 강화 스킬만 시전자 기준, 나머지는 대상 기준.
    const def = (effectId, meta, run) => F.define(effectId, meta, !effectId.startsWith('skill:') ? run : S => {
        S.role = catalog && catalog.SKILL_TARGETS[effectId.slice(6)] === 'actor' ? 'actor' : 'target';
        return run(S);
    });

    // ================= 스킬 =================
    // 여기에는 예전 그대로 두는 장면(처형박수, 익테봇 계열)만 있다. 나머지 스킬은 combat-fx-skills.js가 등록한다.
    def(skill('처형박수'), { impact: .5, images: [skill('처형박수'), combat('화상 틱')], sounds: ['execution_clap', 'boom_low', 'air_whoosh', 'plank', 'boom_b', 'lock'] }, S => {
        // 카사네 테토 '처형박수' 뮤비의 구성을 따른다. 붉게 가라앉은 화면에 검은 손들이 한 줄로 올라와
        // 서로 엇갈릴 만큼 벌어진 채 버티다가, 박수 소리에 맞춰 한 번에 '짝' 닫힌다. 같은 순간 불타는 두 손이
        // 적을 사이에 두고 맞부딪히고, 이어서 조명 아래로 검은 십자가가 내리꽂힌다. 소리는 사용자가 준 음원이다.
        const u = S.U, x = S.T.x, y = S.T.y, g = S.gT, size = .95 * u, fire = [1, .42, .12], white = [1, 1, 1], t = .5;
        S.dim(.62, 0, 1.25, S.T);
        S.shape('rect', { x: S.W / 2, y: S.H / 2, w: S.W * 1.4, h: S.H * 1.4, color: [.5, 0, .05], alpha: 0, add: 0, p0: 0, p1: 0, z: -55 }).to({ alpha: .36 }, .1).wait(1.1).to({ alpha: 0 }, .34).end();
        S.hit('execution_clap', t, { vol: .95 });

        // 박수 줄. 두 손은 팔 끝을 축으로 돈다: 바깥으로 젖히면 벌린 손, 붙으면 합장이다.
        // 벌린 손끝이 이웃한 쌍의 손과 엇갈려 X자를 이룬다. 박수 전까지 조금씩 더 벌어지며 힘을 모은다.
        const count = 6, gap = Math.min(.21 * u, S.W * .155), half = gap * (count - 1) / 2, ih = gap / .95, hs = ih * 512 / 600, margin = ih * .8, swing = .87;
        const cx = half * 2 > S.W - margin * 2 ? S.W / 2 : clamp(x, margin + half, S.W - margin - half);
        const yb = Math.min(g + .07 * u, S.H * .94), axisY = yb - .063 * ih, ease = F.EASE.out3;
        for (let i = 0; i < count; i++) {
            const px = cx + (i - (count - 1) / 2) * gap, delay = Math.abs(i - (count - 1) / 2) * .012;
            for (const side of [-1, 1]) {
                S.sprite({ x: px + side * .2535 * ih, y: axisY + .5 * ih, size: hs, flip: -side, pivot: [.353, .904], alpha: 0, rot: side * swing * .8, z: 4 }, delay, 'paint:clap-hand').tick((p, tt) => {
                    const time = tt + delay, rise = clamp(time / .1), after = time - t;
                    const pop = after > 0 ? 1 + .16 * Math.max(0, 1 - after / .12) : 1;
                    p.alpha = after > .72 ? clamp(1 - (after - .72) / .25) : rise;
                    p.x = px + side * .2535 * ih * pop;
                    p.y = axisY + (1 - ease(rise)) * .5 * ih;
                    // 박수 전: 벌린 채 조금씩 더 젖혀진다. 박수: 한 프레임에 닫힌다.
                    p.rot = after < 0 ? side * swing * (.8 + .2 * clamp(time / (t - .04)) + .012 * Math.sin(time * 70)) : 0;
                    p.flash = after > 0 && after < .07 ? 1 : 0;
                    p.sx = p.sy = pop;
                }).wait(t + .98 - delay).end();
            }
            // '짝': 손바닥 사이의 흰 빛과 손끝 위로 튀는 선
            P.flare(S, px, yb - .6 * ih, .16 * ih, white, t, .16, i);
            for (const side of [-1, 0, 1]) S.shape('streak', { x: px + side * .2 * ih, y: yb - 1.05 * ih, w: .14 * ih, h: .036 * ih, rot: -PI / 2 + side * .6, color: white, alpha: 1, p0: .6, z: 5 }, t).to({ x: px + side * .3 * ih, y: yb - (side ? 1.15 : 1.2) * ih, alpha: 0 }, .16, 'out').end();
        }
        P.line(S, cx - half - gap, yb - .6 * ih, cx + half + gap, yb - .6 * ih, .012 * u, white, t, .22, { from: .05, sharp: 2 });

        // 불타는 두 손: 양옆에서 솟아 벌어졌다가 같은 순간 맞부딪힌다.
        const reach = .3 * u, hand = (name, side) => {
            const n = S.part(name, { x: x + side * reach, y: g + .34 * u, size, sx: .8, sy: .8, rot: side * .2, alpha: 0, flow: .016, fvy: -1.6, glow: .5, edge: fire, z: 2 });
            n.to({ y: y + .16 * u, alpha: 1, sx: 1, sy: 1, rot: side * -.1 }, .24, 'out3')
                .to({ x: x + side * (reach + .1 * u), rot: side * .34, sx: 1.08, sy: 1.08 }, .16, 'io')
                .to({ x: x + side * .055 * u, rot: side * -.16, sy: 1.14 }, .1, 'in3')
                .set({ flash: .9 }).to({ flash: 0, sx: 1.2, sy: .92 }, .07, 'out').to({ sx: 1, sy: 1 }, .12, 'io').wait(.1)
                .to({ x: x + side * .2 * u, y: y + .3 * u, alpha: 0, dis: .7 }, .3, 'in').end();
        };
        hand('handL', -1); hand('handR', 1);
        P.decal(S, x - reach, g, .2 * u, fire, .02, .2); P.decal(S, x + reach, g, .2 * u, fire, .02, .2);
        P.sparks(S, x - reach, g, 6, fire, .05, { cone: -PI / 2, spread: 1.2, dist: .3 }); P.sparks(S, x + reach, g, 6, fire, .05, { cone: -PI / 2, spread: 1.2, dist: .3 });
        S.sfx('boom_low', t - .22, { vol: .5 });
        S.flash([1, .85, .8], .5, .16, t); S.stop(90, t + .01); S.shake(22, .5, t); S.punch(.05, t, .4, S.T);
        P.ring(S, x, y, .5 * u, fire, t, { th: .22, dur: .5 }); P.ring(S, x, y, .32 * u, [1, .9, .6], t + .05, { th: .12 });
        P.flare(S, x, y, .42 * u, [1, .8, .4], t, .4); P.lines(S, x, y, t, .16, [1, .85, .6], .55);
        P.sparks(S, x, y, 22, fire, t, { dist: .5, len: .11 });
        M.shatter(S, S.key('handL'), x - .055 * u, y + .16 * u, size, t, { fx: x, fy: y + .1 * u, spread: .5 * u, dur: .8, frac: .55, rot: .16 });
        M.shatter(S, S.key('handR'), x + .055 * u, y + .16 * u, size, t, { fx: x, fy: y + .1 * u, spread: .5 * u, dur: .8, frac: .55, rot: -.16 });

        // 처형: 조명 두 줄기가 차례로 켜져 대상을 가두고, 그 빛 속으로 검은 십자가가 내리꽂힌다.
        // 꽂히는 순간 화면이 희게 날아가 검은 실루엣만 남고(뮤비의 흰 화면 컷), 이어 붉은 무대로 돌아온다.
        const t2 = t + .26, plant = Math.min(g + .08 * u, S.H * .96), ch = Math.min(.78 * u, plant - S.H * .05), cs = ch * 512 / 610, ember = [1, .28, .14], warm = [1, .86, .8];
        const cones = [-1, 1].map((side, n) => {
            const sx = x + side * .3 * u, sy = -.06 * S.H, len = Math.hypot(x - sx, plant - sy), aim = Math.atan2(sx - x, plant - sy), on = t + .06 + n * .07;
            S.sfx('lock', on, { vol: .3, rate: .7, cool: 0 });
            return S.sprite({ x: sx, y: sy, size: len * 1.3, pivot: [.5, 0], rot: aim, add: 1, tint: warm, alpha: 0, z: 0 }, on, 'paint:spot-cone')
                .set({ alpha: .7 }).to({ alpha: .34 }, .05).to({ alpha: .5 }, .05)
                .tick((p, tt) => { p.rot = aim + Math.sin(tt * 2.6 + n * 2) * .012; })
                .wait(.5 - n * .07).to({ alpha: 0 }, .32).end();
        });
        // 빛 웅덩이와 떠다니는 먼지
        S.shape('disc', { x, y: plant, w: .2 * u, h: .05 * u, color: warm, alpha: 0, white: 0, z: 0 }, t + .06).to({ alpha: .3, w: .62 * u, h: .15 * u }, .12, 'out3').wait(.5).to({ alpha: 0 }, .3).end();
        for (let i = 0; i < 12; i++) {
            const mx = x + (S.rnd(i * 3 + 1) - .5) * .5 * u, my = plant - S.rnd(i * 3 + 2) * ch, drift = (S.rnd(i + 40) - .5) * .05 * u, r = (.006 + S.rnd(i + 50) * .008) * u;
            S.shape('glow', { x: mx, y: my, w: r, h: r, color: warm, alpha: 0, p0: 1.4, z: 2 }, t + .1 + S.rnd(i + 60) * .2)
                .tick((p, tt) => { p.x = mx + drift * tt; p.y = my - .05 * u * tt; p.alpha = Math.max(0, Math.sin(tt * 4 + i) * .5 + .25) * clamp(tt / .1) * clamp((.75 - tt) / .2); }).wait(.75).end();
        }

        S.sfx('air_whoosh', t + .1, { vol: .5, rate: .8 }); S.sfx('plank', t2, { vol: .8, rate: .66 }); S.sfx('boom_b', t2, { vol: .5 });
        // 떨어지는 동안은 세로로 길게 늘어나고, 꽂히며 눌렸다가 선다. 마지막에는 붉은 불씨로 타 들어가 사라진다.
        const cross = S.sprite({ x, y: plant - 1.6 * u, size: cs, pivot: [.5, .956], alpha: 0, sy: 1.5, sx: .9, edge: ember, z: 3 }, t + .14, 'paint:execution-cross');
        cross.to({ alpha: 1 }, .03).with({ y: plant, sy: 1.22 }, .12, 'in3').to({ sy: .9, sx: 1.08 }, .05, 'out').to({ sy: 1, sx: 1 }, .2, 'elastic').wait(.24).to({ dis: 1, y: plant - .02 * u }, .34, 'in').end();
        for (const side of [-1, 1]) P.line(S, x + side * .05 * u, plant - 1.3 * u, x + side * .05 * u, plant - .3 * u, .008 * u, white, t + .14, .1, { from: .1, sharp: 1.6, alpha: .7 });
        // 꽂히는 순간의 한 컷: 흰 화면에 검은 십자가와 검은 손
        if (!S.reduced) S.shape('rect', { x: S.W / 2, y: S.H / 2, w: S.W * 1.4, h: S.H * 1.4, color: [.93, .9, .9], alpha: .9, add: 0, p0: 0, p1: 0, white: 0, z: 2.5 }, t2).wait(.045).to({ alpha: 0 }, .07).end();
        S.stop(70, t2 + .005); S.shake(20, .36, t2); S.punch(.04, t2, .36, { x, y: plant - ch * .5 });
        // 바닥에 눕는 그림자, 붉은 후광, 갈라지는 땅
        S.sprite({ x, y: plant, size: cs, pivot: [.5, .956], sy: -.3, alpha: 0, z: -1 }, t2, 'paint:execution-cross').to({ alpha: .36 }, .06).wait(.4).to({ alpha: 0 }, .3).end();
        S.shape('glow', { x, y: plant - ch * .62, w: .5 * u, h: .5 * u, color: [1, .08, .06], alpha: 0, p0: 1.5, white: 0, z: 0 }, t2 + .05).to({ alpha: .75, w: 1.05 * u, h: 1.05 * u }, .12, 'out3').wait(.3).to({ alpha: 0 }, .4).end();
        P.ring(S, x, plant, .5 * u, [1, .22, .18], t2 + .05, { flat: .3, th: .2, dur: .5 });
        for (let i = 0; i < 8; i++) {
            const a = (i + .5 + (S.rnd(i + 70) - .5) * .6) / 8 * PI, r = (.16 + S.rnd(i + 80) * .2) * u, kx = Math.cos(a), ky = Math.sin(a) * .26;
            const mx = x + kx * r * .5 + (S.rnd(i + 90) - .5) * .04 * u, my = plant + ky * r * .5 + .012 * u, ex = x + kx * r, ey = plant + ky * r + .012 * u;
            [[x + kx * .03 * u, plant + .012 * u, mx, my], [mx, my, ex, ey]].forEach(([x1, y1, x2, y2], n) => {
                const len = Math.hypot(x2 - x1, y2 - y1), rot = Math.atan2(y2 - y1, x2 - x1), at = t2 + .05 + n * .03;
                S.shape('streak', { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: len * .2, h: (.014 - n * .005) * u, rot, color: [.04, 0, 0], add: 0, white: 0, alpha: .9, p0: .4, z: -1 }, at).to({ w: len * 1.25 }, .06, 'out').wait(.45).to({ alpha: 0 }, .3).end();
                S.shape('streak', { x: (x1 + x2) / 2, y: (y1 + y2) / 2, w: len * .2, h: .004 * u, rot, color: ember, alpha: .9, p0: .4, z: -1 }, at).to({ w: len * 1.2 }, .06, 'out').to({ alpha: 0 }, .5, 'in').end();
            });
        }
        // 밑동의 불길과 십자가를 타고 오르는 불씨
        // 처형박수 그림에서 손을 잘라낸 나머지는 가장자리가 잘려 보이므로 쓰지 않는다. 온전한 불길 그림(화상 틱)이 발밑에서 솟았다가 십자가보다 먼저 위로 걷힌다.
        const pyre = S.sprite({ x, y: plant + .03 * u, size: .8 * u, pivot: [.5, .9], ang: -PI / 2, head: 0, soft: .16, sy: .5, sx: 1.12, flow: .022, fvx: 0, fvy: -1.8, glow: .5, edge: fire, z: 1 }, t2 + .05, combat('화상 틱'));
        pyre.to({ head: 1.45, sy: 1.08, sx: 1 }, .16, 'out3').to({ sy: 1 }, .12).wait(.12).to({ tail: 1.45, sy: 1.14 }, .32, 'in').end();
        M.rise(S, combat('화상 틱'), x, plant - .22 * u, .7 * u, t2 + .2, { dur: .7, frac: .35 });
        P.debris(S, x, plant, 14, [.45, .2, .12], t2 + .05, { speed: 1.15 });
        [[.16, .35], [.3, .62], [.44, .8], [.6, .5]].forEach(([dt, hgt], i) => P.sparks(S, x + (i % 2 ? 1 : -1) * (.04 + S.rnd(i + 30) * .03) * u, plant - ch * hgt, 7, ember, t2 + dt, { cone: -PI / 2, spread: 1.1, dist: .26, dur: .6, len: .04 }));
        return cones;
    });

    def(skill('자폭'), { impact: .5, sounds: ['beep', 'rocket', 'boom_a', 'boom_low'] }, S => {
        // 소환수가 경고음을 세 번 울리며 대상에게 돌진해 터진다.
        const u = S.U, x = S.T.x, y = S.T.y, c = [1, .6, .2], t = .5;
        for (let i = 0; i < 3; i++) S.sfx('beep', i * .12 - i * i * .015, { vol: .4, rate: 1 + i * .25, cool: 0 });
        S.hit('rocket', t, { vol: .5 });
        const flown = companions.detonate(S, t);
        if (!flown) P.line(S, S.A.x, S.A.y - .2 * u, x, y, .03 * u, c, t - .16, .2, { from: .05 });
        S.sfx('boom_low', t - .22, { vol: .9 }); S.sfx('boom_a', t, { vol: .9 });
        S.flash([1, .9, .7], .4, .2, t); S.stop(90, t + .01); S.shake(24, .55, t); S.punch(.05, t, .4, S.T);
        pop(S, { t0: t, x, y, size: .78, power: 1, hold: .26, rot: -.4 });
        P.ring(S, x, y, .6 * u, c, t, { th: .2, dur: .5 }); P.lines(S, x, y, t, .16, [1, .9, .7], .5);
        M.shatter(S, S.id, x, y, .7 * u, t + .04, { spread: .6 * u, grav: .5 * u, dur: .9, frac: 1 });
        P.debris(S, x, S.gT, 14, [.25, .15, .1], t, { speed: 1.2 });
    });

    def(skill('익테봇 소환'), { impact: 0, sounds: ['teleport', 'servo', 'beep', 'field'] }, S => {
        // 발판이 깔리고 빛기둥 속에서 봇이 조립된다. 봇 자체는 동행 장면이 이어받는다.
        const u = S.U, home = companions.home(S, '익테봇'), g = S.gA + .02 * u, c = [.3, .8, 1];
        S.sfx('teleport', 0, { vol: .5 }); S.sfx('servo', .2, { vol: .45 }); S.sfx('beep', .5, { vol: .3, rate: 1.4 }); S.sfx('field', .3, { vol: .3 });
        const pad = S.part('~rest', { x: home.x, y: g, size: .5 * u, pivot: [.5, .8], ang: -PI / 2, head: 0, soft: .2, sy: .5, alpha: .95, glow: .5, edge: c, z: 0 });
        pad.to({ head: .5 }, .14, 'out').to({ head: 1.4, sy: 1 }, .3, 'out').wait(.3).to({ tail: 1.45 }, .4, 'in').end();
        P.beam(S, home.x, (home.y + g) / 2, Math.abs(g - home.y) * 1.4, .1 * u, c, .08, .4);
        P.decal(S, home.x, g, .18 * u, c, 0, .7);
        for (let i = 0; i < 6; i++) S.shape('hex', { x: home.x + (S.rnd(i) - .5) * .2 * u, y: g, w: .03 * u, h: .035 * u, color: c, alpha: .8, p0: 1.2, p1: .14, p2: .3, z: 2 }, .1 + i * .05).to({ y: home.y + (S.rnd(i + 4) - .5) * .1 * u, alpha: 0 }, .5, 'out').end();
        P.ring(S, home.x, home.y, .16 * u, c, .5, { th: .1 }); P.flare(S, home.x, home.y, .16 * u, c, .5, .3);
    });

    // ================= 소환수 =================
    def('summon:익테봇 공격', { impact: .2, images: ['summon:익테봇 공격', skill('익테봇 소환')], sounds: ['laser_a', 'zap_big', 'servo'] }, S => { companions.fire(S, '익테봇'); });
    def('summon:익테봇 피해대행', { impact: .1, images: ['summon:익테봇 피해대행', skill('익테봇 소환')], sounds: ['metal_b', 'field', 'servo'] }, S => { companions.guard(S); });

    // ================= 속성, 전투 공통, 장비와 세트 =================
    // 자주 나오는 이펙트라 짧고 가볍게 짠다: 0.6초 안에 닿고, 전투를 멈추지 않으며, 화면 렌즈는 쓰지 않는다.
    // 그림은 빛깔(tint(S))과 짧은 강조로만 쓰고, 움직임은 리본과 입자와 절차 셰이더가 만든다.
    const C = K.C, path = K.path, lite = K.lite, dark = K.dark;
    const unit = S => S.U * k(S);
    // 그림에서 뽑은 빛깔은 옅다. 채도를 올려 기운과 고리가 제 색으로 보이게 한다.
    const tint = S => { const c = S.color(), low = Math.min(c[0], c[1], c[2]) * .72; return [clamp((c[0] - low) / (1 - low)), clamp((c[1] - low) / (1 - low)), clamp((c[2] - low) / (1 - low))]; };
    const who = S => S.role === 'actor' ? 'a' : 't';
    const homing = (tx, ty, grav) => p => { p.vx = (tx - p.x) / p.life; p.vy = (ty - p.y) / p.life - .5 * (grav || 0) * p.life; };
    // 타격의 공통 반응: 고리, 불티, 번쩍임, 흔들림, 맞은 쪽의 움찔. power 0~1.
    function hit(S, x, y, t, o) {
        const q = o || {}, u = unit(S), p = q.power == null ? .4 : q.power, color = q.color || tint(S);
        K.ring(S, x, y, u * (.14 + .2 * p), color, t, { th: .14, dur: .26 + p * .14 });
        K.flare(S, x, y, u * (.07 + .1 * p), lite(color, .5), t, .2, q.rot == null ? S.rnd(t * 31 + 2) * 1.5 : q.rot);
        K.sparks(S, x, y, Math.round(8 + p * 16), color, t, { speed: .7 + p * .9, angle: q.angle, spread: q.spread });
        if (p > .55 && !S.minor) K.glow(S, x, y, u * (.05 + .07 * p), C.white, t, .14, .7);
        if (S.minor) return;
        S.shake(3 + p * 12, .14 + p * .16, t);
        if (p >= .6) S.stop(30 + p * 40, t);
        S.pose(who(S), { flash: .3 + p * .4 }, t).to({ dx: S.U * (.008 + .02 * p), flash: 0 }, .05, 'out3').to({ dx: 0 }, .14, 'out').end();
    }
    // 그림이 잠깐 맺혔다 타 들어간다(낙인, 문장).
    const brand = (S, x, y, size, t, hold, o) => S.sprite(Object.assign({ x, y, size, sx: 1.5, sy: 1.5, alpha: 0, glow: .5, edge: tint(S), z: 1 }, o), t).to({ sx: 1, sy: 1, alpha: .95 }, .08, 'in3').set({ flash: .7 }).to({ flash: 0 }, .08).wait(hold).to({ dis: 1 }, .28, 'in').end();
    // 갈매기 무늬 한 쌍(∧ 또는 ∨)이 dy만큼 흐른다.
    const chevron = (S, x, y, size, color, t, dy, dur) => [-1, 1].forEach(side => S.shape('streak', { x: x + side * size * .22, y, w: size * .62, h: size * .13, rot: side * .7 * (dy < 0 ? 1 : -1), color, alpha: 0, p0: .6, z: 3 }, t).to({ alpha: .95 }, .05).with({ y: y + dy }, dur, 'out3').to({ alpha: 0 }, .12).end());

    // ---- 속성: 타격에 얹히는 짧은 기운 ----
    def('element:화', { impact: .06, sounds: ['fire_a'] }, S => {
        const u = unit(S), p = at(S), c = [1, .5, .15];
        S.hit('fire_a', .08, { vol: v(S, .4), cool: 180 });
        K.slash(S, p.x, p.y, u * .24, -2.5, .3, 0, .22, { color: c, color2: C.ember, flat: .5, tilt: -.3, w: .55 });
        K.fire(S, p.x, p.y + u * .12, u * .2, u * .3, .05, .34, { rise: .08, fall: .2 });
        K.embers(S, p.x, p.y, S.minor ? 5 : 10, c, .06, { radius: u * .1, rise: .5, speed: .3 });
    });
    def('element:수', { impact: .06, sounds: ['water_a', 'splash'] }, S => {
        const u = unit(S), p = at(S), c = [.4, .8, 1];
        S.sfx('splash', .04, { vol: v(S, .35), cool: 180 });
        K.fire(S, p.x, p.y + u * .14, u * .24, u * .36, .03, .3, { color: c, color2: C.deep, speed: 3.4, rise: .08, fall: .18 });
        K.drops(S, p.x, p.y, S.minor ? 7 : 14, c, .05, { speed: .9 });
        K.ring(S, p.x, p.y + u * .14, u * .24, c, .05, { flat: .3, dur: .3 });
    });
    def('element:명', { impact: .08, sounds: ['holy_b'] }, S => {
        const u = unit(S), p = at(S), c = [1, .92, .55];
        S.hit('holy_b', .1, { vol: v(S, .35), cool: 180 });
        K.beam(S, p.x, p.y - u * .7, p.x, p.y + u * .1, u * .12, 0, .22, { color: c, color2: C.sun, thick: .5, shoot: .07, fall: .12 });
        K.flare(S, p.x, p.y, u * .14, c, .08, .22);
        K.ring(S, p.x, p.y + u * .12, u * .22, c, .08, { flat: .3, dur: .28 });
        K.sparks(S, p.x, p.y, S.minor ? 5 : 10, c, .08, { speed: .6 });
    });
    def('element:암', { impact: .1, sounds: ['earth_b'] }, S => {
        const u = unit(S), p = at(S), c = [.66, .36, 1];
        S.hit('earth_b', .12, { vol: v(S, .35), rate: .7, cool: 180 });
        K.orb(S, p.x, p.y, u * .09, 0, { shader: 'hole', color: c, color2: C.night, p0: .05, spin: .8, add: 0 }).to({ p0: .42 }, .1, 'out3').to({ p0: 0, alpha: 0 }, .14, 'in').end();
        S.burst({ x: p.x, y: p.y, n: S.minor ? 8 : 16, t: 0, cell: 'spark', ring: u * .26, radial: -1, speed: [u * 1.4, u * 2], life: [.1, .16], size: [u * .012, u * .03], color: lite(c), color2: c, stretch: 1.2, over: .08 });
        K.sparks(S, p.x, p.y, S.minor ? 5 : 10, c, .12, { speed: .7, grav: 0 });
    });

    // ---- 타격 ----
    def(combat('기본 공격'), { impact: .08, sounds: ['swish_a', 'swish_b', 'swish_c'] }, S => {
        // 매번 다른 각도로 긋는 초승달 한 획.
        const u = unit(S), p = at(S), c = [.72, .86, 1], r = S.rnd(1), up = S.rnd(2) < .5, a = -2.5 + r * .7, tilt = (r - .5) * .9;
        S.sfx(['swish_a', 'swish_b', 'swish_c'][Math.floor(S.rnd(3) * 3)], 0, { vol: v(S, .5), cool: 60 });
        K.slash(S, p.x - u * .03, p.y, u * .27, up ? a : -a, up ? a + 2.7 : -a - 2.7, 0, .2, { color: c, color2: [.2, .42, 1], flat: .52, tilt, w: .56 });
        hit(S, p.x, p.y, .08, { power: .34, color: [1, .86, .5] });
    });
    def(combat('연격 추가타'), { impact: .06, sounds: ['swish_s', 'slash_c'] }, S => {
        const u = unit(S), p = at(S);
        S.sfx('swish_s', 0, { vol: v(S, .45), cool: 60 }); S.sfx('slash_c', .05, { vol: v(S, .35), cool: 60 });
        [[C.aqua, -.5, 0], [C.gold, .6, .05]].forEach(([c, tilt, t]) => K.slash(S, p.x, p.y, u * .2, -2.4, .4, t, .16, { color: c, flat: .32, tilt, w: .34 }));
        hit(S, p.x, p.y, .06, { power: .26, color: C.aqua });
    });
    def(combat('치명타'), { impact: .04, sounds: ['punch_c', 'glass_a'] }, S => {
        // 붉은 별 모양의 한 컷: 방사선, 십자 섬광, 튀는 파편.
        const u = unit(S), p = at(S), red = [1, .3, .2];
        S.sfx('punch_c', 0, { vol: v(S, .7), cool: 90 }); S.sfx('glass_a', 0, { vol: v(S, .3), cool: 90 });
        K.rays(S, p.x, p.y, u * .36, 0, .24, { color: [1, .9, .7], color2: red, n: 6, spin: 0, sharp: .9, z: 3 });
        S.shape('flare', { x: p.x, y: p.y, w: u * .1, h: u * .1, rot: .4, color: [1, .85, .6], p0: .02, z: 4 }).to({ w: u * .7, h: u * .7 }, .07, 'out3').to({ alpha: 0, rot: .9 }, .18, 'in').end();
        P.lines(S, p.x, p.y, 0, .08, red, .4);
        K.shards(S, p.x, p.y, S.minor ? 5 : 10, red, .02, { add: .5, speed: 1.1, spread: TAU, size: [u * .012, u * .026] });
        hit(S, p.x, p.y, .04, { power: .8, color: red });
        if (!S.minor) S.punch(.03, .04, .3, p);
    });
    def(combat('운명 피해'), { impact: .1, sounds: ['slash_d', 'earth_b'] }, S => {
        // 보랏빛 진이 대상 위에 열리고, 그 한가운데를 창이 비스듬히 꿰뚫는다.
        const u = unit(S), p = at(S), c = [.7, .45, 1];
        S.sfx('slash_d', 0, { vol: v(S, .55) }); S.hit('earth_b', .1, { vol: v(S, .4) });
        K.circle(S, p.x, p.y, u * .2, 0, .2, { color: c, color2: C.night, flat: 1, sides: 6, spin: 4, z: 1, draw: .08 });
        K.dart(S, p.x - u * .42, p.y - u * .3, p.x + u * .12, p.y + u * .09, 0, .18, { color: lite(c), color2: c, width: u * .08, lead: .56 });
        S.burst({ x: p.x, y: p.y, n: S.minor ? 5 : 10, t: .1, cell: 'star', color: C.white, color2: c, speed: [u * .2, u * .8], life: [.25, .5], size: [u * .02, u * .05], drag: 2 });
        hit(S, p.x, p.y, .1, { power: .58, color: c });
    });
    def(combat('추가 피해'), { impact: .06, sounds: ['punch_m'] }, S => {
        const u = unit(S), p = at(S), c = [1, .78, .3];
        S.sfx('punch_m', .02, { vol: v(S, .4), cool: 100 });
        [-1, 1].forEach(side => K.dart(S, p.x - u * .34, p.y + side * u * .22, p.x, p.y, 0, .14, { color: c, color2: C.amber, width: u * .1, lead: .45, side: side * u * .06 }));
        hit(S, p.x, p.y, .06, { power: .32, color: c });
    });
    def(combat('고정 피해'), { impact: .12, sounds: ['swish_a', 'metal_a'] }, S => {
        // 세 겹의 고리를 꿰어 나가는 흰 바늘. 무엇으로도 깎이지 않는 한 줄.
        const u = unit(S), A = S.A, T = S.T, ang = Math.atan2(T.y - A.y, T.x - A.x);
        S.sfx('swish_a', 0, { vol: v(S, .45) }); S.sfx('metal_a', .12, { vol: v(S, .4) });
        K.beam(S, A.x + u * .1, A.y, T.x + u * .08, T.y, u * .06, 0, .2, { color: C.white, color2: C.volt, thick: .5, shoot: .12, fall: .1 });
        [C.gold, C.aqua, C.violet].forEach((c, i) => {
            const k = .62 + i * .13, x = lerp(A.x, T.x, k), y = lerp(A.y, T.y, k);
            S.field('shock', { x, y, w: u * .03, h: u * .1, rot: ang, color: c, color2: dark(c, .6), p0: .7, p1: .12, p2: .4, p3: 0, seed: i }, .05 + i * .025).to({ w: u * .1, h: u * .3, p0: .9, alpha: 0 }, .22, 'out3').end();
        });
        hit(S, T.x, T.y, .12, { power: .42, color: C.white });
    });
    def(combat('속성 추가 피해'), { impact: .06, sounds: ['holy_a'] }, S => {
        // 네 속성의 빛이 네 귀에서 한 점으로 모인다.
        const u = unit(S), p = at(S);
        S.hit('holy_a', .08, { vol: v(S, .35), cool: 200 });
        [[C.fire, -1, -1], [[.35, .75, 1], 1, -1], [C.holy, -1, 1], [C.violet, 1, 1]].forEach(([c, sx, sy]) => K.dart(S, p.x + sx * u * .3, p.y + sy * u * .24, p.x, p.y, 0, .14, { color: c, color2: dark(c, .6), width: u * .1, lead: .45 }));
        hit(S, p.x, p.y, .06, { power: .36, color: C.holy });
    });
    def(combat('프리즘 추가 공격'), { impact: .16, sounds: ['holy_c', 'swish_b'] }, S => {
        // 흰 빛 한 줄이 허공에서 꺾여 여섯 빛깔로 갈라져 꽂힌다.
        const u = unit(S), A = S.A, T = S.T, mx = lerp(A.x, T.x, .5), my = lerp(A.y, T.y, .5) - u * .12;
        const rainbow = [[1, .3, .3], [1, .65, .2], [1, .95, .3], [.35, 1, .5], [.3, .7, 1], [.7, .4, 1]];
        S.hit('holy_c', .16, { vol: v(S, .4) }); S.sfx('swish_b', .02, { vol: v(S, .4) });
        K.dart(S, A.x + u * .08, A.y, mx, my, 0, .1, { color: C.white, color2: C.volt, width: u * .07, lead: .7 });
        K.flare(S, mx, my, u * .1, C.white, .07, .16);
        rainbow.forEach((c, i) => K.dart(S, mx, my, T.x, T.y + (i - 2.5) * u * .03, .07, .13, { color: c, color2: dark(c, .5), width: u * .045, lead: .65, side: (i - 2.5) * u * .07 }));
        hit(S, T.x, T.y, .16, { power: .46, color: C.white });
    });
    def(combat('그림자 공격'), { impact: .1, sounds: ['slash_d', 'wind_a'] }, S => {
        // 등 뒤의 그림자에서 먹빛 한 획이 거꾸로 올라온다.
        const u = unit(S), p = at(S), c = [.62, .36, 1];
        S.sfx('slash_d', .04, { vol: v(S, .55) }); S.hit('wind_a', .1, { vol: v(S, .3) });
        K.smoke(S, p.x + u * .1, p.y + u * .1, u * .2, 0, .5, { color: [.2, .1, .35], color2: [.03, 0, .08], dense: .7, lift: .2 });
        K.slash(S, p.x + u * .02, p.y, u * .28, 1.2, -1.9, .02, .22, { kind: 'ink', color: c, color2: C.night, flat: .5, tilt: .3, w: .5, props: { add: 0, p0: 4, p1: 3, p2: .6, taper: .5, seg: 30 } });
        K.slash(S, p.x + u * .02, p.y, u * .27, 1.2, -1.9, .04, .16, { color: c, color2: C.night, flat: .5, tilt: .3, w: .14 });
        hit(S, p.x, p.y, .1, { power: .42, color: c });
    });
    def(combat('가시 반사'), { impact: .14, sounds: ['swish_c', 'punch_m'] }, S => {
        const u = unit(S), A = S.A, T = S.T, c = [.8, .4, 1];
        S.sfx('swish_c', 0, { vol: v(S, .4) }); S.sfx('punch_m', .14, { vol: v(S, .4) });
        K.dart(S, A.x + u * .06, A.y, T.x, T.y, 0, .22, { color: c, color2: C.night, width: u * .09, lead: .62, props: { jag: u * .012 } });
        K.sparks(S, A.x + u * .06, A.y, 6, c, 0, { angle: 0, spread: 1.4, speed: .6 });
        hit(S, T.x, T.y, .14, { power: .36, color: c });
    });
    def(combat('처형'), { impact: .16, sounds: ['slash_c', 'metal_b', 'boom_b'] }, S => {
        // 한순간 어두워지고, 붉은 날이 위에서 아래로 떨어진다.
        const u = unit(S), p = at(S), red = [1, .14, .14];
        S.sfx('slash_c', .04, { vol: v(S, .6) }); S.sfx('metal_b', .16, { vol: v(S, .5) }); S.sfx('boom_b', .17, { vol: v(S, .45) });
        if (!S.minor) S.dim(.5, 0, .2, p, .06, .2);
        K.slash(S, p.x - u * .1, p.y - u * .04, u * .5, -PI * .62, PI * .4, .06, .26, { color: lite(red, .4), color2: red, flat: 1, w: .32, lead: .4 });
        K.drops(S, p.x, p.y, S.minor ? 6 : 14, red, .16, { speed: .9, spread: TAU, more: { add: 0, color: red, color2: C.wine } });
        hit(S, p.x, p.y, .16, { power: .9, color: red });
    });
    def(combat('자해'), { impact: .06, sounds: ['slash_b', 'squish'] }, S => {
        const u = unit(S), p = at(S), red = [.95, .12, .14];
        S.sfx('slash_b', 0, { vol: v(S, .4) }); S.sfx('squish', .06, { vol: v(S, .3) });
        K.slash(S, p.x, p.y, u * .18, 2.7, -.2, 0, .18, { color: red, color2: C.wine, flat: .4, tilt: .5, w: .4 });
        K.drops(S, p.x, p.y, S.minor ? 4 : 8, red, .06, { speed: .5, more: { add: 0, color: red, color2: C.wine } });
        hit(S, p.x, p.y, .06, { power: .22, color: red });
    });
    def(combat('카운터'), { impact: .08, sounds: ['metal_b', 'slash_a'] }, S => {
        // 푸른 막이 받아내고, 받아낸 힘이 붉은 한 획으로 되돌아간다.
        const u = unit(S), A = S.A, T = S.T, blue = [.5, .8, 1], red = [1, .3, .25];
        S.sfx('metal_b', 0, { vol: v(S, .45) }); S.sfx('slash_a', .06, { vol: v(S, .45) });
        K.slash(S, A.x + u * .04, A.y, u * .2, -1.4, 1.4, 0, .2, { color: blue, color2: C.deep, flat: 1, w: .36, lead: .3 });
        K.sparks(S, A.x + u * .18, A.y, 6, blue, .02, { angle: 0, spread: 1.6, speed: .6 });
        K.dart(S, A.x + u * .16, A.y, T.x, T.y, .03, .1, { color: red, color2: C.wine, width: u * .08, lead: .6 });
        K.slash(S, T.x, T.y, u * .24, -2.6, .3, .06, .18, { color: red, color2: C.wine, flat: .45, tilt: -.4, w: .5 });
        hit(S, T.x, T.y, .08, { power: .5, color: red });
    });

    // ---- 지속 피해와 표식 ----
    const burn = (name, c, c2, apply, extra) => def(combat(name), { impact: apply ? .12 : .06, sounds: apply ? ['fire_b'].concat(extra || []) : ['fire_a'] }, S => {
        const u = unit(S), p = at(S), g = ground(S);
        if (apply) {
            // 불의 낙인이 찍히고, 그 자리에서 불길이 한 번 치솟는다.
            S.hit('fire_b', .14, { vol: v(S, .45), rate: extra ? .8 : 1 }); if (extra) S.sfx('growl', 0, { vol: v(S, .3), rate: .8 });
            K.circle(S, p.x, p.y, u * .17, 0, .3, { color: c, color2: c2, flat: 1, sides: 5, spin: 3, z: 1, draw: .1 });
            brand(S, p.x, p.y, u * .32, .04, .2);
            K.fire(S, p.x, g, u * .3, u * .52, .12, .44, { color: c, color2: c2 });
            K.embers(S, p.x, p.y, S.minor ? 6 : 14, c, .12, { radius: u * .12, rise: .6, speed: .35 });
            hit(S, p.x, p.y, .12, { power: .3, color: c });
        } else {
            // 발밑에서 한 번 낼름거리는 불.
            S.hit('fire_a', .1, { vol: .28, rate: extra ? .75 : 1, cool: 400 });
            K.fire(S, p.x, g, u * .2, u * .34, 0, .38, { color: c, color2: c2, rise: .08, fall: .22 });
            K.embers(S, p.x, g - u * .1, S.minor ? 3 : 7, c, .04, { radius: u * .07, rise: .5, speed: .25 });
            if (!S.minor) S.pose(who(S), { flash: .3 }, .06).to({ flash: 0 }, .16).end();
        }
    });
    burn('화상 부여', [1, .5, .14], C.ember, true); burn('화상 틱', [1, .5, .14], C.ember, false);
    burn('겁화 부여', [1, .16, .22], C.wine, true, ['growl']); burn('겁화 틱', [1, .16, .22], C.wine, false);
    def(combat('화상 폭발'), { impact: .08, sounds: ['fire_big', 'boom_b'] }, S => {
        const u = unit(S), p = at(S), g = ground(S), c = [1, .55, .15];
        S.hit('fire_big', .08, { vol: v(S, .6) }); S.sfx('boom_b', .08, { vol: v(S, .5) });
        K.orb(S, p.x, p.y, u * .1, .02, { color: c, color2: C.ember, p0: .1, spin: 5, rough: .3 }).to({ p0: .5, w: u * .9, h: u * .9 }, .12, 'out3').to({ alpha: 0 }, .12).end();
        [-1, 0, 1].forEach(i => K.fire(S, p.x + i * u * .14, g, u * .22, u * (.5 - Math.abs(i) * .12), .08 + Math.abs(i) * .04, .42, { color: c, color2: C.ember }));
        K.embers(S, p.x, p.y, S.minor ? 8 : 22, c, .08, { radius: u * .16, rise: .7, speed: .6 });
        hit(S, p.x, p.y, .08, { power: .75, color: c });
    });
    def(combat('장송곡 폭발'), { impact: .14, sounds: ['fire_big', 'bell_a', 'boom_a'] }, S => {
        // 종이 한 번 울리고, 울림이 닿은 자리에서 붉은 탑이 솟는다.
        const u = unit(S), p = at(S), g = ground(S), red = [1, .2, .16];
        S.sfx('bell_a', 0, { vol: v(S, .5) }); S.hit('fire_big', .14, { vol: v(S, .55) }); S.sfx('boom_a', .14, { vol: v(S, .45) });
        K.ring(S, p.x, p.y - u * .3, u * .34, C.gold, 0, { th: .08, dur: .3 });
        K.fire(S, p.x, g, u * .34, u * .95, .12, .55, { color: red, color2: C.wine });
        K.rays(S, p.x, p.y, u * .5, .14, .34, { color: red, color2: C.wine, n: 6, sharp: .8 });
        K.embers(S, p.x, p.y, S.minor ? 8 : 20, red, .14, { radius: u * .14, rise: .8, speed: .5 });
        hit(S, p.x, p.y, .14, { power: .7, color: red });
    });
    def(combat('천공 폭발'), { impact: .18, sounds: ['thunder', 'holy_big', 'boom_b'] }, S => {
        const u = unit(S), p = at(S), g = ground(S), c = [1, .9, .6];
        S.hit('holy_big', .18, { vol: v(S, .5) }); S.hit('thunder', .18, { vol: v(S, .45) }); S.sfx('boom_b', .18, { vol: v(S, .4) });
        K.rays(S, p.x, p.y - u * .7, u * .5, 0, .4, { color: c, color2: C.volt, n: 5, spin: .4, alpha: .6 });
        K.bolt(S, p.x + u * .05, p.y - u * 1.1, p.x, g, c, .14, { width: u * .1, jag: .09, twigs: S.minor ? 0 : 2, color2: C.volt });
        K.beam(S, p.x, p.y - u * 1.1, p.x, g, u * .16, .15, .22, { color: c, color2: C.volt, thick: .5, shoot: .04, fall: .14 });
        K.ring(S, p.x, g, u * .34, c, .18, { flat: .3, dur: .36 });
        hit(S, p.x, p.y, .18, { power: .72, color: c });
    });
    def(combat('심판 표식'), { impact: .13, sounds: ['holy_c'] }, S => {
        // 금빛 고리가 머리 위로 내려앉고, 몸 위에 표식이 그려진다.
        const u = unit(S), p = at(S), c = [1, .88, .5], hy = p.y - u * .26;
        S.hit('holy_c', .13, { vol: v(S, .4) });
        S.shape('ring', { x: p.x, y: hy - u * .3, w: u * .3, h: u * .09, color: c, alpha: 0, p0: .8, p1: .16, z: 3 }).to({ y: hy, alpha: 1 }, .13, 'in3').to({ w: u * .36 }, .06).wait(.3).to({ alpha: 0, y: hy - u * .06 }, .2).end();
        K.circle(S, p.x, p.y, u * .2, .06, .34, { color: c, color2: C.sun, flat: 1, sides: 4, spin: 1.5, z: 1, draw: .1 });
        K.flare(S, p.x, hy, u * .12, c, .13, .24);
        K.sparks(S, p.x, hy, S.minor ? 4 : 8, c, .13, { speed: .4, grav: 0 });
    });
    const mark = (name, apply) => def(combat(name), { impact: apply ? .13 : .06, sounds: [apply ? 'lock' : 'squish'] }, S => {
        // 붉은 조준 무늬가 조여들어 잠긴다. 지속 피해 때는 그 무늬가 한 번 맥박친다.
        const u = unit(S), p = at(S), red = [1, .18, .22];
        if (apply) S.sfx('lock', .1, { vol: v(S, .45) }); else S.sfx('squish', .04, { vol: .3, cool: 400 });
        const size = apply ? .7 : .4;
        S.field('reticle', { x: p.x, y: p.y, w: u * size, h: u * size, color: red, color2: C.wine, p0: apply ? 1 : 0, p1: 4, alpha: 0, z: 2 }).to({ alpha: 1, w: u * .4, h: u * .4, p0: 0 }, apply ? .13 : .05, 'in3').to({ w: u * .46, h: u * .46 }, .05).wait(apply ? .22 : .06).to({ alpha: 0, w: u * .56, h: u * .56 }, .18).end();
        K.ring(S, p.x, p.y, u * .26, red, apply ? .13 : .05, { th: .1, dur: .26 });
        K.sparks(S, p.x, p.y, S.minor ? 4 : 8, red, apply ? .13 : .05, { speed: .5 });
        if (!S.minor) S.pose(who(S), { flash: .3 }, apply ? .13 : .05).to({ flash: 0 }, .16).end();
    });
    mark('표식 부여', true); mark('표식 지속 피해', false);
    def(combat('빙결'), { impact: .12, sounds: ['ice_a', 'ice_b'] }, S => {
        const u = unit(S), p = at(S), g = ground(S), c = [.62, .9, 1];
        S.hit('ice_a', .12, { vol: v(S, .5) }); S.hit('ice_b', .5, { vol: v(S, .25) });
        [[-.12, .34, -.3], [0, .52, 0], [.12, .36, .32]].forEach(([dx, h, lean], i) => K.crystal(S, p.x + dx * u, g, u * .16, u * h, .06 + Math.abs(i - 1) * .03, .3, { lean, grow: .08 }).to({ alpha: 0 }, .22, 'in').end());
        K.ring(S, p.x, g, u * .3, c, .12, { flat: .3, dur: .34 });
        K.shards(S, p.x, p.y, S.minor ? 5 : 10, c, .44, { add: .4, speed: .8, spread: TAU });
        if (!S.minor) S.pose(who(S), { flash: .6 }, .12).wait(.24).to({ flash: 0 }, .12).end();
    });
    def(combat('기절'), { impact: .06, sounds: ['bell_b', 'punch_m'] }, S => {
        // 머리 위를 도는 별들.
        const u = unit(S), p = at(S), c = [1, .88, .35], hy = p.y - u * .3;
        S.sfx('punch_m', .04, { vol: v(S, .5) }); S.sfx('bell_b', .06, { vol: v(S, .3), rate: 1.4 });
        hit(S, p.x, p.y - u * .2, .06, { power: .3, color: c });
        for (let i = 0; i < 4; i++) S.shape('flare', { x: p.x, y: hy, w: u * .14, h: u * .14, color: c, alpha: 0, p0: .05, z: 3 }, .06).to({ alpha: 1 }, .08).tick((q, t) => { const a = t * 8 + i * TAU / 4; q.x = p.x + Math.cos(a) * u * .15; q.y = hy + Math.sin(a) * u * .045; q.w = q.h = u * (.13 + .05 * Math.sin(a)); q.rot = t * 3; }).wait(.6).to({ alpha: 0 }, .16).end();
        S.shape('ring', { x: p.x, y: hy, w: u * .3, h: u * .09, color: c, alpha: 0, p0: .8, p1: .1, z: 2 }, .06).to({ alpha: .5 }, .1).wait(.55).to({ alpha: 0 }, .16).end();
    });

    // ---- 막 ----
    const shell = (S, p, w, h, c, t, hold) => S.shape('hex', { x: p.x, y: p.y, w: w * .3, h: h * .3, color: c, alpha: 0, p0: 5, p1: .07, p2: .05, z: 2 }, t).to({ w, h, alpha: .8 }, .16, 'back').wait(hold).to({ alpha: 0, w: w * 1.1, h: h * 1.1 }, .26, 'out').end();
    def(combat('보호막 부여'), { impact: 0, sounds: ['field'] }, S => {
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx('field', 0, { vol: v(S, .45), cool: 300 });
        shell(S, p, u * .4, u * .48, c, 0, .3);
        K.ring(S, p.x, ground(S), u * .26, c, .02, { flat: .3, dur: .34 });
        K.embers(S, p.x, p.y, S.minor ? 5 : 12, c, .05, { cell: 'star', radius: u * .16, rise: .5, speed: .25, size: [u * .015, u * .035] });
    });
    def(combat('보호막 흡수'), { impact: .04, sounds: ['metal_ring'] }, S => {
        // 맞은 자리의 막이 번쩍이며 받아내고, 불티가 온 쪽으로 튕겨 나간다.
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx('metal_ring', .02, { vol: v(S, .45), cool: 120 });
        S.shape('hex', { x: p.x - u * .04, y: p.y, w: u * .16, h: u * .36, color: c, alpha: .9, p0: 4, p1: .08, p2: .1, z: 2 }).to({ w: u * .22, alpha: 0 }, .26, 'out').end();
        K.ring(S, p.x - u * .06, p.y, u * .16, c, .04, { th: .1, dur: .22 });
        K.sparks(S, p.x - u * .08, p.y, S.minor ? 5 : 10, c, .04, { angle: PI, spread: 1.6, speed: .8 });
    });
    def(combat('보호막 파괴'), { impact: .05, sounds: ['glass_big', 'metal_b'] }, S => {
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx('glass_big', .05, { vol: v(S, .5) }); S.sfx('metal_b', .05, { vol: v(S, .35) });
        S.shape('hex', { x: p.x, y: p.y, w: u * .4, h: u * .48, color: c, alpha: .9, p0: 5, p1: .07, p2: .1, z: 2 }).to({ w: u * .44, h: u * .52 }, .05).to({ alpha: 0, w: u * .6, h: u * .7 }, .1, 'out').end();
        K.shards(S, p.x, p.y, S.minor ? 8 : 18, c, .05, { add: .45, speed: 1.2, spread: TAU, radius: u * .1 });
        hit(S, p.x, p.y, .05, { power: .5, color: c });
    });
    [['받는 피해 감소', 'field'], ['속성 저항', 'field'], ['방어', 'metal_b'], ['무적', 'field']].forEach(([name, snd]) => def(combat(name), { impact: 0, sounds: name === '무적' ? ['holy_big', 'field'] : [snd] }, S => {
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx(snd, name === '방어' ? .04 : 0, { vol: v(S, name === '방어' ? .4 : .32), rate: 1.2, cool: 250 });
        if (name === '무적') {
            // 금빛 구가 온몸을 감싸고 빛살이 새어 나온다.
            S.hit('holy_big', .14, { vol: v(S, .45) });
            K.orb(S, p.x, p.y, u * .26, 0, { color: [1, .95, .7], color2: C.sun, p0: .05, spin: 1.5, rough: .03 }).set({ alpha: .5 }).to({ p0: .5 }, .18, 'back').wait(.3).to({ alpha: 0, p0: .58 }, .3).end();
            K.rays(S, p.x, p.y, u * .5, .06, .5, { color: [1, .95, .7], color2: C.sun, n: 8, alpha: .6 });
        } else if (name === '방어') {
            // 금빛과 푸른빛의 두 고리가 몸 앞에서 엇갈려 돈다.
            [[C.gold, .5, 0], [[.5, .75, 1], -.5, PI]].forEach(([tone, tilt, a]) => K.slash(S, p.x, p.y, u * .24, a, a + TAU * .9, 0, .34, { color: tone, color2: dark(tone, .5), flat: .4, tilt, w: .24, lead: .5, lag: .5, trail: .5 }));
        } else if (name === '속성 저항') {
            [C.fire, [.35, .75, 1], C.holy, C.violet].forEach((tone, i) => K.slash(S, p.x, p.y, u * .22, i * PI / 2, i * PI / 2 + PI / 2, .02 * i, .3, { color: tone, color2: dark(tone, .5), flat: 1, w: .2, lead: .5 }));
        }
        shell(S, p, u * (name === '무적' ? .46 : .36), u * (name === '무적' ? .54 : .44), c, .02, name === '방어' ? .1 : .22);
        K.ring(S, p.x, p.y, u * .28, c, .04, { th: .06, dur: .3 });
    }));

    // ---- 회복과 흡수 ----
    def(combat('HP 회복'), { impact: 0, sounds: ['heal_a'] }, S => {
        // 발밑에서 연둣빛 기운이 오르고 잎이 따라 떠오른다.
        const u = unit(S), p = at(S), g = ground(S), c = [.5, 1, .45];
        S.hit('heal_a', .3, { vol: v(S, .42), cool: 500 });
        K.aura(S, p.x, g, u * .3, u * .6, 0, .7, { color: c, color2: C.moss, alpha: .7 });
        K.ring(S, p.x, g, u * .26, c, 0, { flat: .3, dur: .4 });
        S.burst({ x: p.x, y: g - u * .05, n: S.minor ? 5 : 10, t: .04, cell: 'petal', add: .5, color: lite(c), color2: c, radius: u * .14, flat: .3, angle: -PI / 2, spread: .8, speed: [u * .3, u * .6], life: [.5, .9], size: [u * .025, u * .045], grow: .6, drag: 1.5, turb: u * .08, spin: 5, over: .3 });
        K.embers(S, p.x, p.y, S.minor ? 4 : 8, C.white, .1, { cell: 'star', radius: u * .14, rise: .4, speed: .2, size: [u * .015, u * .035] });
    });
    def(combat('MP 회복'), { impact: 0, sounds: ['heal_b'] }, S => {
        // 푸른 띠 둘이 몸을 감아 오르고, 방울이 따라 떠오른다.
        const u = unit(S), p = at(S), g = ground(S), c = [.4, .7, 1];
        S.hit('heal_b', .3, { vol: v(S, .38), rate: 1.15, cool: 500 });
        [0, PI].forEach(a => K.stroke(S, 'energy', path.helix(p.x, g, p.y - u * .3, u * .16, a, 1.3, .3), 0, .6, { color: c, color2: C.deep, width: u * .04, lead: .7, lag: .45, trail: .5, props: { seg: 40 } }));
        S.burst({ x: p.x, y: g - u * .1, n: S.minor ? 5 : 10, t: .05, cell: 'ring', color: C.white, color2: c, radius: u * .14, flat: .4, speed: [0, u * .08], life: [.4, .8], size: [u * .012, u * .03], grow: 1.6, grav: -u * .5, over: .3 });
        K.ring(S, p.x, g, u * .24, c, 0, { flat: .3, dur: .4 });
    });
    const siphon = (name, snd, from, to, rate) => def(combat(name), { impact: .1, sounds: [snd] }, S => {
        // 대상에게서 빠져나온 것이 방울방울 날아와 주인에게 스민다.
        const u = unit(S), A = S.A, T = S.T, ax = A.x, ay = A.y - u * .04;
        S.hit(snd, .3, { vol: v(S, .4), rate, cool: 300 });
        K.ring(S, T.x, T.y, u * .18, from, .04, { th: .1, dur: .24 });
        S.burst({ x: T.x, y: T.y, n: S.minor ? 8 : 18, t: .08, cell: 'dot', color: lite(from, .3), color2: to, radius: u * .08, life: [.32, .46], size: [u * .018, u * .036], grow: .5, turb: u * .1, over: .18, each: homing(ax, ay) });
        K.stroke(S, 'energy', path.bow(T.x, T.y, ax, ay, u * .12), .08, .42, { color: from, color2: dark(to, .6), width: u * .04, lead: .8, lag: .4, ease: 'in' });
        K.glow(S, ax, ay, u * .12, to, .5, .3, .7);
        K.ring(S, ax, ay, u * .16, to, .52, { th: .06, dur: .26 });
    });
    siphon('생명력 흡수', 'plant_a', [1, .25, .25], [.45, 1, .5], 1); siphon('마나 흡수', 'plant_b', [.6, .4, 1], [.4, .75, 1], 1.2);
    def(combat('골드 획득'), { impact: .06, sounds: ['coins_a', 'coins_b'] }, S => {
        // 대상에게서 튀어 오른 금화가 포물선을 그리며 주인에게 떨어진다.
        const u = unit(S), A = S.A, p = at(S);
        S.hit('coins_a', .06, { vol: v(S, .45), cool: 200 }); S.sfx('coins_b', .5, { vol: v(S, .3), cool: 200 });
        K.sparks(S, p.x, p.y, S.minor ? 4 : 8, C.gold, .04, { speed: .5 });
        S.burst({ x: p.x, y: p.y, n: S.minor ? 6 : 12, t: .06, cell: 'coin', add: .25, color: C.gold, color2: C.amber, radius: u * .05, life: [.36, .5], size: [u * .02, u * .032], grow: 1, grav: u * 3, spin: 16, over: .1, each: homing(A.x, A.y - u * .04, u * 3) });
        K.glow(S, A.x, A.y - u * .04, u * .1, C.gold, .5, .26, .6);
    });

    // ---- 움직임과 시간 ----
    def(combat('회피'), { impact: 0, sounds: ['air_puff'] }, S => {
        // 몸이 흐릿해지며 옆으로 비켜서고, 지나간 자리에 바람만 남는다.
        const u = unit(S), p = at(S), c = [.8, .9, 1];
        S.sfx('air_puff', 0, { vol: v(S, .5), cool: 120 });
        if (!S.minor) S.pose(who(S), {}, 0).to({ dx: S.U * .07, alpha: .45, rot: .08 }, .08, 'out3').wait(.1).to({ dx: 0, alpha: 1, rot: 0 }, .2, 'io').end();
        K.slash(S, p.x, p.y, u * .22, -2.2, 1, 0, .26, { color: c, color2: C.ash, flat: .3, w: .3, lead: .5 });
        for (let i = 0; i < 4; i++) S.shape('streak', { x: p.x - u * .1, y: p.y + (i - 1.5) * u * .09, w: u * .3, h: u * .008, color: c, alpha: .7, p0: .4, z: 2 }, i * .02).to({ x: p.x + u * .16, alpha: 0 }, .18, 'out').end();
        K.dust(S, p.x, ground(S), 4, [.5, .5, .56], 0, { flat: .3, speed: .3, angle: 0, spread: 1 });
    });
    def(combat('행동 가속'), { impact: 0, sounds: ['air_puff'] }, S => {
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx('air_puff', 0, { vol: v(S, .4), rate: 1.3, cool: 200 });
        for (let i = 0; i < 3; i++) [-1, 1].forEach(side => S.shape('streak', { x: p.x - u * .12 + i * u * .1, y: p.y + side * u * .045, w: u * .13, h: u * .026, rot: side * .7, color: c, alpha: 0, p0: .6, z: 3 }, i * .05).to({ alpha: .95 }, .04).with({ x: p.x + u * .06 + i * u * .1 }, .22, 'out3').to({ alpha: 0 }, .1).end());
        for (let i = 0; i < 5; i++) S.shape('streak', { x: p.x + u * .2, y: p.y + (S.rnd(i) - .5) * u * .4, w: u * .26, h: u * .007, color: c, alpha: .7, p0: .4, z: 2 }, .04 + i * .03).to({ x: p.x - u * .26, alpha: 0 }, .2, 'lin').end();
        if (!S.minor) S.pose(who(S), {}, .04).to({ rot: .08, dx: S.U * .015 }, .08, 'out').wait(.12).to({ rot: 0, dx: 0 }, .16).end();
    });
    def(combat('쿨타임 감소'), { impact: 0, sounds: ['tick', 'lock'] }, S => {
        // 시계판이 떠오르고 바늘이 거꾸로 감긴다.
        const u = unit(S), p = at(S), c = tint(S), y = p.y - u * .06;
        S.sfx('tick', 0, { vol: v(S, .4) }); S.sfx('tick', .12, { vol: v(S, .4), rate: 1.2, cool: 0 }); S.sfx('lock', .3, { vol: v(S, .3) });
        K.circle(S, p.x, y, u * .18, 0, .34, { color: c, flat: 1, sides: 12, spin: -5, z: 1, draw: .1 });
        [[u * .13, -TAU * 1.6], [u * .08, -TAU * .4]].forEach(([len, turn]) => S.shape('streak', { x: p.x, y, w: len * 2, h: u * .014, rot: -PI / 2, color: C.white, alpha: 0, p0: .3, z: 3 }).to({ alpha: .9 }, .06).with({ rot: -PI / 2 + turn }, .34, 'out3').to({ alpha: 0 }, .12).end());
        K.sparks(S, p.x, y, S.minor ? 4 : 8, c, .32, { speed: .4, grav: 0 });
    });
    def(combat('상태 해제'), { impact: 0, sounds: ['shimmer'] }, S => {
        // 흰 고리가 한 번 훑고 지나가면 몸에 붙은 어두운 것들이 떨어져 흩어진다.
        const u = unit(S), p = at(S);
        S.sfx('shimmer', 0, { vol: v(S, .4) });
        K.ring(S, p.x, p.y, u * .34, C.white, 0, { th: .08, dur: .34 });
        S.burst({ x: p.x, y: p.y, n: S.minor ? 6 : 14, t: .04, cell: 'smoke', add: 0, alpha: .6, color: [.4, .2, .6], color2: [.1, .04, .2], radius: u * .1, speed: [u * .2, u * .6], life: [.4, .7], size: [u * .04, u * .08], grow: 1.6, drag: 3 });
        K.embers(S, p.x, p.y, S.minor ? 5 : 10, C.white, .08, { cell: 'star', radius: u * .14, rise: .4, speed: .2, size: [u * .015, u * .04] });
    });
    def(combat('소환 해제'), { impact: 0, sounds: ['servo'] }, S => {
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx('servo', 0, { vol: v(S, .35), rate: .7 });
        K.smoke(S, p.x, p.y, u * .2, 0, .6, { color: c, color2: C.night, dense: .5, add: .4, lift: .5 });
        K.embers(S, p.x, p.y, S.minor ? 6 : 14, c, 0, { radius: u * .12, rise: .8, speed: .3, over: .2 });
        K.ring(S, p.x, p.y, u * .22, c, 0, { th: .06, dur: .3 });
    });
    def(combat('중첩 소모'), { impact: .06, sounds: ['gem'] }, S => {
        // 쌓아 둔 고리들이 한 점으로 내려앉아 터진다.
        const u = unit(S), p = at(S), c = tint(S);
        S.sfx('gem', 0, { vol: v(S, .4), rate: .8 });
        for (let i = 0; i < 3; i++) S.shape('ring', { x: p.x, y: p.y - u * (.1 + i * .08), w: u * .24, h: u * .07, color: c, alpha: .9, p0: .8, p1: .14, z: 2 }).to({ y: p.y, w: u * .05, h: u * .02 }, .06 + i * .015, 'in').to({ alpha: 0 }, .03).end();
        hit(S, p.x, p.y, .06, { power: .36, color: c });
    });

    // ---- 강화: 발밑에서 오르는 기운에 저마다의 무늬가 얹힌다 ----
    const BUFFS = {
        '버프': S => { const u = unit(S), p = at(S); for (let i = 0; i < 3; i++) chevron(S, p.x, p.y + u * (.08 - i * .1), u * .2, tint(S), i * .06, -u * .12, .26); },
        '공격력 강화': S => { const u = unit(S), p = at(S), g = ground(S); [-1, 0, 1].forEach(i => S.shape('streak', { x: p.x + i * u * .08, y: g, w: u * .04, h: u * .016, rot: -PI / 2, color: i ? [1, .5, .2] : [1, .85, .4], alpha: 0, p0: .25, z: 3 }, .04 + Math.abs(i) * .05).to({ alpha: 1, w: u * (.34 - Math.abs(i) * .08), y: g - u * (.3 - Math.abs(i) * .06) }, .16, 'out3').wait(.1).to({ alpha: 0, y: g - u * .4 }, .16).end()); },
        '치명타 확률 증가': S => { const u = unit(S), p = at(S), y = p.y - u * .28, c = [1, .35, .3]; for (let i = 0; i < 4; i++) { const a = i * PI / 2 + PI / 4; S.shape('flare', { x: p.x + Math.cos(a) * u * .16, y: y + Math.sin(a) * u * .12, w: u * .06, h: u * .06, color: c, p0: .03, z: 3 }, .04).to({ x: p.x, y }, .2, 'in').to({ alpha: 0 }, .04).end(); } K.flare(S, p.x, y, u * .12, c, .26, .2); },
        '치명타 피해 증가': S => { const u = unit(S), p = at(S), y = p.y - u * .28, c = [1, .3, .25]; K.rays(S, p.x, y, u * .26, .06, .4, { color: [1, .8, .6], color2: c, n: 6, sharp: .85, z: 3 }); K.flare(S, p.x, y, u * .1, c, .06, .24, .4); },
        '치명타 확정': S => { const u = unit(S), p = at(S), y = p.y - u * .28; S.field('reticle', { x: p.x, y, w: u * .4, h: u * .4, color: [1, .3, .25], color2: C.wine, p0: 1, p1: 5, alpha: 0, z: 3 }, .02).to({ alpha: .9, w: u * .2, h: u * .2, p0: 0 }, .16, 'in3').wait(.14).to({ alpha: 0 }, .14).end(); },
        '방어 관통 강화': S => { const u = unit(S), p = at(S), c = [.5, .8, 1]; S.shape('ring', { x: p.x + u * .08, y: p.y - u * .16, w: u * .16, h: u * .2, color: c, alpha: 0, p0: .8, p1: .14, z: 2 }, .02).to({ alpha: .9 }, .06).wait(.2).to({ alpha: 0, w: u * .3, h: u * .36 }, .16).end(); K.dart(S, p.x - u * .14, p.y + u * .1, p.x + u * .26, p.y - u * .38, .08, .2, { color: C.gold, color2: c, width: u * .05, lead: .6 }); },
        '속성 강화': S => { const u = unit(S), p = at(S), g = ground(S); [[C.fire, 0], [[.35, .75, 1], PI]].forEach(([tone, a]) => K.stroke(S, 'energy', path.helix(p.x, g, p.y - u * .34, u * .15, a, 1.4, .3), 0, .56, { color: tone, color2: dark(tone, .5), width: u * .045, lead: .7, lag: .45, trail: .5, props: { seg: 40 } })); },
        '중첩 획득': S => { const u = unit(S), p = at(S), c = tint(S); for (let i = 0; i < 3; i++) S.shape('ring', { x: p.x, y: p.y + u * .14, w: u * .1, h: u * .03, color: c, alpha: 0, p0: .8, p1: .14, z: 2 }, i * .07).to({ alpha: .95, y: p.y - u * (.06 + i * .09), w: u * .24, h: u * .07 }, .16, 'out3').wait(.16 - i * .04).to({ alpha: 0 }, .14).end(); }
    };
    [['버프', 'shimmer'], ['공격력 강화', 'cast_a'], ['치명타 확률 증가', 'cast_b'], ['치명타 피해 증가', 'cast_b'], ['치명타 확정', 'cast_a'], ['방어 관통 강화', 'cast_a'], ['속성 강화', 'shimmer'], ['중첩 획득', 'gem_b']]
        .forEach(([name, snd]) => def(combat(name), { impact: 0, sounds: [snd] }, S => {
            const u = unit(S), p = at(S), g = ground(S), c = tint(S);
            S.sfx(snd, 0, { vol: v(S, .35), cool: 250 });
            K.aura(S, p.x, g, u * .3, u * .6, 0, .6, { color: c, color2: dark(c, .7), alpha: .9 });
            K.ring(S, p.x, g, u * .24, c, 0, { flat: .3, dur: .36 });
            K.embers(S, p.x, g - u * .06, S.minor ? 4 : 9, c, .04, { radius: u * .12, flat: .4, rise: .6, speed: .3, over: .2 });
            BUFFS[name](S);
        }));

    // ---- 약화: 위에서 내리누르는 것들 ----
    const DEBUFFS = {
        '디버프': S => { const u = unit(S), p = at(S); for (let i = 0; i < 3; i++) chevron(S, p.x, p.y - u * (.24 - i * .1), u * .2, tint(S), i * .05, u * .12, .22); },
        '공격력 감소': S => { const u = unit(S), p = at(S), c = [1, .3, .3]; S.shape('streak', { x: p.x, y: p.y - u * .4, w: u * .3, h: u * .02, rot: PI / 2, color: c, alpha: 0, p0: .25, z: 3 }).to({ alpha: 1, y: p.y - u * .1 }, .12, 'in3').to({ alpha: 0 }, .05).end(); K.shards(S, p.x, p.y - u * .02, S.minor ? 4 : 8, c, .13, { add: .4, speed: .7, size: [u * .012, u * .026] }); },
        '방어력 감소': S => { const u = unit(S), p = at(S), c = [.7, .45, 1]; S.shape('hex', { x: p.x, y: p.y, w: u * .3, h: u * .36, color: c, alpha: .8, p0: 4, p1: .08, p2: .08, z: 2 }, .04).to({ alpha: 0, w: u * .36, h: u * .42 }, .2, 'out').end(); K.shards(S, p.x, p.y, S.minor ? 5 : 10, c, .13, { add: .4, speed: .8, spread: TAU }); },
        '받는 피해 증가': S => { const u = unit(S), p = at(S), c = [1, .2, .2]; K.crack(S, p.x, p.y, u * .22, .06, .2, { color: c, color2: C.wine, flat: 1, n: 7, z: 2, fade: .25 }); },
        'HP 봉인': S => { const u = unit(S), p = at(S), c = [1, .4, .4]; [-1, 1].forEach((side, i) => S.trail('chain', { path: path.line(p.x - side * u * .16, p.y - u * .18, p.x + side * u * .16, p.y + u * .18), head: 0, tail: 0, width: u * .045, taper: .04, seg: 14, color: c, color2: C.wine, p0: 10, p1: 0, p2: .01, add: .2 }, .03 + i * .05).to({ head: 1 }, .1, 'out3').wait(.2).to({ alpha: 0 }, .16).end()); },
        'MP 소모': S => { const u = unit(S), p = at(S), c = [.45, .6, 1]; S.burst({ x: p.x, y: p.y, n: S.minor ? 5 : 10, t: .06, cell: 'drop', add: .6, color: lite(c), color2: c, radius: u * .1, angle: -PI / 2, spread: .7, speed: [u * .4, u * .8], life: [.3, .55], size: [u * .012, u * .026], grav: -u * .4, drag: 2 }); S.field('vortex', { x: p.x, y: p.y, w: u * .1, h: u * .1, color: c, color2: C.deep, p0: 1.2, p1: 3, p2: -8, p3: 0, alpha: 0, z: 1 }, .04).to({ w: u * .36, h: u * .36, alpha: .7 }, .12, 'out3').to({ w: u * .1, h: u * .1, alpha: 0 }, .16, 'in').end(); }
    };
    [['디버프', 'growl'], ['공격력 감소', 'metal_a'], ['방어력 감소', 'glass_b'], ['받는 피해 증가', 'glass_a'], ['HP 봉인', 'chain_a'], ['MP 소모', 'bubble']]
        .forEach(([name, snd]) => def(combat(name), { impact: .13, sounds: [snd] }, S => {
            const u = unit(S), p = at(S), g = ground(S), c = tint(S);
            S.sfx(snd, .1, { vol: v(S, .36), cool: 250 });
            K.ring(S, p.x, g, u * .24, c, .1, { flat: .3, dur: .32 });
            S.burst({ x: p.x, y: p.y - u * .34, n: S.minor ? 4 : 9, t: 0, cell: 'spark', color: lite(c, .3), color2: c, radius: u * .14, flat: .2, angle: PI / 2, spread: .2, speed: [u * .9, u * 1.4], life: [.16, .26], size: [u * .012, u * .028], stretch: 1.2, over: .12 });
            if (!S.minor) S.pose(who(S), { flash: .25 }, .13).to({ flash: 0 }, .18).end();
            DEBUFFS[name](S);
        }));

    // ---- 소환수: 수나타의 음표 ----
    // 수나타의 사격과 익테봇의 사격은 companions.fire가 함께 그린다. 수나타 쪽에는 맞은 자리의 울림만 얹는다.
    def('summon:수나타 공격', { impact: .22, images: ['summon:수나타 공격', skill('수나타 소환')], sounds: ['boom_low', 'air_whoosh', 'holy_c'] }, S => {
        const u = S.U, T = S.T, c = [.72, .56, 1];
        companions.fire(S, '수나타');
        [0, .07].forEach((dt, i) => K.ring(S, T.x, T.y, u * (.2 + i * .1), c, .22 + dt, { th: .08, dur: .3 }));
        S.burst({ x: T.x, y: T.y, n: S.minor ? 4 : 8, t: .22, cell: 'note', color: C.white, color2: c, speed: [u * .2, u * .7], angle: -PI / 2, spread: 2.4, life: [.5, .9], size: [u * .03, u * .05], grow: .6, drag: 2, grav: -u * .2, spin: 3 });
    });
    def('summon:수나타 강화', { impact: 0, images: ['summon:수나타 강화', skill('수나타 소환')], sounds: ['holy_c'] }, S => {
        // 보랏빛 띠가 주인을 감아 오르고 음표가 따라 떠오른다.
        const u = S.U, A = S.A, g = S.gA, c = [.72, .56, 1];
        S.hit('holy_c', .2, { vol: v(S, .4) });
        [0, PI].forEach(a => K.stroke(S, 'energy', path.helix(A.x, g, A.y - u * .36, u * .17, a, 1.4, .3), 0, .6, { color: c, color2: C.night, width: u * .045, lead: .7, lag: .45, trail: .5, props: { seg: 40 } }));
        K.aura(S, A.x, g, u * .3, u * .6, .04, .6, { color: c, color2: C.night, alpha: .6 });
        S.burst({ x: A.x, y: g - u * .1, n: 8, t: .06, cell: 'note', color: C.white, color2: c, radius: u * .14, flat: .4, angle: -PI / 2, spread: .6, speed: [u * .3, u * .6], life: [.5, .9], size: [u * .028, u * .046], grow: .6, drag: 1.5, rot: 0, over: .3 });
        K.ring(S, A.x, g, u * .26, c, 0, { flat: .3, dur: .4 });
    });

    // ---- 장비와 세트의 발동 ----
    // 다른 타격에 얹혀 자주 나오므로 0.12초에 닿게 짧게 짠다.
    // 문장이 주인 어깨 위의 작은 진에서 맺힌다. 공격이면 그 빛이 대상에게 쏘아지고, 아니면 띠가 되어 주인에게 감겨 든다.
    function proc(S, o) {
        const q = o || {}, u = S.U, big = !!q.set, size = (big ? .3 : .2) * u, attack = S.role === 'target', slot = (S.seed | 0) % 3, color = tint(S);
        const x = S.A.x + (big ? -.04 : -.02 + slot * .085) * u, y = S.A.y - (big ? .36 : .3 + (slot % 2) * .06) * u;
        S.sfx(q.sound || (big ? 'shimmer' : 'gem'), 0, { vol: v(S, big ? .35 : .3), cool: 200 });
        K.circle(S, x, y, size * (big ? .78 : .66), 0, .26, { color, flat: 1, sides: big ? 8 : 4 + slot, spin: big ? 2 : 4, z: 0, draw: .1, alpha: .8 });
        M.gather(S, S.id, x, y, size, 0, { fx: S.A.x, fy: S.A.y - .05 * u, spread: size * .7, dur: .12, frac: .35 });
        const node = S.sprite({ x, y, size, sx: .4, sy: .4, alpha: 0, glow: .6, edge: color, z: 1 }, 0);
        node.to({ alpha: 1, sx: 1.1, sy: 1.1 }, .06, 'back').to({ sx: 1, sy: 1 }, .04).wait(q.hold == null ? .08 : q.hold);
        K.sparks(S, x, y, S.minor ? 4 : 8, color, .04, { speed: .4, grav: 0 });
        if (attack) {
            node.to({ alpha: 0, sx: .6, sy: .6, x: lerp(x, S.T.x, .2), y: lerp(y, S.T.y, .2) }, .1, 'in').end();
            K.dart(S, x, y, S.T.x, S.T.y, .02, .16, { color, width: size * (big ? .5 : .36), lead: .62 });
            if (big) K.dart(S, x, y, S.T.x, S.T.y, .03, .15, { color: C.white, color2: color, width: size * .16, lead: .62, lift: u * .08 });
            K.ring(S, S.T.x, S.T.y, u * (big ? .26 : .18), color, .12, { th: .12, dur: .26 });
            K.sparks(S, S.T.x, S.T.y, S.minor ? 6 : big ? 16 : 10, color, .12, { speed: .8 });
            K.glow(S, S.T.x, S.T.y, u * .07, C.white, .12, .16, .7);
        } else {
            node.to({ alpha: 0, sx: .5, sy: .5, y: S.A.y - .05 * u }, .16, 'in').end();
            [0, PI].slice(0, big ? 2 : 1).forEach(a => K.stroke(S, 'energy', path.helix(S.A.x, y, S.gA, u * .15, a, 1.2, .3), .1, .44, { color, width: u * .04, lead: .7, lag: .45, trail: .5, props: { seg: 36 } }));
            K.ring(S, S.A.x, S.gA, u * (big ? .3 : .22), color, .28, { flat: .3, dur: .34 });
            if (big) K.aura(S, S.A.x, S.gA, u * .3, u * .6, .24, .5, { color, alpha: .6 });
        }
        return node;
    }
    def('equipment:징수의 총', { impact: .12, sounds: ['gunshot', 'coins_b', 'lock'] }, S => {
        const u = S.U, x = S.A.x + .1 * u, y = S.A.y - .2 * u;
        proc(S, { sound: 'lock' });
        S.sfx('gunshot', .04, { vol: v(S, .5) }); S.sfx('coins_b', .16, { vol: v(S, .3) });
        K.flare(S, x, y, u * .1, [1, .9, .6], .04, .12);
        K.beam(S, x, y, S.T.x, S.T.y, u * .03, .04, .14, { color: [1, .9, .6], color2: C.amber, thick: .5, shoot: .05, fall: .08 });
        S.burst({ x: S.T.x, y: S.T.y, n: 5, t: .12, cell: 'coin', add: .25, color: C.gold, color2: C.amber, angle: -PI / 2, spread: 2, speed: [u * .3, u * .7], life: [.4, .7], size: [u * .018, u * .028], grow: 1, grav: u * 2.6, spin: 14 });
    });
    ['심판의 주사위', '운명의 주사위'].forEach(name => def('equipment:' + name, { impact: .12, sounds: ['dice'] }, S => { proc(S, { sound: 'dice', hold: .14 }).seek(0).to({ rot: TAU }, .22, 'out'); }));
    ['무한홀덤덱', '리턴즈파겜'].forEach(name => def('equipment:' + name, { impact: .12, sounds: ['card_a'] }, S => {
        const u = S.U; proc(S, { sound: 'card_a' });
        S.burst({ x: S.A.x, y: S.A.y - .3 * u, n: 4, t: .1, cell: 'card', add: 0, color: C.bone, speed: [u * .2, u * .5], angle: -PI / 2, spread: 2, life: [.4, .6], size: [u * .03, u * .045], grow: 1, grav: u * 1.6, spin: 12 });
    }));
    ['777 목걸이', '777 반지', '777 장갑', '777 팔찌', '메가카운트 추첨기', '행운의 복주머니', '교촌 주머니', '일레이나 전용 동전', '포상 정산 반지']
        .forEach(name => def('equipment:' + name, { impact: .12, sounds: ['coins_b'] }, S => {
            const u = S.U; proc(S, { sound: 'coins_b' });
            S.burst({ x: S.A.x, y: S.A.y - .3 * u, n: 5, t: .1, cell: 'coin', add: .25, color: C.gold, color2: C.amber, speed: [u * .2, u * .5], angle: -PI / 2, spread: 2, life: [.4, .6], size: [u * .016, u * .026], grow: 1, grav: u * 1.8, spin: 14 });
        }));
    ['결합 타이머', '모노레일 타이머', '십결모 타이머', '왓 타임 이즈 잇 나우', '쿨다운 목걸이', '존버의 미학']
        .forEach(name => def('equipment:' + name, { impact: .12, sounds: ['tick'] }, S => { proc(S, { sound: 'tick', hold: .14 }).seek(0).to({ rot: -TAU }, .22, 'out'); }));

    // 따로 적지 않은 이펙트는 종류에 맞는 연출로 그린다. 새 장비와 세트 그림은 코드 없이 나온다.
    const generic = new Map();
    const plain = S => {
        const u = unit(S), p = at(S), c = tint(S);
        if (S.role === 'actor') { K.aura(S, p.x, ground(S), u * .28, u * .56, 0, .6, { color: c, alpha: .6 }); K.ring(S, p.x, ground(S), u * .24, c, 0, { flat: .3, dur: .36 }); K.embers(S, p.x, p.y, 8, c, .04, { radius: u * .12, rise: .6, speed: .3 }); }
        else { K.dart(S, S.A.x + u * .08, S.A.y, p.x, p.y, 0, .14, { color: c, width: u * .07, lead: .6 }); hit(S, p.x, p.y, .08, { power: .4, color: c }); }
    };
    F.fallback(effectId => {
        if (generic.has(effectId)) return generic.get(effectId);
        const kind = String(effectId).split(':')[0];
        const definition = kind === 'equipment' ? { impact: .12, sounds: ['gem'], run: S => { proc(S, {}); } }
            : kind === 'set' ? { impact: .12, sounds: ['shimmer'], run: S => { proc(S, { set: true }); } }
            : kind === 'skill' ? { impact: .08, sounds: ['cast_a'], run: S => { S.sfx('cast_a', 0, { vol: v(S, .4) }); plain(S); } }
            : kind === 'combat' || kind === 'element' || kind === 'summon' ? { impact: .08, run: plain }
            : null;
        if (definition) generic.set(effectId, definition);
        return definition;
    });

    // ================= 동행 소환수 =================
    // 소환이 유지되는 동안 주인 곁에 떠 있다가, 공격과 피해 대행 사건이 오면 직접 움직인다.
    const registry = new WeakMap();
    const SPOT = { '익테봇': [.17, -.27, .36], '수나타': [-.16, -.3, .4] };
    const realX = (S, x) => S.scene.mirror ? 2 * S.scene.axis - x : x;
    const companions = {
        of(fx) { let map = registry.get(fx); if (!map) { map = new Map(); registry.set(fx, map); } return map; },
        // 이 장면의 point(화면상의 실제 위치)를 주인으로 둔 소환수를 찾는다.
        find(S, name, point) {
            const x = realX(S, point.x);
            for (const entry of companions.of(S.host).values()) if ((!name || entry.name === name) && entry.S && !entry.state.gone && Math.abs(entry.real - x) < S.U * .2) return entry;
            return null;
        },
        home(S, name) { const spot = SPOT[name], u = S.U; return { x: S.A.x + spot[0] * u, y: S.A.y + spot[1] * u }; },
        // 동행 장면은 오래 살아 있으므로, 나중에 만드는 노드는 지금 시각만큼 늦춰 태어나게 한다.
        late(entry) { return entry.S.host.time - entry.t0; },
        // 호스트가 상태를 받을 때마다 부른다. list: [{ name }]
        sync(fx, side, list, options) {
            if (!fx) return;
            const map = companions.of(fx), wanted = new Set((list || []).map(entry => entry && entry.name).filter(name => SPOT[name]));
            for (const [key, entry] of Array.from(map)) if (key.startsWith(side + ':') && !wanted.has(entry.name)) companions.leave(entry);
            wanted.forEach(name => {
                const key = side + ':' + name;
                if (map.has(key)) return;
                const entry = { name, key, map, nodes: [], state: { aim: 0, hide: 0, kick: 0, gone: false } };
                map.set(key, entry);
                const id = name === '익테봇' ? skill('익테봇 소환') : skill('수나타 소환');
                entry.handle = fx.persist(id, Object.assign({ images: [id] }, options), S => {
                    if (map.get(key) !== entry) return;
                    entry.S = S; entry.owner = { x: S.A.x, y: S.A.y }; entry.real = realX(S, S.A.x); entry.t0 = S.host.time;
                    (name === '익테봇' ? spawnBot : spawnSunata)(S, entry);
                });
            });
        },
        remove(entry) {
            entry.state.gone = true;
            entry.nodes.forEach(node => { node.dead = true; });
            if (entry.map.get(entry.key) === entry) entry.map.delete(entry.key);
        },
        leave(entry) {
            const S = entry.S;
            if (S && !entry.state.gone) {
                const p = entry.pos, t0 = companions.late(entry);
                M.rise(S, entry.bodyKey, p.x, p.y, entry.size, t0, { dur: .8, frac: .6 });
                S.shape('glow', { x: p.x, y: p.y, w: entry.size * .5, h: entry.size * .5, color: entry.color, alpha: .8, p0: 1.6, z: 2 }, t0).to({ alpha: 0, w: entry.size, h: entry.size }, .4).end();
            }
            companions.remove(entry);
        },
        // 주포를 쏜다. 곁에 없으면(다른 화면에서 온 사건 등) 잠깐 불러내서 쏜다.
        fire(S, name) {
            const entry = companions.find(S, name, S.A), u = S.U, bot = name === '익테봇', home = entry ? { x: S.A.x + (entry.pos.x - entry.owner.x), y: entry.pos.y } : companions.home(S, name);
            const c = bot ? [.35, .85, 1] : [.75, .5, 1], x = S.T.x, y = S.T.y, t = bot ? .2 : .22;
            // 시각은 이 장면이 시작하는 때(S.t0) 기준이다. 장면이 미뤄지면 소환수의 조준과 반동도 함께 미뤄진다.
            if (entry) { entry.state.aim = S.t0 + .55; entry.state.kick = S.t0 + t - .04; }
            else {
                const id = bot ? skill('익테봇 소환') : skill('수나타 소환');
                S.part(bot ? 'bot' : 'sunata', { x: home.x, y: home.y, size: SPOT[name][2] * u, alpha: 0, glow: .4, edge: c, z: 2 }, 0, id).to({ alpha: 1 }, .1).wait(.5).to({ alpha: 0, dis: 1 }, .3).end();
            }
            const mx = home.x + (bot ? .03 : .06) * u, my = home.y + (bot ? .03 : 0) * u, ang = Math.atan2(y - my, x - mx), dist = Math.hypot(x - mx, y - my);
            S.shape('glow', { x: mx, y: my, w: .02 * u, h: .02 * u, color: c, alpha: 1, p0: 1.4, z: 3 }).to({ w: .14 * u, h: .14 * u }, t - .04, 'in').to({ alpha: 0, w: .3 * u, h: .3 * u }, .14).end();
            if (bot) {
                S.sfx('servo', 0, { vol: v(S, .3), rate: 1.4 }); S.hit('laser_a', t, { vol: v(S, .6) }); S.sfx('zap_big', t, { vol: v(S, .4) });
                // 그림 속 광선 조각을 포구에서 대상까지 늘여 쏜다.
                const native = .44, length = 258 / 512, size = .5 * u;
                const beam = S.part('beam', { x: mx, y: my, size, rot: ang - native, sx: dist / (size * length) * .95, sy: .75, ang: native, head: 0, soft: .12, glow: .7, edge: c, z: 2 }, t - .05, 'summon:익테봇 공격');
                beam.to({ head: 1.4 }, .07, 'out').wait(.1).to({ tail: 1.45, sy: .3 }, .16, 'in').end();
                P.line(S, mx, my, x, y, .022 * u, [.8, 1, 1], t - .04, .22, { from: .05, sharp: .6 });
                S.shape('hex', { x, y, w: .05 * u, h: .05 * u, color: c, alpha: .9, p0: 3, p1: .1, p2: .1, z: 3 }, t).to({ w: .3 * u, h: .3 * u, alpha: 0 }, .3, 'out3').end();
            } else {
                S.sfx('air_whoosh', 0, { vol: v(S, .35) }); S.sfx('boom_low', t - .22, { vol: v(S, .65), rate: 1.3 }); S.sfx('bell_b', t, { vol: v(S, .22), rate: .6 });
                // 음파: 겹겹의 호가 퍼져 나가고 그 뒤를 그림 속 음파 조각이 따른다.
                S.shape('sonic', { x: mx + Math.cos(ang) * dist * .5, y: my + Math.sin(ang) * dist * .5, w: dist * 1.2, h: dist * .9, rot: ang, color: c, alpha: 0, p0: 0, p1: .5, p2: 26, z: 1 }, t - .14)
                    .tick((p, tt) => { p.p0 = tt * 40; }).to({ alpha: .8 }, .08).wait(.14).to({ alpha: 0 }, .2).end();
                const native = .08, length = 300 / 512, size = .52 * u;
                const cone = S.part('cone', { x: mx, y: my, size, rot: ang - native, sx: dist / (size * length) * .9, ang: native, head: 0, soft: .16, glow: .6, edge: c, flow: .014, fvx: -2, fvy: 0, z: 2 }, t - .12, 'summon:수나타 공격');
                cone.to({ head: 1.4 }, .14, 'out').wait(.08).to({ tail: 1.45 }, .2, 'in').end();
            }
            strike(S, x, y, t, { power: .6, color: c });
        },
        // 봇이 주인 앞으로 끼어들어 방벽으로 받아낸다. 이 장면에서는 맞는 쪽(T)이 봇의 주인이다.
        guard(S) {
            const entry = companions.find(S, '익테봇', S.T), u = S.U, c = [.4, .85, 1];
            const x = S.T.x - .2 * u, y = S.T.y - .02 * u;
            if (entry) { entry.state.block = { x: entry.owner.x + .24 * u, y: entry.owner.y - .02 * u, until: S.t0 + .5 }; entry.state.hide = S.t0 + .5; }
            S.sfx('servo', 0, { vol: v(S, .3), rate: 1.6 }); S.sfx('metal_b', .1, { vol: v(S, .6) }); S.sfx('field', .08, { vol: v(S, .4), rate: 1.3 });
            const n = S.sprite({ x, y, size: .44 * u * k(S), mode: 1, center: [.44, .49], head: 0, soft: .2, sx: .8, sy: .8, glow: .6, edge: c, z: 2 }, .06);
            n.to({ head: 1.8, sx: 1.05, sy: 1.05 }, .1, 'out3').set({ flash: .6 }).to({ flash: 0, sx: 1, sy: 1, x: x + .02 * u }, .1).wait(.16).to({ dis: 1 }, .26, 'in').end();
            S.shape('hex', { x: x + .03 * u, y, w: .2 * u, h: .3 * u, color: c, alpha: 0, p0: 5, p1: .08, p2: .08, z: 3 }, .06).to({ alpha: .9, w: .3 * u, h: .42 * u }, .08, 'out').to({ alpha: 0 }, .3).end();
            P.sparks(S, x - .06 * u, y, 10, [1, .4, .3], .12, { cone: PI, spread: 1.6, dist: .24 });
            if (!S.minor) { S.shake(7, .2, .12); S.stop(45, .12); }
        },
        // 자폭: 시전자 곁의 소환수들이 대상에게 날아가 사라진다. 날아간 것이 있으면 true.
        detonate(S, t) {
            let any = false;
            const x = realX(S, S.A.x);
            for (const entry of companions.of(S.host).values()) {
                if (!entry.S || entry.state.gone || Math.abs(entry.real - x) > S.U * .2) continue;
                any = true;
                entry.state.dive = { x: entry.owner.x + (S.T.x - S.A.x), y: S.T.y, from: S.t0 + t - .22, until: S.t0 + t };
            }
            return any;
        }
    };
    // 곁에 떠 있는 동안의 공통 움직임: 끄덕임, 사격 반동, 끼어들기, 돌진.
    function drift(entry, S, home, now, bob) {
        const state = entry.state, u = S.U, t = now;
        let x = home.x + Math.sin(t * 1.1 + bob) * .008 * u, y = home.y + Math.sin(t * 2.1 + bob) * .014 * u, alpha = 1, scale = 1;
        if (state.kick && t > state.kick && t < state.kick + .3) { const q = (t - state.kick) / .3; x -= Math.sin(q * PI) * .035 * u; }
        if (state.block && t < state.block.until) { const q = clamp(1 - (state.block.until - t) / .5), s = q < .2 ? q / .2 : q > .7 ? 1 - (q - .7) / .3 : 1; x = lerp(x, state.block.x, s); y = lerp(y, state.block.y, s); }
        if (t < state.hide) alpha = clamp(Math.abs((state.hide - t) / .5 - .5) * 4 - 1);
        if (state.dive) {
            const q = clamp((t - state.dive.from) / (state.dive.until - state.dive.from));
            if (q > 0) { x = lerp(x, state.dive.x, q * q); y = lerp(y, state.dive.y, q * q) - Math.sin(q * PI) * .08 * u; scale = 1 + q * .3; }
            if (q >= 1) { alpha = 0; if (!state.gone) companions.remove(entry); }
        }
        entry.pos = { x, y };
        return { x, y, alpha, scale };
    }
    function spawnBot(S, entry) {
        const u = S.U, id = skill('익테봇 소환'), size = SPOT['익테봇'][2] * u, home = companions.home(S, '익테봇'), c = [.35, .85, 1], born = S.host.time;
        entry.size = size; entry.color = c; entry.bodyKey = { id, part: 'bot' }; entry.pos = home;
        M.gather(S, entry.bodyKey, home.x, home.y, size, 0, { fx: home.x, fy: S.gA, spread: size * .5, dur: .5, frac: .8 });
        const jet = S.shape('glow', { x: home.x, y: home.y, w: size * .34, h: size * .2, color: c, alpha: 0, p0: 1.8, keep: true, z: 1 });
        jet.tick((p, t) => { const d = entry.draw; if (!d) return; p.x = d.x; p.y = d.y + size * .17; p.alpha = d.alpha * (.5 + .2 * Math.sin(t * 9)) * clamp((t - .3) / .2); });
        const body = S.part('bot', { x: home.x, y: home.y, size, alpha: 0, glow: .25, edge: c, keep: true, z: 2 }, 0, id);
        body.tick(p => {
            const now = S.host.time, d = entry.draw = drift(entry, S, home, now, 0), intro = clamp((now - born - .28) / .22);
            p.x = d.x; p.y = d.y; p.alpha = d.alpha * intro; p.sx = p.sy = d.scale * (.7 + .3 * intro);
            p.rot = Math.sin(now * 1.3) * .06 + (now < entry.state.aim ? .16 : 0); p.flash = now > entry.state.kick && now < entry.state.kick + .08 ? .5 : 0;
        });
        entry.nodes.push(jet, body);
        // 날개 넷이 봇을 타원으로 돈다. 조준할 때는 포구 앞에 모인다.
        for (let i = 0; i < 4; i++) {
            const drone = S.part('d' + i, { x: home.x, y: home.y, size: size * .8, alpha: 0, keep: true, z: 2 }, 0, id);
            let aimed = 0;
            drone.tick(p => {
                const now = S.host.time, d = entry.draw; if (!d) return;
                const a = now * 1.5 + i * PI / 2, intro = clamp((now - born - .36 - i * .05) / .2);
                aimed += ((now < entry.state.aim ? 1 : 0) - aimed) * .2;
                const ox = lerp(Math.cos(a) * size * .44, size * (.26 + (i % 2) * .06), aimed), oy = lerp(Math.sin(a) * size * .15 + size * .05, (i - 1.5) * size * .09, aimed);
                p.x = d.x + ox * d.scale; p.y = d.y + oy * d.scale; p.alpha = d.alpha * intro; p.rot = lerp(Math.sin(a) * .5, [-1.2, -.5, .5, 1.2][i], aimed); p.z = Math.sin(a) > 0 || aimed > .5 ? 3 : 1;
            });
            entry.nodes.push(drone);
        }
    }
    function spawnSunata(S, entry) {
        const u = S.U, id = skill('수나타 소환'), size = SPOT['수나타'][2] * u, home = companions.home(S, '수나타'), c = [.75, .5, 1], born = S.host.time;
        entry.size = size; entry.color = c; entry.bodyKey = { id, part: 'sunata' }; entry.pos = home;
        M.gather(S, entry.bodyKey, home.x, home.y, size, 0, { fx: home.x, fy: S.gA, spread: size * .5, dur: .55, frac: .8 });
        const body = S.part('sunata', { x: home.x, y: home.y, size, alpha: 0, glow: .3, edge: c, flow: .006, fvy: -.5, keep: true, z: 2 }, 0, id);
        body.tick(p => {
            const now = S.host.time, d = entry.draw = drift(entry, S, home, now, 2), intro = clamp((now - born - .3) / .25);
            p.x = d.x; p.y = d.y; p.alpha = d.alpha * intro; p.rot = Math.sin(now * .9) * .05;
            const beat = now < entry.state.aim ? 1 + Math.sin((entry.state.aim - now) * 30) * .04 : 1;
            p.sx = p.sy = d.scale * beat * (.7 + .3 * intro);
        });
        // 박자에 맞춰 발밑으로 번지는 음의 고리.
        const pulse = S.shape('ring', { x: home.x, y: home.y, w: size * .3, h: size * .08, color: c, alpha: 0, p0: .8, p1: .14, keep: true, z: 1 });
        pulse.tick((p, t) => {
            const d = entry.draw; if (!d) return; const q = (t * .9) % 1;
            p.x = d.x; p.y = d.y + size * .42; p.w = size * (.2 + q * .5); p.h = p.w * .26; p.alpha = d.alpha * (1 - q) * .55 * clamp((t - .4) / .2);
        });
        entry.nodes.push(body, pulse);
    }
    F.companions = companions.sync;
    F.archetypes = { pop };
    // 스킬 장면집(combat-fx-skills.js)이 같은 도우미로 장면을 등록한다.
    F.props = P; F.matter = M; F.strike = strike; F.sceneDef = def;
    // 자주 쓰는 소리. 호스트가 전투 화면에 들어올 때 미리 받는다.
    F.commonSounds = ['swish_a', 'swish_b', 'swish_c', 'slash_c', 'punch_m', 'punch_c', 'glass_a', 'gem', 'shimmer', 'field', 'heal_a', 'heal_b', 'fire_a', 'holy_b', 'earth_b', 'splash', 'metal_ring', 'air_puff'];
})(typeof globalThis != 'undefined' ? globalThis : this);
