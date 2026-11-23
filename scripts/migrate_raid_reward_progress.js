'use strict';

// 명시적 점검 작업 전용. --apply는 서버 저장을 마치고 중지한 뒤, 새 코드 시작 전에 실행한다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { updateInput } = require('../character_accounts');
const { fromLegacy } = require('../raid_reward_progress');
const TABLE = 'rpgenius_user';

function prepare(account, members) {
    if (account.recordType !== 'account' || !Array.isArray(account.characterIds)) throw new Error('계정 정보가 올바르지 않습니다.');
    const characters = account.characterIds.map(id => members.find(member => member.id === id));
    if (characters.some(character => !character || character.accountId !== account.id)) throw new Error('계정의 캐릭터를 확인할 수 없습니다: ' + account.id);
    if (characters.filter(character => character.characterNumber === 1).length !== 1) throw new Error('1번 캐릭터가 유일하지 않습니다: ' + account.id);
    const updates = [];
    for (const character of characters) {
        if (character.raidRewardProgress !== undefined) {
            if (!character.raidRewardProgress || typeof character.raidRewardProgress !== 'object' || Array.isArray(character.raidRewardProgress)) {
                throw new Error('캐릭터별 레이드 기록이 올바르지 않습니다: ' + character.id);
            }
            continue; // 이미 승계했거나 이후 획득한 기록은 다시 덮어쓰지 않는다.
        }
        updates.push({ id: character.id, characterNumber: character.characterNumber,
            progress: character.characterNumber === 1 ? fromLegacy(account) : {} });
    }
    return updates.length ? { account, updates } : null;
}

function transaction(plan) {
    const account = plan.account, names = { '#type': 'recordType', '#ids': 'characterIds' }, values = { ':type': 'account', ':ids': account.characterIds };
    const conditions = ['#type = :type', '#ids = :ids'];
    for (const key of ['titleProgress', 'titles']) {
        names['#' + key] = key;
        if (account[key] === undefined) conditions.push('attribute_not_exists(#' + key + ')');
        else { conditions.push('#' + key + ' = :' + key); values[':' + key] = account[key]; }
    }
    return { TransactItems: [
        // 기존 공유 기록과 칭호는 보존한다. 승계 중 원본이나 소속이 바뀌면 전체를 취소한다.
        { ConditionCheck: { TableName: TABLE, Key: { id: account.id }, ConditionExpression: conditions.join(' AND '),
            ExpressionAttributeNames: names, ExpressionAttributeValues: values } },
        ...plan.updates.map(update => {
            const input = updateInput(TABLE, update.id, { raidRewardProgress: update.progress }, {});
            input.ConditionExpression += ' AND #account = :account AND #number = :number';
            Object.assign(input.ExpressionAttributeNames, { '#account': 'accountId', '#number': 'characterNumber' });
            Object.assign(input.ExpressionAttributeValues, { ':account': account.id, ':number': update.characterNumber });
            return { Update: input };
        })
    ] };
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
    const records = [];
    let cursor;
    do {
        const page = await db.send(new ScanCommand({ TableName: TABLE, ConsistentRead: true, ExclusiveStartKey: cursor,
            ProjectionExpression: 'id, recordType, accountId, characterNumber, characterIds, titles, titleProgress, raidRewardProgress' }));
        records.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
    } while (cursor);
    const plans = records.filter(record => record.recordType === 'account').map(account => prepare(account, records)).filter(Boolean);
    console.log(JSON.stringify({ apply: process.argv.includes('--apply'), accounts: plans.length,
        characters: plans.reduce((sum, plan) => sum + plan.updates.length, 0),
        inheritedFirstClears: plans.reduce((sum, plan) => sum + plan.updates.filter(update => update.progress.hoduExtremeFirst || update.progress.mansionNightmareFirst).length, 0)
    }, null, 2));
    if (!process.argv.includes('--apply') || !plans.length) return;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgenius-raid-rewards-'));
    fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify({ records, plans }, null, 2), { flag: 'wx' });
    console.log('변경 전 기록 백업: ' + folder);
    for (const plan of plans) {
        await db.send(new TransactWriteCommand(transaction(plan)));
        for (const update of plan.updates) {
            const saved = (await db.send(new GetCommand({ TableName: TABLE, Key: { id: update.id }, ConsistentRead: true,
                ProjectionExpression: 'raidRewardProgress' }))).Item;
            if (!isDeepStrictEqual(saved?.raidRewardProgress, update.progress)) throw new Error('이전 후 읽기 검증 실패: ' + update.id);
        }
    }
    console.log('캐릭터별 레이드 기록 이전 및 읽기 검증 완료');
}

module.exports = { prepare, transaction };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
