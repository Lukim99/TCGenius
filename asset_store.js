// 게임 이미지 자산 저장소 — S3가 원본, 서버 디스크는 작업 사본.
// - 부팅 시 S3 → 로컬 동기화 (없거나 크기가 다른 파일만 다운로드; 로컬 전용 파일은 삭제하지 않는다)
// - 관리자 업로드/삭제는 로컬+S3에 동시 반영 (로컬 mtime 변경으로 card_composite 합성 캐시가 자동 무효화됨)
// - 저장소에서 자산을 제거(레포 슬림화)한 뒤에도 새 컨테이너가 부팅 동기화로 전체를 복원한다.
const fs = require('fs');
const path = require('path');
const AWS = require('aws-sdk');

const ASSET_BUCKET = process.env.S3_ASSET_BUCKET || process.env.S3_BANNER_BUCKET || 'eefl-image';
const ASSET_PREFIX = 'tcgenius/assets/';
const CATEGORIES = {
    cardImage: path.join(__dirname, 'DB', 'RPGenius', 'cardImage'),
    itemImage: path.join(__dirname, 'DB', 'RPGenius', 'itemImage'),
    ui: path.join(__dirname, 'DB', 'RPGenius', 'ui')
};
const EXT_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp3': 'audio/mpeg' };
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const SYNC_CONCURRENCY = 10;

const s3 = new AWS.S3({
    region: process.env.AWS_REGION || 'ap-northeast-2',
    credentials: new AWS.Credentials({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_KEY_ID
    })
});

// 상대 경로 검증: 세그먼트별 basename 일치(경로 이탈 차단), 빈 세그먼트·백슬래시·널 금지
function isSafeRelPath(rel) {
    if (typeof rel != 'string' || !rel || rel.length > 300) return false;
    if (rel.includes('\\') || rel.includes('\0') || rel.startsWith('/') || rel.endsWith('/')) return false;
    return rel.split('/').every(seg => seg.length > 0 && seg !== '.' && seg !== '..' && path.basename(seg) === seg);
}

function categoryDir(category) {
    return CATEGORIES[category] || null;
}

function localPathOf(category, rel) {
    const base = categoryDir(category);
    if (!base || (rel !== '' && !isSafeRelPath(rel))) return null;
    const full = path.join(base, rel);
    if (full !== base && !full.startsWith(base + path.sep)) return null;
    return full;
}

function s3KeyOf(category, rel) {
    return ASSET_PREFIX + category + '/' + rel;
}

// ===== 부팅 동기화 =====

const syncState = { status: 'pending', startedAt: null, finishedAt: null, checked: 0, downloaded: 0, failed: 0, error: null };

async function listAllS3Objects() {
    const objects = [];
    let ContinuationToken = undefined;
    do {
        const res = await s3.listObjectsV2({ Bucket: ASSET_BUCKET, Prefix: ASSET_PREFIX, ContinuationToken }).promise();
        for (const o of res.Contents || []) objects.push({ key: o.Key, size: o.Size });
        ContinuationToken = res.NextContinuationToken;
    } while (ContinuationToken);
    return objects;
}

async function downloadObjectToLocal(key, localPath) {
    const object = await s3.getObject({ Bucket: ASSET_BUCKET, Key: key }).promise();
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, object.Body);
}

async function syncFromS3() {
    syncState.status = 'running';
    syncState.startedAt = Date.now();
    const objects = await listAllS3Objects();
    const jobs = [];
    for (const o of objects) {
        const rel = o.key.slice(ASSET_PREFIX.length); // "<category>/<상대경로>"
        const slash = rel.indexOf('/');
        if (slash < 1) continue;
        const category = rel.slice(0, slash);
        const relPath = rel.slice(slash + 1);
        const localPath = localPathOf(category, relPath);
        if (!localPath) continue;
        syncState.checked++;
        let st = null;
        try { st = fs.statSync(localPath); } catch (_) { }
        if (st && st.size === o.size) continue;
        jobs.push({ key: o.key, localPath });
    }
    let idx = 0;
    async function worker() {
        while (idx < jobs.length) {
            const job = jobs[idx++];
            try {
                await downloadObjectToLocal(job.key, job.localPath);
                syncState.downloaded++;
            } catch (e) {
                // 1회 재시도
                try {
                    await downloadObjectToLocal(job.key, job.localPath);
                    syncState.downloaded++;
                } catch (e2) {
                    syncState.failed++;
                    console.error('[asset-store] 동기화 실패: ' + job.key + ' - ' + (e2 && e2.message));
                }
            }
        }
    }
    await Promise.all(Array.from({ length: SYNC_CONCURRENCY }, worker));
    syncState.status = syncState.failed > 0 ? 'partial' : 'done';
    syncState.finishedAt = Date.now();
    console.log('[asset-store] 동기화 완료: S3 ' + syncState.checked + '개 확인, ' + syncState.downloaded + '개 다운로드, 실패 ' + syncState.failed + '개 (' + ((syncState.finishedAt - syncState.startedAt) / 1000).toFixed(1) + '초)');
}

