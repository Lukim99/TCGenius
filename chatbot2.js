const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const TARGET_CHANNEL_ID = ['18482851783691995'];
const TARGET_CHANNEL_IDS = TARGET_CHANNEL_ID;
const VIEWMORE = '\u200e'.repeat(500);
const ATTENDANCE_KEYWORDS = new Set(['ㅊㅊ', '출석']);
const CHAT_POINT_REWARD = 1;
const ATTENDANCE_REWARD = 100;
const GAME_REWARD = 50;
const UPDOWN_TIMEOUT = 5 * 60 * 1000;
const CHOSEONG_TIMEOUT = 30 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY)
    : null;

const words = (() => {
    try {
        return fs.readFileSync(path.join(__dirname, 'DB', 'allWords.txt'), 'utf8')
            .split(/\r?\n/)
            .map(v => v.trim())
            .filter(v => /^[가-힣]{2,}$/.test(v));
    } catch (e) {
        return ['사과', '바다', '노을', '사랑', '학교', '자동차'];
    }
})();
const choseongWords = words.filter(v => v.length >= 2 && v.length <= 6);
const updownGames = new Map();
const choseongGames = new Map();

function isTargetChannel(channel) {
    return !!channel && TARGET_CHANNEL_IDS.includes(channel.channelId + '');
}

function ensureReady(channel) {
    if (supabase) return true;
    if (channel) channel.sendChat('❌ Supabase 설정이 없어 chatbot2 기능을 사용할 수 없습니다.');
    return false;
}

function commas(value) {
    return Number(value || 0).toLocaleString('ko-KR');
}

function nowIso() {
    return new Date().toISOString();
}

function todayKst(date = new Date()) {
    return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(date);
}

function yesterdayKst() {
    return todayKst(new Date(Date.now() - 86400000));
}

function dt(value) {
    return value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음';
}

function pseudoKstDate(date = new Date()) {
    return new Date(date.getTime() + KST_OFFSET_MS);
}

function startOfTodayIso(date = new Date()) {
    const kst = pseudoKstDate(date);
    const utcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), 0, 0, 0, 0) - KST_OFFSET_MS;
    return new Date(utcMs).toISOString();
}

function startOfWeekIso(date = new Date()) {
    const kst = pseudoKstDate(date);
    const day = kst.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    const utcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - diff, 0, 0, 0, 0) - KST_OFFSET_MS;
    return new Date(utcMs).toISOString();
}

function startOfMonthIso(date = new Date()) {
    const kst = pseudoKstDate(date);
    const utcMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), 1, 0, 0, 0, 0) - KST_OFFSET_MS;
    return new Date(utcMs).toISOString();
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
    const index = line.indexOf(' ');
    const command = (index === -1 ? line : line.slice(0, index)).trim();
    const argLine = index === -1 ? '' : line.slice(index + 1).trim();
    const mentionIds = mentions(data);
    const mentionUsers = mentionedUsers(channel, mentionIds);
    const stripped = argLine.replace(/@\S+/g, ' ').replace(/\s+/g, ' ').trim();
    const args = stripped ? stripped.split(' ').filter(Boolean) : [];
    return { body, command, argLine, args, mentionIds, mentionUsers, firstMention: mentionUsers[0] || null };
}

function choseong(word) {
    const consonants = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
    return (word || '').split('').map(ch => {
        const value = ch.charCodeAt(0) - 44032;
        if (value < 0 || value > 11171) return ch;
        return consonants[Math.floor(value / 588)];
    }).join('');
}

function userKey(channelId, userId) {
    return `${channelId}:${userId}`;
}

function itemKey(channelId, name) {
    return `${channelId}:${(name || '').trim().toLowerCase()}`;
}

function displayName(user, fallback = '') {
    return user?.display_nickname || fallback || '알 수 없음';
}

function isOwner(userInfo) {
    return !!userInfo && userInfo.perm == 1;
}

function isManager(userInfo) {
    return !!userInfo && (userInfo.perm == 1 || userInfo.perm == 4);
}

