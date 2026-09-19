// 명시적으로 요청된 상품만 추가한다. 기본 실행은 미리보기이며 --apply일 때만 운영 DB를 변경한다.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId, readShopCatalog } = require('../shop_catalog');

const NAME = '지정 캐릭터 변환석 주머니';
function buildAddition(items, shop) {
    if (!Array.isArray(items) || !Array.isArray(shop?.패키지)) throw new Error('운영 Item 또는 패키지 상점 데이터가 없습니다. 초기화하지 않습니다.');
    const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../DB/RPGenius/CharacterCards.json'), 'utf8'));
    const choices = items.flatMap((item, id) => item?.use === '변환' && Number.isInteger(item.charId) && cards[item.charId] ? [{ id, count: 1 }] : []);
    if (!choices.length) throw new Error('운영 데이터에 지정 캐릭터 변환석이 없습니다.');
    const definition = { name: NAME, type: '사용', use: '아이템선택', no_trade: true, desc: '지정 캐릭터 변환석 1개를 선택해 획득한다. 주머니마다 각각 선택할 수 있다.', choices };
    const existing = items.findIndex(item => item?.name === NAME);
    const itemId = existing < 0 ? items.length : existing;
    if (existing >= 0 && (items[existing].use !== '아이템선택' || !isDeepStrictEqual(items[existing].choices, choices))) throw new Error('같은 이름의 기존 아이템 구성이 다릅니다. 덮어쓰지 않습니다.');
    const product = { shopId: newShopItemId(), type: '아이템', item_id: itemId, count: 1, price: { goods: 'point', amount: 1100 }, limits: { max: 3 } };
    const existingProduct = shop.패키지.find(item => item.type === '아이템' && item.item_id === itemId);
    if (existingProduct && (existingProduct.count !== 1 || !isDeepStrictEqual(existingProduct.price, product.price) || !isDeepStrictEqual(existingProduct.limits, product.limits))) throw new Error('기존 상품의 판매 조건이 다릅니다. 덮어쓰지 않습니다.');
    const nextItems = existing < 0 ? [...items, definition] : items;
    const nextShop = existingProduct ? shop : { ...shop, 패키지: [...shop.패키지, product] };
    readShopCatalog(nextShop);
    return { items: nextItems, shop: nextShop, itemId, product: existingProduct || product, changed: nextItems !== items || nextShop !== shop };
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
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const [items, shop] = await Promise.all([read('Item'), read('Shop')]);
    const next = buildAddition(items, shop);
    console.log(JSON.stringify({ itemId: next.itemId, item: next.items[next.itemId], product: next.product, changed: next.changed }, null, 2));
    if (!next.changed || !process.argv.includes('--apply')) return;
    const backupDir = path.join(os.tmpdir(), 'tcgenius-shop-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, 'character-stone-pouch-' + Date.now() + '.json');
    fs.writeFileSync(backup, JSON.stringify({ Item: items, Shop: shop }, null, 2));
    // 두 목록의 동시 편집을 확인하고 함께 저장한다. 기존 행·다른 상점·구매 기록은 수정하지 않는다.
    await db.send(new TransactWriteCommand({ TransactItems: [
        ['Item', items, next.items], ['Shop', shop, next.shop]
    ].map(([key, before, after]) => ({ Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
        ExpressionAttributeValues: { ':before': before, ':after': after }
    } })) }));
    const [savedItems, savedShop] = await Promise.all([read('Item'), read('Shop')]);
    if (!isDeepStrictEqual(savedItems, next.items) || !isDeepStrictEqual(savedShop, next.shop)) throw new Error('등록 후 동시 운영 변경이 감지되었습니다. 다시 확인해주세요.');
    console.log('등록 완료. 기존 아이템·상품·구매 기록 보존. 백업: ' + backup);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { NAME, buildAddition };
