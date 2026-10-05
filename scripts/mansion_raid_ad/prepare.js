// E세계 대저택 레이드 광고 — 소스 에셋 준비
// 게임 이미지·음원은 서버 디스크(DB/RPGenius/*)에서 먼저 찾고, 없으면 S3 원본(tcgenius/assets/)에서 읽는다.
// 폰트는 Google Fonts(OFL)에서 받는다. 결과는 .cache/ 아래에만 쓴다. 운영 데이터와 S3에는 쓰지 않는다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.join(__dirname, '.cache');
const SRC = path.join(CACHE, 'src');
const IMG = path.join(CACHE, 'img');
const SND = path.join(CACHE, 'snd');
const FONTS = path.join(CACHE, 'fonts');

// [저장 이름, 자산 상대 경로(category/rel), 가공]
const IMAGES = [
    ['field.jpg', 'ui/필드/이세계대저택.png', 'bg'],
    ['cover.jpg', 'ui/대저택/E세계 대저택 표지.png', 'bg'],
    ['sculptureHall.jpg', 'ui/레이드/sculpture-hall.png', 'bg'],
    ['sculptureScene.png', 'ui/레이드/sculpture-scene.png', 'layer'],
    ['whipHall.jpg', 'ui/레이드/whiplash-hall.png', 'bg'],
    ['whipScene.png', 'ui/레이드/whiplash-scene.png', 'layer'],
    ['echoHall.jpg', 'ui/레이드/whiplash-echo-hall.png', 'bg'],
    ['echoScene.png', 'ui/레이드/whiplash-echo-scene.png', 'layer'],
    ['shard.png', 'ui/레이드/fx-bronze-shard.png', 'sprite'],
    ['mist.png', 'ui/레이드/fx-dark-mist.png', 'sprite'],
    ['artifact.png', 'itemImage/장비/레전더리 아티팩트.png', 'icon'],
    ['fragment.png', 'itemImage/재료/이세계 파편.png', 'icon'],
    ['potion.png', 'itemImage/소모품/투신의 함성 포션.png', 'icon'],
    ['petJogak.png', 'itemImage/펫/유니크 조각.png', 'icon'],
    ['petWhip.png', 'itemImage/펫/레전더리 위플래쉬.png', 'icon'],
    ['title1.png', 'ui/칭호/이세계의축복을.png', 'title'],
    ['title2.png', 'ui/칭호/대저택마스터.png', 'title'],
    ['title3.png', 'ui/칭호/악몽의 대저택.png', 'title'],
    ['title4.png', 'ui/칭호/저 눈 뜨고 있습니다.png', 'title'],
    ['title5.png', 'ui/칭호/E세계 대저택 퍼스트 클리어.png', 'title'],
    ['pikachu.jpg', 'ui/대저택/피카츄.png', 'portrait'],
    ['aurora.jpg', 'ui/대저택/오로라.png', 'portrait'],
    ['justice.jpg', 'ui/대저택/눈뜬 장님.png', 'portrait']
];

const SOUNDS = [
    'ui/sfx/E세계대저택 1관문.mp3',
    'ui/sfx/E세계대저택 2관문.mp3',
    'ui/sfx/count.mp3',
    'ui/sfx/crit.mp3',
    'ui/sfx/hit_0.mp3',
    'ui/sfx/hit_1.mp3',
    'ui/sfx/hit_2.mp3',
    ...[
        'signal-v2', 'bronze-set-v2', 'shards-rush-v2', 'stone-hit-v2', 'resonance-impact-v2', 'wall-pressure-v2',
        'echo-break-v2', 'ward-form-v2', 'power-gather-v2', 'dark-surge-v2', 'dark-growl-v2', 'dark-impact-v2',
        'raid-clear-v2', 'raid-start-v2', 'puzzle-hit-v2', 'ground-land-v2', 'critical-hit-v2', 'skill-cast-v2',
        'sky-impact-v2', 'healing-absorb-v2', 'mirror-glint-v2', 'doom-pressure-v2'
    ].map(n => `ui/sfx/raid/${n}.mp3`)
];

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@700;900&family=Noto+Sans+KR:wght@500;700;900'
    + '&family=Cinzel:wght@500;700;900&family=Barlow+Condensed:wght@500;600;700;800&family=JetBrains+Mono:wght@500;700'
    + '&family=Black+Han+Sans';

