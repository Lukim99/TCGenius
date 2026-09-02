// 카드 이미지 레이어 합성기
// cardImage/카드분리의 캐릭터/프레임 레이어(8비트 RGBA PNG, 399x515)를
// 배경 → 캐릭터 → 테두리 순으로 서버에서 합성해 PNG 버퍼로 돌려준다.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const SPLIT_IMAGE_PATH = path.join(__dirname, 'DB', 'RPGenius', 'cardImage', '카드분리');
const CHARACTER_DIR = path.join(SPLIT_IMAGE_PATH, '캐릭터');
const FRAME_DIR = path.join(SPLIT_IMAGE_PATH, '프레임');

const GREEK_BY_STAR = { 10: '제타', 11: '시그마', 12: '오메가' };
// 7~9성은 제타/시그마/오메가와 배경을 공유한다 (파일명이 '7성 제타 배경' 형태)
const NORMAL_BG_BY_STAR = {
    1: '1234성', 2: '1234성', 3: '1234성', 4: '1234성',
    5: '5성', 6: '6성',
    7: '7성 제타', 8: '8성 시그마', 9: '9성 오메가',
    10: '7성 제타', 11: '8성 시그마', 12: '9성 오메가'
};

function isSafeName(value) {
    return typeof value == 'string' && value.length > 0 && !value.includes('..') && path.basename(value) == value;
}

// ===== PNG 코덱 (8비트 non-interlaced RGB/RGBA 전용 — 레이어 전수 검사로 확인된 형식) =====

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buf) {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

function paethPredictor(a, b, c) {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) return a;
    if (pb <= pc) return b;
    return c;
}

function decodePng(buffer) {
    if (buffer.length < 8 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG가 아닙니다');
    let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
    const idat = [];
    while (pos + 8 <= buffer.length) {
        const len = buffer.readUInt32BE(pos);
        const type = buffer.toString('ascii', pos + 4, pos + 8);
        if (type === 'IHDR') {
            width = buffer.readUInt32BE(pos + 8);
            height = buffer.readUInt32BE(pos + 12);
            bitDepth = buffer[pos + 16];
            colorType = buffer[pos + 17];
            interlace = buffer[pos + 20];
        } else if (type === 'IDAT') {
            idat.push(buffer.subarray(pos + 8, pos + 8 + len));
        } else if (type === 'IEND') break;
        pos += 12 + len;
    }
    if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2) || interlace !== 0) throw new Error('지원하지 않는 PNG 형식 (8비트 RGB/RGBA 전용)');
    const channels = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = width * channels;
    if (raw.length < (stride + 1) * height) throw new Error('PNG 데이터가 손상되었습니다');
    const rgba = Buffer.alloc(width * height * 4, 255);
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
        for (let i = 0; i < stride; i++) {
            const left = i >= channels ? line[i - channels] : 0;
            const up = prev[i];
            const upLeft = i >= channels ? prev[i - channels] : 0;
            if (filter === 1) line[i] = (line[i] + left) & 0xff;
            else if (filter === 2) line[i] = (line[i] + up) & 0xff;
            else if (filter === 3) line[i] = (line[i] + ((left + up) >> 1)) & 0xff;
            else if (filter === 4) line[i] = (line[i] + paethPredictor(left, up, upLeft)) & 0xff;
        }
        for (let x = 0; x < width; x++) {
            const src = x * channels, dst = (y * width + x) * 4;
            rgba[dst] = line[src];
            rgba[dst + 1] = line[src + 1];
            rgba[dst + 2] = line[src + 2];
            if (channels === 4) rgba[dst + 3] = line[src + 3];
        }
        prev = line;
    }
    return { width, height, rgba };
}

function encodePng(width, height, rgba) {
    const stride = width * 4;
    // 모든 행에 Paeth 필터 — 사진형 레이어에서 무필터 대비 파일 크기를 크게 줄인다
    const filtered = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        filtered[y * (stride + 1)] = 4;
        for (let i = 0; i < stride; i++) {
            const cur = rgba[y * stride + i];
            const left = i >= 4 ? rgba[y * stride + i - 4] : 0;
            const up = y > 0 ? rgba[(y - 1) * stride + i] : 0;
            const upLeft = y > 0 && i >= 4 ? rgba[(y - 1) * stride + i - 4] : 0;
            filtered[y * (stride + 1) + 1 + i] = (cur - paethPredictor(left, up, upLeft)) & 0xff;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    const chunks = [
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(filtered, { level: 9 })),
        pngChunk('IEND', Buffer.alloc(0))
    ];
    return Buffer.concat(chunks);
}

function pngChunk(type, data) {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'ascii');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
}

