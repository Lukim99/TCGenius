// 명시적 신규 등록용. 서버 시작/import/테스트에서는 운영 DB에 쓰지 않는다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { QUEST_NAME, OBJECTIVE_TYPE } = require('../wisdom_puzzle');

function makeDefinition(quests, items) {
    if (quests.some(quest => quest && quest.name === QUEST_NAME)) return null;
    const itemId = items.findIndex(item => item && item.name === '지혜의 보석');
    if (itemId < 0) throw new Error('운영 Item에 지혜의 보석이 없습니다. 기존 아이템은 변경하지 않습니다.');
    return {
        id: quests.reduce((max, quest) => Math.max(max, Number(quest && quest.id) || 0), 0) + 1,
        name: QUEST_NAME,
        desc: '힘으로 열 수 없는 현자의 문 앞에 섰습니다.\n매일 달라지는 논리 퍼즐의 모든 단서를 엮어, 당신의 지혜를 증명하세요.\n\n정답을 맞히면 지혜의 보석을 받을 수 있습니다.\n문제는 계정마다 다르며, 매일 한국시간 자정에 새로 출제됩니다. 오답이어도 다시 도전할 수 있습니다.',
        categories: ['일일'], minLevel: 1, maxLevel: 300, skippable: false,
        objectives: [{ type: OBJECTIVE_TYPE, count: 1 }],
        rewards: [{ type: '아이템', item_id: itemId, count: { min: 1, max: 1 } }],
        unlock: { type: 'always' }, enabled: true
    };
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
    const questKey = { TableName: 'rpgenius_data', Key: { key: 'Quest' } };
    const itemKey = { TableName: 'rpgenius_data', Key: { key: 'Item' } };
    const before = (await db.send(new GetCommand({ ...questKey, ConsistentRead: true }))).Item?.data;
    const items = (await db.send(new GetCommand({ ...itemKey, ConsistentRead: true }))).Item?.data;
    if (!Array.isArray(before) || !Array.isArray(items)) throw new Error('운영 Quest/Item 목록을 확인할 수 없습니다. 초기화하지 않습니다.');
    const definition = makeDefinition(before, items);
    if (!definition) { console.log('기존 지혜 퀘스트가 있습니다. 활성 여부, 보상, 구성 모두 보존합니다.'); return; }
    console.log(JSON.stringify({ preservedQuests: before.length, newQuest: definition }, null, 2));
    if (!process.argv.includes('--apply')) return;
    // Quest의 동시 편집과 Item 인덱스 변경을 모두 확인한 뒤 신규 퀘스트만 추가한다.
    await db.send(new TransactWriteCommand({ TransactItems: [
        { ConditionCheck: { ...itemKey, ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': items } } },
        { Update: { ...questKey, UpdateExpression: 'SET #data = list_append(#data, :new)', ConditionExpression: '#data = :before',
            ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before, ':new': [definition] } } }
    ] }));
    const after = (await db.send(new GetCommand({ ...questKey, ConsistentRead: true }))).Item.data;
    if (!isDeepStrictEqual(after, [...before, definition])) throw new Error('등록 후 동시 운영 변경이 감지되었습니다. Quest 데이터를 확인해주세요.');
    console.log('퀘스트 #' + definition.id + ' 등록 완료. 기존 퀘스트 ' + before.length + '개 보존 확인.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { makeDefinition };
