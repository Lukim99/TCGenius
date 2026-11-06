'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const AWS = require('aws-sdk');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { prepare, PEPERO_NAMES, KING_NAME } = require('../pepero_mansion_content');
const root = path.resolve(__dirname, '..');
const hash = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const credentials = { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID };
    const region = process.env.AWS_REGION || 'ap-northeast-2';
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region, credentials }));
    const keys = ['Item', 'Pack', 'Equipment', 'Paradise', 'PeperoEvent'];
    const read = async key => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key }, ConsistentRead: true }))).Item?.data;
    const before = Object.fromEntries(await Promise.all(keys.map(async key => [key, await read(key)])));
    const after = prepare(before), changed = keys.filter(key => !isDeepStrictEqual(before[key], after[key]));
    const artDir = process.argv.find(arg => arg.startsWith('--art-dir='))?.slice(10);
    const background = process.argv.find(arg => arg.startsWith('--background='))?.slice(13);
    if (!artDir || !background) throw new Error('--art-dir=아이템_원본_폴더와 --background=첨부_배경_파일을 지정해주세요.');
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({ region, credentials: new AWS.Credentials(credentials) });
    const assets = [
        ...[...PEPERO_NAMES, KING_NAME].map(name => ({ source: path.resolve(artDir, name + '.png'), relative: 'itemImage/가챠/' + name + '.png' })),
        { source: path.resolve(artDir, '고유 레지에로.png'), relative: 'itemImage/장비/고유 레지에로.png' },
        { source: path.resolve(background), relative: 'ui/필드/대저택리턴즈.png' }
    ].map(asset => ({ ...asset, key: 'tcgenius/assets/' + asset.relative, body: fs.readFileSync(asset.source) }));
    for (const asset of assets) {
        try {
            const current = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
            if (!asset.body.equals(current.Body)) throw new Error('기존 S3 이미지와 다릅니다: ' + asset.key);
            asset.exists = true;
        } catch (error) { if (error.code !== 'NoSuchKey') throw error; }
    }
    console.log(JSON.stringify({ changed, newItems: after.Item.slice(before.Item.length).map(item => item.name),
        newEquipment: after.Equipment.accessory.slice(before.Equipment.accessory.length), event: after.PeperoEvent,
        weekly: after.Paradise.weeklyRewards, assets: assets.map(asset => ({ key: asset.key, exists: !!asset.exists })) }, null, 2));
    if (!process.argv.includes('--apply')) return;
    const output = path.join(root, 'output/pepero-mansion'); fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'registration-before-' + Date.now() + '.json'), JSON.stringify(before, null, 2), { flag: 'wx' });
    for (const asset of assets) {
        if (!asset.exists) await s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: 'image/png' }).promise();
        const stored = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
        if (!asset.body.equals(stored.Body)) throw new Error('S3 검증 실패: ' + asset.key);
        const local = path.join(root, 'DB/RPGenius', asset.relative);
        fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, stored.Body);
    }
    if (changed.length) await db.send(new TransactWriteCommand({ TransactItems: keys.map(key => {
        if (before[key] === undefined) return { Put: { TableName: 'rpgenius_data', Item: { key, data: after[key] },
            ConditionExpression: 'attribute_not_exists(#key)', ExpressionAttributeNames: { '#key': 'key' } } };
        const contract = { TableName: 'rpgenius_data', Key: { key }, ConditionExpression: '#data = :before',
            ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':before': before[key] } };
        return changed.includes(key) ? { Update: { ...contract, UpdateExpression: 'SET #data = :after',
            ExpressionAttributeValues: { ...contract.ExpressionAttributeValues, ':after': after[key] } } } : { ConditionCheck: contract };
    }) }));
    for (const key of keys) if (!isDeepStrictEqual(await read(key), after[key])) throw new Error('등록 후 읽기 검증 불일치: ' + key);
    fs.writeFileSync(path.join(output, 'registered.json'), JSON.stringify(after, null, 2));
    fs.writeFileSync(path.join(output, 's3-assets-verified.json'), JSON.stringify({ bucket, assets: assets.map(asset => ({ key: asset.key, sha256: hash(asset.body), bytes: asset.body.length })) }, null, 2));
    console.log('운영 신규 콘텐츠·낙원 순위 구간 등록, S3 이미지 6개 검증 완료.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
