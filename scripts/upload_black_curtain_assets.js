const fs = require('fs');
const path = require('path');

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

const AWS = require('aws-sdk');
const assetStore = require('../asset_store.js');
const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
const prefix = 'tcgenius/assets/';
const s3 = new AWS.S3({
    region: process.env.AWS_REGION || 'ap-northeast-2',
    credentials: new AWS.Credentials({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID })
});

const assets = [
    ['ui', '월드보스/흑막/background.png'],
    ['ui', '월드보스/흑막.png'],
    ['ui', '월드보스/흑막/idle.png'],
    ['ui', '월드보스/흑막/dark-pulse.png'],
    ['ui', '월드보스/흑막/dark-barrage.png'],
    ['ui', '월드보스/흑막/icham.png'],
    ['ui', '월드보스/흑막/curse.png'],
    ['ui', '월드보스/흑막/defeat.png'],
    ['ui', '월드보스/흑막/effects/dark-pulse.png'],
    ['ui', '월드보스/흑막/effects/dark-barrage.png'],
    ['ui', '월드보스/흑막/effects/icham.png'],
    ['ui', '월드보스/흑막/effects/curse.png'],
    ['itemImage', '사용/흑막의 영혼석.png'],
    ['itemImage', '재료/흑막의 영혼석 조각.png'],
    ['itemImage', '번들/흑막의 상급 꾸러미.png'],
    ['itemImage', '번들/흑막의 중급 꾸러미.png'],
    ['itemImage', '번들/흑막의 하급 꾸러미.png']
];

(async () => {
    await assetStore.ready;
    const uploaded = [];
    for (const [category, rel] of assets) {
        if (process.argv.includes('--background-only') && !rel.endsWith('/background.png')) continue;
        const file = path.join(root, 'DB', 'RPGenius', category, ...rel.split('/'));
        const body = fs.readFileSync(file);
        const result = await assetStore.saveAsset(category, rel, body);
        if (!result.ok) throw new Error(category + '/' + rel + ': ' + result.error);
        const key = prefix + category + '/' + rel;
        const head = await s3.headObject({ Bucket: bucket, Key: key }).promise();
        if (Number(head.ContentLength || 0) !== body.length) throw new Error(key + ': 업로드 크기 검증 실패');
        uploaded.push({ key, bytes: body.length });
    }
    console.log(JSON.stringify({ bucket, uploaded }, null, 2));
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
