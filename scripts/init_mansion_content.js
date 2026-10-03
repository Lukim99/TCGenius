// 직접 실행한 경우에만 누락된 신규 운영 항목을 추가한다. 기존 구성/인덱스는 보존한다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { MATERIALS } = require('../artifacts');

function appendMansion(before) {
    if (!Array.isArray(before.Item) || !before.Equipment || !Array.isArray(before.Pet) || !Array.isArray(before.Recipe) || !before.Shop) throw new Error('운영 Item/Equipment/Pet/Recipe/Shop 데이터가 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    const item = definition => {
        let id = after.Item.findIndex(data => data && data.name === definition.name);
        if (id < 0) { id = after.Item.length; after.Item.push(definition); }
        return id;
    };
    const materialId = item({ type: '재료', name: '아티팩트 재료', desc: '아티팩트를 분해해 얻으며 아티팩트 제작에 사용한다.' });
    const shardId = item({ type: '재료', name: '이세계 파편', desc: 'E세계 대저택 레이드 보상. 레이드 상점에서 사용한다.' });
    const potionId = item({ type: '소모품', name: '투신의 함성 포션', desc: '60초간 최종 공격력 +25%.', use_func: [{ type: '최종공격력비약', amount: .25, duration: 60 }] });
    if (!after.Equipment.artifact) after.Equipment.artifact = [];
    if (!Array.isArray(after.Equipment.artifact)) throw new Error('운영 아티팩트 장비 정의가 올바르지 않습니다.');
    const artifactIds = {};
    for (const rarity of Object.keys(MATERIALS)) {
        let id = after.Equipment.artifact.findIndex(data => data && data.rarity === rarity && data.name === '아티팩트');
        if (id < 0) { id = after.Equipment.artifact.length; after.Equipment.artifact.push({ name: '아티팩트', rarity, artifact: true, stat: {}, plusStat: {}, desc: '조건 충족 시 활성화되는 옵션을 가진 장비. 최초 장착 전 거래 1회, 재설정 최대 3회.' }); }
        artifactIds[rarity] = id;
        const name = '[' + rarity + ']아티팩트';
        if (!after.Recipe.some(recipe => recipe && recipe.name === name)) after.Recipe.push({ name, materials: [{ type: '아이템', item_id: materialId, count: MATERIALS[rarity][2] }], crafted: [{ type: '아티팩트', artifact_id: id, count: 1 }] });
    }
    const pets = {};
    for (const definition of [{ name: '조각', rarity: '유니크', stat: {}, plusStat: { finalAtk: .01 }, desc: '최종 공격력 +1%.', upgrade: [] }, { name: '위플래쉬', rarity: '레전더리', stat: {}, plusStat: { gold: .1 }, desc: '골드 획득량 +10%.', upgrade: [] }]) {
        let id = after.Pet.findIndex(pet => pet && pet.name === definition.name && pet.rarity === definition.rarity);
        if (id < 0) { id = after.Pet.length; after.Pet.push(definition); }
        pets[definition.name] = id;
    }
    const existingItem = name => { const id = after.Item.findIndex(data => data && data.name === name); if (id < 0) throw new Error('기존 운영 아이템이 없습니다: ' + name); return id; };
    if (!after.Shop['레이드']) after.Shop['레이드'] = [];
    if (!Array.isArray(after.Shop['레이드'])) throw new Error('운영 레이드 상점이 배열이 아닙니다.');
    const products = [
        ['legendary-first', 20, { type: '아티팩트', artifact_id: artifactIds['레전더리'], limits: { max: 1 } }],
        ['legendary', 60, { type: '아티팩트', artifact_id: artifactIds['레전더리'] }],
        ['unique', 10, { type: '아티팩트', artifact_id: artifactIds['유니크'] }],
        ['rare', 3, { type: '아티팩트', artifact_id: artifactIds['레어'] }],
        ['zeta-first', 20, { type: '아이템', item_id: existingItem('제타 카드팩'), limits: { max: 1 } }],
        ['nine', 50, { type: '아이템', item_id: existingItem('9성 카드팩') }],
        ['eight', 20, { type: '아이템', item_id: existingItem('8성 카드팩') }],
        ['stone', 1, { type: '아이템', item_id: existingItem('상급 강화석'), count: 50 }],
        ['support', 25, { type: '아이템', item_id: existingItem('고유 보조 장비 상자') }],
        ['gem', 15, { type: '아이템', item_id: existingItem('고유의 보석') }],
        ['potion', 1, { type: '아이템', item_id: potionId, count: 3 }]
    ];
    for (const [key, amount, product] of products) {
        const contentKey = 'mansion-shard-' + key;
        if (!after.Shop['레이드'].some(entry => entry && entry.contentKey === contentKey)) after.Shop['레이드'].push({ shopId: 'shop_' + crypto.createHash('md5').update(contentKey).digest('hex'), contentKey, materialTab: '이세계 파편', count: 1, ...product, price: { goods: 'item', item_id: shardId, amount } });
    }
    return { after, materialId, shardId, potionId, artifactIds, pets };
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
    const records = {}, before = {};
    for (const key of ['Item', 'Equipment', 'Pet', 'Recipe', 'Shop']) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        records[key] = result.Item; before[key] = result.Item && result.Item.data;
    }
    const result = appendMansion(before), after = result.after;
    const changed = Object.keys(before).filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ ...result, after: undefined, changed }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const index = process.argv.indexOf('--backup-dir');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--apply에는 --backup-dir 경로가 필요합니다.');
    const backupDir = path.resolve(process.argv[index + 1]); fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'mansion-before-' + Date.now() + '.json'), JSON.stringify(records, null, 2));
    await db.send(new TransactWriteCommand({ TransactItems: Object.keys(before).map(key => changed.includes(key) ? { Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key], ':after': after[key] }
    } } : { ConditionCheck: { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } } }) }));
    for (const key of Object.keys(after)) {
        const saved = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        if (!isDeepStrictEqual(saved.Item && saved.Item.data, after[key])) throw new Error(key + ' 등록 후 검증 불일치');
    }
    console.log('신규 누락 항목 등록 및 전체 읽기 검증 완료. 기존 운영 데이터 보존.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { appendMansion };
