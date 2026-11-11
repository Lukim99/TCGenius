'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const AWS = require('aws-sdk');
const { PETS, MATERIALS } = require('../personal_draw_content');
const root = path.resolve(__dirname, '..');
const uiSource = path.join(root, 'public/assets/personal-draw');
const artSource = process.argv.find(arg => arg.startsWith('--art-dir='))?.slice(10);
const apply = process.argv.includes('--apply');
const digest = body => crypto.createHash('sha256').update(body).digest('hex');

async function main() {
    if (!artSource) throw new Error('--art-dir=원본_펫_재료_폴더를 지정해주세요.');
    for (const name of ['.env', '.env.local']) {
        const file = path.join(root, name);
        if (!fs.existsSync(file)) continue;
        for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            const match = line.match(/^\s*([^#=]+)=(.*)$/);
            if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
        }
    }
    const bucket = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
    const s3 = new AWS.S3({ region: process.env.AWS_REGION || 'ap-northeast-2', credentials: new AWS.Credentials(process.env.AWS_ACCESS_KEY_ID, process.env.AWS_SECRET_KEY_ID) });
    const assets = [];
    function add(category, relative, source) {
        assets.push({ key: 'tcgenius/assets/' + category + '/' + relative, source,
            destination: path.join(root, 'DB/RPGenius', category, relative), body: fs.readFileSync(source) });
    }
    function walk(dir, relative = '') {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const rel = relative + entry.name, source = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(source, rel + '/');
            else if (/\.(png|webp)$/.test(entry.name) && !assets.some(asset => asset.key === 'tcgenius/assets/ui/퍼스널뽑기/' + rel)) add('ui', '퍼스널뽑기/' + rel, source);
        }
    }
    walk(uiSource);
    walk(path.join(root, 'DB/RPGenius/ui/퍼스널뽑기'));
    for (const pet of PETS) {
        const file = pet.rarity + ' ' + pet.name + '.png';
        add('itemImage', '펫/' + file, path.resolve(artSource, file));
    }
    for (const item of MATERIALS) add('itemImage', item.type + '/' + item.name + '.png', path.resolve(artSource, item.name + '.png'));
    // 기존 S3 원본과 다르면 덮어쓰지 않는다. 신규 파일만 업로드한다.
    for (const asset of assets) {
        try {
            const existing = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
            if (!asset.body.equals(existing.Body)) throw new Error('기존 S3 이미지와 다릅니다: ' + asset.key);
            asset.exists = true;
        } catch (error) { if (error.code !== 'NoSuchKey') throw error; }
    }
    console.log(JSON.stringify({ total: assets.length, upload: assets.filter(asset => !asset.exists).length, apply }));
    if (!apply) return;
    for (const asset of assets) {
        if (!asset.exists) await s3.putObject({ Bucket: bucket, Key: asset.key, Body: asset.body, ContentType: asset.key.endsWith('.webp') ? 'image/webp' : 'image/png' }).promise();
        const stored = await s3.getObject({ Bucket: bucket, Key: asset.key }).promise();
        if (!asset.body.equals(stored.Body)) throw new Error('업로드 검증 실패: ' + asset.key);
        fs.mkdirSync(path.dirname(asset.destination), { recursive: true });
        fs.writeFileSync(asset.destination, stored.Body);
    }
    // S3와 작업 사본이 모두 확인된 UI 파일만 public에서 제거한다. 제공된 원본은 보존한다.
    for (const asset of assets) if (asset.source.startsWith(uiSource + path.sep)) fs.unlinkSync(asset.source);
    const report = { bucket, verifiedAt: new Date().toISOString(), assets: assets.map(asset => ({ key: asset.key, bytes: asset.body.length, sha256: digest(asset.body) })) };
    fs.mkdirSync(path.join(root, 'output/personal-draw'), { recursive: true });
    fs.writeFileSync(path.join(root, 'output/personal-draw/s3-assets-verified.json'), JSON.stringify(report, null, 2));
    console.log('S3 업로드 및 원본 바이트 일치 확인 완료: ' + assets.length + '개');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
