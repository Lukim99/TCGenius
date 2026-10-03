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

const mansionDefinitions = [
    [
        "E세계 대저택 표지.png",
        "ui",
        "대저택/E세계 대저택 표지.png"
    ],
    [
        "조각.png",
        "ui",
        "대저택/조각.png"
    ],
    [
        "위플래쉬.png",
        "ui",
        "대저택/위플래쉬.png"
    ],
    [
        "위플래쉬(0줄).png",
        "ui",
        "대저택/위플래쉬(0줄).png"
    ],
    [
        "피카츄.png",
        "ui",
        "대저택/피카츄.png"
    ],
    [
        "오로라.png",
        "ui",
        "대저택/오로라.png"
    ],
    [
        "눈뜬 장님.png",
        "ui",
        "대저택/눈뜬 장님.png"
    ],
    [
        "아티팩트.png",
        "itemImage",
        "장비/레어 아티팩트.png"
    ],
    [
        "아티팩트.png",
        "itemImage",
        "장비/유니크 아티팩트.png"
    ],
    [
        "아티팩트.png",
        "itemImage",
        "장비/레전더리 아티팩트.png"
    ],
    [
        "아티팩트 재료.png",
        "itemImage",
        "재료/아티팩트 재료.png"
    ],
    [
        "이세계 파편.png",
        "itemImage",
        "재료/이세계 파편.png"
    ],
    [
        "투신의 함성 포션.png",
        "itemImage",
        "소모품/투신의 함성 포션.png"
    ],
    [
        "유니크 조각.png",
        "itemImage",
        "펫/유니크 조각.png"
    ],
    [
        "레전더리 위플래쉬.png",
        "itemImage",
        "펫/레전더리 위플래쉬.png"
    ],
    [
        "이세계의축복을.png",
        "ui",
        "칭호/이세계에게축복을.png"
    ],
    [
        "대저택 마스터.png",
        "ui",
        "칭호/대저택마스터.png"
    ],
    [
        "저 눈 뜨고 있습니다.png",
        "ui",
        "칭호/저 눈 뜨고 있습니다..png"
    ],
    [
        "악몽의 대저택.png",
        "ui",
        "칭호/악몽의 대저택.png"
    ],
    [
        "E세계 대저택 퍼스트 클리어.png",
        "ui",
        "칭호/E세계 대저택 퍼스트 클리어.png"
    ]
];

const octoberDefinitions = [
    ['아티팩트 옵션 변경열쇠.png', 'itemImage', '사용/아티팩트 옵션 변경열쇠.png'],
    ['아티팩트패키지.png', 'itemImage', '번들/아티팩트패키지.png'],
    ['[10월]각성보석세트.png', 'itemImage', '번들/[10월]각성보석세트.png'],
    ['[10월]조합성공률30%증가럭키카드.png', 'itemImage', '티켓/[10월]조합성공률30%증가럭키카드.png'],
    ['이달의 아이템.png', 'ui', '봉인된 자물쇠/이달의 아이템.png']
];

async function main() {
    const sourceIndex = process.argv.indexOf('--source-dir');
    const provided = sourceIndex >= 0;
    const mansion = process.argv.includes('--mansion');
    const october = process.argv.includes('--october');
    if (mansion && !provided) throw new Error('--mansion에는 --source-dir 원본 폴더가 필요합니다.');
    if (october && (!provided || mansion)) throw new Error('--october에는 --source-dir 원본 폴더가 필요하며 --mansion과 함께 실행할 수 없습니다.');
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
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2', signatureVersion: 'v4', credentials: new AWS.Credentials({ accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID }) });
    const assets = (october ? octoberDefinitions : mansion ? mansionDefinitions : provided ? providedDefinitions : definitions).map(([file, category, relative]) => {
        const source = path.resolve(sourceDir, file), destination = path.resolve(localAssetDir, category, relative);
        if (!source.startsWith(sourceDir + path.sep) || !destination.startsWith(localAssetDir + path.sep)) throw new Error('자산 이동 경로가 작업 폴더를 벗어납니다.');
        const body = fs.readFileSync(provided || fs.existsSync(source) ? source : destination);
        return { source, destination, body, key: 'tcgenius/assets/' + category + '/' + relative };
    });
    console.log(JSON.stringify({ bucket, assets: assets.map(asset => ({ key: asset.key, bytes: asset.body.length })) }, null, 2));
    if (!process.argv.includes('--apply')) return;
    if (october) {
        const backupIndex = process.argv.indexOf('--backup-dir');
        if (backupIndex < 0 || !process.argv[backupIndex + 1]) throw new Error('--october --apply에는 --backup-dir 경로가 필요합니다.');
        const backupDir = path.resolve(process.argv[backupIndex + 1], 'october-assets-before-' + Date.now());
        fs.mkdirSync(backupDir, { recursive: true });
        for (const asset of assets) {
            let head;
            try { head = await s3.headObject({ Bucket: bucket, Key: asset.key }).promise(); }
            catch (error) { if (error.statusCode !== 404) throw error; }
            if (!head) continue;
            asset.previousETag = head.ETag;
            const previous = await s3.getObject({ Bucket: bucket, Key: asset.key, IfMatch: head.ETag }).promise();
            const file = path.join(backupDir, asset.key.slice('tcgenius/assets/'.length));
            fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, previous.Body);
        }
        fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(assets.map(asset => ({ key: asset.key, previousETag: asset.previousETag || null })), null, 2));
    }
    for (const asset of assets) {
        const digest = crypto.createHash('md5').update(asset.body).digest();
        const upload = s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: 'image/png', ContentMD5: digest.toString('base64') });
        // 설치된 SDK v2에 없는 PutObject If-Match도 서명 전에 HTTP 헤더로 전달한다.
        if (october) upload.on('build', () => { upload.httpRequest.headers[asset.previousETag ? 'If-Match' : 'If-None-Match'] = asset.previousETag || '*'; });
        const result = await upload.promise();
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
module.exports = { definitions, providedDefinitions, mansionDefinitions, octoberDefinitions };
