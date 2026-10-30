'use strict';

// 직접 실행할 때만 누락된 신규 콘텐츠를 추가한다. 기존 운영 정의와 인덱스는 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

const accessory = {
    name: '장충동왕족발보쌈', rarity: '고유', desc: '비건 족발(...)이 될 뻔 했던 것이다.',
    stat: { hp: -1500, mp: 300 }
};

function prepare(before) {
    if (!Array.isArray(before.Equipment?.accessory) || !Array.isArray(before.Item) || !Array.isArray(before.Bundle)) {
        throw new Error('운영 Equipment/Item/Bundle 데이터가 없습니다. 초기화하지 않습니다.');
    }
    const after = structuredClone(before);
    if (!after.Equipment.accessory.some(item => item?.name === accessory.name)) after.Equipment.accessory.push(structuredClone(accessory));
    for (const star of [6, 7]) {
        const name = star + '성 각성 카드팩';
        if (after.Item.some(item => item?.name === name)) continue;
        after.Item.push({ name, type: '번들', no_trade: true, pack: after.Bundle.length, desc: star + '성 랜덤 각성 캐릭터 카드 1장을 얻을 수 있다.' });
        after.Bundle.push([{ type: '캐릭터카드', card_type: '각성', display_star: star, count: 1 }]);
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
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID
    } }));
    const keys = ['Equipment', 'Item', 'Bundle'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify({ changed, accessory: after.Equipment.accessory.find(item => item?.name === accessory.name),
        items: after.Item.slice(before.Item.length), bundles: after.Bundle.slice(before.Bundle.length) }, null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const dir = path.join(__dirname, '..', 'output', 'randoland1');
    fs.mkdirSync(dir, { recursive: true });
    const backup = path.join(dir, 'registration-before-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before',
            ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after',
            ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('등록 후 동시 운영 변경 감지: ' + key);
    console.log('신규 등록·읽기 검증 완료. 기존 운영 데이터 보존. 백업: ' + backup);
}

module.exports = { prepare, accessory };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
