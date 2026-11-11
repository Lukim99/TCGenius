const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/paradise-audio.js'), 'utf8');

function player(onPlay) {
    const audios = [], frames = new Map(), document = { hidden: false };
    let clock = 0, id = 0;
    const context = vm.createContext({ window: {}, document, localStorage: { getItem: () => null, setItem() {} },
        performance: { now: () => clock },
        requestAnimationFrame: fn => { frames.set(++id, fn); return id; }, cancelAnimationFrame: key => frames.delete(key),
        Audio: class {
            constructor(src) { this.src = src; this.paused = true; this.currentTime = 0; this.plays = 0; audios.push(this); }
            getAttribute(name) { return this[name]; }
            play() { this.plays++; return (onPlay?.(this) || Promise.resolve()).then(() => { this.paused = false; }); }
            pause() { this.paused = true; }
        }
    });
    vm.runInContext(source, context);
    return { audio: context.window.ParadiseAudio, audios, document, frames,
        settle: () => new Promise(setImmediate),
        advance(ms) { clock += ms; const next = [...frames.values()]; frames.clear(); next.forEach(fn => fn(clock)); } };
}

test('같은 탐험의 상태 갱신은 곡을 다시 만들거나 재시작하지 않는다', async () => {
    const p = player(); p.audio.setScene('heaven'); await p.settle();
    p.audios[0].currentTime = 42;
    p.audio.setScene('heaven'); p.audio.unlock(); await p.settle();
    assert.equal(p.audios.length, 1); assert.equal(p.audios[0].plays, 1); assert.equal(p.audios[0].currentTime, 42);
    p.audio.setScene('hell'); await p.settle(); p.advance(750);
    assert.ok(Math.abs(p.audios[0].volume - p.audios[1].volume) < .001);
    p.advance(750); assert.equal(p.audios[0].paused, true); assert.equal(p.audios[1].volume, .22);
});

test('음소거·탭 숨김·종료는 음악과 효과음 및 늦게 완료된 재생을 멈춘다', async () => {
    let release;
    const p = player(() => new Promise(resolve => { release = resolve; }));
    p.audio.setScene('heaven'); p.audio.toggle(); release(); await p.settle();
    assert.equal(p.audios[0].paused, true);
    const q = player(); q.audio.setScene('hell'); q.audio.play('select'); await q.settle();
    q.document.hidden = true; q.audio.visibility();
    assert.ok(q.audios.every(a => a.paused)); assert.equal(q.frames.size, 0);
    q.document.hidden = false; q.audio.visibility(); await q.settle();
    assert.equal(q.audios[0].paused, false); assert.equal(q.audios[1].paused, true);
    q.audio.stop(); assert.ok(q.audios.every(a => a.paused));
});

test('자동 재생 차단 후 사용자 입력에서 재시도하며 호버 효과음은 겹치지 않는다', async () => {
    let blocked = true;
    const p = player(() => blocked ? Promise.reject(new Error('autoplay')) : Promise.resolve());
    p.audio.setScene('heaven'); await p.settle(); blocked = false;
    p.audio.unlock(); await p.settle(); assert.equal(p.audios.at(-1).paused, false);
    const before = p.audios.length; p.audio.play('hover'); p.audio.play('hover');
    assert.equal(p.audios.length, before + 1);
    p.advance(100); p.audio.play('hover'); assert.equal(p.audios.length, before + 2);
});

test('공용 전투 음원은 지정된 음량으로 재생하고 낙원 음소거를 따른다', async () => {
    const p = player(), url = '/rpg-ui?file=sfx%2Fhit_0.mp3';
    p.audio.playUrl(url, .48); await p.settle();
    assert.equal(p.audios[0].src, url); assert.equal(p.audios[0].volume, .48);
    p.audio.toggle(); assert.equal(p.audios[0].paused, true);
    p.audio.playUrl(url, .48); assert.equal(p.audios.length, 1);
});
