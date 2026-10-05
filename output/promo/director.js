// E세계대저택 홍보영상 촬영용 격리 서버.
// 실제 server.js / partyquest.js / mansion_raid.js 엔진을 그대로 띄우고, AWS 전송만 메모리로 격리한다.
// 녹화 스크립트(record.js)가 제어 포트로 연출 순서를 지시한다. 운영 DB·S3에는 쓰지 않는다.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const AWS = require('aws-sdk');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
const ROOT = path.join(__dirname, '..', '..');
const { appendMansion } = require(path.join(ROOT, 'scripts/init_mansion_content'));
const { appendOctober } = require(path.join(ROOT, 'scripts/init_october_content'));

const PORT = Number(process.env.PROMO_PORT || 4555);
const CTL_PORT = PORT + 1;
const data = {};
for (const key of ['Item', 'Equipment', 'Pet', 'Recipe', 'Bundle', 'Pack']) {
    const file = path.join(ROOT, 'DB', 'RPGenius', key + '.json');
    data[key] = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
}
data.Quest = []; data.Shop = {}; data.ShopState = {};
for (const name of ['제타 카드팩', '9성 카드팩', '8성 카드팩', '상급 강화석', '헬 도전장', '고유 보조 장비 상자', '고유의 보석', '용기의 보석', '초월 상자']) {
    if (!data.Item.some(item => item?.name === name)) data.Item.push({ name, type: name === '헬 도전장' ? '티켓' : name === '초월 상자' ? '가챠' : '재료' });
}
Object.assign(data, appendMansion(data).after);
Object.assign(data, appendOctober(data).after);

