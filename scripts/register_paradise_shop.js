// 명시 실행 전용: 기존 운영 설정을 보존하며 신규 상점과 누락된 아이템만 등록한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const PRODUCTS = [
    ['hell-key', '지옥 열쇠', 'tokens', 500000],
    ['orb-box', '보주 상자', 'tokens', 100000],
    ['rukim-day', '루킴의 축복 사용권 (1일)', 'tokens', 50000],
    ['transcend-box', '초월 상자', 'tokens', 50000],
    ['legendary-box', '레전더리 장비 랜덤 상자', 'tokens', 30000],
    ['unique-gem', '고유의 보석', 'tokens', 20000],
    ['unique-support', '고유 보조 장비 상자', 'tokens', 20000],
    ['trade-ticket', '거래권', 'tokens', 1000, 10],
    ['warcry', '투신의 함성 포션', 'tokens', 100],
    ['heaven-weekly-1', '천상의 회랑 입장권', 'gold', 1000000, 1],
    ['heaven-weekly-2', '천상의 회랑 입장권', 'gold', 10000000, 2],
    ['heaven-ticket', '천상의 회랑 입장권', 'gold', 100000000]
].map(([id, item, currency, price, weeklyLimit]) => ({ id, item, currency, price, ...(weeklyLimit ? { weeklyLimit } : {}) }));
const LEGENDARY_BOX = { name: '레전더리 장비 랜덤 상자', type: '가챠', desc: '레전더리 등급 무기, 방어구, 장신구 중 하나를 무작위로 획득합니다.', pack: { type: '장비 상자', rarity: '레전더리' } };
function appendShop(before) {
    if (!Array.isArray(before.Item) || !before.Paradise) throw new Error('운영 Item 또는 Paradise 설정이 없습니다. 초기화하지 않습니다.');
    const after = structuredClone(before);
    if (!after.Item.some(item => item?.name === LEGENDARY_BOX.name)) after.Item.push(structuredClone(LEGENDARY_BOX));
    if (after.Paradise.shop === undefined) after.Paradise.shop = structuredClone(PRODUCTS);
    // 운영자가 비워 둔 상점이나 기존 가격/한도는 덮어쓰지 않는다.
    for (const product of after.Paradise.shop) if (!after.Item.some(item => item?.name === product.item)) throw new Error('누락된 운영 아이템: ' + product.item);
    return after;
}
async function main() {
    const root = path.join(__dirname, '..');
    for (const filename of ['.env', '.env.local']) {
        const full = path.join(root, filename); if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const before = {};
    for (const key of ['Item', 'Paradise']) before[key] = (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const after = appendShop(before), changed = Object.keys(after).filter(key => !isDeepStrictEqual(after[key], before[key]));
    console.log(JSON.stringify({ changed, existingItemsPreserved: isDeepStrictEqual(after.Item.slice(0, before.Item.length), before.Item), shop: after.Paradise.shop }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const backup = path.join(root, 'output', 'paradise-shop', 'before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, JSON.stringify(before, null, 2));
    await db.send(new TransactWriteCommand({ TransactItems: changed.map(key => ({ Update: {
        TableName: 'rpgenius_data', Key: { key }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before',
        ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key], ':after': after[key] }
    } })) }));
    for (const key of changed) if (!isDeepStrictEqual((await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data, after[key])) throw new Error(key + ' 등록 후 검증 불일치');
    console.log('낙원 상점 등록 및 읽기 검증 완료');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { PRODUCTS, LEGENDARY_BOX, appendShop };
