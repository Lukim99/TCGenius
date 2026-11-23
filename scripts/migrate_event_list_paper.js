'use strict';

// Explicit maintenance only: stop and flush the server before --apply, then start the corrected code.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, ScanCommand, BatchGetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { updateInput } = require('../character_accounts');
const TABLE = 'rpgenius_user', NAME = '이벤트 리스트 종이';

function quantity(entries, boundItems, itemId) {
    const stacks = (entries || []).filter(entry => Number(entry.id) === itemId);
    if (stacks.some(entry => !Number.isSafeInteger(entry.count) || entry.count < 0)) throw new Error('종이 수량이 올바르지 않습니다.');
    const count = stacks.reduce((sum, entry) => sum + entry.count, 0), bound = boundItems?.[itemId] ?? 0;
    if (!Number.isSafeInteger(count) || !Number.isSafeInteger(bound) || bound < 0 || bound > count) throw new Error('종이 수량 또는 귀속 수량이 올바르지 않습니다.');
    return { count, bound, stacks };
}

function prepare(account, character, itemId) {
    if (account.recordType !== 'account' || !Array.isArray(account.characterIds)) throw new Error('계정 정보가 올바르지 않습니다.');
    const source = quantity(account.items, account.boundItems, itemId);
    if (!source.stacks.length && !Object.hasOwn(account.boundItems || {}, itemId)) return null;
    if (!character || character.accountId !== account.id || character.characterNumber !== 1 || !account.characterIds.includes(character.id)) {
        throw new Error('같은 계정의 1번 캐릭터를 확인할 수 없습니다: ' + account.id);
    }
    const destination = quantity(character.inventory?.item, character.boundItems, itemId);
    if (!Number.isSafeInteger(source.count + destination.count)) throw new Error('합산 수량이 올바르지 않습니다.');
    const items = (account.items || []).filter(entry => Number(entry.id) !== itemId);
    const accountBound = structuredClone(account.boundItems || {});
    delete accountBound[itemId];
    const inventory = structuredClone(character.inventory), boundItems = structuredClone(character.boundItems || {});
    if (!Array.isArray(inventory?.item)) throw new Error('1번 캐릭터 소지품을 확인할 수 없습니다.');
    if (source.count) {
        const existing = inventory.item.find(entry => Number(entry.id) === itemId);
        if (existing) existing.count += source.count;
        else inventory.item.push({ id: itemId, count: source.count });
    }
    if (source.bound) boundItems[itemId] = destination.bound + source.bound;
    const changed = (record, after, identity) => {
        const changes = Object.fromEntries(Object.entries(after).filter(([key, value]) => !isDeepStrictEqual(record[key], value)));
        return { id: record.id, changes, before: Object.fromEntries(Object.keys(changes).map(key => [key, record[key]])), identity };
    };
    return { count: source.count, bound: source.bound, updates: [
        changed(account, { items, ...(Object.hasOwn(account.boundItems || {}, itemId) ? { boundItems: accountBound } : {}) },
            { recordType: 'account', characterIds: account.characterIds }),
        changed(character, { inventory, ...(source.bound ? { boundItems } : {}) },
            { accountId: account.id, characterNumber: 1 })
    ].filter(update => Object.keys(update.changes).length) };
}

function transaction(plan, itemId) {
    return { TransactItems: [
        { ConditionCheck: { TableName: 'rpgenius_data', Key: { key: 'Item' },
            ConditionExpression: '#data[' + itemId + '].#name = :name',
            ExpressionAttributeNames: { '#data': 'data', '#name': 'name' }, ExpressionAttributeValues: { ':name': NAME } } },
        ...plan.updates.map(update => {
            const input = updateInput(TABLE, update.id, update.changes, update.before);
            Object.entries(update.identity).forEach(([key, value], index) => {
                input.ConditionExpression += ' AND #g' + index + ' = :g' + index;
                input.ExpressionAttributeNames['#g' + index] = key;
                input.ExpressionAttributeValues[':g' + index] = value;
            });
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
    const catalog = (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: 'Item' }, ConsistentRead: true }))).Item?.data;
    const matches = Array.isArray(catalog) ? catalog.flatMap((item, id) => item?.name === NAME ? [id] : []) : [];
    if (matches.length !== 1) throw new Error('운영 Item에서 종이를 유일하게 확인할 수 없습니다.');
    const itemId = matches[0], accounts = [];
    let cursor;
    do {
        const page = await db.send(new ScanCommand({ TableName: TABLE, ConsistentRead: true, ExclusiveStartKey: cursor,
            FilterExpression: 'recordType = :account', ExpressionAttributeValues: { ':account': 'account' },
            ProjectionExpression: 'id, #name, recordType, characterIds, #items, boundItems', ExpressionAttributeNames: { '#name': 'name', '#items': 'items' } }));
        accounts.push(...(page.Items || [])); cursor = page.LastEvaluatedKey;
    } while (cursor);
    const holders = accounts.filter(account => (account.items || []).some(entry => Number(entry.id) === itemId) || Object.hasOwn(account.boundItems || {}, itemId));
    const ids = [...new Set(holders.flatMap(account => account.characterIds))], members = [];
    for (let index = 0; index < ids.length; index += 100) {
        const page = await db.send(new BatchGetCommand({ RequestItems: { [TABLE]: { Keys: ids.slice(index, index + 100).map(id => ({ id })),
            ConsistentRead: true, ProjectionExpression: 'id, #name, accountId, characterNumber, inventory, boundItems', ExpressionAttributeNames: { '#name': 'name' } } } }));
        if (Object.keys(page.UnprocessedKeys || {}).length) throw new Error('일부 캐릭터를 읽지 못했습니다. 쓰기 없이 중단합니다.');
        members.push(...(page.Responses?.[TABLE] || []));
    }
    const moves = holders.map(account => {
        const first = members.filter(member => member.accountId === account.id && member.characterNumber === 1 && account.characterIds.includes(member.id));
        if (first.length !== 1) throw new Error('1번 캐릭터가 유일하지 않습니다: ' + account.id);
        return { account, character: first[0], plan: prepare(account, first[0], itemId) };
    });
    console.log(JSON.stringify({ apply: process.argv.includes('--apply'), accounts: moves.length,
        count: moves.reduce((sum, move) => sum + move.plan.count, 0),
        moves: moves.map(move => ({ account: move.account.name, characterNumber: 1, character: move.character.name, count: move.plan.count, bound: move.plan.bound })) }, null, 2));
    if (!process.argv.includes('--apply') || !moves.length) return;
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgenius-event-paper-'));
    fs.writeFileSync(path.join(folder, 'before.json'), JSON.stringify({ itemId, moves }, null, 2), { flag: 'wx' });
    console.log('변경 전 백업: ' + folder);
    for (const move of moves) {
        await db.send(new TransactWriteCommand(transaction(move.plan, itemId)));
        for (const update of move.plan.updates) {
            const saved = (await db.send(new GetCommand({ TableName: TABLE, Key: { id: update.id }, ConsistentRead: true }))).Item;
            for (const [key, value] of Object.entries(update.changes)) {
                if (!isDeepStrictEqual(saved?.[key], value)) throw new Error('이전 후 읽기 검증 실패: ' + update.id + '/' + key);
            }
        }
        console.log(move.account.name + ': ' + move.plan.count + '개 이전 및 읽기 검증 완료');
    }
}

module.exports = { prepare, transaction };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
