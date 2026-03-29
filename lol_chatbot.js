const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const TARGET_CHANNEL_ID = '2222333';
const VIEWMORE = '\u200e'.repeat(500);
const LINES = ['탑', '정글', '미드', '원딜', '서폿'];
const ATTENDANCE = new Set(['ㅊㅊ', '출석']);
const WORD_TIMEOUT = 20000;
const CHO_TIMEOUT = 30000;
const REACTION_OPEN = 15000;
const TRIPLE_MATCH_COST = 3000;
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY) : null;
let gemini = null;
if (process.env.GEMINI_API_KEY) {
    try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        gemini = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });
    } catch (e) {}
}

const words = (() => {
    try {
        return fs.readFileSync(path.join(__dirname, 'DB', 'allWords.txt'), 'utf8').split(/\r?\n/).map(v => v.trim()).filter(v => /^[가-힣]{2,}$/.test(v));
    } catch (e) {
        return [];
    }
})();
const wordSet = new Set(words);
const reactionGames = new Map();
const wordGames = new Map();
const choGames = new Map();
const LINE_ALIAS = { 탑: '탑', top: '탑', 정글: '정글', jungle: '정글', jg: '정글', 미드: '미드', mid: '미드', 원딜: '원딜', bot: '원딜', adc: '원딜', 바텀: '원딜', 서폿: '서폿', 서포터: '서폿', support: '서폿', sup: '서폿' };
const SCORE_RAW = [
    'M1800+,67,66,62,65,52','M1700,66,64.3,61.1,64.7,51.5','M1600,65.5,63.8,60.8,64.4,50.9','M1500,64.6,63.3,59.9,64.2,50.6','M1400,63.8,62.2,58.2,63.9,50.1','M1300,63.1,61.3,57.3,63.3,49.8','M1200,62.4,60.5,56,62.7,49.3','M1100,59.9,59.4,54.7,62.2,48.7','M1000,57.8,57.7,53.1,61.3,48','M900,54.8,55.4,51.4,58.8,46.2','M800,52.6,53.1,50.2,56.1,44.5','M700,51.3,50.6,49.3,53.7,42.8','M600,49.7,48.4,48,51.1,41.1','M500,47.9,46.3,46.2,48.6,39','M400,45.2,44.3,45.2,46.2,37.7','M300,43,42.4,44.7,43.5,36.1','M200,41.8,40.6,43,40.6,35','M100,39.1,39.4,41.3,38.3,34','M0,37.4,38.2,39.8,36.1,33.1',
    'D1,35.7,36.8,38.7,34,32.2','D2,33.8,34.8,38,32.1,31.3','D3,31.6,32.5,37.1,29.7,30.3','D4,30.3,30.7,35.4,27.6,29.3',
    'E1,28.6,28.8,34.6,25.7,28.2','E2,27.3,26.6,33,24.3,27','E3,26.5,24.8,31.8,22.8,26','E4,26,23.4,29.6,21.6,25.1',
    'P1,25.2,21.9,27.1,20.3,24.2','P2,24.7,20.5,24.3,18.7,22.8','P3,24,19.3,22.7,17.5,22','P4,21.2,18.1,21.1,16.4,21.2',
    'G1,19,16.7,19.7,15.1,20.5','G2,17.7,14.7,17.8,13.4,19.1','G3,15.9,13.8,16.8,12.6,18.3','G4,14.6,12.8,15.9,11.9,17.6','S1,13,11.9,14.8,11.3,16.7','S2,12,11,13.9,10.6,15.9','LOW,11,10,13,10,15'
].map(row => {
    const [k, ...v] = row.split(',');
    return { k, s: { 탑: +v[0], 정글: +v[1], 미드: +v[2], 원딜: +v[3], 서폿: +v[4] } };
});
const perms = (() => {
    const r = [];
    const f = (arr, m = []) => arr.length ? arr.forEach((v, i) => f(arr.slice(0, i).concat(arr.slice(i + 1)), m.concat(v))) : r.push(m);
    f([0, 1, 2, 3, 4]);
    return r;
})();