function baseUser(userId, nickname, channelId, old = {}) {
    const now = nowIso();
    return {
        id: userKey(channelId, userId),
        channel_id: channelId + '',
        user_id: userId + '',
        display_nickname: nickname || old.display_nickname || '',
        points: Number(old.points || 0),
        attendance_days: Number(old.attendance_days || 0),
        attendance_streak: Number(old.attendance_streak || 0),
        last_attendance_date: old.last_attendance_date || null,
        total_chat_count: Number(old.total_chat_count || 0),
        game_enabled: typeof old.game_enabled === 'boolean' ? old.game_enabled : true,
        updown_wins: Number(old.updown_wins || 0),
        choseong_wins: Number(old.choseong_wins || 0),
        last_chat_at: old.last_chat_at || null,
        last_join_at: old.last_join_at || null,
        last_leave_at: old.last_leave_at || null,
        last_seen_at: now,
        created_at: old.created_at || now,
        updated_at: now
    };
}

async function getUser(channelId, userId) {
    const { data, error } = await supabase.from('chatbot2_users').select('*').eq('id', userKey(channelId, userId)).maybeSingle();
    if (error) throw error;
    return data || null;
}

async function putUser(payload) {
    const { data, error } = await supabase.from('chatbot2_users').upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return data;
}

async function ensureUser(userInfo, channelId) {
    const old = await getUser(channelId, userInfo.userId + '');
    return putUser(baseUser(userInfo.userId, userInfo.nickname, channelId, old || {}));
}

async function updateUser(userInfo, channelId, patch) {
    const current = await ensureUser(userInfo, channelId);
    const timestamp = nowIso();
    return putUser({
        ...current,
        ...patch,
        display_nickname: patch.display_nickname || userInfo.nickname || current.display_nickname || '',
        updated_at: timestamp,
        last_seen_at: timestamp
    });
}

async function touchChat(sender, msg, channelId) {
    const current = await ensureUser(sender, channelId);
    const timestamp = nowIso();
    const reward = msg.startsWith('/') ? 0 : CHAT_POINT_REWARD;
    const next = await putUser({
        ...current,
        display_nickname: sender.nickname || current.display_nickname || '',
        total_chat_count: Number(current.total_chat_count || 0) + 1,
        points: Number(current.points || 0) + reward,
        last_chat_at: timestamp,
        updated_at: timestamp,
        last_seen_at: timestamp
    });
    await supabase.from('chatbot2_chat_logs').insert({
        channel_id: channelId + '',
        user_id: sender.userId + '',
        nickname: next.display_nickname || sender.nickname || '',
        message: (msg || '').slice(0, 1500),
        created_at: timestamp
    });
    return { user: next, reward };
}

async function attendance(sender, channel) {
    const channelId = channel.channelId + '';
    const user = await ensureUser(sender, channelId);
    const today = todayKst();
    if (user.last_attendance_date === today) {
        channel.sendChat(`❌ ${displayName(user, sender.nickname)}님은 오늘 이미 출석했습니다.`);
        return true;
    }
    const streak = user.last_attendance_date === yesterdayKst() ? Number(user.attendance_streak || 0) + 1 : 1;
    const bonus = streak % 7 === 0 ? 50 : 0;
    const reward = ATTENDANCE_REWARD + bonus;
    const next = await putUser({
        ...user,
        attendance_days: Number(user.attendance_days || 0) + 1,
        attendance_streak: streak,
        last_attendance_date: today,
        points: Number(user.points || 0) + reward,
        updated_at: nowIso(),
        last_seen_at: nowIso()
    });
    channel.sendChat(
        `✅ ${displayName(next, sender.nickname)}님 출석 완료!\n` +
        `🎁 +${commas(reward)}포인트\n\n` +
        `📅 누적 출석: ${commas(next.attendance_days)}일\n` +
        `🔥 연속 출석: ${commas(next.attendance_streak)}일\n` +
        `💰 현재 포인트: ${commas(next.points)}P`
    );
    return true;
}

async function isGameEnabledForUser(userInfo, channelId) {
    const user = await ensureUser(userInfo, channelId);
    return user.game_enabled !== false;
}

