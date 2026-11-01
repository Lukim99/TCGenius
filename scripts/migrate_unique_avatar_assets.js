'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), AWS = require('aws-sdk');
const root = path.resolve(__dirname, '..');
const source = 'C:/Users/dodom/Downloads/1차 유니크 아바타';
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function manifest() {
    const result = [], add = (from, category, file) => result.push({ source: path.join(source, from), category, file });
    for (const character of fs.readdirSync(path.join(source, '캐릭터'))) {
        for (const file of fs.readdirSync(path.join(source, '캐릭터', character)).filter(file => file.includes('유니크 1차'))) add(path.join('캐릭터', character, file), 'cardImage', '카드분리/캐릭터/' + character + '/' + file);
    }
    for (const file of fs.readdirSync(path.join(source, '전신'))) add(path.join('전신', file), 'ui', '유니크아바타/전신/' + file.replace('_전신', ''));
    for (const file of fs.readdirSync(path.join(source, '컷씬'))) add(path.join('컷씬', file), 'ui', '유니크아바타/컷씬/' + file.replace('1차 유니크 아바타 전용 ', '').replace(' 궁극기 컷씬', ''));
    for (const file of fs.readdirSync(path.join(source, '새 아이템들'))) add(path.join('새 아이템들', file), 'itemImage', (file.includes('큐브') ? '사용/' : '아바타/') + file);
    return result;
}
async function main() {
    for (const file of ['.env', '.env.local']) for (const line of fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([^#=]+)=(.*)$/); if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2', accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID });
    const Bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const apply = process.argv.includes('--apply'), list = manifest(), verified = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
        while (cursor < list.length) {
            const asset = list[cursor++], bytes = fs.readFileSync(asset.source), sha256 = hash(bytes);
            const Key = 'tcgenius/assets/' + asset.category + '/' + asset.file;
            let exists = false;
            try { const old = await s3.getObject({ Bucket, Key }).promise(); if (hash(old.Body) !== sha256) throw new Error('기존 에셋과 달라 덮어쓰지 않습니다: ' + Key); exists = true; }
            catch (error) { if (!['NoSuchKey', 'NotFound'].includes(error.code)) throw error; }
            if (apply) {
                if (!exists) await s3.putObject({ Bucket, Key, Body: bytes, ContentType: asset.file.endsWith('.webp') ? 'image/webp' : 'image/png', Metadata: { sha256 }, IfNoneMatch: '*' }).promise();
                const uploaded = await s3.getObject({ Bucket, Key }).promise();
                if (hash(uploaded.Body) !== sha256) throw new Error('S3 내용 검증 실패: ' + Key);
                const local = path.join(root, 'DB/RPGenius', asset.category, asset.file);
                if (fs.existsSync(local) && hash(fs.readFileSync(local)) !== sha256) throw new Error('기존 로컬 에셋과 다릅니다: ' + local);
                fs.mkdirSync(path.dirname(local), { recursive: true }); fs.writeFileSync(local, bytes);
            }
            verified.push({ category: asset.category, file: asset.file, sha256, bytes: bytes.length, existing: exists });
        }
    }));
    const dir = path.join(root, 'output/unique-avatar'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, apply ? 's3-verified.json' : 's3-plan.json'), JSON.stringify({ at: new Date().toISOString(), bucket: Bucket, assets: verified }, null, 2));
    console.log(JSON.stringify({ apply, assets: verified.length, existing: verified.filter(a => a.existing).length, bytes: verified.reduce((n, a) => n + a.bytes, 0) }));
}
module.exports = { manifest };
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