// over를 base 위에 src-over 블렌딩 (straight alpha, base를 직접 수정)
function blendOver(base, over) {
    for (let i = 0; i < base.length; i += 4) {
        const oa = over[i + 3];
        if (oa === 0) continue;
        if (oa === 255) {
            base[i] = over[i];
            base[i + 1] = over[i + 1];
            base[i + 2] = over[i + 2];
            base[i + 3] = 255;
            continue;
        }
        const fb = base[i + 3] * (255 - oa) / 255;
        const outA = oa + fb;
        base[i] = Math.round((over[i] * oa + base[i] * fb) / outA);
        base[i + 1] = Math.round((over[i + 1] * oa + base[i + 1] * fb) / outA);
        base[i + 2] = Math.round((over[i + 2] * oa + base[i + 2] * fb) / outA);
        base[i + 3] = Math.round(outA);
    }
}

// ===== 레이어 결정 =====

function firstExisting(dir, names) {
    for (const name of names) {
        const filePath = path.join(dir, name);
        if (fs.existsSync(filePath)) return filePath;
    }
    return null;
}

// card: { name, star(0-based), type, skin, prestige }
// 반환: { background, character, border|null } 또는 null(필수 레이어 부재)
function resolveCardLayers(card) {
    if (!card || !isSafeName(card.name)) return null;
    const skin = typeof card.skin == 'string' ? card.skin.trim() : '';
    if (skin && !isSafeName(skin)) return null;
    const s = Number(card.star || 0) + 1; // 표시 성 (1~12)
    if (!Number.isInteger(s) || s < 1 || s > 12) return null;
    const greek = GREEK_BY_STAR[s] || null;
    // 전직 프레임은 5성부터 존재 — 그 아래는 일반 카드로 취급 (구 평면 이미지의 폴백과 동일)
    const isJob = card.type === '전직' && s >= 5;
    const prestige = card.prestige === true && !!greek; // 프레스티지 프레임/아트는 제타+ 전용

    // 캐릭터 아트: 티어 폴백 체인 × (스킨 → 스킨 없음) — '각성' 아트는 아직 미사용 데이터
    const tiers = isJob
        ? (prestige ? ['프레스티지 전직', '전직'] : ['전직'])
        : (prestige ? ['프레스티지 일반', '일반'] : ['일반']);
    const artNames = [];
    tiers.forEach(tier => {
        if (skin) artNames.push(tier + ' ' + skin + ' ' + card.name + '.png');
        artNames.push(tier + ' ' + card.name + '.png');
    });
    const character = firstExisting(path.join(CHARACTER_DIR, card.name), artNames);
    if (!character) return null;

    // 프레임 (배경 필수, 테두리는 있으면 사용 — 전직 프레스티지는 테두리 없이 배경에 통합돼 있음)
    const frameKind = isJob ? '전직카드' : '일반카드';
    const frameDir = path.join(FRAME_DIR, frameKind);
    let bgLabel, borderLabel;
    if (prestige) {
        bgLabel = '프레스티지 ' + greek;
        borderLabel = '프레스티지 ' + greek;
    } else if (isJob) {
        bgLabel = greek || s + '성';
        borderLabel = greek || s + '성';
    } else {
        bgLabel = NORMAL_BG_BY_STAR[s];
        borderLabel = greek || s + '성';
    }
    const background = firstExisting(frameDir, [frameKind + ' ' + bgLabel + ' 배경.png']);
    if (!background) return null;
    const border = firstExisting(frameDir, [frameKind + ' ' + borderLabel + ' 테두리.png']);
    return { background, character, border };
}

function canCompose(card) {
    return resolveCardLayers(card) != null;
}

// ===== 합성 + LRU 캐시 =====

const CACHE_MAX = 60;
const composeCache = new Map(); // key: 레이어 경로+mtime → PNG Buffer

function composeCardImage(card) {
    const layers = resolveCardLayers(card);
    if (!layers) return null;
    const files = [layers.background, layers.character, layers.border].filter(Boolean);
    let key;
    try {
        key = files.map(file => file + '@' + fs.statSync(file).mtimeMs).join('|');
    } catch (e) {
        return null;
    }
    const cached = composeCache.get(key);
    if (cached) {
        composeCache.delete(key);
        composeCache.set(key, cached); // LRU 갱신
        return cached;
    }
    let result;
    try {
        const images = files.map(file => decodePng(fs.readFileSync(file)));
        const base = images[0];
        for (let i = 1; i < images.length; i++) {
            if (images[i].width !== base.width || images[i].height !== base.height) throw new Error('레이어 크기가 다릅니다: ' + files[i]);
            blendOver(base.rgba, images[i].rgba);
        }
        result = encodePng(base.width, base.height, base.rgba);
    } catch (e) {
        console.error('[card_composite] 합성 실패:', card.name, e.message);
        return null;
    }
    composeCache.set(key, result);
    if (composeCache.size > CACHE_MAX) composeCache.delete(composeCache.keys().next().value);
    return result;
}

// kind: '일반' | '각성' | '전직'
function getCoverPath(name, kind) {
    if (!isSafeName(name) || !['일반', '각성', '전직'].includes(kind)) return null;
    const filePath = path.join(CHARACTER_DIR, name, '캐릭터표지(' + kind + ').png');
    return fs.existsSync(filePath) ? filePath : null;
}

module.exports = { resolveCardLayers, canCompose, composeCardImage, getCoverPath };