// 파티 구성: [이름, 캐릭터 카드 index, 카드 형태]
const CAST = [['루미에르', 4, '각성'], ['흑월', 6, '각성'], ['새벽검', 8, '전직'], ['모카라떼', 7, '각성']];
const seeds = CAST.map(([name, id, type]) => ({
    _get: 1, id: name + '-id', name, code: 'PROMO', level: 300, logged_in: [], avatarMigrated: true,
    need_character_card_select: false, main_card: { id, star: 8, type },
    inventory: { item: [], card: [], equipment: [], pet: [] }
}));
const records = new Map(seeds.map(seed => [seed.id, structuredClone(seed)]));
process.env.ADMIN_SESSION_SECRET = 'mansion-promo-isolated';
AWS.S3.prototype.makeRequest = function (operation) {
    if (operation === 'listObjectsV2') return { promise: async () => ({ Contents: [] }) };
    return { promise: async () => ({}) };
};
DynamoDBDocumentClient.prototype.send = async command => {
    const input = command.input, type = command.constructor.name;
    if (type === 'GetCommand') {
        if (input.TableName === 'rpgenius_data') return { Item: { data: structuredClone(data[input.Key.key] || {}) } };
        if (input.TableName === 'rpgenius_user') return { Item: structuredClone(records.get(input.Key.id)) };
        return {};
    }
    if (type === 'ScanCommand') return { Items: input.TableName === 'rpgenius_user' ? [...records.values()].map(r => structuredClone(r)) : [] };
    if (type === 'UpdateCommand' && input.TableName === 'rpgenius_user') {
        const record = records.get(input.Key.id);
        if (record) for (const m of input.UpdateExpression.matchAll(/(#\w+)\s*=\s*(:\w+)/g)) record[input.ExpressionAttributeNames[m[1]]] = structuredClone(input.ExpressionAttributeValues[m[2]]);
        return {};
    }
    return {};
};

const rpg = require(path.join(ROOT, 'rpgenius'));
const party = require(path.join(ROOT, 'partyquest'));
const raid = party.__test.mansionRaid;
const ME = CAST[0][0];
const BOTS = CAST.slice(1).map(c => c[0]);
const QUEST = 'mansionHard';

function cookie(name) {
    const body = Buffer.from(JSON.stringify({ name, admin: false, canPartyQuest: true, exp: Date.now() + 6 * 3600000 })).toString('base64url');
    return body + '.' + crypto.createHmac('sha256', process.env.ADMIN_SESSION_SECRET).update(body).digest('base64url');
}
const room = () => party.getRoomOf(ME);
const mon = () => room()?.monster;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 봇 파티원: 실제 공격/스킬 API 함수를 사람 속도로 호출한다.
let botsOn = false, guardOn = true;
function startBots() {
    botsOn = true;
    for (const [i, name] of BOTS.entries()) {
        (async () => {
            await sleep(200 * i);
            while (botsOn) {
                const r = room();
                if (r && r.state === 'inProgress') {
                    const member = r.members.find(m => m.name === name);
                    const skills = (member?.skills || []);
                    const ready = skills.filter(s => !(member.runtime.cooldownsUntil?.[s] > Date.now()));
                    if (ready.length && Math.random() < .35) party.useSkill(name, ready[Math.floor(Math.random() * ready.length)]);
                    else party.attackMobPhase(name);
                }
                await sleep(520 + Math.random() * 380);
            }
        })();
    }
    // 연출 중 파티원이 쓰러지지 않게 HP를 보정한다(피해 숫자·연출은 그대로 표시).
    setInterval(() => {
        const r = room(); if (!r || !guardOn || r.state !== 'inProgress') return;
        for (const m of r.members) if (m.runtime && !m.runtime.dead && m.runtime.hp < m.runtime.hpMax * .5) m.runtime.hp = Math.round(m.runtime.hpMax * (.62 + Math.random() * .2));
    }, 400);
}

function boostMembers() {
    for (const m of room().members) {
        Object.assign(m.baseSnapshot.stats, { atk: 80000 + Math.random() * 15000, crit: .55, critMul: 2.4, pnt: 1200, def: 900 });
        Object.assign(m.runtime, { hp: 324000, hpMax: 324000, mp: 50000, mpMax: 50000 });
    }
}

// 일반 패턴을 대본 순서대로만 발동시킨다(무작위 패턴 억제).
function holdPatterns() {
    const st = mon()?.bossState; if (!st?.timers) return;
    for (const k of Object.keys(st.timers)) st.timers[k] = 999;
}
setInterval(() => { if (mon()?.bossState?.mansion && !mon().bossState.__free) holdPatterns(); }, 100);
// 대본 전에 자연 피해로 체력 기믹이 먼저 열리지 않게 연출용 하한을 둔다.
let floorRatio = null;
setInterval(() => { const m = mon(); if (m && floorRatio !== null && m.bossState?.form !== 'transition') m.hpFloor = Math.round(m.hpMax * floorRatio); }, 50);

function withRandom(value, fn) {
    const orig = Math.random; Math.random = () => value;
    try { return fn(); } finally { Math.random = orig; }
}
function pattern(kind) {
    const m = mon(); holdPatterns();
    m.bossState.timers[kind] = .05;
    withRandom(0.01, () => raid.step(room(), m, .05)); // 대상 지정 패턴은 첫 파티원(촬영 시점)으로
}
function setHpRatio(ratio) { const m = mon(); m.hp = Math.round(m.hpMax * ratio); }
function skipGimmicksAfter(ratio) { for (const g of mon().bossState.hpGimmicks || []) if (g.ratio < ratio) g.fired = true; }
function event(kind) { return mon()?.bossState?.events?.find(e => e.kind === kind); }

async function solvePillars(botsOnly) {
    const ev = event('pillars'); if (!ev) return;
    const movers = botsOnly ? BOTS : [ME, ...BOTS];
    let guard = 0;
    while (event('pillars') && guard++ < 60) {
        for (const name of movers) {
            const e = event('pillars'); if (!e) break;
            const from = e.loads.indexOf(Math.max(...e.loads)), to = e.loads.indexOf(Math.min(...e.loads));
            if (e.loads[from] > 6 && e.loads[to] < 6) { const out = party.mansionAction(name, { eventId: e.id, action: 'transfer', from, to }); if (out.error) console.log('transfer', name, out.error); }
            await sleep(170);
        }
        await sleep(260);
    }
}

const beats = {
    async setup() {
        await rpg.initRpgeniusData();
        for (const seed of seeds) {
            const user = await rpg.getRPGUserByName(seed.name);
            user.unlockedRaids = ['mansionNormal', 'mansionHard', 'mansionNightmare']; user.gold = 3000000000;
            await user.save();
        }
        const created = await party.createRoom(ME, QUEST);
        if (!created.roomId) throw new Error(JSON.stringify(created));
        for (const name of BOTS) await party.joinRoom(created.roomId, name);
        for (const name of BOTS) party.setReady(name, true);
        // 봇도 실제 SSE에 접속해 온라인 상태로 표시한다.
        for (const name of BOTS) {
            fetch('http://127.0.0.1:' + PORT + '/api/party/stream', { headers: { Cookie: 'rpg_admin=' + cookie(name) } })
                .then(async res => { for await (const _ of res.body) { /* keep alive */ } }).catch(() => {});
        }
        return { roomId: created.roomId };
    },
    async start() {
        party.setReady(ME, true);
        const out = await party.start(ME);
        boostMembers(); startBots();
        return out;
    },
    async floor(v) { floorRatio = v === 'off' ? null : Number(v); if (floorRatio === null && mon()) mon().hpFloor = 0; return {}; },
    async act(kindAction) {
        const [kind, action] = kindAction.split(':'); const e = event(kind);
        return e ? party.mansionAction(ME, { eventId: e.id, action }) : { error: 'no event ' + kind };
    },
    async boost() { boostMembers(); startBots(); return {}; },
    async pattern(kind) { pattern(kind); return { events: mon().bossState.events.map(e => e.kind) }; },
    async hp(ratio) { setHpRatio(Number(ratio)); return { hp: mon().hp }; },
    async pillars() { setHpRatio(.695); return {}; },
    async solvePillars() { solvePillars(true); return {}; },
    async sculpture() { const st = mon().bossState; for (const g of st.hpGimmicks) if (g.ratio >= .6) g.fired = true; setHpRatio(.508); return {}; },
    async gauge(v) { room().supportGauge = Number(v); return {}; },
    async killPhase() { const st = mon().bossState; for (const g of st.hpGimmicks || []) g.fired = true; setHpRatio(.004); return {}; },
    async trial() { const st = mon().bossState; for (const g of st.hpGimmicks) if (g.ratio < .5) g.fired = true; setHpRatio(.745); return {}; },
    async toHpOne() { const st = mon().bossState; for (const g of st.hpGimmicks || []) g.fired = true; mon().hp = 2; return {}; },
    async free() { mon().bossState.__free = true; return {}; },
    async hold() { mon().bossState.__free = false; holdPatterns(); return {}; },
    async inversionSoon() { const st = mon().bossState; st.echoElapsed = Math.max(st.echoElapsed, 9.7); return {}; },
    async rupture() { const st = mon().bossState; st.echoTimer = 0.05; return {}; },
    async kill() { const m = mon(); m.hp = Math.max(1, Math.round(m.hpMax * .003)); return {}; },
    async guard(v) { guardOn = v !== '0'; return {}; },
    async bots(v) { if (v === '0') botsOn = false; else if (!botsOn) startBots(); return {}; },
    async state() {
        const r = room(); const m = r?.monster;
        return { state: r?.state, phase: r?.phaseIndex, hp: m?.hp, hpMax: m?.hpMax, form: m?.bossState?.form, events: m?.bossState?.events?.map(e => ({ kind: e.kind, remain: e.remain, stage: e.stage, damage: e.damage, hpMax: e.hpMax, loads: e.loads, pulse: e.pulse, target: e.target })), gauge: r?.supportGauge };
    },
    async debug() { const m = mon(); const st = m?.bossState; return { hp: m?.hp, ratio: m && m.hp / m.hpMax, floor: m?.hpFloor, stun: m?.stunRemain, gimmickActive: !!st?.gimmickActive, hpG: (st?.hpGimmicks || []).map(g => [g.ratio, g.fired]), events: st?.events?.map(e => e.kind), dead: room().members.filter(x => x.runtime.dead).map(x => x.name) }; },
    async cookie(name) { return { cookie: cookie(name || ME) }; }
};

(async () => {
    const listen = express.application.listen;
    let listener;
    express.application.listen = function () { listener = listen.call(this, PORT, '127.0.0.1'); return listener; };
    require(path.join(ROOT, 'server'))();
    express.application.listen = listen;
    await new Promise(r => listener.once('listening', r));
    http.createServer(async (req, res) => {
        const [, name, arg] = req.url.split('/').map(decodeURIComponent);
        try {
            if (!beats[name]) throw new Error('unknown beat ' + name);
            const out = await beats[name](arg);
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out || {}));
        } catch (e) { console.error(e); res.writeHead(500); res.end(JSON.stringify({ error: e.message })); }
    }).listen(CTL_PORT, '127.0.0.1', () => console.log('PROMO READY', PORT, CTL_PORT));
})();
