const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AWS = require('aws-sdk');

const root = path.resolve(__dirname, '..');
const generatedSourceDir = path.join(root, 'public', 'assets', 'hunting');
const localAssetDir = path.join(root, 'DB', 'RPGenius');
const definitions = [
    ['training-background.png', 'ui', '필드/훈련장.png'],
    ['training-dummy-v2.png', 'ui', '필드/몬스터/훈련장-허수아비.png'],
    ['intrigue-monsters.png', 'ui', '필드/몬스터/인트리그미션.png'],
    ['gold-bar.png', 'itemImage', '재료/금괴0.1돈.png'],
    ['game-changer.png', 'itemImage', '장비/고유 게임체인저.png']
];
const providedDefinitions = [
    ['인트리그미션.png', 'ui', '필드/인트리그미션.png'],
    ['훈련장.png', 'ui', '필드/훈련장.png'],
    ['금괴0.1돈.png', 'itemImage', '재료/금괴0.1돈.png'],
    ['고유 게임체인저.png', 'itemImage', '장비/고유 게임체인저.png'],
    ['한가위맞이각성패키지.png', 'itemImage', '번들/한가위맞이각성패키지.png'],
    ['한가위맞이강화패키지.png', 'itemImage', '번들/한가위맞이강화패키지.png']
];

async function main() {
    const sourceIndex = process.argv.indexOf('--source-dir');
    const provided = sourceIndex >= 0;
    if (provided && (!process.argv[sourceIndex + 1] || process.argv[sourceIndex + 1].startsWith('--'))) throw new Error('--source-dir 뒤에 PNG 원본 폴더를 지정해주세요.');
    const sourceDir = provided ? path.resolve(process.argv[sourceIndex + 1]) : generatedSourceDir;
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2', credentials: new AWS.Credentials({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID }) });
    const assets = (provided ? providedDefinitions : definitions).map(([file, category, relative]) => {
        const source = path.resolve(sourceDir, file), destination = path.resolve(localAssetDir, category, relative);
        if (!source.startsWith(sourceDir + path.sep) || !destination.startsWith(localAssetDir + path.sep)) throw new Error('자산 이동 경로가 작업 폴더를 벗어납니다.');
        const body = fs.readFileSync(provided || fs.existsSync(source) ? source : destination);
        return { source, destination, body, key: 'tcgenius/assets/' + category + '/' + relative };
    });
    console.log(JSON.stringify({ bucket, assets: assets.map(asset => ({ key: asset.key, bytes: asset.body.length })) }, null, 2));
    if (!process.argv.includes('--apply')) return;
    for (const asset of assets) {
        const digest = crypto.createHash('md5').update(asset.body).digest();
        const result = await s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: 'image/png', ContentMD5: digest.toString('base64') }).promise();
        if (result.ETag.replace(/"/g, '') !== digest.toString('hex')) throw new Error(asset.key + ': 업로드 내용 검증 실패');
        const head = await s3.headObject({ Bucket: bucket, Key: asset.key }).promise();
        if (head.ContentLength !== asset.body.length || head.ETag !== result.ETag) throw new Error(asset.key + ': 저장 결과 검증 실패');
    }
    for (const asset of assets) {
        fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
        if (provided) fs.writeFileSync(asset.destination, asset.body);
        else if (fs.existsSync(asset.source)) fs.renameSync(asset.source, asset.destination);
    }
    console.log('최종 에셋 ' + assets.length + '개 S3 업로드·내용 검증 및 부팅 동기화 경로 ' + (provided ? '복사 완료. 사용자 원본은 보존했습니다.' : '이동 완료.'));
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { definitions, providedDefinitions };