async function setGameEnabled(userInfo, channelId, enabled) {
    return updateUser(userInfo, channelId, { game_enabled: !!enabled });
}

function clearUpdown(channelId) {
    const state = updownGames.get(channelId);
    if (!state) return;
    if (state.timeout) clearTimeout(state.timeout);
    updownGames.delete(channelId);
}

function clearChoseong(channelId) {
    const state = choseongGames.get(channelId);
    if (!state) return;
    if (state.timeout) clearTimeout(state.timeout);
    choseongGames.delete(channelId);
}

async function startUpdown(channel, sender, max = 100) {
    const channelId = channel.channelId + '';
    if (updownGames.has(channelId)) {
        channel.sendChat('❌ 이미 업다운 게임이 진행 중입니다.');
        return true;
    }
    if (!await isGameEnabledForUser(sender, channelId)) {
        channel.sendChat('❌ 현재 본인의 게임 참여가 비활성화되어 있습니다.');
        return true;
    }
    const answer = Math.floor(Math.random() * max) + 1;
    const state = {
        answer,
        max,
        tries: 0,
        timeout: setTimeout(() => {
            if (updownGames.get(channelId) !== state) return;
            clearUpdown(channelId);
            channel.sendChat(`⌛ 업다운 게임 종료\n정답: ${answer}`);
        }, UPDOWN_TIMEOUT)
    };
    updownGames.set(channelId, state);
    channel.sendChat(`🎯 업다운 게임 시작\n1부터 ${commas(max)} 사이 숫자를 맞혀보세요!`);
    return true;
}

async function catchUpdown(msg, sender, channel) {
    const channelId = channel.channelId + '';
    const state = updownGames.get(channelId);
    if (!state || msg.startsWith('/')) return false;
    if (!/^\d+$/.test(msg.trim())) return false;
    if (!await isGameEnabledForUser(sender, channelId)) return false;
    const guess = Number(msg.trim());
    if (guess < 1 || guess > state.max) return false;
    state.tries += 1;
    if (guess === state.answer) {
        clearUpdown(channelId);
        const user = await ensureUser(sender, channelId);
        const next = await putUser({
            ...user,
            points: Number(user.points || 0) + GAME_REWARD,
            updown_wins: Number(user.updown_wins || 0) + 1,
            updated_at: nowIso(),
            last_seen_at: nowIso()
        });
        channel.sendChat(
            `${displayName(next, sender.nickname)}님이 정답을 맞히셨습니다!\n` +
            `정답: ${state.answer}\n` +
            `- 시도 횟수: ${commas(state.tries)}회\n` +
            `- 포인트: ${commas(next.points)}P (+${GAME_REWARD})`
        );
        return true;
    }
    channel.sendChat(`${displayName(null, sender.nickname)}님 ${guess < state.answer ? '🔺 업!' : '🔻 다운!'}`);
    return true;
}

async function startChoseong(channel, sender) {
    const channelId = channel.channelId + '';
    if (choseongGames.has(channelId)) {
        channel.sendChat('❌ 이미 초성퀴즈가 진행 중입니다.');
        return true;
    }
    if (!await isGameEnabledForUser(sender, channelId)) {
        channel.sendChat('❌ 현재 본인의 게임 참여가 비활성화되어 있습니다.');
        return true;
    }
    const answer = choseongWords[Math.floor(Math.random() * Math.max(1, choseongWords.length))] || '사과';
    const state = {
        answer,
        timeout: setTimeout(() => {
            if (choseongGames.get(channelId) !== state) return;
            clearChoseong(channelId);
            channel.sendChat(`⌛ 초성퀴즈 종료\n정답: ${answer}`);
        }, CHOSEONG_TIMEOUT)
    };
    choseongGames.set(channelId, state);
    channel.sendChat(`[ 초성퀴즈 시작 ]\n초성: ${choseong(answer)}`);
    return true;
}

