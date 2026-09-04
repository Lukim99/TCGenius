const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const items = JSON.parse(read(path.join('DB', 'RPGenius', 'Item.json')));
const bundles = JSON.parse(read(path.join('DB', 'RPGenius', 'Bundle.json')));
const recipes = JSON.parse(read(path.join('DB', 'RPGenius', 'Recipe.json')));
const bosses = JSON.parse(read(path.join('DB', 'RPGenius', 'WorldBoss.json')));
const server = read('server.js');
const rpgenius = read('rpgenius.js');
const client = read(path.join('public', 'worldboss.js'));
const app = read(path.join('public', 'app.js'));
const BLACK_BUNDLE_NAMES = ['흑막의 상급 꾸러미', '흑막의 중급 꾸러미', '흑막의 하급 꾸러미'];

const boss = bosses.find(entry => entry && entry.name === '흑막');
assert.ok(boss, '흑막 월드보스 정의가 필요합니다.');
assert.strictEqual(boss.pattern, 'blackCurtain');
assert.strictEqual(boss.element, '암');
assert.strictEqual(boss.rewards.find(entry => entry.threshold === 10000000).items[0].item_name, '흑막의 영혼석');
assert.deepStrictEqual(boss.rankRewards.map(entry => entry.items[0].item_name), ['흑막의 상급 꾸러미', '흑막의 중급 꾸러미', '흑막의 하급 꾸러미']);

const soulId = items.findIndex(item => item && item.name === '흑막의 영혼석');
const fragmentId = items.findIndex(item => item && item.name === '흑막의 영혼석 조각');
assert.ok(soulId >= 0 && fragmentId >= 0, '흑막 영혼석과 조각 아이템이 필요합니다.');
const soul = items[soulId].soul;
const slots = ['weapon', 'hat', 'armor', 'pants', 'shoes'];
slots.forEach(slot => {
    assert.ok(soul[slot], slot + ' 부위 영혼 효과가 필요합니다.');
    assert.ok(!Object.prototype.hasOwnProperty.call(soul[slot].stat || {}, 'hp'), slot + '에는 체력 스탯을 넣지 않습니다.');
    assert.ok(!Object.prototype.hasOwnProperty.call(soul[slot].plusStat || {}, 'hp'), slot + '에는 최종 체력 스탯을 넣지 않습니다.');
});
assert.strictEqual(new Set(slots.map(slot => JSON.stringify(soul[slot]))).size, slots.length, '각 장비 부위의 영혼 효과는 서로 달라야 합니다.');
assert.ok(slots.some(slot => Number(soul[slot].stat.darkAtk || 0) > 0), '암속성 강화가 필요합니다.');

BLACK_BUNDLE_NAMES.forEach(name => {
    const item = items.find(entry => entry && entry.name === name);
    assert.ok(item && Array.isArray(bundles[item.pack]) && bundles[item.pack].length >= 5, name + ' 구성품이 필요합니다.');
});
const recipe = recipes.find(entry => entry && entry.name === '흑막의 영혼석');
assert.ok(recipe && recipe.materials.some(entry => entry.item_id === fragmentId && entry.count === 15), '조각 15개 제작식이 필요합니다.');
assert.ok(recipe.crafted.some(entry => entry.item_id === soulId && entry.count === 1), '제작 결과는 흑막의 영혼석이어야 합니다.');

["server.get('/worldboss'", "server.get('/api/worldboss'", "server.post('/api/worldboss/enter'", "server.post('/api/worldboss/select'", "server.post('/api/worldboss/attack'", "server.post('/api/worldboss/skill'", "server.post('/api/worldboss/use-consumable'", "server.post('/api/worldboss/claim'"].forEach(contract => assert.ok(server.includes(contract), '누락된 월드보스 계약: ' + contract));
assert.ok(app.includes("location.href = '/worldboss'"), '사냥 메뉴에서 월드보스로 이동해야 합니다.');
assert.ok(client.includes("getContext('webgl'"), '월드보스 전투 화면은 WebGL이어야 합니다.');
assert.ok(client.includes('drawSheet(') && client.includes('animation.hitFrame'), '보스 모션은 피해 적용 시 타격 프레임에 맞춰야 합니다.');
assert.ok(!client.includes('darkBarrage') && !server.includes('darkBarrage'), '제거한 5연격 모션과 이펙트를 로드하지 않습니다.');
assert.ok(client.includes('effectCatalog.effectIdsFor') && client.includes("uiAsset('boss fight.mp3')"), '공용 전투 이펙트와 배경음악을 사용해야 합니다.');