function isTarget(channel) { return !!channel && channel.channelId + '' === TARGET_CHANNEL_ID; }
function commas(v) { return Number(v || 0).toLocaleString('ko-KR'); }
function todayKst(d = new Date()) { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
function dt(v) { return v ? new Date(v).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음'; }
function tripleNumber() { return String(Math.floor(Math.random() * 1000)).padStart(3, '0'); }
function tripleMatchCount(pick, draw) { let count = 0; for (let i = 0; i < 3; i++) if (pick[i] === draw[i]) count += 1; return count; }
function needExp(level) { return Math.floor(100 * Math.pow(1.7, Math.max(0, level - 1))); }
function normLine(v) { return v ? LINE_ALIAS[v.trim().toLowerCase()] || LINE_ALIAS[v.trim()] || null : null; }
function parseTier(token) {
    token = (token || '').trim().toUpperCase().replace(/\s+/g, '');
    const m1 = token.match(/^(GM|C|M)(\d{1,4})?$/);
    if (m1) return { group: m1[1], lp: m1[2] ? +m1[2] : 0, div: null, raw: token };
    const m2 = token.match(/^(D|E|P|G|S|B)([1-4])$/);
    if (m2) return { group: m2[1], lp: 0, div: +m2[2], raw: token };
    if (token === 'U') return { group: 'U', lp: 0, div: null, raw: token };
    return null;
}
function parseNick(nick) {
    if (!nick) return null;
    const parts = nick.trim().replace(/\s+/g, ' ').split(' ');
    if (parts.length < 3 || !/^\d{2}$/.test(parts[0])) return null;
    const tier = parseTier(parts[parts.length - 1]);
    const riot = parts.slice(1, -1).join(' ');
    const idx = riot.lastIndexOf('#');
    if (!tier || idx < 1 || idx >= riot.length - 1) return null;
    return { year: parts[0], riotName: riot.slice(0, idx).trim(), riotTag: riot.slice(idx + 1).trim(), tier };
}
function scoreRow(tier) {
    if (!tier) return SCORE_RAW[SCORE_RAW.length - 1];
    if (['M', 'GM', 'C'].includes(tier.group)) {
        if (tier.lp >= 1800) return SCORE_RAW[0];
        const keys = ['1700', '1600', '1500', '1400', '1300', '1200', '1100', '1000', '900', '800', '700', '600', '500', '400', '300', '200', '100', '0'];
        const found = SCORE_RAW.find(r => r.k === `M${keys.find(n => tier.lp >= +n) || '0'}`);
        return found || SCORE_RAW[18];
    }
    const key = tier.group + (tier.div || '');
    return SCORE_RAW.find(r => r.k === key) || SCORE_RAW[SCORE_RAW.length - 1];
}
function lineScore(user, line) {
    const row = scoreRow(parseTier(user.tier_token || ''));
    const off = user.line && user.line !== line ? 0.7 : 0;
    const on = user.line === line ? 0.7 : 0;
    return row.s[line] + on - off;
}
function choseong(word) {
    const c = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
    return word.split('').map(ch => { const n = ch.charCodeAt(0) - 44032; return n < 0 || n > 11171 ? ch : c[Math.floor(n / 588)]; }).join('');
}
async function getUser(id) {
    const { data, error } = await supabase.from('lol_chatbot_users').select('*').eq('user_id', id + '').maybeSingle();
    if (error) throw error;
    return data || null;
}
async function putUser(payload) {
    const { data, error } = await supabase.from('lol_chatbot_users').upsert(payload, { onConflict: 'user_id' }).select('*').single();
    if (error) throw error;
    return data;
}
function baseUser(userId, nickname, channelId, old = {}) {
    const now = new Date().toISOString();
    const p = parseNick(nickname);
    return { user_id: userId + '', channel_id: channelId + '', display_nickname: nickname || '', birth_year: p ? p.year : old.birth_year || null, riot_name: p ? p.riotName : old.riot_name || null, riot_tag: p ? p.riotTag : old.riot_tag || null, tier_token: p ? p.tier.raw : old.tier_token || null, tier_group: p ? p.tier.group : old.tier_group || null, tier_division: p ? p.tier.div : old.tier_division || null, tier_lp: p ? p.tier.lp : old.tier_lp || 0, line: old.line || null, nickname_history: Array.isArray(old.nickname_history) ? old.nickname_history : [], line_history: Array.isArray(old.line_history) ? old.line_history : [], level: +old.level || 1, exp: +old.exp || 0, coins: +old.coins || 0, attendance_days: +old.attendance_days || 0, attendance_streak: +old.attendance_streak || 0, last_attendance_date: old.last_attendance_date || null, total_chat_count: +old.total_chat_count || 0, reaction_wins: +old.reaction_wins || 0, wordchain_wins: +old.wordchain_wins || 0, choseong_wins: +old.choseong_wins || 0, last_chat_at: old.last_chat_at || null, last_seen_at: now, updated_at: now, created_at: old.created_at || now };
}
async function ensureUser(info, channelId) { const old = await getUser(info.userId + ''); return putUser(baseUser(info.userId, info.nickname, channelId, old || {})); }
async function addCoins(info, amount, channelId) { const u = await ensureUser(info, channelId); return putUser({ ...u, coins: +u.coins + amount, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() }); }
async function touchChat(sender, msg, channelId) {
    const u = await ensureUser(sender, channelId);
    let exp = +u.exp + 5, level = +u.level, reward = 0, up = false;
    while (exp >= needExp(level)) { exp -= needExp(level); level += 1; reward += level >= 10 ? 500 : 50; up = true; }
    const next = await putUser({ ...u, display_nickname: sender.nickname || '', total_chat_count: +u.total_chat_count + 1, last_chat_at: new Date().toISOString(), exp, level, coins: +u.coins + reward, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    await supabase.from('lol_chatbot_chat_logs').insert({ channel_id: channelId + '', user_id: sender.userId + '', nickname: sender.nickname || '', message: (msg || '').slice(0, 1500), created_at: new Date().toISOString() });
    return { user: next, up, reward };
}

function ensureReady(channel) {
    if (supabase) return true;
    if (channel) channel.sendChat('❌ Supabase 설정이 없어 lol_chatbot 기능을 사용할 수 없습니다.');
    return false;
}

function yesterdayKst() {
    return todayKst(new Date(Date.now() - 86400000));
}

function mentions(data) {
    return Array.isArray(data?.chat?.attachment?.mentions) ? data.chat.attachment.mentions.map(v => v.user_id + '') : [];
}

function mentionedUsers(channel, ids) {
    const users = Array.from(channel.getAllUserInfo());
    return Array.from(new Set(ids)).map(id => users.find(v => v.userId + '' === id)).filter(Boolean);
}

function cmdCtx(data, channel) {
    const body = (data.text || '').slice(1).trim();
    const line = body.split('\n')[0].trim();
    const i = line.indexOf(' ');
    const command = (i === -1 ? line : line.slice(0, i)).trim();
    const argLine = i === -1 ? '' : line.slice(i + 1).trim();
    const ids = mentions(data);
    const users = mentionedUsers(channel, ids);
    const stripped = argLine.replace(/@\S+/g, ' ').replace(/\s+/g, ' ').trim();
    const args = stripped ? stripped.split(' ').filter(Boolean) : [];
    const nums = (body.match(/-?\d+/g) || []).map(v => +v).filter(v => Number.isInteger(v));
    return { body, command, argLine, args, mentionIds: ids, mentionUsers: users, firstMention: users[0] || null, firstAmount: nums[0], lastAmount: nums[nums.length - 1] };
}

async function appendNickHistory(userId, oldNick, newNick, channelId) {
    if (!supabase || !oldNick || !newNick || oldNick === newNick) return;
    const old = await getUser(userId + '');
    const next = baseUser(userId, newNick, channelId, old || {});
    next.nickname_history = (Array.isArray(old?.nickname_history) ? old.nickname_history : []).slice(-29);
    next.nickname_history.push({ old_nickname: oldNick, new_nickname: newNick, changed_at: new Date().toISOString() });
    await putUser(next);
}

async function attendance(sender, channel) {
    const u = await ensureUser(sender, channel.channelId + '');
    const today = todayKst();
    if (u.last_attendance_date === today) {
        channel.sendChat(`❌ ${sender.nickname}님은 오늘 이미 출석했습니다.`);
        return true;
    }
    const streak = u.last_attendance_date === yesterdayKst() ? +u.attendance_streak + 1 : 1;
    const reward = streak % 10 === 0 ? 100 : 50;
    const next = await putUser({ ...u, attendance_days: +u.attendance_days + 1, attendance_streak: streak, last_attendance_date: today, coins: +u.coins + reward, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    channel.sendChat(`✅ ${sender.nickname}님 출석 완료\n🪙 +${reward}메리${streak % 10 === 0 ? '\n🎉 10일마다 2배 보너스 적용!' : ''}\n📅 누적 출석: ${next.attendance_days}일\n🔥 연속 출석: ${next.attendance_streak}일\n🪙 현재 메리: ${commas(next.coins)}메리`);
    return true;
}

function clearReaction(channelId) {
    const g = reactionGames.get(channelId);
    if (!g) return;
    if (g.openTimer) clearTimeout(g.openTimer);
    if (g.closeTimer) clearTimeout(g.closeTimer);
    reactionGames.delete(channelId);
}

function clearWord(channelId) {
    const g = wordGames.get(channelId);
    if (!g) return;
    if (g.timeout) clearTimeout(g.timeout);
    wordGames.delete(channelId);
}

function clearCho(channelId) {
    const g = choGames.get(channelId);
    if (!g) return;
    if (g.timeout) clearTimeout(g.timeout);
    choGames.delete(channelId);
}

async function startReaction(channel) {
    const channelId = channel.channelId + '';
    if (reactionGames.has(channelId)) {
        channel.sendChat('❌ 이미 반응게임이 진행 중입니다.');
        return true;
    }
    const delay = 2000 + Math.floor(Math.random() * 5000);
    const state = { answer: '반응', armed: false, openedAt: 0, openTimer: null, closeTimer: null };
    state.openTimer = setTimeout(() => {
        state.armed = true;
        state.openedAt = Date.now();
        channel.sendChat(`⚡ 반응게임 시작! 가장 먼저 입력하세요: ${state.answer.split("").join("\u200b")}`);
        state.closeTimer = setTimeout(() => {
            if (reactionGames.get(channelId) !== state) return;
            clearReaction(channelId);
            channel.sendChat('⌛ 반응게임이 종료되었습니다.');
        }, REACTION_OPEN);
    }, delay);
    reactionGames.set(channelId, state);
    channel.sendChat('🎯 반응게임 준비 중...');
    return true;
}

async function catchReaction(msg, sender, channel) {
    const channelId = channel.channelId + '';
    const g = reactionGames.get(channelId);
    if (!g || !g.armed || msg.trim() !== g.answer) return false;
    const ms = g.openedAt ? Date.now() - g.openedAt : null;
    clearReaction(channelId);
    const u = await ensureUser(sender, channelId);
    const next = await putUser({ ...u, reaction_wins: +u.reaction_wins + 1, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    channel.sendChat(`🏆 반응게임 우승: ${sender.nickname}\n${ms != null ? `⏱ 반응 속도: ${ms}ms\n` : ''}🥇 누적 우승: ${next.reaction_wins}회`);
    return true;
}

function armWordTimeout(state) {
    if (state.timeout) clearTimeout(state.timeout);
    state.timeout = setTimeout(async () => {
        try {
            if (!wordGames.has(state.channelId)) return;
            if (!state.lastUserId) {
                state.channel.sendChat('⌛ 끝말잇기 시간이 초과되어 종료되었습니다.');
            } else {
                const u = await getUser(state.lastUserId);
                if (u) await putUser({ ...u, wordchain_wins: +u.wordchain_wins + 1, coins: +u.coins + 10, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
                state.channel.sendChat(`🏁 끝말잇기 종료\n우승: ${state.lastNickname}\n🪙 +10메리`);
            }
        } catch (e) {
            console.log('[lol_chatbot] word timeout error:', e);
        } finally {
            clearWord(state.channelId);
        }
    }, WORD_TIMEOUT);
}

async function startWordgame(channel) {
    const channelId = channel.channelId + '';
    if (wordGames.has(channelId)) {
        channel.sendChat('❌ 이미 끝말잇기가 진행 중입니다.');
        return true;
    }
    const start = words.filter(v => v.length >= 2 && v.length <= 4)[Math.floor(Math.random() * Math.max(1, words.filter(v => v.length >= 2 && v.length <= 4).length))] || '사과';
    const state = { channel, channelId, current: start, used: new Set([start]), lastUserId: null, lastNickname: null, timeout: null };
    wordGames.set(channelId, state);
    armWordTimeout(state);
    channel.sendChat(`[ 끝말잇기 시작 ]\n시작 단어: ${start}\n다음 글자: ${start[start.length - 1]}\n20초 동안 아무도 못 이으면 마지막 성공자가 우승합니다.`);
    return true;
}

async function catchWord(msg, sender, channel) {
    const channelId = channel.channelId + '';
    const g = wordGames.get(channelId);
    const word = msg.trim();
    if (!g || word.startsWith('/')) return false;
    if (!/^[가-힣]{2,}$/.test(word)) return false;
    if (!wordSet.has(word)) return false;
    if (g.used.has(word)) {
        channel.sendChat(`❌ 이미 사용한 단어입니다: ${word}`);
        return true;
    }
    if (word[0] !== g.current[g.current.length - 1]) return false;
    g.current = word;
    g.used.add(word);
    g.lastUserId = sender.userId + '';
    g.lastNickname = sender.nickname;
    armWordTimeout(g);
    channel.sendChat(`✅ ${sender.nickname}: ${word}\n다음 글자: '${word[word.length - 1]}'`);
    return true;
}

async function startCho(channel) {
    const channelId = channel.channelId + '';
    if (choGames.has(channelId)) {
        channel.sendChat('❌ 이미 초성게임이 진행 중입니다.');
        return true;
    }
    const pool = words.filter(v => v.length >= 2 && v.length <= 6);
    const answer = pool[Math.floor(Math.random() * Math.max(1, pool.length))] || '사과';
    const state = { answer, hint: choseong(answer), timeout: null };
    state.timeout = setTimeout(() => {
        if (choGames.get(channelId) !== state) return;
        clearCho(channelId);
        channel.sendChat(`⌛ 초성게임 종료\n정답: ${answer}`);
    }, CHO_TIMEOUT);
    choGames.set(channelId, state);
    channel.sendChat(`🔤 초성게임 시작\n초성: ${state.hint}\n30초 안에 정답을 맞혀보세요!`);
    return true;
}

async function catchCho(msg, sender, channel) {
    const channelId = channel.channelId + '';
    const g = choGames.get(channelId);
    if (!g) return false;
    if (msg.trim() !== g.answer) return false;
    clearCho(channelId);
    const u = await ensureUser(sender, channelId);
    const next = await putUser({ ...u, choseong_wins: +u.choseong_wins + 1, coins: +u.coins + 10, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
    channel.sendChat(`🏆 초성게임 우승: ${sender.nickname}\n정답: ${g.answer}\n🪙 +10메리\n🥇 누적 초성 우승: ${next.choseong_wins}회`);
    return true;
}

async function getSummary(channel) {
    const { data, error } = await supabase.from('lol_chatbot_chat_logs').select('nickname, message, created_at').eq('channel_id', TARGET_CHANNEL_ID).order('created_at', { ascending: false }).limit(80);
    if (error) throw error;
    const logs = (data || []).slice().reverse();
    if (!logs.length) return '요약할 최근 대화가 없습니다.';
    if (!gemini) {
        const speakers = {};
        logs.forEach(log => { speakers[log.nickname] = (speakers[log.nickname] || 0) + 1; });
        const top = Object.entries(speakers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, count]) => `${name}(${count})`).join(', ');
        const recent = logs.slice(-8).map(log => `${log.nickname}: ${log.message}`).join('\n');
        return `최근 대화 요약(간이)\n주요 발화자: ${top || '없음'}\n\n최근 메시지\n${recent}`;
    }
    const prompt = [
        '다음 카카오톡 단체 채팅 내용을 한국어로 간결하게 요약해줘.',
        '1. 핵심 주제 3개 이내',
        '2. 결정/합의 사항',
        '3. 분위기/특이사항',
        '4. 중요 발언자 있으면 표시',
        '',
        logs.map(log => `[${dt(log.created_at)}] ${log.nickname}: ${log.message}`).join('\n')
    ].join('\n');
    const res = await gemini.generateContent(prompt);
    return res.response.text().trim();
}

async function getUsersRank(field, limit = 10) {
    const { data, error } = await supabase.from('lol_chatbot_users').select('*').eq('channel_id', TARGET_CHANNEL_ID);
    if (error) throw error;
    return (data || []).sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0)).slice(0, limit);
}

async function nicknameHistory(userId) {
    const { data, error } = await supabase.from('join_leave_logs').select('*').eq('channel_id', TARGET_CHANNEL_ID).eq('user_id', userId + '').like('event_type', '프로필변경%').order('timestamp', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function joinLeaveHistory(userId) {
    const { data, error } = await supabase.from('join_leave_logs').select('*').eq('channel_id', TARGET_CHANNEL_ID).eq('user_id', userId + '').order('timestamp', { ascending: false }).limit(20);
    if (error) throw error;
    return data || [];
}

async function setLine(userInfo, line, channelId) {
    const u = await ensureUser(userInfo, channelId);
    const history = (Array.isArray(u.line_history) ? u.line_history : []).slice(-19);
    history.push({ line, changed_at: new Date().toISOString() });
    return putUser({ ...u, line, line_history: history, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
}

function validateNicknameOrWarn(sender, channel) {
    if (parseNick(sender.nickname)) return true;
    channel.sendChat('닉네임을 양식에 맞춰주세요');
    return false;
}

function combinations10Choose5() {
    const out = [];
    for (let mask = 0; mask < (1 << 10); mask++) {
        if ((mask & 1) === 0) continue;
        let count = 0;
        for (let i = 0; i < 10; i++) if (mask & (1 << i)) count += 1;
        if (count === 5) out.push(mask);
    }
    return out;
}

const teamMasks = combinations10Choose5();

function calcTeamAssignment(players) {
    let best = null;
    for (const mask of teamMasks) {
        const a = [], b = [];
        for (let i = 0; i < 10; i++) ((mask & (1 << i)) ? a : b).push(players[i]);
        for (const pa of perms) {
            let sa = 0;
            for (let i = 0; i < 5; i++) sa += lineScore(a[pa[i]], LINES[i]);
            for (const pb of perms) {
                let sb = 0;
                for (let i = 0; i < 5; i++) sb += lineScore(b[pb[i]], LINES[i]);
                const diff = Math.abs(sa - sb);
                if (!best || diff < best.diff) {
                    best = { diff, sa, sb, a, b, pa, pb };
                    if (diff === 0) return best;
                }
            }
        }
    }
    return best;
}

async function handleCommand(data, channel, sender, isSenderManager) {
    const ctx = cmdCtx(data, channel);
    const cmd = ctx.command;
    if (!validateNicknameOrWarn(sender, channel)) return true;

    if (cmd === '출석') return attendance(sender, channel);

    if (cmd === '레벨' || cmd === '정보' || cmd === '내정보') {
        const u = await ensureUser(sender, channel.channelId + '');
        channel.sendChat(
            `👤 ${sender.nickname}\n` +
            `Lv.${u.level} (${u.exp}/${needExp(u.level)} EXP)\n` +
            `🪙 메리: ${commas(u.coins)}\n` +
            `💬 누적 채팅: ${commas(u.total_chat_count)}\n` +
            `📅 출석: ${u.attendance_days}일 (연속 ${u.attendance_streak}일)\n` +
            `🎮 반응 ${u.reaction_wins} / 끝말 ${u.wordchain_wins} / 초성 ${u.choseong_wins}\n` +
            `🕒 마지막 채팅: ${dt(u.last_chat_at)}\n` +
            `🎯 등록 라인: ${u.line || '미등록'}\n` +
            `🏅 티어: ${u.tier_token || '미인식'}`
        );
        return true;
    }

    if (cmd === '메리' || cmd === '잔고') {
        const u = await ensureUser(sender, channel.channelId + '');
        channel.sendChat(`🪙 ${sender.nickname}님의 메리: ${commas(u.coins)}메리`);
        return true;
    }

    if (cmd === '메리지급' || cmd === '메리차감') {
        if (!isSenderManager) {
            channel.sendChat('❌ 관리자만 사용할 수 있는 명령어입니다.');
            return true;
        }
        const target = ctx.firstMention;
        const amount = Math.abs(Number(ctx.lastAmount || 0));
        if (!target || !Number.isInteger(amount) || amount <= 0) {
            channel.sendChat(`❌ 사용법: /${cmd} @유저 100`);
            return true;
        }
        const signed = cmd === '메리지급' ? amount : -amount;
        const next = await addCoins(target, signed, channel.channelId + '');
        channel.sendChat(`✅ ${target.nickname}님에게 ${signed > 0 ? `${commas(amount)}메리 지급` : `${commas(amount)}메리 차감`}\n🪙 현재 메리: ${commas(next.coins)}메리`);
        return true;
    }

    if (cmd === '채팅순위') {
        const users = await getUsersRank('total_chat_count', 15);
        channel.sendChat(`📊 채팅 순위\n${VIEWMORE}\n${users.map((u, i) => `${i + 1}위. ${u.display_nickname} - ${commas(u.total_chat_count)}회`).join('\n') || '기록 없음'}`);
        return true;
    }

    if (cmd === '반응순위') {
        const users = await getUsersRank('reaction_wins', 15);
        channel.sendChat(`⚡ 반응게임 순위\n${VIEWMORE}\n${users.map((u, i) => `${i + 1}위. ${u.display_nickname} - ${commas(u.reaction_wins)}회`).join('\n') || '기록 없음'}`);
        return true;
    }

    if (cmd === '레벨순위') {
        const { data, error } = await supabase.from('lol_chatbot_users').select('*').eq('channel_id', TARGET_CHANNEL_ID);
        if (error) throw error;
        const users = (data || []).sort((a, b) => (Number(b.level || 1) - Number(a.level || 1)) || (Number(b.exp || 0) - Number(a.exp || 0))).slice(0, 15);
        channel.sendChat(`🌟 레벨 순위\n${VIEWMORE}\n${users.map((u, i) => `${i + 1}위. ${u.display_nickname} - Lv.${u.level} (${u.exp}/${needExp(u.level)})`).join('\n') || '기록 없음'}`);
        return true;
    }

    if (cmd === '메리순위') {
        const users = await getUsersRank('coins', 15);
        channel.sendChat(`🪙 메리 순위\n${VIEWMORE}\n${users.map((u, i) => `${i + 1}위. ${u.display_nickname} - ${commas(u.coins)}메리`).join('\n') || '기록 없음'}`);
        return true;
    }

    if (cmd === '트리플참가') {
        const pick = (ctx.args[0] || '').trim();
        if (!/^\d{3}$/.test(pick)) {
            channel.sendChat('❌ 사용법: /트리플참가 123');
            return true;
        }
        const u = await ensureUser(sender, channel.channelId + '');
        if (+u.coins < TRIPLE_MATCH_COST) {
            channel.sendChat(`❌ 트리플매칭 참가에는 ${commas(TRIPLE_MATCH_COST)}메리가 필요합니다.\n🪙 현재 메리: ${commas(u.coins)}메리`);
            return true;
        }
        const draw = tripleNumber();
        const matched = tripleMatchCount(pick, draw);
        const next = await putUser({ ...u, coins: +u.coins - TRIPLE_MATCH_COST, updated_at: new Date().toISOString(), last_seen_at: new Date().toISOString() });
        let result = '😥 아쉽게도 꽝입니다..';
        if (matched === 3) result = '🌟 S급 보상에 당첨되셨습니다!';
        else if (matched === 2) result = '✨ A급 보상에 당첨되셨습니다!';
        channel.sendChat(
            `🎰 트리플매칭 결과\n` +
            `· 내 번호: ${pick}\n` +
            `· 추첨 번호: ${draw}\n` +
            `· 일치 개수: ${matched}개\n\n` +
            `${result}\n` +
            `🪙 현재 메리: ${commas(next.coins)}메리`
        );
        return true;
    }

    if (cmd === '반응게임') return startReaction(channel);
    if (cmd === '끝말잇기') return startWordgame(channel);
    if (cmd === '끝말중지') { clearWord(channel.channelId + ''); channel.sendChat('🛑 끝말잇기를 종료했습니다.'); return true; }
    if (cmd === '초성게임') return startCho(channel);
    if (cmd === '초성중지') { clearCho(channel.channelId + ''); channel.sendChat('🛑 초성게임을 종료했습니다.'); return true; }

    if (cmd === '요약' || cmd === '채팅요약') {
        channel.sendChat('📝 최근 대화를 요약 중입니다...');
        const summary = await getSummary(channel);
        channel.sendChat(`🤖 AI 채팅 요약\n${summary}`);
        return true;
    }

    if (cmd === '닉변') {
        const target = ctx.firstMention || sender;
        const logs = await nicknameHistory(target.userId + '');
        if (!logs.length) {
            channel.sendChat('❌ 해당 유저의 닉변 기록이 없습니다.');
            return true;
        }
        channel.sendChat(`📋 닉변 기록 (${logs.length}건)\n${logs.map((log, i) => `${i + 1}. ${log.event_type.replace('프로필변경 (', '').replace(')', '')} (${dt(log.timestamp)})`).join('\n')}`);
        return true;
    }

    if (cmd === '들낙') {
        const target = ctx.firstMention || sender;
        const logs = await joinLeaveHistory(target.userId + '');
        if (!logs.length) {
            channel.sendChat('❌ 해당 유저의 입퇴장 기록이 없습니다.');
            return true;
        }
        channel.sendChat(`📋 입퇴장 기록\n${VIEWMORE}\n${logs.map((log, i) => `${i + 1}. [${log.event_type}] ${log.nickname || '?'} (${dt(log.timestamp)})`).join('\n')}`);
        return true;
    }

    if (cmd === '마지막채팅') {
        const target = ctx.firstMention || sender;
        const u = await ensureUser(target, channel.channelId + '');
        channel.sendChat(`🕒 ${target.nickname}님의 마지막 채팅 시각\n${dt(u.last_chat_at)}`);
        return true;
    }

    if (cmd === '라인등록') {
        const line = normLine(ctx.args[ctx.args.length - 1]);
        const target = ctx.firstMention || sender;
        if (!line) {
            channel.sendChat('❌ 사용법: /라인등록 @유저 탑');
            return true;
        }
        const next = await setLine(target, line, channel.channelId + '');
        channel.sendChat(`✅ ${target.nickname}님의 라인이 ${next.line}(으)로 등록되었습니다.`);
        return true;
    }

    if (cmd === '멸망전') {
        const targets = ctx.mentionUsers.length ? ctx.mentionUsers : [sender];
        const rows = [];
        let total = 0;
        for (const target of targets) {
            const u = await ensureUser(target, channel.channelId + '');
            if (!u.line || !u.tier_token) {
                rows.push(`${target.nickname} - 라인 또는 티어 정보 부족`);
                continue;
            }
            const score = lineScore(u, u.line);
            total += score;
            rows.push(`${target.nickname} | ${u.line} | ${u.tier_token} | ${score.toFixed(1)}점`);
        }
        const avg = targets.length ? (total / targets.length).toFixed(1) : '0.0';
        channel.sendChat(`🔥 멸망전 점수\n${rows.join('\n')}\n\n합계: ${total.toFixed(1)}점\n평균: ${avg}점`);
        return true;
    }

    if (cmd === '내전밸') {
        const targets = ctx.mentionUsers;
        if (targets.length !== 10) {
            channel.sendChat('❌ 사용법: /내전밸 @태그 10명');
            return true;
        }
        const players = [];
        for (const target of targets) {
            const u = await ensureUser(target, channel.channelId + '');
            if (!u.tier_token) {
                channel.sendChat(`❌ ${target.nickname}님의 닉네임에서 티어를 인식할 수 없습니다.`);
                return true;
            }
            players.push({ ...u, mention_nickname: target.nickname });
        }
        channel.sendChat('⚖️ 밸런스를 계산 중입니다...');
        const best = calcTeamAssignment(players);
        if (!best) {
            channel.sendChat('❌ 밸런스 계산에 실패했습니다.');
            return true;
        }
        const aLines = LINES.map((line, i) => `${line}: ${best.a[best.pa[i]].display_nickname} (${best.a[best.pa[i]].line || '미등록'} / ${best.a[best.pa[i]].tier_token || '미인식'} / ${lineScore(best.a[best.pa[i]], line).toFixed(1)})`);
        const bLines = LINES.map((line, i) => `${line}: ${best.b[best.pb[i]].display_nickname} (${best.b[best.pb[i]].line || '미등록'} / ${best.b[best.pb[i]].tier_token || '미인식'} / ${lineScore(best.b[best.pb[i]], line).toFixed(1)})`);
        channel.sendChat(`⚖️ 내전 밸런스\n\n[ 1팀 ]\n${aLines.join('\n')}\n합계: ${best.sa.toFixed(1)}\n\n[ 2팀 ]\n${bLines.join('\n')}\n합계: ${best.sb.toFixed(1)}\n\n점수 차이: ${best.diff.toFixed(1)}`);
        return true;
    }

    return false;
}

async function onChat(data, channel) {
    if (!isTarget(channel)) return false;
    if (!ensureReady()) return false;
    const sender = data.getSenderInfo(channel) || data._chat?.sender;
    if (!sender) return false;
    const msg = (data.text || '').trim();
    const isSenderManager = sender.perm == 1;
    try {
        await ensureUser(sender, channel.channelId + '');
        if (msg) {
            const chatResult = await touchChat(sender, msg, channel.channelId + '');
            if (chatResult.up && chatResult.reward > 0) channel.sendChat(`🌟 ${sender.nickname}님 레벨업! Lv.${chatResult.user.level}\n🪙 +${chatResult.reward}메리`);
        }
        if (ATTENDANCE.has(msg)) {
            if (!validateNicknameOrWarn(sender, channel)) return true;
            return attendance(sender, channel);
        }
        if (await catchReaction(msg, sender, channel)) return true;
        if (await catchCho(msg, sender, channel)) return true;
        if (await catchWord(msg, sender, channel)) return true;
        if (msg.startsWith('/')) return handleCommand(data, channel, sender, isSenderManager);
    } catch (e) {
        console.log('[lol_chatbot] onChat error:', e);
        if (msg.startsWith('/')) channel.sendChat('❌ 명령 처리 중 오류가 발생했습니다.');
        return !!msg.startsWith('/');
    }
    return false;
}

async function onUserJoin(channel, user) {
    if (!isTarget(channel) || !supabase || !user) return;
    try {
        await ensureUser(user, channel.channelId + '');
    } catch (e) {
        console.log('[lol_chatbot] onUserJoin error:', e);
    }
}

async function onUserLeft(channel, user) {
    if (!isTarget(channel) || !supabase || !user) return;
    try {
        await ensureUser(user, channel.channelId + '');
    } catch (e) {
        console.log('[lol_chatbot] onUserLeft error:', e);
    }
}

async function onProfileChanged(channel, lastInfo, user) {
    if (!isTarget(channel) || !supabase || !user) return;
    try {
        await appendNickHistory(user.userId + '', lastInfo ? lastInfo.nickname : null, user.nickname, channel.channelId + '');
        await ensureUser(user, channel.channelId + '');
    } catch (e) {
        console.log('[lol_chatbot] onProfileChanged error:', e);
    }
}

module.exports = {
    TARGET_CHANNEL_ID,
    onChat,
    onUserJoin,
    onUserLeft,
    onProfileChanged
};
