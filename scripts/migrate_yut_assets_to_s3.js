const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const root = path.resolve(__dirname, '..');
for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
}

const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
const s3 = new AWS.S3({
    region: process.env.AWS_REGION || 'ap-northeast-2',
    credentials: new AWS.Credentials({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID })
});
const sourceDir = path.join(root, 'public', 'assets', 'yut');
const localAssetDir = path.join(root, 'DB', 'RPGenius');
const assets = [
    ...['background', 'board-simple', 'title', 'result-do', 'result-gae', 'result-geol', 'result-yut', 'result-mo', 'result-finish', 'result-again']
        .map(name => ({ file: name + '.png', category: 'ui', relative: '윷놀이/' + name + '.png' })),
    { file: 'stick.png', category: 'itemImage', relative: '이벤트/윷.png' }
].map(asset => {
    const source = path.resolve(sourceDir, asset.file);
    const destination = path.resolve(localAssetDir, asset.category, asset.relative);
    if (!source.startsWith(sourceDir + path.sep) || !destination.startsWith(localAssetDir + path.sep)) throw new Error('자산 이동 경로가 작업 폴더를 벗어납니다.');
    return { ...asset, source, destination, body: fs.readFileSync(fs.existsSync(source) ? source : destination) };
});

(async () => {
    // 업로드 응답만 사용한다. 별도 HEAD/재다운로드 검증이나 테스트는 실행하지 않는다.
    for (const asset of assets) {
        const key = 'tcgenius/assets/' + asset.category + '/' + asset.relative;
        await s3.putObject({ Bucket: bucket, Key: key, Body: asset.body, ContentType: 'image/png' }).promise();
        console.log('업로드 완료: s3://' + bucket + '/' + key);
    }
    // 모든 업로드가 끝난 뒤 기존 부팅 동기화가 관리하는 작업 사본 위치로 옮긴다.
    for (const asset of assets) {
        fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
        if (fs.existsSync(asset.source)) fs.renameSync(asset.source, asset.destination);
    }
    console.log('윷놀이 이미지 ' + assets.length + '개 S3 이전 및 로컬 작업 사본 이동 완료.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
