// 요청한 추석 카드팩만 명시적으로 등록한다. 부팅/import에서는 실행하지 않는다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const AWS = require('aws-sdk');
const { REWARD_NAME } = require('../chuseok_event');
const SOURCE_NAME = '5성 전직 카드팩';

function createDefinition(items) {
    const source = items.find(item => item?.name === SOURCE_NAME);
    if (!source || source.type !== '가챠' || source.pack?.type !== '전직 캐릭터 카드팩' ||
        Number(source.pack.range?.min) !== 5 || Number(source.pack.range?.max) !== 5) {
        throw new Error('기존 5성 전직 카드팩 정의를 확인해주세요. 새 아이템을 생성하지 않습니다.');
    }
    return { ...structuredClone(source), name: REWARD_NAME };
}

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
    const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID };
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials }));
    try {
        const key = { TableName: 'rpgenius_data', Key: { key: 'Item' } };
        const before = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item?.data;
        if (!Array.isArray(before)) throw new Error('운영 Item 데이터가 없습니다. 초기화하지 않습니다.');
        const existing = before.findIndex(item => item?.name === REWARD_NAME);
        const definition = existing >= 0 ? before[existing] : createDefinition(before);
        const icon = fs.readFileSync(path.join(root, 'public/assets/chuseok-2026/item-icon.png'));
        const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
        const imageKey = 'tcgenius/assets/itemImage/가챠/' + REWARD_NAME + '.png';
        if (!process.argv.includes('--apply')) {
            console.log(JSON.stringify({ existing: existing >= 0, id: existing >= 0 ? existing : before.length, definition, imageKey }, null, 2));
            return;
        }
        // 이미 있는 이미지는 보존한다. 동시 실행도 S3 조건부 생성으로 덮어쓰지 않는다.
        const s3 = new AWS.S3({ region: 'ap-northeast-2', credentials });
        let storedIcon;
        try { storedIcon = (await s3.getObject({ Bucket: bucket, Key: imageKey }).promise()).Body; }
        catch (error) { if (error.code !== 'NoSuchKey') throw error; }
        if (!storedIcon) {
            try {
                await s3.putObject({ Bucket: bucket, Key: imageKey, Body: icon, ContentType: 'image/png', IfNoneMatch: '*' }).promise();
            } catch (error) { if (error.statusCode !== 412) throw error; }
            storedIcon = (await s3.getObject({ Bucket: bucket, Key: imageKey }).promise()).Body;
        }
        if (!storedIcon.equals(icon)) throw new Error('동일한 이름의 다른 운영 이미지가 있어 보존했습니다. 확인이 필요합니다.');
        if (existing < 0) {
            await db.send(new UpdateCommand({
                ...key, UpdateExpression: 'SET #data = list_append(#data, :new)',
                ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' },
                ExpressionAttributeValues: { ':new': [definition], ':before': before }
            }));
        }
        const after = (await db.send(new GetCommand({ ...key, ConsistentRead: true }))).Item.data;
        if (!isDeepStrictEqual(existing < 0 ? after.slice(0, -1) : after, before) ||
            !isDeepStrictEqual(after[existing < 0 ? before.length : existing], definition)) {
            throw new Error('동시 운영 변경이 감지되었습니다. 다시 확인해주세요.');
        }
        const localIcon = path.join(root, 'DB/RPGenius/itemImage/가챠', REWARD_NAME + '.png');
        fs.writeFileSync(localIcon, storedIcon);
        // 로컬 기본 데이터도 새 항목만 추가한다. 운영 DB와 인덱스를 맞추지 않는다.
        const localFile = path.join(root, 'DB/RPGenius/Item.json');
        const text = fs.readFileSync(localFile, 'utf8');
        if (!JSON.parse(text).some(item => item?.name === REWARD_NAME)) {
            const eol = text.includes('\r\n') ? '\r\n' : '\n';
            fs.writeFileSync(localFile, text.replace(/\s*\]\s*$/, ',' + eol + '  ' +
                JSON.stringify(definition, null, 2).replace(/\n/g, eol + '  ') + eol + ']' + eol));
        }
        console.log(JSON.stringify({ id: existing < 0 ? before.length : existing, name: REWARD_NAME,
            created: existing < 0, preservedItems: before.length, imageVerified: true }));
    } finally { db.destroy(); }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { SOURCE_NAME, createDefinition };
