const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

// Do not import the server/game module: their startup hooks can write live data.
const gameSource = fs.readFileSync(path.join(__dirname, '..', 'rpgenius.js'), 'utf8');
const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
function isolate(source, names, deps) {
    const body = names.map(name => {
        const match = source.match(new RegExp('^(?:async )?function ' + name + '\\([^]*?^}', 'm'));
        assert.ok(match, name + ' must exist');
        return match[0];
    }).join('\n');
    return new Function(...Object.keys(deps), body + '\nreturn {' + names.join(',') + '};')(...Object.values(deps));
}

function migrationFixture() {
    const soul = '흑막의 영혼석', fragment = '흑막의 영혼석 조각';
    const names = ['상급', '중급', '하급'].map(tier => '흑막의 ' + tier + ' 꾸러미');
    const local = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'Item.json'), 'utf8'));
    const data = {
        Item: [soul, fragment, ...names].map((name, index) => ({ name, desc: '운영자가 변경함', stat: { atk: 123 }, pack: index === 4 ? 999 : index - 2 })),
        Bundle: [[{ type: '골드', count: { min: 37, max: 49 } }], [], [{ custom: true }], [{ custom: true }]],
        Recipe: [{ name: soul, materials: [], crafted: [{ count: 7 }] }]
    };
    const writes = [];
    const { migrateBlackCurtainContent } = isolate(gameSource, ['migrateBlackCurtainContent'], {
        getDataCache: key => data[key], readJson: key => key === 'Item' ? local : [],
        ITEMS_PATH: 'Item', BUNDLE_PATH: 'Bundle', RECIPE_PATH: 'Recipe',
        BLACK_CURTAIN_SOUL_NAME: soul, BLACK_CURTAIN_FRAGMENT_NAME: fragment,
        BLACK_CURTAIN_BUNDLE_NAMES: names,
        saveRpgeniusDataEntry: async key => { writes.push(key); }
    });
    return { data, writes, migrateBlackCurtainContent };
}

test('explicit migration preserves custom stats, bundle links/content, empty settings and recipes', async () => {
    const f = migrationFixture(), before = structuredClone(f.data);
    await f.migrateBlackCurtainContent();
    await f.migrateBlackCurtainContent();
    assert.deepEqual(f.data, before);
    assert.deepEqual(f.writes, []);
    assert.doesNotMatch(gameSource, /initRpgeniusData\(\)\.then\(migrateBlackCurtainContent\)/);
});

test('explicit migration creates only missing entries and is idempotent', async () => {
    const f = migrationFixture();
    f.data.Item.pop();
    const before = structuredClone(f.data);
    await f.migrateBlackCurtainContent();
    assert.deepEqual(f.data.Item.slice(0, before.Item.length), before.Item);
    assert.deepEqual(f.data.Bundle.slice(0, before.Bundle.length), before.Bundle);
    assert.deepEqual(f.data.Recipe, before.Recipe);
    assert.equal(f.data.Item.at(-1).pack, before.Bundle.length);
    assert.deepEqual(f.writes, ['Item', 'Bundle']);
    f.writes.length = 0;
    await f.migrateBlackCurtainContent();
    assert.deepEqual(f.writes, []);
});

function claimFixture() {
    const boss = { name: '흑막' }, state = { hp: 0, contributions: { 검증: 9000 } };
    const user = { name: '검증', gold: 50, garnet: 10, inventory: { item: [{ id: 0, count: 2 }] } };
    let grants = 0, threshold = false;
    const { claimWorldBossRewards } = isolate(gameSource, ['claimWorldBossRewards'], {
        getWorldBossList: () => [boss], forceDefeatExpiredWorldBoss: () => {},
        getWorldBossState: () => state, persistWorldBossState: () => {}, comma: String,
        grantWorldBossThresholdRewards: player => {
            if (!threshold) return 0;
            threshold = false; player.gold += 100; return 1;
        },
        getWorldBossRankRewardForRank: () => [{ items: [] }],
        grantWorldBossRewardItems: player => { grants++; player.inventory.item[0].count++; player.garnet += 300; return 1; }
    });
    const helpers = isolate(serverSource, ['captureWorldBossAction', 'getWorldBossActionRewards'], {
        rpgenius: { getDataCache: () => [{ name: '흑막의 상급 꾸러미' }] },
        getItemDisplayAssets: () => ({ iconUrl: '/bundle.png', frameUrl: '/frame.png' })
    });
    return { state, user, claimWorldBossRewards, ...helpers, grants: () => grants, addThreshold: () => { threshold = true; } };
}

test('claim reports actual item/currency gains; repeated claim is not a new success', async () => {
    const f = claimFixture(), before = f.captureWorldBossAction(f.user);
    assert.match(await f.claimWorldBossRewards(f.user), /^✅/);
    assert.deepEqual(f.getWorldBossActionRewards(f.user, before), [
        { kind: 'currency', name: '가넷', count: 300 },
        { kind: 'item', name: '흑막의 상급 꾸러미', count: 1, iconUrl: '/bundle.png', frameUrl: '/frame.png' }
    ]);
    const after = f.captureWorldBossAction(f.user);
    assert.match(await f.claimWorldBossRewards(f.user), /^❌ 새로 수령할 보상이 없습니다\./);
    assert.deepEqual(f.getWorldBossActionRewards(f.user, after), []);
    assert.equal(f.grants(), 1);
});

test('already claimed rank does not hide newly granted threshold rewards', async () => {
    const f = claimFixture();
    await f.claimWorldBossRewards(f.user);
    f.addThreshold();
    const before = f.captureWorldBossAction(f.user);
    assert.match(await f.claimWorldBossRewards(f.user), /^✅/);
    assert.deepEqual(f.getWorldBossActionRewards(f.user, before), [{ kind: 'currency', name: '골드', count: 100 }]);
});

test('no eligible reward makes no grant', async () => {
    const f = claimFixture();
    f.state.hp = 1;
    assert.match(await f.claimWorldBossRewards(f.user), /^❌/);
    assert.equal(f.grants(), 0);
});

test('claim API returns the saved reward delta and an empty delta on repeated claim', async () => {
    const f = claimFixture();
    let handler, saved = false;
    f.user.save = async () => { saved = true; };
    const start = serverSource.indexOf("server.post('/api/worldboss/claim'");
    assert.ok(start >= 0);
    const route = serverSource.slice(start, serverSource.indexOf('// ===== PVP', start));
    const deps = {
        server: { post: (url, auth, callback) => { handler = callback; } }, requireUser: () => {},
        runWorldBossMutation: async (req, res, action) => res.json(await action(f.user)),
        captureWorldBossAction: f.captureWorldBossAction,
        getWorldBossActionRewards: f.getWorldBossActionRewards,
        rpgenius: { claimWorldBossRewards: f.claimWorldBossRewards },
        buildWorldBossState: () => { assert.ok(saved); return { inField: false }; }
    };
    new Function(...Object.keys(deps), route)(...Object.values(deps));
    let result;
    const response = { json: value => { result = value; } };
    await handler({}, response);
    assert.equal(result.ok, true);
    assert.deepEqual(result.rewards.map(reward => reward.count), [300, 1]);
    await handler({}, response);
    assert.equal(result.ok, false);
    assert.deepEqual(result.rewards, []);
});
