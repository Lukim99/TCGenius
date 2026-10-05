// 신규 레이드 이미지, 외부 효과음과 직접 편곡한 BGM만 업로드한다. 운영 데이터나 원본 이미지는 수정하지 않는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.join(__dirname, '..');
for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (!match || process.env[match[1].trim()]) continue;
        process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
}
const files = [
    ...['black-hodu', 'black-hodu-aura', 'hodu-retainer', 'hodu-retainer-court',
        'ingyeo', 'ingyeo-berserk', 'ingyeo-berserk-arena', 'volcanic-arena', 'tabujago-scene', 'dungeon-gate',
        'sculpture-scene', 'sculpture-hall', 'whiplash-scene', 'whiplash-hall', 'whiplash-echo-scene', 'whiplash-echo-hall',
        'fx-dark-mist', 'fx-bronze-shard', 'fx-fire-flow-v2', 'fx-puzzle-piece-v1', 'fx-sculpture-carving-v1', 'whiplash-echo-body-v1',
        'fx-party-heal', 'fx-party-aegis', 'lukim-birthday-boss-v1', 'lukim-birthday-hall-v1'].map(name => '레이드/' + name + '.png'),
    ...['signal', 'bronze-set', 'shards-rush', 'stone-hit', 'resonance-impact', 'wall-pressure', 'echo-break',
        'ward-form', 'obsidian-close', 'mochi-flex', 'rain-veil', 'mirror-glint', 'power-gather', 'life-drain',
        'dark-surge', 'dark-growl', 'dealing-aura', 'revival-bloom', 'fire-ignite', 'fire-erupt', 'sky-load',
        'sky-impact', 'doom-pressure', 'doom-cut', 'healing-absorb', 'dark-impact', 'dealing-cut', 'ground-land',
        'puzzle-hit', 'raid-clear', 'raid-fail'].map(name => 'sfx/raid/' + name + '-v2.mp3'),
    'sfx/lukim-birthday-phase1-v1.mp3'
];
const assets = files.map(file => {
    const body = fs.readFileSync(path.join(root, 'DB', 'RPGenius', 'ui', ...file.split('/')));
    if (!body.length || body.length > 10 * 1024 * 1024) throw new Error(file + ': 잘못된 파일 크기');
    return { key: 'tcgenius/assets/ui/' + file, body, md5: crypto.createHash('md5').update(body).digest('hex'),
        type: file.endsWith('.png') ? 'image/png' : 'audio/mpeg' };
});
const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
async function main() {
    if (process.argv.includes('--dry-run')) {
        console.log(JSON.stringify({ bucket, assets: assets.map(a => ({ key: a.key, bytes: a.body.length, md5: a.md5 })) }, null, 2));
        return;
    }
    const AWS = require('aws-sdk');
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2',
        credentials: new AWS.Credentials({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID }) });
    // 업로드 전 전체 대상의 충돌을 확인한다. 내용이 다른 기존 에셋을 덮어쓰지 않는다.
    for (const asset of assets) {
        try {
            const head = await s3.headObject({ Bucket: bucket, Key: asset.key }).promise();
            if (head.ETag !== '"' + asset.md5 + '"' || head.ContentLength !== asset.body.length) throw new Error(asset.key + ': 기존 에셋과 내용이 다릅니다.');
            asset.exists = true;
        } catch (error) { if (error.code !== 'NotFound') throw error; }
    }
    const verified = [];
    for (const asset of assets) {
        if (!asset.exists) await s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: asset.type,
            ContentMD5: Buffer.from(asset.md5, 'hex').toString('base64'), IfNoneMatch: '*' }).promise();
        const head = await s3.headObject({ Bucket: bucket, Key: asset.key }).promise();
        if (head.ETag !== '"' + asset.md5 + '"' || head.ContentLength !== asset.body.length || head.ContentType !== asset.type) throw new Error(asset.key + ': 업로드 검증 실패');
        verified.push({ key: asset.key, bytes: head.ContentLength, uploaded: !asset.exists });
    }
    console.log(JSON.stringify({ bucket, verified }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
