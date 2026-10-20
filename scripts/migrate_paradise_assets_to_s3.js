// 낙원 에셋만 기존 ui 저장소에 등록한다. 운영 아이템/보상 데이터는 변경하지 않는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AWS = require('aws-sdk');
const root = path.resolve(__dirname, '..');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
async function main() {
    const envIndex = process.argv.indexOf('--env-file');
    for (const file of [path.join(root, '.env'), path.join(root, '.env.local'), ...(envIndex >= 0 ? [path.resolve(process.argv[envIndex + 1])] : [])]) {
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const Bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2',
        credentials: new AWS.Credentials({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID, sessionToken: process.env.AWS_SESSION_TOKEN }) });
    const assets = require('./paradise_assets.json').map(({ file, sha256 }) => {
        const source = path.resolve(root, 'DB/RPGenius/ui/낙원', file);
        if (!source.startsWith(path.resolve(root, 'DB/RPGenius/ui/낙원') + path.sep)) throw new Error('잘못된 경로: ' + file);
        const Body = fs.readFileSync(source), ContentType = file.endsWith('.webp') ? 'image/webp' : file.endsWith('.mp3') ? 'audio/mpeg' : null;
        if (!ContentType || !Body.length || Body.length > 10 * 1024 * 1024 || digest(Body) !== sha256) throw new Error('에셋 검증 실패: ' + file);
        return { file, Body, sha256, ContentType, Key: 'tcgenius/assets/ui/낙원/' + file };
    });
    // 전체 충돌 검사 후 누락된 파일만 조건부 업로드한다. 같은 파일은 재실행해도 건너뛴다.
    for (const asset of assets) {
        try {
            const old = await s3.getObject({ Bucket, Key: asset.Key }).promise();
            if (digest(old.Body) !== asset.sha256) throw new Error('기존 S3 에셋과 다릅니다: ' + asset.Key);
            asset.exists = true;
        } catch (error) { if (!['NoSuchKey', 'NotFound'].includes(error.code)) throw error; }
    }
    const apply = process.argv.includes('--apply');
    for (const asset of assets) if (apply && !asset.exists) {
        const request = s3.putObject({ Bucket, Key: asset.Key, Body: asset.Body, ContentType: asset.ContentType,
            ContentMD5: crypto.createHash('md5').update(asset.Body).digest('base64'), Metadata: { sha256: asset.sha256 } });
        request.on('build', () => { request.httpRequest.headers['If-None-Match'] = '*'; });
        await request.promise();
        const saved = await s3.getObject({ Bucket, Key: asset.Key }).promise();
        if (digest(saved.Body) !== asset.sha256 || saved.ContentType !== asset.ContentType) throw new Error('업로드 검증 실패: ' + asset.file);
    }
    console.log(JSON.stringify({ bucket: Bucket, total: assets.length, existing: assets.filter(a => a.exists).length,
        uploaded: apply ? assets.filter(a => !a.exists).length : 0, assets: assets.map(({ Key, sha256 }) => ({ key: Key, sha256 })) }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
