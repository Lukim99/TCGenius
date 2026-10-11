'use strict';

// 직접 실행할 때만 요청된 6종을 추가한다. 기존 운영 구성과 인덱스는 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId, readShopCatalog } = require('../shop_catalog');

const orbNames = ['급락전문 보주', '나무 보주', '나일로머스크 보주', '대학원생 보주', '베재댜겨쇼 보주', '스테브잡션 보주', '신호등 보주', '야치요 보주', '에스코바르 보주', '연기금 보주', '워뇨띠 보주', '코트 보주', '키노 보주'];
const randomOrbName = '란도랜드2 랜덤 보주';
const definitions = [
    { name: '왕꿈틀이맛보기패키지', price: 330, max: 1, rewards: [{ name: '왕꿈틀이', count: 15 }, { type: '가넷', count: 100 }] },
    { name: '왕꿈틀이패키지', price: 1100, max: 3, rewards: [{ name: '왕꿈틀이', count: 40 }, { type: '가넷', count: 500 }] },
    { name: '란도랜드2보주출시패키지', price: 2000, max: 3, rewards: [{ name: randomOrbName, count: 1, autoUse: true }] },
    ...['일리온', '워뇨띠', '키노'].map(name => ({ name: name + '출시기념패키지', price: 4900, max: 1,
        rewards: [{ name: name + ' 캐릭터 변환석', count: 2 }, { name: '헬 초대장', count: 500 }, { name: '9성 전직 카드팩', count: 1 }, { name: '9성 카드팩', count: 1 }] }))
];

function prepare(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Bundle) || !Array.isArray(before.Pack) || !before.Shop || Array.isArray(before.Shop) || !Array.isArray(before.Shop['패키지'])) throw new Error('운영 Item/Bundle/Pack/Shop 데이터를 확인해주세요. 초기화하지 않습니다.');
    const after = structuredClone(before);
    const itemId = name => {
        const id = after.Item.findIndex(item => item?.name === name);
        if (id < 0) throw new Error('운영 구성품이 없습니다: ' + name);
        return id;
    };
    if (!after.Item.some(item => item?.name === randomOrbName)) {
        const rewards = orbNames.map(name => {
            const id = itemId(name);
            if (after.Item[id].use !== '보주') throw new Error('운영 보주 아이템을 확인해주세요: ' + name);
            return { type: '아이템', item_id: id, count: 1, roll: 1 / orbNames.length };
        });
        after.Item.push({ name: randomOrbName, type: '가챠', no_trade: true, desc: '란도랜드2 보주 13종 중 하나를 동일한 확률로 획득한다.', pack: after.Pack.length });
        after.Pack.push(rewards);
    }
    for (const definition of definitions) {
        let id = after.Item.findIndex(item => item?.name === definition.name);
        if (id < 0) {
            const rewards = definition.rewards.map(reward => reward.name
                ? { type: '아이템', item_id: itemId(reward.name), count: reward.count, ...(reward.autoUse ? { autoUse: true } : {}) }
                : structuredClone(reward));
            const contents = definition.rewards.map(reward => (reward.name || reward.type) + ' x' + reward.count).join(', ');
            id = after.Item.length;
            after.Item.push({ name: definition.name, type: '번들', no_trade: true, desc: contents, pack: after.Bundle.length });
            after.Bundle.push(rewards);
        }
        if (!Object.values(after.Shop).some(products => Array.isArray(products) && products.some(product => product.type === '아이템' && product.item_id === id))) {
            after.Shop['패키지'].push({ shopId: newShopItemId(), contentKey: 'rando-release-package', type: '아이템', item_id: id, count: 1, price: { goods: 'point', amount: definition.price }, limits: { max: definition.max } });
        }
    }
    readShopCatalog(after.Shop);
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
    console.log(JSON.stringify({ changed, packages: definitions.map(definition => {
        const id = after.Item.findIndex(item => item?.name === definition.name);
        return { name: definition.name, itemId: id, rewards: after.Bundle[after.Item[id].pack], product: Object.values(after.Shop).flat().find(product => product.type === '아이템' && product.item_id === id) };
    }) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const dir = path.join(__dirname, '..', 'output', 'rando-packages');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, 'registration-before-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after', ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('등록 후 운영 데이터가 변경되었습니다: ' + key);
    console.log('패키지 6종 등록·읽기 검증 완료. 백업: ' + backup);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definitions, orbNames, randomOrbName, prepare };
