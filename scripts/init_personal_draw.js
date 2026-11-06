'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { appendContent } = require('../personal_draw_content');

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
    const keys = ['Pet', 'Item', 'Recipe', 'PersonalDraw'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = appendContent(before);
    const changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    console.log(JSON.stringify(Object.fromEntries(keys.map(key => [key, Array.isArray(after[key]) ? { before: before[key].length, added: after[key].slice(before[key].length).map(entry => entry.name) } : { create: before[key] === undefined, config: after[key] }])), null, 2));
    if (!process.argv.includes('--apply') || !changed.length) return;
    const backupDir = path.join(__dirname, '..', 'output', 'personal-draw');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'content-before-' + Date.now() + '.json'), JSON.stringify(before, null, 2));
    await db.send(new TransactWriteCommand({ TransactItems: changed.map(key => ({ Put: {
        TableName: 'rpgenius_data', Item: { key, data: after[key] },
        ConditionExpression: before[key] === undefined ? 'attribute_not_exists(#key)' : '#data = :before',
        ExpressionAttributeNames: before[key] === undefined ? { '#key': 'key' } : { '#data': 'data' },
        ...(before[key] === undefined ? {} : { ExpressionAttributeValues: { ':before': before[key] } })
    } })) }));
    for (const key of changed) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error(key + ' 검증 실패: 동시 변경을 확인해주세요.');
    console.log('신규 펫/재료/제작식/이벤트 등록 완료. 기존 항목은 보존했습니다.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
