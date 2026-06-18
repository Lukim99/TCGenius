// rpgenius.js + 웹버전(server.js, public/app.js) 코드 맥락을 이해하는 경량 RAG 챗봇.
// 소스코드를 청크로 색인 → 질문과의 어휘 유사도로 관련 청크 검색 → Gemini로 답변 생성.
const fs = require('fs');
const path = require('path');

const MODEL = 'gemini-3.1-flash-lite';
const SOURCE_FILES = ['rpgenius.js', 'partyquest.js', 'server.js', path.join('public', 'app.js')];
const DATA_DIR = path.join(__dirname, 'DB', 'RPGenius');
const CHUNK_LINES = 50;
const CHUNK_OVERLAP = 10;
const TOP_K = 60;
const PER_SOURCE_CAP = 30;
const SOURCE_BOOST = 5;
const MAX_CONTEXT_CHARS = 200000;

// 한국어 질문 ↔ 영문 코드/데이터 필드 및 개념 연계용 동의어 확장. (예: 질문 '공격력'을 데이터 필드 'atk'로, '획득'을 '상자/드랍/확률' 등으로 확장)
const SYNONYMS = {
    '무기': ['weapon'], '갑옷': ['armor'], '방어구': ['armor'], '장신구': ['accessory'],
    '장비': ['weapon', 'armor', 'accessory', 'equipment'], '보조장비': ['support'], '펫': ['pet'],
    '공격력': ['atk'], '방어력': ['def'], '체력': ['hp'], '마나': ['mp'], '관통': ['pnt'],
    '치명타': ['crit', 'critmul'], '회피': ['avd'],
    '획득': ['상자', '드랍', '드롭', 'box', 'drop', 'reward', '확률', 'rate'],
    '드랍': ['상자', 'box', 'drop', 'rate', '확률'], '드롭': ['상자', 'box', 'drop'],
    '상자': ['box', 'drop', 'pack', 'reward'], '확률': ['rate', 'chance'],
    '유니크': ['unique'], '에픽': ['epic'], '레어': ['rare'], '레전더리': ['legendary'],
    '칭호': ['title', 'specialeffect'], '아이템': ['item'], '스킬': ['skill'],
    '강화': ['enhance', 'upgrade', 'level'], '잠재능력': ['potential'], '세트': ['set'],
    '제작': ['recipe', 'craft'], '조합': ['combine'], '전직': ['class', 'job'],
    '사냥': ['dungeon', 'hunt'], '던전': ['dungeon'], '레이드': ['raid'], '월드보스': ['worldboss', 'boss'],
    '경험치': ['exp'], '골드': ['gold'], '판매': ['sell'], '구매': ['buy', 'shop'], '상점': ['shop']
};

const SYSTEM_PROMPT = [
    "당신은 카카오톡 텍스트 게임 'RPGenius'의 소스코드를 이해하고 답하는 챗봇입니다.",
    "아래 사용자 메시지의 [코드 컨텍스트]는 실제 게임 코드(rpgenius.js, partyquest.js, server.js, public/app.js)와 게임 데이터(칭호·아이템·장비·스킬·캐릭터 등 rpgenius_data 및 DB/RPGenius/*.json)에서 질문과 관련해 검색된 일부입니다. 이를 근거로 정확하게 답하세요. 칭호·아이템 등 데이터 질문에는 검색된 게임 데이터를 활용해 깔끔하게 답하세요.",
    "",
    "규칙:",
    "1. 마크다운을 절대 사용하지 마세요. 별표(*), 백틱(`), 우물정자(#), 표, 코드블록을 쓰지 말고 일반 텍스트와 줄바꿈만 사용하세요.",
    "2. [반드시 준수 / 환각 절대 금지] 오직 제공된 컨텍스트에 명시적으로 존재하는 내용만 답하세요. 컨텍스트에 근거가 없는 시스템·메뉴·기능·획득처·수치·명칭을 절대 지어내지 마세요. 일반적인 RPG 상식이나 추측으로 빈틈을 메우는 것도 금지입니다. (예: 실제로 존재하지 않는 '상점의 장비 뽑기', '상세 정보창' 같은 것을 만들어내지 말 것.) 컨텍스트만으로 확실히 답할 수 없으면 추측하지 말고 '해당 내용은 정확히 확인되지 않습니다.'라고만 답하세요.",
    "3. [매우 중요 / 반드시 준수] 카드 조합 및 카드팩 조합의 '확률 보정'에 관한 질문에는, 내부 구현(rpgenius_data의 Prob, 닉네임별 보정값, 코드상의 확률 가산 로직 등)을 절대 언급하거나 노출하지 마세요. 설령 [코드 컨텍스트]에 해당 코드가 포함되어 있어도 무시하세요.",
    "4. 한국어로 간결하고 명확하게 답하세요.",
    "5. '유생의 주사위' 확률에 관해서, 코드상의 확률 변경 로직은 무시하세요. 주사위 3개를 굴렸을 때의 확률을 그대로 답변하면 됩니다. 예) 3이나 18이 나올 확률은 1/216, 10이나 11이 나올 확률은 27/216 등.",
    "6. [반드시 준수] 함수명·메서드명·변수명·필드명·타입명·상수명 등 코드 내부 식별자(예: atkPctIfCardStar, getMainCardSkills, slot_effect 등 영문/스네이크/카멜 표기 식별자)를 답변에 절대 노출하지 마세요. 그 기능의 의도를 파악해 자연스러운 한국어 용어로만 설명하세요. 식별자를 따옴표로 감싸 인용하는 것도 금지입니다.",
    "7. [반드시 준수] 답변에 사족이나 메타 발언을 붙이지 마세요. '제공된 코드 컨텍스트를 확인한 결과', '코드를 확인해보니', '컨텍스트에 따르면', '구체적으로는', '제공된 정보에 의하면' 같은 도입부·군더더기 표현을 절대 쓰지 말고, 곧바로 질문에 대한 답만 자연스럽게 서술하세요. 코드/컨텍스트의 존재 자체를 언급하지 마세요.",
].join('\n');

