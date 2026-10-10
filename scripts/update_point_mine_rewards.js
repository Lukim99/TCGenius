'use strict';

// 요청된 보상 목록과 열쇠 설명만 명시적으로 변경한다. 서버 시작에서는 실행하지 않는다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { KEY_NAME, DEFAULT_CONFIG } = require('../point_mine_config');

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
    const items = itemRecord?.data, config = configRecord?.data;
    if (!Array.isArray(items) || !Array.isArray(config?.rewards)) throw new Error('기존 운영 아이템과 광산 설정이 필요합니다. 초기화하지 않습니다.');
    const keyId = items.findIndex(item => item?.name === KEY_NAME);
    if (keyId < 0 || typeof items[keyId].desc !== 'string' || !/하루 최대 \d+개/.test(items[keyId].desc)) throw new Error('운영 열쇠 설명을 확인해주세요. 덮어쓰지 않습니다.');
    for (const reward of DEFAULT_CONFIG.rewards) if (items.filter(item => item?.name === reward.name).length !== 1) throw new Error('운영 보상 아이템을 확인해주세요: ' + reward.name);
    const desc = items[keyId].desc.replace(/하루 최대 \d+개/, '하루 최대 2개');
    const expectedItems = structuredClone(items); expectedItems[keyId].desc = desc;
    const expectedConfig = { ...config, rewards: DEFAULT_CONFIG.rewards };
    const changes = [];
    if (!isDeepStrictEqual(config.rewards, expectedConfig.rewards)) changes.push({ Update: {
        TableName: 'rpgenius_data', Key: { key: 'PointMine' }, UpdateExpression: 'SET #data.#rewards = :rewards',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data', '#rewards': 'rewards' },
        ExpressionAttributeValues: { ':rewards': expectedConfig.rewards, ':before': config }
    } });
    if (desc !== items[keyId].desc) changes.push({ Update: {
        TableName: 'rpgenius_data', Key: { key: 'Item' }, UpdateExpression: 'SET #data[' + keyId + '].#desc = :desc',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data', '#desc': 'desc' },
        ExpressionAttributeValues: { ':desc': desc, ':before': items }
    } });
    console.log(JSON.stringify({ keyId, updateRewards: !isDeepStrictEqual(config.rewards, expectedConfig.rewards), updateKeyDescription: desc !== items[keyId].desc, keyDescription: desc, rewards: expectedConfig.rewards }, null, 2));
    if (!process.argv.includes('--apply') || !changes.length) return;
    const directory = path.join(__dirname, '..', 'output', 'point-mine');
    fs.mkdirSync(directory, { recursive: true });
    const backup = path.join(directory, 'config-before-reward-change-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
    fs.writeFileSync(backup, JSON.stringify({ PointMine: config, keyItem: { id: keyId, ...items[keyId] } }, null, 2), { flag: 'wx' });
    await db.send(new TransactWriteCommand({ TransactItems: changes }));
    const [afterItems, afterConfig] = await Promise.all([read('Item'), read('PointMine')]);
    if (!isDeepStrictEqual(afterItems.data, expectedItems) || !isDeepStrictEqual(afterConfig.data, expectedConfig)) throw new Error('동시 운영 변경 감지. 운영 데이터를 재확인해주세요.');
    console.log('변경 완료. 보상 목록과 열쇠 설명 외 운영 설정·아이템 정의는 보존했습니다. 변경 전 백업: ' + backup);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
