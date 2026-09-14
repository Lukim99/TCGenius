// 명시적으로 요청된 신규 아이템만 등록한다. 서버 시작/import에서는 실행하지 않는다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const definitions = [
    {
        "type": "재료",
        "name": "용기의 보석",
        "desc": "각성조합에 사용되는 보석. 주간 레이드 퀘스트 또는 보상 횟수가 남은 레이드 클리어 시 5% 확률로 획득할 수 있다. 아이템 드랍율의 영향을 받지 않는다."
    },
    {
        "type": "재료",
        "name": "희생의 보석",
        "desc": "각성조합에 사용되는 보석. 초월 상점에서 초월 조각 5개로 교환할 수 있다."
    },
    {
        "type": "재료",
        "name": "투지의 보석",
        "desc": "각성조합에 사용되는 보석. PVP 공격자로 전투를 완료하면 승패와 관계없이 5% 확률로 획득할 수 있다. 아이템 드랍율의 영향을 받지 않는다."
    },
    {
        "type": "재료",
        "name": "권능의 보석",
        "desc": "각성조합에 사용되는 보석. 일반 상점에서 100,000,000 골드로 구매할 수 있다."
    },
    {
        "type": "재료",
        "name": "지혜의 보석",
        "desc": "각성조합에 사용되는 보석. '[일일]지혜의 보석' 퀘스트로 획득할 수 있다."
    },
    {
        "type": "재료",
        "name": "인내의 보석",
        "desc": "각성조합에 사용되는 보석. 모든 지역의 일반 사냥에서 0.1% 확률로 획득할 수 있으며, 아이템 드랍율의 영향을 받는다."
    },
    {
        "type": "사용",
        "use": "스펙터",
        "name": "견고함 스펙터",
        "specter": "견고함 스펙터",
        "desc": "일반·전직 캐릭터 카드에 각성 타입의 스펙터를 부여한다. 메인 장착 시 방어 관통력 5%, 치명타 확률 5%, 쿨타임 감소 5%, 최대 HP 100이 증가한다. 전직 타입의 스펙터와 함께 적용할 수 있으며, 같은 타입의 스펙터는 중복 적용되지 않는다."
    }
];

async function main() {
    for (const file of ['.env', '.env.local']) {
        const full = path.join(__dirname, '..', file);
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
    const before = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item?.data;
    if (!Array.isArray(before)) throw new Error('운영 Item 데이터가 없습니다. 초기화하지 않습니다.');
    const missing = definitions.filter(def => !before.some(item => item && item.name === def.name));
    if (!missing.length) { console.log('신규 아이템이 모두 존재합니다. 기존 정의 보존.'); return; }
    console.log(JSON.stringify(missing.map((item, i) => ({ id: before.length + i, ...item })), null, 2));
    if (!process.argv.includes('--apply')) return;
    await db.send(new UpdateCommand({
        ...key, UpdateExpression: 'SET #data = list_append(#data, :new)',
        ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
        ExpressionAttributeValues: { ':new': missing, ':before': before }
    }));
    const after = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item.data;
    if (!isDeepStrictEqual(after, [...before, ...missing])) throw new Error('등록 후 동시 운영 변경이 감지되었습니다. 데이터를 확인해주세요.');
    console.log(missing.length + '개 추가. 기존 운영 아이템 ' + before.length + '개 보존 확인.');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definitions };