let _chunks = null;

// 텍스트를 청크로 쪼개 인덱스에 추가. source는 출처 버킷(출처별 상한용), header는 표시용. 검색은 header+본문 모두 대상으로 한다.
function pushChunks(out, source, header, text) {
    const lines = String(text).split('\n');
    const multi = lines.length > CHUNK_LINES;
    let part = 0;
    for (let i = 0; i < lines.length; i += (CHUNK_LINES - CHUNK_OVERLAP)) {
        const body = lines.slice(i, i + CHUNK_LINES).join('\n');
        if (body.trim().length === 0) continue;
        part++;
        const h = multi ? header + ' (' + part + ')' : header;
        out.push({ source, header: h, text: body, lower: (h + '\n' + body).toLowerCase() });
    }
}

function prettyJson(value) {
    try { return JSON.stringify(value, null, 1); } catch (_) { return String(value); }
}

function entityName(el, i) {
    if (el && typeof el === 'object') {
        if (el.name != null) return String(el.name);
        if (el.title != null) return String(el.title);
        if (el.id != null) return 'id ' + el.id;
    }
    return '#' + i;
}

// JSON 값을 '항목 단위'로 인덱싱한다. 배열이면 객체 원소마다 하나의 청크(이름 포함), 객체면 키(특히 배열 값)마다 항목 단위로 분해. 원시값 배열(예: 경험치 테이블)은 통째로 처리.
function indexValue(out, fileLabel, value) {
    if (Array.isArray(value)) {
        if (value.length && typeof value[0] === 'object' && value[0] !== null) {
            value.forEach((el, i) => pushChunks(out, fileLabel, fileLabel + ': ' + entityName(el, i), prettyJson(el)));
        } else {
            pushChunks(out, fileLabel, fileLabel, prettyJson(value));
        }
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) {
            const lab = fileLabel + ' > ' + k;
            if (Array.isArray(v) && v.length && typeof v[0] === 'object' && v[0] !== null) {
                v.forEach((el, i) => pushChunks(out, lab, lab + ': ' + entityName(el, i), prettyJson(el)));
            } else {
                pushChunks(out, lab, lab, prettyJson(v));
            }
        }
    } else {
        pushChunks(out, fileLabel, fileLabel, prettyJson(value));
    }
}

