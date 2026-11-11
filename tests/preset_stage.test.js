// 프리셋 무대(public/preset-stage.js)를 브라우저 없이 그려 본다.
// 2026-11-12: 팝니다/삽니다를 고치며 app.js에서 지운 REG_SLOT_SVGS를 예전 프리셋 화면이 계속 써서, 빈 칸이 있는 프리셋이 하나라도 있으면 목록 전체가 뜨지 않았다.
// 그래서 그리기 경로 전체를 여러 화면 크기와 상태로 돌려 예외가 없는지, 비교 표시와 저장, 적용 요청이 맞는지 확인한다.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

// 대시보드가 무대를 싣고, app.js가 프리셋 탭에서 무대를 연다.
const server = read('server.js'), app = read('public/app.js');
assert.ok(server.includes('<div class="page" data-page="preset"><section class="market-stage-host" id="presetStageRoot"></section></div>'), '프리셋 탭은 무대 자리 하나만 둔다.');
assert.ok(server.indexOf('<script src="/static/preset-stage.js"></script>') > server.indexOf('<script src="/static/market-stage.js"></script>'), 'preset-stage.js는 market-stage.js 뒤에 싣는다.');
assert.ok(/if \(pageId === 'preset'\) window\.PresetStageUI\?\.open\(\{ onProfile: renderProfile \}\); else window\.PresetStageUI\?\.close\(\);/.test(app), '프리셋 탭을 열고 닫을 때 무대를 연다.');
assert.ok(!/REG_SLOT_SVGS|presetSlotIcon|renderPresets/.test(app), '예전 프리셋 DOM 화면 코드가 남지 않는다.');
assert.ok(/current,\s*\n\s*presets: views/.test(server) && /missing: Math\.max\(0,/.test(server), '프리셋 응답에 지금 장착과 사라진 품목 수가 들어간다.');

// ── 가짜 브라우저
const eq = (uid, type, extra = {}) => ({ uid, type, typeLabel: type, name: '장비 ' + uid, rarity: '유니크', level: 3, statLines: ['공격력 +10'], iconUrl: '/i/' + uid, frameUrl: '/f', ...extra });
const card = (name, star = 8) => ({ id: 1, name, star, starText: (star + 1) + '성', type: '전직', formatted: '[' + (star + 1) + '성] 전직 ' + name, imageUrl: '/c/' + name });
function payload(over = {}) {
    const current = { mainCard: card('오버라이드'), slotCards: [card('이익태'), card('제우스')], equipment: [eq('w1', 'weapon'), eq('a1', 'accessory', { slotKey: '0' }), eq('a2', 'accessory', { slotKey: '1' }), eq('s1', 'support')] };
    const presets = Array.from({ length: 20 }, () => null);
    presets[0] = { name: '사냥', savedAt: 1, missing: 0, ...JSON.parse(JSON.stringify(current)) };
    presets[1] = { name: '보스', savedAt: 2, missing: 1, mainCard: card('안성재', 10), slotCards: [card('이익태')], equipment: [eq('w2', 'weapon'), eq('a2', 'accessory', { slotKey: '0' }), eq('h1', 'hat')] };
    return { ok: true, slotCount: 20, unlocked: 3, garnet: 1000, point: 0, accessorySlots: 3, cardSlots: 5,
        costs: Array.from({ length: 20 }, (_, i) => i ? { currency: 'garnet', amount: 100, label: '100 가넷', iconUrl: '/g' } : null), current, presets, ...over };
}
const posts = [];
let data = payload(), mounted = null;
const noop = () => {};
const ctx2d = new Proxy({}, { get: (t, k) => k in t ? t[k] : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop: noop }) : noop, set: (t, k, v) => { t[k] = v; return true; } });
const sandbox = {
    console, setTimeout, clearTimeout, Proxy, Promise, Number, String, Math, JSON, Object, Array, Set, Map, Date, RegExp,
    document: { getElementById: () => ({}), addEventListener: noop, removeEventListener: noop, querySelector: () => null, activeElement: null },
    api: async url => { assert.strictEqual(url, '/api/presets'); return JSON.parse(JSON.stringify(data)); },
    postApi: async (url, body) => { posts.push(url.replace('/api/presets/', '') + ' ' + JSON.stringify(body)); return JSON.parse(JSON.stringify(data)); }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('public/market-stage.js'), sandbox, { filename: 'market-stage.js' });
sandbox.MarketStage.mount = (host, opts) => { mounted = opts; return { invalidate: noop, play: noop, pulse: noop, announce: noop, dispose: noop, width: 1440 }; };
vm.runInContext(read('public/preset-stage.js'), sandbox, { filename: 'preset-stage.js' });

function render(W, H) {
    const hits = [], ui = mounted.state;
    const K = new Proxy({}, { get(_, k) {
        if (k === 'C') return ctx2d; if (k === 'S') return ui;
        if (['INK', 'DIM', 'MUTE', 'GOLD', 'WARN', 'GOOD'].includes(k)) return '#ffffff';
        if (k === 'rgba') return () => 'rgba(0,0,0,0)';
        if (k === 'clamp') return (v, a, b) => Math.max(a, Math.min(b, v));
        if (k === 'tw' || k === 'line' || k === 'chip') return s => String(s ?? '').length * 7 + 16;
        if (k === 'fit') return s => ({ lines: [String(s)], lh: 16, sz: 12 });
        if (k === 'para') return () => 16;
        if (k === 'modal') return () => ({ x: 8, y: 8, w: W - 16, h: H - 16 });
        if (k === 'btn') return (action, id, x, y, w, h, label, o = {}) => hits.push({ action, id: String(id ?? ''), x, y, w, h, label: o.aria || label, disabled: !!o.disabled });
        return noop;
    } });
    const A = { w: W, h: H, uniforms: {}, art: noop, field: noop, currency: noop, cover: noop, icon: noop, shade: noop,
        hit: (action, id, x, y, w, h, label, disabled) => hits.push({ action, id: String(id ?? ''), x, y, w, h, label, disabled: !!disabled }) };
    mounted.draw(A, K);
    for (const r of hits) assert.ok(r.x >= -1 && r.y >= -1 && r.x + r.w <= W + 1 && r.y + r.h <= H + 1, W + 'x' + H + ' 화면 밖 단추: ' + r.label);
    return hits;
}
const label = (hits, re) => hits.find(r => re.test(r.label || ''));
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

