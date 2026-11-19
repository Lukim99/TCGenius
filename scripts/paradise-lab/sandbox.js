// 천상 실험실들이 함께 쓰는 모래상자. 실제 server.js와 rpgenius를 메모리 DB로 띄운다.
// 운영 DynamoDB와 S3에 닿지 않는다(tests/paradise_prism.test.js와 같은 가짜 저장소). 이미지 자산은 git에 없어 비어 보일 수 있다.
// 쓰는 곳: scripts/paradise-lab/server.js(천상 흐름), scripts/augment-lab/server.js(증강 연출과 실전).
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..', '..');
process.env.ADMIN_SESSION_SECRET = 'paradise-lab';
process.chdir(ROOT);
const express = require(path.join(ROOT, 'node_modules', 'express'));
const AWS = require(path.join(ROOT, 'node_modules', 'aws-sdk'));
const { DynamoDBDocumentClient } = require(path.join(ROOT, 'node_modules', '@aws-sdk', 'lib-dynamodb'));

const data = {};
for (const key of ['Item', 'Equipment', 'Bundle', 'Recipe', 'Pack', 'Pet']) data[key] = JSON.parse(fs.readFileSync(path.join(ROOT, 'DB/RPGenius', key + '.json'), 'utf8'));
data.Item.push({ type: '티켓', name: '천상의 회랑 입장권' });
data.Paradise = { enabled: true, baseRewards: [{ type: '골드', count: 100, perFloors: 1 }] };
data.Quest = []; data.Shop = {};
const account = { _get: 1, name: '실험자', id: 'paradise-lab-id', code: 'LAB', level: 300, logged_in: [], avatarMigrated: true, need_character_card_select: false, main_card: { id: 0, star: 6, type: '일반' }, inventory: { card: [], item: [], equipment: [], pet: [] } };
const persisted = new Map([[account.id, structuredClone(account)]]);
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    throw new Error('실험실은 S3를 쓰지 않습니다: ' + operation);
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input, type = command.constructor.name;
    if (input.TableName === 'rpgenius_mail') return type === 'GetCommand' ? {} : {};
    if (type === 'GetCommand') return input.TableName === 'rpgenius_data' ? { Item: data[input.Key.key] === undefined ? undefined : { data: structuredClone(data[input.Key.key]) } } : { Item: structuredClone(persisted.get(input.Key.id)) };
    if (type === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [...persisted.values()].map(v => structuredClone(v)) : [] };
    if (type === 'PutCommand' && input.TableName === 'rpgenius_data') { data[input.Item.key] = structuredClone(input.Item.data); return {}; }
    if (type === 'UpdateCommand' && input.TableName === 'rpgenius_data') return {};
    if (type === 'UpdateCommand' && input.TableName === 'rpgenius_user') {
        const user = persisted.get(input.Key.id), names = input.ExpressionAttributeNames || {}, values = input.ExpressionAttributeValues || {};
        for (const [, alias, value] of String(input.UpdateExpression).matchAll(/(#[a-zA-Z0-9_]+)\s*=\s*(:[a-zA-Z0-9_]+)/g)) if (names[alias]) user[names[alias]] = structuredClone(values[value]);
        for (const [, alias] of String(input.UpdateExpression).matchAll(/REMOVE\s+(#[a-zA-Z0-9_]+)/g)) if (names[alias]) delete user[names[alias]];
        return {};
    }
    return {};
};

const rpg = require(path.join(ROOT, 'rpgenius'));
const corridor = require(path.join(ROOT, 'paradise'));
const boons = require(path.join(ROOT, 'paradise_boons'));
const prism = require(path.join(ROOT, 'paradise_prism'));
const { AUGMENTS } = require(path.join(ROOT, 'paradise_content'));

function cookie() {
    const body = Buffer.from(JSON.stringify({ name: account.name, admin: false, exp: Date.now() + 86400000 })).toString('base64url');
    return 'rpg_admin=' + body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
async function reset() {
    rpg.clearFieldRuntimeTimers(account.name);
    const user = await rpg.getRPGUserByName(account.name);
    Object.assign(user, new rpg.RPGUser(account.name, account.id), structuredClone(account));
    user.field = null; user.paradise = null; user.paradiseReceipt = null; user.paradiseWeekly = null; user.paradiseProgression = null; user.isAdmin = false;
    const stats = rpg.calculateUserStats(user); corridor.getResources(user).hp = stats.hp; corridor.getResources(user).mp = stats.mp;
    rpg.addInventoryItem(user, data.Item.length - 1, 5);
    return user;
}
async function win(user) { for (let i = 0; i < 2 && user.paradise.phase === 'combat'; i++) { user.paradise.enemy.hp = 1; user.field.nextActionAt = 0; await rpg.useBasicAttackInField(user); } }
// scenario: lobby | combat | augment | boon | stat | reward | all. query는 URLSearchParams(augments=id,id / wave=2).
async function scenario(name, query = new URLSearchParams()) {
    const user = await reset();
    if (name !== 'lobby') corridor.enter(user);
    const run = user.paradise;
    if (['augment', 'boon', 'stat', 'reward'].includes(name)) {
        if (name === 'augment') run.encounterWins = 3;
        await win(user);
        if (name === 'stat' || name === 'reward') boons.choose(user, { choice: name });
    }
    if (name === 'combat' || name === 'all') {
        const ids = name === 'all' ? AUGMENTS.map(a => a.id) : String(query.get('augments') || '').split(',').filter(Boolean);
        for (const id of ids) { run.acquired[id] = 1; prism.onAcquire(user, AUGMENTS.find(a => a.id === id)); }
        if (query.get('wave') === '2') { run.enemy.hp = 1; user.field.nextActionAt = 0; await rpg.useBasicAttackInField(user); }
        else corridor.startCombat(user, 'normal');
        // 연출을 오래 보려고 적 체력을 크게 둔다. tough=0이면 실제 체력 그대로(최대 HP 비례 피해를 실제 값으로 볼 때).
        if (query.get('tough') !== '0') { const enemy = run.enemy; enemy.hp = enemy.maxHp = Math.max(enemy.maxHp, 1e9); }
    }
    if (run) run.revision++;
    await user.save();
    return user;
}
// 열려 있던 화면의 폴링과 겹치지 않게 서버와 같은 순서 큐에서 실행한다.
async function queue(task) {
    const seed = await rpg.getRPGUserByName(account.name);
    return rpg.enqueueFieldAction(seed, () => task(seed));
}

let inner = null;
// 실제 server.js를 내부 포트에 띄우고 그 포트를 돌려준다.
async function start() {
    if (inner) return inner.address().port;
    await rpg.initRpgeniusData();
    const listen = express.application.listen;
    express.application.listen = function () { inner = listen.call(this, 0, '127.0.0.1'); return inner; };
    require(path.join(ROOT, 'server'))();
    express.application.listen = listen;
    await new Promise(resolve => inner.once('listening', resolve));
    return inner.address().port;
}
// 실험자 계정의 쿠키를 붙여 내부 서버로 넘긴다.
function proxy(req, res, port) {
    const headers = { ...req.headers, host: '127.0.0.1:' + port, cookie: cookie() };
    const upstream = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method, headers }, reply => { res.writeHead(reply.statusCode, reply.headers); reply.pipe(res); });
    upstream.on('error', error => { res.writeHead(502); res.end(error.message); });
    req.pipe(upstream);
}

module.exports = { ROOT, account, rpg, corridor, boons, prism, AUGMENTS, cookie, reset, win, scenario, queue, start, proxy };