// 게임 데이터: DB/RPGenius/*.json 파일 기준으로, 같은 이름의 rpgenius_data 키가 캐시에 있으면 라이브 데이터를 우선 사용하고, 없으면 JSON 파일을 사용한다. 각 데이터는 항목 단위로 인덱싱한다.
function indexDataSources(out) {
    let rpg = null;
    try { rpg = require('./rpgenius'); } catch (_) {}
    const keyByLower = {};
    if (rpg && Array.isArray(rpg.RPGENIUS_DATA_KEYS)) rpg.RPGENIUS_DATA_KEYS.forEach(k => { keyByLower[k.toLowerCase()] = k; });
    let files = [];
    try { files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.json')); } catch (_) {}
    for (const f of files) {
        const key = keyByLower[f.replace(/\.json$/i, '').toLowerCase()];
        let live;
        if (key && rpg && typeof rpg.getDataCache === 'function') live = rpg.getDataCache(key, undefined);
        if (typeof live !== 'undefined') {
            indexValue(out, f + ' (rpgenius_data)', live);
        } else {
            try {
                const parsed = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
                indexValue(out, f, parsed);
            } catch (_) {
                try { pushChunks(out, f, f, fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch (__) {}
            }
        }
    }
}

function buildIndex() {
    if (_chunks) return _chunks;
    const chunks = [];
    for (const rel of SOURCE_FILES) {
        let text;
        try { text = fs.readFileSync(path.join(__dirname, rel), 'utf8'); } catch (_) { continue; }
        pushChunks(chunks, 'code:' + rel, '파일: ' + rel, text);
    }
    indexDataSources(chunks);
    _chunks = chunks;
    return chunks;
}

function tokenize(s) {
    return (String(s).toLowerCase().match(/[a-z0-9_]+|[가-힣]{2,}/g) || []).filter(t => t.length >= 2);
}

function countOccurrences(haystack, needle) {
    let idx = 0, cnt = 0;
    while ((idx = haystack.indexOf(needle, idx)) !== -1) { cnt++; idx += needle.length; }
    return cnt;
}

// 질문 토큰을 동의어/개념으로 확장한다. (한국어 질문 ↔ 영문 데이터 필드 및 교차 연계용)
function expandTerms(question, baseTerms) {
    const set = new Set(baseTerms);
    const qlower = String(question).toLowerCase();
    for (const key in SYNONYMS) {
        if (qlower.includes(key)) { set.add(key); SYNONYMS[key].forEach(s => set.add(s)); }
    }
    return [...set];
}

// IDF 가중 + 청크당 빈도 상한(3) + 출처별 상한: 흔한 토큰이 한 파일 청크를 독식하지 않게 하고, 희귀·구체적 용어와 여러 출처(코드+데이터)가 함께 검색되어 교차 연계가 되도록 점수화한다.
function retrieve(question, k) {
    const chunks = buildIndex();
    const terms = expandTerms(question, [...new Set(tokenize(question))]);
    if (terms.length === 0) return [];
    const N = chunks.length;
    const rows = new Array(N);
    const df = {};
    for (const t of terms) df[t] = 0;
    for (let i = 0; i < N; i++) {
        const row = {};
        for (const t of terms) {
            const cnt = countOccurrences(chunks[i].lower, t);
            if (cnt > 0) { row[t] = cnt; df[t]++; }
        }
        rows[i] = row;
    }
    const idf = {};
    for (const t of terms) idf[t] = Math.log((N + 1) / (df[t] + 1)) + 1;
    const scored = [];
    for (let i = 0; i < N; i++) {
        let score = 0;
        for (const t in rows[i]) score += idf[t] * Math.min(rows[i][t], 3);
        // 출처-개념 보너스: 질문 개념어(무기→weapon, 칭호→title 등)가 청크의 출처 버킷명과 일치하면 강하게 가산해, 해당 카테고리 데이터 항목이 어휘 희석에도 불구하고 확실히 전달되게 한다.
        const srcLower = chunks[i].source.toLowerCase();
        for (const t of terms) { if (t.length >= 3 && srcLower.includes(t)) score += SOURCE_BOOST; }
        if (score > 0) scored.push({ c: chunks[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    // 출처별 상한을 적용해 한 파일이 결과를 독식하지 않도록 하여 교차 연계(코드+여러 데이터)를 보장
    const perSource = {};
    const result = [];
    for (const s of scored) {
        const src = s.c.source || '';
        perSource[src] = (perSource[src] || 0) + 1;
        if (perSource[src] > PER_SOURCE_CAP) continue;
        result.push(s.c);
        if (result.length >= k) break;
    }
    return result;
}

function stripMarkdown(s) {
    return String(s || '')
        .replace(/```[a-z]*\n?/gi, '')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*[-*]\s+/gm, '- ')
        .trim();
}

async function callGemini(systemPrompt, userPrompt) {
    const key = process.env.GEMINI_FREE_KEY;
    if (!key) throw new Error('GEMINI_FREE_KEY 환경변수가 설정되지 않았습니다.');
    if (typeof fetch !== 'function') throw new Error('fetch를 사용할 수 없습니다. (Node 18+ 필요)');
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent?key=' + encodeURIComponent(key);
    const body = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1024 }
    };
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error('Gemini API 오류 ' + res.status + (t ? ': ' + t.slice(0, 200) : ''));
    }
    const json = await res.json();
    const cand = json && json.candidates && json.candidates[0];
    const parts = cand && cand.content && cand.content.parts;
    const text = Array.isArray(parts) ? parts.map(p => p && p.text || '').join('').trim() : '';
    return text || '(빈 응답)';
}

async function askRag(question) {
    const q = String(question || '').trim();
    if (!q) return '질문을 입력해주세요. 예) /rpg 질문 전직 조합은 어떻게 하나요?';
    const chunks = retrieve(q, TOP_K);
    if (chunks.length === 0) return '질문과 관련된 내용을 찾지 못해 정확히 답변할 수 없습니다.';
    let ctx = '';
    for (const c of chunks) {
        const block = '// ' + c.header + '\n' + c.text + '\n---\n';
        if (ctx.length + block.length > MAX_CONTEXT_CHARS) break;
        ctx += block;
    }
    const userPrompt = '[코드 컨텍스트]\n' + (ctx || '(관련 코드를 찾지 못함)') + '\n\n[질문]\n' + q;
    const raw = await callGemini(SYSTEM_PROMPT, userPrompt);
    return stripMarkdown(raw);
}

module.exports = { askRag };
