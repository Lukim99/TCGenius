// 명시적 1회 실행: node scripts/migrate_raid_bgm_to_s3.js --apply
// 기본 실행은 S3를 읽어 변경 계획만 표시한다. asset_store의 부팅 동기화를 실행하지 않는다.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AWS = require('aws-sdk');

const root = path.join(__dirname, '..');
const filenames = ['부타게임.mp3', 'E세계대저택 1관문.mp3', 'E세계대저택 2관문.mp3'];
const hash = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) {
                process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
            }
        }
    }
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({
        region: process.env.AWS_REGION || 'ap-northeast-2',
        signatureVersion: 'v4',
        credentials: new AWS.Credentials({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_KEY_ID
        })
    });
    const assets = filenames.map(filename => ({
        filename,
        key: 'tcgenius/assets/ui/sfx/' + filename,
        body: fs.readFileSync(path.join(root, 'DB', 'RPGenius', 'ui', 'sfx', filename))
    }));
    for (const asset of assets) {
        try { asset.previous = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise(); }
        catch (error) { if (error.statusCode !== 404) throw error; }
        asset.unchanged = !!asset.previous && hash(asset.previous.Body) === hash(asset.body)
            && asset.previous.ContentType === 'audio/mpeg';
    }
    console.log(JSON.stringify({ bucket, assets: assets.map(asset => ({
        key: asset.key, bytes: asset.body.length,
        action: asset.unchanged ? 'unchanged' : asset.previous ? 'replace' : 'create'
    })) }, null, 2));
    if (!process.argv.includes('--apply')) return;

    const replacements = assets.filter(asset => asset.previous && !asset.unchanged);
    if (replacements.length) {
        const backupDir = path.join(root, 'output', 'raid-bgm-before-' + Date.now());
        fs.mkdirSync(backupDir, { recursive: true });
        for (const asset of replacements) fs.writeFileSync(path.join(backupDir, asset.filename), asset.previous.Body);
        fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(replacements.map(asset => ({
            key: asset.key, etag: asset.previous.ETag, contentType: asset.previous.ContentType
        })), null, 2));
        console.log('기존 음원 백업: ' + backupDir);
    }
    for (const asset of assets) {
        if (!asset.unchanged) {
            const upload = s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body,
                ContentType: 'audio/mpeg', ContentMD5: crypto.createHash('md5').update(asset.body).digest('base64') });
            // SDK v2에 없는 조건부 업로드 헤더를 서명 전에 전달한다.
            upload.on('build', () => {
                upload.httpRequest.headers[asset.previous ? 'If-Match' : 'If-None-Match'] = asset.previous?.ETag || '*';
            });
            await upload.promise();
        }
        const saved = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
        if (hash(saved.Body) !== hash(asset.body) || saved.ContentType !== 'audio/mpeg') {
            throw new Error(asset.key + ': S3 저장 내용 검증 실패');
        }
        console.log('검증 완료: ' + asset.key);
    }
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
