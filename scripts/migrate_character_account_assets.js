'use strict';

// Explicit asset migration only. No operational item/shop data is written here.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const AWS = require('aws-sdk');
const root = path.resolve(__dirname, '..');
const option = name => process.argv.find(arg => arg.startsWith('--' + name + '='))?.slice(name.length + 3);
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
    const characters = option('characters-dir'), items = option('items-dir');
    if (!characters || !items) throw new Error('--characters-dir and --items-dir are required.');
    const apply = process.argv.includes('--apply');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(option('env-dir') || root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*((?:AWS_|S3_)[A-Z_]+)=(.*)$/);
            if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2', credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID,
        sessionToken: process.env.AWS_SESSION_TOKEN
    }) });
    const assets = [];
    function add(relative, source, cover) {
        const body = fs.readFileSync(source);
        if (body.length < 24 || body.length > 10 * 1024 * 1024 || body.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG: ' + source);
        if (cover && (body.readUInt32BE(16) !== 1920 || body.readUInt32BE(20) !== 1080)) throw new Error('Cover must be 1920x1080: ' + source);
        assets.push({ relative, key: 'tcgenius/assets/' + relative, body, sha256: sha256(body), destination: path.join(root, 'DB/RPGenius', relative) });
    }
    for (const card of require('../DB/RPGenius/CharacterCards.json')) for (const type of ['일반', '전직']) {
        const file = '캐릭터표지(' + type + ').png';
        add('cardImage/카드분리/캐릭터/' + card.name + '/' + file, path.join(characters, card.name, file), true);
    }
    for (const name of ['닉네임 변경권', '카드 전송기', '장비 전송기', '캐릭터 슬롯 확장권']) add('itemImage/티켓/' + name + '.png', path.join(items, name + '.png'));
    // Read and back up every existing target before the first replacement.
    for (let i = 0; i < assets.length; i += 4) await Promise.all(assets.slice(i, i + 4).map(async asset => {
        try { asset.previous = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise(); }
        catch (error) { if (error.code !== 'NoSuchKey') throw error; }
        asset.changed = !asset.previous || !asset.body.equals(asset.previous.Body);
    }));
    console.log(JSON.stringify({ bucket, total: assets.length, replace: assets.filter(a => a.changed && a.previous).length, add: assets.filter(a => !a.previous).length, unchanged: assets.filter(a => !a.changed).length, apply }));
    if (!apply) return;
    const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'rpgenius-character-assets-'));
    const save = (file, body) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, body); };
    for (const asset of assets) {
        if (asset.changed && asset.previous) save(path.join(backup, 's3', asset.relative), asset.previous.Body);
        if (fs.existsSync(asset.destination)) {
            const local = fs.readFileSync(asset.destination);
            if (!local.equals(asset.body)) save(path.join(backup, 'local', asset.relative), local);
        }
    }
    save(path.join(backup, 'manifest.json'), JSON.stringify(assets.map(a => ({ key: a.key, beforeETag: a.previous?.ETag, afterSha256: a.sha256 })), null, 2));
    for (const asset of assets) {
        if (asset.changed) {
            const request = s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: 'image/png',
                ContentMD5: crypto.createHash('md5').update(asset.body).digest('base64'), ...(!asset.previous ? { IfNoneMatch: '*' } : {}) });
            // This SDK predates PutObject.IfMatch; add the supported HTTP precondition before signing.
            // https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html
            if (asset.previous) request.on('build', () => { request.httpRequest.headers['If-Match'] = asset.previous.ETag; });
            await request.promise();
        }
        const stored = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
        if (!asset.body.equals(stored.Body) || stored.ContentType !== 'image/png') throw new Error('S3 verification failed: ' + asset.key);
        save(asset.destination, stored.Body);
    }
    save(path.join(root, 'scripts/character_account_assets.json'), JSON.stringify({ bucket, assets: assets.map(a => ({ key: a.key, bytes: a.body.length, sha256: a.sha256 })) }, null, 2) + '\n');
    console.log(JSON.stringify({ verified: assets.length, backup }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
