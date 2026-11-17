// 한 번 쓴 스킬의 장면은 한 번만 재생되어야 한다. 처형박수처럼 시전자와 대상 양쪽에 걸친 스킬도,
// 같은 사건의 뒤따르는 타격(장비 추가 피해, 고정 피해 같은 줄)이 같은 장면을 다시 요청해도 다시 시작하지 않는다.
// 브라우저 없이 엔진을 돌리려고 캔버스, WebGL, 시계를 흉내 낸다. 그림은 끝내 오지 않으므로 장면은 실제로 그려지지 않고,
// 재생 중복은 play의 count로, 장면 수명은 같은 엔진에 가상 프레임을 전달해 판단한다.
const assert = require('assert');

let clock = 1000;
Object.defineProperty(globalThis, 'performance', { value: { now: () => clock }, configurable: true, writable: true });
const gl = new Proxy({}, {
    get(target, prop) {
        if (typeof prop === 'string' && /^[A-Z0-9_]+$/.test(prop)) return 1;
        if (prop === 'getShaderParameter' || prop === 'getProgramParameter') return () => true;
        if (prop === 'getParameter') return () => 4096;
        if (prop === 'getExtension') return () => null;
        // 돌려주는 값도 같은 흉내 객체다: 2D 캔버스의 그러데이션처럼 메서드를 이어 부르는 것들이 그대로 통과한다.
        return () => gl;
    }
});
const element = () => ({ style: {}, width: 0, height: 0, setAttribute() {}, addEventListener() {}, remove() {}, getContext: () => gl, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 450 }) });
const visibilityListeners = new Set(), frames = new Map();
let frameId = 0, reducedMotion = false;
globalThis.document = { hidden: true, createElement: element,
    addEventListener(name, fn) { if (name === 'visibilitychange') visibilityListeners.add(fn); },
    removeEventListener(name, fn) { if (name === 'visibilitychange') visibilityListeners.delete(fn); } };
globalThis.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
globalThis.cancelAnimationFrame = id => frames.delete(id);
globalThis.getComputedStyle = () => ({ zIndex: '1' });
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.matchMedia = () => ({ matches: reducedMotion });
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

// 궁극기는 컷씬이 접힌 뒤에 장면을 시작한다(after). 타격 시각도 그만큼 늦고, 그동안 온 같은 사건의 요청은 장면을 다시 시작하지 않는다.
clock += 5000;
const late = fx.play([clap], { role: 'actor', src, dst, event, after: 1080 });
assert.strictEqual(late.delay, 1580, '컷씬 뒤에 시작한 장면은 그만큼 늦게 타격한다: ' + late.delay);
assert.ok(late.cast >= late.delay, '시전 길이는 타격 뒤까지다: ' + late.cast);
const joined = fx.play([clap], { role: 'target', src, dst, event });
assert.strictEqual(joined.count, 0, '컷씬 동안 온 대상 쪽 요청은 같은 장면을 다시 시작하지 않는다.');
assert.strictEqual(joined.delay, 1580, '대상 쪽 요청도 같은 타격 시각을 받는다: ' + joined.delay);
clock += late.delay + 95;
assert.strictEqual(fx.play([clap, 'combat:연격 추가타'], { role: 'target', src, dst, event, hit: { damage: 10 } }).count, 1, '컷씬 뒤에 시작한 장면도 2타째에 다시 재생하지 않는다.');

// 여러 번 때리는 스킬은 타수마다의 시각을 돌려준다.
require('../public/combat-fx-kit');
require('../public/combat-fx-skills');
clock += 5000;
const poker = fx.play(['skill:포커 못 하시네'], { role: 'target', src, dst, event: { action: 'skill', skillName: '포커 못 하시네' } });
assert.strictEqual(poker.hits.length, 9, '포커 못 하시네는 아홉 번의 타격 시각을 돌려준다.');
assert.strictEqual(poker.hits[0], poker.delay, '첫 타격 시각은 delay와 같다.');
assert.ok(poker.hits.every((time, index) => !index || time > poker.hits[index - 1]) && poker.cast > poker.hits[8], '타격 시각은 차례로 늦어지고 시전은 마지막 타격 뒤에 끝난다.');
fx.destroy();

