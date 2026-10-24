'use strict';
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const series = ['유의게임X-24', '유의게임X-25', '유의게임X-26', '유의게임X-S', '유의게임X-R', '2026 DMC AUTUMN'];
const orbs = require('../DB/RPGenius/Orb.json').orbs.filter(orb => series.includes(orb.series));
const itemDefinitions = orbs.map(orb => ({ name: orb.name, type: '사용', use: '보주',
    desc: '장비에 부여해 효과를 얻는 보주다.\n- 부여 가능 부위: ' + (orb.parts[0] === 'accessory' ? '장신구' : '보조 장비') + '\n- ' + orb.effect }));
function prepare(before) {
    if (!Array.isArray(before.Item) || !Array.isArray(before.Fashion)) throw new Error('기존 운영 Item/Fashion 데이터가 필요합니다.');
    const after = structuredClone(before);
    for (const item of itemDefinitions) if (!after.Item.some(existing => existing?.name === item.name)) after.Item.push(structuredClone(item));
    for (const name of ['아이돌', '고급 아이돌']) {
        const fashion = after.Fashion.find(entry => entry?.name === name && entry.type === '전직');
        if (!Array.isArray(fashion?.primary_card)) throw new Error(name + '의 기존 적용 대상을 확인해주세요.');
        for (const id of [15, 16]) if (!fashion.primary_card.includes(id)) fashion.primary_card.push(id);
    }
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
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const keys = ['Item', 'Fashion'], before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, addedItems: after.Item.slice(before.Item.length).map(item => item.name), avatars: after.Fashion.filter(f => ['아이돌', '고급 아이돌'].includes(f?.name)) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const dir = path.join(__dirname, '../output/orb-fusion'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'registration-before-' + Date.now() + '.json'), JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: changed.map(key => ({ Update: { TableName: 'rpgenius_data', Key: { key },
        UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
        ExpressionAttributeValues: { ':before': before[key], ':after': after[key] } } })) }));
    for (const key of changed) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('반영 후 운영 변경 감지: ' + key);
    console.log('등록 완료. 기존 아이템과 아바타 능력치, 가격, 인덱스를 보존했습니다.');
}
module.exports = { prepare, itemDefinitions, series };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