async function catchChoseong(msg, sender, channel) {
    const channelId = channel.channelId + '';
    const state = choseongGames.get(channelId);
    if (!state || msg.startsWith('/')) return false;
    if (!await isGameEnabledForUser(sender, channelId)) return false;
    if (msg.trim() !== state.answer) return false;
    clearChoseong(channelId);
    const user = await ensureUser(sender, channelId);
    const next = await putUser({
        ...user,
        points: Number(user.points || 0) + GAME_REWARD,
        choseong_wins: Number(user.choseong_wins || 0) + 1,
        updated_at: nowIso(),
        last_seen_at: nowIso()
    });
    channel.sendChat(
        `🏆 초성퀴즈 정답!\n` +
        `정답: ${state.answer}\n` +
        `우승: ${displayName(next, sender.nickname)}\n` +
        `🎁 +${GAME_REWARD}포인트\n` +
        `💰 현재 포인트: ${commas(next.points)}P`
    );
    return true;
}

async function getUsersByPoints(channelId, limit = 15) {
    const { data, error } = await supabase.from('chatbot2_users').select('*').eq('channel_id', channelId);
    if (error) throw error;
    return (data || []).sort((a, b) => Number(b.points || 0) - Number(a.points || 0)).slice(0, limit);
}

async function getChatCount(channelId, userId, sinceIso) {
    let query = supabase.from('chatbot2_chat_logs').select('*', { count: 'exact', head: true }).eq('channel_id', channelId).eq('user_id', userId + '');
    if (sinceIso) query = query.gte('created_at', sinceIso);
    const { count, error } = await query;
    if (error) throw error;
    return Number(count || 0);
}

async function getChatStats(channelId, userId) {
    const [today, week, month, total] = await Promise.all([
        getChatCount(channelId, userId, startOfTodayIso()),
        getChatCount(channelId, userId, startOfWeekIso()),
        getChatCount(channelId, userId, startOfMonthIso()),
        getChatCount(channelId, userId, null)
    ]);
    return { today, week, month, total };
}

async function getShopItem(channelId, name) {
    const key = itemKey(channelId, name);
    const { data, error } = await supabase.from('chatbot2_shop_items').select('*').eq('id', key).maybeSingle();
    if (error) throw error;
    return data || null;
}

async function listShopItems(channelId) {
    const { data, error } = await supabase.from('chatbot2_shop_items').select('*').eq('channel_id', channelId).eq('is_active', true).order('price', { ascending: true }).order('name', { ascending: true });
    if (error) throw error;
    return data || [];
}

