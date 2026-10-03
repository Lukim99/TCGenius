// 요청된 두 상품만 명시적으로 등록한다. 운영 꾸러미·상품·아이템 인덱스는 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const shopCatalog = require('../shop_catalog');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const definitions = [
    { name: '한가위맞이각성패키지', price: 4900, max: 2, desc: '구매 즉시 9성 랜덤 각성 캐릭터 카드 1장, 8성 전직 카드팩 3개, 윷 16개를 지급한다.',
        rewards: [{ type: '캐릭터카드', card_type: '각성', display_star: 9, count: 1 }, { name: '8성 전직 카드팩', count: 3 }, { name: '윷', count: 16 }] },
    { name: '한가위맞이강화패키지', price: 1500, max: 3, desc: '구매 즉시 고급 장비 보호권 3개, 상급 강화석 600개, 윷 8개를 지급한다.',
        rewards: [{ name: '고급 장비 보호권', count: 3 }, { name: '상급 강화석', count: 600 }, { name: '윷', count: 8 }] }
];

function appendPackages(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Bundle) || !before.Shop || Array.isArray(before.Shop)) throw new Error('운영 Item/Bundle/Shop 데이터가 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    if (after.Shop['패키지'] == null) after.Shop['패키지'] = [];
    if (!Array.isArray(after.Shop['패키지'])) throw new Error('운영 패키지 상점 형식을 확인해주세요.');
    for (const definition of definitions) {
        let itemId = after.Item.findIndex(item => item && item.name === definition.name);
        if (itemId < 0) {
            const rewards = definition.rewards.map(reward => {
                if (!reward.name) return structuredClone(reward);
                const id = after.Item.findIndex(item => item && item.name === reward.name);
                if (id < 0) throw new Error('운영 구성품이 없습니다: ' + reward.name);
                return { type: '아이템', item_id: id, count: reward.count };
            });
            itemId = after.Item.length;
            after.Item.push({ type: '번들', name: definition.name, desc: definition.desc, pack: after.Bundle.length });
            after.Bundle.push(rewards);
        }
        // 이미 운영자가 다른 상점으로 옮긴 상품도 동일 상품으로 인정한다.
        if (!Object.values(after.Shop).some(items => Array.isArray(items) && items.some(item => item.type === '아이템' && item.item_id === itemId))) {
            after.Shop['패키지'].push({ shopId: shopCatalog.newShopItemId(), type: '아이템', item_id: itemId, count: 1, price: { goods: 'point', amount: definition.price }, limits: { max: definition.max } });
        }
    }
    shopCatalog.readShopCatalog(after.Shop); // 구형 상품 ID는 읽기 표현에만 보완한다.
    return after;
}

async function main() {
    for (const file of ['.env', '.env.local']) {
        const full = path.join(__dirname, '..', file);
        if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const before = {};
    for (const key of ['Item', 'Bundle', 'Shop']) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        before[key] = result.Item && result.Item.data;
    }
    const after = appendPackages(before);
    const changed = Object.keys(before).filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, packages: definitions.map(definition => {
        const id = after.Item.findIndex(item => item && item.name === definition.name);
        return { itemId: id, item: after.Item[id], rewards: after.Bundle[after.Item[id].pack], product: Object.values(after.Shop).flat().find(item => item.type === '아이템' && item.item_id === id) };
    }) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    await db.send(new TransactWriteCommand({ TransactItems: Object.keys(before).map(key => changed.includes(key) ? { Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key], ':after': after[key] }
    } } : { ConditionCheck: {
        TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] }
    } }) }));
    for (const key of Object.keys(after)) {
        const result = await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }));
        if (!isDeepStrictEqual(result.Item && result.Item.data, after[key])) throw new Error(key + ' 등록 후 읽기 검증이 일치하지 않습니다.');
    }
    console.log('두 패키지 등록·읽기 검증 완료. 기존 운영 구성과 인덱스는 보존했습니다.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definitions, appendPackages };