// Compare actual popup drawing with PVP at several ages and viewport sizes.
// Only arena anchors differ; typography, scale, easing and opacity must match.
const pvpClient = read(path.join('public', 'pvp.js'));
const popupMethod = source => source.slice(source.indexOf('        damageLayer(w,h){'), source.indexOf('        bannerLayer(w,h){'));
function popupTrace(source, width, elapsed) {
    const trace = [];
    const hud = new Function('performance', 'clamp', 'sideX', 'reducedMotion', 'return ({' + popupMethod(source) + '});')(
        { now: () => elapsed }, (n, a, b) => Math.max(a, Math.min(b, n)), () => .5, false
    );
    hud.ctx = {
        save() {}, restore() {},
        set globalAlpha(value) { trace.push(['alpha', value]); },
        translate(...values) { trace.push(['translate', ...values]); },
        scale(...values) { trace.push(['scale', ...values]); }
    };
    hud.text = (...values) => trace.push(['text', ...values]);
    hud.damagePops = [{ start: 0, side: 'target', y: .6, text: '1,200', label: '치명타', sub: '정권', size: 46, color: '#ff5d4d' }];
    hud.damageLayer(width, 844);
    return { trace, remaining: hud.damagePops.length };
}
for (const width of [390, 1280]) for (const elapsed of [0, 95, 250, 900, 950]) {
    assert.deepStrictEqual(popupTrace(client, width, elapsed), popupTrace(pvpClient, width, elapsed), '월드보스 팝은 PVP와 같은 방식으로 그려야 합니다.');
}
assert.ok(client.includes("presentHit(event,hit,'target',i),i*95") && client.includes("audio.play('crit',.82)"), '타격별 팝·이펙트·효과음은 PVP의 95ms 타이밍을 사용합니다.');

assert.ok(rpgenius.includes('1500 * pattern.darkPulseUseCount'), '2.5초 암속성 공격은 +100%씩 선형 증가해야 합니다.');
assert.ok(!rpgenius.includes('nextBarrageAt') && !rpgenius.includes('darkBarrage'), '12초 5연격은 전투 로직과 타이머 모두에서 제거해야 합니다.');
assert.ok(rpgenius.includes('maxHp * .40'), '40초 일참은 최대 체력 40% 고정 피해여야 합니다.');
assert.ok(rpgenius.includes('pattern.damageSinceIcham -= 5000'), '받은 피해 5,000 누적 일참은 초과분을 이월해야 합니다.');
assert.ok(rpgenius.includes('pattern.curseApplied = true') && rpgenius.includes('isBlackCurtainHealingBlocked(user)'), '80초 저주는 회복을 차단해야 합니다.');

const pngs = [
    ['ui', '월드보스', '흑막', 'effects', 'dark-pulse.png'],
    ['ui', '월드보스', '흑막', 'effects', 'icham.png'],
    ['ui', '월드보스', '흑막', 'effects', 'curse.png'],
    ['itemImage', '사용', '흑막의 영혼석.png'],
    ['itemImage', '재료', '흑막의 영혼석 조각.png'],
    ['itemImage', '번들', '흑막의 상급 꾸러미.png'],
    ['itemImage', '번들', '흑막의 중급 꾸러미.png'],
    ['itemImage', '번들', '흑막의 하급 꾸러미.png']
];
pngs.forEach(parts => {
    const file = path.join(root, 'DB', 'RPGenius', ...parts);
    const data = fs.readFileSync(file);
    assert.strictEqual(data.subarray(1, 4).toString('ascii'), 'PNG', file + '는 PNG여야 합니다.');
    assert.ok(data.readUInt32BE(16) >= 512 && data.readUInt32BE(20) >= 512, file + ' 해상도가 너무 작습니다.');
    assert.strictEqual(data[25], 6, file + '는 투명 RGBA PNG여야 합니다.');
});

for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
}