let s3 = null;
function s3Client() {
    if (s3) return s3;
    const AWS = require(path.join(ROOT, 'node_modules', 'aws-sdk'));
    s3 = new AWS.S3({
        region: process.env.AWS_REGION || 'ap-northeast-2',
        credentials: new AWS.Credentials({
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_KEY_ID
        })
    });
    return s3;
}

async function fetchAsset(rel) {
    const dst = path.join(SRC, rel);
    if (fs.existsSync(dst)) return dst;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const local = path.join(ROOT, 'DB', 'RPGenius', rel);
    if (fs.existsSync(local)) {
        fs.copyFileSync(local, dst);
        return dst;
    }
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const obj = await s3Client().getObject({ Bucket: bucket, Key: 'tcgenius/assets/' + rel }).promise();
    fs.writeFileSync(dst, obj.Body);
    return dst;
}

function magick(args) {
    execFileSync('convert', args, { stdio: 'inherit' });
}

function processImage(src, out, kind) {
    const dst = path.join(IMG, out);
    if (fs.existsSync(dst)) return;
    // 배경과 같은 캔버스의 전경은 같은 배율로 키워 원본 구도를 유지한다.
    if (kind === 'bg') magick([src, '-filter', 'Lanczos', '-resize', '2560x', '-unsharp', '0x0.8+0.6+0.02', '-quality', '94', dst]);
    else if (kind === 'layer') magick([src, '-filter', 'Lanczos', '-resize', '2560x', '-unsharp', '0x0.8+0.6+0.02', dst]);
    else if (kind === 'sprite') magick([src, '-filter', 'Lanczos', '-resize', '640x640', dst]);
    else if (kind === 'icon') magick([src, '-filter', 'Lanczos', '-resize', '640x640', dst]);
    else if (kind === 'title') magick([src, '-filter', 'Lanczos', '-resize', '1024x', dst]);
    else if (kind === 'portrait') magick([src, '-filter', 'Lanczos', '-resize', '960x960', '-quality', '92', dst]);
}

async function get(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res;
}

async function fetchFonts() {
    fs.mkdirSync(FONTS, { recursive: true });
    // 일반 UA로 요청하면 단일 TTF 주소를 돌려준다.
    const css = await (await get(FONT_CSS)).text();
    const faces = css.match(/@font-face\s*{[^}]*}/g) || [];
    for (const face of faces) {
        const family = face.match(/font-family: '([^']+)'/)[1];
        const weight = face.match(/font-weight: (\d+)/)[1];
        const url = face.match(/url\(([^)]+)\)/)[1];
        const file = path.join(FONTS, `${family.replace(/ /g, '')}-${weight}.ttf`);
        if (fs.existsSync(file)) continue;
        fs.writeFileSync(file, Buffer.from(await (await get(url)).arrayBuffer()));
        console.log('font', path.basename(file));
    }
}

(async () => {
    fs.mkdirSync(IMG, { recursive: true });
    fs.mkdirSync(SND, { recursive: true });
    for (const [out, rel, kind] of IMAGES) processImage(await fetchAsset(rel), out, kind);
    for (const rel of SOUNDS) {
        const src = await fetchAsset(rel);
        const dst = path.join(SND, path.basename(rel));
        if (!fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    await fetchFonts();
    console.log(`ready: ${IMAGES.length} images, ${SOUNDS.length} sounds → ${path.relative(ROOT, CACHE)}`);
})().catch(err => {
    console.error(err);
    process.exit(1);
});
