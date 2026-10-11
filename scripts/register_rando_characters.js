'use strict';

// 직접 실행한 경우에만 요청된 신규 운영 항목과 주머니 선택지를 추가한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId } = require('../shop_catalog');
const transcend = require('../transcend_equipment');

const itemDefinitions = [
    { name: '워뇨띠 캐릭터 변환석', type: '사용', use: '변환', charId: 15, no_trade: true, desc: '지정한 캐릭터 카드의 캐릭터를 워뇨띠로 변환한다.' },
    { name: '키노 캐릭터 변환석', type: '사용', use: '변환', charId: 16, no_trade: true, desc: '지정한 캐릭터 카드의 캐릭터를 키노로 변환한다.' },
    { name: '각성 캐릭터 변환석', type: '사용', use: '각성캐릭터변환', no_trade: true, desc: '각성 카드의 캐릭터를 다른 각성 캐릭터로 무작위 변환한다. 등급과 각성 상태는 유지된다.' },
    { name: '왕꿈틀이', type: '미끼', rarity: '고급', desc: '고급 미끼. 캐릭터 카드를 직접 낚는다. 카드 인벤토리가 가득 차면 낚은 카드는 살림망에 보관된다.' }
];
const equipmentDefinitions = {
    weapon: transcend.definitions.weapon.filter(e => ['가면 스위처', '존버의 미학', '청심환', '박카스 스프레이'].includes(e.name)).map(e => ({ ...e, require: [] })),
    support: [
        { name: '럭키비키 키링', rarity: '고유', require: [], requireMainCard: [15], stat: { atk: 110, hp: 1000 }, statRange: { atk: 90, hp: 1000 }, plusStat: { wonyoddiShieldChance: .10 }, plusStatRange: { wonyoddiShieldChance: .10 }, upgrade: [], desc: '워뇨띠 전용 보조장비. 공격력 +110~200, 각성 패시브 보호막 획득 확률 +10~20%, 최대 HP +1000~2000.' },
        { name: '원빌리언 사원증', rarity: '고유', require: [], requireMainCard: [16], stat: { atk: 110, mental: 10 }, statRange: { atk: 90, mental: 10 }, plusStat: { dotDamage: .20 }, plusStatRange: { dotDamage: .10 }, upgrade: [], desc: '키노 전용 보조장비. 공격력 +110~200, 최대 정신력 +10~20, 지속 피해 +20~30%.' }
    ]
};
const fashionDefinition = { name: '란도랜드2', primary_card: [15, 16], requireStar: 6, option: { stat: { atk: 80, hp: 1000 }, plusStat: {} } };
// 0.0005%도 정확히 표현하는 정수 가중치: 합계 200,000.
const baitDefinition = { name: '왕꿈틀이', rewards: [
    { card: { star: 4, type: '일반' }, rate: 100000 }, { card: { star: 4, type: '전직' }, rate: 50000 }, { card: { star: 4, type: '각성' }, rate: 12000 },
    { card: { star: 5, type: '일반' }, rate: 24000 }, { card: { star: 5, type: '전직' }, rate: 8000 }, { card: { star: 5, type: '각성' }, rate: 2000 },
    { card: { star: 6, type: '일반' }, rate: 2200 }, { card: { star: 6, type: '전직' }, rate: 800 }, { card: { star: 6, type: '각성' }, rate: 600 },
    { card: { star: 7, type: '일반' }, rate: 200 }, { card: { star: 7, type: '전직' }, rate: 120 }, { card: { star: 7, type: '각성' }, rate: 40 },
    { card: { star: 8, type: '일반' }, rate: 20 }, { card: { star: 8, type: '전직' }, rate: 10 }, { card: { star: 8, type: '각성' }, rate: 4 },
    { card: { id: 15, star: 7, type: '각성' }, rate: 2 }, { card: { id: 16, star: 7, type: '각성' }, rate: 2 },
    { card: { id: 15, star: 8, type: '각성' }, rate: 1 }, { card: { id: 16, star: 8, type: '각성' }, rate: 1 }
] };

function prepare(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Equipment?.weapon) || !Array.isArray(before.Equipment?.support)
        || !Array.isArray(before.Fashion) || !Array.isArray(before.Shop?.['아바타']) || !Array.isArray(before.Shop?.['가넷']) || !Array.isArray(before.Bait)) throw new Error('기존 운영 데이터가 필요합니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    for (const item of itemDefinitions) if (!after.Item.some(e => e?.name === item.name)) after.Item.push(structuredClone(item));
    const pouch = after.Item.find(e => e?.name === '지정 캐릭터 변환석 주머니');
    if (!Array.isArray(pouch?.choices)) throw new Error('기존 지정 변환석 주머니 선택지를 확인해주세요.');
    for (const name of ['워뇨띠 캐릭터 변환석', '키노 캐릭터 변환석']) {
        const id = after.Item.findIndex(e => e?.name === name);
        if (!pouch.choices.some(e => Number(e.id) === id)) pouch.choices.push({ id, count: 1 });
    }
    for (const [part, entries] of Object.entries(equipmentDefinitions)) for (const item of entries) {
        if (!after.Equipment[part].some(e => e?.name === item.name)) after.Equipment[part].push(structuredClone(item));
    }
    if (!after.Fashion.some(e => e?.name === fashionDefinition.name)) after.Fashion.push(structuredClone(fashionDefinition));
    if (!after.Shop['아바타'].some(e => e?.fashion === fashionDefinition.name)) after.Shop['아바타'].push({ shopId: newShopItemId(), type: '아바타', fashion: fashionDefinition.name, count: 1, limits: {}, price: { goods: 'point', amount: 1200 } });
    const stoneId = after.Item.findIndex(e => e?.name === '각성 캐릭터 변환석');
    if (!after.Shop['가넷'].some(e => e?.type === '아이템' && Number(e.item_id) === stoneId)) after.Shop['가넷'].push({ shopId: newShopItemId(), type: '아이템', item_id: stoneId, count: 1, limits: {}, price: { goods: 'garnet', amount: 210 } });
    if (!after.Bait.some(e => e?.name === baitDefinition.name)) after.Bait.push(structuredClone(baitDefinition));
    return after;
}

async function main() {
    for (const name of ['.env', '.env.local']) {
        const file = path.join(__dirname, '..', name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const keys = ['Item', 'Equipment', 'Fashion', 'Shop', 'Bait'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, items: after.Item.slice(before.Item.length).map(e => e.name), weapons: after.Equipment.weapon.slice(before.Equipment.weapon.length).map(e => e.name), pouchChoices: after.Item.find(e => e.name === '지정 캐릭터 변환석 주머니').choices.length, baitWeight: baitDefinition.rewards.reduce((s, r) => s + r.rate, 0) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const dir = path.join(__dirname, '..', 'output', 'wonyoddi-kino');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, 'registration-before-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after', ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('동시 운영 변경 감지: ' + key);
    console.log('신규 등록 완료. 기존 운영 데이터 보존. 백업: ' + backup);
}

module.exports = { prepare, itemDefinitions, equipmentDefinitions, fashionDefinition, baitDefinition };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
