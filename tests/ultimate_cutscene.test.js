const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cutscenes = require('../public/ultimate-cutscene');
const skills = require('../DB/RPGenius/Skills.json');
const characters = require('../DB/RPGenius/CharacterCards.json');
const source = fs.readFileSync(path.join(__dirname, '../public/ultimate-cutscene.js'), 'utf8');

test('모든 캐릭터의 전직 궁극기 및 스펙터 궁극기를 제공된 캐릭터 컷씬에 연결한다', () => {
    assert.equal(cutscenes.CLIPS.length, characters.length);
    for (const character of characters) {
        for (const index of character.class.skills) {
            const clip = cutscenes.find({ action: 'skill', skillName: skills[index].name }, character.name);
            assert.equal(clip.character, character.name);
            assert.ok(clip.duration >= 1799 && clip.duration <= 2399);
        }
        assert.equal(cutscenes.find({ action: 'skill', skillName: '빅뱅' }, character.name).character, character.name);
        for (const index of character.skills) assert.equal(cutscenes.find({ action: 'skill', skillName: skills[index].name }), null);
    }
    for (const action of ['attack', 'tick', 'dot']) assert.equal(cutscenes.find({ action, skillName: '카스 살포' }), null);
    for (const flags of [{ skipped: true }, { error: 'MP 부족' }]) assert.equal(cutscenes.find({ action: 'skill', skillName: '유드 알레프', ...flags }), null);
});

function browser(reduced = false) {
    const listeners = {}, timers = new Map(), images = [], fetched = [], revoked = [];
    let serial = 0, fetchResolver = null;
    const node = () => ({ hidden: false, dataset: {}, children: [], setAttribute() {}, appendChild(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; }, remove() {} });
    const document = { body: node(), hidden: false, createElement: node,
        addEventListener(name, fn) { listeners[name] = fn; }, removeEventListener() {} };
    const context = vm.createContext({
        document, window: { addEventListener() {}, removeEventListener() {} }, matchMedia: () => ({ matches: reduced }),
        Date, Image: class { constructor() { images.push(this); } set src(url) { this.url = url; this.onload(); } },
        URL: { createObjectURL: () => 'blob:' + ++serial, revokeObjectURL: url => revoked.push(url) },
        fetch: url => { fetched.push(url); return new Promise(resolve => {
            const complete = () => resolve({ ok: true, blob: async () => ({ url }) });
            if (fetchResolver) fetchResolver(complete); else complete();
        }); },
        setTimeout: (fn, ms) => { const id = ++serial; timers.set(id, { fn, ms }); return id; },
        clearTimeout: id => timers.delete(id)
    });
    vm.runInContext(source, context);
    const player = context.UltimateCutscene.create({ now: () => 10000 });
    return { player, document, fetched, images, revoked, timers, listeners,
        defer(fn) { fetchResolver = fn; },
        async flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); },
        finish() { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); }
    };
}

test('수나타 소환과 강화형 궁극기는 실제 시전당 1회 재생하며 반복 응답과 지속 피해는 제외한다', async () => {
    const b = browser(), event = { id: 'cast1', at: 9990, action: 'skill', skillName: '수나타 소환' };
    assert.equal(b.player.play(event), 2399);
    assert.equal(b.player.play(event), 0);
    assert.equal(b.player.play({ ...event, id: 'tick', action: 'tick' }), 0);
    await b.flush();
    assert.equal(b.images.length, 1);
    assert.equal(b.document.body.children[0].hidden, false);
    assert.equal([...b.timers.values()][0].ms, 2399);
    b.finish();
    assert.equal(b.document.body.children[0].hidden, true);
    b.player.play({ ...event, id: 'cast2' }); await b.flush();
    assert.equal(b.fetched.length, 1, '원본은 한 번만 내려받는다');
    assert.notEqual(b.images[0].url, b.images[1].url, '다음 시전은 첫 프레임부터 재생한다');
    assert.ok(b.revoked.includes(b.images[0].url));
    b.finish();
    b.player.play({ id: 'buff', action: 'skill', skillName: '범인은 이 안에' }); await b.flush();
    assert.equal(b.document.body.children[0].dataset.character, '흠시원');
});

test('방 이동·탭 숨김은 늦게 도착한 컷씬과 대기열을 취소하고 오래된 사건을 재생하지 않는다', async () => {
    const b = browser(); let complete;
    b.defer(fn => { complete = fn; });
    const event = { id: 'cast', action: 'skill', skillName: '유드 알레프', at: 9900 };
    b.player.play(event); b.player.reset(); complete(); await b.flush();
    assert.equal(b.images.length, 0);
    assert.equal(b.player.play({ ...event, id: 'old', at: 7000 }), 0);
    b.defer(null); b.player.play(event); await b.flush();
    b.player.play({ ...event, id: 'queued' });
    b.document.hidden = true; b.listeners.visibilitychange();
    assert.equal(b.timers.size, 0); assert.equal(b.document.body.children[0].hidden, true);
    b.document.hidden = false;
    assert.equal(b.player.play(event), 0, '탭을 다시 보여도 같은 사건을 반복하지 않는다');
    b.player.reset();
    assert.equal(b.player.play(event), 1799, '새 전투는 독립된 사건 번호를 사용할 수 있다');
});

test('준비 단계는 보유한 궁극기만 읽고 동작 줄이기에서는 정지 프레임을 사용한다', async () => {
    const b = browser(true);
    b.player.prepare([{ name: '자인' }, { name: '유드 알레프' }, { name: '빅뱅' }], '빵귤');
    await b.flush();
    assert.equal(b.fetched.length, 1);
    assert.ok(decodeURIComponent(b.fetched[0]).endsWith('궁극기/빵귤-still-v1.webp'));
    b.player.play({ action: 'skill', skillName: '유드 알레프' }); await b.flush();
    assert.equal([...b.timers.values()][0].ms, 1000);
});
