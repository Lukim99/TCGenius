'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
const unique = require('../unique_avatar');
const release = require('../scripts/register_unique_avatars');
const read = key => JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius', key + '.json'), 'utf8'));
const original = { Fashion: read('Fashion'), Item: read('Item'), Shop: read('Shop') };
const fixture = release.prepare(original);
let writes = [], rejectWrite = false;
AWS.S3.prototype.makeRequest = operation => {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('Unexpected S3 call: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input;
    if (command.constructor.name === 'GetCommand' && input.TableName === 'rpgenius_data') {
        const file = path.join(__dirname, '../DB/RPGenius', input.Key.key + '.json');
        return { Item: { data: structuredClone(fixture[input.Key.key] ?? (fs.existsSync(file) ? read(input.Key.key) : [])) } };
    }
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    if (['UpdateCommand', 'PutCommand'].includes(command.constructor.name)) {
        if (rejectWrite) throw new Error('isolated write failure');
        writes.push(input); return {};
    }
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};
const rpg = require('../rpgenius');
let sequence = 0;
let http, base, httpUser, cookie;
const webUsers = new Map();
function makeUser() {
    const user = new rpg.RPGUser('유니크테스트' + ++sequence, 'unique-test-' + sequence);
    user.main_card = { id: 0, star: 6, type: '전직' }; user.card_slot = []; user.equipments = {};
    user.need_character_card_select = false; user.avatarMigrated = true;
    return user.load(JSON.parse(JSON.stringify(user)));
}
function materials(user) {
    rpg.unlockAvatar(user, '정장', 0); rpg.unlockAvatar(user, '정장', 0);
    return user.avatars.slice(-2).map(a => a.id);
}
function request(user, cube = 0) {
    const avatarIds = materials(user), cubeId = fixture.Item.findIndex(item => item.name === unique.CUBES[cube].name);
    rpg.addInventoryItem(user, cubeId, 1);
    return { avatarIds, cubeId, characterId: 0, version: unique.version(user), requestId: 'request-' + ++sequence };
}
before(async () => {
    await rpg.initRpgeniusData();
    httpUser = makeUser();
    webUsers.set(httpUser.name, httpUser);
    rpg.getRPGUserByName = async name => webUsers.get(name) || null;
    process.env.ADMIN_SESSION_SECRET = 'unique-isolated-test'; process.env.PORT = '0';
    http = require('../server')();
    await new Promise(resolve => http.on('listening', resolve));
    base = 'http://127.0.0.1:' + http.address().port;
    const payload = Buffer.from(JSON.stringify({ name: httpUser.name, exp: Date.now() + 60000 })).toString('base64url');
    cookie = 'rpg_admin=' + payload + '.' + require('crypto').createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
});
after(async () => { await new Promise(resolve => http.close(resolve)); });
function cookieFor(user) {
    const payload = Buffer.from(JSON.stringify({ name: user.name, exp: Date.now() + 60000 })).toString('base64url');
    return 'rpg_admin=' + payload + '.' + require('crypto').createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(payload).digest('base64url');
}
async function api(url, body, auth = true) {
    const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(auth ? { Cookie: typeof auth === 'string' ? auth : cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
}
test('release appends only missing definitions, keeps all existing operator data, and is idempotent', () => {
    assert.deepEqual(fixture.Fashion.slice(0, original.Fashion.length), original.Fashion);
    assert.deepEqual(fixture.Item.slice(0, original.Item.length), original.Item);
    assert.equal(fixture.Fashion.length - original.Fashion.length, 17);
    assert.deepEqual(release.prepare(fixture), fixture);
    const edited = structuredClone(fixture); edited.Fashion.at(-1).option.stat.atk = 999;
    edited.Shop['아바타'] = [];
    assert.deepEqual(release.prepare(edited), edited);
    for (const cube of unique.CUBES) {
        const id = fixture.Item.findIndex(i => i.name === cube.name);
        const listing = Object.values(fixture.Shop).flat().find(i => i.item_id === id);
        assert.deepEqual(listing.price, { goods: cube.goods, amount: cube.price });
    }
});

test('equipped unique avatar uses Halloween in the card title while its inventory name stays unique', () => {
    for (const fashion of fixture.Fashion.filter(f => f.uniqueSeries === 1)) for (const type of ['일반', '전직', '각성']) {
        const id = fashion.primary_card[0], character = read('CharacterCards')[id];
        const card = { id, type, star: 10, skin: fashion.name };
        assert.equal(rpg.formatUserCard(card), '[𝛴] ' + (type === '일반' ? '' : type + ' ') + '할로윈 ' + character.name);
        assert.equal(card.skin, unique.nameFor(character.name));
    }
    assert.equal(rpg.formatUserCard({ id: 3, type: '각성', star: 10 }), '[𝛴] 각성 오버라이드');
    const normal = fixture.Fashion.find(fashion => fashion.name === '정장');
    const id = normal.primary_card[0];
    assert.equal(rpg.formatUserCard({ id, type: '일반', star: 4, skin: normal.name }), '[5성] 정장 ' + read('CharacterCards')[id].name);
});
test('each cube uses its probability boundary and gives the chosen character only', () => {
    unique.CUBES.forEach((cube, i) => {
        const user = makeUser(), body = request(user, i);
        const won = unique.synthesize(user, body, rpg, () => cube.chance - .00001);
        assert.equal(won.unique, true); assert.equal(won.avatar.name, '[1차]유니크 빵귤');
        assert.equal(won.avatar.remainingTrades, 3); assert.equal(user.avatars.length, 1);
        assert.equal(rpg.getInventoryItemCount(user, body.cubeId), 0);
        const other = makeUser(), lost = unique.synthesize(other, request(other, i), rpg, () => cube.chance);
        assert.equal(lost.unique, false);
        const fashion = fixture.Fashion.find(f => f.name === lost.avatar.name);
        assert.ok(fashion.primary_card.includes(0)); assert.equal(rpg.getAvatarGradeByName(fashion.name), '일반');
    });
});
test('14 failures across cube and character choices guarantee the 15th and reset the shared counter', () => {
    const user = makeUser();
    for (let i = 0; i < 15; i++) {
        const body = request(user, i % 3); body.characterId = i % 2;
        const result = unique.synthesize(user, body, rpg, () => .99999);
        assert.equal(result.unique, i === 14); assert.equal(user.avatarSynthesisFailures, i === 14 ? 0 : i + 1);
    }
});
test('duplicate IDs, missing ownership, stale requests and invalid cubes never consume anything; replay is idempotent', () => {
    const user = makeUser(), body = request(user), before = JSON.stringify(user);
    for (const bad of [{ avatarIds: [body.avatarIds[0], body.avatarIds[0]] }, { avatarIds: ['missing', body.avatarIds[1]] }, { version: 'old' }, { cubeId: 0 }, { characterId: 999 }]) {
        assert.ok(unique.synthesize(user, { ...body, ...bad }, rpg).error); assert.equal(JSON.stringify(user), before);
    }
    const result = unique.synthesize(user, body, rpg, () => 0), after = JSON.stringify(user);
    assert.equal(unique.synthesize(user, body, rpg).avatar.id, result.avatar.id);
    assert.equal(JSON.stringify(user), after);
    assert.ok(unique.synthesize(user, { ...body, requestId: 'different' }, rpg).error);
});
test('individual avatars keep options and exactly three lifetime transfers, and consuming one does not remove another', () => {
    const user = makeUser(), other = makeUser(), name = '[1차]유니크 빵귤';
    rpg.unlockAvatar(user, name, 0); rpg.unlockAvatar(user, name, 3);
    const [a, b] = user.avatars; a.option = 'recovery';
    rpg.equipAvatarOnCard(user, user.main_card, name, b.id);
    assert.ok(rpg.getAvatarTradeBlockReason(user, name, b.id));
    let owner = user;
    for (let trade = 0; trade < 3; trade++) {
        assert.equal(rpg.getAvatarTradeBlockReason(owner, name, a.id), null);
        const removed = rpg.removeUserAvatar(owner, name, a.id);
        const recipient = owner === user ? other : user;
        rpg.unlockAvatar(recipient, name, removed.trades + 1, removed); owner = recipient;
    }
    assert.ok(rpg.getAvatarTradeBlockReason(owner, name, a.id));
    assert.equal(rpg.findUserAvatar(owner, name, a.id).option, 'recovery');
    assert.equal(user.main_card.avatarId, b.id); assert.equal(user.main_card.skin, name);
    rpg.removeUserAvatar(user, name, b.id); assert.equal(user.main_card.skin, undefined);
});
test('unique stats add 250 attack/2500 HP and exactly one optional effect; appearance controls cutscene', () => {
    const user = makeUser(), base = rpg.calculateUserStats(user), name = '[1차]유니크 빵귤';
    rpg.unlockAvatar(user, name, 0); rpg.equipAvatarOnCard(user, user.main_card, name);
    const avatar = user.avatars[0];
    for (const option of unique.OPTIONS) {
        avatar.option = option.id; const stats = rpg.calculateUserStats(user);
        assert.equal(stats.atk - base.atk, 250); assert.equal(stats.hp - base.hp, 2500);
        for (const key of ['finalDamage', 'crit', 'recoveryEfficiency', 'shieldEfficiency', 'takenDamage', 'itemDropChance']) assert.ok(Math.abs((stats[key] || 0) - (base[key] || 0) - (option.stats[key] || 0)) < 1e-8, option.id + ': ' + key);
    }
    const scene = rpg.getUniqueAvatarCutscene(user); assert.ok(scene.url.includes('rpg-ui'));
    assert.equal(scene.skillName, '유드 알레프');
    assert.equal(rpg.getUniqueAvatarCutscene(user, '자인'), null);
    assert.equal(rpg.getUniqueAvatarCutscene(user, 'not ultimate'), null);
    rpg.equipAvatarOnCard(user, user.main_card, ''); rpg.applyAvatarStatsOnCard(user, user.main_card, name);
    assert.equal(rpg.getUniqueAvatarCutscene(user), null); assert.ok(rpg.calculateUserStats(user).hp > base.hp);
});
test('protected save writes materials/cube/pity/result together and restores failed writes', async () => {
    const user = makeUser(), body = request(user); user.load(JSON.parse(JSON.stringify(user)));
    const before = JSON.stringify(user); unique.synthesize(user, body, rpg, () => 0);
    rejectWrite = true;
    await assert.rejects(rpg.commitProtectedUserChange(user, ['avatars','inventory','main_card','card_slot','avatarSynthesisFailures','lastAvatarSynthesis']));
    rejectWrite = false; assert.equal(JSON.stringify(user), before);
    unique.synthesize(user, body, rpg, () => 0);
    await rpg.commitProtectedUserChange(user, ['avatars','inventory','main_card','card_slot','avatarSynthesisFailures','lastAvatarSynthesis']);
    const write = writes.at(-1); assert.match(write.ConditionExpression, /attribute_exists\(id\)/);
    for (const key of ['avatars','inventory','avatarSynthesisFailures','lastAvatarSynthesis']) assert.ok(Object.values(write.ExpressionAttributeNames).includes(key));
});
test('actual HTTP synthesis is authenticated, serialized and replay-safe; combat blocks option changes', async () => {
    assert.equal((await api('/api/avatars/synthesis', null, false)).status, 401);
    const body = request(httpUser); httpUser.load(JSON.parse(JSON.stringify(httpUser)));
    httpUser.avatarSynthesisFailures = 14; body.version = unique.version(httpUser);
    const state = await api('/api/avatars/synthesis');
    assert.equal(state.status, 200); assert.equal(state.body.characters.length, 17);
    const results = await Promise.all([api('/api/avatars/synthesis', body), api('/api/avatars/synthesis', body)]);
    assert.deepEqual(results.map(r => r.status), [200, 200]);
    assert.equal(results[0].body.result.avatar.id, results[1].body.result.avatar.id);
    assert.equal(httpUser.avatars.length, 1); assert.equal(httpUser.avatarSynthesisFailures, 0);
    const id = httpUser.avatars[0].id;
    httpUser.field = { name: '테스트 전투' };
    assert.equal((await api('/api/avatars/option', { avatarId: id, option: 'crit' })).status, 400);
    assert.equal((await api('/api/cards/avatar', { source: 'main', name: httpUser.avatars[0].name, avatarId: id })).status, 400);
    httpUser.field = null; httpUser.pvp = { battle: { phase: 'fight' } };
    assert.equal((await api('/api/avatars/option', { avatarId: id, option: 'crit' })).status, 400);
    delete httpUser.pvp;
    const changed = await api('/api/avatars/option', { avatarId: id, option: 'recovery' });
    assert.equal(changed.status, 200); assert.equal(changed.body.avatar.option, 'recovery');
    assert.equal((await api('/api/avatars/option', { avatarId: 'someone-else', option: 'crit' })).status, 400);
    assert.equal((await api('/api/avatars/option', { avatarId: id, option: 'invented' })).status, 400);
    const equipped = await api('/api/cards/avatar', { source: 'main', name: httpUser.avatars[0].name, avatarId: id });
    assert.equal(equipped.status, 200);
    const wardrobe = await api('/api/cards/avatars?source=main');
    assert.equal(wardrobe.body.avatars.find(a => a.grade === '유니크').ownedCount, 1);
});

test('new Glencheck and Dealer avatar layers are served for each card tier and prestige', async () => {
    for (const name of ['글렌첵', '딜러장']) for (const tier of ['일반', '전직', '각성', '프레스티지 일반', '프레스티지 전직']) {
        const params = new URLSearchParams({ name, skin: unique.nameFor(name), star: '9', type: tier.replace('프레스티지 ', ''), prestige: tier.startsWith('프레스티지') ? '1' : '0', portrait: '1' });
        const response = await fetch(base + '/card-image?' + params, { headers: { Cookie: cookie } });
        assert.equal(response.status, 200);
        const source = fs.readFileSync(path.join(__dirname, '../DB/RPGenius/cardImage/카드분리/캐릭터', name, tier + ' 유니크 1차 ' + name + '.png'));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), source);
    }
});

test('avatar gallery serves distinct card, portrait and available cutscene media with currency icons', async () => {
    const { body } = await api('/api/cards/avatars?source=main');
    const uniqueAvatar = body.avatars.find(a => a.grade === '유니크');
    const normalAvatar = body.avatars.find(a => a.grade === '일반' && a.shop);
    assert.match(uniqueAvatar.imageUrl, /^\/card-image\?/);
    assert.match(decodeURIComponent(uniqueAvatar.portraitUrl), /유니크아바타\/전신\//);
    assert.match(decodeURIComponent(uniqueAvatar.cutsceneUrl), /유니크아바타\/컷씬\//);
    assert.equal(decodeURIComponent(normalAvatar.portraitUrl), '/rpg-ui?file=필드/캐릭터/빵귤__일반__수영장 파티.png');
    assert.equal(normalAvatar.cutsceneUrl, null);
    assert.ok(normalAvatar.shop.price.iconUrl);
    for (const url of [uniqueAvatar.imageUrl, uniqueAvatar.portraitUrl, uniqueAvatar.cutsceneUrl, normalAvatar.portraitUrl, normalAvatar.shop.price.iconUrl]) {
        const response = await fetch(new URL(url, base), { headers: { Cookie: cookie } });
        assert.equal(response.status, 200, url);
        assert.match(response.headers.get('content-type'), /^image\//);
        if (url === normalAvatar.portraitUrl) assert.deepEqual(Buffer.from(await response.arrayBuffer()), fs.readFileSync(path.join(__dirname, '../DB/RPGenius/ui/필드/캐릭터/빵귤__일반__수영장 파티.png')));
    }
    for (const [name, skin, expected] of [
        ['딜러장', '고급 산타', '/rpg-ui?file=필드/캐릭터/딜러장/전직__고급 산타.png'],
        ['마쉐비', 'DVA', '/rpg-ui?file=필드/캐릭터/마쉐비__일반__DVA.png'],
        ['뭔마', '이터널스', '/rpg-ui?file=필드/캐릭터/뭔마__일반__이터널스.png']
    ]) {
        const user = makeUser(); user.main_card.id = read('CharacterCards').findIndex(card => card.name === name);
        webUsers.set(user.name, user);
        const { body: gallery } = await api('/api/cards/avatars?source=main', null, cookieFor(user));
        const avatar = gallery.avatars.find(avatar => avatar.name === skin);
        assert.ok(avatar, skin);
        assert.equal(avatar.portraitUrl ? decodeURIComponent(avatar.portraitUrl) : null, expected, skin);
    }
});
test('shop allows repeated avatar purchases and purchased cube prices match release definitions', async () => {
    httpUser.point = httpUser.mileage = 100000;
    const shop = await api('/api/shop');
    const listing = shop.body.shop['아바타'].find(entry => entry.type === '아바타');
    assert.ok(listing);
    const before = rpg.getUserAvatars(httpUser).filter(a => a.name === listing.fashion).length;
    const bought = await api('/api/shop/buy', { shopType: '아바타', shopId: listing.shopId, count: 2 });
    assert.equal(bought.status, 200, JSON.stringify(bought.body));
    assert.equal(httpUser.avatars.filter(a => a.name === listing.fashion).length, before + 2);
    const again = await api('/api/shop');
    assert.equal(again.body.shop['아바타'].find(entry => entry.shopId === listing.shopId).soldOut, false);
    for (const cube of unique.CUBES) {
        const tab = cube.goods === 'point' ? '포인트' : '마일리지';
        const itemId = fixture.Item.findIndex(i => i.name === cube.name);
        const offer = fixture.Shop[tab].find(entry => entry.item_id === itemId);
        const balance = httpUser[cube.goods], amount = rpg.getInventoryItemCount(httpUser, itemId);
        assert.equal((await api('/api/shop/buy', { shopType: tab, shopId: offer.shopId, count: 1 })).status, 200);
        assert.equal(httpUser[cube.goods], balance - cube.price);
        assert.equal(rpg.getInventoryItemCount(httpUser, itemId), amount + 1);
    }
});
test('auction transfers exact copies, allows duplicate ownership, preserves options and restores cancelled listings', async () => {
    const seller = makeUser(), buyer = makeUser(), name = '[1차]유니크 빵귤';
    webUsers.set(seller.name, seller); webUsers.set(buyer.name, buyer); buyer.gold = 100000;
    rpg.unlockAvatar(seller, name, 2); rpg.unlockAvatar(seller, name, 3); rpg.unlockAvatar(buyer, name, 0);
    const [available, bound] = seller.avatars; available.option = 'drop';
    const sell = avatarId => api('/api/auction/register', { kind: 'avatar', name, avatarId, currency: 'gold', price: 100 }, cookieFor(seller));
    assert.equal((await sell(bound.id)).status, 400);
    const listing = await sell(available.id); assert.equal(listing.status, 200, JSON.stringify(listing.body));
    assert.equal(seller.avatars.length, 1);
    assert.equal((await api('/api/auction/cancel', { id: listing.body.id }, cookieFor(seller))).status, 200);
    assert.equal(rpg.findUserAvatar(seller, name, available.id).trades, 2);
    const relisted = await sell(available.id);
    const purchased = await api('/api/auction/buy', { id: relisted.body.id }, cookieFor(buyer));
    assert.equal(purchased.status, 200, JSON.stringify(purchased.body));
    assert.equal(buyer.avatars.length, 2);
    const received = rpg.findUserAvatar(buyer, name, available.id);
    assert.equal(received.trades, 3); assert.equal(received.option, 'drop');
    assert.ok(rpg.getAvatarTradeBlockReason(buyer, name, received.id));
    assert.equal((await api('/api/auction/buy', { id: relisted.body.id }, cookieFor(buyer))).status, 400);
});
test('buy orders accept another copy and transfer the selected tradable instance only', async () => {
    const seller = makeUser(), buyer = makeUser(), name = '[1차]유니크 빵귤';
    webUsers.set(seller.name, seller); webUsers.set(buyer.name, buyer); buyer.gold = 10000;
    rpg.unlockAvatar(seller, name, 3); rpg.unlockAvatar(seller, name, 1); rpg.unlockAvatar(buyer, name, 0);
    const [bound, available] = seller.avatars;
    const listing = await api('/api/buyorder/register', { kind: 'avatar', name, currency: 'gold', price: 100, count: 1 }, cookieFor(buyer));
    assert.equal(listing.status, 200, JSON.stringify(listing.body));
    const state = await api('/api/buyorder/fulfillable?id=' + listing.body.id, null, cookieFor(seller));
    assert.deepEqual(state.body.avatar.instances.map(a => a.id), [available.id]);
    assert.equal((await api('/api/buyorder/fulfill', { id: listing.body.id, avatarId: bound.id }, cookieFor(seller))).status, 400);
    assert.equal((await api('/api/buyorder/fulfill', { id: listing.body.id, avatarId: available.id }, cookieFor(seller))).status, 200);
    assert.equal(rpg.findUserAvatar(buyer, name, available.id).trades, 2);
    assert.equal(seller.avatars[0].id, bound.id); assert.equal(buyer.avatars.length, 2);
});
test('browser renders wardrobe, PC/mobile synthesis, real guaranteed result, normal result, audio and cutscene', { skip: !process.env.UNIQUE_AVATAR_BROWSER_CHECK }, async t => {
    httpUser.avatars = []; httpUser.inventory.item = []; httpUser.avatarSynthesisFailures = 14;
    delete httpUser.lastAvatarSynthesis; httpUser.main_card = { id: 0, star: 6, type: '전직' };
    for (const name of ['정장','정장','치어리더','범죄도시','드레스','수영장 파티','[1차]유니크 빵귤']) rpg.unlockAvatar(httpUser, name, 0);
    for (const cube of unique.CUBES) rpg.addInventoryItem(httpUser, fixture.Item.findIndex(item => item.name === cube.name), 3);
    httpUser.load(JSON.parse(JSON.stringify(httpUser)));
    t.mock.method(Math, 'random', () => .99999);
    const browser = await require('puppeteer-core').launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage(), errors = [], audio = new Map();
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', response => { if (response.url().includes('/assets/unique-avatar/') && response.url().endsWith('.mp3')) audio.set(response.url(), response.status()); });
        await page.evaluateOnNewDocument(() => {
            window.__avatarAudioStarts = 0;
            window.__avatarRevokedUrls = [];
            const revoke = URL.revokeObjectURL;
            URL.revokeObjectURL = function(url) { window.__avatarRevokedUrls.push(url); return revoke.call(this, url); };
            const start = AudioBufferSourceNode.prototype.start;
            AudioBufferSourceNode.prototype.start = function(...args) { window.__avatarAudioStarts++; return start.apply(this, args); };
        });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.setCookie({ name: 'rpg_admin', value: cookieFor(httpUser).split('=').slice(1).join('='), url: base });
        await page.goto(base, { waitUntil: 'networkidle0' });
        await page.evaluate(async () => { openRichModal('빵귤', '아바타', []); await appendAvatarSection({ source: 'main' }); });
        await page.waitForSelector('.uaw-tile');
        await page.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.querySelectorAll('.uaw img')].map(image => { image.loading = 'eager'; return image.decode(); })); });
        assert.equal(await page.$$eval('.uaw-tile[data-grade="unique"] img', images => images.every(image => image.src.includes('/card-image?'))), true);
        const dir = path.join(__dirname, '../output/unique-avatar'); fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: path.join(dir, 'wardrobe-desktop.png') });
        await page.setViewport({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(dir, 'wardrobe-mobile.png') });
        await (await page.$('.uaw')).screenshot({ path: path.join(dir, 'wardrobe-panel-mobile.png') });
        assert.equal(await page.$eval('.uaw', node => node.scrollWidth <= node.clientWidth + 1), true);
        await page.setViewport({ width: 1440, height: 1000 });
        await page.click('.uaw-synth');
        await page.waitForSelector('.ua-overlay');
        await page.evaluate(() => Promise.all([...document.querySelectorAll('.ua-overlay img')].map(image => { image.loading = 'eager'; return image.decode().catch(() => {}); })));
        const select = async (id, characterId = 0) => {
            await page.click('.ua-item[data-id="' + id[0] + '"]');
            await page.click('.ua-item[data-id="' + id[1] + '"]');
            await page.click('.ua-char[data-id="' + characterId + '"]');
        };
        const materialIds = httpUser.avatars.slice(0, 2).map(a => a.id);
        await select(materialIds);
        assert.equal(await page.$('.ua-sound, .ua-cube-price, .ua-cube-rate, .ua-odds'), null);
        assert.doesNotMatch(await page.$eval('.ua-overlay', node => node.textContent), /10%|15%|25%|100%|300P|300 마일리지|600 마일리지/);
        assert.equal(await page.$$eval('.ua-char img', images => images.every(image => decodeURIComponent(image.src).includes('유니크아바타/전신/'))), true);
        assert.equal(await page.$eval('.ua-item[data-grade="unique"] img', image => decodeURIComponent(image.src).includes('1차 유니크 아바타.png')), true);
        assert.equal(await page.$eval('.ua-go', button => button.disabled), false);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 450)));
        await page.screenshot({ path: path.join(dir, 'synthesis-desktop.png') });
        await page.setViewport({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(dir, 'synthesis-mobile.png') });
        assert.equal(await page.$eval('.ua-overlay', node => node.scrollWidth <= innerWidth + 1), true);
        await page.click('.ua-go');
        await page.waitForSelector('.ua-overlay[data-view="reveal"] .is-settled', { timeout: 15000 });
        assert.equal(httpUser.avatarSynthesisFailures, 0);
        assert.equal(httpUser.avatars.filter(a => a.name === '[1차]유니크 빵귤').length, 2);
        assert.match(await page.$eval('.ua-reveal-name', node => node.textContent), /빵귤/);
        assert.doesNotMatch(await page.$eval('.ua-reveal', node => node.textContent), /거래/);
        assert.equal(await page.$eval('.ua-frame-art img', image => image.src.includes('/card-image?')), true);
        await page.screenshot({ path: path.join(dir, 'unique-result-mobile.png') });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.screenshot({ path: path.join(dir, 'unique-result-desktop.png') });
        await page.click('.ua-reveal-actions .ua-btn-gold');
        await select(httpUser.avatars.slice(0, 2).map(a => a.id), 1);
        await page.click('.ua-go');
        await page.waitForSelector('.ua-overlay[data-tone="normal"] .is-settled', { timeout: 15000 });
        assert.equal(await page.$eval('.ua-frame-art img', image => image.src.includes('/card-image?')), true);
        assert.equal(httpUser.avatarSynthesisFailures, 1);
        assert.ok(fixture.Fashion.find(f => f.name === httpUser.avatars.at(-1).name).primary_card.includes(1));
        await page.screenshot({ path: path.join(dir, 'normal-result-desktop.png') });
        assert.ok(audio.size >= 4); assert.ok([...audio.values()].every(status => status === 200));
        assert.ok(await page.evaluate(() => window.__avatarAudioStarts > 0));
        await page.evaluate(() => UniqueAvatarUI.close());
        assert.equal(await page.$('.ua-overlay'), null);
        await page.evaluate(async () => { openRichModal('빵귤', '아바타', []); await appendAvatarSection({ source: 'main' }); });
        await page.click('.uaw-tile[data-grade="unique"]');
        await page.waitForSelector('.unique-avatar-options button');
        assert.equal(await page.$eval('.avatar-detail-preview img', image => image.src.includes('/card-image?')), true);
        await page.evaluate(() => Promise.all([...document.querySelectorAll('.uas img')].map(image => image.decode())));
        assert.equal(await page.$eval('.uas-figure-art img', image => decodeURIComponent(image.src).includes('유니크아바타/전신/')), true);
        await page.hover('.uas-figure');
        assert.equal(await page.$eval('.uas-figure', node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
        await page.mouse.move(0, 0);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 750)));
        await page.screenshot({ path: path.join(dir, 'avatar-showroom-desktop.png') });
        await page.click('.uas-lens-btn[data-focus="card"]');
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
        await page.screenshot({ path: path.join(dir, 'avatar-card-desktop.png') });
        await page.click('.uas-lens-btn[data-focus="cine"]');
        await page.waitForFunction(() => document.querySelector('.uas-cine-screen img')?.naturalWidth > 0);
        const firstCutscene = await page.$eval('.uas-cine-screen img', image => image.src);
        await page.screenshot({ path: path.join(dir, 'avatar-cutscene-desktop.png') });
        await page.click('.uas-cine-replay');
        await page.waitForFunction(previous => { const image = document.querySelector('.uas-cine-screen img'); return image && image.naturalWidth > 0 && image.src !== previous; }, {}, firstCutscene);
        assert.equal(await page.evaluate(url => __avatarRevokedUrls.includes(url), firstCutscene), true);
        const replayCutscene = await page.$eval('.uas-cine-screen img', image => image.src);
        await page.click('.uas-lens-btn[data-focus="figure"]');
        assert.equal(await page.evaluate(url => __avatarRevokedUrls.includes(url), replayCutscene), true);
        await page.setViewport({ width: 390, height: 844 });
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
        const recoveryOption = await page.$('::-p-text(회복 및 보호막 효과 +5%)');
        await recoveryOption.scrollIntoView();
        await recoveryOption.click();
        await page.waitForFunction(() => [...document.querySelectorAll('.unique-avatar-options button')].some(button => button.textContent === '회복 및 보호막 효과 +5%' && button.getAttribute('aria-pressed') === 'true'));
        assert.equal(httpUser.avatars.find(a => a.name === '[1차]유니크 빵귤').option, 'recovery');
        await page.mouse.move(0, 0);
        await page.screenshot({ path: path.join(dir, 'avatar-options-mobile.png') });
        assert.equal(await page.$eval('.uas', node => node.scrollWidth <= innerWidth + 1), true);
        await page.evaluate(() => [...document.querySelectorAll('button')].find(button => button.textContent === '장착').click());
        await page.waitForFunction(() => !document.querySelector('.unique-avatar-options'));
        assert.equal(httpUser.main_card.skin, '[1차]유니크 빵귤');
        await page.evaluate(async () => {
            const data = await api('/api/cards/avatars?source=main');
            openAvatarDetailModal(data.avatars.find(a => a.grade === '일반' && a.shop), { source: 'main' });
        });
        await page.waitForSelector('.uas-buy .uas-coin img');
        await page.evaluate(() => Promise.all([...document.querySelectorAll('.uas img')].map(image => image.decode())));
        assert.equal(await page.$eval('.uas-figure-art img', image => decodeURIComponent(image.src).endsWith('필드/캐릭터/빵귤__일반__수영장 파티.png')), true);
        assert.equal(await page.$('.uas-lens-btn[data-focus="cine"]'), null);
        assert.equal(await page.$eval('.uas-buy .uas-coin img', image => image.naturalWidth > 0), true);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 750)));
        await page.screenshot({ path: path.join(dir, 'avatar-purchase-mobile.png') });
        await page.setViewport({ width: 1440, height: 1000 });
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 600)));
        await page.screenshot({ path: path.join(dir, 'avatar-purchase-desktop.png') });
        await page.evaluate(() => UniqueAvatarUI.closeShowroom());
        await page.setViewport({ width: 390, height: 844 });
        for (const [name, skin, file] of [['마쉐비', 'DVA', 'avatar-dva-mobile.png'], ['뭔마', '이터널스', 'avatar-eternals-mobile.png']]) {
            const previewUser = makeUser(); previewUser.main_card.id = read('CharacterCards').findIndex(card => card.name === name);
            webUsers.set(previewUser.name, previewUser);
            const { body: gallery } = await api('/api/cards/avatars?source=main', null, cookieFor(previewUser));
            await page.evaluate(avatar => openAvatarDetailModal(avatar, { source: 'main' }), gallery.avatars.find(avatar => avatar.name === skin));
            await page.waitForSelector('.uas-figure-art img');
            await page.evaluate(() => Promise.all([...document.querySelectorAll('.uas img')].map(image => image.decode())));
            assert.equal(await page.$eval('.uas-figure-art img', (image, expected) => decodeURIComponent(image.src).endsWith(expected), name + '__일반__' + skin + '.png'), true);
            await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 750)));
            await page.screenshot({ path: path.join(dir, file) });
            await page.evaluate(() => UniqueAvatarUI.closeShowroom());
        }
        await page.setViewport({ width: 1440, height: 1000 });
        const scene = rpg.getUniqueAvatarCutscene(httpUser);
        await page.addStyleTag({ url: base + '/static/ultimate-cutscene.css' });
        await page.addScriptTag({ url: base + '/static/ultimate-cutscene.js' });
        await page.evaluate(scene => { window.__uniqueTestCutscene = UltimateCutscene.create(); __uniqueTestCutscene.play({ action: 'skill', skillName: scene.skillName, uniqueCutscene: scene }, scene.characterName); }, scene);
        await page.waitForFunction(() => [...document.querySelectorAll('.ultimate-cutscene:not([hidden]) img')].some(image => image.complete && image.naturalWidth > 0));
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 450)));
        await page.screenshot({ path: path.join(dir, 'ultimate-cutscene.png') });
        await page.evaluate(() => __uniqueTestCutscene.destroy());
        await page.evaluate(() => activatePage('info'));
        await page.waitForSelector('#mainCard .card-name-halloween', { visible: true });
        await page.$eval('#mainCard img', image => image.decode());
        const titleCard = await page.$('#mainCard');
        await page.screenshot({ path: path.join(dir, 'halloween-profile-desktop.png') });
        for (const time of [0, 1600]) {
            await page.$eval('#mainCard .card-name-halloween', (node, time) => { const animation = node.getAnimations()[0]; animation.pause(); animation.currentTime = time; }, time);
            await titleCard.screenshot({ path: path.join(dir, 'halloween-name-' + time + '.png') });
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
