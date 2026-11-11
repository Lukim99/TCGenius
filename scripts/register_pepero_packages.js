'use strict';

const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const AWS = require('aws-sdk');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { newShopItemId } = require('../shop_catalog');
const randomName = '랜덤 빼빼로 1종 ×11';
const peperoNames = ['[이벤트]빼빼로', '[이벤트]누드 빼빼로', '[이벤트]아몬드 빼빼로'];
const definitions = [
    { name: '26빼빼로데이1패키지', price: 111, rewards: [{ name: '지옥 열쇠', count: 1 }, { name: peperoNames[0], count: 1 }] },
    { name: '26빼빼로데이2패키지', price: 1111, rewards: [{ name: '화려한 지옥 열쇠', count: 1 }, { name: '지니어스의 열쇠', count: 111 }, { name: randomName, count: 1, autoUse: true }] },
    { name: '26빼빼로데이3패키지', price: 1111, rewards: [{ name: '화려한 지옥 열쇠', count: 1 }, { type: '가넷', count: 1111 }, { name: randomName, count: 1, autoUse: true }] }
];

function prepare(before) {
    if (!['Item', 'Pack', 'Bundle'].every(key => Array.isArray(before[key])) || !before.Shop || Array.isArray(before.Shop)) throw new Error('운영 Item/Pack/Bundle/Shop 데이터가 필요합니다.');
    const after = structuredClone(before);
    const itemId = name => {
        const id = after.Item.findIndex(item => item?.name === name);
        if (id < 0) throw new Error('운영 구성품이 없습니다: ' + name);
        return id;
    };
    if (!after.Item.some(item => item?.name === randomName)) {
        const rewards = peperoNames.map(name => ({ type: '아이템', item_id: itemId(name), count: 11, roll: 1 / 3 }));
        after.Item.push({ name: randomName, type: '가챠', no_trade: true, pack: after.Pack.length,
            desc: '빼빼로·누드 빼빼로·아몬드 빼빼로 중 한 종류를 동일 확률로 선택하여 11개 지급한다. 패키지 구매 시 즉시 개봉된다.' });
        after.Pack.push(rewards);
    }
    if (after.Shop['패키지'] == null) after.Shop['패키지'] = [];
    if (!Array.isArray(after.Shop['패키지'])) throw new Error('패키지 상점 형식을 확인해주세요.');
    for (const definition of definitions) {
        if (!after.Item.some(item => item?.name === definition.name)) {
            const rewards = definition.rewards.map(reward => reward.name
                ? { type: '아이템', item_id: itemId(reward.name), count: reward.count, ...(reward.autoUse ? { autoUse: true } : {}) }
                : structuredClone(reward));
            after.Item.push({ name: definition.name, type: '번들', pack: after.Bundle.length, desc: '구매 즉시 구성품을 지급한다. 계정당 최대 3회 구매 가능.' });
            after.Bundle.push(rewards);
        }
        const id = itemId(definition.name);
        if (!Object.values(after.Shop).some(list => Array.isArray(list) && list.some(product => product.type === '아이템' && product.item_id === id))) {
            after.Shop['패키지'].push({ shopId: newShopItemId(), contentKey: '2026-pepero-package', type: '아이템', item_id: id, count: 1, price: { goods: 'point', amount: definition.price }, limits: { max: 3 } });
        }
    }
    return after;
}

async function main() {
    const root = path.resolve(__dirname, '..');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const region = process.env.AWS_REGION || 'ap-northeast-2';
    const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID };
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));
    const keys = ['Item', 'Pack', 'Bundle', 'Shop'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    const artDir = process.argv.find(arg => arg.startsWith('--art-dir='))?.slice(10);
    if (!artDir) throw new Error('--art-dir=이미지_폴더를 지정해주세요.');
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({ region, credentials: new AWS.Credentials(credentials) });
    const assets = [...definitions.map(def => ({ source: def.name, relative: 'itemImage/번들/' + def.name + '.png' })),
        { source: definitions[0].name, relative: 'itemImage/가챠/' + randomName + '.png' }]
        .map(asset => ({ ...asset, key: 'tcgenius/assets/' + asset.relative, body: fs.readFileSync(path.join(artDir, asset.source + '.png')) }));
    for (const asset of assets) {
        try {
            const stored = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
            if (!asset.body.equals(stored.Body)) throw new Error('기존 이미지와 다릅니다: ' + asset.key);
            asset.exists = true;
        } catch (error) { if (error.code !== 'NoSuchKey') throw error; }
    }
    console.log(JSON.stringify({ changed, packages: definitions.map(def => ({ name: def.name, price: def.price, max: 3 })), random: '3종 균등 추첨 1회, 선택된 종류 11개 지급' }, null, 2));
    if (!process.argv.includes('--apply')) return;
    const output = path.join(root, 'output/pepero-packages'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'before-' + Date.now() + '.json'), JSON.stringify(before, null, 2), { flag: 'wx' });
    for (const asset of assets) {
        if (!asset.exists) await s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: 'image/png' }).promise();
        const stored = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
        if (!asset.body.equals(stored.Body)) throw new Error('S3 이미지 검증 실패: ' + asset.key);
        const local = path.join(root, 'DB/RPGenius', asset.relative); fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, stored.Body);
    }
    if (changed.length) await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after', ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error(key + ' 등록 후 검증 실패');
    fs.writeFileSync(path.join(output, 'registered.json'), JSON.stringify(after, null, 2));
    fs.writeFileSync(path.join(output, 's3-verified.json'), JSON.stringify(assets.map(asset => ({ key: asset.key, sha256: crypto.createHash('sha256').update(asset.body).digest('hex') })), null, 2));
    console.log('패키지 3종 등록 및 S3 이미지 4개 검증 완료.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, definitions, randomName, peperoNames };
