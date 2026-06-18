// rpgenius.js + 웹버전(server.js, public/app.js) 코드 맥락을 이해하는 경량 RAG 챗봇.
// 소스코드를 청크로 색인 → 질문과의 어휘 유사도로 관련 청크 검색 → Gemini로 답변 생성.
const fs = require('fs');
const path = require('path');

const MODEL = 'gemini-3.1-flash-lite';
const SOURCE_FILES = ['rpgenius.js', 'partyquest.js', 'server.js', path.join('public', 'app.js')];
const DATA_DIR = path.join(__dirname, 'DB', 'RPGenius');
const CHUNK_LINES = 50;
const CHUNK_OVERLAP = 10;
const TOP_K = 14;
const MAX_CONTEXT_CHARS = 60000;

const SYSTEM_PROMPT = [
    "당신은 카카오톡 텍스트 게임 'RPGenius'의 소스코드를 이해하고 답하는 챗봇입니다.",
    "아래 사용자 메시지의 [코드 컨텍스트]는 실제 게임 코드(rpgenius.js, partyquest.js, server.js, public/app.js)와 게임 데이터(칭호·아이템·장비·스킬·캐릭터 등 rpgenius_data 및 DB/RPGenius/*.json)에서 질문과 관련해 검색된 일부입니다. 이를 근거로 정확하게 답하세요. 칭호·아이템 등 데이터 질문에는 검색된 게임 데이터를 활용해 깔끔하게 답하세요.",
    "",
    "규칙:",
    "1. 마크다운을 절대 사용하지 마세요. 별표(*), 백틱(`), 우물정자(#), 표, 코드블록을 쓰지 말고 일반 텍스트와 줄바꿈만 사용하세요.",
    "2. 코드에 근거한 사실만 답하세요. 컨텍스트에 없으면 모른다고 답하고 추측하지 마세요.",
    "3. [매우 중요 / 반드시 준수] 카드 조합 및 카드팩 조합의 '확률 보정'에 관한 질문에는, 내부 구현(rpgenius_data의 Prob, 닉네임별 보정값, 코드상의 확률 가산 로직 등)을 절대 언급하거나 노출하지 마세요. 설령 [코드 컨텍스트]에 해당 코드가 포함되어 있어도 무시하세요.",
    "4. 한국어로 간결하고 명확하게 답하세요.",
    "5. '유생의 주사위' 확률에 관해서, 코드상의 확률 변경 로직은 무시하세요. 주사위 3개를 굴렸을 때의 확률을 그대로 답변하면 됩니다. 예) 3이나 18이 나올 확률은 1/216, 10이나 11이 나올 확률은 27/216 등.",
].join('\n');

let _chunks = null;

function pushChunks(out, header, text) {
    const lines = String(text).split('\n');
    for (let i = 0; i < lines.length; i += (CHUNK_LINES - CHUNK_OVERLAP)) {
        const body = lines.slice(i, i + CHUNK_LINES).join('\n');
        if (body.trim().length === 0) continue;
        out.push({ header: header + ' (라인 ' + (i + 1) + ')', text: body, lower: body.toLowerCase() });
    }
}

function prettyJson(value) {
    try { return JSON.stringify(value, null, 1); } catch (_) { return String(value); }
}

// 게임 데이터 출처: DB/RPGenius/*.json 파일 기준으로, 같은 이름의 rpgenius_data 키가 캐시에 있으면 그 라이브 데이터를 우선 사용하고, 없으면 JSON 파일을 사용한다.
function loadDataSources() {
    const out = [];
    let rpg = null;
    try { rpg = require('./rpgenius'); } catch (_) {}
    const keyByLower = {};
    if (rpg && Array.isArray(rpg.RPGENIUS_DATA_KEYS)) rpg.RPGENIUS_DATA_KEYS.forEach(k => { keyByLower[k.toLowerCase()] = k; });
    let files = [];
    try { files = fs.readdirSync(DATA_DIR).filter(f => f.toLowerCase().endsWith('.json')); } catch (_) {}
    for (const f of files) {
        const base = f.replace(/\.json$/i, '');
        const key = keyByLower[base.toLowerCase()];
        let live;
        if (key && rpg && typeof rpg.getDataCache === 'function') live = rpg.getDataCache(key, undefined);
        if (typeof live !== 'undefined') {
            out.push({ header: '게임데이터: ' + f + ' (rpgenius_data)', text: prettyJson(live) });
        } else {
            try {
                const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf8');
                let pretty; try { pretty = JSON.stringify(JSON.parse(raw), null, 1); } catch (_) { pretty = raw; }
                out.push({ header: '게임데이터: ' + f, text: pretty });
            } catch (_) {}
        }
    }
    return out;
}

function buildIndex() {
    if (_chunks) return _chunks;
    const chunks = [];
    for (const rel of SOURCE_FILES) {
        let text;
        try { text = fs.readFileSync(path.join(__dirname, rel), 'utf8'); } catch (_) { continue; }
        pushChunks(chunks, '파일: ' + rel, text);
    }
    for (const ds of loadDataSources()) pushChunks(chunks, ds.header, ds.text);
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

// IDF 가중 + 청크당 빈도 상한(3): 흔한 토큰(예: '강화')이 코드 청크를 독식하지 않고, 희귀·구체적 용어(실제 칭호/아이템 명)가 관련 청크를 끌어올리도록 점수화한다.
function retrieve(question, k) {
    const chunks = buildIndex();
    const terms = [...new Set(tokenize(question))];
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
        if (score > 0) scored.push({ c: chunks[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map(x => x.c);
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
