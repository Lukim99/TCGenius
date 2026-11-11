// 한 번 쓴 스킬의 장면은 한 번만 재생되어야 한다. 처형박수처럼 시전자와 대상 양쪽에 걸친 스킬도,
// 같은 사건의 뒤따르는 타격(장비 추가 피해, 고정 피해 같은 줄)이 같은 장면을 다시 요청해도 다시 시작하지 않는다.
// 브라우저 없이 엔진을 돌리려고 캔버스, WebGL, 시계를 흉내 낸다. 그림은 끝내 오지 않으므로 장면은 실제로 그려지지 않고,
// play가 돌려주는 count(시작한 장면 수)로만 판단한다.
const assert = require('assert');

let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const gl = new Proxy({}, {
    get(target, prop) {
        if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 1;
        if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
        if (prop === 'getParameter') return () => 4096;
        if (prop === 'getExtension') return () => null;
        return () => ({});
    }
});
const element = () => ({ style: {}, width: 0, height: 0, setAttribute() {}, addEventListener() {}, remove() {}, getContext: () => gl, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }) });
globalThis.document = { hidden: true, createElement: element, addEventListener() {} };
globalThis.getComputedStyle = () => ({ zIndex: '1' });
globalThis.addEventListener = () => {};
globalThis.matchMedia = () => ({ matches: false });
globalThis.Image = class { set src(value) {} };
globalThis.CombatEffects = require('../public/combat-effects');
const CombatFX = require('../public/combat-fx');
require('../public/combat-fx-scenes');

const host = element();
host.parentNode = { insertBefore() {} };
const fx = CombatFX.create({ scene: host, muted: true });
assert.ok(fx, '흉내 낸 WebGL로 엔진을 만들 수 있어야 한다.');

const src = { x: .26, y: .6 }, dst = { x: .74, y: .55 };
const event = { action: 'skill', skillName: '처형박수' };
const clap = 'skill:처형박수';

// 한 사건: 시전자 쪽과 대상 쪽이 같은 장면을 요청한다(처형박수는 양쪽 스킬).
const actor = fx.play([clap, 'combat:받는 피해 증가'], { role: 'actor', src, dst, event });
const target = fx.play([clap], { role: 'target', src, dst, event });
assert.ok(actor.count >= 1, '첫 요청은 장면을 시작한다.');
assert.strictEqual(target.count, 0, '같은 사건의 대상 쪽 요청은 같은 장면을 다시 시작하지 않는다.');
assert.strictEqual(actor.delay, 500, '궁극기 컷씬이 있어도 장면은 바로 시작해 0.5초에 타격한다: ' + actor.delay);

// 호스트는 2타째를 (타격 시각 + 95ms) 뒤에 따로 부른다. 이때 처형박수 장면은 재생 중이다.
clock += actor.delay + 95;
const second = fx.play([clap, 'combat:연격 추가타'], { role: 'target', src, dst, event, hit: { damage: 10 } });
assert.strictEqual(second.count, 1, '2타째는 연격 추가타만 보이고 처형박수를 다시 재생하지 않는다(재생한 장면 수 ' + second.count + ').');
clock += 95;
assert.strictEqual(fx.play([clap], { role: 'target', src, dst, event }).count, 0, '3타째도 처형박수를 다시 재생하지 않는다.');

// 나중에 다시 쓴 스킬은 다시 재생한다.
clock += 5000;
assert.strictEqual(fx.play([clap], { role: 'actor', src, dst, event }).count, 1, '다음 시전은 다시 재생한다.');
console.log('combat_fx_replay ok');
