// 명시 실행 전용. 운영 보상 수량과 연결을 보존하고 요청한 상자 가중치만 바꾼다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { CHEST_WEIGHTS } = require('../paradise_hell_content');

function updateWeights(before) {
    if (!Array.isArray(before?.hell?.rewards)) throw new Error('운영 지옥 보상표가 없습니다. 새로 만들지 않습니다.');
    const after = structuredClone(before), rows = after.hell.rewards;
    for (const [id, weight] of Object.entries(CHEST_WEIGHTS)) {
        const matches = rows.filter(row => row.id === id);
        if (matches.length !== 1) throw new Error('보상 항목 누락 또는 중복: ' + id);
        matches[0].weight = weight;
    }
    if (rows.some(row => !Object.hasOwn(CHEST_WEIGHTS, row.id) && row.weight !== 0)) throw new Error('확률이 지정되지 않은 추가 보상 항목이 있습니다.');
    return after;
}

async function main() {
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID, sessionToken: process.env.AWS_SESSION_TOKEN } }));
    const read = async () => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: 'Paradise' }, ConsistentRead: true }))).Item?.data;
    const before = await read(), after = updateWeights(before), changed = !isDeepStrictEqual(before, after);
    console.log(JSON.stringify({ changed, weights: after.hell.rewards.map(({ id, weight }) => ({ id, weight })) }));
    if (!changed || !process.argv.includes('--apply')) return;
    const backup = path.join(__dirname, '../output/paradise-refinement/hell-weights-before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, JSON.stringify(before, null, 2));
    await db.send(new UpdateCommand({ TableName: 'rpgenius_data', Key: { key: 'Paradise' }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before, ':after': after } }));
    if (!isDeepStrictEqual(await read(), after)) throw new Error('운영 상자 가중치 읽기 검증 불일치');
    console.log('상자 가중치만 변경하고 읽기 검증했습니다. 백업: ' + backup);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { updateWeights };
