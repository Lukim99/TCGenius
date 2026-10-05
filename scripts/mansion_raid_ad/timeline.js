// 영상과 오디오가 함께 쓰는 시간표. 모든 시각은 영상 기준 초.
// 박자는 두 레이드 BGM을 분석한 값이다. 1관문 107.99 BPM(첫 박 0.130초), 2관문 110.62 BPM(첫 박 0초).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.TL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    const B1 = 0.5556;
    const B2 = 0.5424;
    const DURATION = 60;
    const FPS = 60;

    const S = {};
    S.intro = [0, 16 * B1];
    S.gate1 = [S.intro[1], S.intro[1] + 24 * B1];
    S.gate2 = [S.gate1[1], S.gate1[1] + 20 * B2];
    S.freeze = [S.gate2[1], S.gate2[1] + 6 * B2];
    S.echo = [S.freeze[1], S.freeze[1] + 28 * B2];
    S.finale = [S.echo[1], DURATION];

    // n번째 박의 시각. 구간마다 BGM이 달라 박 길이도 다르다.
    const beat = {
        intro: k => S.intro[0] + k * B1,
        gate1: k => S.gate1[0] + k * B1,
        gate2: k => S.gate2[0] + k * B2,
        freeze: k => S.freeze[0] + k * B2,
        echo: k => S.echo[0] + k * B2,
        finale: k => S.finale[0] + k * B2
    };

    // 마지막 곡의 원본 224.0초 타격이 놓이는 시각
    const FINAL_HIT = S.finale[0] + (224.01 - 221.30);

    // [트랙, 원본 시작, 원본 끝, 영상 시작, 옵션]
    const MUSIC = [
        ['E세계대저택 1관문.mp3', 9.0196, 9.0196 + 40 * B1, 0, { fadeIn: 2.2 }],
        ['E세계대저택 2관문.mp3', 8 * 4 * B2, 13 * 4 * B2, S.gate2[0], { tapeStop: 0.42 }],
        ['E세계대저택 2관문.mp3', 17 * 4 * B2, 24 * 4 * B2, S.echo[0], {}],
        ['E세계대저택 2관문.mp3', 221.30, 229.70, S.finale[0], { fadeOutAt: 59.0 }]
    ];

    // 효과음 큐: [시각, 소리, 음량(dB)]. 합성음은 synth:이름
    const SFX = [];
    const add = (t, name, db = 0, opt = {}) => SFX.push([t, name, db, opt]);

    // 인트로 — 신호음, 번개, 문
    add(0.05, 'synth:drone', -10, { dur: 8.8 });
    add(0.62, 'signal-v2.mp3', -9);
    add(beat.intro(4) - 0.35, 'synth:whoosh', -8, { dur: 0.7 });
    add(beat.intro(8), 'synth:thunder', -4);
    add(beat.intro(8), 'sky-impact-v2.mp3', -12);
    add(beat.intro(12), 'synth:hit', -4);
    add(beat.intro(12), 'bronze-set-v2.mp3', -8);
    add(beat.intro(13), 'synth:hit', -5);
    add(beat.intro(13), 'signal-v2.mp3', -8);
    add(beat.intro(14), 'synth:hit', -4);
    add(beat.intro(14), 'dark-growl-v2.mp3', -10);
    add(beat.intro(14.5), 'synth:riser', -6, { dur: beat.intro(16) - beat.intro(14.5) });
    add(beat.intro(15), 'synth:door', -6);

    // 1관문 — 조각
    add(beat.gate1(0), 'synth:boom', -1);
    add(beat.gate1(0), 'bronze-set-v2.mp3', -3);
    add(beat.gate1(4) - 0.25, 'synth:whoosh', -9, { dur: 0.5 });
    add(beat.gate1(4), 'shards-rush-v2.mp3', -4);
    for (const k of [5, 6, 7]) {
        add(beat.gate1(k), 'stone-hit-v2.mp3', -3);
        add(beat.gate1(k), 'synth:hit', -6);
        add(beat.gate1(k) + 0.04, k === 7 ? 'crit.mp3' : 'hit_1.mp3', -10);
    }
    add(beat.gate1(8) - 0.25, 'synth:whoosh', -9, { dur: 0.5 });
    for (let i = 0; i < 8; i++) add(beat.gate1(8.5) + i * B1 * 0.5, 'puzzle-hit-v2.mp3', -11 + (i % 2) * -3);
    add(beat.gate1(13), 'raid-clear-v2.mp3', -8);
    add(beat.gate1(13), 'synth:hit', -5);
    add(beat.gate1(14) - 0.25, 'synth:whoosh', -9, { dur: 0.5 });
    for (const k of [14.5, 15, 15.5, 16, 16.5]) add(beat.gate1(k), 'stone-hit-v2.mp3', -9);
    add(beat.gate1(17), 'mirror-glint-v2.mp3', -6);
    add(beat.gate1(17), 'synth:hit', -4);
    add(beat.gate1(18) - 0.25, 'synth:whoosh', -9, { dur: 0.5 });
    for (let i = 0; i < 6; i++) add(beat.gate1(18.25 + i * 0.25), 'count.mp3', -6);
    for (let i = 0; i < 6; i++) add(beat.gate1(20) + i * B1 * 0.25, 'puzzle-hit-v2.mp3', -12);
    add(beat.gate1(21.5), 'healing-absorb-v2.mp3', -10);
    add(beat.gate1(22), 'bronze-set-v2.mp3', -4);
    add(beat.gate1(23), 'synth:riser', -8, { dur: B1 });

    // 2관문 — 위플래쉬
    add(beat.gate2(0), 'synth:boom', -1);
    add(beat.gate2(0), 'dark-impact-v2.mp3', -6);
    for (const k of [4, 5, 6]) add(beat.gate2(k), 'signal-v2.mp3', -4);
    add(beat.gate2(7), 'resonance-impact-v2.mp3', -1);
    add(beat.gate2(7), 'synth:boom', -3);
    add(beat.gate2(8), 'signal-v2.mp3', -7);
    add(beat.gate2(8.5), 'echo-break-v2.mp3', -6);
    add(beat.gate2(9), 'signal-v2.mp3', -7);
    add(beat.gate2(9.5), 'echo-break-v2.mp3', -6);
    add(beat.gate2(10), 'wall-pressure-v2.mp3', -3);
    add(beat.gate2(12), 'power-gather-v2.mp3', -5);
    add(beat.gate2(14), 'synth:hit', -4);
    add(beat.gate2(14), 'resonance-impact-v2.mp3', -10);
    add(beat.gate2(15), 'healing-absorb-v2.mp3', -8);
    for (let i = 0; i < 12; i++) add(beat.gate2(16) + i * B2 * 0.33, ['hit_0.mp3', 'hit_1.mp3', 'hit_2.mp3', 'crit.mp3'][i % 4], -9);
    add(beat.gate2(19), 'critical-hit-v2.mp3', -5);

    // 4초 정지
    add(S.freeze[0], 'synth:freeze', -2);
    for (const k of [1, 2, 3, 4]) {
        add(beat.freeze(k), 'synth:heartbeat', -3);
        add(beat.freeze(k), 'count.mp3', -6);
    }
    add(beat.freeze(4.6), 'synth:reverse', -4, { dur: beat.freeze(6) - beat.freeze(4.6) });

    // 잔향
    add(beat.echo(0), 'synth:boom', 0);
    add(beat.echo(0), 'dark-surge-v2.mp3', -2);
    add(beat.echo(0), 'synth:shatter', -4);
    add(beat.echo(1), 'dark-growl-v2.mp3', -6);
    add(beat.echo(5), 'doom-pressure-v2.mp3', -8);
    add(beat.echo(6), 'dark-impact-v2.mp3', -7);

    // 난이도
    for (const k of [8, 9, 10]) {
        add(beat.echo(k), 'synth:slam', -3);
        add(beat.echo(k), 'bronze-set-v2.mp3', -9);
    }
    for (const k of [12, 13, 14]) add(beat.echo(k), 'mirror-glint-v2.mp3', -5);

    // 지원군
    add(beat.echo(16), 'sky-impact-v2.mp3', -5);
    add(beat.echo(16), 'synth:slam', -5);
    add(beat.echo(17), 'ward-form-v2.mp3', -5);
    add(beat.echo(17), 'synth:slam', -6);
    add(beat.echo(18), 'skill-cast-v2.mp3', -4);
    add(beat.echo(18), 'synth:slam', -6);

    // 보상
    add(beat.echo(20), 'raid-clear-v2.mp3', -3);
    add(beat.echo(20), 'synth:hit', -4);
    for (const k of [22, 23, 24, 25]) add(beat.echo(k), 'mirror-glint-v2.mp3', -8);
    add(beat.echo(27.5), 'synth:whoosh', -8, { dur: 0.5 });

    // 칭호와 마지막 타이틀
    for (let k = 0; k < 5; k++) {
        add(beat.finale(k), 'synth:slam', -6);
        add(beat.finale(k), 'mirror-glint-v2.mp3', -10);
    }
    add(FINAL_HIT - 1.4, 'synth:riser', -6, { dur: 1.4 });
    add(FINAL_HIT, 'synth:boom', 1);
    add(FINAL_HIT, 'synth:thunder', -3);
    add(FINAL_HIT, 'resonance-impact-v2.mp3', -6);
    add(FINAL_HIT + 1.6, 'raid-start-v2.mp3', -10);

    return { B1, B2, DURATION, FPS, S, beat, FINAL_HIT, MUSIC, SFX };
});
