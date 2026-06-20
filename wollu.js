const { createClient } = require('@supabase/supabase-js');
const node_kakao = require('node-kakao');
const axios = require('axios');

const TARGET_CHANNEL_IDS = (process.env.WOLLU_CHANNEL_IDS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
const TARGET_CHANNEL_ID = TARGET_CHANNEL_IDS;

const supabase = process.env.SUPABASE_URL_TWO && process.env.SUPABASE_KEY_TWO
    ? createClient(process.env.SUPABASE_URL_TWO, process.env.SUPABASE_KEY_TWO)
    : null;

const HANDLE_REGEX = /^[ㄱ-ㅎ가-힣a-zA-Z0-9_.]+$/;
const VIEWMORE = '‎'.repeat(500);

const WELCOME_MESSAGE =
    '✅ 계정이 생성되었습니다.\n' +
    '.핸들 [핸들] 명령어로 핸들을 설정하세요.';

function nowIso() {
    return new Date().toISOString();
}

function dt(value) {
    return value ? new Date(value).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '기록 없음';
}

function generateCode() {
    return Math.random().toString(36).slice(2, 10).toUpperCase();
}

// 이미지 버퍼에서 width/height/ext 를 직접 추출 (PNG/JPEG/GIF/WebP).
function getImageSize(buf) {
    if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
        return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), ext: 'png' };
    }
    if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
        return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8), ext: 'gif' };
    }
    if (buf.length >= 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
        let offset = 2;
        while (offset + 9 < buf.length) {
            if (buf[offset] !== 0xFF) { offset++; continue; }
            const marker = buf[offset + 1];
            if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7), ext: 'jpg' };
            }
            offset += 2 + buf.readUInt16BE(offset + 2);
        }
    }
    if (buf.length >= 30 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
        const format = buf.toString('ascii', 12, 16);
        if (format === 'VP8 ') {
            return { width: buf.readUInt16LE(26) & 0x3FFF, height: buf.readUInt16LE(28) & 0x3FFF, ext: 'webp' };
        }
        if (format === 'VP8L') {
            const b = buf.readUInt32LE(21);
            return { width: (b & 0x3FFF) + 1, height: ((b >> 14) & 0x3FFF) + 1, ext: 'webp' };
        }
        if (format === 'VP8X') {
            const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
            const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
            return { width, height, ext: 'webp' };
        }
    }
    return null;
}

function extFromUrl(url) {
    const m = (url || '').split('?')[0].match(/\.([a-zA-Z0-9]+)$/);
    const ext = m ? m[1].toLowerCase() : null;
    return ext === 'jpeg' ? 'jpg' : ext;
}

async function sendImageFromUrl(channel, url) {
    const res = await axios.get(url, { responseType: 'arraybuffer' });
    const buf = Buffer.from(res.data);
    const size = getImageSize(buf);
    const ext = (size && size.ext) || extFromUrl(url) || 'png';
    await channel.sendMedia(node_kakao.KnownChatType.PHOTO, {
        name: `welcome.${ext}`,
        data: buf,
        width: size ? size.width : 1920,
        height: size ? size.height : 1080,
        ext
    });
}

function sendPreviousLogs(channel, userInfo, prevLogs) {
    const events = [
        ...prevLogs.entry.map(e => ({ type: '입장', date: e.date, name: e.name })),
        ...prevLogs.exit.map(e => ({ type: e.cause === '강퇴' ? '강퇴' : '퇴장', date: e.date, name: e.name }))
    ].sort((a, b) => new Date(b.date) - new Date(a.date));
    if (!events.length) return;
    const lines = events.slice(0, 10).map((ev, i) => `${i + 1}. [${ev.type}] ${ev.name || '?'} (${dt(ev.date)})`);
    channel.sendChat(`📋 ${userInfo.nickname}님의 이전 입/퇴장 로그\n${VIEWMORE}\n${lines.join('\n')}`);
}