(async () => {
    sandbox.PresetStageUI.open({ onProfile: noop });
    await flush();
    // 지금 장착과 같은 1번이 먼저 선택되고 '장착 중'으로 보인다.
    let hits = render(1440, 900);
    assert.ok(label(hits, /^1번 사냥, 장착 중, 선택됨$/), '장착과 같은 프리셋을 먼저 고른다.');
    assert.ok(label(hits, /^장착 중$/)?.disabled, '이미 장착한 프리셋의 적용 단추는 잠긴다.');
    // 2번: 무기, 모자, 장신구, 보조, 메인 카드, 슬롯 카드가 바뀌고, 사라진 품목 1개
    mounted.onAct('slot', '1'); hits = render(1440, 900);
    for (const re of [/^무기, 장비 w2, .*교체$/, /^모자, 장비 h1, .*교체$/, /^보조, 비어 있음, 교체$/, /^메인 카드, .*안성재, 교체$/, /^장신구 2, 비어 있음, 교체$/]) assert.ok(label(hits, re), '바뀌는 칸 표시: ' + re);
    assert.ok(label(hits, /^장신구 1, 장비 a2/) && !label(hits, /^장신구 1, 장비 a2.*교체$/), '이미 낀 장신구는 바뀌지 않는다.');
    assert.ok(label(hits, /^슬롯 카드 1, .*이익태$/) && !label(hits, /^슬롯 카드 1, .*교체$/), '이미 낀 슬롯 카드는 바뀌지 않는다.');
    assert.ok(label(hits, /^슬롯 카드 2, 비어 있음, 교체$/), '프리셋에 없는 슬롯 카드는 빠진다.');
    // 같은 그림을 태블릿과 휴대폰 크기로도 그린다(예외와 화면 밖 단추가 없어야 한다).
    for (const [W, H] of [[1024, 768], [1280, 720], [375, 812], [320, 640]]) render(W, H);
    // 지금 장착이 1번에 있으므로 바로 적용한다.
    mounted.onAct('apply', '1'); await flush(); await flush();
    assert.deepStrictEqual(posts.splice(0), ['apply {"slot":1}'], '저장된 장착이면 묻지 않고 적용한다.');
    // 빈 칸(3번)은 지금 장착을 흐리게 미리 보여 주고 저장 단추를 낸다.
    mounted.onAct('slot', '2'); hits = render(1440, 900);
    assert.ok(label(hits, /^현재 장착 저장$/) && label(hits, /^무기, 장비 w1/), '빈 칸은 저장될 모습을 보여 준다.');
    mounted.onAct('save', '2'); await flush(); await flush();
    assert.deepStrictEqual(posts.splice(0), ['save {"slot":2}'], '빈 칸은 묻지 않고 저장한다.');
    // 잠긴 다음 칸은 해금 단추와 가넷 확인 창
    data = payload(); mounted.onAct('refresh', ''); await flush();
    mounted.onAct('slot', '3'); hits = render(1440, 900);
    assert.ok(label(hits, /^해금  100$/), '다음 칸은 해금할 수 있다.');
    // 지금 장착이 어느 프리셋에도 없으면 묻고, 빈 칸에 저장한 뒤 적용할 수 있다.
    data = payload(); data.current.equipment.shift(); mounted.onAct('refresh', ''); await flush();
    mounted.onAct('slot', '1'); mounted.onAct('apply', '1'); await flush();
    assert.deepStrictEqual(posts.splice(0), [], '저장되지 않은 장착이면 먼저 묻는다.');
    assert.ok(mounted.state.dialog && mounted.state.dialog.actions.some(a => a.action === 'apply-save' && a.label === '03에 저장 후 적용'), '빈 칸에 저장하고 적용하는 선택지를 준다.');
    mounted.onAct('apply-save', ''); await flush(); await flush(); await flush();
    assert.deepStrictEqual(posts.splice(0), ['save {"slot":2}', 'apply {"slot":1}'], '저장한 뒤 적용한다.');
    // 덮어쓰기는 확인을 거친다.
    mounted.onAct('dialog-close', ''); mounted.onAct('slot', '0'); mounted.onAct('save', '0');
    assert.strictEqual(mounted.state.dialog.title, '덮어쓰기');
    mounted.onAct('save-yes', ''); await flush(); await flush();
    assert.deepStrictEqual(posts.splice(0), ['save {"slot":0}'], '확인한 뒤 덮어쓴다.');
    for (const file of ['public/preset-stage.js']) assert.ok(!/[·ㅡ]/.test(read(file)), file + '에 가운뎃점이나 ㅡ를 쓰지 않는다.');
    console.log('preset stage test passed');
})().catch(error => { console.error(error); process.exit(1); });
