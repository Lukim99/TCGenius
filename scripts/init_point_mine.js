'use strict';

// 직접 실행할 때만 새 열쇠와 이벤트 설정의 누락분을 등록한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { KEY_NAME, KEY_DEFINITION, DEFAULT_CONFIG } = require('../point_mine_config');

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
    const [itemRecord, configRecord] = await Promise.all([read('Item'), read('PointMine')]);
    const before = itemRecord?.data;
    if (!Array.isArray(before)) throw new Error('운영 Item 데이터가 없습니다. 초기화하지 않습니다.');
    const config = configRecord ? configRecord.data : DEFAULT_CONFIG;
    if (!Array.isArray(config?.rewards)) throw new Error('기존 광산 설정을 확인해주세요. 덮어쓰지 않습니다.');
    for (const reward of config.rewards) if (!before.some(item => item?.name === reward.name)) throw new Error('운영 보상 아이템 누락: ' + reward.name);
    const existingId = before.findIndex(item => item?.name === KEY_NAME);
    const changes = [];
    if (existingId < 0) changes.push({ Update: {
        TableName: 'rpgenius_data', Key: { key: 'Item' }, UpdateExpression: 'SET #data = list_append(#data, :new)',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
        ExpressionAttributeValues: { ':new': [KEY_DEFINITION], ':before': before }
    } });
    if (!configRecord) changes.push({ Put: { TableName: 'rpgenius_data', Item: { key: 'PointMine', data: DEFAULT_CONFIG }, ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'key' } } });
    const summary = { keyId: existingId < 0 ? before.length : existingId, existingItems: before.length, addKey: existingId < 0, addConfig: !configRecord,
        rewards: config.rewards.map(({ name, count, cost, limit }) => ({ name, count, cost, limit })) };
    console.log(JSON.stringify(summary, null, 2));
    if (!process.argv.includes('--apply') || !changes.length) return;
    await db.send(new TransactWriteCommand({ TransactItems: changes }));
    const [afterItems, afterConfig] = await Promise.all([read('Item'), read('PointMine')]);
    const expected = existingId < 0 ? [...before, KEY_DEFINITION] : before;
    if (!isDeepStrictEqual(afterItems.data, expected) || !isDeepStrictEqual(afterConfig.data, config)) throw new Error('동시 운영 변경 감지. 운영 데이터를 재확인해주세요.');
    console.log('등록 완료. 기존 아이템 정의와 보상/꾸러미/제작식은 보존했습니다.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