// 기존 WebGL 흉내 위에서 실제 프레임 경로를 실행한다. 이미지 대기 없이 끝나는 장면으로 시간만 통제한다.
const steps = [], cues = [];
CombatFX.define('test:clock', { images: [] }, S => {
    S.shape('rect', { x: 0, y: 0, w: 1, h: 1 }).tick((p, age, dt) => steps.push({ age, dt })).wait(1).end();
    S.pose('t', { alpha: .5 }).wait(1).end();
    S.at(.6, () => cues.push(S.host.time));
});
function clockScene() {
    document.hidden = false; globalThis.devicePixelRatio = 2; steps.length = 0; cues.length = 0;
    const scene = CombatFX.create({ scene: host, muted: true });
    scene.play(['test:clock'], { src, dst, tags: { t: 'foe' }, cool: 0 });
    return scene;
}
function frame(ms) {
    clock += ms;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(fn => fn(clock));
}
function visibility(hidden) { document.hidden = hidden; visibilityListeners.forEach(fn => fn()); }
function near(actual, expected, label) { assert.ok(Math.abs(actual - expected) < 1e-9, label + ': ' + actual); }

const stalledFx = clockScene();
frame(375);
near(stalledFx.time, .375, '한 번 긴 프레임에서도 장면 시계는 실제 시간을 따라간다');
assert.strictEqual(stalledFx.canvas.width, 1600, '한 번의 375ms 정체만으로 품질을 영구 하향하지 않는다');
for (let i = 0; i < 40; i++) frame(16);
assert.strictEqual(stalledFx.busy, false, '단발성 정체 뒤 정상 프레임에서도 장면이 제때 끝난다');
const idleAt = stalledFx.time;
clock += 60000;
stalledFx.play(['test:clock'], { src, dst, tags: { t: 'foe' }, cool: 0 });
frame(16);
near(stalledFx.time, idleAt + .016, '유휴 상태 뒤 새 연출은 쉬었던 시간을 따라잡지 않는다');
assert.strictEqual(stalledFx.canvas.width, 1600, '정상 프레임과 유휴 상태 뒤에도 품질을 유지한다');
stalledFx.destroy();

const slowFx = clockScene();
assert.strictEqual(slowFx.canvas.width, 1600);
frame(150); frame(150); frame(150);
near(slowFx.time, .45, '150ms 프레임에서도 장면 시계가 실제 시간을 따라간다');
near(steps.at(-1).age, .45, '노드 나이도 제한된 물리 간격 대신 실제 시간을 따른다');
frame(150); near(cues[0], .6, '예약된 타격은 실제 경과 시각에 도달한다');
assert.strictEqual(slowFx.canvas.width, 800, '120ms를 넘는 지속 정체도 품질을 낮춘다');
frame(150); frame(150); frame(150);
assert.strictEqual(slowFx.busy, false, '1초 장면은 1.05초 뒤에 남아 있지 않는다');
assert.strictEqual(slowFx.pose('foe'), null, '늦은 프레임에서도 종료된 몸짓은 정리된다');
assert.ok(steps.every(step => step.dt <= .05), '물리 적분 간격은 기존 50ms 제한을 유지한다');
slowFx.destroy();

const hitstopFx = clockScene();
frame(50); hitstopFx.hitstop(110); frame(50); frame(100);
near(hitstopFx.time, .09, '프레임 사이의 타격 정지 110ms만 제외한다');
hitstopFx.destroy();

const pausedFx = clockScene();
pausedFx.freezeAfter(.1); frame(150); frame(150);
near(pausedFx.time, .1, '검수용 일시정지 시각을 넘지 않는다');
pausedFx.freezeAfter(null); frame(16);
near(pausedFx.time, .116, '일시정지 해제 때 멈춰 있던 시간을 따라잡지 않는다');
pausedFx.destroy();

const hiddenFx = clockScene();
frame(16); visibility(true); clock += 60000; visibility(false); frame(16);
near(hiddenFx.time, .032, '숨김 탭의 60초 공백은 연출 시간에 포함하지 않는다');
assert.strictEqual(hiddenFx.canvas.width, 1600, '숨김 탭 복귀만으로 품질을 낮추지 않는다');
hiddenFx.destroy();

reducedMotion = true;
const reducedFx = clockScene();
reducedFx.hitstop(110); frame(150);
near(reducedFx.time, .15, '동작 줄이기는 타격 정지 없이 진행한다');
assert.strictEqual(reducedFx.pose('foe'), null, '동작 줄이기는 몸짓을 만들지 않는다');
reducedFx.destroy();
console.log('combat_fx_replay ok');
