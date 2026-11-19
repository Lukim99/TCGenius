// 천상 증강 연출: 계약서의 모든 신호에 장면이 있고, 장면과 지속 상태 연출이 오류 없이 돌아가는지 본다.
// 브라우저 없이 엔진을 돌리려고 캔버스, WebGL, 시계를 흉내 낸다(combat_fx_replay.test.js와 같은 방식). 화면은 보지 않는다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const gl = new Proxy({}, {
    get(target, prop) {
        if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 1;
        if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
        if (prop === 'getParameter') return () => 4096;
        if (prop === 'getExtension') return () => null;
        if (prop === 'measureText') return () => ({ width: 40 });
        return () => gl;
    },
    set() { return true; }
});
const element = () => ({ style: {}, width: 0, height: 0, isConnected: true, setAttribute() {}, addEventListener() {}, remove() {}, getContext: () => gl, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }) });
const frames = new Map();
let frameId = 0;
globalThis.document = { hidden: false, createElement: element, addEventListener() {}, removeEventListener() {} };
globalThis.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.getComputedStyle = () => ({ zIndex: '1' });
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false });
// 그림은 요청하는 즉시 받은 것으로 친다(증강 그림을 쓰는 갈래까지 돌려 보기 위해서다).
globalThis.Image = class { set src(value) { this.naturalWidth = 600; this.naturalHeight = 500; if (this.onload) this.onload(); } };
const warnings = [];
console.warn = (...args) => warnings.push(args.map(value => value && value.stack || String(value)).join(' '));

globalThis.CombatEffects = require('../public/combat-effects');
const effects = globalThis.CombatEffects;
const CombatFX = require('../public/combat-fx');
require('../public/combat-fx-kit');
require('../public/combat-fx-scenes');
require('../public/combat-fx-skills');
require('../public/combat-fx-augments');
const A = CombatFX.augments, ROOT = path.join(__dirname, '..');

