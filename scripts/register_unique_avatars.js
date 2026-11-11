'use strict';

// Explicit release operation only; never imported by startup to mutate live definitions.
const fs = require('fs'), path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId } = require('../shop_catalog');
const { CUBES, nameFor } = require('../unique_avatar');
const characters = JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius/CharacterCards.json'), 'utf8'));
const fashions = characters.map((character, id) => ({ name: nameFor(character.name), primary_card: [id], uniqueSeries: 1,
    requireStar: 0, option: { stat: { atk: 250, hp: 2500 }, plusStat: {} },
    desc: '1차 유니크 아바타. 비전투 중 추가 옵션 1개를 자유롭게 선택할 수 있다. 최대 3회 거래 가능.' }));
function prepare(before) {
    if (!Array.isArray(before.Fashion) || !Array.isArray(before.Item) || !Array.isArray(before.Shop?.['포인트']) || !Array.isArray(before.Shop?.['마일리지'])) throw new Error('기존 운영 데이터가 필요합니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    fashions.forEach(fashion => { if (!after.Fashion.some(old => old?.name === fashion.name)) after.Fashion.push(fashion); });
    for (const cube of CUBES) {
        let id = after.Item.findIndex(item => item?.name === cube.name);
        if (id < 0) {
            id = after.Item.length;
            after.Item.push({ name: cube.name, type: '사용', use: '바인드큐브', desc: '아바타 2개를 합성하여 선택한 캐릭터의 아바타를 획득한다. 유니크 확률 ' + Math.round(cube.chance * 100) + '%. 계정 공통 15번째 합성은 유니크 확정이며 획득 시 누적 횟수가 초기화된다.' });
        }
        const tab = cube.goods === 'point' ? '포인트' : '마일리지';
        if (!Object.values(after.Shop).some(list => Array.isArray(list) && list.some(entry => entry?.type === '아이템' && entry.item_id === id))) after.Shop[tab].push({
            shopId: newShopItemId(), type: '아이템', item_id: id, count: 1, limits: {}, price: { goods: cube.goods, amount: cube.price }
        });
    }
    return after;
}
async function main() {
    for (const file of ['.env', '.env.local']) for (const line of fs.readFileSync(path.join(__dirname, '..', file), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([^#=]+)=(.*)$/); if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const keys = ['Fashion', 'Item', 'Shop'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, avatars: after.Fashion.slice(before.Fashion.length).map(f => f.name), items: after.Item.slice(before.Item.length).map(i => i.name), cubes: CUBES }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const dir = path.join(__dirname, '../output/unique-avatar'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'registration-before-' + Date.now() + '.json'), JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after', ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('등록 후 운영 변경 감지: ' + key);
    fs.writeFileSync(path.join(dir, 'registration-verified.json'), JSON.stringify({ at: new Date().toISOString(), changed, avatars: fashions.length, cubes: CUBES.length }, null, 2));
    console.log('신규 유니크 아바타와 큐브 등록 완료. 기존 운영 항목과 인덱스는 보존했습니다.');
}
module.exports = { prepare, fashions };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
