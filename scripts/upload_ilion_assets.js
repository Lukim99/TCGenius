'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const assets = require('./ilion_assets.json');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2', accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID });
    const Bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const prefix = 'tcgenius/assets/';
    let missing = 0, existing = 0;
    for (const { category, file } of assets) {
        const bytes = fs.readFileSync(path.join(root, 'DB/RPGenius', category, file));
        if (bytes.length > 10 * 1024 * 1024 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 에셋 크기/형식: ' + file);
        const Key = prefix + category + '/' + file, sha256 = digest(bytes);
        try {
            const old = await s3.getObject({ Bucket, Key }).promise();
            if (digest(old.Body) !== sha256) throw new Error('기존 S3 에셋과 다릅니다. 덮어쓰지 않습니다: ' + file);
            existing++;
            continue;
        } catch (error) {
            if (!['NoSuchKey', 'NotFound'].includes(error.code)) throw error;
        }
        missing++;
        if (!process.argv.includes('--apply')) continue;
        // 기존 키를 덮어쓰지 않도록 S3의 조건부 쓰기를 서명 전에 적용한다.
        const request = s3.putObject({ Bucket, Key, Body: bytes, ContentType: 'image/png', Metadata: { sha256 } });
        request.on('build', () => { request.httpRequest.headers['If-None-Match'] = '*'; });
        await request.promise();
        const saved = await s3.getObject({ Bucket, Key }).promise();
        if (digest(saved.Body) !== sha256) throw new Error('업로드 검증 실패: ' + file);
    }
    console.log(JSON.stringify({ total: assets.length, existing, missing, uploaded: process.argv.includes('--apply') ? missing : 0 }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