async function saveShopItem(channelId, name, price, description, sender) {
    const existing = await getShopItem(channelId, name);
    const timestamp = nowIso();
    const payload = {
        id: itemKey(channelId, name),
        channel_id: channelId + '',
        item_key: (name || '').trim().toLowerCase(),
        name: (name || '').trim(),
        price: Number(price || 0),
        description: (description || '').trim(),
        is_active: true,
        created_by: existing?.created_by || (sender ? sender.userId + '' : null),
        created_at: existing?.created_at || timestamp,
        updated_at: timestamp
    };
    const { data, error } = await supabase.from('chatbot2_shop_items').upsert(payload, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    return data;
}

async function removeShopItem(channelId, name) {
    const existing = await getShopItem(channelId, name);
    if (!existing || !existing.is_active) return null;
    const { data, error } = await supabase.from('chatbot2_shop_items').update({ is_active: false, updated_at: nowIso() }).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return data;
}

async function addPoints(userInfo, channelId, amount) {
    const user = await ensureUser(userInfo, channelId);
    const nextPoints = Math.max(0, Number(user.points || 0) + Number(amount || 0));
    return putUser({
        ...user,
        points: nextPoints,
        updated_at: nowIso(),
        last_seen_at: nowIso()
    });
}

function parsePositiveAmount(text) {
    const match = (text || '').match(/-?\d+/);
    const value = match ? Number(match[0]) : NaN;
    if (!Number.isInteger(value) || value <= 0) return null;
    return value;
}

function parseShopRegister(argLine) {
    const parts = (argLine || '').split('|').map(v => v.trim());
    const name = parts[0] || '';
    const price = Number((parts[1] || '').replace(/[^\d-]/g, ''));
    const description = parts.slice(2).join(' | ').trim();
    if (!name || !Number.isFinite(price) || price <= 0) return null;
    return { name, price, description };
}

async function handleCommand(data, channel, sender) {
    const channelId = channel.channelId + '';
    const ctx = cmdCtx(data, channel);
    const cmd = ctx.command;

    if (cmd === '출석') return attendance(sender, channel);

    if (cmd === '포인트' || cmd === '잔고' || cmd === '내정보') {
        const user = await ensureUser(sender, channelId);
        channel.sendChat(
            `👤 ${displayName(user, sender.nickname)}\n` +
            `💰 포인트: ${commas(user.points)}P\n` +
            `💬 누적 채팅: ${commas(user.total_chat_count)}회\n` +
            `📅 출석: ${commas(user.attendance_days)}일 (연속 ${commas(user.attendance_streak)}일)\n` +
            `🎮 업다운 ${commas(user.updown_wins)} / 초성 ${commas(user.choseong_wins)}\n` +
            `⚙️ 게임 참여: ${user.game_enabled === false ? 'OFF' : 'ON'}\n` +
            `🕒 마지막 채팅: ${dt(user.last_chat_at)}`
        );
        return true;
    }

    if (cmd === '포인트순위') {
        const users = await getUsersByPoints(channelId, 15);
        channel.sendChat(`🏆 포인트 순위\n${VIEWMORE}\n${users.map((user, index) => `${index + 1}위. ${displayName(user)} - ${commas(user.points)}P`).join('\n') || '기록 없음'}`);
        return true;
    }

    if (cmd === '채팅수') {
        const target = ctx.firstMention || sender;
        const user = await ensureUser(target, channelId);
        const stats = await getChatStats(channelId, target.userId + '');
        channel.sendChat(
            `💬 ${displayName(user, target.nickname)} 채팅수\n` +
            `오늘: ${commas(stats.today)}회\n` +
            `주간: ${commas(stats.week)}회\n` +
            `월간: ${commas(stats.month)}회\n` +
            `전체: ${commas(stats.total)}회`
        );
        return true;
    }

    if (cmd === '게임') {
        if (!isManager(sender)) {
            channel.sendChat('❌ 방장/부방장만 사용할 수 있는 명령어입니다.');
            return true;
        }
        const mode = (ctx.args[0] || '').toLowerCase();
        const target = ctx.firstMention;
        if (!target || !['on', 'off'].includes(mode)) {
            channel.sendChat('❌ 사용법: /게임 <on/off> @멘션');
            return true;
        }
        const next = await setGameEnabled(target, channelId, mode === 'on');
        channel.sendChat(`✅ ${displayName(next, target.nickname)}님의 게임 참여가 ${mode.toUpperCase()}${mode == 'on' ? "으":""}로 설정되었습니다.`);
        return true;
    }

    if (cmd === '포인트지급' || cmd === '포인트차감') {
        if (!isOwner(sender)) {
            channel.sendChat('❌ 방장만 사용할 수 있는 명령어입니다.');
            return true;
        }
        const target = ctx.firstMention;
        const amount = parsePositiveAmount(ctx.argLine);
        if (!target || !amount) {
            channel.sendChat(`❌ 사용법: /${cmd} 1000 @멘션`);
            return true;
        }
        const signedAmount = cmd === '포인트지급' ? amount : -amount;
        const next = await addPoints(target, channelId, signedAmount);
        channel.sendChat(`✅ ${displayName(next, target.nickname)}님의 포인트가 ${cmd === '포인트지급' ? `${commas(amount)}P 지급` : `${commas(amount)}P 차감`}되었습니다.\n💰 현재 포인트: ${commas(next.points)}P`);
        return true;
    }

    if (cmd === '업다운' || cmd === '업다운시작') {
        const max = Number(ctx.args[0] || 100);
        if (!Number.isInteger(max) || max < 10 || max > 100000) {
            channel.sendChat('❌ 사용법: /업다운 100');
            return true;
        }
        return startUpdown(channel, sender, max);
    }

    if (cmd === '업다운중지') {
        clearUpdown(channelId);
        channel.sendChat('🛑 업다운 게임을 종료했습니다.');
        return true;
    }

    if (cmd === '초성퀴즈' || cmd === '초성게임') return startChoseong(channel, sender);

    if (cmd === '초성중지') {
        clearChoseong(channelId);
        channel.sendChat('🛑 초성퀴즈를 종료했습니다.');
        return true;
    }

    if (cmd === '상점' || cmd === '포인트상점') {
        const items = await listShopItems(channelId);
        channel.sendChat(`🛒 포인트 상점\n${VIEWMORE}\n${items.map((item, index) => `${index + 1}. ${item.name} - ${commas(item.price)}P${item.description ? `\n   ${item.description}` : ''}`).join('\n') || '등록된 상품이 없습니다.'}`);
        return true;
    }

    if (cmd === '상점등록') {
        if (!isOwner(sender)) {
            channel.sendChat('❌ 방장만 사용할 수 있는 명령어입니다.');
            return true;
        }
        const parsed = parseShopRegister(ctx.argLine);
        if (!parsed) {
            channel.sendChat('❌ 사용법: /상점등록 상품명 | 100 | 설명');
            return true;
        }
        const item = await saveShopItem(channelId, parsed.name, parsed.price, parsed.description, sender);
        channel.sendChat(`✅ 상점 상품이 등록되었습니다.\n상품명: ${item.name}\n가격: ${commas(item.price)}P${item.description ? `\n설명: ${item.description}` : ''}`);
        return true;
    }

    if (cmd === '상점제거' || cmd === '상점삭제') {
        if (!isOwner(sender)) {
            channel.sendChat('❌ 방장만 사용할 수 있는 명령어입니다.');
            return true;
        }
        const name = (ctx.argLine || '').trim();
        if (!name) {
            channel.sendChat('❌ 사용법: /상점제거 상품명');
            return true;
        }
        const removed = await removeShopItem(channelId, name);
        if (!removed) {
            channel.sendChat('❌ 해당 상품을 찾을 수 없습니다.');
            return true;
        }
        channel.sendChat(`🗑️ 상점 상품 제거 완료\n상품명: ${removed.name}`);
        return true;
    }

    return false;
}

async function onChat(data, channel) {
    if (!isTargetChannel(channel)) return false;
    if (!ensureReady(channel)) return false;
    const sender = data.getSenderInfo(channel) || data._chat?.sender;
    if (!sender) return false;
    const msg = (data.text || '').trim();
    try {
        if (msg) await touchChat(sender, msg, channel.channelId + '');
        if (ATTENDANCE_KEYWORDS.has(msg)) return attendance(sender, channel);
        if (await catchUpdown(msg, sender, channel)) return true;
        if (await catchChoseong(msg, sender, channel)) return true;
        if (msg.startsWith('/')) return handleCommand(data, channel, sender);
    } catch (e) {
        console.log('[chatbot2] onChat error:', e);
        if (msg.startsWith('/')) channel.sendChat('❌ 명령 처리 중 오류가 발생했습니다.');
        return !!msg.startsWith('/');
    }
    return false;
}

async function onUserJoin(channel, user) {
    if (!isTargetChannel(channel) || !supabase || !user) return;
    try {
        const next = await updateUser(user, channel.channelId + '', { last_join_at: nowIso(), display_nickname: user.nickname || '' });
        channel.sendChat(`👋 ${displayName(next, user.nickname)}님이 입장했습니다.`);
    } catch (e) {
        console.log('[chatbot2] onUserJoin error:', e);
    }
}

async function onUserLeft(channel, user) {
    if (!isTargetChannel(channel) || !supabase || !user) return;
    try {
        const next = await updateUser(user, channel.channelId + '', { last_leave_at: nowIso(), display_nickname: user.nickname || '' });
        channel.sendChat(`🚪 ${displayName(next, user.nickname)}님이 퇴장했습니다.`);
    } catch (e) {
        console.log('[chatbot2] onUserLeft error:', e);
    }
}

module.exports = {
    TARGET_CHANNEL_ID,
    TARGET_CHANNEL_IDS,
    isTargetChannel,
    onChat,
    onUserJoin,
    onUserLeft
};
