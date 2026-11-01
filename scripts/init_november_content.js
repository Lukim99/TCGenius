'use strict';

// 직접 실행할 때만 요청된 11월 콘텐츠를 등록한다. 운영 구성과 기존 인덱스는 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const shopCatalog = require('../shop_catalog');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const names = ['카드박스IV', '[11월]보주 상자', '[11월]11강 장비강화권 상자'];

function prepare(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Bundle) || !Array.isArray(before.Pack) || !Array.isArray(before.Shop?.['가넷'])) throw new Error('운영 Item/Bundle/Pack/가넷 상점 데이터를 확인해주세요. 초기화하지 않습니다.');
    const after = structuredClone(before);
    // 삽입으로 밀리는 상품도 원래 구매 제한 기록을 계속 참조한다.
    after.Shop = shopCatalog.readShopCatalog(before.Shop);
    const itemId = name => {
        const id = after.Item.findIndex(item => item?.name === name);
        if (id < 0) throw new Error('운영 구성품이 없습니다: ' + name);
        return id;
    };
    if (!after.Item.some(item => item?.name === names[0])) {
        const rewards = [['7성 카드팩', 1], ['6성 카드팩', 3]].map(([name, count]) => ({ type: '아이템', item_id: itemId(name), count: { min: count, max: count } }));
        after.Item.push({ name: names[0], type: '번들', no_trade: true, desc: '7성 카드팩 1개, 6성 카드팩 3개가 들어있는 카드 박스이다.', pack: after.Bundle.length });
        after.Bundle.push(rewards);
    }
    if (!after.Item.some(item => item?.name === names[1])) {
        if (after.Item[itemId('보주 상자')].use !== '보주상자' || !after.Item.some(item => item?.use === '보주')) throw new Error('운영 보주 상자와 보주 구성을 확인해주세요.');
        after.Item.push({ name: names[1], type: '가챠', use: '보주상자', sellPrice: 60000000, desc: '사용 시 랜덤 보주 1개를 획득한다.' });
    }
    if (!after.Item.some(item => item?.name === names[2])) {
        // 사용자가 선택한 기존 강화권 상자의 등장 확률을 그대로 사용한다.
        const source = after.Pack[after.Item[itemId('[6월]9강 강화권 상자')].pack];
        const chances = [0.05, 0.1, 0.3, 0.5, 0.7, 0.9];
        if (!Array.isArray(source) || source.length !== chances.length || Math.abs(source.reduce((sum, entry) => sum + entry.roll, 0) - 1) > 1e-9) throw new Error('기존 강화권 상자 확률 구성을 확인해주세요.');
        const rewards = chances.map(chance => {
            const entries = source.filter(entry => entry.type === '아이템' && after.Item[entry.item_id]?.ug?.level === 9 && after.Item[entry.item_id]?.ug?.roll === chance);
            if (entries.length !== 1 || !(entries[0].roll > 0)) throw new Error('기존 강화권 상자 구성품을 확인해주세요: ' + chance);
            const id = itemId((chance * 100) + '프로 +11 장비 강화권');
            const ticket = after.Item[id];
            if (ticket.use !== '장비강화권' || ticket.ug?.level !== 11 || ticket.ug?.roll !== chance) throw new Error('11강 장비 강화권 정보를 확인해주세요: ' + ticket.name);
            return { type: '아이템', item_id: id, count: { min: 1, max: 1 }, roll: entries[0].roll };
        });
        after.Item.push({ name: names[2], type: '가챠', sellPrice: 30000000, desc: '사용 시 성공률 5%, 10%, 30%, 50%, 70%, 90%의 11강 장비강화권 중 1개를 획득한다.', pack: after.Pack.length });
        after.Pack.push(rewards);
    }
    const lockbox = after.Item[itemId('봉인된 자물쇠')];
    const pack = after.Pack[lockbox.pack];
    if (!Array.isArray(pack)) throw new Error('운영 자물쇠 보상 구성을 확인해주세요.');
    for (const [oldName, newName] of [['[10월]각성보석세트', names[1]], ['[10월]조합성공률30%증가럭키카드', names[2]]]) {
        const nextId = itemId(newName);
        const entries = pack.filter(entry => entry?.type === '아이템' && (after.Item[entry.item_id]?.name === oldName || entry.item_id === nextId));
        if (entries.length !== 1) throw new Error('이달의 아이템 슬롯을 확인해주세요: ' + oldName);
        entries[0].item_id = nextId;
    }
    const cardBoxId = itemId(names[0]);
    if (!Object.values(after.Shop).some(products => Array.isArray(products) && products.some(product => product?.type === '아이템' && product.item_id === cardBoxId))) {
        const previousId = itemId('카드박스III');
        const index = after.Shop['가넷'].findIndex(product => product?.type === '아이템' && product.item_id === previousId);
        if (index < 0) throw new Error('가넷 상점에 카드박스III가 없습니다.');
        after.Shop['가넷'].splice(index + 1, 0, { shopId: shopCatalog.newShopItemId(), type: '아이템', item_id: cardBoxId, count: 1, price: { goods: 'garnet', amount: 800 }, limits: {} });
    }
    shopCatalog.validateShopCatalog(after.Shop, shopCatalog.readShopCatalog(before.Shop));
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
    const keys = ['Item', 'Bundle', 'Pack', 'Shop'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, items: names.map(name => {
        const id = after.Item.findIndex(item => item?.name === name), item = after.Item[id];
        return { id, ...item, rewards: typeof item.pack === 'number' ? after[item.type === '번들' ? 'Bundle' : 'Pack'][item.pack] : undefined };
    }), monthly: after.Pack[after.Item.find(item => item?.name === '봉인된 자물쇠').pack].slice(0, 2), product: after.Shop['가넷'].find(product => after.Item[product.item_id]?.name === names[0]) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const index = process.argv.indexOf('--backup-dir');
    if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('--')) throw new Error('--apply에는 --backup-dir 경로가 필요합니다.');
    const backupDir = path.resolve(process.argv[index + 1]);
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, 'november-before-' + Date.now() + '.json');
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after', ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('등록 후 운영 데이터가 변경되었습니다: ' + key);
    console.log('11월 콘텐츠 등록·읽기 검증 완료. 백업: ' + backup);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { names, prepare };
