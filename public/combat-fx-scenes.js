// 전투 연출 장면집. 이펙트 하나마다 무대 위에서 벌어지는 일을 적는다.
// 모든 장면은 왼쪽의 시전자(A)가 오른쪽의 대상(T)을 치는 방향으로 쓰고, 반대 방향은 엔진이 뒤집어 그린다.
(function (root) {
    'use strict';
    const F = typeof module == 'object' && module.exports ? require('./combat-fx.js') : root.CombatFX;
    if (!F) return;
    const PI = Math.PI, TAU = PI * 2;
    // 실시간 재료(리본, 입자, 절차 셰이더). 원형들이 그림 위에 덧입혀 쓴다. 처형박수와 익테봇 계열이 쓰는 함수에는 넣지 않는다.
    const K = F.kit || null;
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

    // ---- 그림을 움직이는 원형들 ----
    // 머리가 대상에 꽂히도록 날아가는 그림. 가는 동안 앞에서부터 그려지고, 맞은 뒤 꼬리부터 지워진다.
    function sweep(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .46) * u * k(S), T = q.t || .2, native = q.native || 0;
        const a = { x: S.A.x + (q.dx == null ? .1 : q.dx) * u, y: S.A.y + (q.dy == null ? -.02 : q.dy) * u }, b = { x: S.T.x + (q.tx || 0) * u, y: S.T.y + (q.ty || 0) * u };
        const rot = Math.atan2(b.y - a.y, b.x - a.x) - (q.flip < 0 ? PI - native : native), lift = (q.lift || 0) * u, color = q.color || S.color();
        const node = S.sprite({ x: a.x, y: a.y, size, rot, flip: q.flip || 1, pivot: q.head || [.86, .5], ang: native, head: .02, soft: .14, flow: q.flow == null ? .012 : q.flow, ff: 4, fvx: -1.6, fvy: 0, glow: q.glow == null ? .5 : q.glow, edge: color, z: 1 }, q.t0);
        node.to({ x: b.x }, T, q.ease || 'in').with({ head: 1.4 }, T * .85, 'out')
            .tick((p, t) => { const s = clamp(t / T); p.y = lerp(a.y, b.y, s * s) - Math.sin(s * PI) * lift; if (q.spin) p.rot = rot + q.spin * (1 - s); });
        node.set({ flash: .8 }).to({ flash: 0, x: b.x + (q.follow == null ? .05 : q.follow) * u, sx: 1.1, sy: 1.1 }, .1, 'out').with({ tail: 1.5 }, q.fade || .26, 'in').end();
        const t = (q.t0 || 0) + T;
        strike(S, b.x, b.y, t, { power: q.power, color, zoom: q.zoom });
        if (q.shatter !== false) M.shatter(S, S.id, b.x, b.y, size * .8, t, { fx: b.x - size * .3, fy: b.y, spread: size * .55, dur: .55, frac: .45 });
        return node;
    }
    // 땅에서 솟는 그림.
    function erupt(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .5) * u * k(S), x = q.x == null ? at(S).x : q.x, y = q.y == null ? ground(S) : q.y, T = q.t || .14, color = q.color || S.color();
        const node = S.sprite({ x, y, size, pivot: q.pivot || [.5, .94], ang: -PI / 2, head: 0, soft: .12, sy: .35, sx: 1.18, flow: q.flow == null ? .014 : q.flow, fvx: 0, fvy: -1.7, glow: q.glow == null ? .55 : q.glow, edge: color, z: 1 }, q.t0);
        node.to({ head: 1.4, sy: 1.12, sx: .95 }, T + .06, 'out3').to({ sy: 1, sx: 1 }, .18, 'io').wait(q.hold == null ? .25 : q.hold).to({ tail: 1.45 }, q.fade || .34, 'in').end();
        const t = (q.t0 || 0) + T * .6;
        P.decal(S, x, y, size * .42, color, q.t0, .3);
        if (q.debris !== false) P.debris(S, x, y - size * .05, q.debris || 8, q.rock || [.2, .12, .1], t, { speed: .8 });
        P.sparks(S, x, y - size * .1, 8, color, t, { cone: -PI / 2, spread: 1.6, dist: .28 });
        if (!S.minor) { S.shake(q.shake || 8, .28, t); if (q.stop) S.stop(q.stop, t); }
        if (K) { K.sparks(S, x, y - size * .08, S.minor ? 5 : 12, color, t, { angle: -PI / 2, spread: 1.5, speed: .9 }); K.embers(S, x, y - size * .3, S.minor ? 4 : 10, color, t + .05, { radius: size * .2, rise: .5, speed: .3 }); K.dust(S, x, y, 4, [.32, .28, .26], t, { flat: .3, radius: size * .2, speed: .25 }); }
        return node;
    }
    // 하늘에서 내리꽂히는 그림.
    function drop(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .52) * u * k(S), x = q.x == null ? at(S).x : q.x, y = q.y == null ? ground(S) : q.y, T = q.t || .18, color = q.color || S.color();
        const node = S.sprite({ x, y: y - (q.height || .7) * u, size, pivot: q.pivot || [.5, .94], ang: PI / 2, head: .1, soft: .16, sy: 1.5, sx: .85, flow: q.flow == null ? .01 : q.flow, fvx: 0, fvy: 1.2, glow: .55, edge: color, z: 1 }, q.t0);
        node.to({ y, head: 1.45, sy: 1.25 }, T, 'in').to({ sy: .8, sx: 1.16, flash: .7 }, .05, 'out').to({ sy: 1, sx: 1, flash: 0 }, .22, 'elastic').wait(q.hold == null ? .22 : q.hold).to({ dis: 1 }, q.fade || .34, 'in').end();
        const t = (q.t0 || 0) + T;
        P.beam(S, x, y - size * .5, size * 1.1, size * .22, color, (q.t0 || 0) + T * .4, .1);
        strike(S, x, y - size * .1, t, { power: q.power == null ? .75 : q.power, color, zoom: q.zoom });
        P.decal(S, x, y, size * .46, color, t, .3);
        if (q.debris !== false) P.debris(S, x, y, q.debris || 9, q.rock || [.2, .12, .1], t);
        if (K) { K.ring(S, x, y, size * .5, color, t, { flat: .3, dur: .4 }); K.sparks(S, x, y - size * .1, S.minor ? 6 : 14, color, t, { angle: -PI / 2, spread: 2.4, speed: 1 }); }
        return node;
    }
    // 한 점에서 터져 나오는 그림. 중심부터 드러나고 중심부터 비어 나간다.
    function pop(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .46) * u * k(S), p = at(S), x = q.x == null ? p.x : q.x, y = q.y == null ? p.y : q.y, color = q.color || S.color();
        const node = S.sprite({ x, y, size, mode: 1, head: 0, soft: .22, sx: .5, sy: .5, rot: q.rot == null ? -.3 : q.rot, flow: q.flow == null ? .01 : q.flow, fvx: 0, fvy: -.4, glow: q.glow == null ? .6 : q.glow, edge: color, center: q.center, swirl: q.swirl || 0, z: 1 }, q.t0);
        node.to({ head: 1.8, sx: 1.08, sy: 1.08, rot: 0 }, q.t || .16, 'out3').with({ swirl: 0 }, (q.t || .16) * 2.2, 'out').to({ sx: 1, sy: 1 }, .12, 'io').wait(q.hold == null ? .16 : q.hold).to({ tail: 1.8, sx: 1.16, sy: 1.16 }, q.fade || .3, 'in').end();
        if (q.strike !== false) strike(S, x, y, (q.t0 || 0) + .03, { power: q.power == null ? .55 : q.power, color, zoom: q.zoom });
        return node;
    }
    // 긋는 그림. 칼날 방향으로 순식간에 그려진다.
    function cut(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .44) * u * k(S), p = at(S), x = q.x == null ? p.x : q.x, y = q.y == null ? p.y : q.y, native = q.native == null ? -.6 : q.native, color = q.color || S.color(), t0 = q.t0 || 0;
        const node = S.sprite({ x, y, size, flip: q.flip || 1, rot: q.rot || 0, ang: native, head: 0, soft: .1, chroma: .014, flash: .5, glow: .6, edge: color, z: 1 }, t0);
        node.to({ head: 1.45, flash: 0 }, q.t || .09, 'out').with({ chroma: 0 }, .22).wait(q.hold == null ? .1 : q.hold).to({ tail: 1.45 }, q.fade || .2, 'in').end();
        const dir = (q.flip < 0 ? PI - native : native) + (q.rot || 0), dx = Math.cos(dir) * size * .62, dy = Math.sin(dir) * size * .62;
        P.line(S, x - dx, y - dy, x + dx, y + dy, u * .012, [1, 1, 1], t0, .16, { from: .1, sharp: 1.4 });
        P.sparks(S, x, y, 7, color, t0 + .04, { cone: dir, spread: .7, dist: .26 });
        if (!S.minor) { S.shake(q.shake || 6, .16, t0 + .04); if (q.stop !== 0) S.stop(q.stop || 45, t0 + .05); }
        // 칼끝이 지나간 자리에 참격의 궤적이 남고, 벤 방향으로 불티가 튄다.
        if (K) { K.dart(S, x - dx * 1.25, y - dy * 1.25, x + dx * 1.25, y + dy * 1.25, t0, .22, { kind: 'slash', color, width: size * .2, lead: .4, lag: .34, ease: 'out3', props: { taper: .5 } }); K.sparks(S, x, y, S.minor ? 5 : 10, color, t0 + .04, { angle: dir, spread: .9, speed: 1 }); }
        return node;
    }
    // 발밑에서 감겨 오르는 기운. 시전자를 가리지 않도록 옅고 짧다.
    function rise(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .38) * u * k(S), x = q.x == null ? at(S).x : q.x, y = q.y == null ? ground(S) : q.y, color = q.color || S.color(), t0 = q.t0 || 0;
        const node = S.sprite({ x, y, size, pivot: [.5, .95], ang: -PI / 2, head: 0, soft: .2, alpha: q.alpha || .9, flow: .012, fvx: 0, fvy: -1.3, glow: .5, edge: color, z: 1 }, t0);
        node.to({ head: 1.45 }, .28, 'out').wait(q.hold == null ? .26 : q.hold).to({ tail: 1.45, y: y - size * .12 }, .4, 'in').end();
        P.decal(S, x, y, size * .4, color, t0, .34, { alpha: .65 });
        M.rise(S, S.id, x, y - size * .45, size, t0 + .12, { dur: .85 });
        if (K) { K.aura(S, x, y, size * .7, size * 1.2, t0, .7, { color, alpha: .6 }); K.embers(S, x, y - size * .1, S.minor ? 5 : 12, color, t0 + .05, { radius: size * .25, flat: .4, rise: .6, speed: .3, over: .3 }); }
        return node;
    }
    // 대상에 찍히는 낙인. 크게 내려와 박히고 잠시 남는다.
    function stamp(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .36) * u * k(S), p = at(S), x = q.x == null ? p.x : q.x, y = q.y == null ? p.y : q.y, color = q.color || S.color(), t0 = q.t0 || 0, T = q.t || .13;
        const node = S.sprite({ x, y, size, sx: 2.1, sy: 2.1, rot: q.rot == null ? -.7 : q.rot, alpha: 0, glow: .45, edge: color, z: 1 }, t0);
        node.to({ sx: 1, sy: 1, rot: 0, alpha: 1 }, T, 'in3').set({ flash: .8 }).to({ flash: 0, sx: 1.07, sy: 1.07 }, .07).to({ sx: 1, sy: 1 }, .1).wait(q.hold == null ? .4 : q.hold).to({ dis: 1 }, .36, 'in').end();
        P.ring(S, x, y, size * .55, color, t0 + T, { th: .12 });
        P.sparks(S, x, y, 8, color, t0 + T, { dist: .18 });
        if (!S.minor) S.shake(5, .16, t0 + T);
        if (K) { K.ring(S, x, y, size * .6, color, t0 + T, { dur: .3 }); K.sparks(S, x, y, S.minor ? 5 : 10, color, t0 + T, { speed: .7 }); }
        return node;
    }
    // 소용돌이 그림. 안쪽이 더 빨리 감겼다가 풀린다.
    function vortex(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .44) * u * k(S), p = at(S), x = q.x == null ? p.x : q.x, y = q.y == null ? p.y : q.y, t0 = q.t0 || 0;
        const node = S.sprite({ x, y, size, mode: 1, head: 0, soft: .25, sx: .6, sy: .6, swirl: q.swirl || 4, rot: q.rot || -1.2, glow: .55, edge: S.color(), flow: .008, z: 1 }, t0);
        node.to({ head: 1.8, sx: 1, sy: 1, swirl: 0, rot: 0 }, q.t || .42, 'out3').wait(q.hold == null ? .12 : q.hold).to({ swirl: -(q.swirl || 4) * .7, tail: 1.8, rot: .8, sx: 1.12, sy: 1.12 }, q.fade || .34, 'in').end();
        return node;
    }
    // 몸을 감싸는 막.
    function ward(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .42) * u * k(S), p = at(S), x = q.x == null ? p.x : q.x, y = q.y == null ? p.y : q.y, color = q.color || S.color(), t0 = q.t0 || 0;
        S.shape('hex', { x, y, w: size * .2, h: size * .24, color, alpha: 0, p0: 5, p1: .07, p2: .05, z: 2 }, t0).to({ w: size * .86, h: size, alpha: .8 }, .16, 'back').wait(q.hold == null ? .3 : q.hold).to({ alpha: 0, w: size * .95, h: size * 1.1 }, .3, 'out');
        const node = S.sprite({ x, y, size, mode: 1, head: 0, soft: .22, sx: .7, sy: .7, glow: .5, edge: color, alpha: .95, z: 1 }, t0);
        node.to({ head: 1.8, sx: 1.04, sy: 1.04 }, .18, 'back').to({ sx: 1, sy: 1 }, .1).wait(q.hold == null ? .28 : q.hold).to({ dis: 1 }, .32, 'in').end();
        P.ring(S, x, y, size * .5, color, t0 + .05, { th: .1 });
        return node;
    }
    // 장비가 발동하는 순간. 문장이 주인 어깨 위에 맺혔다가, 공격이면 대상으로 쏟아지고 아니면 주인에게 스민다.
    function emblem(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .22) * u, attack = S.role === 'target', slot = (S.seed | 0) % 3, color = S.color();
        const x = S.A.x + (-.02 + slot * .085) * u, y = S.A.y - (.3 + (slot % 2) * .06) * u, t0 = q.t0 || 0;
        M.gather(S, S.id, x, y, size, t0, { fx: S.A.x, fy: S.A.y - .05 * u, spread: size * .7, dur: .26, frac: .35 });
        const node = S.sprite({ x, y, size, sx: .4, sy: .4, alpha: 0, glow: .6, edge: color, mode: 1, head: 0, soft: .25, z: 1 }, t0 + .12);
        node.to({ alpha: 1, sx: 1.12, sy: 1.12, head: 1.8 }, .14, 'out3').to({ sx: 1, sy: 1 }, .1, 'io').wait(q.hold == null ? .2 : q.hold);
        P.ring(S, x, y, size * .5, color, t0 + .2, { th: .1, alpha: .7 });
        const t = t0 + .12 + .24 + (q.hold == null ? .2 : q.hold);
        if (attack) {
            node.to({ sx: .5, sy: .5, alpha: 0 }, .16, 'in').end();
            M.stream(S, S.id, x, y, size, S.T.x, S.T.y, t - .05, { dur: .4, frac: .4 });
            P.ring(S, S.T.x, S.T.y, u * .11, color, t + .28, { th: .18 });
            P.sparks(S, S.T.x, S.T.y, 7, color, t + .28, { dist: .16 });
            P.glow(S, S.T.x, S.T.y, u * .1, color, t + .28, .22, .8);
        } else {
            node.to({ y: S.A.y - .1 * u, sx: .45, sy: .45, alpha: 0 }, .26, 'in').end();
            P.glow(S, S.A.x, S.A.y - .08 * u, u * .14, color, t + .2, .3, .55);
        }
        S.sfx(q.sound || 'gem', t0 + .12, { vol: .22, cool: 160 });
        return node;
    }
    // 세트 효과. 주인 뒤에 큰 문장이 한 번 떠오른다.
    function crest(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .5) * u * k(S), x = S.A.x, y = S.A.y - .06 * u, color = S.color(), t0 = q.t0 || 0;
        const node = S.sprite({ x, y, size, mode: 1, head: 0, soft: .25, sx: .8, sy: .8, alpha: .85, glow: .5, edge: color, rot: -.12, flow: .008, z: 0 }, t0);
        node.to({ head: 1.8, sx: 1, sy: 1, rot: 0 }, .26, 'out3').wait(.3).to({ tail: 1.8, sx: 1.1, sy: 1.1 }, .36, 'in').end();
        P.ring(S, x, y, size * .56, color, t0 + .06, { th: .08, dur: .5 });
        M.rise(S, S.id, x, y, size, t0 + .2, { dur: .8, frac: .22 });
        S.sfx('shimmer', t0, { vol: v(S, .3), cool: 400 });
        if (S.role === 'target') { M.stream(S, S.id, x, y, size * .8, S.T.x, S.T.y, t0 + .34, { dur: .4, frac: .3 }); P.ring(S, S.T.x, S.T.y, u * .13, color, t0 + .64, { th: .18 }); P.sparks(S, S.T.x, S.T.y, 8, color, t0 + .64); }
        return node;
    }
    // 대상에게서 빨려 나와 시전자에게 흘러드는 기운.
    function drain(S, o) {
        const q = o || {}, u = S.U, size = (q.size || .34) * u * k(S), color = q.color || S.color(), t0 = q.t0 || 0;
        const node = S.sprite({ x: S.T.x, y: S.T.y, size, mode: 1, head: 0, soft: .22, sx: .7, sy: .7, glow: .5, edge: color, z: 1 }, t0);
        node.to({ head: 1.8, sx: 1, sy: 1 }, .16, 'out3').wait(.08).to({ dis: 1, sx: .8, sy: .8 }, .3, 'in').end();
        M.stream(S, S.id, S.T.x, S.T.y, size, S.A.x, S.A.y - .04 * u, t0 + .12, { dur: .62, frac: .6 });
        P.glow(S, S.A.x, S.A.y - .04 * u, u * .16, color, t0 + .55, .4, .7);
        P.ring(S, S.A.x, S.A.y - .04 * u, u * .12, color, t0 + .6, { th: .12, alpha: .6 });
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
    def('summon:수나타 공격', { impact: .22, images: ['summon:수나타 공격', skill('수나타 소환')], sounds: ['boom_low', 'air_whoosh', 'bell_b'] }, S => { companions.fire(S, '수나타'); });
    def('summon:수나타 강화', { impact: 0, images: ['summon:수나타 강화', skill('수나타 소환')], sounds: ['holy_c'] }, S => {
        const home = companions.home(S, '수나타');
        S.hit('holy_c', .2, { vol: v(S, .4) });
        rise(S, { x: home.x, y: home.y + .16 * S.U, size: .4 });
        P.glow(S, S.A.x, S.A.y, .18 * S.U, S.color(), .3, .4, .5);
    });

    // ================= 속성 =================
    def('element:화', { impact: .06, sounds: ['fire_a'] }, S => { S.hit('fire_a', .08, { vol: v(S, .4), cool: 180 }); cut(S, { size: .4, native: -.5, stop: 0, shake: 3 }); M.rise(S, S.id, S.T.x, S.T.y, .3 * S.U, .08, { dur: .6, frac: .3 }); });
    def('element:수', { impact: .06, sounds: ['water_a', 'splash'] }, S => { S.sfx('splash', .04, { vol: v(S, .35), cool: 180 }); erupt(S, { size: .4, hold: .1, debris: false, shake: 3 }); });
    def('element:명', { impact: .08, sounds: ['holy_b'] }, S => { S.hit('holy_b', .1, { vol: v(S, .35), cool: 180 }); drop(S, { size: .44, t: .1, hold: .1, power: .4, debris: false, height: .4 }); });
    def('element:암', { impact: .1, sounds: ['earth_b'] }, S => { S.hit('earth_b', .12, { vol: v(S, .35), rate: .7, cool: 180 }); vortex(S, { size: .4, swirl: 5, t: .22, hold: .04, fade: .26 }); });

    // ================= 전투 공통 =================
    def(combat('기본 공격'), { impact: .08, sounds: ['swish_a', 'swish_b', 'swish_c'] }, S => {
        // 매번 다른 각도로 긋는다.
        const turn = (S.seed | 0) % 3, flip = (S.seed | 0) % 2 ? -1 : 1;
        S.sfx(['swish_a', 'swish_b', 'swish_c'][turn], 0, { vol: v(S, .5), cool: 60 });
        cut(S, { size: .42, native: -.62, flip, rot: (turn - 1) * .5, stop: S.minor ? 0 : 30, shake: 4 });
    });
    def(combat('연격 추가타'), { impact: .06, sounds: ['swish_s', 'slash_c'] }, S => {
        S.sfx('slash_c', 0, { vol: v(S, .4), rate: 1.15, cool: 50 });
        cut(S, { size: .4, native: -.5, flip: (S.seed | 0) % 2 ? 1 : -1, rot: ((S.seed | 0) % 3 - 1) * .7, stop: 0, shake: 3 });
    });
    def(combat('치명타'), { impact: .04, sounds: ['punch_c', 'glass_a'] }, S => {
        const u = S.U, red = [1, .3, .2];
        S.sfx('punch_c', 0, { vol: v(S, .7), cool: 90 }); S.sfx('glass_a', 0, { vol: v(S, .3), cool: 90 });
        pop(S, { size: .5, power: .9, rot: .5, zoom: .035, hold: .08 });
        P.lines(S, S.T.x, S.T.y, 0, .08, red, .4);
        P.arc(S, S.T.x, S.T.y, .2 * u, -.8, [1, .85, .6], 0, .09, { span: 1.5 });
        if (K) { K.sparks(S, S.T.x, S.T.y, S.minor ? 8 : 18, [1, .8, .5], 0, { speed: 1.4 }); K.rays(S, S.T.x, S.T.y, .32 * u, 0, .22, { color: [1, .9, .7], color2: red, n: 5, spin: 0, sharp: .9, z: 3 }); }
    });
    def(combat('운명 피해'), { impact: .1, sounds: ['slash_d', 'earth_b'] }, S => { S.sfx('slash_d', 0, { vol: v(S, .55) }); S.hit('earth_b', .1, { vol: v(S, .4), rate: .8 }); cut(S, { size: .5, native: -.8, stop: 55 }); P.ring(S, S.T.x, S.T.y, .2 * S.U, S.color(), .08, { th: .08 }); });
    def(combat('추가 피해'), { impact: .06, sounds: ['punch_m'] }, S => { S.sfx('punch_m', .02, { vol: v(S, .4), cool: 100 }); pop(S, { size: .38, power: .45, hold: .06, x: S.T.x + (S.rnd(1) - .5) * .1 * S.U, y: S.T.y + (S.rnd(2) - .5) * .1 * S.U }); });
    def(combat('고정 피해'), { impact: .12, sounds: ['swish_a', 'metal_a'] }, S => { S.sfx('swish_a', 0, { vol: v(S, .45) }); S.sfx('metal_a', .12, { vol: v(S, .45) }); sweep(S, { size: .46, t: .12, head: [.9, .12], native: -.7, power: .55, ease: 'in3', follow: .12, shatter: false }); });
    def(combat('속성 추가 피해'), { impact: .06, sounds: ['holy_a'] }, S => { S.hit('holy_a', .08, { vol: v(S, .35), cool: 200 }); pop(S, { size: .42, power: .5, rot: .8, swirl: 2 }); });
    def(combat('프리즘 추가 공격'), { impact: .16, sounds: ['holy_c', 'swish_b'] }, S => {
        const u = S.U, hues = [[1, .3, .3], [1, .8, .2], [.3, 1, .4], [.3, .7, 1], [.7, .4, 1]];
        S.sfx('swish_b', 0, { vol: v(S, .4) }); S.hit('holy_c', .16, { vol: v(S, .4) });
        hues.forEach((c, i) => P.line(S, S.A.x + .1 * u, S.A.y + (i - 2) * .05 * u, S.T.x, S.T.y + (i - 2) * .02 * u, .012 * u, c, i * .015, .2, { from: .08 }));
        sweep(S, { size: .44, t: .16, head: [.9, .3], native: -.25, power: .55, shatter: false });
        hues.forEach((c, i) => P.sparks(S, S.T.x, S.T.y, 3, c, .16 + i * .01, { dist: .3 }));
    });
    def(combat('화상 부여'), { impact: .12, sounds: ['fire_b'] }, S => { S.hit('fire_b', .14, { vol: v(S, .45) }); stamp(S, { size: .38, hold: .3 }); M.rise(S, S.id, S.T.x, S.T.y, .34 * S.U, .14, { dur: .7 }); });
    def(combat('화상 틱'), { impact: .06, sounds: ['fire_a'] }, S => { S.hit('fire_a', .1, { vol: .28, cool: 400 }); erupt(S, { size: .3, hold: .12, debris: false, shake: 0, flow: .024 }); });
    def(combat('겁화 부여'), { impact: .12, sounds: ['fire_b', 'growl'] }, S => { S.hit('fire_b', .14, { vol: v(S, .45), rate: .8 }); S.sfx('growl', 0, { vol: v(S, .25) }); stamp(S, { size: .4, hold: .3 }); });
    def(combat('겁화 틱'), { impact: .06, sounds: ['fire_a'] }, S => { S.hit('fire_a', .1, { vol: .28, rate: .75, cool: 400 }); erupt(S, { size: .34, hold: .12, debris: false, shake: 0, flow: .024 }); });
    def(combat('화상 폭발'), { impact: .08, sounds: ['fire_big', 'boom_b'] }, S => { S.hit('fire_big', .08, { vol: v(S, .6) }); S.sfx('boom_b', .08, { vol: v(S, .45) }); pop(S, { t0: .04, size: .56, power: .85, zoom: .03 }); P.debris(S, S.T.x, S.gT, 8, [.25, .1, .05], .08); });
    def(combat('장송곡 폭발'), { impact: .14, sounds: ['fire_big', 'bell_a', 'boom_a'] }, S => { S.hit('fire_big', .14, { vol: v(S, .55) }); S.sfx('bell_a', .02, { vol: v(S, .35), rate: .7 }); S.sfx('boom_a', .14, { vol: v(S, .5) }); erupt(S, { size: .66, t: .14, stop: 60, shake: 14, hold: .3 }); });
    def(combat('심판 표식'), { impact: .13, sounds: ['holy_c'] }, S => { S.hit('holy_c', .13, { vol: v(S, .4) }); stamp(S, { size: .36, y: S.T.y - .14 * S.U, hold: .34 }); });
    def(combat('천공 폭발'), { impact: .18, sounds: ['thunder', 'holy_big', 'boom_b'] }, S => { S.hit('holy_big', .18, { vol: v(S, .5) }); S.sfx('boom_b', .18, { vol: v(S, .5) }); drop(S, { size: .66, t: .18, power: .9, zoom: .03, hold: .26 }); P.bolt(S, S.T.x - .05 * S.U, 0, S.T.x, S.T.y, [.8, .9, 1], .14); });
    def(combat('그림자 공격'), { impact: .1, sounds: ['slash_d', 'wind_a'] }, S => {
        // 그림자는 대상의 등 뒤에서 벤다.
        S.sfx('slash_d', .04, { vol: v(S, .5) }); S.hit('wind_a', .1, { vol: v(S, .3), rate: .7 });
        cut(S, { size: .46, x: S.T.x + .05 * S.U, native: -.5, flip: -1, stop: 40 });
    });
    def(combat('표식 부여'), { impact: .13, sounds: ['lock'] }, S => { S.sfx('lock', .1, { vol: v(S, .45) }); stamp(S, { size: .36, hold: .34 }); });
    def(combat('표식 지속 피해'), { impact: .06, sounds: ['squish'] }, S => { S.sfx('squish', .04, { vol: .3, cool: 400 }); pop(S, { size: .34, power: .3, hold: .06, rot: 1, strike: false }); P.ring(S, S.T.x, S.T.y, .14 * S.U, S.color(), .04, { th: .1 }); });
    def(combat('보호막 부여'), { impact: 0, sounds: ['field'] }, S => { S.sfx('field', 0, { vol: v(S, .45), cool: 300 }); ward(S, { size: .46 }); });
    def(combat('보호막 흡수'), { impact: .04, sounds: ['metal_ring'] }, S => {
        const u = S.U, p = at(S), c = S.color();
        S.sfx('metal_ring', 0, { vol: v(S, .4), cool: 120 });
        S.shape('hex', { x: p.x, y: p.y, w: .3 * u, h: .38 * u, color: c, alpha: .8, p0: 5, p1: .08, p2: .08, z: 2 }).to({ alpha: 0, w: .34 * u, h: .42 * u }, .3, 'out').end();
        pop(S, { size: .36, power: .3, hold: .04, strike: false }); P.ring(S, p.x, p.y, .16 * u, c, 0, { th: .12 });
    });
    def(combat('보호막 파괴'), { impact: .05, sounds: ['glass_big', 'metal_b'] }, S => {
        const u = S.U, p = at(S);
        S.sfx('glass_big', 0, { vol: v(S, .55) }); S.sfx('metal_b', 0, { vol: v(S, .35) });
        const n = S.sprite({ x: p.x, y: p.y, size: .46 * u * k(S), glow: .5, flash: .8, z: 1 }); n.to({ flash: 0, sx: 1.1, sy: 1.1 }, .08).to({ alpha: 0 }, .06).end();
        M.shatter(S, S.id, p.x, p.y, .46 * u, .06, { spread: .4 * u, grav: 1.0 * u, dur: .8, frac: .45, shard: 1, px: .02 * u, hot: .2 });
        strike(S, p.x, p.y, .05, { power: .6 });
    });
    def(combat('HP 회복'), { impact: 0, sounds: ['heal_a'] }, S => { S.hit('heal_a', .3, { vol: v(S, .42), cool: 500 }); rise(S, { size: .4 }); });
    def(combat('MP 회복'), { impact: 0, sounds: ['heal_b'] }, S => { S.hit('heal_b', .3, { vol: v(S, .38), rate: 1.15, cool: 500 }); rise(S, { size: .4 }); });
    def(combat('생명력 흡수'), { impact: .1, sounds: ['plant_a'] }, S => { S.hit('plant_a', .3, { vol: v(S, .4), cool: 300 }); drain(S, {}); });
    def(combat('마나 흡수'), { impact: .1, sounds: ['plant_b'] }, S => { S.hit('plant_b', .3, { vol: v(S, .36), rate: 1.2, cool: 300 }); drain(S, {}); });
    def(combat('회피'), { impact: 0, sounds: ['air_puff'] }, S => {
        // 피한 쪽의 잔상이 옆으로 미끄러진다.
        const u = S.U, p = at(S);
        S.sfx('air_puff', 0, { vol: v(S, .5), cool: 120 });
        const n = S.sprite({ x: p.x - .04 * u, y: p.y, size: .44 * u * k(S), ang: 0, head: 0, soft: .2, alpha: .9, glow: .4, z: 1 });
        n.to({ head: 1.4, x: p.x + .08 * u }, .14, 'out3').to({ tail: 1.45, x: p.x + .14 * u }, .2, 'in').end();
    });
    def(combat('가시 반사'), { impact: .14, sounds: ['swish_c', 'punch_m'] }, S => { S.sfx('swish_c', 0, { vol: v(S, .4) }); S.sfx('punch_m', .14, { vol: v(S, .45) }); sweep(S, { size: .4, t: .14, head: [.9, .12], native: -.7, power: .45, shatter: false }); });
    def(combat('처형'), { impact: .16, sounds: ['slash_c', 'metal_b', 'boom_b'] }, S => { S.sfx('slash_c', .04, { vol: v(S, .6) }); S.sfx('metal_b', .16, { vol: v(S, .6) }); S.sfx('boom_b', .16, { vol: v(S, .4) }); drop(S, { size: .62, t: .16, power: 1, zoom: .04, height: .5 }); });
    def(combat('방어'), { impact: 0, sounds: ['metal_b'] }, S => { S.sfx('metal_b', .04, { vol: v(S, .4), rate: 1.2 }); ward(S, { size: .42, hold: .2 }); });
    def(combat('자해'), { impact: .06, sounds: ['slash_b', 'squish'] }, S => { S.sfx('slash_b', 0, { vol: v(S, .4) }); S.sfx('squish', .06, { vol: v(S, .35) }); cut(S, { size: .38, native: .9, stop: 0, shake: 3 }); });
    def(combat('상태 해제'), { impact: 0, sounds: ['shimmer'] }, S => { S.sfx('shimmer', 0, { vol: v(S, .4) }); pop(S, { size: .44, power: .35, strike: false }); P.ring(S, at(S).x, at(S).y, .26 * S.U, [1, 1, 1], .04, { th: .08, dur: .5 }); M.rise(S, S.id, at(S).x, at(S).y, .4 * S.U, .1, { dur: .8 }); });
    def(combat('빙결'), { impact: .12, sounds: ['ice_a', 'ice_b'] }, S => { S.hit('ice_a', .12, { vol: v(S, .5) }); erupt(S, { size: .48, hold: .4, flow: 0, debris: false, shake: 5 }); });
    def(combat('기절'), { impact: .06, sounds: ['bell_b', 'punch_m'] }, S => {
        // 별이 머리 위를 돈다.
        const u = S.U, p = at(S), y = p.y - .2 * u, gold = [1, .85, .3];
        S.sfx('punch_m', 0, { vol: v(S, .4) }); S.sfx('bell_b', .04, { vol: v(S, .25), rate: 1.6 });
        const n = S.sprite({ x: p.x, y, size: .34 * u * k(S), sy: .7, mode: 1, head: 0, soft: .25, glow: .5, edge: gold, z: 1 });
        n.to({ head: 1.8 }, .14, 'out').to({ rot: .5 }, .5, 'lin').with({ swirl: 1.5 }, .5, 'lin').to({ dis: 1 }, .3).end();
        for (let i = 0; i < 4; i++) S.shape('flare', { x: p.x, y, w: .05 * u, h: .05 * u, color: gold, alpha: 0, p0: .03, z: 3 }, .08)
            .tick((q, t) => { const a = t * 7 + i * PI / 2; q.x = p.x + Math.cos(a) * .12 * u; q.y = y + Math.sin(a) * .035 * u; q.alpha = clamp(t / .1) * clamp((.8 - t) / .2); q.rot = a; }).wait(.8).end();
    });
    def(combat('무적'), { impact: 0, sounds: ['holy_big', 'field'] }, S => { S.hit('holy_big', .14, { vol: v(S, .45) }); S.sfx('field', 0, { vol: v(S, .4) }); ward(S, { size: .52, hold: .4 }); P.flare(S, at(S).x, at(S).y, .3 * S.U, [1, 1, .9], .1, .4); });
    def(combat('카운터'), { impact: .08, sounds: ['metal_b', 'slash_a'] }, S => { S.sfx('metal_b', 0, { vol: v(S, .45) }); S.sfx('slash_a', .06, { vol: v(S, .45) }); cut(S, { size: .46, native: -.4, stop: 40 }); });
    def(combat('골드 획득'), { impact: .06, sounds: ['coins_a', 'coins_b'] }, S => {
        // 금화가 대상에게서 튀어 시전자에게 날아든다.
        const u = S.U, gold = [1, .82, .3];
        S.sfx('coins_b', .04, { vol: v(S, .4) }); S.sfx('coins_a', .4, { vol: v(S, .4) });
        pop(S, { x: S.T.x, y: S.T.y, size: .4, power: .3, hold: .06, strike: false });
        M.stream(S, S.id, S.T.x, S.T.y, .4 * u, S.A.x, S.A.y, .14, { dur: .6, frac: .7, shard: 1, px: .011 * u, hot: 0 });
        P.glow(S, S.A.x, S.A.y, .13 * u, gold, .6, .3, .55);
    });
    def(combat('소환 해제'), { impact: 0, sounds: ['servo'] }, S => { S.sfx('servo', 0, { vol: v(S, .35), rate: .7 }); const n = pop(S, { size: .4, power: .2, strike: false, hold: .1 }); M.rise(S, S.id, at(S).x, at(S).y, .4 * S.U, .1, { dur: .9, frac: .5 }); return n; });
    def(combat('쿨타임 감소'), { impact: 0, sounds: ['tick', 'lock'] }, S => { S.sfx('tick', 0, { vol: v(S, .4) }); S.sfx('tick', .12, { vol: v(S, .4), rate: 1.2, cool: 0 }); vortex(S, { size: .4, swirl: -5, rot: 2.5, t: .34 }); });
    def(combat('행동 가속'), { impact: 0, sounds: ['air_puff'] }, S => {
        const u = S.U, p = at(S);
        S.sfx('air_puff', 0, { vol: v(S, .4), rate: 1.2 });
        const n = S.sprite({ x: p.x - .08 * u, y: p.y, size: .4 * u * k(S), ang: 0, head: 0, soft: .18, glow: .5, edge: S.color(), z: 1 });
        n.to({ head: 1.4, x: p.x + .06 * u }, .18, 'out3').to({ tail: 1.45, x: p.x + .16 * u }, .22, 'in').end();
    });
    // 오르는 기운(강화)과 내려 찍히는 낙인(약화)
    [['버프', 'shimmer'], ['공격력 강화', 'cast_a'], ['치명타 확률 증가', 'cast_b'], ['치명타 피해 증가', 'cast_b'], ['치명타 확정', 'cast_a'], ['방어 관통 강화', 'cast_a'], ['속성 강화', 'shimmer'], ['중첩 획득', 'gem_b']]
        .forEach(([name, snd]) => def(combat(name), { impact: 0, sounds: [snd] }, S => { S.sfx(snd, 0, { vol: v(S, .35), cool: 250 }); rise(S, { size: .38 }); }));
    [['받는 피해 감소', 'field'], ['속성 저항', 'field']]
        .forEach(([name, snd]) => def(combat(name), { impact: 0, sounds: [snd] }, S => { S.sfx(snd, 0, { vol: v(S, .32), rate: 1.2, cool: 250 }); ward(S, { size: .4, hold: .2 }); }));
    [['디버프', 'growl'], ['공격력 감소', 'metal_a'], ['방어력 감소', 'glass_b'], ['받는 피해 증가', 'glass_a'], ['HP 봉인', 'chain_a'], ['MP 소모', 'bubble']]
        .forEach(([name, snd]) => def(combat(name), { impact: .13, sounds: [snd] }, S => { S.sfx(snd, .1, { vol: v(S, .36), cool: 250 }); stamp(S, { size: .36, hold: .26 }); }));
    def(combat('중첩 소모'), { impact: .06, sounds: ['gem'] }, S => { S.sfx('gem', 0, { vol: v(S, .4), rate: .8 }); vortex(S, { size: .38, swirl: 6, t: .2, hold: 0, fade: .24 }); });

    // ================= 장비와 세트 가운데 따로 연출하는 것 =================
    def('equipment:징수의 총', { impact: .1, sounds: ['gunshot', 'coins_b'] }, S => {
        const u = S.U; S.sfx('gunshot', .06, { vol: v(S, .5) }); S.sfx('coins_b', .2, { vol: v(S, .3) });
        emblem(S, { hold: .05, sound: 'lock' });
        P.line(S, S.A.x + .1 * u, S.A.y - .2 * u, S.T.x, S.T.y, .01 * u, [1, .9, .6], .3, .12, { from: .3, sharp: 2 });
    });
    ['심판의 주사위', '운명의 주사위'].forEach(name => def('equipment:' + name, { impact: .1, sounds: ['dice'] }, S => { emblem(S, { sound: 'dice' }).seek(.12).to({ rot: TAU }, .3, 'out'); }));
    ['무한홀덤덱', '리턴즈파겜'].forEach(name => def('equipment:' + name, { impact: .1, sounds: ['card_a'] }, S => { emblem(S, { sound: 'card_a' }); }));
    ['777 목걸이', '777 반지', '777 장갑', '777 팔찌', '메가카운트 추첨기', '행운의 복주머니', '교촌 주머니', '일레이나 전용 동전', '포상 정산 반지']
        .forEach(name => def('equipment:' + name, { impact: .1, sounds: ['coins_b'] }, S => { emblem(S, { sound: 'coins_b' }); }));
    ['결합 타이머', '모노레일 타이머', '십결모 타이머', '왓 타임 이즈 잇 나우', '쿨다운 목걸이', '존버의 미학']
        .forEach(name => def('equipment:' + name, { impact: .1, sounds: ['tick'] }, S => { emblem(S, { sound: 'tick' }).seek(.12).to({ rot: -TAU }, .34, 'out'); }));

    // 따로 적지 않은 이펙트는 종류에 맞는 원형으로 그린다.
    const generic = new Map();
    F.fallback(effectId => {
        if (generic.has(effectId)) return generic.get(effectId);
        const kind = String(effectId).split(':')[0];
        const definition = kind === 'equipment' ? { impact: .1, sounds: ['gem'], run: S => { emblem(S, {}); } }
            : kind === 'set' ? { impact: .1, sounds: ['shimmer'], run: S => { crest(S, {}); } }
            : kind === 'skill' ? { impact: .08, sounds: ['cast_a'], run: S => { S.sfx('cast_a', 0, { vol: v(S, .4) }); if (S.role === 'actor') rise(S, { size: .42 }); else pop(S, { size: .5 }); } }
            : kind === 'combat' || kind === 'element' || kind === 'summon' ? { impact: .06, run: S => { if (S.role === 'actor') rise(S, { size: .36 }); else pop(S, { size: .4, power: .4 }); } }
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
    F.archetypes = { sweep, erupt, drop, pop, cut, rise, stamp, vortex, ward, emblem, crest, drain };
    // 스킬 장면집(combat-fx-skills.js)이 같은 도우미로 장면을 등록한다.
    F.props = P; F.matter = M; F.strike = strike; F.sceneDef = def;
    // 자주 쓰는 소리. 호스트가 전투 화면에 들어올 때 미리 받는다.
    F.commonSounds = ['swish_a', 'swish_b', 'swish_c', 'slash_c', 'punch_m', 'punch_c', 'glass_a', 'gem', 'shimmer', 'field', 'heal_a', 'heal_b', 'fire_a', 'holy_b', 'earth_b', 'splash', 'metal_ring', 'air_puff'];
})(typeof globalThis != 'undefined' ? globalThis : this);
