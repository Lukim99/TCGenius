'use strict';

// Explicit registration only. Imports/startup never write operational data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId, readShopCatalog } = require('../shop_catalog');

const definitions = [
    { name: '닉네임 변경권', type: '티켓', no_trade: true, desc: '캐릭터 선택 화면에서 1개를 소모하여 캐릭터 이름을 변경한다. 계정 로그인 이름은 유지된다.' },
    { name: '카드 전송기', type: '티켓', no_trade: true, desc: '캐릭터 선택 화면에서 1개를 소모하여 같은 계정의 다른 캐릭터에게 보관 중인 카드 1개를 이전한다. 거래권은 소모하지 않는다.' },
    { name: '장비 전송기', type: '티켓', no_trade: true, desc: '캐릭터 선택 화면에서 1개를 소모하여 같은 계정의 다른 캐릭터에게 보관 중인 초월 장비 1개를 이전한다.' },
    { name: '캐릭터 슬롯 확장권', type: '티켓', no_trade: true, desc: '캐릭터 선택 화면에서 1개를 소모하여 계정의 캐릭터 자리를 한 칸 늘린다.' }
];

function prepare(before, { itemsOnly = false } = {}) {
    if (!Array.isArray(before.Item) || !itemsOnly && !Array.isArray(before.Shop?.['포인트'])) throw new Error('운영 Item/포인트 상점이 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    for (const item of definitions) if (!after.Item.some(existing => existing?.name === item.name)) after.Item.push(item);
    if (itemsOnly) return after;
    const id = after.Item.findIndex(item => item?.name === '닉네임 변경권');
    if (!Object.values(after.Shop).flat().some(product => product?.type === '아이템' && product.item_id === id)) {
        after.Shop['포인트'].push({ shopId: newShopItemId(), type: '아이템', item_id: id, count: 1, price: { goods: 'point', amount: 300 } });
    }
    // Transmitters can be granted through existing admin rewards. No unapproved prices or pouch listing.
    readShopCatalog(after.Shop);
    return after;
}

async function main() {
    const envDir = process.argv.find(arg => arg.startsWith('--env-dir='))?.slice(10) || path.join(__dirname, '..');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(envDir, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*(AWS_[A-Z_]+)=(.*)$/);
            if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-2', credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID
    } }));
    const itemsOnly = process.argv.includes('--items-only'), keys = itemsOnly ? ['Item'] : ['Item', 'Shop'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before, { itemsOnly }), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, addedItems: after.Item.slice(before.Item.length), addedProducts: itemsOnly ? [] : after.Shop['포인트'].slice(before.Shop['포인트'].length) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const folder = path.join(os.tmpdir(), 'tcgenius-shop-backups');
    fs.mkdirSync(folder, { recursive: true });
    const backup = path.join(folder, 'character-items-' + Date.now() + '.json');
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const condition = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before',
            ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...condition, UpdateExpression: 'SET #data = :after',
            ExpressionAttributeValues: { ...condition.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: condition };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('등록 후 동시 변경이 감지되었습니다: ' + key);
    console.log('등록 및 읽기 검증 완료. 기존 운영 설정 보존. 백업: ' + backup);
}

module.exports = { definitions, prepare };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