(async () => {
    // A due fatal hit must be applied before the player's action, and its visual
    // event must survive field cleanup instead of disappearing from the response.
    const order = [];
    const queuedUser = { name: '타이밍테스트', hp: 100, field: { name: '흑막', worldBoss: true }, save: async () => order.push('save') };
    const wrapperStart = server.indexOf('async function runWorldBossMutation(');
    const wrapperSource = server.slice(wrapperStart, server.indexOf("server.get('/api/worldboss'", wrapperStart));
    const runMutation = new Function('rpgenius', 'drainWorldBossEvents', wrapperSource + ';return runWorldBossMutation;')({
        getRPGUserByName: async () => queuedUser,
        enqueueFieldAction: async (user, action) => action(),
        findWorldBossByName: name => ({ name }),
        processBlackCurtainDueAttacks: async user => {
            order.push('due'); user.hp = 1; user.field = null;
            return [{ bossAction: 'darkPulse', defeated: true }];
        }
    }, (name, bossName) => {
        assert.strictEqual(bossName, '흑막');
        return [{ bossAction: 'darkPulse', defeated: true }];
    });
    let response;
    await runMutation({ session: { name: queuedUser.name } }, { json: value => { response = value; } }, async user => {
        order.push('mutate');
        assert.strictEqual(user.field, null);
        return { ok: false, state: { inField: false } };
    });
    assert.deepStrictEqual(order, ['due', 'save', 'mutate']);
    assert.strictEqual(response.state.events[0].defeated, true);
    const rpg = require('../rpgenius.js');
    await rpg.initRpgeniusData();
    await rpg.migrateBlackCurtainContent();
    const liveItems = rpg.getDataCache('Item', []);
    const liveBundles = rpg.getDataCache('Bundle', []);
    const liveSoul = liveItems.find(entry => entry && entry.name === '흑막의 영혼석');
    assert.ok(liveSoul, '운영 데이터에도 흑막의 영혼석이 있어야 합니다.');
    BLACK_BUNDLE_NAMES.forEach(name => {
        const item = liveItems.find(entry => entry && entry.name === name);
        assert.ok(item && Array.isArray(liveBundles[item.pack]), '운영 번들 인덱스가 유효해야 합니다: ' + name);
    });
    const liveBundleCount = liveBundles.length;
    await rpg.migrateBlackCurtainContent();
    assert.strictEqual(rpg.getDataCache('Bundle', []).length, liveBundleCount, '마이그레이션을 반복해도 꾸러미가 중복 생성되면 안 됩니다.');
    const user = new rpg.RPGUser('흑막패턴테스트', 'black-curtain-pattern-test');
    const now = Date.now();
    user.hp = 10000;
    user.field = {
        name: '흑막', worldBoss: true, enteredAt: now - 80001, skillSelecting: false,
        nextActionAt: 0, skillCooldowns: {}, buffs: {},
        blackCurtain: { nextDarkPulseAt: now + 10000, nextBarrageAt: now + 10000, nextPercentSlashAt: now + 10000, curseAt: now - 1, darkPulseUseCount: 0, damageSinceIcham: 0, curseApplied: false }
    };
    const events = await rpg.processBlackCurtainDueAttacks(user, rpg.findWorldBossByName('흑막'), now);
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].bossAction, 'curse');
    assert.strictEqual(rpg.isBlackCurtainHealingBlocked(user), true);
    // Persisted legacy deadlines must no longer cause a barrage.
    user.field.blackCurtain.curseApplied = false;
    user.field.blackCurtain.curseAt = now + 80000;
    user.field.blackCurtain.nextBarrageAt = now - 1;
    const withoutBarrage = await rpg.processBlackCurtainDueAttacks(user, rpg.findWorldBossByName('흑막'), now);
    assert.deepStrictEqual(withoutBarrage, []);
    for (const hp of [0, 1]) {
        const entrant = new rpg.RPGUser('흑막입장테스트' + hp, 'black-curtain-entry-test-' + hp);
        entrant.hp = hp;
        const entered = await rpg.enterField(entrant, '흑막', {});
        assert.ok(entrant.field && entrant.field.skillSelecting, entered);
        const confirmed = rpg.confirmWorldBossSkill(entrant, 1);
        assert.ok(!confirmed.startsWith('❌'), confirmed);
        assert.strictEqual(entrant.hp, rpg.calculateUserStats(entrant).hp, '월드보스는 낮은 체력으로 입장해도 전투 시작 시 회복합니다.');
        assert.ok(!Object.hasOwn(entrant.field.blackCurtain, 'nextBarrageAt'));
    }
    console.log('worldboss_black_curtain.test.js: OK');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