const ready = syncFromS3().catch(e => {
    syncState.status = 'error';
    syncState.error = e && e.message;
    syncState.finishedAt = Date.now();
    // 로컬(배포 이미지)에 파일이 있으면 그대로 서빙 가능하므로 부팅은 계속한다
    console.error('[asset-store] 동기화 실패 (로컬 파일로 계속):', e && e.message);
});

// ===== 관리자 업로드/삭제/조회 =====

// 반환: { ok } 또는 { error }
async function saveAsset(category, relPath, buffer) {
    const localPath = localPathOf(category, relPath);
    if (!localPath || relPath === '') return { error: '경로가 올바르지 않습니다.' };
    const ext = path.extname(relPath).toLowerCase();
    const contentType = EXT_TYPES[ext];
    if (!contentType) return { error: '허용되지 않는 파일 형식입니다. (png/jpg/webp/gif/mp3)' };
    if (!Buffer.isBuffer(buffer) || buffer.length < 1) return { error: '파일이 비어있습니다.' };
    if (buffer.length > MAX_ASSET_BYTES) return { error: '파일은 10MB 이하여야 합니다.' };
    // 카드 레이어는 합성기가 요구하는 형식(8비트 RGB/RGBA·비인터레이스, 레이어는 399x515)을 업로드 시점에 검증
    if (category === 'cardImage' && ext === '.png') {
        try {
            const cardComposite = require('./card_composite.js');
            const decoded = cardComposite.decodePng(buffer);
            const name = path.basename(relPath);
            const isLayer = relPath.startsWith('카드분리/') && !name.startsWith('캐릭터표지');
            if (isLayer && (decoded.width !== 399 || decoded.height !== 515)) {
                return { error: '카드 레이어는 399x515 크기여야 합니다. (현재 ' + decoded.width + 'x' + decoded.height + ')' };
            }
        } catch (e) {
            return { error: '합성기가 지원하지 않는 PNG입니다: ' + (e && e.message) };
        }
    }
    await s3.putObject({ Bucket: ASSET_BUCKET, Key: s3KeyOf(category, relPath), Body: buffer, ContentType: contentType }).promise();
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, buffer);
    return { ok: true };
}

async function deleteAsset(category, relPath) {
    const localPath = localPathOf(category, relPath);
    if (!localPath || relPath === '') return { error: '경로가 올바르지 않습니다.' };
    let st = null;
    try { st = fs.statSync(localPath); } catch (_) { }
    if (st && st.isDirectory()) return { error: '폴더는 삭제할 수 없습니다. 안의 파일을 먼저 삭제해주세요.' };
    await s3.deleteObject({ Bucket: ASSET_BUCKET, Key: s3KeyOf(category, relPath) }).promise();
    try { fs.unlinkSync(localPath); } catch (_) { }
    return { ok: true };
}

// 디렉터리 목록: { entries: [{name, dir, size, mtime}] } 또는 { error }
function listDir(category, relDir) {
    const localPath = localPathOf(category, relDir || '');
    if (!localPath) return { error: '경로가 올바르지 않습니다.' };
    let names;
    try { names = fs.readdirSync(localPath); } catch (_) { return { error: '존재하지 않는 폴더입니다.' }; }
    const entries = [];
    for (const name of names) {
        try {
            const st = fs.statSync(path.join(localPath, name));
            entries.push({ name, dir: st.isDirectory(), size: st.isDirectory() ? 0 : st.size, mtime: st.mtimeMs });
        } catch (_) { }
    }
    entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, 'ko-KR'));
    return { entries };
}

// 로컬 전용 폴더 생성 (S3는 폴더 개념이 없으므로 업로드 시 자동 생성되지만, 새 카드 폴더 탐색 진입용)
function makeDir(category, relDir) {
    const localPath = localPathOf(category, relDir);
    if (!localPath || relDir === '') return { error: '경로가 올바르지 않습니다.' };
    fs.mkdirSync(localPath, { recursive: true });
    return { ok: true };
}

function getLocalFilePath(category, relPath) {
    const localPath = localPathOf(category, relPath);
    if (!localPath || relPath === '') return null;
    try {
        if (!fs.statSync(localPath).isFile()) return null;
    } catch (_) { return null; }
    return localPath;
}

module.exports = {
    ready,
    syncState,
    saveAsset,
    deleteAsset,
    listDir,
    makeDir,
    getLocalFilePath,
    CATEGORY_NAMES: Object.keys(CATEGORIES),
    EXT_TYPES
};
