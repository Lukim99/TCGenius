'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
AWS.S3 = class { listObjectsV2() { return { promise: async () => ({ Contents: [] }) }; } };
delete process.env.SUPABASE_URL_P; delete process.env.SUPABASE_KEY_P;
process.env.ADMIN_SESSION_SECRET = 'orb-fusion-isolated-test'; process.env.PORT = '0';
const { prepareFusion } = require('../orb_fusion');
const registration = require('../scripts/register_orb_idol_content');
const data = Object.fromEntries(fs.readdirSync(path.join(__dirname, '../DB/RPGenius')).filter(name => name.endsWith('.json')).map(name => [name.slice(0, -5), JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', name), 'utf8'))]));
Object.assign(data, registration.prepare({ Item: data.Item, Fashion: data.Fashion }), { Banner: [] });
const orbIds = data.Item.flatMap((item, id) => item?.use === '보주' ? [id] : []);
const [a, b] = orbIds;
const users = new Map();
let fault = null, writes = 0;
const row = input => input.TableName === 'rpgenius_data' ? (data[input.Key?.key] === undefined ? undefined : { key: input.Key.key, data: data[input.Key.key] }) : users.get(input.Key?.id);
// SDK 경계만 대체하며 환경 파일이나 운영 DB를 사용하지 않는다.
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input, kind = command.constructor.name;
    if (kind === 'GetCommand') return { Item: structuredClone(row(input)) };
    if (kind === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? structuredClone([...users.values()]) : [] };
    if (kind === 'BatchGetCommand') return { Responses: Object.fromEntries(Object.entries(input.RequestItems).map(([table, request]) => [table, request.Keys.map(Key => structuredClone(row({ TableName: table, Key }))).filter(Boolean)])) };
    if (kind !== 'UpdateCommand') throw new Error('Unexpected isolated command: ' + kind);
    const current = users.get(input.Key.id), isFusion = !!input.ExpressionAttributeNames?.['#orbFusionReceipt'];
    const failure = isFusion ? fault : null; if (isFusion) fault = null;
    if (failure === 'before') throw new Error('isolated write failure');
    if (failure === 'conflict') current.inventory.item.find(item => item.id === a).count++;
    for (const condition of (input.ConditionExpression || '').split(' AND ')) {
        let matches = true;
        if (condition === 'attribute_exists(id)') matches = !!current;
        const absent = condition.match(/^attribute_not_exists\(([^)]+)\)$/);
        if (absent) matches = current?.[input.ExpressionAttributeNames[absent[1]]] === undefined;
        const equal = condition.match(/^(#[\w]+)\s*=\s*(:[\w]+)$/);
        if (equal) matches = isDeepStrictEqual(current?.[input.ExpressionAttributeNames[equal[1]]], input.ExpressionAttributeValues[equal[2]]);
        if (!matches) throw Object.assign(new Error('isolated conditional conflict'), { name: 'ConditionalCheckFailedException' });
    }
    const set = input.UpdateExpression.match(/SET (.*?)(?: REMOVE|$)/)?.[1];
    if (set) for (const assignment of set.split(',')) {
        const [key, value] = assignment.split('=').map(part => part.trim());
        current[input.ExpressionAttributeNames[key]] = structuredClone(input.ExpressionAttributeValues[value]);
    }
    const remove = input.UpdateExpression.match(/REMOVE (.*)$/)?.[1];
    if (remove) for (const key of remove.split(',')) delete current[input.ExpressionAttributeNames[key.trim()]];
    if (isFusion) writes++;
    if (failure === 'after') throw new Error('isolated response lost');
    return {};
};
const rpg = require('../rpgenius'), startServer = require('../server');
let http, origin;
async function seed(id = crypto.randomUUID()) {
    const name = '합성-' + id;
    users.set(id, { id, name, code: 'isolated', _get: 1, avatarMigrated: true, need_character_card_select: false,
        main_card: { id: 0, star: 4, type: '일반' }, inventory: { item: [{ id: a, count: 30 }, { id: b, count: 5 }], card: [], equipment: [], pet: [] },
        gold: 1234, garnet: 567, boundItems: { [a]: 30 }, mail: [], mailNotified: true });
    await rpg.reloadAllUsersFromDb(false);
    return { id, name };
}
function cookie(name) {
    const body = Buffer.from(JSON.stringify({ name, admin: false, exp: Date.now() + 86400000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function request(user, body, url = '/api/orb-fusion') {
    const response = await fetch(origin + url, { method: body === undefined ? 'GET' : 'POST', headers: { ...(user ? { Cookie: cookie(user.name) } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') };
}
const payload = (revision = 0, materialIds = [a, a, a]) => ({ revision, materialIds, requestId: crypto.randomUUID() });
const total = user => user.inventory.item.reduce((sum, item) => sum + item.count, 0);
before(async () => { await rpg.initRpgeniusData(); http = startServer(); await new Promise(resolve => http.on('listening', resolve)); origin = 'http://127.0.0.1:' + http.address().port; });
after(async () => { await new Promise(resolve => http.close(resolve)); });

test('28종의 요청 능력치와 부위를 등록하고 운영 데이터와 인덱스를 보존한다', () => {
    const orbs = require('../DB/RPGenius/Orb.json').orbs.filter(o => registration.series.includes(o.series));
    assert.equal(orbs.length, 28);
    for (const [series, key] of [['유의게임X-24', 'fireAtk'], ['유의게임X-25', 'waterAtk'], ['유의게임X-26', 'lightAtk'], ['유의게임X-S', 'darkAtk']]) {
        assert.deepEqual(orbs.filter(o => o.series === series).map(o => o.stat[key]), [90, 80, 70, 60]);
    }
    assert.deepEqual(orbs.filter(o => o.series === '유의게임X-R').map(o => o.plusStat.nonElementDamage), [.06, .05, .04, .03]);
    assert.deepEqual(orbs.filter(o => o.series === '2026 DMC AUTUMN').map(o => o.stat.atk), [150, 120, 100, 100, 80, 80, 65, 65]);
    assert.ok(orbs.every(o => isDeepStrictEqual(o.parts, [o.series === '2026 DMC AUTUMN' ? 'support' : 'accessory'])));
    const before = { Item: [{ name: '요나 보주', desc: '관리자 수정', stat: { custom: 17 } }, { name: '꾸러미', items: [] }], Fashion: [{ name: '아이돌', type: '전직', primary_card: [9], price: 77, option: { custom: 1 } }, { name: '고급 아이돌', type: '전직', primary_card: [9], isHigh: true }] };
    const snapshot = structuredClone(before), after = registration.prepare(before);
    assert.deepEqual(before, snapshot); assert.deepEqual(after.Item.slice(0, 2), before.Item); assert.equal(after.Item.length, 29);
    assert.deepEqual(after.Fashion[0], { ...before.Fashion[0], primary_card: [9, 15, 16] });
    assert.deepEqual(registration.prepare(after), after);
});

test('모든 보주가 같은 풀에 포함되고 동일 재료와 귀속 입력의 결과도 거래 가능하다', () => {
    const input = { inventory: { item: [{ id: a, count: 3 }, { id: b, count: 2 }], card: [] }, boundItems: { [a]: 3, [b]: 1 } };
    const snapshot = structuredClone(input);
    for (let index = 0; index < orbIds.length; index++) {
        const result = prepareFusion(input, data.Item, [a, a, a], size => { assert.equal(size, orbIds.length); return index; });
        assert.equal(result.resultId, orbIds[index]); assert.equal(total(result), 3);
        assert.equal(result.boundItems[a], undefined); assert.equal(result.boundItems[b], 1);
    }
    assert.deepEqual(input, snapshot);
    for (const ids of [[], [a, a], [a, a, b, b], [a, a, -1], [a, a, '1'], [b, b, b]]) assert.throws(() => prepareFusion(input, data.Item, ids));
});

test('API 인증, 보유 목록, 합성 비용 없음, 재료 3개 소모와 영수증 재전송', async () => {
    assert.equal((await request(null)).status, 401);
    assert.equal((await request(null, payload())).status, 401);
    const user = await seed(), view = await request(user);
    assert.equal(view.cache, 'no-store'); assert.equal(view.data.poolSize, orbIds.length); assert.equal(view.data.orbs.length, 2);
    const body = payload(), result = await request(user, body);
    assert.equal(result.status, 200); assert.equal(result.data.revision, 1); assert.ok(result.data.result.name.endsWith('보주'));
    assert.equal(total(users.get(user.id)), 33); assert.equal(users.get(user.id).gold, 1234); assert.equal(users.get(user.id).garnet, 567);
    assert.equal(users.get(user.id).boundItems[a], 27);
    const saved = structuredClone(users.get(user.id));
    assert.deepEqual((await request(user, body)).data, result.data); assert.deepEqual(users.get(user.id), saved);
    assert.equal((await request(user, { ...body, materialIds: [a, a, b] })).status, 409);
    assert.equal((await request(user, payload(0))).status, 409);
    assert.deepEqual(users.get(user.id), saved);
});

test('잘못된 입력과 진행 중 작업을 거부하며 동시 요청은 하나만 소모한다', async () => {
    const user = await seed(), snapshot = structuredClone(users.get(user.id));
    for (const ids of [[a, a], [a, a, -1], [a, a, 999999], ['1', a, a], [0, 0, 0]]) assert.equal((await request(user, payload(0, ids))).status, 400);
    assert.deepEqual(users.get(user.id), snapshot);
    const results = await Promise.all([request(user, payload()), request(user, payload())]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 409]); assert.equal(total(users.get(user.id)), 33);
    const blocked = await seed(); users.get(blocked.id).pendingAction = { type: 'test' }; await rpg.reloadAllUsersFromDb(false);
    assert.equal((await request(blocked, payload())).status, 409); assert.equal(total(users.get(blocked.id)), 35);
});

test('저장 전 실패, 저장 후 응답 유실, 외부 아이템 변경을 구분해 중복 소모를 막는다', async () => {
    const user = await seed(), body = payload(); await request(user); const snapshot = structuredClone(users.get(user.id));
    fault = 'before'; assert.equal((await request(user, body)).status, 500); assert.deepEqual(users.get(user.id), snapshot);
    fault = 'after'; const recovered = await request(user, body); assert.equal(recovered.status, 200); assert.equal(total(users.get(user.id)), 33);
    const count = writes; assert.equal((await request(user, body)).status, 200); assert.equal(writes, count);
    fault = 'conflict'; assert.equal((await request(user, payload(1))).status, 409); assert.equal(total(users.get(user.id)), 34);
    assert.equal(users.get(user.id).orbFusionReceipt.revision, 1);
});

test('아이돌 적용 대상과 카드 및 필드 원본 아트를 워뇨띠와 키노에 연결한다', { skip: !process.env.TEST_BROWSER }, async () => {
    const compositor = require('../card_composite');
    const characters = data.CharacterCards;
    for (const name of ['워뇨띠', '키노']) for (const skin of ['아이돌', '고급 아이돌']) {
        const layers = compositor.resolveCardLayers({ name, skin, type: '전직', star: 6 });
        assert.ok(layers); assert.equal(path.basename(layers.character), `전직 ${skin} ${name}.png`);
        const user = await seed(), saved = users.get(user.id);
        saved.main_card = { id: characters.findIndex(c => c.name === name), type: '전직', star: 6, skin };
        saved.avatars = [{ name: skin, trades: 0 }];
        await rpg.reloadAllUsersFromDb(false);
        assert.ok(rpg.getAvatarOptionsForCard(await rpg.getRPGUserByName(user.name), saved.main_card).some(entry => entry.name === skin));
        const field = await request(user, undefined, '/api/hfield');
        assert.equal(field.status, 200);
        assert.ok(JSON.stringify(field.data).includes(encodeURIComponent(`필드/캐릭터/${name}__전직__${skin}.png`)));
    }
});

test('PC/태블릿/모바일에서 WebGL, 선택, 합성, 재시도와 페이지 종료를 확인한다', { skip: !process.env.TEST_BROWSER }, async () => {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    try {
        const dir = path.join(__dirname, '../output/orb-fusion'); fs.mkdirSync(dir, { recursive: true });
        for (const [label, width, height] of [['pc', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
            const user = await seed(), context = await browser.newContext({ viewport: { width, height } });
            users.get(user.id).inventory.item.push(...orbIds.slice(-28).map(id => ({ id, count: 3 })));
            await rpg.reloadAllUsersFromDb(false);
            const initialCount = total(users.get(user.id));
            await context.addInitScript(() => {
                window.playedSounds = [];
                const play = HTMLMediaElement.prototype.play;
                HTMLMediaElement.prototype.play = function() { window.playedSounds.push(this.src); return play.call(this); };
            });
            await context.addCookies([{ name: 'rpg_admin', value: cookie(user.name).split('=')[1], url: origin }]);
            const page = await context.newPage(), errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(origin, { waitUntil: 'domcontentloaded' });
            await page.locator('[data-group="content"]:visible').click();
            await page.getByRole('button', { name: '보주합성', exact: true }).click();
            await page.locator('.of-row').first().waitFor();
            assert.equal(await page.locator('#orbFusionRoot').getAttribute('data-gl'), 'on');
            await page.screenshot({ path: path.join(dir, label + '-initial.png'), fullPage: true });
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), label + ' overflow ' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#orbFusionRoot *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>[e.className,e.getBoundingClientRect().right]))));
            const row = page.locator('.of-row').first(); for (let i = 0; i < 3; i++) await row.click();
            assert.equal(await page.locator('.of-socket.is-filled').count(), 3);
            await page.waitForFunction(() => [...document.querySelectorAll('.of-socket img')].every(image => image.complete && image.naturalWidth));
            await page.evaluate(() => window.scrollTo(0, 0));
            assert.ok(await page.evaluate(() => {
                const action = document.querySelector('.of-fuse').getBoundingClientRect();
                const tabs = document.querySelector('.bottom-tabs');
                const bottom = getComputedStyle(tabs).display === 'none' ? innerHeight : tabs.getBoundingClientRect().top;
                return action.top >= 0 && action.bottom <= bottom + 1;
            }), label + ' 합성 버튼이 하단 메뉴에 가려지지 않아야 한다');
            await page.screenshot({ path: path.join(dir, label + '-ready.png'), fullPage: true, animations: 'disabled' });
            await page.screenshot({ path: path.join(dir, label + '-viewport.png'), animations: 'disabled' });
            await page.locator('.of-fuse').click(); await page.getByRole('dialog').getByRole('button', { name: '합성', exact: true }).click();
            await page.locator('.of-core.is-revealed').waitFor();
            await page.waitForFunction(() => !document.querySelector('#orbFusionRoot').classList.contains('is-locked'));
            assert.equal(total(users.get(user.id)), initialCount - 2);
            await page.screenshot({ path: path.join(dir, label + '-result.png'), fullPage: true });
            await page.emulateMedia({ reducedMotion: 'reduce' });
            for (let i = 0; i < 3; i++) await page.locator('.of-row').first().click();
            await page.route('**/api/orb-fusion', async route => route.request().method() === 'POST' ? route.abort() : route.continue());
            await page.locator('.of-fuse').click(); await page.getByRole('dialog').getByRole('button', { name: '합성', exact: true }).click();
            await page.getByRole('button', { name: '같은 요청으로 다시 시도' }).waitFor();
            await page.unroute('**/api/orb-fusion'); await page.getByRole('button', { name: '같은 요청으로 다시 시도' }).click();
            await page.waitForFunction(() => !document.querySelector('#orbFusionRoot').classList.contains('is-locked'));
            assert.equal(total(users.get(user.id)), initialCount - 4);
            for (const name of ['select', 'charge', 'reveal']) assert.ok((await page.evaluate(() => window.playedSounds)).some(src => src.endsWith('/' + name + '.ogg')));
            if (label === 'pc') {
                await page.evaluate(() => { window.orbTestGL = document.querySelector('.of-canvas').getContext('webgl').getExtension('WEBGL_lose_context'); window.orbTestGL.loseContext(); });
                await page.waitForFunction(() => document.querySelector('#orbFusionRoot').dataset.gl === 'off');
                await page.evaluate(() => window.orbTestGL.restoreContext());
                await page.waitForFunction(() => document.querySelector('#orbFusionRoot').dataset.gl === 'on');
            }
            await page.evaluate(() => window.OrbFusionUI.unmount());
            assert.equal(await page.locator('#orbFusionRoot canvas').count(), 0); assert.deepEqual(errors, []);
            await context.close();
        }
    } finally { await browser.close(); }
});
