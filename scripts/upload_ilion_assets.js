'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
    const manifestIndex = process.argv.indexOf('--manifest');
    const assets = JSON.parse(fs.readFileSync(manifestIndex < 0 ? path.join(__dirname, 'ilion_assets.json') : path.resolve(root, process.argv[manifestIndex + 1]), 'utf8'));
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
    const apply = process.argv.includes('--apply'), replace = process.argv.includes('--replace-existing');
    const backupIndex = process.argv.indexOf('--backup-dir');
    if (apply && replace && (backupIndex < 0 || !process.argv[backupIndex + 1] || process.argv[backupIndex + 1].startsWith('--'))) {
        throw new Error('--replace-existing --apply에는 --backup-dir 경로가 필요합니다.');
    }
    let missing = 0, existing = 0, changed = 0;
    const pending = [];
    for (const { category, file, sha256: expectedSha256 } of assets) {
        const bytes = fs.readFileSync(path.join(root, 'DB/RPGenius', category, file));
        if (bytes.length > 10 * 1024 * 1024 || bytes.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG 에셋 크기/형식: ' + file);
        const Key = prefix + category + '/' + file, sha256 = digest(bytes);
        if (expectedSha256 && expectedSha256 !== sha256) throw new Error('등록된 에셋 해시와 다릅니다: ' + file);
        let old;
        try {
            old = await s3.getObject({ Bucket, Key }).promise();
            if (digest(old.Body) === sha256) { existing++; continue; }
            if (!replace) throw new Error('기존 S3 에셋과 다릅니다. 덮어쓰지 않습니다: ' + file);
            changed++;
        } catch (error) {
            if (!['NoSuchKey', 'NotFound'].includes(error.code)) throw error;
            missing++;
        }
        pending.push({ category, file, Key, bytes, sha256, old });
    }
    if (apply && changed) {
        const backupDir = path.resolve(root, process.argv[backupIndex + 1], 'ilion-assets-before-' + Date.now());
        fs.mkdirSync(backupDir, { recursive: true });
        for (const asset of pending.filter(asset => asset.old)) {
            const file = path.join(backupDir, asset.category, asset.file);
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, asset.old.Body);
        }
        fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(pending.map(asset => ({
            key: asset.Key, previousETag: asset.old ? asset.old.ETag : null,
            previousSha256: asset.old ? digest(asset.old.Body) : null, sha256: asset.sha256
        })), null, 2));
        console.log('교체 전 에셋 백업: ' + backupDir);
    }
    if (apply) for (const { Key, bytes, sha256, old, file } of pending) {
        const request = s3.putObject({ Bucket, Key, Body: bytes, ContentType: 'image/png', Metadata: { sha256 } });
        // 백업 이후 변경된 에셋은 덮어쓰지 않는다. 신규 파일도 조건부로 생성한다.
        request.on('build', () => { request.httpRequest.headers[old ? 'If-Match' : 'If-None-Match'] = old ? old.ETag : '*'; });
        await request.promise();
        const saved = await s3.getObject({ Bucket, Key }).promise();
        if (digest(saved.Body) !== sha256) throw new Error('업로드 검증 실패: ' + file);
    }
    console.log(JSON.stringify({ total: assets.length, existing, missing, changed, uploaded: apply ? pending.length : 0 }));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
