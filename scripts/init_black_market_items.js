// 명시적 실행에서 누락된 두 아이템만 추가한다. 기존 운영 정의와 인덱스는 보존한다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const definitions = ['제타', '시그마'].map(tier => ({
    name: tier + ' 각성 캐릭터 변환석', type: '사용', use: '각성캐릭터변환', can: tier, no_trade: true,
    desc: tier + ' 등급 이하의 각성 카드 캐릭터를 다른 각성 캐릭터로 무작위 변환한다. 등급과 각성 상태는 유지된다.'
}));
async function main() {
    for (const file of ['.env', '.env.local']) {
        const full = path.join(__dirname, '..', file);
        if (!fs.existsSync(full)) continue;
        for (const line of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID
    } }));
    const key = { TableName: 'rpgenius_data', Key: { key: 'Item' } };
    const before = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item?.data;
    if (!Array.isArray(before)) throw new Error('운영 아이템 데이터가 없습니다. 초기화하지 않습니다.');
    const missing = definitions.filter(def => !before.some(item => item?.name === def.name));
    console.log(JSON.stringify(missing.map((item, index) => ({ id: before.length + index, ...item })), null, 2));
    if (!missing.length || !process.argv.includes('--apply')) return;
    const backup = path.join(__dirname, '../output/black-market');
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'items-before-' + Date.now() + '.json'), JSON.stringify(before, null, 2));
    await db.send(new UpdateCommand({ ...key, UpdateExpression: 'SET #data = list_append(#data, :new)',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
        ExpressionAttributeValues: { ':new': missing, ':before': before } }));
    const after = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item?.data;
    if (!isDeepStrictEqual(after, [...before, ...missing])) throw new Error('등록 후 운영 데이터 변경이 감지되었습니다. 확인해주세요.');
    console.log(missing.length + '개 추가, 기존 ' + before.length + '개 아이템 보존 확인.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definitions };
