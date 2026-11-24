'use strict';

// 운영자가 명시적으로 실행하는 카탈로그 변경. 시작/배포 시 자동 실행하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const NAME = '닉네임 색깔 변경권';
const DESCRIPTION = '사용 시 계정의 모든 캐릭터가 닉네임 색을 자유롭게 변경할 수 있습니다. 색상은 캐릭터마다 따로 설정됩니다.\n- 영구 골드 획득량 증가 +5%.';

function prepare(items) {
    if (!Array.isArray(items)) throw new Error('운영 아이템 목록을 찾을 수 없습니다.');
    const matches = items.map((item, index) => ({ item, index })).filter(({ item }) => item?.use === '전직프레스티지');
    if (matches.length !== 1) throw new Error('변경 대상 아이템이 유일하지 않습니다.');
    const { item, index } = matches[0];
    if (item.name === NAME) return null;
    if (item.name !== '전직 프레스티지 증표') throw new Error('운영 아이템 이름이 변경되어 있습니다. 먼저 확인해주세요.');
    return { index, before: structuredClone(item), after: { ...item, name: NAME, desc: DESCRIPTION } };
}

function update(plan) {
    const prefix = '#data[' + plan.index + ']';
    return { TableName: 'rpgenius_data', Key: { key: 'Item' },
        UpdateExpression: `SET ${prefix}.#name = :name, ${prefix}.#desc = :desc`,
        ConditionExpression: `${prefix} = :before`,
        ExpressionAttributeNames: { '#data': 'data', '#name': 'name', '#desc': 'desc' },
        ExpressionAttributeValues: { ':before': plan.before, ':name': NAME, ':desc': DESCRIPTION } };
}

async function main() {
    const envDir = process.argv.find(arg => arg.startsWith('--env-dir='))?.slice(10) || path.join(__dirname, '..');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(envDir, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*(AWS_[A-Z_]+)=(.*)$/);
            if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION || 'ap-northeast-2', credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID, sessionToken: process.env.AWS_SESSION_TOKEN
    } }));
    const read = () => db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: 'Item' }, ConsistentRead: true }));
    const plan = prepare((await read()).Item?.data);
    if (!plan) return console.log('이미 변경되었습니다. 운영 설명은 그대로 보존합니다.');
    console.log(JSON.stringify(plan, null, 2));
    if (!process.argv.includes('--apply')) return console.log('읽기 전용 점검 완료. 실제 적용은 점검 중 --apply로 실행합니다.');
    const backupDir = process.argv.find(arg => arg.startsWith('--backup-dir='))?.slice(13);
    if (!backupDir) throw new Error('--backup-dir로 원본 보관 위치를 지정해주세요.');
    fs.mkdirSync(backupDir, { recursive: true });
    fs.writeFileSync(path.join(backupDir, 'nickname-color-ticket-before.json'), JSON.stringify(plan, null, 2), { flag: 'wx' });
    await db.send(new UpdateCommand(update(plan)));
    const verified = (await read()).Item?.data?.[plan.index];
    if (verified?.name !== NAME || verified?.desc !== DESCRIPTION) throw new Error('변경 결과를 확인하지 못했습니다.');
    console.log('아이템 ' + plan.index + '의 이름과 설명만 변경했습니다.');
}
if (require.main === module) main().catch(error => { console.error(error.name + ': ' + error.message); process.exitCode = 1; });
module.exports = { prepare, update };