async function handleCustomCommand(msg, channel) {
    if (!msg || msg.length > 100) return false;
    const { data, error } = await supabase
        .from('commands')
        .select('response_text, image_url')
        .eq('trigger', msg)
        .limit(1);
    if (error) throw error;
    const command = data && data[0];
    if (!command) return false;
    if (command.response_text) channel.sendChat(command.response_text);
    if (command.image_url) {
        try {
            await sendImageFromUrl(channel, command.image_url);
        } catch (e) {
            console.log('[wollu] command 이미지 전송 실패:', e);
        }
    }
    return true;
}

async function sendWelcomeMessage(channel) {
    const { data, error } = await supabase.from('welcome_message').select('text, image_url').eq('id', 1).maybeSingle();
    if (error) throw error;
    if (!data) return;
    if (data.text) channel.sendChat(data.text);
    if (data.image_url) {
        try {
            await sendImageFromUrl(channel, data.image_url);
        } catch (e) {
            console.log('[wollu] welcome 이미지 전송 실패:', e);
        }
    }
}

function isTargetChannel(channel) {
    return !!channel && TARGET_CHANNEL_IDS.includes(channel.channelId + '');
}

function ensureReady(channel) {
    if (supabase) return true;
    if (channel) channel.sendChat('❌ Supabase 설정이 없어 wollu 기능을 사용할 수 없습니다.');
    return false;
}

function isTempName(name) {
    return typeof name === 'string' && name.startsWith('temp-');
}

function normalizeLogs(logs) {
    const safe = logs && typeof logs === 'object' ? logs : {};
    return {
        exit: Array.isArray(safe.exit) ? safe.exit : [],
        entry: Array.isArray(safe.entry) ? safe.entry : [],
        change_name: Array.isArray(safe.change_name) ? safe.change_name : []
    };
}

function tempUserPayload(userInfo, extra = {}) {
    const id = userInfo.userId + '';
    return {
        id,
        name: `temp-${id}`,
        code: generateCode(),
        kakao_name: userInfo.nickname || '',
        profile_image: userInfo.profileURL || null,
        ...extra
    };
}

async function getUser(userId) {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId + '').maybeSingle();
    if (error) throw error;
    return data || null;
}

async function insertTempUser(userInfo, extra = {}) {
    const { data, error } = await supabase.from('users').insert(tempUserPayload(userInfo, extra)).select('*').single();
    if (error) throw error;
    return data;
}

// 채팅마다: chat_count +1, kakao_name/profile_image 갱신. 유저가 없으면 임시 데이터 생성.
async function touchUser(sender) {
    const existing = await getUser(sender.userId + '');
    if (!existing) {
        const created = await insertTempUser(sender, { chat_count: 1 });
        return { user: created, isNew: true };
    }
    const { data, error } = await supabase.from('users').update({
        chat_count: Number(existing.chat_count || 0) + 1,
        kakao_name: sender.nickname || '',
        profile_image: sender.profileURL || null,
        updated_at: nowIso()
    }).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return { user: data, isNew: false };
}

async function changeHandle(arg, channel, user) {
    if (!isTempName(user.name)) {
        channel.sendChat('❌ 이미 핸들이 설정되어 있습니다.');
        return true;
    }
    const value = (arg || '').trim();
    if (!value) {
        channel.sendChat('❌ 사용법: .핸들 [핸들]');
        return true;
    }
    if (!HANDLE_REGEX.test(value)) {
        channel.sendChat('❌ 핸들에는 한글, 영어, 숫자, _, . 만 사용할 수 있습니다.');
        return true;
    }
    const { data: dup, error: dupErr } = await supabase
        .from('users')
        .select('id')
        .eq('name', value)
        .neq('id', user.id)
        .limit(1);
    if (dupErr) throw dupErr;
    if (dup && dup.length) {
        channel.sendChat('❌ 이미 사용 중인 핸들입니다.');
        return true;
    }
    const { error } = await supabase.from('users').update({ name: value, updated_at: nowIso() }).eq('id', user.id);
    if (error) throw error;
    channel.sendChat(`✅ 핸들 설정이 완료되었습니다!\n@${value}\n\nhttps://kakao-wollu.vercel.app\n위 사이트에 들어가 프로필 설정을 완료해주세요.`);
    return true;
}

