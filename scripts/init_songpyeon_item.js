// 사용자가 요청한 새 아이템 등록용. 서버 시작/import에서는 실행하지 않는다.
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const definition = {
    type: '가챠', use: '송편', name: '송편',
    desc: '사용 시 윷 1~4개와 익명 지렁이 5개, 밍플 지렁이 1개, 상급 강화석 3개, 헬 초대장 3개, 쥬얼 3개 중 하나를 획득한다. 윷 수량은 각각 25%, 추가 보상은 각각 20% 확률이다.',
    guaranteed: { name: '윷', count: { min: 1, max: 4 } },
    choices: [
        { name: '익명 지렁이', count: 5 }, { name: '밍플 지렁이', count: 1 },
        { name: '상급 강화석', count: 3 }, { name: '헬 초대장', count: 3 }, { name: '쥬얼', count: 3 }
    ]
};

async function main() {
    const root = path.join(__dirname, '..');
    for (const file of ['.env', '.env.local']) {
        const full = path.join(root, file);
        if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({
        region: 'ap-northeast-2',
        credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID }
    }));
    const key = { TableName: 'rpgenius_data', Key: { key: 'Item' } };
    const result = await db.send(new GetCommand({ ...key, ConsistentRead: true }));
    const before = result.Item && result.Item.data;
    if (!Array.isArray(before)) throw new Error('운영 Item 데이터가 없습니다. 초기화하지 않습니다.');
    const existing = before.findIndex(item => item && item.name === definition.name);
    if (existing >= 0) { console.log('기존 송편 정의 보존: ' + existing); return; }
    for (const reward of [definition.guaranteed, ...definition.choices]) {
        if (!before.some(item => item && item.name === reward.name)) throw new Error('운영 보상 아이템 누락: ' + reward.name);
    }
    if (!process.argv.includes('--apply')) { console.log(JSON.stringify({ newId: before.length, definition }, null, 2)); return; }
    await db.send(new UpdateCommand({
        ...key, UpdateExpression: 'SET #data = list_append(#data, :new)',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
        ExpressionAttributeValues: { ':new': [definition], ':before': before }
    }));
    const after = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item.data;
    const { isDeepStrictEqual } = require('node:util');
    if (!isDeepStrictEqual(after.slice(0, -1), before) || !isDeepStrictEqual(after.at(-1), definition)) throw new Error('동시 운영 변경이 감지되었습니다. 다시 확인해주세요.');
    console.log('송편 ID ' + before.length + ' 추가. 기존 운영 아이템 ' + before.length + '개와 모든 보상/꾸러미 구성 보존 확인.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definition };