// 계약서(docs/paradise-augment-fx.md)의 발동 신호와 증강 목록.
const contract = fs.readFileSync(path.join(ROOT, 'docs', 'paradise-augment-fx.md'), 'utf8');
const signals = new Set();
for (const row of contract.split('\n').filter(line => /^\| `augment:/.test(line))) {
    const cell = row.split('|')[1];
    let base = '';
    for (const match of cell.matchAll(/`([^`]+)`/g)) {
        const text = match[1];
        if (text.startsWith('augment:')) { base = text.slice(8).split('.')[0]; signals.add(text.slice(8)); }
        else if (text.startsWith('.')) signals.add(base + text);
    }
}
assert.ok(signals.size >= 44, '계약서의 발동 신호 ' + signals.size);
signals.forEach(name => {
    const definition = CombatFX.resolve('augment:' + name);
    assert.ok(CombatFX.defined('augment:' + name), 'augment:' + name + ' 장면');
    assert.ok(Array.isArray(definition.images), 'augment:' + name + '는 없는 이펙트 그림을 받으려 하지 않는다.');
    assert.ok(definition.impact >= 0 && definition.impact <= .6, 'augment:' + name + ' 타격 시각은 0.6초 안이다.');
    assert.ok(A.scenes.includes('augment:' + name), 'augment:' + name + '는 미리 받기 목록에 있다.');
});
A.scenes.forEach(id => assert.ok(signals.has(id.slice(8)), id + '는 계약서에 있는 신호다.'));
A.skills.forEach(name => {
    const definition = CombatFX.resolve('skill:' + name), hits = definition.hits || [definition.impact];
    assert.ok(CombatFX.defined('skill:' + name) && definition.cast != null && Array.isArray(definition.images), 'skill:' + name + ' 장면');
    assert.strictEqual(hits[0], definition.impact, name + ' 첫 타수는 타격 시각과 같다.');
    hits.forEach((time, index) => assert.ok(!index || time > hits[index - 1], name + ' 타수 시각은 뒤로 갈수록 늦다.'));
    assert.ok(definition.impact <= 1.7 && definition.cast >= hits[hits.length - 1] && definition.cast <= 2.4, name + ' 시전 길이');
});
assert.strictEqual(CombatFX.resolve('skill:검무').hits.length, 8, '검무는 여덟 번 벤다.');
const augments = require('../paradise_augments_prism.js');
assert.strictEqual(augments.length, 30, '증강 30종');
// 스킬만 주는 검무를 빼면 모든 증강에 지속 상태 연출이 있다.
augments.forEach(augment => assert.ok(augment.id === 'swordDance' || A.auras.includes(augment.id), augment.id + ' 지속 상태 연출'));
A.art.forEach(name => { const file = path.join(ROOT, 'public', 'assets', 'combat-fx', 'augments', name + '.webp'); assert.ok(fs.existsSync(file) && fs.statSync(file).size < 200000, name + '.webp는 200KB 안쪽이다.'); });

// ---- 돌려 보기 ----
const host = element();
host.parentNode = { insertBefore() {} };
const fx = CombatFX.create({ scene: host, muted: () => true });
assert.ok(fx, '흉내 낸 WebGL로 엔진을 만들 수 있어야 한다.');
function run(seconds) {
    for (let t = 0; t < seconds; t += 1 / 30) {
        clock += 1000 / 30;
        const pending = Array.from(frames.values()); frames.clear();
        pending.forEach(fn => fn(clock));
    }
}
const me = { x: .25, y: .5 }, foe = { x: .76, y: .47 };
const fig = { me: { x: .25, top: .22, bottom: .9, w: .2 }, foe: { x: .76, top: .18, bottom: .9, w: .3 } };
const now = () => Date.now();

// 지속 상태: 모두 가진 채로 값이 오르내린다.
const states = step => [
    { id: 'conqueror', stacks: Math.min(10, step * 4), max: 10 }, { id: 'fatalDestiny', stacks: Math.min(7, step * 3) }, { id: 'seasons', season: ['spring', 'summer', 'autumn', 'winter'][step % 4] },
    { id: 'manualShift', stacks: step % 4, max: 3, armed: step % 2 === 1 }, { id: 'soulReaper', souls: step * 3 },
    { id: 'readIntent', count: Math.min(2, step), foresight: step >= 2 ? { damage: 12345, critical: step === 3, avoided: step === 4 } : null, parry: step === 3 },
    { id: 'timeOfChoice', marked: step % 2 === 0 }, { id: 'flyingSword', swords: step % 4, ready: step % 2 === 0 }, { id: 'deathWish', active: step > 1 }, { id: 'eternalFlame', burning: true },
    { id: 'deepeningBleed', left: 5 - step }, { id: 'angelDescent', until: step === 2 || step === 3 ? now() + 10000 : 0, used: step > 1 }, { id: 'transcendDeath', until: step === 3 ? now() + 10000 : 0, attacksLeft: step === 3 ? 2 : 1 },
    { id: 'hundredFlowers', flowers: step === 4 ? 0 : step * 2 }, { id: 'armorShred', percent: Math.min(30, step * 12) }, { id: 'painfulWound', until: step > 1 ? now() + 10000 : 0, crits: step },
    { id: 'comboStaircase', step: 1 + step % 3 }, { id: 'fruition', count: step % 3 }, { id: 'holyLightning', count: step % 3 }, { id: 'demonHunter', count: step % 3 },
    { id: 'timeRewind', used: step > 2, guardUntil: step > 2 ? now() + 6000 : 0 }, { id: 'duelChallenge', stage: ['ready', 'pending', 'haste', 'done'][step % 4], until: step % 4 === 2 ? now() + 6000 : 0 },
    { id: 'thornArmor' }, { id: 'haste' }, { id: 'onePunch' }, { id: 'dotCritical' }, { id: 'shieldSiphon' }, { id: 'swordDance' }, { id: 'replay', skill: '정권' }, { id: 'dualIdentity', cardName: '수나타' }
];
const view = { clock: now, fig: () => fig };
for (let step = 0; step < 5; step++) { CombatFX.augmentAuras(fx, states(step), view); run(.8); }
const live = A.state(fx);
assert.strictEqual(live.items.size, 29, '가진 증강마다 지속 상태 연출이 선다.');
assert.ok(fx.count >= 29 && fx.count < 90, '지속 노드는 증강 서른 개를 다 가져도 90개 안쪽이다: ' + fx.count);
// 같은 목록으로 다시 부르면(호스트는 매 프레임 부른다) 아무것도 새로 만들지 않는다.
const same = states(4), before = fx.count;
CombatFX.augmentAuras(fx, same, view); run(.2);
const settled = fx.count;
for (let i = 0; i < 20; i++) CombatFX.augmentAuras(fx, same, view);
assert.strictEqual(fx.count, settled, '바뀐 것이 없으면 노드를 다시 만들지 않는다.');
assert.ok(before > 0);
// 예정 피해 표시와 마지막 기회 판정.
live.hud.fore = { damage: 12345, critical: true, avoided: false };
CombatFX.augmentHud(fx, gl, 800, 450, clock);
assert.ok(A.lastStand([{ id: 'transcendDeath', until: now() + 500, attacksLeft: 2 }], now()), '마지막 기회 중');
assert.ok(!A.lastStand([{ id: 'transcendDeath', until: now() - 1, attacksLeft: 0 }], now()), '마지막 기회가 끝남');

// 발동 장면: 지속 상태가 선 채로, 플레이어의 사건과 적의 사건(뒤집힌 무대) 양쪽으로 재생한다.
A.scenes.forEach(id => {
    const enemy = A.enemySide.includes(id);
    const played = fx.play([id], { role: 'target', src: enemy ? foe : me, dst: enemy ? me : foe, tags: enemy ? { a: 'foe', t: 'me' } : { a: 'me', t: 'foe' }, event: { action: 'basic', triggeredEffectIds: [id] }, cool: 0 });
    assert.strictEqual(played.count, 1, id + ' 재생');
    run(.5);
});
A.skills.forEach(name => {
    const played = fx.play(['skill:' + name], { role: 'target', src: me, dst: foe, tags: { a: 'me', t: 'foe' }, event: { action: 'skill', skillName: name }, cool: 0 });
    assert.strictEqual(played.count, 1, name + ' 재생');
    if (name === '검무') assert.strictEqual(played.hits.length, 8, '검무의 타수 시각');
    run(2);
});
// 곁장면(다른 장면에 얹힘)으로도 돌아간다.
fx.play(['skill:정권'].concat(A.scenes.slice(0, 12)), { role: 'target', src: me, dst: foe, limit: 13, event: { action: 'skill', skillName: '정권' }, cool: 0 });
run(1.5);
// 증강을 모두 잃으면(전투 밖) 지속 노드가 남지 않는다.
CombatFX.augmentAuras(fx, null, view); run(3);
assert.strictEqual(fx.count, 0, '지속 상태가 걷히면 노드가 남지 않는다: ' + fx.count);
assert.deepStrictEqual(warnings.filter(text => text.includes('[combat-fx]')), [], '장면이 오류 없이 돈다.');

// 사건 표기: 증강 신호가 타수의 이펙트 목록에 실리고, 다른 곁장면보다 먼저 고려된다.
const event = effects.annotateEvent({ action: 'basic', hits: [{ damage: 10, critical: true }], damage: 10, triggeredEffectIds: ['augment:fruition'] });
assert.ok(event.hits[0].effectIds.includes('augment:fruition'), '증강 신호는 타수의 이펙트 목록에 실린다.');
assert.strictEqual(effects.presentationEffectIds(event.hits[0].effectIds, 3)[0], 'augment:fruition', '증강 장면이 주 장면이 된다.');

// 호스트 연결(천상 내장 경로).
const hfield = fs.readFileSync(path.join(ROOT, 'public', 'hfield.js'), 'utf8');
assert.ok(/if \(embedded && combatFx\.augmentAuras\) combatFx\.augmentAuras\(this\.fx,/.test(hfield), 'hfield는 천상에서만 지속 상태를 동기화한다.');
assert.ok(/if\(event\.action==='augment'\)\{renderer\.augmentCue\(event,before\);/.test(hfield), "action: 'augment' 사건은 돌진 없이 장면만 낸다.");
assert.ok(/event\.actor==='enemy'&&event\.counter&&landed>0/.test(hfield), '맞공격은 플레이어의 타격이 닿은 뒤에 보인다.');
assert.ok(/combatFx\.augmentHud\(renderer\.fx,c,w,h/.test(hfield) && /lastStand\(next\.augmentAuras/.test(hfield), '예정 피해 표시와 마지막 기회의 HP 0 표시');
assert.ok(fs.readFileSync(path.join(ROOT, 'paradise_web.js'), 'utf8').includes('combat-fx-skills.js" defer></script><script src="/static/combat-fx-augments.js" defer></script>'), '낙원 페이지가 스킬 장면집 다음에 증강 장면집을 싣는다.');
console.log('combat fx augments test passed (' + A.scenes.length + ' scenes, ' + A.skills.length + ' skills, ' + A.auras.length + ' auras)');
