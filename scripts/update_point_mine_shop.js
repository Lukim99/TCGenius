'use strict';

// 요청된 상점 상품만 명시적으로 변경한다. 서버 시작에서는 실행하지 않는다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { KEY_NAME } = require('../point_mine_config');
const { newShopItemId, legacyShopItemId, readShopCatalog, validateShopCatalog } = require('../shop_catalog');

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
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item;
    const [itemRecord, shopRecord] = await Promise.all([read('Item'), read('Shop')]);
    const items = itemRecord?.data, before = shopRecord?.data;
    if (!Array.isArray(items) || !Array.isArray(before?.['일반']) || !Array.isArray(before?.['포인트'])) throw new Error('기존 운영 아이템과 상점이 필요합니다. 초기화하지 않습니다.');
    for (const name of ['송편', KEY_NAME]) if (items.filter(item => item?.name === name).length !== 1) throw new Error('운영 아이템을 확인해주세요: ' + name);
    const songId = items.findIndex(item => item?.name === '송편'), keyId = items.findIndex(item => item?.name === KEY_NAME);
    const after = structuredClone(before);
    let index = after['일반'].findIndex(item => item.type === '아이템' && item.item_id === songId);
    if (index < 0) index = after['일반'].findIndex(item => item.shopId === legacyShopItemId('일반', 10) && item.item_id === keyId);
    if (index < 0 || after['일반'][index].count !== 1) throw new Error('기존 송편 판매 상품을 확인해주세요. 다른 상품으로 대체하지 않습니다.');
    const standard = after['일반'][index];
    standard.shopId ||= legacyShopItemId('일반', index);
    standard.item_id = keyId;
    standard.limits = { ...standard.limits, daily: 1 };
    let point = after['포인트'].find(item => item.type === '아이템' && item.item_id === keyId);
    if (!point) {
        point = { shopId: newShopItemId(), type: '아이템', item_id: keyId, count: 1, limits: {}, price: { goods: 'point', amount: 100 } };
        after['포인트'].push(point);
    } else {
        point.count = 1;
        point.price = { ...point.price, goods: 'point', amount: 100 };
    }
    validateShopCatalog(readShopCatalog(after), readShopCatalog(before));
    console.log(JSON.stringify({ keyId, standard, point, updateShop: !isDeepStrictEqual(before, after) }, null, 2));
    if (!process.argv.includes('--apply') || isDeepStrictEqual(before, after)) return;
    const directory = path.join(__dirname, '..', 'output', 'point-mine');
    fs.mkdirSync(directory, { recursive: true });
    const backup = path.join(directory, 'shop-before-key-sale-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(backup, JSON.stringify({ Shop: before }, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: [
        { ConditionCheck: { TableName: 'rpgenius_data', Key: { key: 'Item' }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': items } } },
        { Update: { TableName: 'rpgenius_data', Key: { key: 'Shop' }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':after': after, ':before': before } } }
    ] }));
    const [afterItems, afterShop] = await Promise.all([read('Item'), read('Shop')]);
    if (!isDeepStrictEqual(afterItems.data, items) || !isDeepStrictEqual(afterShop.data, after)) throw new Error('동시 운영 변경 감지. 운영 데이터를 재확인해주세요.');
    console.log('상점 변경 완료. 기존 상품 ID·가격·다른 상품·아이템 정의·구매 기록은 보존했습니다. 변경 전 백업: ' + backup);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
