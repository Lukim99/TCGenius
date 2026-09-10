// 명시적으로 실행할 때만 누락된 윷 아이템을 등록한다. 부팅/import에서는 실행하지 않는다.
const fs = require('fs');
const path = require('path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');

const definition = { type: '이벤트', name: '윷', desc: '이벤트 탭의 윷놀이에서 4개를 소모하여 윷을 한 번 던질 수 있다.' };

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
    const items = result.Item && result.Item.data;
    if (!Array.isArray(items)) throw new Error('운영 Item 데이터가 없습니다. 자동 초기화하지 않습니다.');
    const existing = items.findIndex(item => item && item.name === definition.name);
    if (existing >= 0) console.log('기존 윷 아이템 보존: ' + existing);
    else {
        await db.send(new UpdateCommand({
            ...key, UpdateExpression: 'SET #data = list_append(#data, :new)',
            ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
            ExpressionAttributeValues: { ':new': [definition], ':before': items }
        }));
        console.log('누락된 윷 아이템만 추가: ' + items.length);
    }
    // 로컬 기본 데이터의 인덱스는 운영 DB와 다를 수 있으므로 독립적으로 끝에 추가한다.
    const localFile = path.join(root, 'DB', 'RPGenius', 'Item.json');
    const local = JSON.parse(fs.readFileSync(localFile, 'utf8'));
    if (!local.some(item => item && item.name === definition.name)) {
        local.push(definition);
        const original = fs.readFileSync(localFile, 'utf8');
        fs.writeFileSync(localFile, original.replace(/\s*\]\s*$/, ',\n  ' + JSON.stringify(definition, null, 2).replace(/\n/g, '\n  ') + '\n]\n'));
    }
    const verified = await db.send(new GetCommand({ ...key, ConsistentRead: true }));
    const after = verified.Item.data;
    const prior = existing < 0 ? after.slice(0, -1) : after;
    if (JSON.stringify(prior) !== JSON.stringify(items)) throw new Error('동시 변경이 감지되었습니다. 운영 데이터를 다시 확인해 주세요.');
    console.log('기존 운영 아이템 ' + items.length + '개 보존 확인. 보상/꾸러미/제작식 변경 없음.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definition };