async function handleCommand(msg, channel, user) {
    const line = msg.split('\n')[0].trim();
    const spaceIdx = line.indexOf(' ');
    const command = (spaceIdx === -1 ? line : line.slice(0, spaceIdx)).slice(1);
    const arg = spaceIdx === -1 ? '' : line.slice(spaceIdx + 1).trim();

    if (command === '코드') {
        channel.sendChat(`🔑 로그인 코드: ${user.code}`);
        return true;
    }
    if (command === '핸들') {
        return changeHandle(arg, channel, user);
    }
    return false;
}

// users.logs jsonb 의 특정 배열에 이벤트를 추가. 유저가 없으면 임시 데이터 생성.
async function appendLog(userInfo, key, entry) {
    if (!supabase || !userInfo) return { isNew: false, prevLogs: normalizeLogs(null) };
    const id = userInfo.userId + '';
    let row = await getUser(id);
    let isNew = false;
    if (!row) {
        row = await insertTempUser(userInfo);
        isNew = true;
    }
    const prevLogs = normalizeLogs(row.logs);
    const logs = { ...prevLogs, [key]: [...prevLogs[key], entry] };
    const { error } = await supabase.from('users').update({
        logs,
        kakao_name: userInfo.nickname || row.kakao_name || '',
        profile_image: userInfo.profileURL || row.profile_image || null,
        updated_at: nowIso()
    }).eq('id', id);
    if (error) throw error;
    return { isNew, prevLogs };
}

async function onChat(data, channel) {
    if (!isTargetChannel(channel)) return false;
    if (!ensureReady(channel)) return false;
    const sender = data.getSenderInfo(channel) || data._chat?.sender;
    if (!sender) return false;
    const msg = (data.text || '').trim();
    try {
        const { user, isNew } = await touchUser(sender);
        if (isNew) channel.sendChat(WELCOME_MESSAGE);
        if (msg.startsWith('.')) return await handleCommand(msg, channel, user);
        if (await handleCustomCommand(msg, channel)) return true;
    } catch (e) {
        console.log('[wollu] onChat error:', e);
        if (msg.startsWith('.')) {
            channel.sendChat('❌ 명령 처리 중 오류가 발생했습니다.');
            return true;
        }
    }
    return false;
}

async function onUserJoin(channel, user) {
    if (!isTargetChannel(channel) || !supabase || !user) return;
    try {
        const { isNew, prevLogs } = await appendLog(user, 'entry', {
            date: nowIso(),
            name: user.nickname || null
        });
        if (isNew) {
            await sendWelcomeMessage(channel);
        } else {
            sendPreviousLogs(channel, user, prevLogs);
        }
    } catch (e) {
        console.log('[wollu] onUserJoin error:', e);
    }
}

async function onUserLeft(channel, user, leftLog) {
    if (!isTargetChannel(channel) || !supabase || !user) return;
    try {
        const kicker = leftLog ? channel.getUserInfo(leftLog.sender) : null;
        const kicked = !!kicker && (kicker.userId + '') !== (user.userId + '');
        await appendLog(user, 'exit', {
            date: nowIso(),
            name: user.nickname || null,
            cause: kicked ? '강퇴' : '나가기',
            kicked_by: kicked ? kicker.userId + '' : null
        });
    } catch (e) {
        console.log('[wollu] onUserLeft error:', e);
    }
}

async function onProfileChanged(channel, lastInfo, user) {
    if (!isTargetChannel(channel) || !supabase || !user) return;
    try {
        const oldName = lastInfo ? lastInfo.nickname : null;
        const newName = user ? user.nickname : null;
        if (!newName || oldName === newName) return;
        await appendLog(user, 'change_name', {
            date: nowIso(),
            old_name: oldName,
            new_name: newName
        });
    } catch (e) {
        console.log('[wollu] onProfileChanged error:', e);
    }
}

module.exports = {
    TARGET_CHANNEL_ID,
    TARGET_CHANNEL_IDS,
    isTargetChannel,
    onChat,
    onUserJoin,
    onUserLeft,
    onProfileChanged
};
