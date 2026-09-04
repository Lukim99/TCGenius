const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const el = (tag, props, ...children) => {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
        if (k === 'class') e.className = props[k];
        else if (k === 'style' && typeof props[k] === 'object') Object.assign(e.style, props[k]);
        else if (k.startsWith('on') && typeof props[k] === 'function') e.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (k in e) e[k] = props[k];
        else e.setAttribute(k, props[k]);
    }
    children.flat().forEach(c => {
        if (c == null || c === false) return;
        e.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
    return e;
};
function svgIcon(svgHtml) {
    const tmp = document.createElement('div');
    tmp.innerHTML = svgHtml;
    return tmp.firstElementChild;
}
// 칭호 이미지 뱃지 (닉네임 앞에 표시). title: { name, imageUrl } | null
function titleImg(title) {
    if (!title || !title.imageUrl) return null;
    return el('img', { src: title.imageUrl, class: 'title-badge', alt: title.name || '', title: title.name || '' });
}
const api = async url => {
    const r = await fetch(url);
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || ('HTTP ' + r.status));
    return x;
};
const postApi = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || ('HTTP ' + r.status));
    return x;
};
// ===== 공통 메시지 모달 (네이티브 alert/confirm/prompt 대체) =====
function openMsgModal(message, opts) {
    return new Promise(resolve => {
        const isConfirm = !!(opts && opts.confirm);
        const isPrompt = !!(opts && opts.prompt);
        const bg = el('div', { class: 'msg-modal-bg' });
        let input = null;
        if (isPrompt) input = el('input', { class: 'msg-modal-input', type: 'text', value: (opts && opts.value) || '', maxLength: (opts && opts.maxLength) || 200 });
        const done = val => { bg.remove(); resolve(val); };
        const okValue = () => isPrompt ? input.value : true;
        const cancelValue = isPrompt ? null : false;
        const okBtn = el('button', { class: 'msg-modal-btn primary', type: 'button', onclick: () => done(okValue()) }, (opts && opts.okLabel) || '확인');
        const actions = (isConfirm || isPrompt)
            ? [el('button', { class: 'msg-modal-btn', type: 'button', onclick: () => done(cancelValue) }, '취소'), okBtn]
            : [okBtn];
        bg.appendChild(el('div', { class: 'msg-modal' },
            el('div', { class: 'msg-modal-text' }, String(message)),
            input,
            el('div', { class: 'msg-modal-actions' }, ...actions)));
        bg.addEventListener('click', e => { if (e.target === bg && !isConfirm && !isPrompt) done(true); });
        bg.addEventListener('keydown', e => {
            if (e.key === 'Escape') done(isConfirm || isPrompt ? cancelValue : true);
            if (e.key === 'Enter' && isPrompt) done(okValue());
        });
        document.body.appendChild(bg);
        setTimeout(() => (input || okBtn).focus(), 30);
    });
}
const showAlert = message => openMsgModal(message);
const showConfirm = (message, okLabel) => openMsgModal(message, { confirm: true, okLabel });
const showPrompt = (message, value, maxLength) => openMsgModal(message, { prompt: true, value, maxLength });

const KOREAN_BIG_UNITS = ['', '만', '억', '조', '경', '해', '자', '양', '구', '간', '정', '재', '극'];
const comma = value => {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return String(value);
    const abs = Math.abs(n);
    if (abs < 1_000_000_000) return n.toLocaleString('ko-KR');
    const sign = n < 0 ? '-' : '';
    const groups = [];
    let remaining = Math.trunc(abs);
    while (remaining > 0) {
        groups.push(remaining % 10000);
        remaining = Math.floor(remaining / 10000);
    }
    let topIndex = groups.length - 1;
    while (topIndex > 0 && groups[topIndex] === 0) topIndex--;
    const parts = [String(groups[topIndex]) + KOREAN_BIG_UNITS[topIndex]];
    if (topIndex > 0 && groups[topIndex - 1] > 0) parts.push(String(groups[topIndex - 1]) + KOREAN_BIG_UNITS[topIndex - 1]);
    return sign + parts.join(' ');
};

$('#logout').onclick = async () => { closeWebChatStream(); await fetch('/api/logout', { method: 'POST' }); location.reload(); };

// ===== 2단계 인증(구글 OTP) 설정 =====
function otpCodeInput() {
    return el('input', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: 'OTP 6자리 코드', autocomplete: 'one-time-code', style: 'letter-spacing:.2em;text-align:center' });
}
async function openOtpModal() {
    let status;
    try { status = await api('/api/otp/status'); } catch (x) { showAlert(x.message); return; }
    if (status.enabled) {
        const input = otpCodeInput();
        const btn = el('button', { class: 'primary' }, '2단계 인증 끄기');
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                await postApi('/api/otp/disable', { otp: input.value.trim() });
                closeModal();
                showAlert('2단계 인증이 해제되었습니다.');
            } catch (x) { showAlert(x.message); btn.disabled = false; }
        };
        openRichModal('2단계 인증', '현재 켜져 있습니다. 해제하려면 OTP 코드를 입력하세요.', [input, btn]);
    } else {
        let setup;
        try { setup = await postApi('/api/otp/setup'); } catch (x) { showAlert(x.message); return; }
        const secretBox = el('input', { type: 'text', readonly: '', value: setup.secret, style: 'font-family:ui-monospace,monospace;text-align:center', onclick: e => e.target.select() });
        const input = otpCodeInput();
        const btn = el('button', { class: 'primary' }, '2단계 인증 켜기');
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                await postApi('/api/otp/enable', { otp: input.value.trim() });
                closeModal();
                showAlert('2단계 인증이 활성화되었습니다. 새 기기 로그인 시 로그인 코드 대신 OTP 코드를 사용할 수 있습니다.');
            } catch (x) { showAlert(x.message); btn.disabled = false; }
        };
        openRichModal('2단계 인증 설정', 'Google Authenticator 앱에서 아래 키를 등록한 뒤, 앱에 표시되는 6자리 코드를 입력하세요.', [
            el('div', { class: 'stat-line' }, '앱에서 [+] → 설정 키 입력 → 계정명은 자유롭게, 키는 아래 값을 입력'),
            secretBox,
            el('a', { href: setup.uri, style: 'font-size:12px;text-align:center;display:block' }, '모바일에서 보고 있다면 여기를 눌러 앱에 바로 등록'),
            input, btn
        ]);
    }
}
if ($('#otpBtn')) $('#otpBtn').onclick = openOtpModal;
window.addEventListener('pagehide', closeWebChatStream);
if ($('#adminLink')) $('#adminLink').onclick = () => { location.href = '/admin'; };

function setHeaderPoint(n) {
    const node = $('#pointAmount');
    if (node) node.textContent = comma(Number(n || 0));
}
function showLoading() { const o = $('#loadingOverlay'); if (o) o.classList.add('active'); }
function hideLoading() { const o = $('#loadingOverlay'); if (o) o.classList.remove('active'); }
function openPointChargeModal() {
    $('#modalTitle').textContent = '포인트 충전';
    $('#modalSub').textContent = '최소 50P부터 충전할 수 있습니다.';
    $('#modalSub').style.display = '';
    const input = el('input', { type: 'number', min: '50', step: '1', placeholder: '충전할 포인트', inputmode: 'numeric' });
    const info = el('div', { class: 'point-charge-info' }, '보유 잔액에서 입력한 포인트만큼 차감되어 충전됩니다.');
    const btn = el('button', { class: 'primary' }, '충전하기');
    btn.onclick = async () => {
        const amount = Math.floor(Number(input.value));
        if (!Number.isFinite(amount) || amount < 50) { showAlert('최소 50P부터 충전할 수 있습니다.'); return; }
        btn.disabled = true;
        showLoading();
        try {
            const r = await postApi('/api/point/charge', { amount });
            setHeaderPoint(r.point);
            closeModal();
            showAlert(comma(r.charged) + 'P를 충전했습니다.');
            if (currentProfileName === myName) { try { renderProfile(await api('/api/profile')); } catch (e) {} }
        } catch (e) {
            showAlert(e.message);
            btn.disabled = false;
        } finally {
            hideLoading();
        }
    };
    $('#modalBody').replaceChildren(el('div', { class: 'point-charge-body' }, input, info, btn));
    $('#modalBg').classList.add('active');
    setTimeout(() => input.focus(), 50);
}
if ($('#pointAddBtn')) $('#pointAddBtn').onclick = openPointChargeModal;

const PAGE_LABELS = { home: '메인', chat: '채팅', info: '정보', inventory: '인벤토리', mail: '메일함', preset: '프리셋', event: '이벤트', '퀘스트': '게시판', '사냥': '사냥', '[H]필드': '[H]필드', pvp: 'PVP', '자물쇠': '자물쇠', '캡슐': '100일 캡슐', combine: '조합', jobcombine: '전직조합', 'equipment-synthesis': '장비합성', dex: '도감', '레벨보상': '레벨보상', auction: '팝니다', buyorder: '삽니다', shop: '상점', ranking: '랭킹', patchnotes: '패치노트', party: '레이드' };
const mailState = { mails: [], unread: 0, selectedId: null, page: 1, totalPages: 1 };
const ICONS = {
    home:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/></svg>`,
    chat:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 9h8M8 13h5"/></svg>`,
    me:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>`,
    content:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    market:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><line x1="3" x2="21" y1="6" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>`,
    event:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
    community: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2z"/></svg>`,
};
// 유생의 주사위 이벤트 종료 시각(KST 2026-07-10 23:59). 종료 후 탭 자체를 노출하지 않는다.
const EVENT_DICE_END_TS = new Date('2026-07-10T23:59:00+09:00').getTime();
const EVENT_DICE_ENDED = Date.now() >= EVENT_DICE_END_TS;
const GROUPS = [
    { id: 'home',      label: '메인',     iconSvg: ICONS.home,      pages: ['home'] },
    { id: 'chat',      label: '채팅',     iconSvg: ICONS.chat,      pages: ['chat'] },
    { id: 'me',        label: '캐릭터',   iconSvg: ICONS.me,        pages: ['info', 'inventory', 'mail', 'preset'] },
    { id: 'content',   label: '콘텐츠',   iconSvg: ICONS.content,   pages: ['퀘스트', '사냥', 'pvp', 'combine', 'jobcombine', 'equipment-synthesis', 'dex', '레벨보상'] },
    { id: 'events',    label: '이벤트',   iconSvg: ICONS.event,     pages: ['캡슐', '자물쇠', ...(EVENT_DICE_ENDED ? [] : ['event'])] },
    { id: 'market',    label: '거래',     iconSvg: ICONS.market,    pages: ['shop', 'auction', 'buyorder'] },
    { id: 'community', label: '커뮤니티', iconSvg: ICONS.community, pages: ['ranking', 'patchnotes'] },
];

let activePage = 'home';

function getGroupForPage(pageId) {
    return GROUPS.find(g => g.pages.includes(pageId)) || GROUPS[0];
}

function buildNav() {
    const groupTabsEl = $('#groupTabs');
    const bottomTabsEl = $('#bottomTabs');
    GROUPS.forEach(g => {
        const handler = () => activateGroup(g.id);
        if (groupTabsEl) groupTabsEl.appendChild(
            el('button', { class: 'group-tab', 'data-group': g.id, onclick: handler }, svgIcon(g.iconSvg), g.label)
        );
        if (bottomTabsEl) bottomTabsEl.appendChild(
            el('button', { class: 'bottom-tab', 'data-group': g.id, 'aria-label': g.label, title: g.label, onclick: handler },
                el('span', { class: 'tab-icon-wrap' }, svgIcon(g.iconSvg)),
                el('span', { class: 'tab-label' }, g.label))
        );
    });
    const initGroup = getGroupForPage(activePage);
    syncGroupActive(initGroup.id);
    buildSubNav(initGroup);
}

function syncGroupActive(groupId) {
    $$('.group-tab, .bottom-tab').forEach(t => t.classList.toggle('active', t.dataset.group === groupId));
}

function buildSubNav(group) {
    const bar = $('#subNavBar');
    if (!bar) return;
    const pages = group.pages.filter(p => p !== 'party');
    if (pages.length <= 1) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex';
    bar.replaceChildren(...pages.map(pageId =>
        el('button', { class: 'subnav-tab' + (pageId === activePage ? ' active' : ''), 'data-page': pageId,
            onclick: () => navigatePage(pageId) }, PAGE_LABELS[pageId] || pageId)
    ));
    updateMailBadge();
}

function activateGroup(groupId) {
    const group = GROUPS.find(g => g.id === groupId);
    if (!group) return;
    syncGroupActive(groupId);
    buildSubNav(group);
    navigatePage(group.pages[0]);
}

function navigatePage(pageId) {
    if (pageId === '[H]필드') { location.href = '/hfield'; return; }
    if (activePage === 'chat' && pageId !== 'chat') closeWebChatStream();
    activePage = pageId;
    $$('.page').forEach(p => p.classList.toggle('active', p.dataset.page === pageId));
    $$('.subnav-tab').forEach(t => t.classList.toggle('active', t.dataset.page === pageId));
    if (pageId === 'home') loadHomeBanners();
    if (pageId === 'chat') loadWebChat();
    if (pageId === 'info' && !suppressInfoSelfReset && currentProfileName && myName && currentProfileName !== myName) loadProfile(myName).catch(e => showAlert(e.message));
    if (pageId === 'inventory') {
        if (currentProfileName && myName && currentProfileName !== myName) {
            currentInventoryName = currentProfileName;
        } else {
            currentInventoryName = myName;
        }
        updateInventoryBanner();
        loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
    }
    if (pageId === 'mail') loadMail();
    if (pageId === 'preset') loadPresets();
    if (pageId === 'pvp') loadPvp();
    if (pageId === 'event') loadEventDice();
    if (pageId === '자물쇠') loadLockbox();
    if (pageId === '캡슐') loadCapsule();
    if (pageId === '퀘스트') loadQuests();
    if (pageId === '사냥') renderHuntMenu();
    if (pageId === 'combine') loadCombine();
    if (pageId === 'jobcombine') loadJobCombine();
    if (pageId === 'equipment-synthesis') loadEquipmentSynthesis();
    if (pageId === '레벨보상') loadLevelRewards();
    if (pageId === 'shop') loadShop(); else stopHotdealCountdown();
    if (pageId === 'auction') loadAuctions();
    if (pageId === 'buyorder') loadBuyOrders();
    if (pageId === 'ranking') loadRanking();
    if (pageId === 'dex') {
        setDexSidebarVisible(true);
        loadDex();
    }
    if (pageId === 'patchnotes') loadPatchnotes();
    updateEquipmentSynthesisDockVisibility();
}

function activatePage(name) {
    if (name === 'party') { location.href = '/party'; return; }
    const group = getGroupForPage(name);
    syncGroupActive(group.id);
    buildSubNav(group);
    navigatePage(name);
}

buildNav();

const WEB_CHAT_ROOMS = [
    { id: 'public-1', name: '자유 채팅 1', detail: '웹 공용 채팅방' },
    { id: 'public-2', name: '자유 채팅 2', detail: '웹 공용 채팅방' },
    { id: 'public-3', name: '자유 채팅 3', detail: '웹 공용 채팅방' },
    { id: 'public-4', name: '자유 채팅 4', detail: '웹 공용 채팅방' },
    { id: 'public-5', name: '자유 채팅 5', detail: '웹 공용 채팅방' },
    { id: 'me', name: 'RPGenius 개인 채팅', detail: '나와 봇만 볼 수 있어요', private: true }
];
let webChatRoomId = null;
let webChatStream = null;
let webChatMessages = new Map();
let webChatHasOlder = false;
let webChatGeneration = 0;
let webChatPinnedBottom = true;
let webChatModalReturnFocus = null;

function closeWebChatFullMessage() {
    const modal = $('#webChatFullModal');
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    document.body.classList.remove('webchat-modal-open');
    if (webChatModalReturnFocus && document.contains(webChatModalReturnFocus)) webChatModalReturnFocus.focus();
    webChatModalReturnFocus = null;
}

function openWebChatFullMessage(message, trigger) {
    const modal = $('#webChatFullModal');
    const content = $('#webChatFullContent');
    if (!modal || !content) return;
    const parts = [message.text, message.moreText].filter(Boolean);
    content.textContent = parts.join('\n\n');
    webChatModalReturnFocus = trigger || null;
    modal.hidden = false;
    document.body.classList.add('webchat-modal-open');
    $('#webChatFullClose').focus();
}

function closeWebChatStream() {
    if (webChatStream) webChatStream.close();
    webChatStream = null;
    webChatGeneration++;
}

function renderWebChatRooms() {
    const list = $('#webChatRoomList');
    if (!list) return;
    list.replaceChildren(...WEB_CHAT_ROOMS.map(room => el('button', {
        type: 'button',
        class: 'webchat-room' + (room.id === webChatRoomId ? ' active' : ''),
        onclick: () => openWebChatRoom(room.id)
    },
    el('span', { class: 'webchat-room-avatar' }, room.private ? 'R' : room.name.slice(-1)),
    el('span', { class: 'webchat-room-copy' },
        el('b', null, room.name),
        el('span', null, room.detail))
    )));
}

function webChatNearBottom() {
    const list = $('#webChatMessages');
    return !list || list.scrollHeight - list.scrollTop - list.clientHeight < 90;
}

function scrollWebChatToBottom() {
    const list = $('#webChatMessages');
    if (list) list.scrollTop = list.scrollHeight;
    webChatPinnedBottom = true;
    const button = $('#webChatNewMessage');
    if (button) button.hidden = true;
}

function webChatTime(timestamp) {
    return new Date(Number(timestamp || 0)).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function webChatMessageNode(message) {
    const own = message.sender && message.sender.type === 'user' && message.sender.name === myName;
    const bot = message.sender && message.sender.type === 'bot';
    const row = el('div', { class: 'webchat-message' + (own ? ' own' : '') + (bot ? ' bot' : '') });
    const bubble = el('div', { class: 'webchat-bubble' });
    const text = el('div', { class: 'webchat-text' });
    text.textContent = message.text || '';
    bubble.append(text);
    if (message.moreText) {
        bubble.append(el('button', {
            type: 'button', class: 'webchat-view-more',
            onclick: event => openWebChatFullMessage(message, event.currentTarget)
        }, '전체보기'));
    }
    row.append(
        el('div', { class: 'webchat-sender' }, own ? '' : ((message.sender && message.sender.name) || '알 수 없음')),
        el('div', { class: 'webchat-bubble-line' }, bubble, el('time', null, webChatTime(message.createdAt)))
    );
    return row;
}

function renderWebChatMessages(keepPosition) {
    const list = $('#webChatMessages');
    if (!list) return;
    const oldHeight = list.scrollHeight;
    const messages = Array.from(webChatMessages.values()).sort((a, b) => Number(a.id) - Number(b.id));
    const older = el('button', {
        id: 'webChatOlder', type: 'button', class: 'webchat-older', hidden: !webChatHasOlder,
        onclick: loadOlderWebChatMessages
    }, '이전 메시지 보기');
    list.replaceChildren(older, ...messages.map(webChatMessageNode));
    if (keepPosition) list.scrollTop += list.scrollHeight - oldHeight;
}

function appendWebChatMessage(message) {
    if (!message || webChatMessages.has(String(message.id))) return;
    const shouldScroll = webChatNearBottom();
    webChatMessages.set(String(message.id), message);
    renderWebChatMessages(false);
    if (shouldScroll || (message.sender && message.sender.name === myName)) scrollWebChatToBottom();
    else $('#webChatNewMessage').hidden = false;
}

async function loadOlderWebChatMessages() {
    const roomId = webChatRoomId;
    const generation = webChatGeneration;
    const messageMap = webChatMessages;
    const ordered = Array.from(messageMap.values()).sort((a, b) => Number(a.id) - Number(b.id));
    if (!ordered.length || !roomId) return;
    try {
        const data = await api('/api/chat/' + encodeURIComponent(roomId) + '/history?limit=50&before=' + encodeURIComponent(ordered[0].id));
        if (roomId !== webChatRoomId || generation !== webChatGeneration || messageMap !== webChatMessages) return;
        data.messages.forEach(message => messageMap.set(String(message.id), message));
        webChatHasOlder = data.messages.length === 50;
        renderWebChatMessages(true);
    } catch (e) {
        if (roomId !== webChatRoomId || generation !== webChatGeneration || messageMap !== webChatMessages) return;
        webChatHasOlder = false;
        renderWebChatMessages(false);
        $('#webChatError').textContent = e.message;
    }
}

async function openWebChatRoom(roomId) {
    const room = WEB_CHAT_ROOMS.find(item => item.id === roomId);
    if (!room) return;
    closeWebChatStream();
    webChatRoomId = roomId;
    webChatMessages = new Map();
    webChatHasOlder = false;
    const generation = webChatGeneration;
    const messageMap = webChatMessages;
    renderWebChatRooms();
    const shell = $('#webChatShell');
    if (shell) shell.classList.add('room-open');
    $('#webChatRoomTitle').textContent = room.name;
    $('#webChatRoomDetail').textContent = room.detail;
    $('#webChatMessages').replaceChildren(el('div', { class: 'webchat-empty' }, '메시지를 불러오는 중...'));

    const source = new EventSource('/api/chat/' + encodeURIComponent(roomId) + '/stream');
    webChatStream = source;
    source.onmessage = event => {
        if (source !== webChatStream || generation !== webChatGeneration || messageMap !== webChatMessages) return;
        try { appendWebChatMessage(JSON.parse(event.data)); } catch (_) { }
    };
    source.addEventListener('ready', async () => {
        const shouldScroll = webChatPinnedBottom || !messageMap.size;
        try {
            const data = await api('/api/chat/' + encodeURIComponent(roomId) + '/history?limit=50');
            if (source !== webChatStream || roomId !== webChatRoomId || generation !== webChatGeneration || messageMap !== webChatMessages) return;
            data.messages.forEach(message => messageMap.set(String(message.id), message));
            webChatHasOlder = data.messages.length === 50;
            renderWebChatMessages(false);
            if (shouldScroll) scrollWebChatToBottom();
            else if ($('#webChatNewMessage')) $('#webChatNewMessage').hidden = false;
            $('#webChatInput').focus();
        } catch (e) {
            if (source !== webChatStream || roomId !== webChatRoomId || generation !== webChatGeneration || messageMap !== webChatMessages) return;
            $('#webChatMessages').replaceChildren(el('div', { class: 'webchat-empty err' }, e.message));
        }
    });
}

function loadWebChat() {
    renderWebChatRooms();
    if (webChatRoomId) openWebChatRoom(webChatRoomId);
    else if (!matchMedia('(max-width: 700px)').matches) openWebChatRoom('public-1');
}

async function sendWebChatMessage() {
    const input = $('#webChatInput');
    const error = $('#webChatError');
    const button = $('#webChatSend');
    if (!input || !button || button.disabled || !webChatRoomId || !input.value.trim()) return;
    const roomId = webChatRoomId;
    const generation = webChatGeneration;
    const text = input.value;
    error.textContent = '';
    button.disabled = true;
    try {
        await postApi('/api/chat/' + encodeURIComponent(roomId) + '/message', { text });
        if (roomId === webChatRoomId && generation === webChatGeneration && input.value === text) {
            input.value = '';
            input.style.height = '';
        }
    } catch (e) {
        if (roomId === webChatRoomId && generation === webChatGeneration) error.textContent = e.message;
    } finally {
        button.disabled = false;
    }
}

const webChatInput = $('#webChatInput');
if (webChatInput) {
    webChatInput.addEventListener('input', () => {
        webChatInput.style.height = '';
        webChatInput.style.height = Math.min(webChatInput.scrollHeight, 120) + 'px';
    });
    webChatInput.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            sendWebChatMessage();
        }
    });
}
const webChatMessageList = $('#webChatMessages');
if (webChatMessageList) webChatMessageList.addEventListener('scroll', () => { webChatPinnedBottom = webChatNearBottom(); });
function updateWebChatViewport() {
    const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--webchat-vh', Math.round(height) + 'px');
    if (webChatPinnedBottom) requestAnimationFrame(scrollWebChatToBottom);
}
if (window.visualViewport) window.visualViewport.addEventListener('resize', updateWebChatViewport);
window.addEventListener('resize', updateWebChatViewport);
updateWebChatViewport();
const webChatSendButton = $('#webChatSend');
if (webChatSendButton) {
    webChatSendButton.addEventListener('pointerdown', event => {
        if (document.activeElement === webChatInput) event.preventDefault();
    });
    webChatSendButton.onclick = sendWebChatMessage;
}
if ($('#webChatBack')) $('#webChatBack').onclick = () => {
    closeWebChatStream();
    $('#webChatShell').classList.remove('room-open');
};
if ($('#webChatNewMessage')) $('#webChatNewMessage').onclick = scrollWebChatToBottom;
if ($('#webChatFullClose')) $('#webChatFullClose').onclick = closeWebChatFullMessage;
if ($('#webChatFullModal')) $('#webChatFullModal').onclick = event => {
    if (event.target === event.currentTarget) closeWebChatFullMessage();
};
document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#webChatFullModal').hidden) closeWebChatFullMessage();
});

async function loadHomeBanners() {
    const root = $('#homeBannerList');
    if (!root) return;
    root.replaceChildren(el('div', { class: 'home-banner-empty' }, '배너를 불러오는 중...'));
    try {
        const data = await api('/api/banners');
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
            root.replaceChildren(el('div', { class: 'home-banner-empty' }, '등록된 배너가 없습니다.'));
            return;
        }
        root.replaceChildren(...items.map((item, index) => {
            const image = el('img', { src: item.imageUrl, alt: '메인 배너 ' + (index + 1), loading: index === 0 ? 'eager' : 'lazy', decoding: 'async' });
            if (!item.targetTab) return el('div', { class: 'home-banner' }, image);
            const isCustomUrl = item.targetTab === 'custom-url' && item.targetUrl;
            const targetLabel = isCustomUrl ? '지정 링크' : (PAGE_LABELS[item.targetTab] || item.targetTab);
            return el('button', {
                class: 'home-banner clickable',
                type: 'button',
                title: targetLabel + '로 이동',
                'aria-label': '메인 배너 ' + (index + 1) + ', ' + targetLabel + '로 이동',
                onclick: () => isCustomUrl ? location.assign(item.targetUrl) : activatePage(item.targetTab)
            }, image);
        }));
    } catch (e) {
        root.replaceChildren(el('div', { class: 'home-banner-empty err' }, e.message));
    }
}

function cardNode(card, compact, onClick) {
    if (!card || !card.name) return el('div', { class: 'empty-card' }, '카드 없음');
    const props = { class: 'card-tile ' + (compact ? 'compact' : '') };
    if (typeof onClick === 'function') props.onclick = () => onClick(card);
    return el('div', props,
        card.imageUrl ? el('img', { src: card.imageUrl, alt: card.formatted }) : el('div', { class: 'no-img' }, card.name),
        card.specter ? el('span', { class: 'card-specter-badge', title: '스펙터 · ' + card.specter.name }, '★') : null,
        el('div', { class: 'card-name' }, card.formatted)
    );
}

function kv(label, value) {
    return el('div', { class: 'kv' }, el('span', null, label), el('b', null, value));
}

let currentStatGroups = [];

function renderStatCard() {
    const root = $('#stats');
    if (!root) return;
    const hideZero = $('#statHideZero') && $('#statHideZero').checked;
    const card = el('div', { class: 'stat-card' });
    (currentStatGroups || []).forEach(g => {
        const items = (g.items || []).filter(it => !hideZero || it.owned);
        if (!items.length) return;
        const grp = el('div', { class: 'stat-grp' }, el('div', { class: 'stat-grp-title' }, g.title));
        items.forEach(it => {
            const cls = !it.owned ? ' zero' : (it.tone === 'good' ? ' bonus' : (it.tone === 'bad' ? ' neg' : ''));
            grp.appendChild(el('div', { class: 'stat-line' },
                el('span', { class: 'stat-label' }, it.label),
                el('div', { class: 'stat-vblock' },
                    el('b', { class: 'stat-value' + cls }, it.value),
                    it.sub ? el('span', { class: 'stat-sub' }, it.sub) : null)
            ));
        });
        card.appendChild(grp);
    });
    root.replaceChildren(card.children.length ? card : el('div', { class: 'empty' }, '표시할 스탯이 없습니다.'));
}

if ($('#statHideZero')) $('#statHideZero').onchange = () => renderStatCard();

function goodsRow(iconUrl, name, value, subName, subValue) {
    const icon = iconUrl ? el('img', { class: 'goods-icon', src: iconUrl, alt: name }) : el('span', { class: 'goods-icon-fallback' }, '●');
    const vblock = el('div', { class: 'goods-vblock' }, el('b', { class: 'goods-value' }, value));
    if (subName != null) vblock.appendChild(el('div', { class: 'goods-sub' }, subName + ' ' + subValue));
    return el('div', { class: 'goods-row' }, icon, el('div', { class: 'goods-name' }, name), vblock);
}

function renderGoods(user, icons) {
    const root = $('#goods');
    if (!root) return;
    root.replaceChildren(el('div', { class: 'goods-card' },
        goodsRow(icons.gold, '골드', comma(user.gold)),
        goodsRow(icons.garnet, '가넷', comma(user.garnet)),
        goodsRow(icons.point, '포인트', comma(user.point), '마일리지', comma(user.mileage))
    ));
}

function renderStatPoint(sp) {
    const root = $('#statPointBody');
    if (!root) return;
    if (!sp) { root.replaceChildren(el('div', { class: 'empty' }, '스탯포인트 정보가 없습니다.')); return; }
    const canManage = !!myName && currentProfileName === myName;
    const goldAmount = (amount, className) => el('span', { class: className || 'sp-gold-amount' },
        sp.goldIconUrl ? el('img', { src: sp.goldIconUrl, alt: '골드' }) : el('span', { class: 'sp-gold-label' }, '골드'),
        el('b', null, comma(amount))
    );
    const summary = el('div', { class: 'sp-summary' },
        el('div', { class: 'sp-avail' }, el('span', null, '잔여 스탯포인트'), el('b', null, comma(sp.available))),
        el('div', { class: 'sp-summary-side' },
            canManage ? goldAmount(sp.gold, 'sp-owned-gold') : null,
            el('div', { class: 'sp-buy' },
                el('span', null, '누적 구매 ' + comma(sp.buyCount) + '/' + comma(sp.buyMax) + '회'),
                sp.nextPrice == null ? el('span', { class: 'sp-buy-complete' }, '구매 완료') : el('span', { class: 'sp-next-price' }, '다음 1개', goldAmount(sp.nextPrice))
            ),
            canManage ? el('button', { class: 'primary sp-purchase-btn', disabled: sp.nextPrice == null, onclick: () => openStatPointBuyModal(sp) }, '스탯포인트 구매') : null
        )
    );
    const list = el('div', { class: 'sp-list' });
    (sp.stats || []).forEach(s => {
        const pct = sp.perStatLimit > 0 ? Math.min(100, s.invested / sp.perStatLimit * 100) : 0;
        const bonus = '+' + comma(s.flat) + (s.plusPercent != null ? '  /  +' + s.plusPercent + '%' : '');
        const investMax = Math.max(0, Math.min(Number(sp.available || 0), Number(sp.perStatLimit || 0) - Number(s.invested || 0)));
        list.appendChild(el('div', { class: 'sp-row' + (canManage ? ' manageable' : '') },
            el('div', { class: 'sp-name' }, s.name),
            el('div', { class: 'sp-bar' }, el('div', { class: 'sp-bar-fill', style: 'width:' + pct + '%' })),
            el('div', { class: 'sp-count' }, comma(s.invested) + ' / ' + comma(sp.perStatLimit)),
            el('div', { class: 'sp-bonus' }, bonus),
            canManage ? el('button', { class: 'sp-invest-btn', disabled: investMax < 1, onclick: () => openStatPointInvestModal(sp, s) }, investMax < 1 && s.invested >= sp.perStatLimit ? '최대' : '투자') : null
        ));
    });
    const investedTotal = (sp.stats || []).reduce((sum, stat) => sum + Number(stat.invested || 0), 0);
    const reset = canManage && sp.resetItem ? el('div', { class: 'sp-reset' },
        el('div', { class: 'sp-reset-thumb' },
            sp.resetItem.frameUrl ? el('img', { class: 'sp-reset-frame', src: sp.resetItem.frameUrl, alt: '' }) : null,
            sp.resetItem.iconUrl ? el('img', { class: 'sp-reset-icon', src: sp.resetItem.iconUrl, alt: sp.resetItem.name }) : null
        ),
        el('div', { class: 'sp-reset-info' },
            el('b', null, '투자 초기화'),
            el('span', null, sp.resetItem.name + '  ·  보유 ' + comma(sp.resetItem.count) + '개'),
            el('small', null, '투자한 ' + comma(investedTotal) + '포인트를 모두 회수합니다.')
        ),
        el('button', { class: 'sp-reset-btn', disabled: investedTotal < 1 || Number(sp.resetItem.count || 0) < 1, onclick: () => resetStatPoints(sp, investedTotal) }, '초기화')
    ) : null;
    root.replaceChildren(summary, list, reset);
}

function statPointQtyControl(label, max, onChange) {
    let value = 1;
    const clamp = raw => Math.max(1, Math.min(Math.max(1, max), Math.floor(Number(raw) || 1)));
    const input = el('input', { type: 'number', class: 'shop-qty-input', value: '1', min: '1', max: String(Math.max(1, max)) });
    const set = raw => { value = clamp(raw); input.value = value; onChange(value); };
    input.oninput = () => set(input.value);
    return el('div', { class: 'shop-qty-row' },
        el('span', { class: 'shop-qty-label' }, label),
        el('button', { class: 'shop-qty-btn', onclick: () => set(value - 1) }, '−'),
        input,
        el('button', { class: 'shop-qty-btn', onclick: () => set(value + 1) }, '+'),
        el('span', { class: 'shop-qty-max' }, '최대 ' + comma(max))
    );
}

function openStatPointBuyModal(sp) {
    const prices = Array.isArray(sp.buyPrices) ? sp.buyPrices.map(Number) : [];
    let affordable = 0;
    let running = 0;
    for (const price of prices) {
        if (running + price > Number(sp.gold || 0)) break;
        running += price;
        affordable++;
    }
    const maxQty = Math.min(prices.length, affordable);
    let qty = 1;
    const content = el('div', { class: 'shop-buy-modal' });
    content.appendChild(el('div', { class: 'shop-buy-item-row' },
        el('div', { class: 'sp-buy-thumb' }, 'SP'),
        el('div', null,
            el('div', { class: 'shop-buy-name' }, '스탯포인트'),
            el('div', { class: 'shop-buy-meta' }, '구매 즉시 잔여 스탯포인트에 추가됩니다.')
        )
    ));
    const receipt = el('div', { class: 'shop-receipt' });
    const price = { goods: 'gold' };
    const update = value => {
        qty = value;
        const total = prices.slice(0, qty).reduce((sum, amount) => sum + amount, 0);
        receipt.replaceChildren(
            buildReceiptRow('현재 보유', price, sp.gold),
            buildReceiptRow('소모', price, total, 'deduct'),
            el('div', { class: 'shop-receipt-divider' }),
            buildReceiptRow('구매 후 잔액', price, Number(sp.gold || 0) - total, 'result')
        );
    };
    content.appendChild(statPointQtyControl('구매 수량', maxQty, update));
    content.appendChild(receipt);
    update(1);
    if (maxQty < 1) content.appendChild(el('div', { class: 'sp-modal-warning' }, prices.length ? '다음 스탯포인트를 구매할 골드가 부족합니다.' : '구매 가능한 스탯포인트를 모두 구매했습니다.'));
    const buyBtn = el('button', { class: 'primary', disabled: maxQty < 1, onclick: async () => {
        buyBtn.disabled = true;
        buyBtn.textContent = '처리 중...';
        try {
            const result = await postApi('/api/stat-points/buy', { count: qty });
            closeModal();
            if (result.profile) renderProfile(result.profile);
            await showAlert(comma(qty) + ' 스탯포인트를 구매했습니다.');
        } catch (e) {
            buyBtn.disabled = maxQty < 1;
            buyBtn.textContent = '구매';
            showAlert(e.message);
        }
    } }, '구매');
    content.appendChild(el('div', { class: 'shop-buy-footer' }, el('button', { onclick: closeModal }, '취소'), buyBtn));
    $('#modalTitle').textContent = '스탯포인트 구매';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

function openStatPointInvestModal(sp, stat) {
    const maxQty = Math.max(0, Math.min(Number(sp.available || 0), Number(sp.perStatLimit || 0) - Number(stat.invested || 0)));
    let qty = 1;
    const content = el('div', { class: 'shop-buy-modal' });
    content.appendChild(el('div', { class: 'sp-invest-modal-head' },
        el('span', null, stat.name),
        el('b', null, comma(stat.invested) + ' / ' + comma(sp.perStatLimit))
    ));
    const preview = el('div', { class: 'sp-invest-preview' });
    const update = value => {
        qty = value;
        preview.replaceChildren(
            el('span', null, '현재 ' + comma(stat.invested)),
            el('strong', null, '+' + comma(qty)),
            el('b', null, '투자 후 ' + comma(Number(stat.invested || 0) + qty))
        );
    };
    content.appendChild(statPointQtyControl('투자 수량', maxQty, update));
    content.appendChild(preview);
    update(1);
    const investBtn = el('button', { class: 'primary', disabled: maxQty < 1, onclick: async () => {
        investBtn.disabled = true;
        investBtn.textContent = '처리 중...';
        try {
            const result = await postApi('/api/stat-points/invest', { stat: stat.name, count: qty });
            closeModal();
            if (result.profile) renderProfile(result.profile);
            await showAlert(stat.name + '에 ' + comma(qty) + '포인트를 투자했습니다.');
        } catch (e) {
            investBtn.disabled = false;
            investBtn.textContent = '투자';
            showAlert(e.message);
        }
    } }, '투자');
    content.appendChild(el('div', { class: 'shop-buy-footer' }, el('button', { onclick: closeModal }, '취소'), investBtn));
    $('#modalTitle').textContent = stat.name + ' 투자';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

async function resetStatPoints(sp, investedTotal) {
    if (!sp.resetItem || Number(sp.resetItem.count || 0) < 1) {
        showAlert('초기화하려면 순백의 결정이 필요합니다.');
        return;
    }
    const confirmed = await showConfirm('순백의 결정 1개를 사용해 투자한 ' + comma(investedTotal) + '포인트를 모두 회수할까요?', '초기화');
    if (!confirmed) return;
    try {
        const result = await postApi('/api/stat-points/reset', {});
        if (result.profile) renderProfile(result.profile);
        showAlert('스탯포인트를 초기화했습니다.');
    } catch (e) {
        showAlert(e.message);
    }
}

$$('.pf-tab').forEach(btn => btn.onclick = () => {
    const tab = btn.dataset.pftab;
    $$('.pf-tab').forEach(b => b.classList.toggle('active', b === btn));
    $$('.pf-panel').forEach(p => p.classList.toggle('active', p.dataset.pfpanel === tab));
});

function textLines(text) {
    return String(text || '').split('\n').filter(line => line && line.indexOf('\u200e') === -1);
}

const RARITY_COLORS = { '일반': '#64748b', '고급': '#64748b', '레어': '#86efac', '희귀': '#86efac', '유니크': '#a855f7', '영웅': '#a855f7', '레전더리': '#facc15', '전설': '#facc15', '초월': '#ef4444', '초월 1단계': '#ef4444', '초월 2단계': '#ef4444', '초월 3단계': '#ef4444', '신화': '#a78bfa', '고유': '#ec4899' };
const SLOT_ICONS = { 'weapon': '⚔️', 'hat': '🎩', 'armor': '🛡️', 'pants': '👖', 'shoes': '👢', 'accessory': '💍', 'support': '🔧', 'orb': '🔮' };
const ITEM_TYPE_ORDER = ['이벤트', '가챠', '번들', '사용', '소모품', '티켓', '미끼', '재료'];
const EQUIP_TYPE_ORDER = [['weapon', '무기'], ['hat', '모자'], ['armor', '갑옷'], ['pants', '하의'], ['shoes', '신발'], ['accessory', '장신구'], ['support', '보조']];

function rarityTag(rarity) {
    return el('span', { class: 'tag rarity' + (rarity === '신화' ? ' rarity-mythic' : '') }, rarity);
}

function applyRarityCardClass(node, rarity) {
    if (rarity === '신화') node.classList.add('rarity-mythic-card');
    return node;
}

function equipmentThumb(eq) {
    const wrap = el('div', { class: 'equip-thumb' });
    if (eq.frameUrl) wrap.appendChild(el('img', { src: eq.frameUrl, class: 'frame', alt: '' }));
    if (eq.iconUrl) wrap.appendChild(el('img', { src: eq.iconUrl, class: 'icon', alt: '' }));
    else wrap.appendChild(el('span', { class: 'icon-fallback' }, SLOT_ICONS[eq.type] || '🎒'));
    return wrap;
}

function petCardThumb(pet) {
    const wrap = el('div', { class: 'equip-thumb' + (pet.expired ? ' pet-expired' : '') });
    if (pet.frameUrl) wrap.appendChild(el('img', { src: pet.frameUrl, class: 'frame', alt: '' }));
    if (pet.iconUrl) wrap.appendChild(el('img', { src: pet.iconUrl, class: 'icon', alt: '' }));
    else wrap.appendChild(el('span', { class: 'icon-fallback' }, '🐾'));
    return wrap;
}

function profilePetTile(pet) {
    return el('button', { class: 'pf-pet-tile' + (pet.expired ? ' expired' : ''), type: 'button', onclick: () => openPetModal(pet) },
        petCardThumb(pet),
        el('div', { class: 'pf-pet-tile-name' }, pet.name)
    );
}

function petCard(pet) {
    const color = RARITY_COLORS[pet.rarity] || '#334155';
    const expText = pet.expired ? '만료됨' : (pet.expiryText || '');
    const card = el('div', { class: 'equip-card', onclick: () => openPetModal(pet) },
        petCardThumb(pet),
        el('div', null,
            el('div', { class: 'equip-name' }, pet.name),
            el('div', { class: 'equip-meta' },
                rarityTag(pet.rarity),
                pet.equipped ? el('span', { class: 'tag on' }, '장착') : null,
                expText ? el('span', { class: 'tag' }, expText) : null
            )
        ),
        pet.level > 0 ? el('span', { class: 'level' }, '+' + pet.level) : el('span')
    );
    card.style.setProperty('--rar', color);
    applyRarityCardClass(card, pet.rarity);
    return card;
}

function openPetModal(pet) {
    const title = pet.name + (pet.level > 0 ? ' +' + pet.level : '');
    const expText = pet.expired ? '만료됨' : (pet.expiryText || '');
    const sub = pet.rarity + ' · 펫' + (expText ? ' · ' + expText : '');
    openModal(title, sub, pet.statLines || []);
    const thumb = petCardThumb(pet);
    thumb.classList.add('modal-equip-thumb');
    $('#modalBody').prepend(thumb);
    if (pet.specialLines && pet.specialLines.length) {
        $('#modalBody').appendChild(el('div', { class: 'pet-special-title' }, '특수 효과'));
        pet.specialLines.forEach(line => $('#modalBody').appendChild(el('div', { class: 'stat-line' }, line)));
    }
    const se = pet.setEffect;
    if (se && Array.isArray(se.tiers) && se.tiers.length) {
        $('#modalBody').appendChild(el('div', { class: 'pet-set-block' },
            el('div', { class: 'pet-set-title' }, '세트 효과 · ' + se.name + ' (' + se.count + '/' + se.total + ')'),
            ...se.tiers.map(tier => el('div', { class: 'pet-set-tier' },
                el('span', { class: 'pet-set-tier-label' }, tier.tier + '세트'),
                el('div', { class: 'pet-set-tier-lines' }, ...tier.lines.map(line => el('div', null, line)))
            ))
        ));
    }
}

function equipmentCard(eq) {
    const color = RARITY_COLORS[eq.rarity] || '#334155';
    const card = el('div', { class: 'equip-card', onclick: () => openEquipmentModal(eq) },
        equipmentThumb(eq),
        el('div', null,
            el('div', { class: 'equip-name' }, eq.name),
            el('div', { class: 'equip-meta' },
                rarityTag(eq.rarity),
                eq.equipped ? el('span', { class: 'tag on' }, '장착') : null
            )
        ),
        eq.level > 0 ? el('span', { class: 'level' }, '+' + eq.level) : el('span')
    );
    card.style.setProperty('--rar', color);
    applyRarityCardClass(card, eq.rarity);
    return card;
}

function pageIsActive(name) {
    const page = document.querySelector('.page[data-page="' + name + '"]');
    return !!(page && page.classList.contains('active'));
}

function gearSlotNode(typeKey, label, eq) {
    const pos = el('div', { class: 'gear-slot-pos' }, label);
    if (!eq) {
        const own = !!myName && currentProfileName === myName;
        const thumb = el('div', { class: 'equip-thumb gear-empty-thumb' }, own ? el('span', { class: 'gear-add' }, '+') : null);
        const node = el('div', { class: 'gear-slot empty' + (own ? ' own' : '') }, pos, thumb,
            el('div', { class: 'gear-slot-info' }, el('div', { class: 'gear-slot-empty' }, '미장착')),
            el('span', { class: 'gear-slot-lv' }));
        if (own) node.onclick = () => openEquipPicker(typeKey, label);
        return node;
    }
    const node = el('div', { class: 'gear-slot filled', onclick: () => openEquipmentModal(eq) },
        pos, equipmentThumb(eq),
        el('div', { class: 'gear-slot-info' },
            el('div', { class: 'gear-slot-name' }, eq.name),
            el('div', { class: 'equip-meta' }, rarityTag(eq.rarity))
        ),
        eq.level > 0 ? el('span', { class: 'gear-slot-lv' }, '+' + eq.level) : el('span', { class: 'gear-slot-lv' })
    );
    node.style.setProperty('--rar', RARITY_COLORS[eq.rarity] || '#334155');
    applyRarityCardClass(node, eq.rarity);
    return node;
}

function renderGearSlots(data) {
    const root = $('#equippedGear');
    if (!root) return;
    const byType = { weapon: null, hat: null, armor: null, pants: null, shoes: null, support: null };
    const accessories = [];
    (data.equippedEquipment || []).forEach(e => {
        if (e.type === 'accessory') accessories.push(e);
        else if (e.type in byType) byType[e.type] = e;
    });
    const maxAcc = Math.max(1, Number(data.user.maxAccessory || 3));
    const nodes = [
        gearSlotNode('weapon', '무기', byType.weapon), gearSlotNode('hat', '모자', byType.hat),
        gearSlotNode('armor', '갑옷', byType.armor), gearSlotNode('pants', '하의', byType.pants),
        gearSlotNode('shoes', '신발', byType.shoes)
    ];
    for (let i = 0; i < maxAcc; i++) nodes.push(gearSlotNode('accessory', maxAcc > 1 ? '장신구 ' + (i + 1) : '장신구', accessories[i] || null));
    nodes.push(gearSlotNode('support', '보조', byType.support));
    root.replaceChildren(...nodes);
}

let modalRequestToken = 0;
let activeItemUsePending = false;
let cancellingItemUse = false;

function setModalVariant(variant) {
    const modal = $('#modalBg .modal');
    if (!modal) return;
    modal.classList.toggle('item-detail-modal', variant === 'item-detail');
    modal.classList.toggle('dex-equipment-modal', variant === 'dex-equipment');
    modal.classList.toggle('preset-detail-modal', variant === 'preset-detail');
}

function openModal(title, sub, lines) {
    modalRequestToken++;
    setModalVariant();
    $('#modalTitle').textContent = title;
    $('#modalSub').textContent = sub || '';
    $('#modalSub').style.display = sub ? '' : 'none';
    $('#modalBody').replaceChildren(...(lines.length ? lines.map(line => el('div', { class: 'stat-line' }, line)) : [el('div', { class: 'empty' }, '표시할 정보가 없습니다.')]));
    $('#modalBg').classList.add('active');
}

function finishCloseModal() {
    modalRequestToken++;
    $('#modalBg').classList.remove('active');
    setModalVariant();
}

async function closeModal() {
    if (activeItemUsePending && !cancellingItemUse) {
        cancellingItemUse = true;
        try {
            await postApi('/api/inventory/item-use/cancel');
            loadInventory('items').catch(() => {});
        } catch (error) {
            showAlert(error.message);
            cancellingItemUse = false;
            return;
        }
        activeItemUsePending = false;
        cancellingItemUse = false;
    }
    finishCloseModal();
}

function openRichModal(title, sub, nodes) {
    modalRequestToken++;
    setModalVariant();
    $('#modalTitle').textContent = title;
    $('#modalSub').textContent = sub || '';
    $('#modalSub').style.display = sub ? '' : 'none';
    $('#modalBody').replaceChildren(el('div', { class: 'mc-body' }, ...nodes));
    $('#modalBg').classList.add('active');
}

function cardSectionNode(label) {
    return el('div', { class: 'mc-section' },
        el('span', { class: 'mc-section-line' }),
        el('span', { class: 'mc-section-label' }, label),
        el('span', { class: 'mc-section-line' })
    );
}

function skillPanelNode(skill) {
    return el('div', { class: 'mc-panel skill' },
        el('div', { class: 'mc-head' },
            el('span', { class: 'mc-name' }, skill.name),
            el('div', { class: 'mc-chips' },
                el('span', { class: 'mc-chip mp' }, 'MP ' + comma(skill.mpCost)),
                el('span', { class: 'mc-chip cd' }, '⏱ ' + skill.cooltimeText)
            )
        ),
        el('div', { class: 'mc-desc' }, ...(skill.descLines || []).map(d => el('span', null, d)))
    );
}

function slotEffectPanelNode(eff) {
    const valText = eff.active ? eff.currentText : eff.baseText;
    const perLevel = Number(String(eff.perLevelText || '').replace(/[^0-9.]/g, '')) > 0;
    return el('div', { class: 'mc-panel slot' + (eff.active ? '' : ' locked') },
        el('div', { class: 'mc-head' },
            el('span', { class: 'mc-name' }, eff.name),
            el('div', { class: 'mc-chips' }, el('span', { class: 'mc-chip val' }, valText))
        ),
        el('div', { class: 'mc-note' + (eff.active ? '' : ' warn') },
            (eff.active ? '현재 ' + eff.currentStarText + ' 기준' : '⚠️ ' + eff.requireStarText + ' 이상부터 적용 (' + eff.requireStarText + ' 기준값)')
            + (eff.valuesText ? ' · ' + eff.valuesText : (perLevel ? ' · 등급마다 +' + eff.perLevelText : ''))
        )
    );
}

function mainCardDetailNodes(card) {
    const isJob = card && card.type === '전직';
    const nodes = [];
    if (card && Array.isArray(card.skills) && card.skills.length > 0) {
        card.skills.forEach(skill => nodes.push(skillPanelNode(skill)));
    }
    // 전직 카드만 전직 스킬을 추가로 사용 (일반 스킬 + 전직 스킬 둘 다)
    if (isJob && card.classInfo && Array.isArray(card.classInfo.skills) && card.classInfo.skills.length > 0) {
        nodes.push(cardSectionNode('전직'));
        card.classInfo.skills.forEach(skill => nodes.push(skillPanelNode(skill)));
    }
    if (card && card.specter) {
        nodes.push(cardSectionNode('스펙터 · ' + card.specter.name));
        if (card.specter.skill) nodes.push(skillPanelNode(card.specter.skill));
    }
    if (!nodes.length) nodes.push(el('div', { class: 'mc-empty' }, '표시할 스킬이 없습니다.'));
    return nodes;
}

// ===== 아바타 (카드 모달 내 해금 아바타 장착/해제) =====
// avatarRef: { source: 'main' | 'slot' | 'inv', number? } — 본인 카드에만 전달된다.

async function appendAvatarSection(avatarRef) {
    const wrap = el('div', { class: 'avatar-section' });
    $('#modalBody').appendChild(wrap);
    wrap.appendChild(el('div', { class: 'loading' }, '아바타 불러오는 중...'));
    let data;
    try {
        data = await api('/api/cards/avatars?source=' + encodeURIComponent(avatarRef.source) + (avatarRef.number ? '&number=' + avatarRef.number : ''));
    } catch (e) {
        wrap.replaceChildren();
        return;
    }
    const avatars = data.avatars || [];
    if (!avatars.length) { wrap.replaceChildren(); return; }
    const grid = el('div', { class: 'avatar-grid' });
    avatars.forEach(av => {
        const tile = el('div', {
            class: 'avatar-tile' + (av.equipped ? ' equipped' : '') + (!av.unlocked ? ' locked' : ''),
            title: (av.statLines || []).join('\n'),
            onclick: () => openAvatarDetailModal(av, avatarRef)
        },
            el('div', { class: 'avatar-tile-thumb' },
                av.imageUrl ? el('img', { src: av.imageUrl, alt: av.name }) : el('span', { class: 'avatar-tile-fallback' }, '?'),
                !av.unlocked ? el('span', { class: 'avatar-tile-lock' }, '🔒') : null,
                av.equipped ? el('span', { class: 'avatar-tile-on' }, '장착 중') : null,
                av.statApplied ? el('span', { class: 'avatar-tile-stat' }, '능력치') : null
            ),
            el('div', { class: 'avatar-tile-name' }, av.name),
            el('div', { class: 'avatar-tile-meta' + (av.grade === '한정' ? ' limited' : av.grade === '프레스티지' ? ' prestige' : '') },
                av.grade + (av.unlocked && !av.starOk ? ' · ' + av.requireStarText + ' 필요' : ''))
        );
        grid.appendChild(tile);
    });
    wrap.replaceChildren(cardSectionNode('아바타'), grid,
        el('div', { class: 'avatar-hint' }, '아바타를 누르면 상세 정보와 장착/해제 버튼이 표시됩니다.'));
}

// 아바타 타일 클릭 → 이중 모달: 미리보기 + 스탯 + 장착/해제 버튼
function openAvatarDetailModal(av, avatarRef) {
    const nodes = [];
    if (av.imageUrl) nodes.push(el('div', { class: 'avatar-detail-preview' }, el('img', { src: av.imageUrl, alt: av.name })));
    const statBox = el('div', { class: 'avatar-detail-stats' });
    const statLines = av.statLines || [];
    if (statLines.length) statLines.forEach(line => statBox.appendChild(el('div', { class: 'avatar-detail-stat' }, line)));
    else statBox.appendChild(el('div', { class: 'avatar-detail-stat none' }, '추가 스탯 없음'));
    if (Number(av.requireStar || 0) > 0) statBox.appendChild(el('div', { class: 'avatar-detail-stat cond' }, '장착 조건: ' + av.requireStarText + ' 이상'));
    nodes.push(statBox);
    nodes.push(el('div', { class: 'avatar-hint' }, '아바타 스탯은 메인카드에 장착했을 때만 적용됩니다.'));
    if (!av.unlocked) {
        if (av.shop && av.shop.price) {
            const p = av.shop.price;
            const priceLabel = p.goods === 'item'
                ? (p.name || '아이템') + ' ×' + comma(Number(p.amount || 0))
                : comma(Number(p.amount || 0)) + (p.goods === 'point' ? 'P' : p.goods === 'gold' ? ' 골드' : p.goods === 'garnet' ? ' 가넷' : p.goods === 'mileage' ? ' 마일리지' : '');
            const buyBtn = el('button', {
                class: 'primary',
                style: 'width:100%',
                disabled: !!av.shop.soldOut,
                onclick: async e => {
                    const button = e.currentTarget;
                    button.disabled = true;
                    try {
                        // 클릭 시점의 최신 상점 데이터로 재검증 (가격·품절·판매 여부 실시간 반영)
                        const data = await api('/api/shop');
                        shopData = data;
                        const shopItem = (data.shop[av.shop.shopType] || []).find(it => it.type === '아바타' && it.fashion === av.name);
                        if (!shopItem) throw new Error('현재 판매하지 않는 상품입니다.');
                        if (shopItem.owned) throw new Error('이미 보유한 아바타입니다.');
                        if (shopItem.soldOut) throw new Error('품절된 상품입니다.');
                        shopTab = av.shop.shopType;
                        closePresetNestedModal();
                        openShopBuyModal(shopItem);
                    } catch (err) {
                        showAlert(err.message);
                        button.disabled = false;
                    }
                }
            }, av.shop.soldOut ? '품절 (' + priceLabel + ')' : '구매 (' + priceLabel + ')');
            nodes.push(el('div', { class: 'row', style: 'margin-top:10px' }, buyBtn));
            if (av.shop.shopType && av.shop.shopType !== '아바타') {
                nodes.push(el('div', { class: 'avatar-hint' }, av.shop.shopType + ' 상점에서 판매 중입니다.'));
            }
        } else {
            nodes.push(el('div', { class: 'avatar-detail-note' }, '미보유'));
        }
    } else if (!av.equipped && !av.starOk) {
        nodes.push(el('div', { class: 'avatar-detail-note' }, '⚠️ ' + av.requireStarText + ' 이상 카드에만 장착할 수 있습니다.'));
    } else {
        const sendAvatarAction = async (button, body) => {
            button.disabled = true;
            try {
                const res = await postApi('/api/cards/avatar', Object.assign({ source: avatarRef.source, number: avatarRef.number }, body));
                closePresetNestedModal();
                closeModal();
                if (res.profile) renderProfile(res.profile);
                if (pageIsActive('inventory')) await loadInventory('cards');
            } catch (err) {
                showAlert(err.message);
                button.disabled = false;
            }
        };
        const buttons = [];
        if (av.equipped) {
            buttons.push(el('button', { style: 'flex:1', onclick: e => sendAvatarAction(e.currentTarget, { name: '' }) }, '해제'));
        } else {
            buttons.push(el('button', { class: 'primary', style: 'flex:1', onclick: e => sendAvatarAction(e.currentTarget, { name: av.name }) }, '장착'));
            buttons.push(av.statApplied
                ? el('button', { style: 'flex:1', onclick: e => sendAvatarAction(e.currentTarget, { name: '', statsOnly: true }) }, '능력치 적용 해제')
                : el('button', { style: 'flex:1', onclick: e => sendAvatarAction(e.currentTarget, { name: av.name, statsOnly: true }) }, '능력치만 적용'));
        }
        nodes.push(el('div', { class: 'row', style: 'margin-top:10px;display:flex;gap:8px' }, ...buttons));
        if (!av.equipped) {
            nodes.push(el('div', { class: 'avatar-hint' }, '능력치만 적용: 외형은 현재 장착 중인 아바타를 유지하고, 능력치만 이 아바타로 적용됩니다.'));
        }
    }
    openPresetNestedModal(av.name, '아바타 · ' + av.grade + (av.equipped ? ' · 장착 중' : (av.unlocked ? (av.statApplied ? ' · 능력치 적용 중' : '') : ' · 미보유')), nodes, 'avatar');
}

function openMainCardModal(card, avatarRef) {
    const nodes = mainCardDetailNodes(card);
    openRichModal(card && card.formatted ? card.formatted : '메인 캐릭터 카드', card && card.starText ? card.starText + ' · 스킬' : '스킬', nodes);
    if (avatarRef) appendAvatarSection(avatarRef);
}

function cardSlotDetailNodes(card) {
    const isJob = card && card.type === '전직';
    const nodes = [];
    // 전직 카드는 전직 슬롯 효과만, 일반 카드는 일반 슬롯 효과만 적용
    if (isJob) {
        if (card.classInfo && Array.isArray(card.classInfo.slotEffects)) {
            card.classInfo.slotEffects.forEach(se => nodes.push(slotEffectPanelNode(se)));
        }
    } else if (card.slotEffect) {
        nodes.push(slotEffectPanelNode(card.slotEffect));
    }
    if (!nodes.length) nodes.push(el('div', { class: 'mc-empty' }, '슬롯 효과가 없습니다.'));
    return nodes;
}

function openCardSlotModal(card, slotNumber) {
    const nodes = cardSlotDetailNodes(card);
    openRichModal(card.formatted, (card.starText || '') + ' · 카드 슬롯 효과', nodes);
    if (Number(slotNumber || 0) > 0 && myName && currentProfileName === myName) {
        appendAvatarSection({ source: 'slot', number: slotNumber });
        const row = el('div', { class: 'row modal-action-row' });
        row.appendChild(el('button', { class: 'modal-action-button remove', onclick: e => handleCardAction('slot/remove', { slot: slotNumber }, e) }, '슬롯에서 제거'));
        row.appendChild(el('button', { class: 'modal-action-button change', onclick: () => openCardSlotPicker(slotNumber, card) }, '변경'));
        $('#modalBody').appendChild(row);
    }
}

function emptyCardSlotNode() {
    return el('div', { class: 'card-tile compact slot-addable', onclick: () => openCardSlotPicker(null, null) },
        el('div', { class: 'empty-card slot-add' },
            el('span', { class: 'slot-add-plus' }, '+'),
            el('span', { class: 'slot-add-label' }, '카드 장착')
        )
    );
}

// 슬롯 장착 가능한 인벤토리 카드 선택. replaceSlot이 있으면 해당 슬롯의 카드를 제거 후 장착(변경).
async function openCardSlotPicker(replaceSlot, replacingCard) {
    $('#modalTitle').textContent = replaceSlot ? '슬롯 카드 변경' : '슬롯 카드 장착';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    $('#modalBg').classList.add('active');
    try {
        const data = await api('/api/inventory/cards');
        // 서버 규칙 선반영: 5성 이상 + 메인/다른 슬롯과 같은 캐릭터·타입 제외 (타입이 다르면 같은 캐릭터도 허용, 변경 대상 슬롯의 카드는 허용)
        const cardKey = c => Number(c.id) + ':' + (c.type || '일반');
        const usedKeys = new Set();
        if (lastProfileData) {
            if (lastProfileData.mainCard) usedKeys.add(cardKey(lastProfileData.mainCard));
            (lastProfileData.cardSlots || []).forEach(c => { if (c && c.name) usedKeys.add(cardKey(c)); });
        }
        if (replacingCard) usedKeys.delete(cardKey(replacingCard));
        const cards = (data.cards || []).filter(c => c && Number(c.number || 0) > 0 && Number(c.star || 0) >= 4 && !usedKeys.has(cardKey(c)));
        if (!cards.length) {
            $('#modalBody').replaceChildren(el('div', { class: 'empty' }, '슬롯에 장착할 수 있는 카드가 없습니다.\n(5성 이상, 메인/슬롯과 같은 캐릭터·타입 제외)'));
            return;
        }
        $('#modalBody').replaceChildren(el('div', { class: 'card-grid eqm-card-pick' },
            ...cards.map(card => cardNode(card, true, async c => {
                try {
                    if (replaceSlot) await postApi('/api/cards/slot/remove', { slot: replaceSlot });
                    const res = await postApi('/api/cards/slot/equip', { number: c.number });
                    closeModal();
                    if (res.profile) renderProfile(res.profile);
                    if (pageIsActive('inventory')) await loadInventory('cards');
                } catch (e) {
                    showAlert(e.message);
                    try { renderProfile(await api('/api/profile')); } catch (_) {}
                }
            }))
        ));
    } catch (e) {
        $('#modalBody').replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

function openInventoryCardModal(card) {
    const ownInventory = !currentInventoryName || !myName || currentInventoryName === myName;
    openMainCardModal(card, ownInventory && Number(card.number || 0) ? { source: 'inv', number: Number(card.number) } : null);
    if (!ownInventory || !Number(card.number || 0)) return;
    const row = el('div', { class: 'row' });
    row.appendChild(el('button', { class: 'primary', onclick: e => handleCardAction('equip-main', { number: card.number }, e) }, '메인카드 장착'));
    row.appendChild(el('button', { onclick: e => handleCardAction('slot/equip', { number: card.number }, e) }, '슬롯 장착'));
    $('#modalBody').appendChild(row);
}

async function handleCardAction(action, body, event) {
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/cards/' + action, body);
        closeModal();
        if (data.profile) renderProfile(data.profile);
        if (pageIsActive('inventory')) await loadInventory('cards');
    } catch (e) {
        showAlert(e.message);
        if (btn) btn.disabled = false;
    }
}

const POTENTIAL_TIER_COLORS = { rare: '#ffffff', epic: '#86efac', unique: '#c084fc', legendary: '#fbbf24' };

function potentialBlockNode(display) {
    if (!display || !Array.isArray(display.entries) || display.entries.length == 0) return null;
    const color = POTENTIAL_TIER_COLORS[display.tierKey] || '#94a3b8';
    const block = el('div', { class: 'pot-block' },
        el('div', { class: 'pot-title' },
            el('span', null, '잠재능력'),
            el('span', { class: 'pot-tier-label' }, display.tierLabel || '')
        ),
        ...display.entries.map(entry => el('div', { class: 'pot-row' },
            el('span', { class: 'pot-grade ' + (entry.grade || 'bronze') }, entry.gradeLabel || ''),
            el('span', { class: 'pot-text' }, entry.text || '')
        ))
    );
    block.style.setProperty('--pot-tier', color);
    return block;
}

function formatSoulRemaining(expiredAt) {
    const diff = Number(expiredAt || 0) - Date.now();
    if (diff <= 0) return null;
    if (diff >= 86400000) return '영혼이 ' + Math.floor(diff / 86400000) + '일 후 빠져나갑니다.';
    if (diff >= 3600000) return '영혼이 ' + Math.floor(diff / 3600000) + '시간 후 빠져나갑니다.';
    if (diff >= 60000) return '영혼이 ' + Math.floor(diff / 60000) + '분 후 빠져나갑니다.';
    if (diff >= 1000) return '영혼이 ' + Math.floor(diff / 1000) + '초 후 빠져나갑니다.';
    return null;
}

function equipmentOrbInfo(eq) {
    const statLines = (eq && eq.statLines || []).map(line => String(line).replace(/^-\s*/, ''));
    let orb = eq && eq.orb;
    let lines = (eq && eq.orbLines || []).map(line => String(line).replace(/^-\s*/, ''));
    if (!orb) {
        const start = statLines.findIndex(line => /^\[\s*보주\s*\]/.test(line));
        if (start < 0) return null;
        const endOffset = statLines.slice(start + 1).findIndex(line => /^(고유 옵션:|설명:|세트 효과|\d+세트:)/.test(line));
        lines = statLines.slice(start, endOffset < 0 ? statLines.length : start + 1 + endOffset);
        const effectText = lines.slice(1).join(' ');
        const elementMatch = effectText.match(/\[([화수암명])\]속성/);
        orb = { name: statLines[start].replace(/^\[\s*보주\s*\]\s*/, ''), element: elementMatch && elementMatch[1] };
    }
    return { orb, lines };
}

function equipmentOrbNode(info) {
    if (!info) return null;
    const orb = info.orb;
    const name = String(orb.name || '보주');
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = ((hash * 31) + name.charCodeAt(i)) >>> 0;
    const keys = Object.keys(orb.stat || {}).concat(Object.keys(orb.plusStat || {}));
    const elementPalette = { '화': [8, 42], '수': [191, 224], '암': [267, 322], '명': [46, 184] };
    const palette = elementPalette[orb.element] || [hash % 360, (hash % 360 + 54 + hash % 48) % 360];
    let kind = 'mystic', kindLabel = '신비 효과';
    if (orb.element) { kind = 'element'; kindLabel = orb.element + '속성 부여'; }
    else if (keys.some(key => /hp|mp|Res|takenDamage|shield|recovery|potion|critDef|mpReduce/.test(key)) || info.lines.some(line => /HP|MP|저항|받는 피해|회복|보호막|포션|방어|소모/.test(line))) { kind = 'guard'; kindLabel = '수호 효과'; }
    else if (keys.some(key => /crit|pnt|avd|maxCmb|cooldown/.test(key)) || info.lines.some(line => /치명|가넷|회피|콤보|쿨타임/.test(line))) { kind = 'precision'; kindLabel = '정밀 효과'; }
    else if (keys.some(key => /atk|Damage/.test(key)) || info.lines.some(line => /공격력|데미지|피해/.test(line))) { kind = 'power'; kindLabel = '공격 효과'; }
    const details = info.lines.filter(line => line && !/^\[\s*보주\s*\]/.test(line));
    const imageUrl = '/item-image?dir=' + encodeURIComponent('보주') + '&file=' + encodeURIComponent(name + '.png');
    const node = el('div', { class: 'eqm-orb-card orb-' + kind + ' orb-v' + (hash % 4) },
        el('div', { class: 'eqm-orb-visual', 'aria-hidden': 'true' },
            el('span', { class: 'eqm-orb-ring' }),
            el('span', { class: 'eqm-orb-image' }, el('img', { src: imageUrl, alt: '' }))),
        el('div', { class: 'eqm-orb-copy' },
            el('div', { class: 'eqm-orb-kicker' }, '장착 보주 · ' + kindLabel),
            el('div', { class: 'eqm-orb-name' }, name),
            el('div', { class: 'eqm-orb-effects' }, ...details.map(line => el('span', null, line)))
        )
    );
    node.style.setProperty('--orb-h', palette[0]);
    node.style.setProperty('--orb-h2', palette[1]);
    node.style.setProperty('--orb-tilt', ((hash % 19) - 9) + 'deg');
    return node;
}

function comparableEquipmentText(text) {
    return String(text || '').replace(/\s+/g, '').replace(/[.!?。·]/g, '').toLowerCase();
}

function equipmentDescriptionNode(text) {
    if (!text) return null;
    return el('div', { class: 'eqm-description' }, el('div', { class: 'eqm-description-text' }, text));
}

function equipmentPassiveNode(passive) {
    if (!passive) return null;
    const cooldown = Number(passive.cooltime || 0);
    let cooldownText = cooldown > 0 ? (cooldown % 60000 === 0 ? cooldown / 60000 + '분' : Math.round(cooldown / 1000) + '초') : '';
    let passiveDesc = String(passive.desc || '');
    const captureCooldown = text => {
        const match = String(text).match(/^쿨타임\s*(\d+(?:\.\d+)?)\s*(초|분)$/);
        if (!match) return false;
        if (!cooldownText) cooldownText = match[1] + match[2];
        return true;
    };
    passiveDesc = passiveDesc.replace(/\(([^()]*)\)/g, (full, inner) => {
        const remaining = inner.split(',').map(part => part.trim()).filter(part => !captureCooldown(part));
        return remaining.length === inner.split(',').length ? full : (remaining.length ? '(' + remaining.join(', ') + ')' : '');
    });
    passiveDesc = passiveDesc.replace(/(^|[.!?]\s*)쿨타임\s*(\d+(?:\.\d+)?)\s*(초|분)\s*[.!?]?/g, (full, prefix, value, unit) => {
        if (!cooldownText) cooldownText = value + unit;
        return prefix.trim();
    }).replace(/\s+([.!?])/g, '$1').replace(/([.!?]){2,}/g, '$1').trim();
    return el('div', { class: 'eqm-passive-card' },
        el('div', { class: 'eqm-passive-mark', 'aria-hidden': 'true' }, el('span', null, 'P')),
        el('div', { class: 'eqm-passive-copy' },
            el('div', { class: 'eqm-passive-head' },
                el('strong', { class: 'eqm-passive-name' }, passive.name || '패시브')),
            // 문장마다 줄을 나눠 긴 패시브 설명의 가독성을 높인다
            el('div', { class: 'eqm-passive-desc' }, ...passiveDesc.split(/(?<=[.!?])\s+/).filter(Boolean).map(sentence => el('div', null, sentence))),
            cooldownText ? el('div', { class: 'eqm-passive-meta' },
                el('span', null, '재사용 대기시간'), el('b', null, cooldownText)) : null
        )
    );
}

function equipmentSetNode(setInfo) {
    if (!setInfo) return null;
    const equippedCount = Number(setInfo.equippedCount || 0);
    const total = Number(setInfo.total || 0);
    const requiredCount = Number(setInfo.requiredCount || total);
    const progress = requiredCount > 0 ? Math.min(100, equippedCount / requiredCount * 100) : 0;
    const statusLabel = { equipped: '장착 중', owned: '보유', missing: '미보유' };
    const components = (setInfo.components || []).map(item => {
        const thumb = equipmentThumb(item);
        return el('div', { class: 'eqm-set-item ' + (item.status || 'missing') },
            el('div', { class: 'eqm-set-item-visual' }, thumb,
                el('span', { class: 'eqm-set-item-status' }, statusLabel[item.status] || '미보유')),
            el('div', { class: 'eqm-set-item-name' }, item.name),
            el('div', { class: 'eqm-set-item-type' }, item.typeLabel)
        );
    });
    const tiers = (setInfo.tiers || []).map(tier => el('div', { class: 'eqm-set-tier ' + (tier.active ? 'active' : 'locked') },
        el('div', { class: 'eqm-set-tier-badge' }, tier.tier + ' SET'),
        el('div', { class: 'eqm-set-tier-copy' },
            el('div', { class: 'eqm-set-tier-state' }, tier.active ? '활성화' : '미활성'),
            el('div', { class: 'eqm-set-tier-desc' }, tier.description || '효과 없음'))
    ));
    return el('div', { class: 'eqm-set-view' },
        el('div', { class: 'eqm-set-summary' },
            el('div', { class: 'eqm-set-summary-top' },
                el('div', null, el('div', { class: 'eqm-set-eyebrow' }, 'SET COLLECTION'), el('div', { class: 'eqm-set-name' }, setInfo.name)),
                el('div', { class: 'eqm-set-count' }, el('b', null, equippedCount), el('span', null, ' / ' + requiredCount + ' 장착'))),
            el('div', { class: 'eqm-set-progress' }, el('span', { style: 'width:' + progress + '%' }))
        ),
        el('div', { class: 'eqm-set-section-title' }, '세트 구성 · ' + total + '종'),
        el('div', { class: 'eqm-set-items' }, ...components),
        el('div', { class: 'eqm-set-legend' },
            el('span', { class: 'equipped' }, '장착 중'), el('span', { class: 'owned' }, '보유'), el('span', { class: 'missing' }, '미보유')),
        el('div', { class: 'eqm-set-section-title' }, '세트 효과'),
        el('div', { class: 'eqm-set-tiers' }, ...tiers)
    );
}

function equipmentModalTabbedNodes(infoNodes, setInfo) {
    const infoButton = el('button', { class: 'eqm-tab active', type: 'button', role: 'tab', 'aria-selected': 'true' }, '장비 정보');
    const setButton = el('button', { class: 'eqm-tab', type: 'button', role: 'tab', 'aria-selected': 'false' }, '세트 효과');
    const infoPanel = el('div', { class: 'eqm-tab-panel active', role: 'tabpanel' }, ...infoNodes);
    const setPanel = el('div', { class: 'eqm-tab-panel', role: 'tabpanel' }, equipmentSetNode(setInfo));
    const select = showSet => {
        infoButton.classList.toggle('active', !showSet);
        setButton.classList.toggle('active', showSet);
        infoButton.setAttribute('aria-selected', String(!showSet));
        setButton.setAttribute('aria-selected', String(showSet));
        infoPanel.classList.toggle('active', !showSet);
        setPanel.classList.toggle('active', showSet);
    };
    infoButton.onclick = () => select(false);
    setButton.onclick = () => select(true);
    return [el('div', { class: 'eqm-tabs', role: 'tablist' }, infoButton, setButton), infoPanel, setPanel];
}

// 장비 조작 가능 여부: 인벤토리 페이지면 내 인벤토리일 때, 정보 페이지면 내 프로필일 때
function ownEquipContext() {
    if (pageIsActive('inventory')) return !currentInventoryName || !myName || currentInventoryName === myName;
    if (pageIsActive('info')) return !!myName && currentProfileName === myName;
    return false;
}

function equipmentModalView(eq, interactive) {
    const nodes = [];
    const thumb = equipmentThumb(eq);
    const hero = el('div', { class: 'eqm-hero' }, thumb,
        el('div', { class: 'eqm-hero-info' },
            el('div', { class: 'eqm-name' }, eq.name),
            el('div', { class: 'eqm-chips' },
                rarityTag(eq.rarity),
                el('span', { class: 'tag' }, eq.typeLabel),
                eq.level > 0 ? el('span', { class: 'tag eqm-lv' }, '+' + eq.level) : null,
                eq.equipped ? el('span', { class: 'tag on' }, '장착 중') : null
            )
        )
    );
    hero.style.setProperty('--rar', RARITY_COLORS[eq.rarity] || '#334155');
    const legacyDescriptionLine = (eq.statLines || []).map(line => String(line).replace(/^-\s*/, '')).find(line => /^(고유 옵션|설명):/.test(line));
    const description = eq.description || (legacyDescriptionLine ? legacyDescriptionLine.replace(/^(고유 옵션|설명):\s*/, '') : '');
    const orbInfo = equipmentOrbInfo(eq);
    const orbLineSet = new Set((orbInfo && orbInfo.lines || []).map(line => String(line).replace(/^-\s*/, '')));
    const lines = (eq.statLines || []).map(line => line.replace(/^-\s*/, '')).filter(line => !orbLineSet.has(line) && !/^(고유 옵션|설명):/.test(line) && !/^(세트 효과 ·|\d+세트:)/.test(line));
    const showDescription = description
        && !/^(초월|신화)/.test(String(eq.rarity || ''))
        && (!eq.passive || comparableEquipmentText(description) !== comparableEquipmentText(eq.passive.desc));
    if (showDescription) nodes.push(equipmentDescriptionNode(description));
    if (lines.length) {
        nodes.push(el('div', { class: 'eqm-label' }, '능력치'));
        nodes.push(el('div', { class: 'eqm-stats' }, ...lines.map(line => el('div', { class: 'eqm-stat' }, line))));
    }
    const orbBlock = equipmentOrbNode(orbInfo);
    if (orbBlock) nodes.push(orbBlock);
    // 초월/신화 장비는 요약형 패시브 문구 대신 수치가 있는 고유 옵션(desc)을 보여주고,
    // 초월 장비는 "(단계당 +x)" 표기를 현재 단계 수치로 환산해 표기한다 (도감 패시브 탭과 동일 규칙)
    let passiveForView = eq.passive;
    const advancedRarity = /^(초월|신화)/.test(String(eq.baseRarity || eq.rarity || ''));
    if (advancedRarity && description) {
        const stage = Number(eq.transcendStage || (String(eq.rarity || '').match(/초월\s*(\d)단계/) || [])[1] || 1);
        const stageText = /^초월/.test(String(eq.baseRarity || eq.rarity || '')) ? dexTranscendStageText(description, stage) : description;
        passiveForView = { name: (eq.passive && eq.passive.name) || eq.baseName || eq.name, desc: stageText, cooltime: eq.passive && eq.passive.cooltime };
    }
    const passiveBlock = equipmentPassiveNode(passiveForView);
    if (passiveBlock) nodes.push(passiveBlock);
    if (eq.soul) {
        const soulText = formatSoulRemaining(eq.soul.expiredAt);
        if (soulText) nodes.push(el('div', { class: 'eqm-soul' }, soulText));
    }
    const potBlock = potentialBlockNode(eq.potentialDisplay);
    if (potBlock) nodes.push(potBlock);
    if (interactive !== false && ownEquipContext() && Number(eq.number || 0) > 0) {
        const row = el('div', { class: 'row modal-action-row' });
        if (eq.equipped) {
            row.appendChild(el('button', { class: 'modal-action-button remove', onclick: e => handleEquipmentAction(eq, 'unequip', e) }, '장착 해제'));
            row.appendChild(el('button', { class: 'modal-action-button change', onclick: () => openEquipPicker(eq.type, eq.typeLabel, eq) }, '변경'));
        } else {
            row.appendChild(el('button', { class: 'modal-action-button equip', onclick: e => handleEquipmentAction(eq, 'equip', e) }, '장착'));
        }
        row.appendChild(el('button', { class: 'modal-action-button enhance', onclick: () => { closeModal(); openEnhanceModal(eq); } }, '강화'));
        nodes.push(row);
        if (eq.canPotential) {
            const potRow = el('div', { class: 'row modal-action-row potential' });
            if (eq.potential) {
                potRow.appendChild(el('button', { class: 'pot-reroll-open', onclick: () => { closeModal(); openRerollModal(eq); } }, '잠재능력 재설정'));
            } else {
                potRow.appendChild(el('button', { class: 'pot-awaken', onclick: e => awakenPotential(eq, e) }, '잠재능력 부여'));
            }
            nodes.push(potRow);
        }
    }
    return [hero, ...(eq.setInfo ? equipmentModalTabbedNodes(nodes, eq.setInfo) : nodes)];
}

function openEquipmentModal(eq) {
    modalRequestToken++;
    setModalVariant();
    $('#modalTitle').textContent = '';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(...equipmentModalView(eq, true));
    $('#modalBg').classList.add('active');
}

// 부위별 미장착 장비 선택 → 장착 (빈 슬롯/변경 공용).
// replaceEq: '변경'으로 진입 시 현재 장착 장비. 단일 슬롯은 서버가 자동 교체하지만
// 장신구는 빈 슬롯이 없으면 실패하므로 먼저 해제한다.
async function openEquipPicker(typeKey, label, replaceEq) {
    $('#modalTitle').textContent = label + ' 장착';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    $('#modalBg').classList.add('active');
    try {
        const data = await api('/api/inventory/equipment');
        const list = (data.equipment || []).filter(e => e.type === typeKey && !e.equipped);
        if (!list.length) {
            $('#modalBody').replaceChildren(el('div', { class: 'empty' }, '장착할 수 있는 ' + label + ' 장비가 없습니다.'));
            return;
        }
        $('#modalBody').replaceChildren(el('div', { class: 'eqm-pick-grid' }, ...list.map(eq => {
            const card = equipmentCard(eq);
            card.onclick = async e => {
                if (replaceEq && typeKey === 'accessory') {
                    try {
                        const r = await postApi('/api/inventory/equipment/unequip', { number: replaceEq.number });
                        if (r.profile) renderProfile(r.profile);
                    } catch (err) { showAlert(err.message); return; }
                }
                handleEquipmentAction(eq, 'equip', e);
            };
            return card;
        })));
    } catch (e) {
        $('#modalBody').replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

async function awakenPotential(eq, event) {
    if (!(await showConfirm('돋보기 1개를 소모하여 잠재능력을 부여하시겠습니까?'))) return;
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/potential/awaken', { number: eq.number });
        closeModal();
        if (data.profile) renderProfile(data.profile);
        if (pageIsActive('inventory')) await loadInventory('equipment');
    } catch (e) {
        showAlert(e.message);
        if (btn) btn.disabled = false;
    }
}

// ===== 잠재능력 재설정 모달 (강화 모달 스타일) =====
let potentialState = { eq: null, info: null, jewel: 'none', busy: false };

const JEWEL_META = {
    none:  { cls: 'none',     name: '쥬얼 미사용' },
    jewel: { cls: 'advanced', name: '쥬얼' },
    white: { cls: 'blessed',  name: '화이트 쥬얼' }
};

// 쥬얼 아이콘 노드 (none은 빈 표시, jewel/white는 실제 이미지)
function jewelIconNode(key) {
    const info = potentialState.info || {};
    const icons = info.jewelIcons || {};
    const url = key === 'jewel' ? icons.jewel : key === 'white' ? icons.white : null;
    if (url) return el('img', { class: 'jewel-icon-img', src: url, alt: '' });
    return el('span', { class: 'jewel-icon-none' }, '–');
}

// 모바일에서 스크롤 없이 화면에 맞도록 zoom으로 자동 축소 (reflow)
function potAvailHeight() {
    const vh = (window.visualViewport && window.visualViewport.height) || window.innerHeight;
    return vh * 0.92;
}
function potFitZoom(elem, reservedHeight = 0) {
    if (!elem) return { z: 1, natural: 0 };
    elem.style.zoom = '1';
    const natural = elem.scrollHeight;
    const avail = Math.max(0, potAvailHeight() - reservedHeight);
    const z = natural > avail ? avail / natural : 1;
    elem.style.zoom = String(z);
    return { z, natural };
}
function refitPotential() {
    const ov = $('#potentialOverlay');
    if (!ov || !ov.classList.contains('active')) return;
    const wrap = ov.querySelector('.enhance-wrap');
    if (!wrap) return;
    if ($('#potentialResultOverlay').classList.contains('active')) {
        const inner = $('#potentialResultOverlay').querySelector('.pot-result-inner');
        if (inner) {
            const resultPadding = 40;
            const { z, natural } = potFitZoom(inner, resultPadding);
            wrap.style.height = (natural * z + resultPadding) + 'px';
        }
    } else {
        wrap.style.height = '';
        potFitZoom($('#potentialContent'));
    }
}
window.addEventListener('resize', refitPotential);
if (window.visualViewport) window.visualViewport.addEventListener('resize', refitPotential);

function potEntriesNode(data, label, cls) {
    const tierKey = data && data.tierKey || 'rare';
    const block = el('div', { class: 'pot-block tier-' + tierKey + ' ' + (cls || '') });
    block.style.setProperty('--pot-tier', POTENTIAL_TIER_COLORS[tierKey] || '#94a3b8');
    block.appendChild(el('div', { class: 'pot-title' },
        el('span', null, label),
        el('span', { class: 'pot-tier-label' }, (data && data.tierLabel) || '')
    ));
    (data && data.entries || []).forEach(entry => {
        block.appendChild(el('div', { class: 'pot-row' },
            el('span', { class: 'pot-grade ' + (entry.grade || 'bronze') }, entry.gradeLabel || ''),
            el('span', { class: 'pot-text' }, entry.text || '')
        ));
    });
    return block;
}

function openRerollModal(eq) {
    potentialState = { eq, info: null, jewel: 'none', busy: false };
    $('#potentialOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    loadRerollInfo();
}

function closeRerollModal() {
    $('#potentialOverlay').classList.remove('active');
    document.body.style.overflow = '';
    const wrap = $('#potentialOverlay').querySelector('.enhance-wrap');
    if (wrap) { wrap.style.height = ''; wrap.classList.remove('result-mode'); }
    const c = $('#potentialContent'); if (c) c.style.zoom = '1';
    potentialState = { eq: null, info: null, jewel: 'none', busy: false };
    if (pageIsActive('inventory')) loadInventory('equipment').catch(() => {});
}

async function loadRerollInfo() {
    $('#potentialContent').replaceChildren(el('div', { class: 'loading', style: 'padding:60px 0;text-align:center' }, '불러오는 중...'));
    $('#potentialResultOverlay').classList.remove('active');
    const wrap = $('#potentialOverlay').querySelector('.enhance-wrap');
    if (wrap) wrap.classList.remove('result-mode');
    try {
        const data = await api('/api/potential/reroll-info/' + potentialState.eq.number);
        potentialState.info = data;
        if (potentialState.jewel === 'jewel' && !data.options.jewel.available) potentialState.jewel = 'none';
        if (potentialState.jewel === 'white' && !data.options.white.available) potentialState.jewel = 'none';
        renderRerollSetup();
    } catch (e) {
        $('#potentialContent').replaceChildren(el('div', { class: 'enhance-error-wrap' },
            el('div', { class: 'empty err' }, e.message),
            el('button', { class: 'enhance-cancel-btn', style: 'margin-top:12px;width:100%', onclick: closeRerollModal }, '닫기')
        ));
    }
}

function buildJewelCard() {
    const { info, jewel } = potentialState;
    const meta = JEWEL_META[jewel];
    const opt = info.options[jewel];
    const card = el('div', { class: 'enhance-protect ' + meta.cls + ' clickable', onclick: openJewelPicker });
    card.appendChild(el('div', { class: 'enhance-protect-icon' }, jewelIconNode(jewel)));
    const detail = jewel === 'none' ? '할인 없음 · 클릭하여 쥬얼 선택' : ('골드 -' + opt.discountPct + '% · 승급 확률/카운트 2배');
    card.appendChild(el('div', { class: 'enhance-protect-text' },
        el('div', { class: 'enhance-protect-name' }, meta.name),
        el('div', { class: 'enhance-protect-detail' }, detail)
    ));
    if (jewel !== 'none') card.appendChild(el('div', { class: 'enhance-protect-badge' }, '보유 ' + (jewel === 'white' ? info.jewels.white : info.jewels.jewel) + '개'));
    card.appendChild(el('div', { class: 'enhance-protect-pick-arrow' }, '▾'));
    return card;
}

function openJewelPicker() {
    const { info, jewel } = potentialState;
    const body = el('div', { class: 'protect-picker' });
    const makeRow = (key, detail, count, available) => {
        const row = el('div', {
            class: 'protect-pick-row' + (jewel === key ? ' selected' : '') + (available ? '' : ' disabled'),
            onclick: available ? () => { potentialState.jewel = key; closeModal(); renderRerollSetup(); } : null
        });
        row.appendChild(el('div', { class: 'protect-pick-icon' }, jewelIconNode(key)));
        row.appendChild(el('div', { class: 'protect-pick-text' },
            el('div', { class: 'protect-pick-name' }, JEWEL_META[key].name),
            el('div', { class: 'protect-pick-detail' }, detail)));
        if (count != null) row.appendChild(el('div', { class: 'protect-pick-count' }, count + '개'));
        if (jewel === key) row.appendChild(el('div', { class: 'protect-pick-check' }, '✓'));
        return row;
    };
    body.appendChild(makeRow('none', '쥬얼을 사용하지 않습니다', null, true));
    body.appendChild(makeRow('jewel', '골드 -' + info.options.jewel.discountPct + '% · 승급 2배', info.jewels.jewel, info.options.jewel.available));
    body.appendChild(makeRow('white', '골드 -' + info.options.white.discountPct + '% · 승급 2배', info.jewels.white, info.options.white.available));
    $('#modalTitle').textContent = '쥬얼 선택';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

function buildCostBox() {
    const { info, jewel } = potentialState;
    const opt = info.options[jewel];
    const lack = info.gold < opt.cost;
    const box = el('div', { class: 'pot-cost-box' });
    const goldImg = info.goldIcon ? el('img', { class: 'pot-gold-icon', src: info.goldIcon, alt: '' }) : null;
    box.appendChild(el('div', { class: 'pot-cost-line' + (lack ? ' lack' : '') },
        '소모 ', goldImg, ' ' + comma(opt.cost) + (lack ? ' (보유 ' + comma(info.gold) + ')' : ' / ' + comma(info.gold))));
    if (info.upgrade) {
        const jewelBonus = jewel !== 'none' && info.currentTier !== 'unique';
        box.appendChild(el('div', { class: 'pot-upg-line' },
            '승급 ' + info.currentTierLabel + ' → ' + info.upgrade.next + ' · 확정까지 ' + comma(info.upgrade.failCount) + '/' + comma(info.upgrade.guarantee) + (jewelBonus ? ' (쥬얼 2배)' : '')));
    }
    return box;
}

function renderRerollSetup() {
    const { eq, info, jewel } = potentialState;
    const opt = info.options[jewel];
    const lack = info.gold < opt.cost;

    const thumbParts = [];
    if (eq.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: eq.frameUrl, alt: '' }));
    if (eq.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: eq.iconUrl, alt: eq.name }));
    const header = el('div', { class: 'pot-mod-head tier-' + info.currentTier },
        el('button', { class: 'enhance-close-btn', onclick: closeRerollModal }, '✕'),
        el('div', { class: 'auc-thumb square' }, ...thumbParts),
        el('div', { class: 'pot-mod-title' }, eq.name + (eq.level > 0 ? ' +' + eq.level : '')),
        el('div', { class: 'pot-mod-tier' }, info.currentTierLabel)
    );
    header.style.setProperty('--pot-tier', POTENTIAL_TIER_COLORS[info.currentTier] || '#94a3b8');

    const confirmBtn = el('button', { class: 'pot-confirm-btn', disabled: lack ? true : false, onclick: e => doReroll(e) }, '재설정');

    $('#potentialContent').replaceChildren(
        header,
        el('div', { class: 'enhance-info' },
            el('div', { class: 'enhance-section-label' }, '현재 잠재능력'),
            potEntriesNode(info.current, '현재', 'cur'),
            el('div', { class: 'enhance-section-label' }, '쥬얼'),
            buildJewelCard(),
            el('div', { class: 'enhance-section-label' }, '소모 / 승급'),
            buildCostBox()
        ),
        el('div', { class: 'enhance-footer' },
            el('button', { class: 'enhance-cancel-btn', onclick: closeRerollModal }, '닫기'),
            confirmBtn
        )
    );
    requestAnimationFrame(refitPotential);
}

async function doReroll(event) {
    if (potentialState.busy) return;
    potentialState.busy = true;
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/potential/reroll', { number: potentialState.eq.number, jewel: potentialState.jewel });
        potentialState.busy = false;
        showRerollResult(data);
    } catch (e) {
        potentialState.busy = false;
        if (btn) btn.disabled = false;
        showAlert(e.message);
    }
}

function showRerollResult(data) {
    const ov = $('#potentialResultOverlay');
    const wrap = $('#potentialOverlay').querySelector('.enhance-wrap');
    if (wrap) wrap.classList.add('result-mode');
    const eq = potentialState.eq;
    const kind = data.upgraded ? 'great' : 'success';
    potentialState.lastResult = data;

    const thumbParts = [];
    if (eq.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: eq.frameUrl, alt: '' }));
    if (eq.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: eq.iconUrl, alt: '' }));
    const weapon = el('div', { class: 'enh-fx-weapon' }, el('div', { class: 'auc-thumb square' }, ...thumbParts));
    const fxLayers = [el('div', { class: 'enh-fx-aura' })];
    if (data.upgraded) {
        fxLayers.push(buildRayLayer(16, '#fde68a'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(16, ['#fde68a', '#c4b5fd', '#86efac', '#93c5fd', '#f0abfc', '#fbbf24']));
    } else {
        fxLayers.push(buildRayLayer(12, 'rgba(196,181,253,.7)'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(11, ['#e9d5ff', '#c4b5fd', '#ffffff']));
    }
    const fxStage = el('div', { class: 'enh-fx ' + kind }, ...fxLayers);

    const FX = 0.25;
    const headline = el('div', { class: 'enh-result-headline ' + kind, style: 'animation-delay:' + FX + 's' },
        data.upgraded ? ('티어 승급! ' + data.currentTierLabel + ' → ' + data.nextTierLabel + (data.guaranteed ? ' (확정)' : '')) : '잠재능력 재설정');

    const power = data.combatPower;
    const powerDiff = power ? Number(power.diff || 0) : 0;
    const powerClass = powerDiff > 0 ? 'up' : powerDiff < 0 ? 'down' : 'same';
    const powerNode = power ? el('div', { class: 'pot-power-compare pot-result-reveal ' + powerClass, style: 'animation-delay:' + (FX + 0.07).toFixed(2) + 's' },
        el('div', { class: 'pot-power-value old' }, el('span', null, '이전 전투력'), el('strong', null, comma(power.old))),
        el('div', { class: 'pot-power-delta' },
            el('span', null, '전투력 변화'),
            el('strong', null, powerDiff > 0 ? '+' + comma(powerDiff) : comma(powerDiff))
        ),
        el('div', { class: 'pot-power-value new' }, el('span', null, '신규 전투력'), el('strong', null, comma(power.new)))
    ) : null;

    const cmp = el('div', { class: 'pot-compare pot-result-reveal', style: 'animation-delay:' + (FX + 0.1).toFixed(2) + 's' },
        potEntriesNode(data.old, '이전', 'old'),
        potEntriesNode(data.new, '신규', 'new'));

    const warn = data.upgraded ? el('div', { class: 'pot-warn pot-result-reveal', style: 'animation-delay:' + (FX + 0.18).toFixed(2) + 's' },
        '이전 유지를 선택하면 승급도 사라집니다. 골드/쥬얼은 반환되지 않습니다.') : null;

    const btnRow = el('div', { class: 'pot-result-actions pot-result-reveal', style: 'animation-delay:' + (FX + 0.25).toFixed(2) + 's' },
        el('button', { class: 'enhance-cancel-btn', onclick: e => data.upgraded ? showRerollKeepWarning() : finishReroll('cancel', e) }, '이전 유지'),
        el('button', { class: 'pot-confirm-btn', onclick: e => finishReroll('confirm', e) }, '새 잠재능력 적용'));

    const inner = el('div', { class: 'pot-result-inner' }, fxStage, headline, ...(powerNode ? [powerNode] : []), cmp, ...(warn ? [warn] : []), btnRow);
    ov.replaceChildren(inner);
    ov.classList.add('active');
    requestAnimationFrame(refitPotential);
}

function showRerollKeepWarning() {
    const ov = $('#potentialResultOverlay');
    const inner = el('div', { class: 'pot-result-inner' },
        el('div', { class: 'enh-warn-title' }, '승급을 포기하시겠습니까?'),
        el('div', { class: 'enh-warn-sub' }, '이전 잠재능력으로 되돌리면 티어 승급도 함께 사라집니다. 소모한 골드/쥬얼은 반환되지 않습니다.'),
        el('div', { class: 'enh-warn-actions' },
            el('button', { class: 'enhance-cancel-btn', onclick: () => showRerollResult(potentialState.lastResult) }, '돌아가기'),
            el('button', { class: 'enh-warn-confirm', onclick: e => finishReroll('cancel', e) }, '승급 포기')
        )
    );
    ov.replaceChildren(inner);
    ov.classList.add('active');
    requestAnimationFrame(refitPotential);
}

async function finishReroll(kind, event) {
    if (potentialState.busy) return;
    potentialState.busy = true;
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/potential/reroll/' + (kind === 'confirm' ? 'confirm' : 'cancel'), {});
        potentialState.busy = false;
        if (data.profile) renderProfile(data.profile);
        $('#potentialResultOverlay').classList.remove('active');
        loadRerollInfo(); // 모달은 유지하고 재설정 화면 갱신
    } catch (e) {
        potentialState.busy = false;
        if (btn) btn.disabled = false;
        showAlert(e.message);
    }
}

async function handleEquipmentAction(eq, action, event) {
    const btn = event && event.currentTarget;
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/inventory/equipment/' + action, { number: eq.number });
        closeModal();
        if (data.profile) renderProfile(data.profile);
        if (pageIsActive('inventory')) await loadInventory('equipment');
    } catch (e) {
        showAlert(e.message);
        if (btn) btn.disabled = false;
    }
}

function categorySection(title, children) {
    const normalizedTitle = String(title || '').replace(/[《》]/g, '').trim();
    const count = children.reduce((sum, child) => sum + (child && child.children ? child.children.length : 0), 0);
    return el('div', { class: 'cat inventory-category' },
        el('div', { class: 'cat-title' }, el('span', null, normalizedTitle), el('b', null, count)),
        ...children
    );
}

let myName = null;
let myGoods = null;
let lastProfileData = null;
let currentProfileName = null;
let currentInventoryName = null;
let suppressInfoSelfReset = false;
let blessingViewStates = [];
let blessingCountdownTimer = null;
const BLESSING_ART = {
    yusaeng: '/static/assets/blessing-yusaeng.webp?v=3',
    divine: '/static/assets/blessing-yusaeng-divine.webp?v=3',
    rukim: '/static/assets/blessing-rukim.webp',
};

function formatBlessingRemaining(expiresAt) {
    const totalMinutes = Math.max(0, Math.ceil((Number(expiresAt || 0) - Date.now()) / 60000));
    if (totalMinutes <= 0) return '미적용';
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    return days + '일 ' + hours + '시간 ' + minutes + '분 남음';
}

function refreshBlessingCountdown() {
    const now = Date.now();
    $$('.blessing-card[data-blessing-key]').forEach(card => {
        const state = blessingViewStates.find(entry => entry.key === card.dataset.blessingKey);
        const active = !!state && Number(state.expiresAt || 0) > now;
        card.classList.toggle('active', active);
        const remaining = card.querySelector('.blessing-remaining');
        if (remaining) remaining.textContent = active ? formatBlessingRemaining(state.expiresAt) : '미적용';
        const button = card.querySelector('.blessing-buy-btn');
        if (button) button.textContent = active ? '기간 연장' : '구매';
    });
}

function playBlessingPurchaseEffect(state, extended) {
    const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const effect = el('div', {
        class: 'blessing-purchase-fx blessing-fx-' + state.key,
        role: 'status',
        'aria-live': 'polite',
    });
    effect.appendChild(el('div', { class: 'blessing-fx-backdrop', 'aria-hidden': 'true' }));
    effect.appendChild(el('div', { class: 'blessing-fx-rays', 'aria-hidden': 'true' }));

    const burst = el('div', { class: 'blessing-fx-particles', 'aria-hidden': 'true' });
    for (let i = 0; i < 30; i++) {
        const angle = (Math.PI * 2 * i / 30) + (i % 2 ? 0.08 : 0);
        const distance = 145 + (i % 5) * 32;
        const particle = el('i');
        particle.style.setProperty('--fx-x', Math.round(Math.cos(angle) * distance) + 'px');
        particle.style.setProperty('--fx-y', Math.round(Math.sin(angle) * distance) + 'px');
        particle.style.setProperty('--fx-delay', (i % 6) * 35 + 'ms');
        particle.style.setProperty('--fx-size', (5 + (i % 4) * 2) + 'px');
        burst.appendChild(particle);
    }
    effect.appendChild(burst);

    const motes = el('div', { class: 'blessing-fx-motes', 'aria-hidden': 'true' });
    for (let i = 0; i < 18; i++) {
        const mote = el('i');
        mote.style.left = ((i * 37) % 100) + '%';
        mote.style.setProperty('--fx-drift', ((i % 5) - 2) * 22 + 'px');
        mote.style.setProperty('--fx-delay', (i % 9) * 90 + 'ms');
        mote.style.setProperty('--fx-duration', (1550 + (i % 5) * 170) + 'ms');
        motes.appendChild(mote);
    }
    effect.appendChild(motes);

    const stage = el('div', { class: 'blessing-fx-stage' },
        el('div', { class: 'blessing-fx-ring ring-outer', 'aria-hidden': 'true' }),
        el('div', { class: 'blessing-fx-ring ring-middle', 'aria-hidden': 'true' }),
        el('div', { class: 'blessing-fx-ring ring-inner', 'aria-hidden': 'true' }),
        el('div', { class: 'blessing-fx-art' },
            el('img', { src: BLESSING_ART[state.key] || '', alt: '' })
        ),
        el('div', { class: 'blessing-fx-copy' },
            el('h2', null, state.name),
            el('p', null, extended ? '축복의 시간이 연장되었습니다' : '새로운 축복이 깃들었습니다')
        )
    );
    effect.appendChild(stage);
    document.body.appendChild(effect);
    requestAnimationFrame(() => effect.classList.add('active'));

    return new Promise(resolve => {
        setTimeout(() => {
            effect.remove();
            resolve();
        }, reducedMotion ? 950 : 2900);
    });
}

async function submitBlessingPurchase(state, button) {
    if (!state || currentProfileName !== myName) return;
    const active = Number(state.expiresAt || 0) > Date.now();
    button.disabled = true;
    button.textContent = '처리 중...';
    try {
        const result = await postApi('/api/blessings/buy', { key: state.key });
        await closeModal();
        if (result.profile) renderProfile(result.profile);
        await playBlessingPurchaseEffect(state, active);
        await showAlert(state.name + (active ? ' 기간을 30일 연장했습니다.' : '을 구매했습니다.'));
    } catch (e) {
        button.disabled = false;
        button.textContent = active ? '기간 연장' : '구매';
        showAlert(e.message);
    }
}

function openBlessingBuyModal(state) {
    if (!state || currentProfileName !== myName || !lastProfileData || lastProfileData.user.name !== myName) return;
    const active = Number(state.expiresAt || 0) > Date.now();
    const balance = Number(lastProfileData.user.point || 0);
    const price = { goods: 'point' };
    const after = balance - Number(state.price || 0);
    const content = el('div', { class: 'shop-buy-modal blessing-buy-modal' });

    const itemRow = el('div', { class: 'shop-buy-item-row blessing-buy-item-row' });
    const thumb = el('div', { class: 'blessing-buy-thumb' });
    thumb.appendChild(el('img', { src: BLESSING_ART[state.key] || '', alt: state.name }));
    itemRow.appendChild(thumb);
    const info = el('div', { class: 'blessing-buy-info' });
    info.appendChild(el('div', { class: 'shop-buy-name' }, state.name));
    info.appendChild(el('div', { class: 'shop-buy-meta' }, active
        ? '재구매 시 현재 이용 기간 뒤에 30일이 추가됩니다.'
        : '구매 즉시 30일 동안 축복 효과가 적용됩니다.'));
    if (active) info.appendChild(el('div', { class: 'blessing-modal-status' }, formatBlessingRemaining(state.expiresAt)));
    itemRow.appendChild(info);
    content.appendChild(itemRow);

    content.appendChild(el('div', { class: 'shop-receipt' },
        buildReceiptRow('현재 보유', price, balance),
        buildReceiptRow('결제 금액', price, state.price, 'deduct'),
        el('div', { class: 'shop-receipt-divider' }),
        buildReceiptRow('구매 후 잔액', price, after, after < 0 ? 'neg' : 'result')
    ));
    if (after < 0) content.appendChild(el('div', { class: 'blessing-modal-warning' }, '포인트가 부족합니다.'));

    const footer = el('div', { class: 'shop-buy-footer' });
    footer.appendChild(el('button', { onclick: closeModal }, '취소'));
    const buyBtn = el('button', {
        class: 'primary',
        disabled: after < 0,
        onclick: () => submitBlessingPurchase(state, buyBtn),
    }, active ? '기간 연장' : '구매');
    footer.appendChild(buyBtn);
    content.appendChild(footer);

    modalRequestToken++;
    setModalVariant();
    $('#modalTitle').textContent = state.name + (active ? ' 기간 연장' : ' 구매');
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

function renderBlessings(states, canPurchase) {
    blessingViewStates = Array.isArray(states) ? states : [];
    $$('.blessing-card[data-blessing-key]').forEach(card => {
        const state = blessingViewStates.find(entry => entry.key === card.dataset.blessingKey);
        const button = card.querySelector('.blessing-buy-btn');
        if (!button) return;
        button.hidden = !canPurchase;
        button.disabled = false;
        button.onclick = state ? () => openBlessingBuyModal(state) : null;
    });
    refreshBlessingCountdown();
    if (blessingCountdownTimer) clearInterval(blessingCountdownTimer);
    blessingCountdownTimer = setInterval(refreshBlessingCountdown, 30000);
}

function updateInventoryBanner() {
    const banner = $('#inventoryBanner');
    if (!banner) return;
    const isOther = currentInventoryName && myName && currentInventoryName !== myName;
    banner.style.display = isOther ? 'flex' : 'none';
    if (isOther) $('#inventoryBannerText').textContent = currentInventoryName + '님의 인벤토리를 보고 있습니다';
}

function renderProfile(data) {
    currentProfileName = data.user.name;
    const isInitialOwnProfile = myName == null;
    if (myName == null) myName = data.user.name;
    $('#who').textContent = myName;
    if (data.user.name === myName) {
        setHeaderPoint(data.user.point);
        myGoods = { gold: Number(data.user.gold || 0), garnet: Number(data.user.garnet || 0) };
    }
    $('#profileName').textContent = data.user.name;
    const pTitle = $('#profileTitle');
    if (pTitle) { const img = titleImg(data.user.title); pTitle.replaceChildren(...(img ? [img] : [])); }
    $('#level').textContent = 'Lv. ' + comma(data.user.level);
    $('#exp').textContent = 'EXP ' + comma(data.user.exp) + ' / ' + comma(data.user.maxExp);
    const expFill = $('#expFill');
    if (expFill) {
        const maxExp = Number(data.user.maxExp || 0);
        const pct = maxExp > 0 ? Math.max(0, Math.min(100, Number(data.user.exp || 0) / maxExp * 100)) : 0;
        expFill.style.width = pct + '%';
    }
    $('#totalPower').textContent = comma(data.combatPower.total);
    const heroBg = $('#pfHeroBg');
    if (heroBg) heroBg.style.backgroundImage = (data.mainCard && data.mainCard.imageUrl) ? 'url("' + data.mainCard.imageUrl + '")' : 'none';
    const petRow = $('#petRow');
    if (petRow) petRow.replaceChildren(...(data.equippedPets || []).map(profilePetTile));
    renderGoods(data.user, data.currencyIcons || {});
    currentStatGroups = data.statGroups || [];
    renderStatCard();
    renderStatPoint(data.statPoint);
    $('#mainCard').replaceChildren(cardNode(data.mainCard, false, c => openMainCardModal(c, (!!myName && data.user.name === myName) ? { source: 'main' } : null)));
    lastProfileData = data;
    const ownProfile = !!myName && data.user.name === myName;
    renderBlessings(data.blessings, ownProfile);
    $('#slotCards').replaceChildren(...data.cardSlots.map((card, i) =>
        (card && card.name) ? cardNode(card, true, c => openCardSlotModal(c, i + 1))
        : ownProfile ? emptyCardSlotNode() : cardNode(null)
    ));
    renderGearSlots(data);
    if (data.user.isAdmin) $('#adminLink').style.display = '';
    if (isInitialOwnProfile && !data.user.canPartyQuest)
        $$('.group-tab[data-group="party"], .bottom-tab[data-group="party"]').forEach(t => t.remove());
}

if ($('#inventoryBackBtn')) $('#inventoryBackBtn').onclick = () => {
    currentInventoryName = myName;
    updateInventoryBanner();
    loadInventory('items').catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message)));
};

function invItemCell(item) {
    const imgParts = [];
    if (item.iconUrl) {
        if (item.frameUrl) imgParts.push(el('img', { class: 'inv-cell-frame', src: item.frameUrl, alt: '' }));
        imgParts.push(el('img', { class: 'inv-cell-icon', src: item.iconUrl, alt: item.name }));
    }
    if (item.count > 1) imgParts.push(el('span', { class: 'inv-cell-count' }, comma(item.count)));
    return el('button', { class: 'inv-cell', type: 'button', title: item.name, onclick: () => openInvItemModal(item) },
        el('div', { class: 'inv-cell-img' }, ...imgParts),
        el('div', { class: 'inv-cell-name' }, item.name)
    );
}

function itemDetailArtwork(data, className) {
    const iconUrl = data && (data.iconUrl || data.imgUrl);
    const parts = [];
    if (data && data.frameUrl) parts.push(el('img', { class: 'item-detail-frame', src: data.frameUrl, alt: '' }));
    if (iconUrl) parts.push(el('img', { class: 'item-detail-icon', src: iconUrl, alt: data.name || '', loading: 'lazy' }));
    if (!iconUrl) parts.push(el('span', { class: 'item-detail-fallback' }, data && data.label ? data.label : String(data && data.name || '?').slice(0, 1)));
    return el('div', { class: 'item-detail-art ' + (className || '') }, ...parts);
}

function itemDetailHero(item) {
    const chips = [el('span', { class: 'item-detail-chip type' }, item.type || '아이템')];
    if (item.noTrade) chips.push(el('span', { class: 'item-detail-chip bound' }, '거래 불가'));
    return el('header', { class: 'item-detail-hero' },
        itemDetailArtwork(item, 'hero-art'),
        el('div', { class: 'item-detail-summary' },
            el('div', { class: 'item-detail-chips' }, ...chips),
            el('h4', null, item.name),
            el('p', { class: 'item-detail-desc' }, item.desc || '등록된 아이템 설명이 없습니다.'),
            el('div', { class: 'item-detail-owned' },
                el('span', null, '보유 수량'),
                el('b', null, comma(item.count) + '개')
            )
        )
    );
}

function itemDetailSection(title, meta, ...children) {
    return el('section', { class: 'item-detail-section' },
        el('div', { class: 'item-detail-section-head' },
            el('h5', null, title),
            meta ? el('span', null, meta) : null
        ),
        ...children
    );
}

function itemChanceText(chance) {
    const percent = Math.max(0, Number(chance || 0) * 100);
    return percent.toLocaleString('ko-KR', { maximumFractionDigits: percent < 0.01 ? 6 : 4 }) + '%';
}

function itemRewardRow(entry, kind) {
    const trailing = [];
    if (entry.count) trailing.push(el('span', { class: 'item-reward-count' }, '×' + entry.count));
    if (kind === 'chance') trailing.push(el('b', { class: 'item-reward-chance' }, itemChanceText(entry.chance)));
    return el('div', { class: 'item-reward-row' },
        itemDetailArtwork(entry, 'reward-art'),
        el('div', { class: 'item-reward-info' },
            el('span', { class: 'item-reward-type' }, entry.type || '보상'),
            el('strong', null, entry.name || '알 수 없는 보상'),
            entry.detail ? el('small', null, entry.detail) : null
        ),
        el('div', { class: 'item-reward-trailing' }, ...trailing)
    );
}

function cleanItemUseMessage(message) {
    return String(message || '')
        .replace(/\u200e/g, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('/RPGenius'));
}

function itemUseMessagePanel(message, className) {
    const lines = cleanItemUseMessage(message);
    return el('div', { class: 'item-use-message ' + (className || '') }, ...lines.map(line => {
        if (/^\[.+\]$/.test(line)) return el('strong', { class: 'item-use-message-title' }, line.replace(/[\[\]]/g, ''));
        return el('p', null, line.replace(/^[-✅✨❗]\s*/, ''));
    }));
}

function itemUseControls(item) {
    const ownInventory = !currentInventoryName || !myName || currentInventoryName === myName;
    if (!ownInventory || !item.usable) return null;
    let amount = 1;
    const max = Math.max(1, Number(item.count || 1));
    const amountText = el('b', { class: 'item-use-amount' }, '1');
    const syncAmount = next => {
        amount = Math.max(1, Math.min(max, Math.floor(Number(next) || 1)));
        amountText.textContent = comma(amount);
        useButton.textContent = item.name === '봉인된 자물쇠' ? comma(amount) + '회 개봉' : comma(amount) + '개 사용';
    };
    const quantity = item.bulkUsable ? el('div', { class: 'item-use-stepper' },
        el('button', { type: 'button', onclick: () => syncAmount(amount - 1), 'aria-label': '수량 줄이기' }, '−'),
        amountText,
        el('button', { type: 'button', onclick: () => syncAmount(amount + 1), 'aria-label': '수량 늘리기' }, '+'),
        el('button', { class: 'item-use-max', type: 'button', onclick: () => syncAmount(max) }, 'MAX')
    ) : null;
    const useButton = el('button', { class: 'item-use-button', type: 'button', onclick: () => useInventoryItem(item, amount, useButton) }, item.name === '봉인된 자물쇠' ? '1회 개봉' : '1개 사용');
    return el('section', { class: 'item-use-bar' },
        el('div', { class: 'item-use-bar-copy' }, el('span', null, '아이템 사용'), el('small', null, item.bulkUsable ? '사용할 수량을 선택해주세요.' : '이 아이템은 한 번에 1개씩 사용할 수 있습니다.')),
        quantity,
        useButton
    );
}

async function postItemUse(url, body) {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || ('HTTP ' + response.status));
        error.data = data;
        throw error;
    }
    return data;
}

function renderItemUseResult(item, message) {
    activeItemUsePending = false;
    modalLocked = false;
    $('#modalBody').replaceChildren(el('div', { class: 'item-detail item-use-result' },
        itemDetailHero(Object.assign({}, item, { count: Math.max(0, Number(item.count || 0)) })),
        el('div', { class: 'item-detail-content' },
            el('section', { class: 'item-use-result-card' },
                el('span', { class: 'item-use-result-mark' }, '✓'),
                el('h5', null, '사용 완료'),
                itemUseMessagePanel(message, 'result')
            )
        )
    ));
}

function itemUseOptionNode(item, option) {
    return el('button', { class: 'item-use-option', type: 'button', onclick: event => resolveInventoryItemUse(item, option.value, false, event.currentTarget) },
        itemDetailArtwork(option, 'use-option-art'),
        el('div', { class: 'item-use-option-copy' }, el('strong', null, option.name), option.meta ? el('span', null, option.meta) : null),
        el('span', { class: 'item-use-option-arrow' }, '›')
    );
}

function renderItemUsePending(item, pending, message) {
    if (!pending) return renderItemUseResult(item, message);
    activeItemUsePending = true;
    modalLocked = false;
    const actionNode = pending.confirmOnly
        ? el('button', { class: 'item-use-confirm', type: 'button', onclick: event => resolveInventoryItemUse(item, null, true, event.currentTarget) }, pending.confirmLabel || '확인')
        : el('div', { class: 'item-use-options' }, ...(pending.options || []).map(option => itemUseOptionNode(item, option)));
    $('#modalBody').replaceChildren(el('div', { class: 'item-detail item-use-select' },
        itemDetailHero(item),
        el('div', { class: 'item-detail-content' },
            itemDetailSection(pending.title || '대상 선택', (pending.options || []).length ? (pending.options || []).length + '개 대상' : '',
                el('p', { class: 'item-detail-note' }, pending.description || '아이템을 적용할 대상을 선택해주세요.'),
                pending.confirmOnly && message ? itemUseMessagePanel(message, 'preview') : null,
                actionNode,
                !pending.confirmOnly && !(pending.options || []).length ? el('div', { class: 'item-detail-empty' }, '선택할 수 있는 대상이 없습니다.') : null,
                el('button', { class: 'item-use-cancel', type: 'button', onclick: () => closeModal() }, '사용 취소')
            )
        )
    ));
}

async function useInventoryItem(item, count, button) {
    button.disabled = true;
    modalLocked = true;
    if (item.name === '봉인된 자물쇠') {
        modalLocked = false;
        finishCloseModal();
        openLockbox(count);
        return;
    }
    try {
        const response = await postItemUse('/api/inventory/items/' + encodeURIComponent(item.id) + '/use', { count });
        item.count = Number.isFinite(Number(response.remainingCount)) ? Number(response.remainingCount) : Math.max(0, Number(item.count || 0) - Number(count || 1));
        loadInventory('items').catch(() => {});
        if (response.pending) renderItemUsePending(item, response.pending, response.message);
        else renderItemUseResult(item, response.message);
    } catch (error) {
        modalLocked = false;
        button.disabled = false;
        if (error.data && error.data.pending) renderItemUsePending(item, error.data.pending, error.message);
        else showAlert(error.message);
    }
}

async function resolveInventoryItemUse(item, choice, confirm, button) {
    button.disabled = true;
    modalLocked = true;
    try {
        const response = await postItemUse('/api/inventory/item-use/resolve', { choice, confirm });
        loadInventory('items').catch(() => {});
        if (response.pending) renderItemUsePending(item, response.pending, response.message);
        else renderItemUseResult(item, response.message);
    } catch (error) {
        modalLocked = false;
        button.disabled = false;
        if (error.data && error.data.pending) renderItemUsePending(item, error.data.pending, error.message);
        else showAlert(error.message);
    }
}

async function craftInventoryRecipe(application, times, button) {
    button.disabled = true;
    modalLocked = true;
    try {
        const response = await postApi('/api/inventory/craft', { name: application.craft.name, times });
        modalLocked = false;
        finishCloseModal();
        loadInventory('items').catch(() => {});
        await showAlert(response.message);
    } catch (error) {
        modalLocked = false;
        button.disabled = false;
        await showAlert(error.message);
    }
}

function itemCraftControls(application) {
    const ownInventory = !currentInventoryName || !myName || currentInventoryName === myName;
    const max = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(Number(application.craft && application.craft.maxCraftable) || 0)));
    if (!ownInventory || !application.craft || max < 1) return null;
    const input = el('input', { class: 'item-craft-input', type: 'number', min: 1, max, step: 1, value: 1, inputMode: 'numeric', 'aria-label': '제작 횟수' });
    const craftButton = el('button', { class: 'item-craft-button', type: 'button' }, '1회 제작');
    const readAmount = () => Number(input.value);
    const syncAmount = value => {
        const amount = Math.max(1, Math.min(max, Math.floor(Number(value) || 1)));
        input.value = amount;
        craftButton.disabled = false;
        craftButton.textContent = comma(amount) + '회 제작';
        return amount;
    };
    input.oninput = () => {
        const amount = readAmount();
        const valid = Number.isSafeInteger(amount) && amount >= 1 && amount <= max;
        craftButton.disabled = !valid;
        craftButton.textContent = valid ? comma(amount) + '회 제작' : '횟수 확인';
    };
    input.onchange = () => syncAmount(readAmount());
    craftButton.onclick = () => craftInventoryRecipe(application, syncAmount(readAmount()), craftButton);
    return el('div', { class: 'item-craft-controls' },
        el('div', { class: 'item-craft-stepper' },
            el('button', { type: 'button', onclick: () => syncAmount(readAmount() - 1), 'aria-label': '제작 횟수 줄이기' }, '−'),
            input,
            el('button', { type: 'button', onclick: () => syncAmount(readAmount() + 1), 'aria-label': '제작 횟수 늘리기' }, '+'),
            el('button', { class: 'item-craft-max', type: 'button', onclick: () => syncAmount(max) }, 'MAX')
        ),
        craftButton
    );
}

function renderItemDetail(item, detail) {
    const data = Object.assign({}, item, detail || {}, { count: item.count });
    const sections = [];
    if (Array.isArray(data.usageFacts) && data.usageFacts.length) {
        sections.push(itemDetailSection('사용 효과', '',
            el('div', { class: 'item-detail-facts' }, ...data.usageFacts.map(fact =>
                el('div', { class: 'item-detail-fact' }, el('span', null, fact.label), el('b', null, fact.value))
            ))
        ));
    }
    if (Array.isArray(data.requirements) && data.requirements.length) {
        sections.push(itemDetailSection('추가 필요 아이템', data.requirements.length + '종',
            el('p', { class: 'item-detail-note' }, '사용할 때 아래 아이템도 함께 소모됩니다.'),
            el('div', { class: 'item-reward-list compact' }, ...data.requirements.map(entry => itemRewardRow(entry, 'bundle')))
        ));
    }
    if (data.rewards) {
        const entries = Array.isArray(data.rewards.entries) ? data.rewards.entries : [];
        const rewardNodes = entries.length
            ? [el('div', { class: 'item-reward-list' }, ...entries.map(entry => itemRewardRow(entry, data.rewards.kind)))]
            : [el('div', { class: 'item-detail-empty' }, '등록된 보상 정보가 없습니다.')];
        sections.push(itemDetailSection(data.rewards.title || '획득 정보', entries.length + '개 결과',
            data.rewards.note ? el('p', { class: 'item-detail-note' }, data.rewards.note) : null,
            ...rewardNodes
        ));
    }
    if (Array.isArray(data.applications) && data.applications.length) {
        sections.push(itemDetailSection('사용처', data.applications.length + '곳',
            el('div', { class: 'item-application-list' }, ...data.applications.map(application =>
                el('div', { class: 'item-application' },
                    itemDetailArtwork(application, 'application-art'),
                    el('div', { class: 'item-application-info' },
                        el('span', { class: 'item-application-category' }, application.category || '사용처'),
                        el('strong', null, application.title),
                        el('p', null, application.description || ''),
                        application.resultText ? el('small', null, application.resultText) : null,
                        application.craft && application.craft.materialsText ? el('small', { class: 'item-craft-materials' }, '보유/필요 · ' + application.craft.materialsText) : null,
                        itemCraftControls(application)
                    )
                )
            ))
        ));
    } else if (data.showApplicationEmpty) {
        sections.push(itemDetailSection('사용처', '',
            el('div', { class: 'item-detail-empty' }, '현재 등록된 제작식이나 시스템 소모처가 없습니다.')
        ));
    }
    const useControls = itemUseControls(data);
    $('#modalBody').replaceChildren(el('div', { class: 'item-detail' }, itemDetailHero(data), el('div', { class: 'item-detail-content' }, ...sections), useControls));
}

async function openInvItemModal(item) {
    const requestToken = ++modalRequestToken;
    setModalVariant('item-detail');
    $('#modalTitle').textContent = '';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(el('div', { class: 'item-detail' },
        itemDetailHero(item),
        el('div', { class: 'item-detail-loading' }, el('span', { class: 'item-detail-spinner' }), el('b', null, '상세 정보를 불러오는 중'))
    ));
    $('#modalBg').classList.add('active');
    try {
        const response = await api('/api/inventory/items/' + encodeURIComponent(item.id) + '/detail');
        if (requestToken !== modalRequestToken || !$('#modalBg').classList.contains('active')) return;
        renderItemDetail(item, response.detail);
    } catch (error) {
        if (requestToken !== modalRequestToken) return;
        $('#modalBody').replaceChildren(el('div', { class: 'item-detail' },
            itemDetailHero(item),
            el('div', { class: 'item-detail-error' }, '상세 정보를 불러오지 못했습니다.', el('small', null, error.message))
        ));
    }
}

async function openLockbox(count = 1) {
    // 영상 재생 전에 열쇠/자물쇠 보유를 먼저 확인해, 부족하면 경고만 띄운다.
    let check;
    try {
        check = await postApi('/api/inventory/lockbox-check', { count });
    } catch (e) {
        openModal('오류', '', [e.message]);
        return;
    }
    if (!check.ok) {
        openModal('열기 불가', '', [check.error || '열쇠가 부족합니다.']);
        return;
    }
    const overlay = $('#lockboxOverlay');
    const video = $('#lockboxVideo');
    overlay.classList.add('active');
    video.currentTime = 0;
    video.play();
    const finish = async () => {
        video.onended = null;
        $('#lockboxSkip').onclick = null;
        video.pause();
        overlay.classList.remove('active');
        try {
            const data = await postApi('/api/inventory/use-lockbox', { count });
            showLockboxResult(data.opens || []);
            loadInventory('items');
        } catch (e) {
            openModal('오류', '', [e.message]);
        }
    };
    video.onended = finish;
    $('#lockboxSkip').onclick = finish;
}

function lockboxRewardRow(r, i, bonus) {
    const thumbChildren = [];
    if (r.frameUrl) thumbChildren.push(el('img', { class: 'lb-frame', src: r.frameUrl, alt: '' }));
    if (r.iconUrl) thumbChildren.push(el('img', { class: 'lb-icon', src: r.iconUrl, alt: r.name }));
    return el('div', { class: 'lockbox-reward-row' + (bonus ? ' bonus' : ''), style: 'animation-delay:' + (i * 0.08) + 's' },
        el('div', { class: 'lockbox-reward-thumb' }, ...thumbChildren),
        el('div', { class: 'lockbox-reward-info' },
            el('div', { class: 'lockbox-reward-name' }, r.name),
            el('div', { class: 'lockbox-reward-count' }, 'x' + comma(r.count))
        )
    );
}

function lockboxMiniItem(r, bonus) {
    const thumbChildren = [];
    if (r.frameUrl) thumbChildren.push(el('img', { class: 'lb-frame', src: r.frameUrl, alt: '' }));
    if (r.iconUrl) thumbChildren.push(el('img', { class: 'lb-icon', src: r.iconUrl, alt: r.name }));
    return el('div', { class: 'lockbox-mini' + (bonus ? ' bonus' : '') },
        el('span', { class: 'lockbox-mini-tag' }, bonus ? '보너스' : '메인'),
        el('div', { class: 'lockbox-mini-thumb' }, ...thumbChildren),
        el('div', { class: 'lockbox-mini-info' },
            el('div', { class: 'lockbox-mini-name' }, r.name),
            el('div', { class: 'lockbox-mini-count' }, 'x' + comma(r.count))
        )
    );
}

function lockboxOpenCard(o, idx) {
    const card = el('div', { class: 'lockbox-open-card', style: 'animation-delay:' + (idx * 0.05) + 's' });
    card.appendChild(el('div', { class: 'lockbox-open-no' }, (idx + 1) + '회'));
    const body = el('div', { class: 'lockbox-open-body' });
    (o.main || []).forEach(r => body.appendChild(lockboxMiniItem(r, false)));
    (o.bonus || []).forEach(r => body.appendChild(lockboxMiniItem(r, true)));
    card.appendChild(body);
    return card;
}

function showLockboxResult(opens) {
    opens = opens || [];
    const overlay = $('#lockboxResultOverlay');
    const multi = opens.length > 1;
    const nodes = [
        el('div', { class: 'lockbox-result-title' }, '✦  봉인 해제  ✦'),
        el('div', { class: 'lockbox-result-sub' }, multi ? opens.length + '회 개봉 결과' : '봉인된 자물쇠에서 아이템을 획득했습니다'),
    ];
    if (multi) {
        const list = el('div', { class: 'lockbox-opens' });
        opens.forEach((o, idx) => list.appendChild(lockboxOpenCard(o, idx)));
        nodes.push(list);
    } else {
        const o = opens[0] || { main: [], bonus: [] };
        const grid = el('div', { class: 'lockbox-rewards-grid' });
        (o.main || []).forEach((r, i) => grid.appendChild(lockboxRewardRow(r, i, false)));
        nodes.push(grid);
        if ((o.bonus || []).length) {
            nodes.push(el('div', { class: 'lockbox-bonus-divider' }, '보너스'));
            const bonusGrid = el('div', { class: 'lockbox-rewards-grid' });
            o.bonus.forEach((r, i) => bonusGrid.appendChild(lockboxRewardRow(r, i, true)));
            nodes.push(bonusGrid);
        }
    }
    const closeBtn = el('button', { class: 'lockbox-result-close' }, '확인');
    closeBtn.onclick = () => overlay.classList.remove('active');
    nodes.push(closeBtn);
    overlay.replaceChildren(...nodes);
    overlay.classList.add('active');
}

const INVENTORY_KIND_META = {
    items: { title: '아이템 보관함', countLabel: '보유 종류' },
    cards: { title: '캐릭터 카드', countLabel: '보유 카드' },
    equipment: { title: '장비 보관함', countLabel: '보유 장비' },
    pet: { title: '펫 보관함', countLabel: '보유 펫' }
};
let currentInventoryKind = 'items';
let currentInventoryData = null;

function inventoryCount(kind, data) {
    const list = kind === 'items' ? data.items : (kind === 'cards' ? data.cards : (kind === 'equipment' ? data.equipment : data.pet));
    return Array.isArray(list) ? list.length : 0;
}

function updateInventoryChrome(kind, data) {
    const meta = INVENTORY_KIND_META[kind] || INVENTORY_KIND_META.items;
    $('#viewerTitle').textContent = meta.title;
    $('#inventoryTotalLabel').textContent = meta.countLabel;
    $('#inventoryTotal').textContent = comma(inventoryCount(kind, data));
    $$('.inv-kind-tab').forEach(button => {
        const active = button.dataset.kind === kind;
        button.classList.toggle('active', active);
        button.setAttribute('aria-selected', String(active));
    });
}

function inventoryMatches(value, query) {
    return !query || String(value || '').toLocaleLowerCase('ko-KR').includes(query);
}

function renderInventoryData(kind, data) {
    const query = String($('#inventorySearch') && $('#inventorySearch').value || '').trim().toLocaleLowerCase('ko-KR');
    const emptySearch = el('div', { class: 'empty inventory-empty' }, query ? '검색 결과가 없습니다.' : '보유 항목이 없습니다.');
    updateInventoryChrome(kind, data);
    if (kind === 'items') {
        const sections = [];
        const matchedItems = data.items.filter(item => inventoryMatches(item.name, query));
        ITEM_TYPE_ORDER.forEach(type => {
            const filtered = matchedItems.filter(item => item.type === type).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
            if (filtered.length) sections.push(categorySection(type, [el('div', { class: 'inv-grid' }, ...filtered.map(invItemCell))]));
        });
        const unknown = matchedItems.filter(item => !ITEM_TYPE_ORDER.includes(item.type)).sort((a, b) => a.name.localeCompare(b.name, 'ko-KR'));
        if (unknown.length) sections.push(categorySection('기타', [el('div', { class: 'inv-grid' }, ...unknown.map(invItemCell))]));
        $('#viewer').replaceChildren(...(sections.length ? sections : [emptySearch]));
    }
    if (kind === 'cards') {
        const cards = data.cards.filter(card => inventoryMatches(card.formatted || card.name, query));
        $('#viewer').replaceChildren(cards.length ? el('div', { class: 'card-grid inventory-card-grid' }, cards.map(card => cardNode(card, true, openInventoryCardModal))) : emptySearch);
    }
    if (kind === 'equipment') {
        const sections = [];
        const equipment = data.equipment.filter(eq => inventoryMatches(eq.name, query));
        EQUIP_TYPE_ORDER.forEach(([type, label]) => {
            const filtered = equipment.filter(eq => eq.type === type);
            if (filtered.length) sections.push(categorySection(label, [el('div', { class: 'equip-grid inventory-equip-grid' }, filtered.map(equipmentCard))]));
        });
        $('#viewer').replaceChildren(...(sections.length ? sections : [emptySearch]));
    }
    if (kind === 'pet') {
        const pets = data.pet.filter(pet => inventoryMatches(pet.name, query));
        $('#viewer').replaceChildren(pets.length ? el('div', { class: 'equip-grid inventory-equip-grid inventory-pet-grid' }, pets.map(petCard)) : emptySearch);
    }
}

async function loadInventory(kind) {
    currentInventoryKind = kind;
    currentInventoryData = null;
    if ($('#inventorySearch')) $('#inventorySearch').value = '';
    $$('.inv-kind-tab').forEach(b => b.classList.toggle('active', b.dataset.kind === kind));
    $('#viewer').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    const url = currentInventoryName && myName && currentInventoryName !== myName
        ? '/api/inventory/' + kind + '/' + encodeURIComponent(currentInventoryName)
        : '/api/inventory/' + kind;
    const data = await api(url);
    currentInventoryData = data;
    renderInventoryData(kind, data);
}

$$('.inv-kind-tab').forEach(btn => btn.onclick = () => loadInventory(btn.dataset.kind).catch(e => $('#viewer').replaceChildren(el('div', { class: 'empty err' }, e.message))));
if ($('#inventorySearch')) $('#inventorySearch').oninput = () => {
    if (currentInventoryData) renderInventoryData(currentInventoryKind, currentInventoryData);
};
if ($('#inventorySearchClear')) $('#inventorySearchClear').onclick = () => {
    $('#inventorySearch').value = '';
    $('#inventorySearch').focus();
    if (currentInventoryData) renderInventoryData(currentInventoryKind, currentInventoryData);
};

// ===== 이벤트: 유생의 주사위 =====

const EVENT_DICE_REWARDS = {
    3:  { name: '축복받은 장비 보호권', count: 1,  mult: 170 },
    4:  { name: '고급 장비 보호권',     count: 1,  mult: 60 },
    5:  { name: '고급 패션 적용권',     count: 1,  mult: 30 },
    6:  { name: '장비 보호권',          count: 1,  mult: 16 },
    7:  { name: '패션 적용권',          count: 1,  mult: 11 },
    8:  { name: '지니어스의 열쇠',      count: 10, mult: 8 },
    9:  { name: '딜러 지렁이',          count: 20, mult: 6 },
    10: { name: '화이트 쥬얼',          count: 1,  mult: 5 },
    11: { name: '화이트 쥬얼',          count: 1,  mult: 5 },
    12: { name: '익명 지렁이',          count: 20, mult: 6 },
    13: { name: '캐릭터 변환석',        count: 2,  mult: 8 },
    14: { name: '7성 카드팩',           count: 1,  mult: 11 },
    15: { name: '8성 보호 카드',         count: 1,  mult: 16 },
    16: { name: '8성 카드팩',           count: 1,  mult: 30 },
    17: { name: '9성 카드팩',           count: 1,  mult: 60 },
    18: { name: '제타 카드팩',          count: 1,  mult: 170 }
};
const EVENT_DICE_SUMS = Object.keys(EVENT_DICE_REWARDS).map(Number);
const EVENT_DICE_PIPS = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9]
};
const EVENT_DICE_FACE_ANGLE = {
    1: { x: 0, y: 0 },
    2: { x: 0, y: -90 },
    3: { x: -90, y: 0 },
    4: { x: 90, y: 0 },
    5: { x: 0, y: 90 },
    6: { x: 0, y: 180 }
};
let eventDiceState = { built: false, loading: false, rolling: false, prediction: null, dice: [null, null, null], result: null, history: [], diceItemCount: 0, rewards: null, lightningSum: null, lightningBolt: null, error: '' };
let eventLightningTimer = null;

function formatEventDiceEndDate() {
    return new Date(EVENT_DICE_END_TS).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

let eventDiceEndTimer = null;
function scheduleEventDiceEndRedirect() {
    if (EVENT_DICE_ENDED || eventDiceEndTimer) return;
    const delay = EVENT_DICE_END_TS - Date.now();
    if (delay <= 0) { location.href = '/?tab=' + encodeURIComponent('펀치기계'); return; }
    eventDiceEndTimer = setTimeout(() => {
        if (activePage === 'event') location.href = '/?tab=' + encodeURIComponent('펀치기계');
    }, delay);
}

// ===== 봉인된 자물쇠 탭 =====
const lockboxUi = name => '/lockbox-ui?file=' + encodeURIComponent(name);

function loadLockbox() {
    const root = $('#lockboxRoot');
    if (!root) return;
    const title = el('img', { class: 'lockbox-title', src: lockboxUi('글씨.png'), alt: '봉인된 자물쇠' });
    const item = el('img', { class: 'lockbox-item', src: lockboxUi('이달의 아이템.png'), alt: '이달의 아이템' });
    const char = el('img', { class: 'lockbox-char', src: lockboxUi('캐릭터.png'), alt: '' });
    const btns = el('div', { class: 'lockbox-btns' });
    btns.appendChild(el('button', { class: 'lockbox-btn', style: "background-image:url('" + lockboxUi('1회 열기 버튼.png') + "')", onclick: () => openLockbox(1) }));
    btns.appendChild(el('button', { class: 'lockbox-btn', style: "background-image:url('" + lockboxUi('10회 열기 버튼.png') + "')", onclick: () => openLockbox(10) }));
    root.replaceChildren(title, item, char, btns);
}

function generateEventLightningBolt(targetX, targetY) {
    const pts = [];
    const numSegs = 10 + Math.floor(Math.random() * 6);
    const startX = targetX + (Math.random() - 0.5) * 100;
    pts.push([startX, -30]);
    for (let i = 1; i < numSegs; i++) {
        const t = i / numSegs;
        const spread = 85 * (1 - Math.pow(t, 1.6)) + 8;
        const cx = startX + (targetX - startX) * t;
        pts.push([cx + (Math.random() - 0.5) * spread * 2, targetY * t]);
    }
    pts.push([targetX, targetY]);
    const main = pts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
    const branches = [];
    const numBranches = 2 + Math.floor(Math.random() * 2);
    for (let b = 0; b < numBranches; b++) {
        const idx = 2 + Math.floor(Math.random() * Math.floor(pts.length * 0.5));
        if (idx >= pts.length) continue;
        const [bx, by] = pts[idx];
        const len = 30 + Math.random() * 60;
        const angle = (Math.random() - 0.5) * Math.PI * 1.1;
        const bPts = [[bx, by]];
        const bSegs = 2 + Math.floor(Math.random() * 2);
        for (let s = 1; s <= bSegs; s++) {
            const t = s / bSegs;
            bPts.push([
                bx + Math.sin(angle) * len * t + (Math.random() - 0.5) * 14,
                by + Math.abs(Math.cos(angle)) * len * t
            ]);
        }
        branches.push(bPts.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' '));
    }
    return { main, branches, width: window.innerWidth, height: window.innerHeight };
}

function renderEventLightningBolt() {
    const bolt = eventDiceState.lightningBolt;
    if (!bolt) return null;
    const branchSvg = bolt.branches.map(b => '<g><path d="' + b + '" stroke="rgba(255,240,80,0.4)" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#eventBoltBlur)"/><path d="' + b + '" stroke="rgba(255,255,200,0.82)" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>').join('');
    return svgIcon('<svg class="event-lightning-bolt-svg" width="' + bolt.width + '" height="' + bolt.height + '" viewBox="0 0 ' + bolt.width + ' ' + bolt.height + '"><defs><filter id="eventBoltBlur"><feGaussianBlur stdDeviation="5"/></filter></defs><path d="' + bolt.main + '" stroke="rgba(255,220,40,0.3)" stroke-width="22" fill="none" stroke-linecap="round" stroke-linejoin="round" filter="url(#eventBoltBlur)"/><path d="' + bolt.main + '" stroke="rgba(255,240,100,0.65)" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="' + bolt.main + '" stroke="rgba(255,255,230,0.98)" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' + branchSvg + '</svg>');
}

function triggerEventLightning(sum) {
    eventDiceState.lightningSum = sum;
    eventDiceState.lightningBolt = null;
    renderEventDice();
    requestAnimationFrame(() => {
        const target = document.querySelector('[data-event-lit="true"]');
        if (!target) return;
        const rect = target.getBoundingClientRect();
        eventDiceState.lightningBolt = generateEventLightningBolt(rect.left + rect.width / 2, rect.top + rect.height / 2);
        renderEventDice();
        if (eventLightningTimer) clearTimeout(eventLightningTimer);
        eventLightningTimer = setTimeout(() => {
            eventDiceState.lightningBolt = null;
            renderEventDice();
        }, 580);
    });
}

function eventRewardIcon(reward, sizeClass) {
    return el('div', { class: 'event-reward-thumb ' + (sizeClass || '') },
        reward.frameUrl ? el('img', { class: 'event-reward-frame', src: reward.frameUrl, alt: '' }) : null,
        reward.iconUrl ? el('img', { class: 'event-reward-icon', src: reward.iconUrl, alt: reward.name, onload: e => { if (e.currentTarget.nextSibling) e.currentTarget.nextSibling.style.display = 'none'; }, onerror: e => { e.currentTarget.style.display = 'none'; } }) : null,
        el('span', { class: 'event-reward-fallback' }, reward.name.slice(0, 1))
    );
}

function eventDie(value, index) {
    const faceAngle = value ? EVENT_DICE_FACE_ANGLE[value] : null;
    const transform = faceAngle ? 'rotateX(' + (faceAngle.x + 360 * (index + 1)) + 'deg) rotateY(' + (faceAngle.y + 360 * (index + 1)) + 'deg)' : '';
    const hit = eventDiceState.result && eventDiceState.result.prediction === eventDiceState.result.sum;
    const outcome = eventDiceState.result ? (hit ? ' win' : ' lose') : '';
    const stateClass = eventDiceState.rolling ? 'rolling' : value ? 'result' : 'idle';
    return el('div', { class: 'event-die ' + stateClass + outcome },
        el('div', { class: 'event-cube-settle' },
            el('div', { class: 'event-cube', style: transform ? { transform } : null },
                [1, 2, 3, 4, 5, 6].map(v =>
                    el('div', { class: 'event-face event-face' + v },
                        Array.from({ length: 9 }, (_, i) => el('span', { class: EVENT_DICE_PIPS[v].includes(i + 1) ? 'event-die-pip' : 'event-die-empty' }))
                    )
                )
            )
        )
    );
}

function eventRewardName(reward) {
    return reward.name + ' x' + comma(reward.count);
}

function renderEventDiceResult() {
    const result = eventDiceState.result;
    if (!result) {
        return el('div', { class: 'event-result-card waiting' },
            el('div', { class: 'event-result-kicker' }, eventDiceState.prediction ? 'READY' : 'PICK A SUM'),
            el('div', { class: 'event-result-title' }, eventDiceState.prediction ? '합계 ' + eventDiceState.prediction + ' 예측' : '합을 먼저 선택하세요'),
            el('div', { class: 'event-result-sub' }, '굴릴 때 유생의 주사위 1개가 소모됩니다.')
        );
    }
    const hit = result.prediction === result.sum;
    return el('div', { class: 'event-result-card hit ' + (hit ? 'win' : 'lose') + (result.lightning ? ' lightning' : '') },
        el('div', { class: 'event-result-kicker' }, hit ? 'PREDICTION HIT' : 'RESULT'),
        el('div', { class: 'event-result-title' }, '합계 ' + result.sum),
        el('div', { class: hit ? 'event-hit-label yes' : 'event-hit-label no' }, hit ? '예측 성공' : '예측 실패'),
        result.lightning ? el('div', { class: 'event-lightning-hit' }, el('span', { class: 'event-lit-bolt' }, '⚡'), '라이트닝 보상 2배') : null,
        el('div', { class: 'event-result-reward' },
            eventRewardIcon(result.reward, 'large'),
            el('div', null,
                el('div', { class: 'event-result-reward-name' }, result.reward.name),
                el('div', { class: 'event-result-reward-count' }, 'x' + comma(result.reward.count))
            )
        )
    );
}

function renderEventDiceRewardGrid() {
    const rewards = eventDiceState.rewards || EVENT_DICE_REWARDS;
    return el('div', { class: 'event-reward-grid' },
        EVENT_DICE_SUMS.map(sum => {
            const reward = rewards[sum] || EVENT_DICE_REWARDS[sum];
            const active = eventDiceState.result && eventDiceState.result.sum === sum;
            const picked = eventDiceState.prediction === sum;
            const lightning = eventDiceState.lightningSum === sum;
            return el('button', {
                class: 'event-reward-cell' + (active ? ' active' : '') + (picked ? ' picked' : '') + (lightning ? ' lightning lightning-striking' : ''),
                type: 'button',
                'data-event-lit': lightning ? 'true' : null,
                disabled: eventDiceState.rolling,
                onclick: () => { eventDiceState.prediction = sum; eventDiceState.result = null; renderEventDice(); }
            },
                lightning ? [el('div', { class: 'event-slot-spark' }), el('div', { class: 'event-slot-spark' }), el('div', { class: 'event-slot-spark' })] : null,
                el('div', { class: 'event-reward-sum' }, lightning ? el('span', { class: 'event-lit-bolt' }, '⚡') : null, sum),
                eventRewardIcon(reward),
                el('div', { class: 'event-reward-name' }, reward.name),
                el('div', { class: 'event-reward-count' }, 'x' + comma(reward.count) + (lightning ? ' → x' + comma(reward.count * 2) : ''))
            );
        })
    );
}

function renderEventDiceHistory() {
    if (!eventDiceState.history.length) return el('div', { class: 'event-history-empty' }, '아직 기록이 없습니다.');
    return el('div', { class: 'event-history-list' },
        eventDiceState.history.map(item =>
            el('div', { class: 'event-history-row' },
                el('span', { class: 'event-history-sum' }, item.sum),
                el('span', { class: 'event-history-dice' }, item.dice.join(' + ')),
                el('span', { class: 'event-history-reward' }, eventRewardName(item.reward)),
                el('span', { class: item.prediction === item.sum ? 'event-history-hit yes' : 'event-history-hit no' }, item.prediction === item.sum ? 'HIT' : 'MISS')
            )
        )
    );
}

function renderEventDice() {
    const root = $('#eventDiceRoot');
    if (!root) return;
    const dice = eventDiceState.dice;
    const canRoll = eventDiceState.prediction !== null && eventDiceState.diceItemCount > 0 && !eventDiceState.rolling && !eventDiceState.loading;
    const rollBtn = el('button', {
        class: 'event-roll-btn primary',
        type: 'button',
        disabled: !canRoll,
        onclick: rollEventDice
    }, eventDiceState.rolling ? '굴리는 중...' : eventDiceState.prediction === null ? '합을 선택하세요' : eventDiceState.diceItemCount <= 0 ? '유생의 주사위 부족' : '주사위 굴리기');

    const effects = [];
    if (eventDiceState.result) {
        const hit = eventDiceState.result.prediction === eventDiceState.result.sum;
        effects.push(el('div', { class: 'event-screen-flash ' + (hit ? 'win' : 'lose') }));
        effects.push(el('div', { class: 'event-outcome-burst ' + (hit ? 'win' : 'lose') }, hit ? '예측 성공' : '예측 실패'));
    }

    if (eventDiceState.lightningBolt) {
        effects.push(el('div', { class: 'event-lightning-flash' }));
        effects.push(renderEventLightningBolt());
    }

    root.replaceChildren(
        ...effects,
        el('div', { class: 'event-dice-main' },
            el('div', { class: 'event-title-block' },
                el('div', { class: 'event-eyebrow' }, 'EVENT'),
                el('h2', null, '유생의 주사위'),
                el('div', { class: 'event-subcopy' }, '합을 예측한 뒤 주사위를 굴려 보상을 획득합니다.'),
                el('div', { class: 'event-end-date' }, '이벤트 종료: ' + formatEventDiceEndDate())
            ),
            el('div', { class: 'event-dice-row' }, dice.map((value, index) => eventDie(value, index))),
            renderEventDiceResult(),
            el('div', { class: 'event-ticket-line' },
                el('span', null, '보유 유생의 주사위'),
                el('b', null, comma(eventDiceState.diceItemCount) + '개')
            ),
            rollBtn
        ),
        el('div', { class: 'event-dice-side' },
            el('div', { class: 'event-panel-title' }, '합 예측'),
            renderEventDiceRewardGrid(),
            eventDiceState.error ? el('div', { class: 'event-error' }, eventDiceState.error) : null,
            el('div', { class: 'event-panel-title event-history-title' }, '최근 결과'),
            renderEventDiceHistory()
        )
    );
}

async function rollEventDice() {
    if (eventDiceState.rolling || eventDiceState.prediction === null) return;
    eventDiceState.rolling = true;
    eventDiceState.result = null;
    eventDiceState.lightningSum = null;
    eventDiceState.lightningBolt = null;
    eventDiceState.error = '';
    renderEventDice();
    try {
        const minSpin = new Promise(resolve => setTimeout(resolve, 1100));
        const req = postApi('/api/event/dice/roll', { prediction: eventDiceState.prediction }).then(data => {
            if (data.lightningSum) triggerEventLightning(data.lightningSum);
            return data;
        });
        const [data] = await Promise.all([req, minSpin]);
        eventDiceState = Object.assign(eventDiceState, {
            rolling: false,
            dice: data.dice,
            diceItemCount: data.diceItemCount,
            result: data,
            history: [data].concat(eventDiceState.history).slice(0, 5)
        });
    } catch (e) {
        eventDiceState.rolling = false;
        eventDiceState.error = e.message;
    }
    renderEventDice();
}

async function loadEventDice() {
    scheduleEventDiceEndRedirect();
    const root = $('#eventDiceRoot');
    if (root && !eventDiceState.built) root.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    if (!eventDiceState.built) eventDiceState.built = true;
    eventDiceState.loading = true;
    try {
        const data = await api('/api/event/dice');
        if (data.ended) {
            eventDiceState.loading = false;
            location.href = '/?tab=' + encodeURIComponent('펀치기계');
            return;
        }
        eventDiceState.diceItemCount = data.diceItemCount || 0;
        eventDiceState.rewards = data.rewards || null;
        eventDiceState.error = '';
    } catch (e) {
        eventDiceState.error = e.message;
    }
    eventDiceState.loading = false;
    renderEventDice();
}

// 모달 닫기 잠금(9999 선택 등 반드시 선택해야 하는 경우 백드롭/닫기 무효화).
let modalLocked = false;
function setModalCloseVisible(v) {
    const btn = $('#modalClose');
    if (btn) btn.style.display = v ? '' : 'none';
}

// ===== 장착 프리셋 =====
let presetState = { data: null, busy: false };

async function loadPresets() {
    const root = $('#presetRoot');
    if (!root) return;
    try {
        presetState.data = await api('/api/presets');
    } catch (e) {
        root.replaceChildren(el('div', { class: 'empty err' }, e.message));
        return;
    }
    renderPresets();
}

function presetSavedAtText(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('ko-KR') + ' ' + d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + ' 저장';
}

async function savePresetSlot(slot, overwrite) {
    if (presetState.busy) return;
    if (overwrite && !(await showConfirm('프리셋 ' + (slot + 1) + '번을 현재 장착 상태로 덮어쓸까요?'))) return;
    presetState.busy = true;
    showLoading();
    try {
        presetState.data = await postApi('/api/presets/save', { slot });
        renderPresets();
    } catch (e) {
        showAlert(e.message);
    } finally {
        presetState.busy = false;
        hideLoading();
    }
}

async function applyPresetSlot(slot) {
    if (presetState.busy) return;
    if (!(await showConfirm('프리셋 ' + (slot + 1) + '번을 적용할까요?\n현재 장착 중인 장비/카드가 프리셋 상태로 변경됩니다.'))) return;
    presetState.busy = true;
    showLoading();
    try {
        const r = await postApi('/api/presets/apply', { slot });
        presetState.data = r;
        renderPresets();
        if (r.profile) renderProfile(r.profile);
        if (Array.isArray(r.warnings) && r.warnings.length) showAlert('일부 항목을 적용하지 못했습니다.\n- ' + r.warnings.join('\n- '));
    } catch (e) {
        showAlert(e.message);
    } finally {
        presetState.busy = false;
        hideLoading();
    }
}

// 해금 구매 모달 (상점식 가격 계산서)
function openPresetUnlockModal(slot, cost) {
    $('#modalTitle').textContent = '프리셋 슬롯 해금';
    $('#modalSub').style.display = 'none';
    const d = presetState.data;
    const bal = cost.currency === 'garnet' ? Number(d.garnet || 0) : Number(d.point || 0);
    const after = bal - cost.amount;
    const receiptRow = (label, amount, variant) => el('div', { class: 'shop-receipt-row' + (variant ? ' ' + variant : '') },
        el('span', { class: 'shop-receipt-label' }, label),
        el('div', { class: 'shop-receipt-val' },
            cost.iconUrl ? el('img', { src: cost.iconUrl, alt: '', style: 'width:16px;height:16px;object-fit:contain' }) : null,
            el('span', null, comma(Math.abs(amount)))));
    const btn = el('button', { class: 'burning-unlock-btn' }, '해금하기');
    btn.onclick = async () => {
        btn.disabled = true;
        try {
            presetState.data = await postApi('/api/presets/unlock', { slot });
            closeModal();
            renderPresets();
        } catch (e) { showAlert(e.message); btn.disabled = false; }
    };
    const body = el('div', { class: 'burning-unlock-modal' },
        el('div', { class: 'burning-unlock-icon' }, '🔓'),
        el('div', { class: 'burning-unlock-desc' }, (slot + 1) + '번 프리셋 슬롯을 해금하시겠습니까?'),
        el('div', { class: 'shop-receipt preset-unlock-receipt' },
            receiptRow('현재 보유', bal),
            receiptRow('소모', cost.amount, 'deduct'),
            el('div', { class: 'shop-receipt-divider' }),
            receiptRow('해금 후 잔액', after, after < 0 ? 'neg' : 'result')),
        btn);
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

// 고정 장비 슬롯 배치: 한 줄(무기~신발) + 한 줄(장신구x3, 보조)
const PRESET_GEAR_LAYOUT = [
    { type: 'weapon', label: '무기' }, { type: 'hat', label: '모자' }, { type: 'armor', label: '갑옷' },
    { type: 'pants', label: '하의' }, { type: 'shoes', label: '신발' },
    { type: 'accessory', label: '장신구' }, { type: 'accessory', label: '장신구' }, { type: 'accessory', label: '장신구' },
    { type: 'support', label: '보조' }
];
const PRESET_EMPTY_GEAR_FRAME_URL = '/item-image?dir=' + encodeURIComponent('프레임') + '&file=' + encodeURIComponent('[장비]일반.png');
const PRESET_EMPTY_CARD_URL = '/static/assets/preset-empty-card.png';

function presetSlotIcon(type) {
    return svgIcon(REG_SLOT_SVGS[type] || REG_SLOT_SVGS.armor);
}

function presetGearTile(eq, slotDef) {
    if (!eq) return el('div', { class: 'preset-gear-tile empty', title: slotDef.label + ' 미장착' },
        el('img', { class: 'preset-gear-frame', src: PRESET_EMPTY_GEAR_FRAME_URL, alt: '' }),
        el('span', { class: 'preset-gear-ph' }, presetSlotIcon(slotDef.type)));
    return el('div', { class: 'preset-gear-tile', title: '<' + eq.rarity + '> ' + eq.name + (eq.level > 0 ? ' +' + eq.level : '') },
        eq.frameUrl ? el('img', { class: 'preset-gear-frame', src: eq.frameUrl, alt: '' }) : null,
        eq.iconUrl ? el('img', { class: 'preset-gear-icon', src: eq.iconUrl, alt: eq.name }) : el('span', { class: 'preset-gear-fallback' }, presetSlotIcon(eq.type)),
        eq.level > 0 ? el('b', { class: 'preset-gear-lv' }, '+' + eq.level) : null);
}

function presetTitle(slot, preset) {
    return (preset && preset.name) || ('프리셋 ' + (slot + 1));
}

async function renamePreset(slot) {
    const preset = presetState.data.presets[slot];
    if (!preset) return;
    const name = await showPrompt('프리셋 이름 (최대 12자, 비우면 기본 이름)', preset.name || '', 12);
    if (name === null) return;
    try {
        presetState.data = await postApi('/api/presets/rename', { slot, name: name.trim() });
        renderPresets();
    } catch (e) { showAlert(e.message); }
}

function presetCard(slot) {
    const d = presetState.data;
    const preset = d.presets[slot];
    const unlocked = slot < d.unlocked;
    const head = el('div', { class: 'preset-card-head' },
        el('span', { class: 'preset-no' }, String(slot + 1)),
        el('b', null, presetTitle(slot, preset)),
        preset ? el('button', { class: 'preset-rename', type: 'button', title: '이름 변경', onclick: e => { e.stopPropagation(); renamePreset(slot); } }, '✎') : null,
        preset ? el('span', { class: 'preset-savedat' }, presetSavedAtText(preset.savedAt)) : null);

    if (!unlocked) {
        const cost = d.costs[slot];
        return el('div', { class: 'preset-card locked' }, head,
            el('div', { class: 'preset-locked-body' },
                el('div', { class: 'preset-lock-well' }, '🔒'),
                cost ? el('div', { class: 'preset-lock-cost' },
                    cost.iconUrl ? el('img', { src: cost.iconUrl, alt: '' }) : null,
                    el('b', null, cost.label)) : null,
                el('button', { class: 'primary preset-btn', onclick: () => openPresetUnlockModal(slot, cost) }, '해금하기')));
    }

    if (!preset) {
        return el('div', { class: 'preset-card empty-slot' }, head,
            el('div', { class: 'preset-empty-body' },
                el('div', { class: 'preset-empty-plus' }, '+'),
                el('button', { class: 'primary preset-btn', onclick: () => savePresetSlot(slot, false) }, '현재 장착 저장')));
    }

    // 장비를 고정 슬롯 배치에 매핑
    const byType = {};
    preset.equipment.forEach(eq => { (byType[eq.type] = byType[eq.type] || []).push(eq); });
    const used = {};
    const gearGrid = el('div', { class: 'preset-gear-grid' },
        PRESET_GEAR_LAYOUT.map(slotDef => {
            const list = byType[slotDef.type] || [];
            const idx = used[slotDef.type] = (used[slotDef.type] || 0);
            used[slotDef.type]++;
            return presetGearTile(list[idx] || null, slotDef);
        }));

    const mainName = preset.mainCard ? (preset.mainCard.formatted || preset.mainCard.name) : '';
    const portrait = preset.mainCard
        ? el('div', { class: 'preset-portrait', title: mainName },
            el('div', { class: 'preset-portrait-frame' },
                preset.mainCard.imageUrl ? el('img', { src: preset.mainCard.imageUrl, alt: mainName }) : null),
            el('span', { class: 'preset-portrait-name' }, mainName))
        : el('div', { class: 'preset-portrait none' },
            el('div', { class: 'preset-portrait-frame' }, el('img', { src: PRESET_EMPTY_CARD_URL, alt: '메인 카드 미장착' })),
            el('span', { class: 'preset-portrait-name' }, '미장착'));

    const slotCardCells = Array.from({ length: 5 }, (_, i) => {
        const c = preset.slotCards[i];
        if (!c) return el('div', { class: 'preset-minicard empty', title: '슬롯 카드 미장착' },
            el('img', { src: PRESET_EMPTY_CARD_URL, alt: '슬롯 카드 미장착' }));
        return el('div', { class: 'preset-minicard', title: c.formatted || c.name },
            c.imageUrl ? el('img', { src: c.imageUrl, alt: c.formatted || c.name }) : null);
    });

    return el('div', {
        class: 'preset-card saved',
        role: 'button',
        tabIndex: 0,
        title: '프리셋 상세 보기',
        onclick: e => { if (!e.target.closest('button')) openPresetDetailModal(slot); },
        onkeydown: e => {
            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            openPresetDetailModal(slot);
        }
    }, head,
        el('div', { class: 'preset-loadout' },
            portrait,
            el('div', { class: 'preset-loadout-right' },
                gearGrid,
                el('div', { class: 'preset-slotcards-label' }, '슬롯 카드'),
                el('div', { class: 'preset-minicards' }, slotCardCells))),
        el('div', { class: 'preset-actions' },
            el('button', { class: 'primary preset-btn apply', onclick: () => applyPresetSlot(slot) }, '적용하기'),
            el('button', { class: 'preset-btn', onclick: () => savePresetSlot(slot, true) }, '덮어쓰기')));
}

// 프리셋 상세: 장비와 카드를 한 화면에서 빠르게 확인하는 압축형 로드아웃
function closePresetNestedModal() {
    const bg = document.querySelector('.preset-nested-bg');
    if (bg) bg.remove();
}

function openPresetNestedModal(title, sub, nodes, kind) {
    closePresetNestedModal();
    const close = el('button', { class: 'close', type: 'button', onclick: closePresetNestedModal }, '닫기');
    const dialog = el('div', {
        class: 'modal preset-nested-modal ' + kind,
        role: 'dialog',
        'aria-modal': 'true',
        tabIndex: -1
    },
    title ? el('h3', null, title) : null,
    sub ? el('div', { class: 'sub' }, sub) : null,
    el('div', { class: 'preset-nested-body' }, ...nodes),
    close);
    const bg = el('div', { class: 'preset-nested-bg' }, dialog);
    bg.onclick = e => { if (e.target === bg) closePresetNestedModal(); };
    document.body.appendChild(bg);
    dialog.focus({ preventScroll: true });
}

function openPresetNestedEquipmentModal(eq) {
    openPresetNestedModal('', '', equipmentModalView(eq, false), 'equipment');
}

function openPresetNestedCardModal(card, kind) {
    const main = kind === 'main';
    openPresetNestedModal(
        card.formatted || card.name,
        (card.starText || '') + (main ? ' · 스킬' : ' · 카드 슬롯 효과'),
        [el('div', { class: 'mc-body' }, ...(main ? mainCardDetailNodes(card) : cardSlotDetailNodes(card)))],
        'card'
    );
}

function presetDetailGearNode(typeKey, label, eq) {
    if (!eq) {
        return el('div', { class: 'preset-detail-gear-item empty' },
            el('span', { class: 'preset-detail-position' }, label),
            el('span', { class: 'preset-detail-gear-empty' },
                el('img', { src: PRESET_EMPTY_GEAR_FRAME_URL, alt: '' }),
                el('span', null, presetSlotIcon(typeKey))),
            el('strong', null, '미장착'));
    }
    const node = el('button', { class: 'preset-detail-gear-item filled', type: 'button', title: eq.name + ' 상세 보기', onclick: () => openPresetNestedEquipmentModal(eq) },
        el('span', { class: 'preset-detail-position' }, label),
        equipmentThumb(eq),
        el('span', { class: 'preset-detail-gear-copy' },
            el('strong', null, eq.name),
            el('small', null, eq.rarity)),
        eq.level > 0 ? el('b', { class: 'preset-detail-level' }, '+' + eq.level) : null);
    node.style.setProperty('--rar', RARITY_COLORS[eq.rarity] || '#334155');
    return applyRarityCardClass(node, eq.rarity);
}

function presetDetailCardNode(card, label, kind) {
    if (!card) {
        return el('div', { class: 'preset-detail-card empty ' + kind, title: label + ' 카드 미장착', 'aria-label': label + ' 카드 미장착' },
            el('img', { src: PRESET_EMPTY_CARD_URL, alt: '' }));
    }
    const name = card.formatted || card.name;
    return el('button', {
        class: 'preset-detail-card ' + kind,
        type: 'button',
        title: name + ' 상세 보기',
        'aria-label': label + ' 카드, ' + name + ' 상세 보기',
        onclick: () => openPresetNestedCardModal(card, kind)
    },
    card.imageUrl ? el('img', { src: card.imageUrl, alt: name }) : null);
}

function openPresetDetailModal(slot) {
    const preset = presetState.data.presets[slot];
    if (!preset) return;
    const byType = {};
    preset.equipment.forEach(e => { (byType[e.type] = byType[e.type] || []).push(e); });
    const gear = el('div', { class: 'preset-detail-gear' });
    [['weapon', '무기'], ['hat', '모자'], ['armor', '갑옷'], ['pants', '하의'], ['shoes', '신발']]
        .forEach(([t, l]) => gear.appendChild(presetDetailGearNode(t, l, (byType[t] || [])[0])));
    for (let i = 0; i < 3; i++) gear.appendChild(presetDetailGearNode('accessory', '장신구 ' + (i + 1), (byType.accessory || [])[i]));
    gear.appendChild(presetDetailGearNode('support', '보조', (byType.support || [])[0]));
    const slotCards = Array.from({ length: 5 }, (_, i) => presetDetailCardNode(preset.slotCards[i] || null, String(i + 1), 'slot'));
    const cards = el('div', { class: 'preset-detail-card-layout' },
        el('div', { class: 'preset-detail-main-wrap' },
            el('div', { class: 'preset-detail-slot-title' }, '메인 카드'),
            presetDetailCardNode(preset.mainCard, '메인', 'main')),
        el('div', { class: 'preset-detail-slot-wrap' },
            el('div', { class: 'preset-detail-slot-title' }, '슬롯 카드'),
            el('div', { class: 'preset-detail-slot-grid' }, slotCards)));
    const shell = el('div', { class: 'preset-detail-shell' },
        el('section', { class: 'preset-detail-section' },
            el('div', { class: 'preset-detail-section-head' }, el('h4', null, '장비 구성'), el('span', null, preset.equipment.length + ' / 9')),
            gear),
        el('section', { class: 'preset-detail-section cards' },
            el('div', { class: 'preset-detail-section-head' }, el('h4', null, '카드 구성'), el('span', null, (preset.mainCard ? 1 : 0) + preset.slotCards.length + ' / 6')),
            cards));
    openRichModal(presetTitle(slot, preset), presetSavedAtText(preset.savedAt), [shell]);
    setModalVariant('preset-detail');
}

function renderPresets() {
    const root = $('#presetRoot');
    const d = presetState.data;
    if (!root || !d) return;
    // 해금된 슬롯 + 다음 해금 대상 1개만 표시
    const visible = Math.min(d.slotCount, d.unlocked + 1);
    root.replaceChildren(el('div', { class: 'preset-grid' },
        Array.from({ length: visible }, (_, i) => presetCard(i))));
}

// ===== 사냥 메뉴 =====
// 카드 배경 이미지: DB/RPGenius/ui/사냥/<이름>.png (없으면 어두운 카드로 폴백)
const HUNT_MENU = [
    { key: '일반 필드', level: 'Lv.1 ~ 300', action: () => { location.href = '/field'; } },
    { key: '헬 필드', level: 'Lv.141 ~ 300', action: () => { location.href = '/hfield'; } },
    { key: '일일던전', level: 'Lv.101 ~ 300', action: null },
    { key: '월드보스', level: 'Lv.1 ~ 300', action: () => { location.href = '/worldboss'; } },
    { key: '레이드', level: 'Lv.71 ~ 300', action: () => {
        if (window.HAS_PARTY) location.href = '/party';
        else showAlert('레이드에 입장할 수 없습니다.');
    } }
];

function renderHuntMenu() {
    const root = $('#huntMenu');
    if (!root) return;
    root.replaceChildren(...HUNT_MENU.map(entry => {
        const img = el('img', {
            class: 'hunt-card-bg',
            src: '/rpg-ui?file=' + encodeURIComponent('사냥/' + entry.key + '.png'),
            alt: '',
            onerror: () => img.remove()
        });
        return el('button', {
            type: 'button',
            class: 'hunt-card',
            onclick: () => { if (entry.action) entry.action(); else showAlert('준비중입니다.'); }
        },
            img,
            el('span', { class: 'hunt-card-overlay' }),
            el('span', { class: 'hunt-card-text' },
                el('span', { class: 'hunt-card-name' }, entry.key),
                el('span', { class: 'hunt-card-level' }, entry.level)));
    }));
}

// ===== 퀘스트 게시판 =====
const questState = { list: [], selectedId: null, busy: false };
const QUEST_BADGE_CLASS = { '에픽': 'epic', '일일': 'daily', '주간': 'weekly', '일반': 'normal', '이벤트': 'event' };

async function loadQuests() {
    const listEl = $('#questList');
    if (!listEl) return;
    listEl.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/quests');
        questState.list = data.list || [];
        if (!questState.list.some(q => q.id === questState.selectedId)) questState.selectedId = null;
        renderQuests();
    } catch (e) {
        listEl.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

function questBadgeNode(quest) {
    return el('span', { class: 'quest-badge ' + (QUEST_BADGE_CLASS[quest.badge] || 'normal') }, quest.badge);
}

function renderQuests() {
    const listEl = $('#questList');
    if (!listEl) return;
    if (!questState.list.length) {
        listEl.replaceChildren(el('div', { class: 'empty' }, '진행할 수 있는 퀘스트가 없습니다.'));
        renderQuestDetail();
        return;
    }
    listEl.replaceChildren(...questState.list.map(quest =>
        el('button', {
            type: 'button',
            class: 'quest-row' + (quest.id === questState.selectedId ? ' on' : '') + (quest.claimed ? ' claimed' : ''),
            onclick: () => { questState.selectedId = quest.id; renderQuests(); }
        },
            questBadgeNode(quest),
            el('span', { class: 'quest-row-name ' + (QUEST_BADGE_CLASS[quest.badge] || 'normal') }, quest.name),
            quest.complete ? el('span', { class: 'quest-row-state ok' }, '완료') : (quest.claimed ? el('span', { class: 'quest-row-state done' }, '수령됨') : null)
        )
    ));
    renderQuestDetail();
}

function renderQuestDetail() {
    const detail = $('#questDetail');
    if (!detail) return;
    const quest = questState.list.find(item => item.id === questState.selectedId);
    if (!quest) {
        detail.replaceChildren(el('div', { class: 'empty' }, questState.list.length ? '퀘스트를 선택하세요.' : '표시할 퀘스트가 없습니다.'));
        return;
    }
    const head = el('div', { class: 'quest-detail-head' },
        el('div', { class: 'quest-detail-title' }, questBadgeNode(quest), el('h2', null, quest.name)),
        el('span', { class: 'quest-level' },
            '수행 가능 Lv.' + quest.minLevel + ' ~ ' + quest.maxLevel
            + (quest.resetType ? ' · ' + quest.resetType + ' 초기화' : '')
            + (quest.epicOrder ? ' · 에픽 ' + quest.epicOrder + '번' : ''))
    );
    const desc = el('p', { class: 'quest-desc' }, quest.desc || '설명이 없습니다.');
    const objectives = el('div', { class: 'quest-section' },
        el('h3', null, '목표'),
        ...(quest.objectives.length ? quest.objectives.map(objective => {
            const pct = Math.min(100, Math.round(objective.current / Math.max(1, objective.target) * 100));
            return el('div', { class: 'quest-objective' + (objective.done ? ' done' : '') },
                el('div', { class: 'quest-objective-row' },
                    el('span', { class: 'quest-objective-label' },
                        objective.iconUrl ? el('img', { class: 'quest-obj-icon', src: objective.iconUrl, alt: '' }) : null,
                        objective.label),
                    el('span', { class: 'quest-objective-count' }, comma(objective.current) + ' / ' + comma(objective.target))),
                el('div', { class: 'quest-progress' }, el('div', { class: 'quest-progress-fill', style: { width: pct + '%' } })));
        }) : [el('div', { class: 'quest-empty-note' }, '목표가 설정되지 않은 퀘스트입니다.')])
    );
    const rewards = el('div', { class: 'quest-section' },
        el('h3', null, '보상'),
        quest.rewards.length
            ? el('div', { class: 'quest-reward-list' }, ...quest.rewards.map(reward =>
                el('span', { class: 'quest-reward' },
                    reward.iconUrl ? el('img', { src: reward.iconUrl, alt: '' }) : null,
                    reward.label)))
            : el('div', { class: 'quest-empty-note' }, '보상이 없습니다.')
    );
    const actions = el('div', { class: 'quest-actions' });
    if (quest.claimed) {
        actions.appendChild(el('span', { class: 'quest-claimed-note' },
            '보상 수령 완료' + (quest.resetType ? ' — ' + quest.resetType + ' 초기화 후 다시 진행할 수 있습니다.' : '')));
    } else {
        actions.appendChild(el('button', { class: 'primary', type: 'button', disabled: !quest.complete || questState.busy, onclick: () => claimQuest(quest, false) }, '보상 받기'));
        if (quest.canSkip) actions.appendChild(el('button', { class: 'quest-skip-btn', type: 'button', disabled: questState.busy, onclick: () => claimQuest(quest, true) }, '스킵 (보상 수령)'));
    }
    detail.replaceChildren(head, desc, objectives, rewards, actions);
}

const QUEST_REWARD_CURRENCY_ICONS = {
    '골드': '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png'),
    '가넷': '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png'),
    '포인트': '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('포인트.png')
};

function parseQuestRewardLine(line) {
    const text = String(line || '').replace(/^\s*-\s*/, '').trim();
    if (!text) return null;
    if (/^레벨업!/.test(text)) return { levelUp: text };
    const exp = text.match(/^XP\s+(.+)$/i);
    if (exp) return { name: '경험치', count: '+' + exp[1], type: '경험치' };
    const point = text.match(/^💰\s*([\d,]+)P$/);
    if (point) return { name: '포인트', count: '+' + point[1] + 'P', type: '포인트' };
    const counted = text.match(/^(.*?)\s+x([\d,]+)$/);
    const rawName = (counted ? counted[1] : text).trim();
    const type = ['골드', '가넷', '마일리지', '포인트', '칭호'].find(value => rawName.includes(value)) || '';
    const name = rawName.replace(/^(?:🪙|💠|Ⓜ️|🏅)\s*/u, '');
    return { name: name, count: counted ? 'x' + counted[2] : '', type: type };
}

function questRewardVisual(result, configured, usedIndexes) {
    let matchIndex = -1;
    if (result.type) matchIndex = configured.findIndex((reward, index) => !usedIndexes.has(index) && reward.type === result.type);
    if (matchIndex < 0) {
        const resultName = result.name.replace(/[<\[（(].*?[>\]）)]/g, '').replace(/[^0-9A-Za-z가-힣]/g, '');
        matchIndex = configured.findIndex((reward, index) => {
            if (usedIndexes.has(index)) return false;
            const rewardName = String(reward.label || '').replace(/\s+x[\d,~]+.*$/i, '').replace(/[^0-9A-Za-z가-힣]/g, '');
            return resultName && rewardName && (resultName.includes(rewardName) || rewardName.includes(resultName));
        });
    }
    if (matchIndex >= 0) usedIndexes.add(matchIndex);
    const reward = matchIndex >= 0 ? configured[matchIndex] : null;
    return {
        iconUrl: reward && reward.iconUrl ? reward.iconUrl : QUEST_REWARD_CURRENCY_ICONS[result.type] || null,
        fallback: result.type === '경험치' ? 'XP' : result.type === '마일리지' ? 'M' : result.type === '칭호' ? '★' : '◆'
    };
}

function showQuestRewardModal(quest, result) {
    const parsed = (result.lines || []).map(parseQuestRewardLine).filter(Boolean);
    const rewards = parsed.filter(item => !item.levelUp);
    const levelUp = parsed.find(item => item.levelUp);
    const usedIndexes = new Set();
    const rewardList = el('div', { class: 'quest-claim-rewards' });
    if (rewards.length) {
        rewards.forEach((reward, index) => {
            const visual = questRewardVisual(reward, quest.rewards || [], usedIndexes);
            rewardList.appendChild(el('div', { class: 'quest-claim-reward', style: { '--reward-delay': (index * 55) + 'ms' } },
                el('div', { class: 'quest-claim-icon' },
                    visual.iconUrl
                        ? el('img', { src: visual.iconUrl, alt: reward.name })
                        : el('span', { class: 'quest-claim-fallback' }, visual.fallback)),
                el('div', { class: 'quest-claim-reward-copy' },
                    el('span', { class: 'quest-claim-reward-label' }, '획득 보상'),
                    el('strong', null, reward.name)),
                reward.count ? el('b', { class: 'quest-claim-count' }, reward.count) : null));
        });
    } else {
        rewardList.appendChild(el('div', { class: 'quest-claim-empty' }, '보상이 인벤토리에 지급되었습니다.'));
    }

    const bg = el('div', { class: 'quest-claim-modal-bg' });
    const close = () => bg.remove();
    const closeBtn = el('button', { class: 'quest-claim-confirm', type: 'button', onclick: close }, '확인');
    const modal = el('section', { class: 'quest-claim-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'questClaimTitle' },
        el('div', { class: 'quest-claim-shine', 'aria-hidden': 'true' }),
        el('div', { class: 'quest-claim-hero' },
            el('div', { class: 'quest-claim-seal', 'aria-hidden': 'true' },
                svgIcon('<svg viewBox="0 0 24 24" fill="none"><path d="m7 12 3.2 3.2L17.5 8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>')),
            el('span', { class: 'quest-claim-eyebrow' }, result.skipped ? 'QUEST SKIPPED' : 'QUEST COMPLETE'),
            el('h2', { id: 'questClaimTitle' }, '보상을 획득했어요'),
            el('p', null, result.name || quest.name)),
        el('div', { class: 'quest-claim-body' },
            rewardList,
            levelUp ? el('div', { class: 'quest-claim-levelup' },
                el('span', { 'aria-hidden': 'true' }, '↑'),
                el('strong', null, levelUp.levelUp)) : null),
        el('div', { class: 'quest-claim-footer' }, closeBtn));
    bg.appendChild(modal);
    bg.addEventListener('click', event => { if (event.target === bg) close(); });
    bg.addEventListener('keydown', event => { if (event.key === 'Escape' || event.key === 'Enter') close(); });
    document.body.appendChild(bg);
    setTimeout(() => closeBtn.focus(), 30);
}

async function claimQuest(quest, skip) {
    if (questState.busy) return;
    if (skip && !(await showConfirm('레벨 조건으로 이 퀘스트를 스킵하고 보상을 받습니다. 계속할까요?'))) return;
    questState.busy = true;
    renderQuestDetail();
    try {
        const r = await postApi('/api/quests/claim', { id: quest.id, skip: !!skip });
        questState.list = r.list || [];
        showQuestRewardModal(quest, r);
    } catch (e) {
        showAlert(e.message);
    } finally {
        questState.busy = false;
        renderQuests();
    }
}

// ===== 100일 기념 캡슐 =====
const capsuleUi = f => '/rpg-ui?file=' + encodeURIComponent('100일 캡슐/' + f);
let capsuleState = { data: null, drawing: false };

async function loadCapsule() {
    const root = $('#capsuleRoot');
    if (!root) return;
    try {
        capsuleState.data = await api('/api/capsule100');
    } catch (e) {
        root.replaceChildren(el('div', { class: 'empty err' }, e.message));
        return;
    }
    renderCapsule();
}

// 캡슐 번호(1-base) → 프레임 등급. 상위 상품일수록 고급 유리 프레임.
function capsuleGrade(number) {
    return number === 1 ? 'g1' : number <= 4 ? 'g2' : number <= 7 ? 'g3' : 'g4';
}

function capsuleTile(prize, index) {
    const soldout = Number(prize.remaining) <= 0;
    return el('div', { class: 'cap-tile ' + capsuleGrade(index + 1) + (soldout ? ' soldout' : ''), title: prize.name + (Number(prize.count) > 1 ? ' x' + prize.count : '') },
        el('div', { class: 'cap-tile-icon' },
            prize.iconUrl ? el('img', { src: prize.iconUrl, alt: prize.name }) : el('span', { class: 'cap-tile-fallback' }, '🎁')),
        el('div', { class: 'cap-tile-count' }, comma(prize.remaining) + '/' + comma(prize.stock)));
}

function renderCapsule() {
    const root = $('#capsuleRoot');
    const d = capsuleState.data;
    if (!root || !d) return;

    // 캡슐 기계: 레버 + 스크린(코인/보유량/이용 토글)
    const machine = el('div', { class: 'cap-machine', id: 'capMachine' },
        el('div', { class: 'cap-lever' }, el('div', { class: 'cap-lever-slot' }, el('div', { class: 'cap-lever-ball' }))),
        el('div', { class: 'cap-machine-body' },
            el('div', { class: 'cap-screen' },
                el('div', { class: 'cap-screen-row coin' }, el('span', null, d.coinItemName), el('span', { class: 'cap-coin-caret' }, '▾')),
                el('div', { class: 'cap-screen-row hold' }, el('span', null, '보유량'), el('b', { class: 'cap-hold-val' }, comma(d.coinCount))),
                el('div', { class: 'cap-toggles' },
                    [1, 2, 3].map(n => el('button', {
                        class: 'cap-toggle-btn', type: 'button', 'aria-label': n + '회 이용',
                        style: "background-image:url('" + capsuleUi(n + '회 이용 토글.png') + "')",
                        disabled: capsuleState.drawing,
                        onclick: () => drawCapsule(n)
                    }))))));

    const counters = el('div', { class: 'cap-counters' },
        el('div', { class: 'cap-counter' }, el('span', { class: 'cap-counter-label' }, '남은 캡슐'), el('b', { class: 'cap-counter-val' }, comma(d.totalRemaining))),
        el('div', { class: 'cap-counter' }, el('span', { class: 'cap-counter-label' }, '전체 캡슐'), el('b', { class: 'cap-counter-val' }, comma(d.total))));

    const side = el('aside', { class: 'cap-side' },
        el('div', { class: 'cap-side-block' },
            el('b', null, d.coinItemName + ' 수급처'),
            el('div', null, '* 일반 상점 (일일 1개)'),
            el('div', null, '* 사냥 (일일 2개)'),
            el('div', null, '* 포인트 상점')),
        el('div', { class: 'cap-side-block' }, '누군가 1번 당첨 시 모든 캡슐이 초기화됩니다.'),
        el('div', { class: 'cap-side-block' },
            el('b', null, '캡슐 목록'),
            ...d.prizes.map((p, i) => el('div', null, (i + 1) + '. ' + p.name + (Number(p.count) > 1 ? ' ' + comma(p.count) + '개' : '')))));

    const panel = el('div', { class: 'cap-window' },
        el('div', { class: 'cap-titlebar' },
            el('span', { class: 'cap-titlebar-deco red' }),
            el('span', { class: 'cap-title-text' }, '100일 기념 캡슐 기계'),
            el('span', { class: 'cap-titlebar-deco teal' })),
        el('div', { class: 'cap-window-body' },
            el('div', { class: 'cap-window-main' },
                el('div', { class: 'cap-notice' }, 'RPGENIUS가 드디어 100일을 맞이했습니다!', el('br'), '100일 캡슐에서 여러분이 원하는 아이템을 획득해보세요!'),
                counters,
                el('div', { class: 'cap-tiles' }, d.prizes.map(capsuleTile))),
            side),
        el('div', { class: 'cap-footer' }, '캡슐 뽑기는 게임 내 잔여 수량이 표기되며, 확률은 잔여 아이템 개수에 따라 변동됩니다.', el('br'), '(아이템 개별 잔여 수량/캡슐 기계 전체 잔여 수량)'));

    // 배경 장식 (시안의 도트/엑스/도형)
    const deco = [
        el('span', { class: 'cap-deco sq d1' }),
        el('span', { class: 'cap-deco dots d2' }),
        el('span', { class: 'cap-deco x d3' }, '✕'),
        el('span', { class: 'cap-deco circle d4' }),
        el('span', { class: 'cap-deco dots orange d5' }),
        el('span', { class: 'cap-deco x d6' }, '✕'),
        el('span', { class: 'cap-deco sq red d7' })
    ];
    root.replaceChildren(el('div', { class: 'cap-board' },
        ...deco,
        el('img', { class: 'cap-hero', src: capsuleUi('쵸단.png'), alt: 'RPGENIUS 100일' }),
        machine, panel));
}

async function drawCapsule(n) {
    const d = capsuleState.data;
    if (!d || capsuleState.drawing) return;
    if (Number(d.coinCount) < n) { showAlert(d.coinItemName + '이 부족합니다. (보유 ' + comma(d.coinCount) + '개)'); return; }
    capsuleState.drawing = true;
    const machine = $('#capMachine');
    if (machine) machine.classList.add('pulling');
    const started = Date.now();
    try {
        const r = await postApi('/api/capsule100/draw', { count: n });
        capsuleState.data = r;
        // 레버 연출이 끝난 뒤 결과 표시
        setTimeout(() => {
            capsuleState.drawing = false;
            renderCapsule();
            openCapsuleResultModal(r);
        }, Math.max(0, 700 - (Date.now() - started)));
    } catch (e) {
        capsuleState.drawing = false;
        if (machine) machine.classList.remove('pulling');
        showAlert(e.message);
    }
}

function openCapsuleResultModal(r) {
    const cards = (r.results || []).map((res, i) => el('div', { class: 'cap-result-card' + (res.jackpot ? ' jackpot' : ''), style: { animationDelay: (i * 0.18) + 's' } },
        res.jackpot ? el('div', { class: 'cap-result-badge' }, '1등!') : null,
        el('div', { class: 'cap-tile ' + capsuleGrade(Number(res.number) || 10) }, el('div', { class: 'cap-tile-icon' }, res.iconUrl ? el('img', { src: res.iconUrl, alt: res.name }) : el('span', { class: 'cap-tile-fallback' }, '🎁'))),
        el('div', { class: 'cap-result-name' }, res.name + (Number(res.count) > 1 ? ' x' + comma(res.count) : ''))));
    openRichModal('캡슐 뽑기 결과', '', [
        el('div', { class: 'cap-result-row' }, ...cards),
        r.jackpot ? el('div', { class: 'cap-result-jackpot-note' }, '🎉 1등 당첨! 모든 캡슐이 초기화되었습니다.') : null,
        el('div', { class: 'cap-result-sub' }, '획득한 아이템은 인벤토리에서 확인하세요.')
    ].filter(Boolean));
}

// ===== 조합 =====

let combineState = { cards: [], meta: { table: {}, protect: {}, lucky: [], gold: 0 }, slots: [null, null, null], protectIndex: null, luckyRate: null, result: null, busy: false, built: false, slotEls: null, search: '', compatibleOnly: false };

function combineUi(file) { return '/combine-ui?file=' + encodeURIComponent(file); }

function combineGrade() {
    const filled = combineState.slots.find(Boolean);
    return filled ? filled.star : null;
}

function combineType() {
    const filled = combineState.slots.find(Boolean);
    return filled ? (filled.type || '일반') : null;
}

// ===== 장비 강화 =====
let enhanceState = { preview: null, busy: false, selectedProtectLevel: 'auto' };


function openEnhanceModal(eq) {
    if (!Number(eq.number || 0)) return;
    $('#enhanceOverlay').classList.add('active');
    document.body.style.overflow = 'hidden';
    loadEnhancePreview(eq.number);
}

function showEnhanceError(msg) {
    $('#enhanceContent').replaceChildren(
        el('div', { class: 'enhance-error-wrap' },
            el('div', { class: 'empty err' }, msg),
            el('button', { class: 'enhance-cancel-btn', style: 'margin-top:12px;width:100%', onclick: closeEnhanceModal }, '닫기')
        )
    );
}

async function loadEnhancePreview(number) {
    $('#enhanceContent').replaceChildren(el('div', { class: 'loading', style: 'padding:60px 0;text-align:center' }, '불러오는 중...'));
    $('#enhanceResultOverlay').classList.remove('active');
    try {
        const data = await api('/api/equipment/upgrade/preview/' + number);
        if (data.error) { showEnhanceError(data.error); return; }
        enhanceState.preview = data;
        renderEnhancePreview(data);
    } catch (e) {
        showEnhanceError(e.message);
    }
}

function renderEnhancePreview(data) {
    const thumbParts = [];
    if (data.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: data.frameUrl, alt: '' }));
    if (data.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: data.iconUrl, alt: data.name }));

    const beforeContent = el('div', { class: 'enhance-before-content' });
    const afterContent = el('div', { class: 'enhance-after-content' });
    if (data.statDiffs && data.statDiffs.length) {
        data.statDiffs.forEach(d => {
            beforeContent.appendChild(el('div', { class: 'enhance-stat-row' },
                el('span', { class: 'enhance-stat-label' }, d.label),
                el('span', { class: 'enhance-stat-val' }, d.before)
            ));
            afterContent.appendChild(el('div', { class: 'enhance-stat-row' },
                el('span', { class: 'enhance-stat-label' }, d.label),
                el('span', { class: 'enhance-stat-val better' }, d.after,
                    el('span', { class: 'enhance-stat-delta' }, ' (' + d.delta + ')'))
            ));
        });
    } else {
        beforeContent.appendChild(el('div', { class: 'enhance-empty-stat' }, '—'));
        afterContent.appendChild(el('div', { class: 'enhance-empty-stat' }, '—'));
    }

    const win = el('div', { class: 'enhance-window' },
        el('button', { class: 'enhance-close-btn', onclick: closeEnhanceModal }, '✕'),
        el('div', { class: 'enhance-item-zone' },
            el('div', { class: 'auc-thumb square' }, ...thumbParts),
            el('div', { class: 'enhance-item-level' }, data.name + '  +' + data.level + ' → +' + data.nextLevel)
        ),
        beforeContent,
        afterContent
    );

    const getEffectiveProtect = () => {
        const opts = data.protectOptions || [];
        const sel = enhanceState.selectedProtectLevel;
        if (sel === 'none') return null;
        if (!sel || sel === 'auto') return opts[0] || null;
        return opts.find(o => o.level === sel) || null;
    };

    const buildProtectCard = () => {
        const opts = data.protectOptions || [];
        const effective = getEffectiveProtect();
        const canPick = opts.length > 0;
        const cardClass = 'enhance-protect ' + (effective ? (effective.level || 'basic') : 'none') + (canPick ? ' clickable' : '');
        const card = el('div', { class: cardClass, onclick: canPick ? () => openProtectPicker(data) : null });
        if (effective) {
            card.appendChild(el('div', { class: 'enhance-protect-icon' },
                effective.iconUrl ? el('img', { class: 'enhance-protect-img', src: effective.iconUrl, alt: '' }) : '🛡'));
            card.appendChild(el('div', { class: 'enhance-protect-text' },
                el('div', { class: 'enhance-protect-name' }, effective.label),
                el('div', { class: 'enhance-protect-detail' }, effective.detail)
            ));
            card.appendChild(el('div', { class: 'enhance-protect-badge' }, '보유 ' + effective.count + '개'));
        } else {
            card.appendChild(el('div', { class: 'enhance-protect-icon' }, '⊘'));
            card.appendChild(el('div', { class: 'enhance-protect-text' },
                el('div', { class: 'enhance-protect-name' }, '보호 없음'),
                el('div', { class: 'enhance-protect-detail' }, opts.length ? '클릭하여 보호권 선택' : '보호권 미보유')
            ));
        }
        if (canPick) card.appendChild(el('div', { class: 'enhance-protect-pick-arrow' }, '▾'));
        return card;
    };

    const confirmBtn = el('button', { class: 'enhance-confirm-btn', id: 'enhanceConfirmBtn', onclick: () => {
        const effective = getEffectiveProtect();
        if (Number(data.rates.reset || 0) > 0 && !effective) showEnhanceWarning(() => runEnhancement(data.number));
        else runEnhancement(data.number);
    } }, '강화');
    if (!data.canUpgrade) confirmBtn.disabled = true;

    const protectNodes = (data.protectOptions != null)
        ? [buildProtectCard()]
        : [];

    $('#enhanceContent').replaceChildren(
        win,
        el('div', { class: 'enhance-info' },
            el('div', { class: 'enhance-section-label' }, '강화 확률'),
            el('div', { class: 'enhance-rates-row' },
                enhRateChip('great', '대성공', data.rates.great),
                enhRateChip('success', '성공', data.rates.success),
                enhRateChip('down', '하락', data.rates.down),
                enhRateChip('destroy', '파괴', data.rates.reset)
            ),
            el('div', { class: 'enhance-section-label' }, '필요 재료' + (Number(data.cost.discountRate || 0) > 0 ? ' · 축복 ' + Math.round(Number(data.cost.discountRate) * 100) + '% 할인' : '')),
            el('div', { class: 'enhance-cost-row' },
                enhCostItem(data.cost.stoneName || '강화석', comma(data.cost.stone) + '개', comma(data.stoneCount) + '개 보유', data.hasStone),
                enhCostItem('🪙 골드', comma(data.cost.gold), comma(data.gold) + ' 보유', data.hasGold)
            ),
            ...protectNodes
        ),
        el('div', { class: 'enhance-footer' },
            el('button', { class: 'enhance-cancel-btn', onclick: closeEnhanceModal }, '닫기'),
            confirmBtn
        )
    );
}

function enhRateChip(kind, label, value) {
    return el('div', { class: 'enhance-rate-chip ' + kind },
        el('div', { class: 'rate-label' }, label),
        el('div', { class: 'rate-val' }, Math.round(value * 1000) / 10 + '%')
    );
}

function enhCostItem(name, need, have, ok) {
    return el('div', { class: 'enhance-cost-item ' + (ok ? 'ok' : 'lack') },
        el('div', { class: 'enhance-cost-text' },
            el('div', { class: 'enhance-cost-name' }, name),
            el('div', { class: 'enhance-cost-val' }, need)
        ),
        el('div', { style: 'font-size:10px;color:' + (ok ? '#86efac' : '#fca5a5') + ';font-weight:700;white-space:nowrap' }, have)
    );
}

function openProtectPicker(previewData) {
    const opts = previewData.protectOptions || [];
    const cur = enhanceState.selectedProtectLevel;

    const body = el('div', { class: 'protect-picker' });
    const makeRow = (level, label, detail, iconUrl, count, isCur) => {
        const row = el('div', {
            class: 'protect-pick-row' + (isCur ? ' selected' : ''),
            onclick: () => {
                enhanceState.selectedProtectLevel = level;
                closeModal();
                renderEnhancePreview(previewData);
            }
        });
        const icon = el('div', { class: 'protect-pick-icon' });
        if (iconUrl) icon.appendChild(el('img', { src: iconUrl, alt: '' }));
        else icon.textContent = level === 'none' ? '⊘' : '🛡';
        row.appendChild(icon);
        const txt = el('div', { class: 'protect-pick-text' });
        txt.appendChild(el('div', { class: 'protect-pick-name' }, label));
        txt.appendChild(el('div', { class: 'protect-pick-detail' }, detail));
        row.appendChild(txt);
        if (count != null) row.appendChild(el('div', { class: 'protect-pick-count' }, count + '개'));
        if (isCur) row.appendChild(el('div', { class: 'protect-pick-check' }, '✓'));
        return row;
    };

    const isNone = cur === 'none';
    const isAuto = !cur || cur === 'auto';
    body.appendChild(makeRow('none', '보호 없음', '보호권을 사용하지 않습니다', null, null, isNone));
    opts.forEach(opt => {
        const isCur = isAuto ? opt === opts[0] : cur === opt.level;
        body.appendChild(makeRow(opt.level, opt.label, opt.detail, opt.iconUrl, opt.count, isCur));
    });

    $('#modalTitle').textContent = '보호권 선택';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

async function runEnhancement(number) {
    if (enhanceState.busy) return;
    enhanceState.busy = true;
    const btn = $('#enhanceConfirmBtn');
    if (btn) btn.disabled = true;
    const itemInfo = enhanceState.preview ? { name: enhanceState.preview.name, iconUrl: enhanceState.preview.iconUrl, frameUrl: enhanceState.preview.frameUrl } : {};
    // resolve effective protectLevel
    const opts = enhanceState.preview && enhanceState.preview.protectOptions || [];
    const sel = enhanceState.selectedProtectLevel;
    let protectLevel;
    if (sel === 'none') protectLevel = 'none';
    else if (!sel || sel === 'auto') protectLevel = opts[0] ? opts[0].level : 'none';
    else protectLevel = sel;
    try {
        const data = await postApi('/api/equipment/upgrade/run', { number, protectLevel });
        enhanceState.busy = false;
        if (data.profile) renderProfile(data.profile);
        showEnhanceResult(data.resultKind, data.message, number, data.preview, data.appliedDiffs || [], itemInfo);
    } catch (e) {
        enhanceState.busy = false;
        if (btn) { btn.disabled = false; }
        showAlert(e.message);
    }
}

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, ...children) {
    const e = document.createElementNS(SVG_NS, tag);
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    children.forEach(c => { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
}

const SPARKLE_PATH = 'M0,-10 L2.2,-2.2 L10,0 L2.2,2.2 L0,10 L-2.2,2.2 L-10,0 L-2.2,-2.2 Z';

// 무기 둘레로 흩뿌려지는 반짝임 파티클 SVG 레이어
function buildSparkleLayer(count, colors) {
    const svg = svgEl('svg', { class: 'enh-fx-sparkles', viewBox: '0 0 200 200', preserveAspectRatio: 'xMidYMid meet' });
    for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.6;
        const dist = 46 + Math.random() * 38;
        const x = 100 + Math.cos(ang) * dist;
        const y = 100 + Math.sin(ang) * dist;
        const sc = 0.5 + Math.random() * 0.9;
        const color = colors[i % colors.length];
        const g = svgEl('g', { class: 'enh-sparkle', style: 'transform-origin:' + x + 'px ' + y + 'px;animation-delay:' + (Math.random() * 0.9).toFixed(2) + 's' });
        g.appendChild(svgEl('path', { d: SPARKLE_PATH, fill: color, transform: 'translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ') scale(' + sc.toFixed(2) + ')' }));
        svg.appendChild(g);
    }
    return svg;
}

// 중심에서 방사형으로 터지는 광선 SVG (성공/대성공)
function buildRayLayer(count, color) {
    const svg = svgEl('svg', { class: 'enh-fx-rays', viewBox: '0 0 200 200', preserveAspectRatio: 'xMidYMid meet' });
    const grp = svgEl('g', { class: 'enh-rays-spin', style: 'transform-origin:100px 100px' });
    for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count;
        const x2 = 100 + Math.cos(ang) * 96;
        const y2 = 100 + Math.sin(ang) * 96;
        grp.appendChild(svgEl('line', { x1: 100, y1: 100, x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: color, 'stroke-width': (1 + (i % 2)).toString(), 'stroke-linecap': 'round', opacity: '0.85' }));
    }
    svg.appendChild(grp);
    return svg;
}

// 무기가 부서질 때 사방으로 튀는 파편 SVG (파괴)
function buildShardLayer(count) {
    const svg = svgEl('svg', { class: 'enh-fx-shards', viewBox: '0 0 200 200', preserveAspectRatio: 'xMidYMid meet' });
    for (let i = 0; i < count; i++) {
        const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
        const dist = 70 + Math.random() * 50;
        const dx = (Math.cos(ang) * dist).toFixed(1);
        const dy = (Math.sin(ang) * dist).toFixed(1);
        const rot = (Math.random() * 540 - 270).toFixed(0);
        const s = 5 + Math.random() * 7;
        const shade = ['#94a3b8', '#cbd5e1', '#64748b', '#e2e8f0'][i % 4];
        const poly = svgEl('polygon', { points: '0,' + (-s).toFixed(1) + ' ' + (s * 0.8).toFixed(1) + ',' + (s * 0.6).toFixed(1) + ' ' + (-s * 0.7).toFixed(1) + ',' + (s * 0.7).toFixed(1), fill: shade });
        const g = svgEl('g', { class: 'enh-shard', style: '--dx:' + dx + 'px;--dy:' + dy + 'px;--rot:' + rot + 'deg;transform-origin:100px 100px;animation-delay:' + (Math.random() * 0.12).toFixed(2) + 's' });
        g.appendChild(svgEl('g', { transform: 'translate(100 100)' }, poly));
        svg.appendChild(g);
    }
    return svg;
}

function showEnhanceWarning(onConfirm) {
    const ov = $('#enhanceResultOverlay');
    ov.replaceChildren(
        el('div', { class: 'enh-warn-icon' }, '⚠️'),
        el('div', { class: 'enh-warn-title' }, '장비가 파괴될 수 있습니다'),
        el('div', { class: 'enh-warn-sub' }, '보호권 없이 강화하면 실패 시 장비가 사라집니다. 진행하시겠습니까?'),
        el('div', { class: 'enh-warn-actions' },
            el('button', { class: 'enhance-cancel-btn', onclick: () => ov.classList.remove('active') }, '취소'),
            el('button', { class: 'enh-warn-confirm', onclick: () => { ov.classList.remove('active'); onConfirm(); } }, '진행')
        )
    );
    ov.classList.add('active');
}

function showEnhanceResult(kind, message, number, nextPreview, appliedDiffs, itemInfo) {
    const lines = (message || '').split('\n');
    let headline = lines[0] || '';
    const sub = lines.slice(1).join('  ').trim();
    if (kind === 'protected') {
        if (message.includes('초기화')) headline = '파괴 방어 초기화';
        else if (message.includes('파괴')) headline = '파괴 방어';
        else if (message.includes('하락')) headline = '하락 방어';
    }
    const resultOverlay = $('#enhanceResultOverlay');
    const info = itemInfo || {};

    // 무기 썸네일
    const thumbParts = [];
    if (info.frameUrl) thumbParts.push(el('img', { class: 'auc-frame', src: info.frameUrl, alt: '' }));
    if (info.iconUrl) thumbParts.push(el('img', { class: 'auc-item-img', src: info.iconUrl, alt: info.name || '' }));
    const weapon = el('div', { class: 'enh-fx-weapon' }, el('div', { class: 'auc-thumb square' }, ...thumbParts));

    // 결과 종류별 이펙트 레이어 구성
    const fxLayers = [el('div', { class: 'enh-fx-aura' })];
    if (kind === 'great') {
        fxLayers.push(buildRayLayer(16, '#fde68a'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(16, ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#f0abfc', '#fbbf24']));
    } else if (kind === 'success') {
        fxLayers.push(buildRayLayer(12, 'rgba(186,230,253,.7)'));
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(11, ['#e0f2fe', '#bae6fd', '#ffffff']));
    } else if (kind === 'destroy') {
        fxLayers.push(weapon);
        fxLayers.push(buildShardLayer(14));
    } else if (kind === 'protected') {
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(8, ['#e8b04b', '#f0cd87', '#fff2d4']));
    } else { // down / fail
        fxLayers.push(weapon);
        fxLayers.push(buildSparkleLayer(6, ['#fca5a5', '#fecaca']));
    }
    const fxStage = el('div', { class: 'enh-fx ' + kind }, ...fxLayers);

    // 차례차례 등장하는 스탯 변화
    const diffs = Array.isArray(appliedDiffs) ? appliedDiffs : [];
    const FX_DURATION = 1.25; // 이펙트 후 스탯 등장 시작 (초)
    const STEP = 0.28;
    const statsBox = el('div', { class: 'enh-result-stats' });
    diffs.forEach((d, i) => {
        const row = el('div', { class: 'enh-result-stat-row ' + (d.improved ? 'up' : 'down'), style: 'animation-delay:' + (FX_DURATION + i * STEP).toFixed(2) + 's' },
            el('span', { class: 'enh-result-stat-label' }, d.label),
            el('span', { class: 'enh-result-stat-val' }, d.after,
                el('span', { class: 'enh-result-stat-delta' }, ' (' + d.delta + ')'))
        );
        statsBox.appendChild(row);
    });

    const btnDelay = (FX_DURATION + diffs.length * STEP + 0.15).toFixed(2);
    const confirmBtn = el('button', {
        class: 'enh-result-confirm ' + kind,
        style: 'animation-delay:' + btnDelay + 's',
        onclick: () => {
            resultOverlay.classList.remove('active');
            if (nextPreview && !nextPreview.error) {
                enhanceState.preview = nextPreview;
                renderEnhancePreview(nextPreview);
            } else {
                closeEnhanceModal();
            }
        }
    }, '확인');

    resultOverlay.replaceChildren(
        fxStage,
        el('div', { class: 'enh-result-headline ' + kind }, headline),
        ...(sub ? [el('div', { class: 'enhance-result-sub' }, sub)] : []),
        statsBox,
        confirmBtn
    );
    resultOverlay.classList.add('active');
}

function closeEnhanceModal() {
    $('#enhanceOverlay').classList.remove('active');
    document.body.style.overflow = '';
    enhanceState.preview = null;
    enhanceState.busy = false;
    enhanceState.selectedProtectLevel = 'auto';
    if (pageIsActive('inventory')) loadInventory('equipment').catch(() => {});
}

function buildCombineStage() {
    const stage = $('#combineStage');
    if (!stage) return;
    stage.style.backgroundImage = 'url(' + combineUi('원본.png') + ')';
    const mkSlot = (cls) => el('button', { type: 'button', class: 'combine-slot ' + cls + ' empty' },
        el('img', { class: 'slot-card', alt: '' })
    );
    const lucky = mkSlot('lucky');
    const result = mkSlot('result');
    const m = [mkSlot('m0'), mkSlot('m1'), mkSlot('m2')];
    lucky.classList.add('clickable');
    lucky.onclick = onLuckyClick;
    m.forEach((slot, i) => slot.onclick = () => removeFromSlotByIndex(i));
    const btn = el('button', { type: 'button', class: 'combine-btn', id: 'combineBtn', 'aria-label': '카드 조합 실행', onclick: submitCombine });
    btn.style.backgroundImage = 'url(' + combineUi('조합버튼.png') + ')';
    const effect = el('img', { class: 'combine-effect', id: 'combineEffect', alt: '', style: 'display:none' });
    stage.replaceChildren(lucky, result, m[0], m[1], m[2], btn, effect);
    combineState.slotEls = { lucky, result, m };
    combineState.built = true;
}

function renderCombineStage() {
    if (!combineState.built) buildCombineStage();
    const els = combineState.slotEls;
    if (!els) return;
    combineState.slots.forEach((card, i) => {
        const slot = els.m[i];
        const img = slot.querySelector('.slot-card');
        slot.classList.add('clickable');
        if (card) { img.src = card.imageUrl; slot.classList.remove('empty'); slot.title = card.formatted + ' 선택 해제'; slot.setAttribute('aria-label', card.formatted + ' 선택 해제'); }
        else { img.removeAttribute('src'); slot.classList.add('empty'); slot.title = (i + 1) + '번째 재료 슬롯'; slot.setAttribute('aria-label', (i + 1) + '번째 재료 슬롯'); }
    });
    const limg = els.lucky.querySelector('.slot-card');
    if (combineState.protectIndex != null && combineState.slots[combineState.protectIndex]) {
        limg.src = combineUi((combineState.slots[combineState.protectIndex].star + 1) + '성 보호 카드.png');
        els.lucky.classList.remove('empty');
    } else if (combineState.luckyRate != null) {
        limg.src = combineUi('럭키' + Math.round(combineState.luckyRate * 100) + '%.png');
        els.lucky.classList.remove('empty');
    } else { limg.removeAttribute('src'); els.lucky.classList.add('empty'); }
    els.lucky.title = els.lucky.classList.contains('empty') ? '보호 또는 럭키 카드 선택' : '사용 중인 보조 카드 변경';
    els.lucky.setAttribute('aria-label', els.lucky.title);
    const rimg = els.result.querySelector('.slot-card');
    if (combineState.result) { rimg.src = combineState.result.imageUrl; els.result.classList.remove('empty'); }
    else { rimg.removeAttribute('src'); els.result.classList.add('empty'); }
    const btn = $('#combineBtn');
    if (btn) btn.disabled = !(combineState.slots.every(Boolean) && !combineState.busy);
    const stage = $('#combineStage');
    if (stage) stage.classList.toggle('ready', combineState.slots.every(Boolean));
    renderCombineInfo();
    renderCombinePool();
}

function renderCombineInfo() {
    const info = $('#combineInfo');
    if (!info) return;
    const grade = combineGrade();
    const filled = combineState.slots.filter(Boolean).length;
    const progress = el('div', { class: 'fusion-progress' },
        ...[0, 1, 2].map(index => el('span', { class: index < filled ? 'filled' : '' }, index + 1)),
        el('b', null, filled + ' / 3 선택')
    );
    if (grade == null) {
        info.replaceChildren(progress, el('div', { class: 'fusion-guide' }, '아래 목록에서 첫 번째 재료 카드를 선택하세요.'));
        return;
    }
    const t = combineState.meta.table[grade];
    const stats = el('div', { class: 'fusion-stat-row' });
    if (t) {
        const lucky = combineState.luckyRate != null;
        const shownRate = lucky ? Math.min(1, t.rate * (1 + combineState.luckyRate)) : t.rate;
        stats.appendChild(el('div', { class: 'fusion-stat' }, el('span', null, '조합 등급'), el('b', null, (grade + 1) + '성')));
        stats.appendChild(el('div', { class: 'fusion-stat' }, el('span', null, '성공 확률'), el('b', { class: 'rate' }, (Math.round(shownRate * 1000) / 10) + '%')));
        stats.appendChild(el('div', { class: 'fusion-stat' }, el('span', null, '필요 골드'), el('b', { class: 'gold' }, shopCurrNode('gold', 16), comma(t.gold))));
        if (t.guarantee) stats.appendChild(el('div', { class: 'fusion-stat' }, el('span', null, '확정 보정'), el('b', null, comma(t.count) + ' / ' + comma(t.guarantee))));
    } else {
        stats.appendChild(el('div', { class: 'fusion-guide warn' }, '이 등급은 조합할 수 없습니다.'));
    }
    let support = null;
    if (combineState.protectIndex != null) support = el('div', { class: 'fusion-support protect' }, '보호 카드 · ' + (combineState.protectIndex + 1) + '번째 재료 보존');
    else if (combineState.luckyRate != null) support = el('div', { class: 'fusion-support lucky' }, '럭키 카드 · 성공 확률 ' + (Math.round(combineState.luckyRate * 1000) / 10) + '% 증가');
    info.replaceChildren(...[progress, stats, support].filter(Boolean));
}

function renderCombinePool() {
    const pool = $('#combinePool');
    if (!pool) return;
    if (!combineState.cards.length) { if ($('#combinePoolCount')) $('#combinePoolCount').textContent = '0장'; pool.replaceChildren(el('div', { class: 'empty' }, '보유한 캐릭터 카드가 없습니다.')); return; }
    const grade = combineGrade();
    const type = combineType();
    const used = new Set(combineState.slots.filter(Boolean).map(c => c.number));
    const query = String(combineState.search || '').trim().toLowerCase();
    const entries = combineState.cards.map(card => {
        const selected = used.has(card.number);
        const cardType = card.type || '일반';
        const disabled = !selected && (!card.combinable || (grade != null && card.star != grade) || (type != null && cardType !== type));
        return { card, selected, disabled };
    }).filter(entry => (!query || String(entry.card.formatted || entry.card.name || '').toLowerCase().includes(query)) && (!combineState.compatibleOnly || entry.selected || !entry.disabled))
      .sort((a, b) => Number(b.selected) - Number(a.selected) || Number(a.disabled) - Number(b.disabled));
    const count = $('#combinePoolCount');
    if (count) count.textContent = entries.length + '장 표시';
    if (!entries.length) { pool.replaceChildren(el('div', { class: 'fusion-pool-empty' }, '조건에 맞는 카드가 없습니다.')); return; }
    pool.replaceChildren(...entries.map(({ card, selected, disabled }) => {
        const node = cardNode(card, true, null);
        node.classList.add('combine-pool-card');
        if (selected) { node.classList.add('selected'); node.appendChild(el('span', { class: 'fusion-card-state selected' }, '선택됨')); }
        else if (disabled) { node.classList.add('disabled'); node.appendChild(el('span', { class: 'fusion-card-state disabled' }, '조건 불일치')); }
        else node.appendChild(el('span', { class: 'fusion-card-state ready' }, '선택 가능'));
        node.onclick = () => {
            if (combineState.busy) return;
            if (selected) removeFromSlotByNumber(card.number);
            else if (!disabled) addCardToSlot(card);
        };
        return node;
    }));
}

function addCardToSlot(card) {
    const grade = combineGrade();
    const type = combineType();
    if (!card.combinable) { showAlert('이 등급은 조합할 수 없습니다.'); return; }
    if (grade != null && card.star != grade) { showAlert('같은 등급의 카드끼리만 조합할 수 있습니다.'); return; }
    if (type != null && (card.type || '일반') !== type) { showAlert('같은 종류의 카드끼리만 조합할 수 있습니다.'); return; }
    if (combineState.slots.some(c => c && c.number === card.number)) return;
    const idx = combineState.slots.findIndex(c => !c);
    if (idx === -1) { showAlert('재료 슬롯이 가득 찼습니다.'); return; }
    combineState.slots[idx] = card;
    combineState.result = null;
    renderCombineStage();
}

function removeFromSlotByIndex(i) {
    if (combineState.busy || !combineState.slots[i]) return;
    combineState.slots[i] = null;
    if (combineState.protectIndex === i) combineState.protectIndex = null;
    combineState.result = null;
    renderCombineStage();
}

function removeFromSlotByNumber(number) {
    const idx = combineState.slots.findIndex(c => c && c.number === number);
    if (idx !== -1) removeFromSlotByIndex(idx);
}

function onLuckyClick() {
    if (combineState.busy) return;
    if (!combineState.slots.every(Boolean)) { showAlert('재료 카드 3장을 먼저 선택하세요.'); return; }
    const grade = combineGrade();
    const hasProtect = !!combineState.meta.protect[grade];
    const hasLucky = (combineState.meta.lucky || []).length > 0;
    if (!hasProtect && !hasLucky) { showAlert('사용할 수 있는 보호/럭키 카드가 없습니다.'); return; }
    openProtectModal(grade);
}

function openProtectModal(grade) {
    const hasProtect = !!combineState.meta.protect[grade];
    const luckyList = combineState.meta.lucky || [];
    openModal('보호 / 럭키 카드', (grade + 1) + '성 조합 보조 카드를 선택하세요 (둘 중 하나만 사용 가능)', []);
    const body = $('#modalBody');
    body.replaceChildren();
    if (luckyList.length) {
        body.appendChild(el('div', { style: 'font-weight:800;color:#86efac;margin:4px 0 6px' }, '🍀 럭키 카드 — 성공 확률 상승'));
        luckyList.forEach(l => {
            const pct = Math.round(l.rate * 1000) / 10;
            const row = el('div', { class: 'stat-line', style: 'cursor:pointer;display:flex;align-items:center;gap:10px' },
                el('img', { src: combineUi('럭키' + Math.round(l.rate * 100) + '%.png'), alt: '', style: 'width:34px;border-radius:4px' }),
                el('span', null, (l.name || '럭키 카드') + ' · 성공 확률 ' + pct + '% 증가 (곱연산)')
            );
            if (combineState.luckyRate != null && Math.abs(combineState.luckyRate - l.rate) < 1e-9) row.style.borderColor = '#fbbf24';
            row.onclick = () => { combineState.luckyRate = l.rate; combineState.protectIndex = null; closeModal(); renderCombineStage(); };
            body.appendChild(row);
        });
    }
    if (hasProtect) {
        body.appendChild(el('div', { style: 'font-weight:800;color:#93c5fd;margin:10px 0 6px' }, '🛡️ 보호 카드 — 실패 시 재료 1장 보존'));
        body.appendChild(el('img', { src: combineUi((grade + 1) + '성 보호 카드.png'), alt: '', style: 'width:80px;display:block;margin:0 auto 8px' }));
        combineState.slots.forEach((card, i) => {
            const row = el('div', { class: 'stat-line', style: 'cursor:pointer;display:flex;align-items:center;gap:10px' },
                card.imageUrl ? el('img', { src: card.imageUrl, alt: '', style: 'width:34px;border-radius:4px' }) : null,
                el('span', null, (i + 1) + '번째 재료 · ' + card.formatted)
            );
            if (combineState.protectIndex === i) row.style.borderColor = '#fbbf24';
            row.onclick = () => { combineState.protectIndex = i; combineState.luckyRate = null; closeModal(); renderCombineStage(); };
            body.appendChild(row);
        });
    }
    body.appendChild(el('button', { class: 'close', onclick: () => { combineState.protectIndex = null; combineState.luckyRate = null; closeModal(); renderCombineStage(); } }, '사용 안 함'));
}

function playCombineEffect() {
    const eff = $('#combineEffect');
    if (!eff) return;
    eff.src = combineUi('조합-이펙트.gif') + '&t=' + Date.now();
    eff.style.display = '';
    setTimeout(() => { eff.style.display = 'none'; }, 1500);
}

async function submitCombine() {
    if (combineState.busy || !combineState.slots.every(Boolean)) return;
    combineState.busy = true;
    const btn = $('#combineBtn');
    if (btn) btn.disabled = true;
    const payload = { numbers: combineState.slots.map(c => c.number) };
    if (combineState.protectIndex != null) payload.protectIndex = combineState.protectIndex;
    else if (combineState.luckyRate != null) payload.luckyRate = combineState.luckyRate;
    try {
        const data = await postApi('/api/combine', payload);
        playCombineEffect();
        setTimeout(() => {
            combineState.cards = data.cards || [];
            combineState.meta = data.meta || combineState.meta;
            combineState.slots = [null, null, null];
            combineState.protectIndex = null;
            combineState.luckyRate = null;
            combineState.result = data.resultCard || null;
            combineState.busy = false;
            renderCombineStage();
            if (data.profile) renderProfile(data.profile);
            renderCombineResult(data);
        }, 1500);
    } catch (e) {
        combineState.busy = false;
        renderCombineStage();
        showAlert(e.message);
    }
}

function renderCombineResult(data) {
    const info = $('#combineInfo');
    if (!info) return;
    const success = !!data.success;
    const msg = typeof data.message === 'string' ? data.message : '';
    const guaranteed = msg.indexOf('확정') !== -1;
    const rc = data.resultCard;
    const headline = guaranteed ? '⚜️ 확정 조합 성공!' : (success ? '🌟 조합 성공!' : '조합 완료');
    const notes = msg.split('\n').filter(l => l.indexOf('🛡️') !== -1).map(l => l.replace(/^[-\s]*/, ''));
    info.replaceChildren(el('div', { class: 'combine-result ' + (success ? 'ok' : 'fail') },
        el('div', { class: 'combine-result-head' }, headline),
        rc ? el('div', { class: 'combine-result-card' },
            rc.imageUrl ? el('img', { class: 'combine-result-img', src: rc.imageUrl, alt: rc.formatted || rc.name }) : null,
            el('div', { class: 'combine-result-name' }, rc.formatted || rc.name || '')
        ) : null,
        ...notes.map(n => el('div', { class: 'combine-result-note' }, n))
    ));
}

function bindCombineControls() {
    const search = $('#combineSearch');
    const compatible = $('#combineCompatibleOnly');
    const clear = $('#combineClear');
    if (search) {
        search.value = combineState.search;
        search.oninput = () => { combineState.search = search.value; renderCombinePool(); };
    }
    if (compatible) {
        compatible.checked = combineState.compatibleOnly;
        compatible.onchange = () => { combineState.compatibleOnly = compatible.checked; renderCombinePool(); };
    }
    if (clear) clear.onclick = () => {
        if (combineState.busy) return;
        combineState.slots = [null, null, null];
        combineState.protectIndex = null;
        combineState.luckyRate = null;
        combineState.result = null;
        renderCombineStage();
    };
}

async function loadCombine() {
    try {
        const data = await api('/api/combine/cards');
        combineState.cards = data.cards || [];
        combineState.meta = data.meta || { table: {}, protect: {}, lucky: [], gold: 0 };
        combineState.slots = [null, null, null];
        combineState.protectIndex = null;
        combineState.luckyRate = null;
        combineState.result = null;
        combineState.busy = false;
        bindCombineControls();
        renderCombineStage();
    } catch (e) {
        combineState.built = false;
        const stage = $('#combineStage');
        if (stage) stage.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 전직조합 =====

let jobCombineState = { cards: [], gold: 0, slots: [null, null, null], result: null, busy: false, built: false, slotEls: null, search: '', compatibleOnly: false };

function buildJobCombineStage() {
    const stage = $('#jobCombineStage');
    if (!stage) return;
    stage.style.backgroundImage = 'url(' + combineUi('전직조합원본.jpg') + ')';
    const mkSlot = (cls) => el('button', { type: 'button', class: 'jobcombine-slot ' + cls + ' empty' },
        el('img', { class: 'slot-card', alt: '' })
    );
    const result = mkSlot('result');
    const m = [mkSlot('m0'), mkSlot('m1'), mkSlot('m2')];
    m.forEach((slot, i) => slot.onclick = () => removeFromJobSlotByIndex(i));
    const btn = el('button', { type: 'button', class: 'jobcombine-btn', id: 'jobCombineBtn', 'aria-label': '전직 카드 조합 실행', onclick: submitJobCombine });
    btn.style.backgroundImage = 'url(' + combineUi('전직조합버튼.png') + ')';
    stage.replaceChildren(result, m[0], m[1], m[2], btn);
    jobCombineState.slotEls = { result, m };
    jobCombineState.built = true;
}

function renderJobCombineStage() {
    if (!jobCombineState.built) buildJobCombineStage();
    const els = jobCombineState.slotEls;
    if (!els) return;
    jobCombineState.slots.forEach((card, i) => {
        const slot = els.m[i];
        const img = slot.querySelector('.slot-card');
        slot.classList.add('clickable');
        if (card) { img.src = card.imageUrl; slot.classList.remove('empty'); slot.title = card.formatted + ' 선택 해제'; slot.setAttribute('aria-label', card.formatted + ' 선택 해제'); }
        else { img.removeAttribute('src'); slot.classList.add('empty'); slot.title = (i + 1) + '번째 재료 슬롯'; slot.setAttribute('aria-label', (i + 1) + '번째 재료 슬롯'); }
    });
    const rimg = els.result.querySelector('.slot-card');
    if (jobCombineState.result) { rimg.src = jobCombineState.result.imageUrl; els.result.classList.remove('empty'); }
    else { rimg.removeAttribute('src'); els.result.classList.add('empty'); }
    const btn = $('#jobCombineBtn');
    if (btn) btn.disabled = !(jobCombineState.slots.every(Boolean) && !jobCombineState.busy);
    const stage = $('#jobCombineStage');
    if (stage) stage.classList.toggle('ready', jobCombineState.slots.every(Boolean));
    renderJobCombineInfo();
    renderJobCombinePool();
}

function jobCombineSelectedId() {
    const filled = jobCombineState.slots.find(Boolean);
    return filled ? filled.id : null;
}
function jobCombineSelectedStar() {
    const filled = jobCombineState.slots.find(Boolean);
    return filled ? filled.star : null;
}

function renderJobCombineInfo() {
    const info = $('#jobCombineInfo');
    if (!info) return;
    const filled = jobCombineState.slots.filter(Boolean).length;
    const star = jobCombineSelectedStar();
    const characterId = jobCombineSelectedId();
    const progress = el('div', { class: 'fusion-progress job' },
        ...[0, 1, 2].map(index => el('span', { class: index < filled ? 'filled' : '' }, index + 1)),
        el('b', null, filled + ' / 3 선택')
    );
    let detail;
    if (star == null) detail = el('div', { class: 'fusion-guide' }, '아래 목록에서 첫 번째 전직 재료를 선택하세요.');
    else {
        const filledCards = jobCombineState.slots.filter(Boolean);
        const allSame = filledCards.every(c => c.id === characterId && c.star === star);
        if (!allSame) detail = el('div', { class: 'fusion-guide warn' }, '같은 캐릭터와 같은 등급의 카드 3장이 필요합니다.');
        else detail = el('div', { class: 'fusion-stat-row job' },
            el('div', { class: 'fusion-stat' }, el('span', null, '재료 등급'), el('b', null, (star + 1) + '성')),
            el('div', { class: 'fusion-stat' }, el('span', null, '성공 확률'), el('b', { class: 'rate' }, '100%')),
            el('div', { class: 'fusion-stat' }, el('span', null, '결과'), el('b', null, (star + 1) + '성 전직 카드'))
        );
    }
    info.replaceChildren(progress, detail);
}

function renderJobCombinePool() {
    const pool = $('#jobCombinePool');
    if (!pool) return;
    if (!jobCombineState.cards.length) { if ($('#jobCombinePoolCount')) $('#jobCombinePoolCount').textContent = '0장'; pool.replaceChildren(el('div', { class: 'empty' }, '전직조합 가능한 카드가 없습니다. (같은 캐릭터 5성↑ 일반 카드 3장 필요)')); return; }
    const selectedId = jobCombineSelectedId();
    const selectedStar = jobCombineSelectedStar();
    const used = new Set(jobCombineState.slots.filter(Boolean).map(c => c.number));
    const query = String(jobCombineState.search || '').trim().toLowerCase();
    const entries = jobCombineState.cards.map(card => {
        const selected = used.has(card.number);
        const disabled = !selected && (
            (selectedId != null && card.id !== selectedId) ||
            (selectedStar != null && card.star !== selectedStar)
        );
        return { card, selected, disabled };
    }).filter(entry => (!query || String(entry.card.formatted || entry.card.name || '').toLowerCase().includes(query)) && (!jobCombineState.compatibleOnly || entry.selected || !entry.disabled))
      .sort((a, b) => Number(b.selected) - Number(a.selected) || Number(a.disabled) - Number(b.disabled));
    const count = $('#jobCombinePoolCount');
    if (count) count.textContent = entries.length + '장 표시';
    if (!entries.length) { pool.replaceChildren(el('div', { class: 'fusion-pool-empty' }, '조건에 맞는 카드가 없습니다.')); return; }
    pool.replaceChildren(...entries.map(({ card, selected, disabled }) => {
        const node = cardNode(card, true, null);
        node.classList.add('combine-pool-card');
        if (selected) { node.classList.add('selected'); node.appendChild(el('span', { class: 'fusion-card-state selected' }, '선택됨')); }
        else if (disabled) { node.classList.add('disabled'); node.appendChild(el('span', { class: 'fusion-card-state disabled' }, '조건 불일치')); }
        else node.appendChild(el('span', { class: 'fusion-card-state ready' }, '선택 가능'));
        node.onclick = () => {
            if (jobCombineState.busy) return;
            if (selected) removeFromJobSlotByIndex(jobCombineState.slots.findIndex(c => c && c.number === card.number));
            else if (!disabled) addJobCardToSlot(card);
        };
        return node;
    }));
}

function addJobCardToSlot(card) {
    const selectedId = jobCombineSelectedId();
    const selectedStar = jobCombineSelectedStar();
    if (selectedId != null && card.id !== selectedId) { showAlert('같은 캐릭터 카드끼리만 조합할 수 있습니다.'); return; }
    if (selectedStar != null && card.star !== selectedStar) { showAlert('같은 등급의 카드끼리만 조합할 수 있습니다.'); return; }
    if (jobCombineState.slots.some(c => c && c.number === card.number)) return;
    const idx = jobCombineState.slots.findIndex(c => !c);
    if (idx === -1) { showAlert('재료 슬롯이 가득 찼습니다.'); return; }
    jobCombineState.slots[idx] = card;
    jobCombineState.result = null;
    renderJobCombineStage();
}

function removeFromJobSlotByIndex(i) {
    if (jobCombineState.busy || !jobCombineState.slots[i]) return;
    jobCombineState.slots[i] = null;
    jobCombineState.result = null;
    renderJobCombineStage();
}

async function submitJobCombine() {
    if (jobCombineState.busy || !jobCombineState.slots.every(Boolean)) return;
    jobCombineState.busy = true;
    const btn = $('#jobCombineBtn');
    if (btn) btn.disabled = true;
    try {
        const data = await postApi('/api/jobcombine', { numbers: jobCombineState.slots.map(c => c.number) });
        jobCombineState.cards = data.cards || [];
        jobCombineState.gold = data.gold != null ? data.gold : jobCombineState.gold;
        jobCombineState.slots = [null, null, null];
        jobCombineState.result = data.resultCard || null;
        jobCombineState.busy = false;
        renderJobCombineStage();
        if (data.profile) renderProfile(data.profile);
        const info = $('#jobCombineInfo');
        if (info && data.resultCard) {
            const rc = data.resultCard;
            info.replaceChildren(el('div', { class: 'combine-result ok' },
                el('div', { class: 'combine-result-head' }, '✨ 전직조합 성공!'),
                el('div', { class: 'combine-result-card' },
                    rc.imageUrl ? el('img', { class: 'combine-result-img', src: rc.imageUrl, alt: rc.formatted || rc.name }) : null,
                    el('div', { class: 'combine-result-name' }, rc.formatted || rc.name || '')
                )
            ));
        }
    } catch (e) {
        jobCombineState.busy = false;
        renderJobCombineStage();
        showAlert(e.message);
    }
}

function bindJobCombineControls() {
    const search = $('#jobCombineSearch');
    const compatible = $('#jobCombineCompatibleOnly');
    const clear = $('#jobCombineClear');
    if (search) {
        search.value = jobCombineState.search;
        search.oninput = () => { jobCombineState.search = search.value; renderJobCombinePool(); };
    }
    if (compatible) {
        compatible.checked = jobCombineState.compatibleOnly;
        compatible.onchange = () => { jobCombineState.compatibleOnly = compatible.checked; renderJobCombinePool(); };
    }
    if (clear) clear.onclick = () => {
        if (jobCombineState.busy) return;
        jobCombineState.slots = [null, null, null];
        jobCombineState.result = null;
        renderJobCombineStage();
    };
}

async function loadJobCombine() {
    try {
        const data = await api('/api/jobcombine/cards');
        jobCombineState.cards = data.cards || [];
        jobCombineState.gold = data.gold != null ? data.gold : 0;
        jobCombineState.slots = [null, null, null];
        jobCombineState.result = null;
        jobCombineState.busy = false;
        bindJobCombineControls();
        renderJobCombineStage();
    } catch (e) {
        jobCombineState.built = false;
        const stage = $('#jobCombineStage');
        if (stage) stage.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 장비합성 =====

let equipmentSynthesisState = { equipment: [], slots: [], result: null, busy: false, search: '', compatibleOnly: false };

function equipmentSynthesisMode() {
    return equipmentSynthesisState.slots[0] ? equipmentSynthesisState.slots[0].synthesisMode : null;
}

function equipmentSynthesisRequiredCount() {
    return equipmentSynthesisMode() === 'transcend' ? 2 : 3;
}

function equipmentSynthesisPreviewResult() {
    if (equipmentSynthesisState.result) return equipmentSynthesisState.result;
    const first = equipmentSynthesisState.slots[0];
    if (!first || !first.result) return null;
    if (first.synthesisMode !== 'transcend') return first.result;
    const highestStage = Math.max(...equipmentSynthesisState.slots.map(item => Number(item.transcendStage || 1)));
    return Object.assign({}, first.result, {
        rarity: '초월 ' + (highestStage + 1) + '단계',
        transcendStage: highestStage + 1,
        level: Number(first.level || 0),
        potentialDisplay: first.potentialDisplay || null,
        soul: first.soul || null,
        rolled: first.rolled || null
    });
}

function equipmentSynthesisItemLabel(item) {
    if (!item) return '';
    const stage = item.transcendStage ? ' · 초월 ' + item.transcendStage + '단계' : '';
    const level = Number(item.level || 0) > 0 ? ' · +' + item.level : '';
    return item.name + stage + level;
}

function canAddEquipmentSynthesisItem(item) {
    if (!item || !item.selectable) return false;
    if (equipmentSynthesisState.slots.some(selected => selected.number === item.number)) return true;
    const first = equipmentSynthesisState.slots[0];
    if (!first) return true;
    if (equipmentSynthesisState.slots.length >= equipmentSynthesisRequiredCount()) return false;
    if (item.synthesisMode !== first.synthesisMode) return false;
    if (first.synthesisMode === 'evolution') return item.type === first.type && Number(item.id) === Number(first.id) && Number(item.level) >= 10;
    if (item.type !== first.type || item.baseName !== first.baseName || Number(item.transcendStage) > 2) return false;
    const hasStageTwo = equipmentSynthesisState.slots.some(selected => Number(selected.transcendStage) === 2);
    return hasStageTwo ? Number(item.transcendStage) === 1 : true;
}

function equipmentSynthesisSlot(item, index) {
    if (!item) return el('button', { type: 'button', class: 'equipment-synthesis-slot empty', disabled: true, 'aria-label': (index + 1) + '번째 재료 슬롯' },
        el('span', { class: 'equipment-synthesis-slot-plus' }, '+'),
        el('small', null, '재료 ' + (index + 1))
    );
    return el('button', {
        type: 'button',
        class: 'equipment-synthesis-slot filled',
        title: equipmentSynthesisItemLabel(item) + ' 선택 해제',
        'aria-label': equipmentSynthesisItemLabel(item) + ' 선택 해제',
        onclick: () => removeEquipmentSynthesisItem(item.number)
    }, equipmentThumb(item), el('strong', null, item.name), el('small', null, item.transcendStage ? '초월 ' + item.transcendStage + '단계' : '+' + item.level));
}

function equipmentSynthesisResultSlot(result) {
    const potential = result && result.potentialDisplay;
    const soul = result && result.soul;
    const gear = result ? el('div', { class: 'equipment-synthesis-result-gear' },
        equipmentThumb(result),
        Number(result.level || 0) > 0 ? el('i', { class: 'equipment-synthesis-result-level' }, '+' + Number(result.level)) : null
    ) : el('span', { class: 'equipment-synthesis-result-icon' }, '◇');
    const node = el('div', { class: 'equipment-synthesis-result' + (result ? ' ready' : '') + (potential ? ' potential' : '') + (soul ? ' soul' : '') },
        gear,
        el('div', null,
            el('small', null, '합성 결과'),
            el('strong', null, result ? result.name : '재료를 선택하세요'),
            result ? el('span', null, result.rarity || '') : null,
            potential || soul ? el('div', { class: 'equipment-synthesis-result-traits' },
                potential ? el('em', { class: 'potential' }, potential.tierLabel + ' 잠재능력') : null,
                soul ? el('em', { class: 'soul' }, '✦ ' + soul.name) : null
            ) : null
        )
    );
    if (potential) node.style.setProperty('--result-potential', POTENTIAL_TIER_COLORS[potential.tierKey] || '#94a3b8');
    return node;
}

function equipmentSynthesisDockItem(item, index, result) {
    if (!item) return el('span', { class: 'equipment-synthesis-dock-empty', 'aria-label': result ? '합성 결과' : (index + 1) + '번째 재료 슬롯' }, result ? '◇' : '+');
    const node = el(result ? 'div' : 'button', {
        class: 'equipment-synthesis-dock-item' + (result ? ' result' : ''),
        type: result ? null : 'button',
        title: result ? equipmentSynthesisItemLabel(item) : equipmentSynthesisItemLabel(item) + ' 선택 해제',
        onclick: result ? null : () => removeEquipmentSynthesisItem(item.number)
    }, equipmentThumb(item));
    if (Number(item.level || 0) > 0) node.appendChild(el('i', null, '+' + Number(item.level)));
    if (result && item.potentialDisplay) {
        node.classList.add('potential');
        node.style.setProperty('--result-potential', POTENTIAL_TIER_COLORS[item.potentialDisplay.tierKey] || '#94a3b8');
    }
    return node;
}

function renderEquipmentSynthesisDock() {
    const dock = $('#equipmentSynthesisDock');
    if (!dock) return;
    const required = equipmentSynthesisRequiredCount();
    const result = equipmentSynthesisPreviewResult();
    const complete = equipmentSynthesisState.slots.length === required;
    dock.replaceChildren(
        el('div', { class: 'equipment-synthesis-dock-flow' },
            el('div', { class: 'equipment-synthesis-dock-materials' }, ...Array.from({ length: required }, (_, index) => equipmentSynthesisDockItem(equipmentSynthesisState.slots[index], index, false))),
            el('span', { class: 'equipment-synthesis-dock-arrow', 'aria-hidden': 'true' }, '→'),
            equipmentSynthesisDockItem(result, 0, true)
        ),
        el('div', { class: 'equipment-synthesis-dock-progress' },
            el('strong', null, equipmentSynthesisMode() === 'transcend' ? '초월 합성' : equipmentSynthesisMode() === 'evolution' ? '진화 합성' : '장비 합성'),
            el('span', null, equipmentSynthesisState.slots.length + ' / ' + required)
        ),
        el('button', { type: 'button', class: 'equipment-synthesis-dock-submit', disabled: !complete || equipmentSynthesisState.busy, onclick: confirmEquipmentSynthesis }, equipmentSynthesisState.busy ? '합성 중' : '합성')
    );
    updateEquipmentSynthesisDockVisibility();
}

const equipmentSynthesisMobileQuery = window.matchMedia('(max-width: 760px)');

function updateEquipmentSynthesisDockVisibility() {
    const dock = $('#equipmentSynthesisDock');
    const board = document.querySelector('.equipment-synthesis-board');
    if (!dock || !board) return;
    const header = document.querySelector('header');
    const headerBottom = header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const visible = activePage === 'equipment-synthesis' && equipmentSynthesisMobileQuery.matches && board.getBoundingClientRect().bottom <= headerBottom;
    dock.classList.toggle('visible', visible);
    dock.setAttribute('aria-hidden', visible ? 'false' : 'true');
    dock.style.top = headerBottom + 'px';
}

function renderEquipmentSynthesisStage() {
    const stage = $('#equipmentSynthesisStage');
    const info = $('#equipmentSynthesisInfo');
    if (!stage || !info) return;
    const required = equipmentSynthesisRequiredCount();
    const result = equipmentSynthesisPreviewResult();
    const complete = equipmentSynthesisState.slots.length === required;
    const materials = el('div', { class: 'equipment-synthesis-materials' },
        ...Array.from({ length: required }, (_, index) => equipmentSynthesisSlot(equipmentSynthesisState.slots[index], index))
    );
    stage.replaceChildren(materials, el('span', { class: 'equipment-synthesis-arrow', 'aria-hidden': 'true' }, '→'), equipmentSynthesisResultSlot(result));
    const modeText = equipmentSynthesisMode() === 'transcend' ? '초월 단계 합성' : equipmentSynthesisMode() === 'evolution' ? '장비 진화 합성' : '합성 방식을 선택하세요';
    const rule = $('#equipmentSynthesisRule');
    if (rule) rule.textContent = equipmentSynthesisMode() === 'transcend' ? '재료 2개' : equipmentSynthesisMode() === 'evolution' ? '재료 3개' : '재료 선택';
    const button = el('button', { type: 'button', class: 'equipment-synthesis-submit', disabled: !complete || equipmentSynthesisState.busy, onclick: confirmEquipmentSynthesis }, equipmentSynthesisState.busy ? '합성 중...' : '장비 합성');
    info.replaceChildren(
        el('div', { class: 'equipment-synthesis-progress' }, el('span', null, modeText), el('b', null, equipmentSynthesisState.slots.length + ' / ' + required)),
        complete ? el('p', null, '선택한 재료는 합성 후 사라집니다. 결과를 확인한 뒤 진행하세요.') : el('p', null, '목록에서 조건에 맞는 장비를 선택하세요.'),
        button
    );
    renderEquipmentSynthesisDock();
    renderEquipmentSynthesisPool();
}

function renderEquipmentSynthesisPool() {
    const pool = $('#equipmentSynthesisPool');
    if (!pool) return;
    const query = equipmentSynthesisState.search.trim().toLowerCase();
    const selectedNumbers = new Set(equipmentSynthesisState.slots.map(item => item.number));
    const items = equipmentSynthesisState.equipment.map(item => ({
        item,
        selected: selectedNumbers.has(item.number),
        compatible: canAddEquipmentSynthesisItem(item)
    })).filter(entry => (!query || String(entry.item.name || '').toLowerCase().includes(query)) && (!equipmentSynthesisState.compatibleOnly || entry.selected || entry.compatible))
      .sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.compatible) - Number(a.compatible) || Number(b.item.level) - Number(a.item.level));
    const count = $('#equipmentSynthesisCount');
    if (count) count.textContent = items.length + '개 표시';
    if (!items.length) {
        pool.replaceChildren(el('div', { class: 'equipment-synthesis-empty' }, equipmentSynthesisState.equipment.length ? '조건에 맞는 장비가 없습니다.' : '보유한 장비가 없습니다.'));
        return;
    }
    pool.replaceChildren(...items.map(({ item, selected, compatible }) => {
        const disabled = !selected && !compatible;
        const stateText = selected ? '선택됨' : compatible ? '선택 가능' : (item.unavailableReason || '조건 불일치');
        const node = el('button', {
            type: 'button',
            class: 'equipment-synthesis-card' + (selected ? ' selected' : '') + (disabled ? ' disabled' : ''),
            disabled: disabled || equipmentSynthesisState.busy,
            onclick: () => selected ? removeEquipmentSynthesisItem(item.number) : addEquipmentSynthesisItem(item)
        },
        equipmentThumb(item),
        el('div', { class: 'equipment-synthesis-card-copy' },
            el('strong', null, item.name),
            el('span', null, item.rarity + (item.level > 0 ? ' · +' + item.level : '')),
            el('small', { class: compatible || selected ? 'ready' : '' }, stateText)
        ));
        node.style.setProperty('--rar', RARITY_COLORS[item.rarity] || RARITY_COLORS[item.baseRarity] || '#64748b');
        return node;
    }));
}

function addEquipmentSynthesisItem(item) {
    if (!canAddEquipmentSynthesisItem(item)) return;
    equipmentSynthesisState.result = null;
    equipmentSynthesisState.slots.push(item);
    if (equipmentSynthesisMode() === 'transcend') {
        equipmentSynthesisState.slots.sort((a, b) => Number(b.transcendStage || 1) - Number(a.transcendStage || 1));
    }
    renderEquipmentSynthesisStage();
}

function removeEquipmentSynthesisItem(number) {
    if (equipmentSynthesisState.busy) return;
    equipmentSynthesisState.result = null;
    equipmentSynthesisState.slots = equipmentSynthesisState.slots.filter(item => item.number !== number);
    renderEquipmentSynthesisStage();
}

function confirmEquipmentSynthesis() {
    const required = equipmentSynthesisRequiredCount();
    if (equipmentSynthesisState.busy || equipmentSynthesisState.slots.length !== required) return;
    const result = equipmentSynthesisPreviewResult();
    const materialList = el('div', { class: 'equipment-synthesis-confirm-list' }, ...equipmentSynthesisState.slots.map(item => el('div', null, equipmentThumb(item), el('span', null, equipmentSynthesisItemLabel(item)))));
    const actions = el('div', { class: 'row modal-action-row' },
        el('button', { class: 'modal-action-button remove', onclick: closeModal }, '취소'),
        el('button', { class: 'modal-action-button enhance', onclick: () => { closeModal(); submitEquipmentSynthesis(); } }, '합성 진행')
    );
    openRichModal('장비 합성 확인', '재료 장비는 복구할 수 없습니다.', [materialList, el('div', { class: 'equipment-synthesis-confirm-result' }, '결과: ' + (result ? result.name + ' · ' + result.rarity : '-')), actions]);
}

async function submitEquipmentSynthesis() {
    if (equipmentSynthesisState.busy) return;
    equipmentSynthesisState.busy = true;
    renderEquipmentSynthesisStage();
    try {
        const data = await postApi('/api/equipment-synthesis', { numbers: equipmentSynthesisState.slots.map(item => item.number) });
        equipmentSynthesisState.equipment = data.equipment || [];
        equipmentSynthesisState.slots = [];
        equipmentSynthesisState.result = data.resultEquipment || null;
        equipmentSynthesisState.busy = false;
        if (data.profile) renderProfile(data.profile);
        renderEquipmentSynthesisStage();
    } catch (e) {
        equipmentSynthesisState.busy = false;
        renderEquipmentSynthesisStage();
        showAlert(e.message);
    }
}

function bindEquipmentSynthesisControls() {
    const search = $('#equipmentSynthesisSearch');
    const compatible = $('#equipmentSynthesisCompatibleOnly');
    const clear = $('#equipmentSynthesisClear');
    if (search) {
        search.value = equipmentSynthesisState.search;
        search.oninput = () => { equipmentSynthesisState.search = search.value; renderEquipmentSynthesisPool(); };
    }
    if (compatible) {
        compatible.checked = equipmentSynthesisState.compatibleOnly;
        compatible.onchange = () => { equipmentSynthesisState.compatibleOnly = compatible.checked; renderEquipmentSynthesisPool(); };
    }
    if (clear) clear.onclick = () => {
        if (equipmentSynthesisState.busy) return;
        equipmentSynthesisState.slots = [];
        equipmentSynthesisState.result = null;
        renderEquipmentSynthesisStage();
    };
}

async function loadEquipmentSynthesis() {
    const stage = $('#equipmentSynthesisStage');
    if (stage) stage.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/equipment-synthesis');
        equipmentSynthesisState.equipment = data.equipment || [];
        equipmentSynthesisState.slots = [];
        equipmentSynthesisState.result = null;
        equipmentSynthesisState.busy = false;
        bindEquipmentSynthesisControls();
        renderEquipmentSynthesisStage();
    } catch (e) {
        if (stage) stage.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

window.addEventListener('scroll', updateEquipmentSynthesisDockVisibility, { passive: true });
window.addEventListener('resize', updateEquipmentSynthesisDockVisibility, { passive: true });
equipmentSynthesisMobileQuery.addEventListener('change', updateEquipmentSynthesisDockVisibility);

// ===== 레벨 보상 =====

function openLevelRewardModal(r) {
    $('#modalTitle').textContent = 'Lv.' + r.level + ' 달성 보상';
    $('#modalSub').textContent = r.claimed ? '수령 완료' : r.unlocked ? '수령 가능' : 'Lv.' + r.level + ' 달성 시 수령 가능';
    $('#modalSub').style.display = '';
    const body = el('div', { class: 'lvreward-modal-body' });
    r.items.forEach(item => {
        const row = el('div', { class: 'lvreward-modal-row' });
        if (item.iconUrl || item.frameUrl) {
            const thumb = el('div', { class: 'lvreward-thumb' });
            if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
            if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
            row.appendChild(thumb);
        }
        row.appendChild(el('span', { class: 'lvreward-modal-name' }, item.name));
        row.appendChild(el('span', { class: 'lvreward-modal-count' }, 'x' + item.count));
        body.appendChild(row);
    });
    if (r.garnet) {
        const row = el('div', { class: 'lvreward-modal-row' });
        if (r.garnetIconUrl) {
            const thumb = el('div', { class: 'lvreward-thumb' });
            thumb.appendChild(el('img', { class: 'auc-item-img', src: r.garnetIconUrl, alt: '가넷', style: 'width:100%;height:100%' }));
            row.appendChild(thumb);
        }
        row.appendChild(el('span', { class: 'lvreward-modal-name' }, '가넷'));
        row.appendChild(el('span', { class: 'lvreward-modal-count' }, r.garnet.toLocaleString()));
        body.appendChild(row);
    }
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

async function loadLevelRewards() {
    const list = $('#levelRewardList');
    if (!list) return;
    try {
        const data = await api('/api/levelrewards');
        renderLevelRewardList(data.list || [], data.userLevel || 1);
    } catch (e) {
        list.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

function renderLevelRewardList(rewards, userLevel) {
    const list = $('#levelRewardList');
    if (!list) return;
    list.replaceChildren(...rewards.map(r => {
        const row = el('div', { class: 'lvreward-row' + (r.claimed ? ' claimed' : ''), style: 'cursor:pointer', onclick: () => openLevelRewardModal(r) });

        const itemsEl = el('div', { class: 'lvreward-items' });
        r.items.forEach(item => {
            const wrap = el('div', { class: 'lvreward-icon-wrap' });
            if (item.iconUrl || item.frameUrl) {
                const thumb = el('div', { class: 'lvreward-thumb' });
                if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
                if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
                wrap.appendChild(thumb);
            } else {
                wrap.appendChild(el('div', { class: 'lvreward-thumb-fallback' }, item.name));
            }
            wrap.appendChild(el('div', { class: 'lvreward-icon-count' }, 'x' + item.count));
            itemsEl.appendChild(wrap);
        });
        if (r.garnet) {
            const gWrap = el('div', { class: 'lvreward-icon-wrap' });
            const gThumb = el('div', { class: 'lvreward-garnet' });
            if (r.garnetIconUrl) gThumb.appendChild(el('img', { src: r.garnetIconUrl, alt: '가넷' }));
            gWrap.appendChild(gThumb);
            gWrap.appendChild(el('div', { class: 'lvreward-icon-count' }, r.garnet.toLocaleString()));
            itemsEl.appendChild(gWrap);
        }

        const right = el('div', { class: 'lvreward-right' });
        const labelClass = (r.claimed || !r.unlocked) ? 'lvreward-label gray' : 'lvreward-label';
        right.appendChild(el('div', { class: labelClass }, 'Lv.' + r.level + ' 달성보상'));
        if (r.claimed) {
            right.appendChild(el('button', { class: 'lvreward-btn done', disabled: true }, '수령 완료'));
        } else if (r.unlocked) {
            const btn = el('button', { class: 'lvreward-btn claim' }, '보상받기');
            btn.onclick = async (e) => {
                e.stopPropagation();
                btn.disabled = true;
                try {
                    const result = await postApi('/api/levelreward', { level: r.level });
                    if (result.profile) renderProfile(result.profile);
                    await loadLevelRewards();
                } catch (e) {
                    showAlert(e.message);
                    btn.disabled = false;
                }
            };
            right.appendChild(btn);
        } else {
            right.appendChild(el('button', { class: 'lvreward-btn locked', disabled: true }, 'Lv.' + r.level + ' 필요'));
        }

        row.appendChild(itemsEl);
        row.appendChild(right);
        return row;
    }));
}

// ===== 경매장 =====

const AUCTION_KIND_ICON = { 'card': '🃏', 'equipment': '⚔️', 'item': '📦', 'pet': '🐾', 'avatar': '🧥' };
const AUCTION_KIND_LABEL = { 'card': '카드', 'equipment': '장비', 'item': '아이템', 'pet': '펫', 'avatar': '아바타' };
let auctionState = { all: [], filter: 'all', me: null, query: '', sort: 'new', currency: 'all', page: 1 };
const AUC_SORTS = {
    new: (a, b) => b.createdAt - a.createdAt,
    priceAsc: (a, b) => a.unitPrice - b.unitPrice,
    priceDesc: (a, b) => b.unitPrice - a.unitPrice,
};
const AUC_PAGE_SIZE = 20;

function renderListPager(pager, state, totalPages, rerender) {
    if (!pager) return;
    if (totalPages <= 1) { pager.style.display = 'none'; pager.replaceChildren(); return; }
    pager.style.display = '';
    const go = p => { state.page = p; rerender(); window.scrollTo({ top: 0, behavior: 'smooth' }); };
    pager.replaceChildren(
        el('button', { disabled: state.page <= 1, onclick: () => go(state.page - 1) }, '‹ 이전'),
        el('span', { class: 'mail-page-info' }, state.page + ' / ' + totalPages),
        el('button', { disabled: state.page >= totalPages, onclick: () => go(state.page + 1) }, '다음 ›')
    );
}

function currencyInline(currency, amount) {
    const icon = currency === 'gold'
        ? '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png')
        : '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png');
    return [el('img', { class: 'currency-img', src: icon, alt: currency === 'gold' ? '골드' : '가넷' }), comma(amount)];
}

function currencyNode(currency, amount, suffix) {
    return el('span', null, ...currencyInline(currency, amount), suffix || '');
}

function auctionThumbEl(entry, options) {
    const d = entry.display || {};
    const style = options && options.style ? options.style : null;
    if (d.imageUrl) return el('div', { class: 'auc-thumb card', style }, el('img', { src: d.imageUrl, alt: d.name }));
    const foreground = d.iconUrl
        ? el('img', { class: 'auc-item-img', src: d.iconUrl, alt: d.name })
        : el('span', { class: 'auc-icon' }, AUCTION_KIND_ICON[entry.kind] || '📦');
    if (d.frameUrl) return el('div', { class: 'auc-thumb square', style },
        el('img', { class: 'auc-frame', src: d.frameUrl, alt: '' }),
        foreground
    );
    return el('div', { class: 'auc-thumb square', style }, foreground);
}

function auctionCardEl(entry) {
    const d = entry.display;
    const title = el('div', { class: 'auc-title' },
        el('div', { class: 'auc-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : ''))
    );
    if (entry.mine) title.appendChild(el('span', { class: 'auc-mine-badge' }, '내 판매'));
    const node = el('div', { class: 'auc-card' + (entry.mine ? ' mine' : ''), onclick: () => openAuctionDetail(entry) },
        auctionThumbEl(entry),
        el('div', { class: 'auc-info' },
            title,
            d.sub ? el('div', { class: 'auc-sub' }, d.sub + (entry.kind === 'equipment' && d.level > 0 ? ' · +' + d.level : '')) : null,
            el('div', { class: 'auc-seller' }, '판매자: ' + entry.sellerName + (entry.ticketCost > 0 ? ' · 거래권 ' + entry.ticketCost + '장' : ''))
        ),
        el('div', { class: 'auc-price' }, currencyNode(entry.currency, entry.unitPrice, entry.kind === 'item' ? ' / 1개' : ''))
    );
    if (d.rarity && RARITY_COLORS[d.rarity]) node.style.setProperty('--rar', RARITY_COLORS[d.rarity]);
    return node;
}

function renderAuctionList() {
    const filter = auctionState.filter;
    const query = (auctionState.query || '').trim().toLowerCase();
    const filtered = auctionState.all.filter(entry => {
        if (filter === 'mine' && !entry.mine) return false;
        if (filter !== 'all' && filter !== 'mine' && entry.kind !== filter) return false;
        if (auctionState.currency !== 'all' && entry.currency !== auctionState.currency) return false;
        if (query) {
            const hay = [entry.display && entry.display.name, entry.display && entry.display.sub, entry.sellerName].filter(Boolean).join(' ').toLowerCase();
            if (hay.indexOf(query) === -1) return false;
        }
        return true;
    }).sort(AUC_SORTS[auctionState.sort] || AUC_SORTS.new);
    if (filtered.length === 0) {
        renderListPager($('#aucPager'), auctionState, 1, renderAuctionList);
        $('#auctionList').replaceChildren(el('div', { class: 'empty' },
            el('div', null, query ? '검색 결과가 없습니다.' : '등록된 판매가 없습니다.'),
            query ? null : el('button', { class: 'primary', style: 'margin-top:12px', onclick: openRegisterModal }, '+ 판매 등록하기')));
        return;
    }
    const totalPages = Math.ceil(filtered.length / AUC_PAGE_SIZE);
    if (auctionState.page > totalPages) auctionState.page = totalPages;
    if (auctionState.page < 1) auctionState.page = 1;
    const pageItems = filtered.slice((auctionState.page - 1) * AUC_PAGE_SIZE, auctionState.page * AUC_PAGE_SIZE);
    $('#auctionList').replaceChildren(...pageItems.map(auctionCardEl));
    renderListPager($('#aucPager'), auctionState, totalPages, renderAuctionList);
}

async function loadAuctions() {
    $('#auctionList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/auction');
        auctionState.all = data.items || [];
        renderAuctionList();
    } catch (e) {
        $('#auctionList').replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

$$('#aucFilter button').forEach(btn => btn.onclick = () => {
    $$('#aucFilter button').forEach(b => b.classList.toggle('on', b === btn));
    auctionState.filter = btn.dataset.filter;
    auctionState.page = 1;
    renderAuctionList();
});
$$('#aucCurrFilter button').forEach(btn => btn.onclick = () => {
    $$('#aucCurrFilter button').forEach(b => b.classList.toggle('on', b === btn));
    auctionState.currency = btn.dataset.curr;
    auctionState.page = 1;
    renderAuctionList();
});
if ($('#aucSearch')) $('#aucSearch').addEventListener('input', e => { auctionState.query = e.target.value; auctionState.page = 1; renderAuctionList(); });
if ($('#aucSort')) $('#aucSort').onchange = e => { auctionState.sort = e.target.value; auctionState.page = 1; renderAuctionList(); };

function showDetail(content, variant) {
    const detail = $('#aucDetail');
    detail.classList.toggle('auction-equipment-modal', variant === 'equipment');
    detail.replaceChildren(...content);
    $('#aucDetailBg').classList.add('active');
}
function closeDetail() {
    $('#aucDetailBg').classList.remove('active');
    $('#aucDetail').classList.remove('auction-equipment-modal');
}

// 거래소 상세 모달 공용 빌더 (상점 구매 모달 패턴 재사용)
function aucModalItemRow(entry, metaLines) {
    const d = entry.display;
    const info = el('div', { style: 'flex:1;min-width:0' },
        el('div', { class: 'shop-buy-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : '')));
    metaLines.filter(Boolean).forEach(t => info.appendChild(el('div', { class: 'shop-buy-meta' }, t)));
    return el('div', { class: 'shop-buy-item-row' }, auctionThumbEl(entry), info);
}

function aucOrbItemNode(entry) {
    const d = entry.display;
    const orb = d.orbDetail;
    return el('section', { class: 'dex-orb-card auc-item-orb-card' },
        el('div', { class: 'dex-orb-head' },
            dexThumb(d.iconUrl, d.frameUrl, '🔮', 'dex-orb-thumb'),
            el('div', { class: 'dex-orb-identity' },
                el('div', { class: 'dex-orb-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : '')),
                el('div', { class: 'dex-orb-parts' },
                    el('span', { class: 'dex-orb-parts-label' }, '부여 가능'),
                    ...(orb.partLabels || []).map(part => el('span', { class: 'dex-orb-part' }, part))
                )
            )
        ),
        el('div', { class: 'dex-orb-effect' },
            el('div', { class: 'dex-orb-effect-title' }, '부여 시 효과'),
            el('div', { class: 'dex-orb-effect-lines' },
                ...(orb.effectLines || []).map(line => el('div', null, line))
            )
        )
    );
}

function aucModalStatBlock(d) {
    const nodes = [];
    if (d.statLines && d.statLines.length) d.statLines.forEach(line => nodes.push(el('div', { class: 'stat-line' }, line)));
    if (d.soul && d.soul.expiredAt) {
        const soulText = formatSoulRemaining(d.soul.expiredAt);
        if (soulText) nodes.push(el('div', { class: 'stat-line', style: 'opacity:0.85;font-style:italic' }, soulText));
    }
    const potBlock = potentialBlockNode(d.potentialDisplay);
    if (potBlock) nodes.push(potBlock);
    return nodes.length ? el('div', null, ...nodes) : null;
}

function aucQtyRow(label, maxQty, hint, onChange) {
    const clamp = v => Math.max(1, Math.min(maxQty, Math.floor(Number(v) || 1)));
    const input = el('input', { type: 'number', class: 'shop-qty-input', value: '1', min: '1', max: String(maxQty) });
    const set = v => { input.value = v; onChange(v); };
    input.oninput = () => set(clamp(input.value));
    return el('div', { class: 'shop-qty-row' },
        el('span', { class: 'shop-qty-label' }, label),
        el('button', { class: 'shop-qty-btn', onclick: () => set(clamp(Number(input.value) - 1)) }, '−'),
        input,
        el('button', { class: 'shop-qty-btn', onclick: () => set(clamp(Number(input.value) + 1)) }, '+'),
        el('span', { class: 'shop-qty-max' }, hint)
    );
}

function openAuctionDetail(entry) {
    const d = entry.display;
    const body = el('div', { class: 'shop-buy-modal' });
    const equipmentDetail = entry.kind === 'equipment' && d.equipmentDetail;
    if (equipmentDetail) {
        body.append(...equipmentModalView(equipmentDetail, false));
        body.appendChild(el('div', { class: 'auc-detail-seller' },
            el('span', null, '판매자'),
            el('strong', null, entry.sellerName)
        ));
    } else if (d.orbDetail) {
        body.appendChild(aucOrbItemNode(entry));
        body.appendChild(el('div', { class: 'auc-detail-seller' },
            el('span', null, '판매자'),
            el('strong', null, entry.sellerName)
        ));
    } else {
        body.appendChild(aucModalItemRow(entry, [
            AUCTION_KIND_LABEL[entry.kind] + (d.sub ? ' · ' + d.sub : '') + (entry.kind === 'equipment' && d.level > 0 ? ' · +' + d.level : ''),
            '판매자: ' + entry.sellerName
        ]));
        const statBlock = aucModalStatBlock(d);
        if (statBlock) body.appendChild(statBlock);
    }

    const errBox = el('div', { class: 'reg-inline-err' });
    const showErr = msg => { errBox.textContent = msg; errBox.classList.add('visible'); };
    const footer = el('div', { class: 'shop-buy-footer' });

    if (entry.mine) {
        body.appendChild(el('div', { class: 'shop-receipt' },
            buildReceiptRow(entry.kind === 'item' ? '개당 가격' : '판매가', { goods: entry.currency }, entry.unitPrice)));
        body.appendChild(el('div', { class: 'shop-buy-meta', style: 'text-align:center' }, '취소 시 등록한 자산이 그대로 반환됩니다.'));
        const cancelBtn = el('button', { class: 'danger', onclick: async () => {
            errBox.classList.remove('visible');
            cancelBtn.disabled = true; cancelBtn.textContent = '처리 중...';
            try {
                const r = await fetch('/api/auction/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
                const x = await r.json();
                if (!r.ok) throw new Error(x.error || '취소 실패');
                closeDetail();
                await loadAuctions();
            } catch (e) {
                showErr(e.message);
                cancelBtn.disabled = false; cancelBtn.textContent = '판매 취소';
            }
        } }, '판매 취소');
        footer.appendChild(el('button', { onclick: closeDetail }, '닫기'));
        footer.appendChild(cancelBtn);
    } else {
        let qty = 1;
        const receipt = el('div', { class: 'shop-receipt' });
        const bal = myGoods ? Number(myGoods[entry.currency] || 0) : null;
        const updateReceipt = () => {
            receipt.replaceChildren();
            const total = entry.unitPrice * qty;
            if (entry.kind === 'item') receipt.appendChild(buildReceiptRow('개당 가격', { goods: entry.currency }, entry.unitPrice));
            if (bal != null) receipt.appendChild(buildReceiptRow('현재 보유', { goods: entry.currency }, bal));
            receipt.appendChild(buildReceiptRow('총 결제', { goods: entry.currency }, total, 'deduct'));
            if (bal != null) {
                receipt.appendChild(el('div', { class: 'shop-receipt-divider' }));
                const after = bal - total;
                receipt.appendChild(buildReceiptRow('구매 후 잔액', { goods: entry.currency }, after, after < 0 ? 'neg' : 'result'));
            }
        };
        if (entry.kind === 'item') {
            body.appendChild(aucQtyRow('구매 수량', entry.count, '재고 ' + comma(entry.count), v => { qty = v; updateReceipt(); }));
        }
        updateReceipt();
        body.appendChild(receipt);
        if (entry.ticketCost > 0) body.appendChild(el('div', { class: 'stat-line', style: 'margin:0' }, '⚠️ 구매 시 거래권 ' + entry.ticketCost + '장이 소모됩니다.'));
        const buyBtn = el('button', { class: 'primary', onclick: async () => {
            errBox.classList.remove('visible');
            buyBtn.disabled = true; buyBtn.textContent = '처리 중...';
            try {
                const reqBody = { id: entry.id };
                if (entry.kind === 'item') reqBody.count = qty;
                const r = await fetch('/api/auction/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
                const x = await r.json();
                if (!r.ok) throw new Error(x.error || '구매 실패');
                closeDetail();
                await loadAuctions();
                api('/api/profile').then(renderProfile).catch(() => {});
            } catch (e) {
                showErr(e.message);
                buyBtn.disabled = false; buyBtn.textContent = '구매';
            }
        } }, '구매');
        footer.appendChild(el('button', { onclick: closeDetail }, '취소'));
        footer.appendChild(buyBtn);
    }
    body.appendChild(errBox);
    body.appendChild(footer);
    showDetail(equipmentDetail ? [body] : [
        el('h3', null, d.name),
        el('div', { class: 'sub' }, entry.mine ? '내 판매 물품' : AUCTION_KIND_LABEL[entry.kind] + ' 구매'),
        body
    ], equipmentDetail ? 'equipment' : null);
}

// ===== 상점 =====

const SHOP_CURR_IMGS = {
    gold:   '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png'),
    garnet: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png'),
    point:  '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('포인트.png'),
};
const SHOP_CURR_LABELS = { gold: '골드', garnet: '가넷', point: '포인트', mileage: '마일리지', item: '아이템' };

let shopData = null;
let shopTab = null;

function shopCurrNode(goods, size) {
    const sz = size || 18;
    if (goods === 'mileage') return el('span', { style: 'font-size:' + Math.round(sz * 0.9) + 'px;line-height:1;flex-shrink:0;display:block;font-style:normal' }, 'Ⓜ️');
    if (SHOP_CURR_IMGS[goods]) return el('img', { src: SHOP_CURR_IMGS[goods], alt: goods, style: 'width:' + sz + 'px;height:' + sz + 'px;object-fit:contain;display:block;flex-shrink:0' });
    return el('span', { style: 'font-size:' + sz + 'px;flex-shrink:0' }, '💰');
}

function buildShopThumb(display, cls) {
    const wrap = el('div', { class: cls || 'shop-card-thumb' });
    if (display.isCurrency && display.iconUrl) {
        wrap.appendChild(el('img', { class: 'shop-card-thumb-curr', src: display.iconUrl, alt: '' }));
    } else if (display.frameUrl || display.iconUrl) {
        if (display.frameUrl) wrap.appendChild(el('img', { class: 'shop-card-thumb-frame', src: display.frameUrl, alt: '' }));
        if (display.iconUrl) wrap.appendChild(el('img', { class: 'shop-card-thumb-icon', src: display.iconUrl, alt: '' }));
    } else {
        const fb = svgIcon(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`);
        fb.style.cssText = 'width:32px;height:32px;display:block;opacity:.6;position:relative;z-index:2;color:var(--text-3)';
        wrap.appendChild(fb);
    }
    return wrap;
}

function priceItemImg(price, size) {
    const sz = size || 20;
    if (!price.iconUrl) return null;
    return el('img', { src: price.iconUrl, alt: '', style: 'width:' + sz + 'px;height:' + sz + 'px;object-fit:contain;display:block;flex-shrink:0' });
}

function buildPriceNode(price) {
    const wrap = el('div', { class: 'shop-card-price' });
    if (price.goods === 'item') {
        const img = priceItemImg(price, 20);
        if (img) wrap.appendChild(img);
        wrap.appendChild(el('span', {}, String(price.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    } else {
        wrap.appendChild(shopCurrNode(price.goods, 18));
        wrap.appendChild(el('span', {}, String(price.amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    }
    return wrap;
}

function buildReceiptRow(label, price, amount, variant) {
    const row = el('div', { class: 'shop-receipt-row' + (variant ? ' ' + variant : '') });
    row.appendChild(el('span', { class: 'shop-receipt-label' }, label));
    const val = el('div', { class: 'shop-receipt-val' });
    if (price.goods === 'item') {
        const img = priceItemImg(price, 16);
        if (img) val.appendChild(img);
        val.appendChild(el('span', {}, String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    } else {
        val.appendChild(shopCurrNode(price.goods, 16));
        val.appendChild(el('span', {}, String(Math.abs(amount)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
    }
    row.appendChild(val);
    return row;
}

// rpgenius.js formatShopLimitSuffix와 동일한 방식으로 제한 정보 구성
function buildLimitRows(limitInfo) {
    if (!limitInfo) return [];
    const { limits, rec, globalCount } = limitInfo;
    const rows = [];
    if (typeof limits.max === 'number')     rows.push({ label: '전체',  used: rec.max,    limit: limits.max    });
    if (typeof limits.daily === 'number')   rows.push({ label: '일일',  used: rec.daily,   limit: limits.daily  });
    if (typeof limits.weekly === 'number')  rows.push({ label: '주간',  used: rec.weekly,  limit: limits.weekly });
    if (typeof limits.monthly === 'number') rows.push({ label: '월간',  used: rec.monthly, limit: limits.monthly });
    if (typeof limits.global === 'number')  rows.push({ label: '선착순', used: globalCount, limit: limits.global, isGlobal: true });
    return rows;
}

function buildLimitBadge(limitInfo) {
    const rows = buildLimitRows(limitInfo);
    if (rows.length === 0) return el('span', {});
    const wrap = el('div', { class: 'shop-limit-badge' });
    rows.forEach(r => {
        const remaining = r.limit - r.used;
        const exhausted = remaining <= 0;
        const row = el('div', { class: 'shop-limit-row' + (exhausted ? ' exhausted' : '') });
        row.appendChild(el('span', { class: 'shop-limit-label' }, r.label));
        row.appendChild(el('span', { class: 'shop-limit-val' },
            comma(r.used) + ' / ' + comma(r.limit)
        ));
        wrap.appendChild(row);
    });
    return wrap;
}

function buildLimitDetail(limitInfo) {
    const rows = buildLimitRows(limitInfo);
    if (rows.length === 0) return null;
    const section = el('div', { class: 'shop-limit-detail' });
    section.appendChild(el('div', { class: 'shop-bundle-label' }, '구매 제한'));
    rows.forEach(r => {
        const remaining = r.limit - r.used;
        const exhausted = remaining <= 0;
        const row = el('div', { class: 'shop-limit-detail-row' + (exhausted ? ' exhausted' : '') });
        row.appendChild(el('span', { class: 'shop-limit-detail-label' }, r.label));
        const bar = el('div', { class: 'shop-limit-bar-wrap' });
        const pct = Math.min(100, Math.round((r.used / r.limit) * 100));
        bar.appendChild(el('div', { class: 'shop-limit-bar', style: '--pct:' + pct + '%' }));
        row.appendChild(bar);
        row.appendChild(el('span', { class: 'shop-limit-detail-val' + (exhausted ? ' exhausted' : '') },
            comma(r.used) + ' / ' + comma(r.limit)
        ));
        section.appendChild(row);
    });
    return section;
}

function renderShop(data, tab) {
    shopData = data;
    shopTab = tab || data.tabs[0];
    const body = $('#shopBody');
    body.replaceChildren();

    const tabRow = el('div', { class: 'shop-tabs' });
    data.tabs.forEach(t => {
        const isHot = t === '핫딜샵';
        tabRow.appendChild(el('button', {
            class: 'shop-tab' + (t === shopTab ? ' active' : '') + (isHot ? ' hotdeal' : ''),
            onclick: () => { if (isHot) { shopTab = '핫딜샵'; renderShopTabs(data, body, tabRow); loadHotDeal(body, tabRow); } else renderShop(data, t); }
        }, t));
    });

    if (shopTab === '핫딜샵') { body.appendChild(tabRow); loadHotDeal(body, tabRow); return; }

    const currBar = el('div', { class: 'shop-currency-bar' });
    [{ key: 'gold', label: '골드' }, { key: 'garnet', label: '가넷' }, { key: 'point', label: '포인트' }, { key: 'mileage', label: '마일리지' }].forEach(({ key, label }) => {
        if (data.currencies[key] == null) return;
        const chip = el('div', { class: 'shop-currency-chip' });
        chip.appendChild(shopCurrNode(key, 18));
        chip.appendChild(el('span', { style: 'color:#94a3b8;font-size:12px;margin-right:2px' }, label));
        chip.appendChild(el('span', {}, String(data.currencies[key]).replace(/\B(?=(\d{3})+(?!\d))/g, ',')));
        currBar.appendChild(chip);
    });
    const grid = el('div', { class: 'shop-grid' });
    (data.shop[shopTab] || []).forEach(item => {
        const card = el('div', { class: 'shop-card' + (item.soldOut ? ' sold-out' : '') });
        card.appendChild(buildShopThumb(item.display));
        card.appendChild(el('div', { class: 'shop-card-name' }, item.display.name));
        card.appendChild(buildPriceNode(item.price));
        if (item.limitInfo) {
            card.appendChild(buildLimitBadge(item.limitInfo));
        }
        card.appendChild(el('button', { class: 'shop-card-btn', onclick: e => { e.stopPropagation(); openShopBuyModal(item); } }, item.owned ? '보유중' : item.soldOut ? '품절' : '구매'));
        if (item.soldOut) card.appendChild(el('span', { class: 'shop-sold-badge' }, item.owned ? '보유중' : '품절'));
        card.onclick = () => { if (!item.soldOut) openShopBuyModal(item); };
        grid.appendChild(card);
    });
    if ((data.shop[shopTab] || []).length === 0) grid.appendChild(el('div', { class: 'empty' }, '상품이 없습니다.'));

    body.appendChild(tabRow);
    body.appendChild(currBar);
    body.appendChild(grid);
}

function openShopBuyModal(item) {
    const d = item.display;
    const p = item.price;
    const li = item.limitInfo;
    const isPackage = shopTab === '패키지';

    // 최대 구매 가능 수량 계산 (모든 제한 타입 반영)
    let maxQty = 999;
    if (li && li.remaining) {
        const r = li.remaining;
        ['max', 'global', 'daily', 'weekly', 'monthly'].forEach(k => {
            if (typeof r[k] === 'number') maxQty = Math.min(maxQty, r[k]);
        });
    }
    if (p.goods !== 'item' && shopData) {
        const bal = shopData.currencies[p.goods] || 0;
        if (p.amount > 0) maxQty = Math.min(maxQty, Math.floor(bal / p.amount));
    } else if (p.goods === 'item') {
        const have = item.priceItemCount || 0;
        if (p.amount > 0) maxQty = Math.min(maxQty, Math.floor(have / p.amount));
    }
    if (item.type === '아바타') maxQty = Math.min(maxQty, 1);
    maxQty = Math.max(0, maxQty);

    let qty = Math.min(1, maxQty || 1);
    const content = el('div', { class: 'shop-buy-modal' });

    // 아이템 미리보기
    const itemRow = el('div', { class: 'shop-buy-item-row' });
    itemRow.appendChild(buildShopThumb(d, 'shop-buy-thumb'));
    const info = el('div', { style: 'flex:1;min-width:0' });
    info.appendChild(el('div', { class: 'shop-buy-name' }, d.name));
    if (p.goods === 'item') {
        const have = item.priceItemCount ?? 0;
        info.appendChild(el('div', { class: 'shop-buy-meta' }, '보유: ' + comma(have) + '개'));
    }
    itemRow.appendChild(info);
    content.appendChild(itemRow);

    // 구매 제한 (rpgenius.js formatShopLimitSuffix 방식)
    if (li) {
        const det = buildLimitDetail(li);
        if (det) content.appendChild(det);
    }

    // 패키지 번들 내용
    if (isPackage && d.bundleContents && d.bundleContents.length > 0) {
        const sec = el('div', { class: 'shop-bundle-section' });
        sec.appendChild(el('div', { class: 'shop-bundle-label' }, '구성품'));
        const list = el('div', { class: 'shop-bundle-list' });
        d.bundleContents.forEach(bc => {
            const row = el('div', { class: 'shop-bundle-row' });
            const mini = el('div', { class: 'shop-bundle-mini' });
            if (bc.imgUrl) {
                mini.appendChild(el('img', { src: bc.imgUrl, style: 'width:100%;height:100%;object-fit:contain' }));
            } else if (bc.label) {
                mini.style.fontSize = '18px';
                mini.textContent = bc.label;
            } else {
                if (bc.frameUrl) mini.appendChild(el('img', { src: bc.frameUrl, style: 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1' }));
                if (bc.iconUrl) mini.appendChild(el('img', { src: bc.iconUrl, style: 'width:75%;height:75%;object-fit:contain;position:relative;z-index:2' }));
            }
            row.appendChild(mini);
            row.appendChild(el('span', { class: 'shop-bundle-name' }, bc.name));
            row.appendChild(el('span', { class: 'shop-bundle-count' }, '×' + bc.count));
            list.appendChild(row);
        });
        sec.appendChild(list);
        content.appendChild(sec);
    }

    // 수량 입력
    const qtyRow = el('div', { class: 'shop-qty-row' });
    qtyRow.appendChild(el('span', { class: 'shop-qty-label' }, '구매 수량'));
    const qtyMinus = el('button', { class: 'shop-qty-btn', onclick: () => { qty = Math.max(1, qty - 1); qtyInput.value = qty; updateReceipt(); } }, '−');
    const qtyInput = el('input', { type: 'number', class: 'shop-qty-input', value: String(qty), min: '1', max: String(maxQty > 0 ? maxQty : 1) });
    qtyInput.oninput = () => { qty = Math.max(1, Math.min(maxQty || 1, parseInt(qtyInput.value) || 1)); qtyInput.value = qty; updateReceipt(); };
    const qtyPlus = el('button', { class: 'shop-qty-btn', onclick: () => { qty = Math.min(maxQty > 0 ? maxQty : 1, qty + 1); qtyInput.value = qty; updateReceipt(); } }, '+');
    qtyRow.appendChild(qtyMinus);
    qtyRow.appendChild(qtyInput);
    qtyRow.appendChild(qtyPlus);
    qtyRow.appendChild(el('span', { class: 'shop-qty-max' }, '최대 ' + (maxQty > 0 ? maxQty : '-')));
    content.appendChild(qtyRow);

    // 계산서
    const receipt = el('div', { class: 'shop-receipt' });
    content.appendChild(receipt);

    function updateReceipt() {
        receipt.replaceChildren();
        const totalCost = p.amount * qty;
        let bal;
        if (p.goods === 'item') {
            bal = item.priceItemCount || 0;
        } else {
            bal = (shopData && shopData.currencies[p.goods]) || 0;
        }
        const after = bal - totalCost;
        receipt.appendChild(buildReceiptRow('현재 보유', p, bal));
        receipt.appendChild(buildReceiptRow('소모', p, totalCost, 'deduct'));
        receipt.appendChild(el('div', { class: 'shop-receipt-divider' }));
        receipt.appendChild(buildReceiptRow('구매 후 잔액', p, after, after < 0 ? 'neg' : 'result'));
    }
    updateReceipt();

    // 버튼
    const footer = el('div', { class: 'shop-buy-footer' });
    footer.appendChild(el('button', { onclick: closeModal }, '취소'));
    const buyBtn = el('button', { class: 'primary', onclick: async () => {
        if (qty < 1) return;
        buyBtn.disabled = true;
        buyBtn.textContent = '처리 중...';
        try {
            const r = await fetch('/api/shop/buy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ shopType: shopTab, index: item.index, count: qty }) });
            const res = await r.json();
            if (!r.ok) throw new Error(res.error || '구매 실패');
            if (shopData) shopData.currencies = res.currencies;
            await loadShop();
            if (res.bundleGranted && res.bundleGranted.length > 0) openBundleGrantedModal(d.name, res.bundleGranted);
            else closeModal();
        } catch (e) {
            buyBtn.disabled = false;
            buyBtn.textContent = '구매';
            showAlert(e.message);
        }
    }}, '구매');
    footer.appendChild(buyBtn);
    content.appendChild(footer);

    $('#modalTitle').textContent = d.name + ' 구매';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

// 번들 상품 구매 시 즉시 수령한 구성품을 보여주는 전용 모달
function openBundleGrantedModal(name, rewards) {
    $('#modalTitle').textContent = name + ' 개봉 결과';
    $('#modalSub').textContent = '아래 아이템을 즉시 수령했습니다';
    $('#modalSub').style.display = '';
    const body = el('div', { class: 'lvreward-modal-body' });
    rewards.forEach(r => {
        const row = el('div', { class: 'lvreward-modal-row' });
        if (r.iconUrl || r.frameUrl) {
            const thumb = el('div', { class: 'lvreward-thumb' });
            if (r.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: r.frameUrl, alt: '' }));
            if (r.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: r.iconUrl, alt: r.name }));
            row.appendChild(thumb);
        }
        row.appendChild(el('span', { class: 'lvreward-modal-name' }, r.name));
        row.appendChild(el('span', { class: 'lvreward-modal-count' }, 'x' + comma(r.count)));
        body.appendChild(row);
    });
    $('#modalBody').replaceChildren(body);
    $('#modalBg').classList.add('active');
}

function renderShopTabs(data, body, tabRow) {
    tabRow.querySelectorAll('.shop-tab').forEach(btn => {
        btn.classList.toggle('active', btn.textContent === shopTab);
    });
}

let hotdealCountdownTimer = null;
function stopHotdealCountdown() { if (hotdealCountdownTimer) { clearInterval(hotdealCountdownTimer); hotdealCountdownTimer = null; } }

async function loadHotDeal(body, tabRow) {
    stopHotdealCountdown();
    const existing = body.querySelector('.hd-root');
    if (!existing) body.appendChild(el('div', { class: 'hd-root' }, el('div', { class: 'loading', style: 'padding:40px 0;text-align:center' }, '불러오는 중...')));
    try {
        const data = await api('/api/hotdeal');
        if (shopTab !== '핫딜샵') return;
        renderHotDeal(data, body, tabRow);
    } catch (e) {
        if (shopTab !== '핫딜샵') return;
        const root = body.querySelector('.hd-root') || body;
        root.replaceChildren(el('div', { class: 'empty err', style: 'padding:40px 0;text-align:center' }, e.message));
    }
}

function renderHotDeal(data, body, tabRow) {
    stopHotdealCountdown();

    const currencyBar = el('div', { class: 'hd-currency-bar' }, el('span', { class: 'hd-currency-label' }, '보유 재화'));
    [{ key: 'gold', label: '골드' }, { key: 'garnet', label: '가넷' }].forEach(({ key, label }) => {
        if (data.currencies[key] == null) return;
        const chip = el('div', { class: 'shop-currency-chip hd-currency-chip' });
        chip.appendChild(shopCurrNode(key, 18));
        chip.appendChild(el('span', { class: 'hd-currency-name' }, label));
        chip.appendChild(el('span', {}, comma(data.currencies[key])));
        currencyBar.appendChild(chip);
    });

    const countdownEl = el('span');
    function updateCountdown() {
        const rem = Math.max(0, data.nextRefreshAt - Date.now());
        const h = String(Math.floor(rem / 3600000)).padStart(2, '0');
        const m = String(Math.floor((rem % 3600000) / 60000)).padStart(2, '0');
        const s = String(Math.floor((rem % 60000) / 1000)).padStart(2, '0');
        countdownEl.replaceChildren('다음 교체까지 ', el('span', null, h + ':' + m + ':' + s));
        if (rem <= 0) { stopHotdealCountdown(); loadHotDeal(body, tabRow); }
    }
    updateCountdown();
    hotdealCountdownTimer = setInterval(updateCountdown, 1000);

    const slots = el('div', { class: 'hd-slots' });
    data.items.forEach(item => {
        const isLightning = item.slot === 1;
        const slot = el('div', { class: 'hd-slot ' + (isLightning ? 'lightning' : 'fire') });
        slot.appendChild(el('div', { class: 'hd-corner top-left' }));
        slot.appendChild(el('div', { class: 'hd-corner top-right' }));
        slot.appendChild(el('div', { class: 'hd-corner bottom-left' }));
        slot.appendChild(el('div', { class: 'hd-corner bottom-right' }));

        // 불꽃/번개 파티클 요소
        if (isLightning) {
            for (let i = 0; i < 3; i++) slot.appendChild(el('div', { class: 'hd-slot-spark' }));
        } else {
            const embers = [['4px','-28px'], ['-3px','-35px'], ['5px','-30px']];
            embers.forEach(([ex, ey]) => {
                const e2 = el('div', { class: 'hd-slot-ember' });
                e2.style.setProperty('--ex', ex);
                e2.style.setProperty('--ey', ey);
                slot.appendChild(e2);
            });
        }

        const inner = el('div', { class: 'hd-slot-inner' });
        // 썸네일
        const thumbStage = el('div', { class: 'hd-thumb-stage' });
        thumbStage.appendChild(el('div', { class: 'hd-thumb-aura' }));
        const thumb = el('div', { class: 'hd-item-thumb auc-thumb square' });
        if (item.frameUrl) thumb.appendChild(el('img', { class: 'auc-frame', src: item.frameUrl, alt: '' }));
        if (item.iconUrl) thumb.appendChild(el('img', { class: 'auc-item-img', src: item.iconUrl, alt: item.name }));
        if (item.purchased) {
            const sold = el('div', { class: 'hd-sold' });
            sold.appendChild(el('div', { class: 'hd-sold-text' }, '구매 완료'));
            thumb.appendChild(sold);
        }
        thumbStage.appendChild(thumb);
        inner.appendChild(thumbStage);
        inner.appendChild(el('div', { class: 'hd-product-copy' },
            el('div', { class: 'hd-item-name' }, item.name),
            el('div', { class: 'hd-item-sub' }, '이번 교체 전까지 구매 가능')
        ));

        const priceRow = el('div', { class: 'hd-price-row' });
        priceRow.appendChild(el('span', { class: 'hd-price-label' }, 'SPECIAL PRICE'));
        const priceValue = el('div', { class: 'hd-price-value' });
        if (item.price.imgUrl) priceValue.appendChild(el('img', { class: 'hd-price-img', src: item.price.imgUrl, alt: item.price.goods }));
        priceValue.appendChild(el('div', { class: 'hd-price-val' }, comma(item.price.amount)));
        priceRow.appendChild(priceValue);
        inner.appendChild(priceRow);

        const btn = el('button', {
            class: 'hd-buy-btn',
            disabled: item.purchased,
            onclick: item.purchased ? null : () => openHotDealBuyModal(item, data, body, tabRow)
        }, item.purchased ? '구매 완료' : '구매');
        inner.appendChild(btn);

        slot.appendChild(inner);
        slots.appendChild(slot);
    });

    const root = el('div', { class: 'hd-root' },
        el('div', { class: 'hd-backdrop-lines', 'aria-hidden': 'true' }),
        el('div', { class: 'hd-header' },
            el('div', { class: 'hd-title' },
                el('span', { class: 'hd-title-ko' }, '핫딜'),
                el('span', { class: 'hd-title-shop' }, 'SHOP')
            ),
            el('div', { class: 'hd-meta' },
                el('div', { class: 'hd-countdown' }, countdownEl)
            )
        ),
        currencyBar,
        slots
    );

    body.replaceChildren(tabRow, root);
}

function openHotDealBuyModal(item, hdData, body, tabRow) {
    const p = item.price;
    const bal = hdData.currencies[p.goods] || 0;
    const after = bal - p.amount;

    const content = el('div', { class: 'shop-buy-modal' });
    const itemRow = el('div', { class: 'shop-buy-item-row' });
    const thumb = el('div', { class: 'shop-buy-thumb' });
    if (item.frameUrl) thumb.appendChild(el('img', { class: 'shop-card-thumb-frame', src: item.frameUrl, alt: '' }));
    if (item.iconUrl) thumb.appendChild(el('img', { class: 'shop-card-thumb-icon', src: item.iconUrl, alt: item.name }));
    itemRow.appendChild(thumb);
    const info = el('div', { style: 'flex:1;min-width:0' });
    info.appendChild(el('div', { class: 'shop-buy-name' }, item.name));
    info.appendChild(el('div', { class: 'shop-buy-meta' }, '핫딜 특가 상품'));
    itemRow.appendChild(info);
    content.appendChild(itemRow);

    const receipt = el('div', { class: 'shop-receipt' });
    const pFull = { goods: p.goods, amount: p.amount, imgUrl: p.imgUrl };
    receipt.appendChild(buildReceiptRow('현재 보유', pFull, bal));
    receipt.appendChild(buildReceiptRow('소모', pFull, p.amount, 'deduct'));
    receipt.appendChild(el('div', { class: 'shop-receipt-divider' }));
    receipt.appendChild(buildReceiptRow('구매 후 잔액', pFull, after, after < 0 ? 'neg' : 'result'));
    content.appendChild(receipt);

    const footer = el('div', { class: 'shop-buy-footer' });
    footer.appendChild(el('button', { onclick: closeModal }, '취소'));
    const buyBtn = el('button', { class: 'primary', onclick: async () => {
        buyBtn.disabled = true; buyBtn.textContent = '처리 중...';
        try {
            const res = await postApi('/api/hotdeal/buy', { slot: item.slot });
            closeModal();
            renderHotDeal(res.hotdeal, body, tabRow);
        } catch (e) {
            buyBtn.disabled = false; buyBtn.textContent = '구매';
            showAlert(e.message);
        }
    }}, '구매');
    footer.appendChild(buyBtn);
    content.appendChild(footer);

    $('#modalTitle').textContent = item.name + ' 구매';
    $('#modalSub').style.display = 'none';
    $('#modalBody').replaceChildren(content);
    $('#modalBg').classList.add('active');
}

async function loadShop() {
    const body = $('#shopBody');
    body.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const r = await fetch('/api/shop');
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '오류');
        renderShop(data, shopTab && (data.shop[shopTab] ? shopTab : null));
    } catch (e) {
        body.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

// ===== 경매 등록 =====

const REG_ICONS = {
    card:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="14" height="19" rx="2"/><path d="M7 7h6"/><path d="M7 11h6"/><path d="M7 15h4"/><path d="M18 8v13a2 2 0 0 1-2 2H6"/></svg>`,
    equipment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    item:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" x2="12" y1="22" y2="12"/></svg>`,
    pet:       `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>`,
    avatar:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/></svg>`,
};
const REG_CHK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
const REG_SLOT_SVGS = {
    weapon:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/></svg>`,
    armor:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    accessory: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/></svg>`,
    support:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>`,
};
REG_SLOT_SVGS.hat = REG_SLOT_SVGS.armor;
REG_SLOT_SVGS.pants = REG_SLOT_SVGS.armor;
REG_SLOT_SVGS.shoes = REG_SLOT_SVGS.armor;
function regCurrImg(c) {
    const file = c === 'gold' ? '골드.png' : '가넷.png';
    return el('img', { src: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent(file), alt: c, style: 'width:22px;height:22px;object-fit:contain;display:block;flex-shrink:0' });
}
function buildRegItemThumb(item, kind) {
    // 아바타는 전용 아이콘(iconUrl)+장비 프레임이 기본, 아이콘이 없으면 카드 합성 미리보기(imageUrl)로 폴백
    if (kind === 'card' || (kind === 'avatar' && !item.iconUrl && item.imageUrl)) {
        return el('div', { class: 'reg-thumb' }, item.imageUrl ? el('img', { class: 'reg-card-img', src: item.imageUrl, alt: '' }) : svgIcon(REG_ICONS[kind]));
    }
    const wrap = el('div', { class: 'reg-thumb sq' });
    if (item.frameUrl) wrap.appendChild(el('img', { class: 'reg-thumb-frame', src: item.frameUrl, alt: '' }));
    if (item.iconUrl) wrap.appendChild(el('img', { class: 'reg-thumb-icon', src: item.iconUrl, alt: '' }));
    else {
        const fallback = kind === 'pet' ? REG_ICONS.pet : kind === 'avatar' ? REG_ICONS.avatar : kind === 'equipment' ? (REG_SLOT_SVGS[item.type] || REG_SLOT_SVGS.weapon) : REG_ICONS.item;
        wrap.appendChild(svgIcon(fallback));
    }
    return wrap;
}

let regState = { kind: 'card', currency: 'gold', selectedIndex: -1, selectedItemId: -1, selectedAvatarName: '', sellable: null };

async function openRegisterModal() {
    regState = { kind: 'card', currency: 'gold', selectedIndex: -1, selectedItemId: -1, selectedAvatarName: '', sellable: null };
    $('#aucReg').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    $('#aucRegBg').classList.add('active');
    try {
        const data = await api('/api/auction/sellable');
        regState.sellable = data;
        renderRegisterModal();
    } catch (e) {
        $('#aucReg').replaceChildren(el('div', { class: 'empty err' }, e.message), el('button', { class: 'close', onclick: closeRegister }, '닫기'));
    }
}
function closeRegister() { $('#aucRegBg').classList.remove('active'); }

function renderRegisterModal() {
    const data = regState.sellable;
    if (!data) return;
    const kind = regState.kind;

    const kindRow = el('div', { class: 'reg-kind-row' },
        ...['card', 'equipment', 'item', 'pet', 'avatar'].map(k => el('button', {
            class: 'reg-kind-btn' + (kind === k ? ' active' : ''),
            onclick: () => { regState.kind = k; regState.selectedIndex = -1; regState.selectedItemId = -1; regState.selectedAvatarName = ''; renderRegisterModal(); }
        }, svgIcon(REG_ICONS[k]), AUCTION_KIND_LABEL[k]))
    );

    let pool, emptyMsg;
    if (kind === 'card') { pool = data.cards; emptyMsg = '판매 가능한 카드가 없습니다.'; }
    else if (kind === 'equipment') { pool = data.equipment; emptyMsg = '판매 가능한 장비가 없습니다.\n(미장착 장비만 등록 가능)'; }
    else if (kind === 'pet') { pool = data.pets || []; emptyMsg = '판매 가능한 펫이 없습니다.\n(거래 가능 횟수 1 이상만 등록 가능)'; }
    else if (kind === 'avatar') { pool = data.avatars || []; emptyMsg = '판매 가능한 아바타가 없습니다.\n(프레스티지 · 거래 횟수를 소진한 한정판 제외)'; }
    else { pool = data.items; emptyMsg = '판매 가능한 아이템이 없습니다.'; }

    const pickList = !pool.length
        ? el('div', { class: 'empty', style: 'padding:16px 0' }, emptyMsg)
        : el('div', { class: 'reg-pick-scroll' }, ...pool.map(item => {
            const isSel = kind === 'item' ? regState.selectedItemId === item.id
                : kind === 'avatar' ? regState.selectedAvatarName === item.name
                : regState.selectedIndex === item.index;
            let thumbEl, nameText, metaText;
            thumbEl = buildRegItemThumb(item, kind);
            if (kind === 'card') {
                nameText = item.formatted; metaText = item.starText || '';
            } else if (kind === 'avatar') {
                nameText = item.name;
                metaText = '아바타 · ' + (item.grade || '일반') + (item.grade === '한정' ? ' (판매 후 재거래 불가)' : '');
            } else if (kind === 'equipment') {
                nameText = item.name + (item.level > 0 ? ' +' + item.level : '');
                metaText = item.rarity + ' · ' + item.typeLabel;
                const st = item.soul && item.soul.expiredAt ? formatSoulRemaining(item.soul.expiredAt) : null;
                if (st) metaText += '\n' + st;
            } else if (kind === 'pet') {
                nameText = item.name + (item.level > 0 ? ' +' + item.level : '');
                metaText = item.rarity + ' · 거래 가능 ' + comma(item.tradeCount) + '회';
            } else {
                nameText = item.name; metaText = item.type + ' · 보유 ' + comma(item.count) + '개';
            }
            const infoEl = el('div', null, el('div', { class: 'reg-item-name' }, nameText), el('div', { class: 'reg-item-meta' }, metaText));
            if (kind === 'equipment' && item.potentialDisplay) {
                const pb = potentialBlockNode(item.potentialDisplay);
                if (pb) infoEl.appendChild(pb);
            }
            const checkEl = el('div', { class: 'reg-check' + (isSel ? ' sel' : '') }, isSel ? svgIcon(REG_CHK_SVG) : null);
            return el('div', {
                class: 'reg-pick-row' + (isSel ? ' selected' : ''),
                onclick: () => { if (kind === 'item') regState.selectedItemId = item.id; else if (kind === 'avatar') regState.selectedAvatarName = item.name; else regState.selectedIndex = item.index; renderRegisterModal(); }
            }, thumbEl, infoEl, checkEl);
        }));

    const content = [
        el('h3', null, '판매 등록'),
        el('div', { class: 'sub' }, '수수료 5%를 제외하고 판매자에게 입금됩니다.'),
        el('div', { class: 'reg-divider' }),
        el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '종류'),
        kindRow,
        el('div', { class: 'reg-section-label' }, '판매할 ' + AUCTION_KIND_LABEL[kind]),
        pickList,
    ];

    if (kind === 'item') {
        const itemSel = data.items.find(i => i.id === regState.selectedItemId);
        if (itemSel) {
            content.push(el('div', { class: 'reg-section-label' }, '갯수'));
            content.push(el('div', { class: 'reg-count-row' },
                el('input', { type: 'number', id: 'regCount', value: 1, min: 1, max: itemSel.count }),
                el('span', { class: 'reg-count-hint' }, '최대 ' + comma(itemSel.count) + '개')
            ));
        }
    }

    content.push(el('div', { class: 'reg-divider' }));
    content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '결제 수단'));
    content.push(el('div', { class: 'reg-currency-row' },
        ...['gold', 'garnet'].map(c => el('button', {
            class: 'reg-curr-btn ' + c + (regState.currency === c ? ' active' : ''),
            onclick: () => { regState.currency = c; renderRegisterModal(); }
        }, regCurrImg(c), c === 'gold' ? '골드' : '가넷'))
    ));
    content.push(el('div', { class: 'reg-section-label' }, kind === 'item' ? '개당 가격' : '가격'));
    content.push(el('div', { class: 'reg-price-wrap' },
        el('span', { class: 'reg-price-icon' }, regCurrImg(regState.currency)),
        el('input', { type: 'number', id: 'regPrice', class: 'reg-price-field', placeholder: '0', min: 1 })
    ));
    content.push(el('div', { class: 'reg-inline-err', id: 'regErr' }));
    content.push(el('div', { class: 'reg-footer' },
        el('button', { onclick: closeRegister }, '취소'),
        el('button', { class: 'primary', onclick: submitRegister }, '등록하기')
    ));

    $('#aucReg').replaceChildren(...content);
}

function showRegErr(msg) {
    const d = $('#regErr');
    if (d) { d.textContent = msg; d.classList.add('visible'); }
}
async function submitRegister() {
    const kind = regState.kind;
    const currency = regState.currency || 'gold';
    const price = Number($('#regPrice').value || 0);
    if (!Number.isInteger(price) || price < 1) { showRegErr('가격은 1 이상의 정수여야 합니다.'); return; }
    const body = { kind, currency, price };
    if (kind === 'card' || kind === 'equipment' || kind === 'pet') {
        if (regState.selectedIndex < 0) { showRegErr(AUCTION_KIND_LABEL[kind] + '를 선택해주세요.'); return; }
        body.index = regState.selectedIndex;
    } else if (kind === 'avatar') {
        if (!regState.selectedAvatarName) { showRegErr('아바타를 선택해주세요.'); return; }
        body.name = regState.selectedAvatarName;
    } else {
        if (regState.selectedItemId < 0) { showRegErr('아이템을 선택해주세요.'); return; }
        const count = Number($('#regCount') ? $('#regCount').value : 1);
        if (!Number.isInteger(count) || count < 1) { showRegErr('갯수는 1 이상의 정수여야 합니다.'); return; }
        body.itemId = regState.selectedItemId;
        body.count = count;
    }
    try {
        const r = await fetch('/api/auction/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const x = await r.json();
        if (!r.ok) throw new Error(x.error || '등록 실패');
        closeRegister();
        await loadAuctions();
        api('/api/profile').then(renderProfile).catch(() => {});
    } catch (e) {
        showRegErr(e.message);
    }
}

$('#aucNew').onclick = openRegisterModal;

// ===== 모달 닫기 핸들러 =====

$('#modalClose').onclick = () => { if (!modalLocked) closeModal(); };
$('#modalBg').onclick = e => { if (e.target.id === 'modalBg' && !modalLocked) closeModal(); };
$('#aucDetailBg').onclick = e => { if (e.target.id === 'aucDetailBg') closeDetail(); };
$('#aucRegBg').onclick = e => { if (e.target.id === 'aucRegBg') closeRegister(); };
$('#boDetailBg').onclick = e => { if (e.target.id === 'boDetailBg') closeBoDetail(); };
$('#boRegBg').onclick = e => { if (e.target.id === 'boRegBg') closeBoRegister(); };
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        if (document.querySelector('.preset-nested-bg')) {
            closePresetNestedModal();
            return;
        }
        if (!modalLocked) closeModal();
        closeDetail();
        closeRegister();
        closeBoDetail();
        closeBoRegister();
    }
});

// ===== 삽니다 (구매 등록) =====

let buyOrderState = { all: [], filter: 'all', query: '', sort: 'new', currency: 'all', page: 1 };

function buyOrderCardEl(entry) {
    const d = entry.display;
    const title = el('div', { class: 'auc-title' },
        el('div', { class: 'auc-name' }, d.name + (entry.count > 1 ? ' x' + comma(entry.count) : ''))
    );
    if (entry.mine) title.appendChild(el('span', { class: 'auc-mine-badge' }, '내 구매'));
    const node = el('div', { class: 'auc-card' + (entry.mine ? ' mine' : ''), onclick: () => openBuyOrderDetail(entry) },
        auctionThumbEl(entry),
        el('div', { class: 'auc-info' },
            title,
            d.sub ? el('div', { class: 'auc-sub' }, d.sub) : null,
            el('div', { class: 'auc-seller' }, '구매자: ' + entry.buyerName)
        ),
        el('div', { class: 'auc-price' }, currencyNode(entry.currency, entry.unitPrice, entry.kind === 'item' ? ' / 1개' : ''))
    );
    if (d.rarity && RARITY_COLORS[d.rarity]) node.style.setProperty('--rar', RARITY_COLORS[d.rarity]);
    return node;
}

function renderBuyOrderList() {
    const filter = buyOrderState.filter;
    const query = (buyOrderState.query || '').trim().toLowerCase();
    const filtered = buyOrderState.all.filter(entry => {
        if (filter === 'mine' && !entry.mine) return false;
        if (filter !== 'all' && filter !== 'mine' && entry.kind !== filter) return false;
        if (buyOrderState.currency !== 'all' && entry.currency !== buyOrderState.currency) return false;
        if (query) {
            const hay = [entry.display && entry.display.name, entry.display && entry.display.sub, entry.buyerName].filter(Boolean).join(' ').toLowerCase();
            if (hay.indexOf(query) === -1) return false;
        }
        return true;
    }).sort(AUC_SORTS[buyOrderState.sort] || AUC_SORTS.new);
    if (filtered.length === 0) {
        renderListPager($('#boPager'), buyOrderState, 1, renderBuyOrderList);
        $('#buyOrderList').replaceChildren(el('div', { class: 'empty' },
            el('div', null, query ? '검색 결과가 없습니다.' : '등록된 구매 요청이 없습니다.'),
            query ? null : el('button', { class: 'primary', style: 'margin-top:12px', onclick: openBoRegisterModal }, '+ 구매 등록하기')));
        return;
    }
    const totalPages = Math.ceil(filtered.length / AUC_PAGE_SIZE);
    if (buyOrderState.page > totalPages) buyOrderState.page = totalPages;
    if (buyOrderState.page < 1) buyOrderState.page = 1;
    const pageItems = filtered.slice((buyOrderState.page - 1) * AUC_PAGE_SIZE, buyOrderState.page * AUC_PAGE_SIZE);
    $('#buyOrderList').replaceChildren(...pageItems.map(buyOrderCardEl));
    renderListPager($('#boPager'), buyOrderState, totalPages, renderBuyOrderList);
}

async function loadBuyOrders() {
    $('#buyOrderList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/buyorder');
        buyOrderState.all = data.items || [];
        renderBuyOrderList();
    } catch (e) {
        $('#buyOrderList').replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

$$('#boFilter button').forEach(btn => btn.onclick = () => {
    $$('#boFilter button').forEach(b => b.classList.toggle('on', b === btn));
    buyOrderState.filter = btn.dataset.filter;
    buyOrderState.page = 1;
    renderBuyOrderList();
});
$$('#boCurrFilter button').forEach(btn => btn.onclick = () => {
    $$('#boCurrFilter button').forEach(b => b.classList.toggle('on', b === btn));
    buyOrderState.currency = btn.dataset.curr;
    buyOrderState.page = 1;
    renderBuyOrderList();
});
if ($('#boSearch')) $('#boSearch').addEventListener('input', e => { buyOrderState.query = e.target.value; buyOrderState.page = 1; renderBuyOrderList(); });
if ($('#boSort')) $('#boSort').onchange = e => { buyOrderState.sort = e.target.value; buyOrderState.page = 1; renderBuyOrderList(); };

function showBoDetail(content) {
    $('#boDetail').replaceChildren(...content);
    $('#boDetailBg').classList.add('active');
}
function closeBoDetail() { $('#boDetailBg').classList.remove('active'); }

async function openBuyOrderDetail(entry) {
    const d = entry.display;
    const body = el('div', { class: 'shop-buy-modal' });
    body.appendChild(aucModalItemRow(entry, [
        AUCTION_KIND_LABEL[entry.kind] + (d.sub ? ' · ' + d.sub : ''),
        '구매자: ' + entry.buyerName + (entry.count > 1 ? ' · 요청 ' + comma(entry.count) + '개' : '')
    ]));
    const statBlock = aucModalStatBlock(d);
    if (statBlock) body.appendChild(statBlock);

    const errBox = el('div', { class: 'reg-inline-err' });
    const showErr = msg => { errBox.textContent = msg; errBox.classList.add('visible'); };
    const footer = el('div', { class: 'shop-buy-footer' });

    if (entry.mine) {
        const totalRefund = entry.unitPrice * entry.count;
        body.appendChild(el('div', { class: 'shop-receipt' },
            buildReceiptRow(entry.kind === 'item' ? '개당 가격' : '제시 가격', { goods: entry.currency }, entry.unitPrice),
            el('div', { class: 'shop-receipt-divider' }),
            buildReceiptRow('취소 시 반환 (미체결분)', { goods: entry.currency }, totalRefund, 'result')));
        if (entry.ticketCost > 0) body.appendChild(el('div', { class: 'shop-buy-meta', style: 'text-align:center' }, '거래권 ' + (entry.ticketCost * entry.count) + '장도 함께 반환됩니다.'));
        const cancelBtn = el('button', { class: 'danger', onclick: async () => {
            errBox.classList.remove('visible');
            cancelBtn.disabled = true; cancelBtn.textContent = '처리 중...';
            try {
                const r = await fetch('/api/buyorder/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: entry.id }) });
                const x = await r.json();
                if (!r.ok) throw new Error(x.error || '취소 실패');
                closeBoDetail();
                await loadBuyOrders();
                api('/api/profile').then(renderProfile).catch(() => {});
            } catch (e) {
                showErr(e.message);
                cancelBtn.disabled = false; cancelBtn.textContent = '구매 등록 취소';
            }
        } }, '구매 등록 취소');
        footer.appendChild(el('button', { onclick: closeBoDetail }, '닫기'));
        footer.appendChild(cancelBtn);
        body.appendChild(errBox);
        body.appendChild(footer);
        showBoDetail([el('h3', null, d.name), el('div', { class: 'sub' }, '내 구매 등록'), body]);
        return;
    }

    const loading = el('div', { class: 'loading' }, '판매 가능한 자산 확인 중...');
    body.appendChild(loading);
    showBoDetail([el('h3', null, d.name), el('div', { class: 'sub' }, AUCTION_KIND_LABEL[entry.kind] + ' 판매'), body]);
    let fulfillable;
    try {
        fulfillable = await api('/api/buyorder/fulfillable?id=' + encodeURIComponent(entry.id));
    } catch (e) {
        loading.replaceWith(el('div', { class: 'empty err' }, e.message), el('button', { onclick: closeBoDetail, style: 'width:100%' }, '닫기'));
        return;
    }
    loading.remove();
    const sellBtn = renderFulfillSection(entry, fulfillable, body, errBox);
    if (sellBtn) {
        footer.appendChild(el('button', { onclick: closeBoDetail }, '취소'));
        footer.appendChild(sellBtn);
    } else {
        footer.style.gridTemplateColumns = '1fr';
        footer.appendChild(el('button', { onclick: closeBoDetail }, '닫기'));
    }
    body.appendChild(errBox);
    body.appendChild(footer);
}

function renderFulfillSection(entry, fulfillable, body, errBox) {
    let selectedIndex = -1;
    let qty = 1;
    const showErr = msg => { errBox.textContent = msg; errBox.classList.add('visible'); };
    const receipt = el('div', { class: 'shop-receipt' });
    const updateReceipt = () => {
        const total = entry.unitPrice * qty;
        const feeRate = Number.isFinite(Number(fulfillable.feeRate)) ? Number(fulfillable.feeRate) : 0.05;
        const fee = Math.floor(total * feeRate);
        const feePercent = Math.round(feeRate * 1000) / 10;
        receipt.replaceChildren(
            buildReceiptRow('판매 대금', { goods: entry.currency }, total),
            buildReceiptRow('수수료 (' + feePercent + '%)', { goods: entry.currency }, fee, 'deduct'),
            el('div', { class: 'shop-receipt-divider' }),
            buildReceiptRow('실 입금', { goods: entry.currency }, total - fee, 'result')
        );
    };

    if (entry.kind === 'item') {
        if (fulfillable.itemCount < 1) {
            body.appendChild(el('div', { class: 'empty' }, '판매 가능한 수량이 없습니다.'));
            return null;
        }
        const maxSell = Math.min(fulfillable.itemCount, entry.count);
        body.appendChild(aucQtyRow('판매 수량', maxSell, '보유 ' + comma(fulfillable.itemCount) + ' · 요청 ' + comma(entry.count), v => { qty = v; updateReceipt(); }));
    } else if (entry.kind === 'avatar') {
        const av = fulfillable.avatar || {};
        if (!av.owned) {
            body.appendChild(el('div', { class: 'empty' }, '해당 아바타를 보유하고 있지 않습니다.'));
            return null;
        }
        if (av.tradeBlockReason) {
            body.appendChild(el('div', { class: 'empty' }, av.tradeBlockReason));
            return null;
        }
        const avThumb = av.iconUrl
            ? el('img', { src: av.iconUrl, style: { width: '36px', height: '36px', objectFit: 'contain' } })
            : (av.imageUrl ? el('img', { src: av.imageUrl, style: { width: '32px', height: '42px', objectFit: 'cover', borderRadius: '4px' } }) : null);
        body.appendChild(el('div', { class: 'pick-list', style: 'margin-top:0' },
            el('div', { class: 'pick-row on' },
                el('div', null, el('b', null, av.name), el('div', { class: 'meta' }, '판매 시 아바타 해금이 구매자 계정으로 이전됩니다.')),
                avThumb
            )
        ));
    } else {
        const pool = entry.kind === 'card' ? (fulfillable.cards || [])
            : entry.kind === 'equipment' ? (fulfillable.equipment || [])
            : (fulfillable.pets || []);
        if (!pool.length) {
            const msg = entry.kind === 'card' ? '조건에 맞는 보유 카드가 없습니다.'
                : entry.kind === 'equipment' ? '조건에 맞는 보유 장비가 없습니다.'
                : '조건에 맞는 보유 펫이 없습니다.\n(거래 가능 횟수가 1 이상이어야 합니다)';
            body.appendChild(el('div', { class: 'empty' }, msg));
            return null;
        }
        const pick = el('div', { class: 'pick-list', style: 'margin-top:0' });
        pool.forEach(it => {
            let title, meta, img = null;
            if (entry.kind === 'card') {
                title = it.formatted; meta = it.starText;
                img = it.imageUrl ? el('img', { src: it.imageUrl, style: { width: '32px', height: '42px', objectFit: 'cover', borderRadius: '4px' } }) : null;
            } else if (entry.kind === 'equipment') {
                title = it.name + (it.level > 0 ? ' +' + it.level : ''); meta = it.rarity + ' · ' + it.typeLabel;
            } else {
                title = it.name + (it.level > 0 ? ' +' + it.level : ''); meta = it.rarity + ' · 거래 가능 ' + comma(it.tradeCount) + '회';
            }
            const row = el('div', {
                class: 'pick-row',
                onclick: () => {
                    selectedIndex = it.index;
                    Array.from(pick.children).forEach(c => c.classList.remove('on'));
                    row.classList.add('on');
                }
            }, el('div', null, el('b', null, title), el('div', { class: 'meta' }, meta)), img);
            pick.appendChild(row);
        });
        body.appendChild(el('div', { class: 'reg-section-label', style: 'margin:0' }, '판매할 ' + AUCTION_KIND_LABEL[entry.kind] + ' 선택'));
        body.appendChild(pick);
    }
    updateReceipt();
    body.appendChild(receipt);

    const sellBtn = el('button', { class: 'primary', onclick: async () => {
        errBox.classList.remove('visible');
        const reqBody = { id: entry.id };
        if (entry.kind === 'item') reqBody.count = qty;
        else if (entry.kind !== 'avatar') {
            if (selectedIndex < 0) return showErr('판매할 ' + AUCTION_KIND_LABEL[entry.kind] + '을(를) 선택해주세요.');
            reqBody.index = selectedIndex;
        }
        sellBtn.disabled = true; sellBtn.textContent = '처리 중...';
        try {
            const r = await fetch('/api/buyorder/fulfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
            const x = await r.json();
            if (!r.ok) throw new Error(x.error || '판매 실패');
            closeBoDetail();
            await loadBuyOrders();
            api('/api/profile').then(renderProfile).catch(() => {});
        } catch (e) {
            showErr(e.message);
            sellBtn.disabled = false; sellBtn.textContent = '판매하기';
        }
    } }, '판매하기');
    return sellBtn;
}

// ===== 구매 등록 모달 =====

let boRegState = { kind: 'card', lookups: null, cardId: -1, star: 0, type: '', equipType: 'weapon', equipId: -1, levelSpecified: false, level: 0, itemId: -1, petId: -1, avatarName: '', count: 1, search: '' };

async function openBoRegisterModal() {
    boRegState = { kind: 'card', currency: 'gold', lookups: null, cardId: -1, star: 0, type: '', equipType: 'weapon', equipId: -1, levelSpecified: false, level: 0, itemId: -1, petId: -1, avatarName: '', count: 1, search: '' };
    $('#boReg').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    $('#boRegBg').classList.add('active');
    try {
        const data = await api('/api/buyorder/lookups');
        boRegState.lookups = data;
        renderBoRegisterModal();
    } catch (e) {
        $('#boReg').replaceChildren(el('div', { class: 'empty err' }, e.message), el('button', { class: 'close', onclick: closeBoRegister }, '닫기'));
    }
}
function closeBoRegister() { $('#boRegBg').classList.remove('active'); }

function renderBoRegisterModal() {
    const data = boRegState.lookups;
    if (!data) return;
    const kind = boRegState.kind;

    const kindRow = el('div', { class: 'reg-kind-row' },
        ...['card', 'equipment', 'item', 'pet', 'avatar'].map(k => el('button', {
            class: 'reg-kind-btn' + (kind === k ? ' active' : ''),
            onclick: () => { boRegState.kind = k; boRegState.search = ''; renderBoRegisterModal(); }
        }, svgIcon(REG_ICONS[k]), AUCTION_KIND_LABEL[k]))
    );

    const content = [
        el('h3', null, '구매 등록'),
        el('div', { class: 'sub' }, '등록 시 가격이 선결제되며, 취소 시 미체결 분이 반환됩니다.'),
        el('div', { class: 'reg-divider' }),
        el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '종류'),
        kindRow,
        el('div', { class: 'reg-divider' }),
    ];

    const makeCountInput = () => {
        const inp = el('input', { type: 'number', value: boRegState.count, min: 1 });
        inp.oninput = e => { let v = Math.floor(Number(e.target.value || 1)); if (v < 1) v = 1; boRegState.count = v; e.target.value = v; };
        return el('div', { class: 'reg-count-row' }, inp, el('span', { class: 'reg-count-hint' }, '개'));
    };

    const makeItemGrid = (items, selectedId, onSelect, renderThumb) => {
        const wrap = el('div', { class: 'bo-img-wrap' });
        const inp = el('input', { type: 'search', class: 'bo-search-inp', placeholder: '이름으로 검색...', value: boRegState.search });
        const grid = el('div', { class: 'bo-img-grid' });

        const filterGrid = q => {
            const lower = q.toLowerCase();
            let visible = 0;
            grid.querySelectorAll('.bo-img-cell').forEach(cell => {
                const show = !lower || cell.dataset.name.toLowerCase().includes(lower);
                cell.style.display = show ? '' : 'none';
                if (show) visible++;
            });
            let empty = grid.querySelector('.bo-img-empty');
            if (!visible) {
                if (!empty) { empty = el('div', { class: 'bo-img-empty' }, '검색 결과 없음'); grid.appendChild(empty); }
            } else {
                if (empty) empty.remove();
            }
        };

        inp.oninput = e => { boRegState.search = e.target.value; filterGrid(e.target.value); };

        items.forEach(item => {
            const isSelected = item.id === selectedId;
            const cell = el('div', {
                class: 'bo-img-cell' + (isSelected ? ' selected' : ''),
                onclick: () => { onSelect(item.id); renderBoRegisterModal(); }
            });
            cell.dataset.name = item.name;
            const thumb = el('div', { class: 'bo-img-thumb' });
            renderThumb(thumb, item);
            cell.appendChild(thumb);
            cell.appendChild(el('div', { class: 'bo-img-name' }, item.name));
            grid.appendChild(cell);
        });
        if (!items.length) grid.appendChild(el('div', { class: 'bo-img-empty' }, '항목 없음'));

        wrap.appendChild(inp);
        wrap.appendChild(grid);
        filterGrid(boRegState.search);
        // 렌더 후 포커스 복원
        requestAnimationFrame(() => { if (boRegState.search) inp.focus(); });
        return wrap;
    };

    if (kind === 'card') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '캐릭터 카드'));
        content.push(makeItemGrid(data.cards, boRegState.cardId, id => { boRegState.cardId = id; }, (thumb, c) => {
            if (c.imageUrl) thumb.appendChild(el('img', { src: c.imageUrl, alt: c.name }));
            else thumb.appendChild(el('span', { class: 'bo-img-fallback' }, c.name[0]));
        }));

        if (boRegState.cardId >= 0) {
            content.push(el('div', { class: 'reg-section-label' }, '상세 조건'));
            const detailGrid = el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' });
            const starSel = el('select', { onchange: e => { boRegState.star = Number(e.target.value); renderBoRegisterModal(); } });
            for (let i = 0; i <= 11; i++) {
                const opt = el('option', { value: i }, (i + 1) + '성' + (i >= 4 ? ' (거래권 ' + Math.max(0, i - 3) + '장)' : ''));
                if (boRegState.star === i) opt.selected = true;
                starSel.appendChild(opt);
            }
            const typeSel = el('select', { onchange: e => { boRegState.type = e.target.value; } },
                el('option', { value: '' }, '타입 무관'),
                el('option', { value: '일반', selected: boRegState.type === '일반' ? 'selected' : null }, '일반')
            );
            const starWrap = el('div', null, el('div', { style: 'font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px' }, '성급 (정확 일치)'), starSel);
            const typeWrap = el('div', null, el('div', { style: 'font-size:11px;color:#64748b;font-weight:700;margin-bottom:4px' }, '타입'), typeSel);
            detailGrid.appendChild(starWrap); detailGrid.appendChild(typeWrap);
            content.push(detailGrid);
        }
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());

    } else if (kind === 'avatar') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '아바타'));
        const avatarItems = (data.avatars || []).map(a => ({ id: a.name, name: a.name + (a.grade === '한정' ? ' [한정]' : ''), iconUrl: a.iconUrl, frameUrl: a.frameUrl, imageUrl: a.imageUrl }));
        content.push(makeItemGrid(avatarItems, boRegState.avatarName, id => { boRegState.avatarName = id; }, (thumb, a) => {
            if (a.iconUrl) {
                if (a.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: a.frameUrl, alt: '' }));
                thumb.appendChild(el('img', { class: 'bo-img-icon', src: a.iconUrl, alt: a.name }));
            } else if (a.imageUrl) thumb.appendChild(el('img', { src: a.imageUrl, alt: a.name }));
            else thumb.appendChild(el('span', { class: 'bo-img-fallback' }, a.name[0]));
        }));

    } else if (kind === 'equipment') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '장비 종류'));
        const equipTypeRow = el('div', { class: 'reg-equip-row' },
            ...EQUIP_TYPE_ORDER.map(([k, label]) =>
                el('button', { class: 'reg-equip-btn' + (boRegState.equipType === k ? ' active' : ''),
                    onclick: () => { boRegState.equipType = k; boRegState.equipId = -1; boRegState.search = ''; renderBoRegisterModal(); }
                }, svgIcon(REG_SLOT_SVGS[k]), label)
            )
        );
        content.push(equipTypeRow);
        content.push(el('div', { class: 'reg-section-label' }, '장비'));
        const eqList = data.equipment[boRegState.equipType] || [];
        content.push(makeItemGrid(eqList, boRegState.equipId, id => { boRegState.equipId = id; }, (thumb, eq) => {
            if (eq.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: eq.frameUrl, alt: '' }));
            if (eq.iconUrl) thumb.appendChild(el('img', { class: 'bo-img-icon', src: eq.iconUrl, alt: eq.name }));
            else if (!eq.frameUrl) thumb.appendChild(el('span', { class: 'bo-img-fallback' }, eq.name[0]));
        }));

        const lvToggle = el('label', { class: 'reg-level-toggle' },
            el('input', { type: 'checkbox', checked: boRegState.levelSpecified ? 'checked' : null,
                onchange: e => { boRegState.levelSpecified = e.target.checked; renderBoRegisterModal(); } }),
            '강화 레벨 지정'
        );
        content.push(lvToggle);
        if (boRegState.levelSpecified) {
            content.push(el('div', { class: 'reg-section-label' }, '강화 레벨 (0~15)'));
            const lvInp = el('input', { type: 'number', value: boRegState.level, min: 0, max: 15, style: 'width:100%;padding:10px 12px;background:rgba(4,6,14,.85);border:1px solid rgba(255,255,255,.1);border-radius:10px;color:#e5e7eb;font-size:15px;font-weight:700;outline:none' });
            lvInp.oninput = e => { let v = Math.max(0, Math.min(15, Math.floor(Number(e.target.value || 0)))); boRegState.level = v; e.target.value = v; };
            content.push(lvInp);
        }
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());

    } else if (kind === 'pet') {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '펫'));
        content.push(makeItemGrid(data.pets || [], boRegState.petId, id => { boRegState.petId = id; }, (thumb, p) => {
            if (p.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: p.frameUrl, alt: '' }));
            if (p.iconUrl) thumb.appendChild(el('img', { class: 'bo-img-icon', src: p.iconUrl, alt: p.name }));
            else if (!p.frameUrl) thumb.appendChild(el('span', { class: 'bo-img-fallback' }, p.name[0]));
        }));
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());

    } else {
        content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '아이템'));
        content.push(makeItemGrid(data.items, boRegState.itemId, id => { boRegState.itemId = id; }, (thumb, it) => {
            if (it.frameUrl) thumb.appendChild(el('img', { class: 'bo-img-frame', src: it.frameUrl, alt: '' }));
            if (it.iconUrl) thumb.appendChild(el('img', { class: 'bo-img-icon', src: it.iconUrl, alt: it.name }));
            else if (!it.frameUrl) thumb.appendChild(el('span', { class: 'bo-img-fallback' }, it.name[0]));
        }));
        content.push(el('div', { class: 'reg-section-label' }, '갯수'));
        content.push(makeCountInput());
    }

    content.push(el('div', { class: 'reg-divider' }));
    content.push(el('div', { class: 'reg-section-label', style: 'margin-top:0' }, '결제 수단'));
    content.push(el('div', { class: 'reg-currency-row' },
        ...['gold', 'garnet'].map(c => el('button', {
            class: 'reg-curr-btn ' + c + (boRegState.currency === c ? ' active' : ''),
            onclick: () => { boRegState.currency = c; renderBoRegisterModal(); }
        }, regCurrImg(c), c === 'gold' ? '골드' : '가넷'))
    ));
    content.push(el('div', { class: 'reg-section-label' }, '개당 가격'));
    content.push(el('div', { class: 'reg-price-wrap' },
        el('span', { class: 'reg-price-icon' }, regCurrImg(boRegState.currency)),
        el('input', { type: 'number', id: 'boRegPrice', class: 'reg-price-field', placeholder: '0', min: 1 })
    ));
    content.push(el('div', { class: 'reg-inline-err', id: 'boRegErr' }));
    content.push(el('div', { class: 'reg-footer' },
        el('button', { onclick: closeBoRegister }, '취소'),
        el('button', { class: 'primary', onclick: submitBoRegister }, '등록하기')
    ));

    $('#boReg').replaceChildren(...content);
}

function showBoRegErr(msg) {
    const d = $('#boRegErr');
    if (d) { d.textContent = msg; d.classList.add('visible'); }
}
async function submitBoRegister() {
    const kind = boRegState.kind;
    const currency = boRegState.currency || 'gold';
    const price = Number($('#boRegPrice').value || 0);
    if (!Number.isInteger(price) || price < 1) { showBoRegErr('가격은 1 이상의 정수여야 합니다.'); return; }
    const body = { kind, currency, price, count: kind === 'avatar' ? 1 : boRegState.count };
    if (kind === 'card') {
        if (boRegState.cardId < 0) { showBoRegErr('카드를 선택해주세요.'); return; }
        body.cardId = boRegState.cardId; body.star = boRegState.star;
        if (boRegState.type) body.type = boRegState.type;
    } else if (kind === 'avatar') {
        if (!boRegState.avatarName) { showBoRegErr('아바타를 선택해주세요.'); return; }
        body.name = boRegState.avatarName;
    } else if (kind === 'equipment') {
        if (boRegState.equipId < 0) { showBoRegErr('장비를 선택해주세요.'); return; }
        body.equipType = boRegState.equipType; body.equipId = boRegState.equipId;
        if (boRegState.levelSpecified) body.level = boRegState.level;
    } else if (kind === 'pet') {
        if (boRegState.petId < 0) { showBoRegErr('펫을 선택해주세요.'); return; }
        body.petId = boRegState.petId;
    } else {
        if (boRegState.itemId < 0) { showBoRegErr('아이템을 선택해주세요.'); return; }
        body.itemId = boRegState.itemId;
    }
    try {
        const r = await fetch('/api/buyorder/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const x = await r.json();
        if (!r.ok) throw new Error(x.error || '등록 실패');
        closeBoRegister();
        await loadBuyOrders();
        api('/api/profile').then(renderProfile).catch(() => {});
    } catch (e) {
        showBoRegErr(e.message);
    }
}

if ($('#boNew')) $('#boNew').onclick = openBoRegisterModal;

async function loadProfile(name) {
    const url = name && name !== myName ? '/api/profile/' + encodeURIComponent(name) : '/api/profile';
    const data = await api(url);
    // activatePage('info')는 navigatePage에서 '다른 사람 보던 중 정보 탭 진입 시 내 정보로 복귀' 로직을 트리거한다.
    // 특정 프로필을 불러오는 중에는 그 복귀 로직을 막아, 클릭한 대상이 자기 자신으로 덮어쓰이지 않게 한다.
    suppressInfoSelfReset = true;
    activatePage('info');
    suppressInfoSelfReset = false;
    renderProfile(data);
}

// ===== PVP =====
const PVP_KIND_LABELS = { near: '근접', higher: '상위', random: '랜덤', extra: '추가' };
const PVP_COND_OPTIONS = [
    ['always', '항상'], ['hpBelow', '내 HP ≤ N%'], ['hpAbove', '내 HP ≥ N%'],
    ['enemyHpBelow', '상대 HP ≤ N%'], ['enemyHpAbove', '상대 HP ≥ N%'], ['mpBelow', '내 MP ≤ N%'],
    ['skillReady', '스킬 사용 가능'], ['enemyDefending', '상대 방어 중']
];
const PVP_ACTION_OPTIONS = [['attack', '공격'], ['skill', '스킬'], ['defend', '방어']];
const PVP_VALUE_CONDS = ['hpBelow', 'hpAbove', 'enemyHpBelow', 'enemyHpAbove', 'mpBelow'];
const PVP_DEFAULT_RULES = [
    { cond: 'hpBelow', value: 30, action: 'defend', skill: null },
    { cond: 'skillReady', value: null, action: 'skill', skill: null },
    { cond: 'always', value: null, action: 'attack', skill: null }
];
const PVP_MAX_RULES = 8;
let pvpState = { data: null, draft: null, busy: false };

async function loadPvp() {
    const root = $('#pvpRoot');
    if (!root) return;
    root.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        pvpState.data = await api('/api/pvp');
    } catch (e) {
        root.replaceChildren(el('div', { class: 'empty err' }, e.message));
        return;
    }
    pvpState.draft = pvpDefenseDraft(pvpState.data.defense);
    renderPvp();
}

// 서버 방어 설정을 로컬 편집 상태로 복사한다. 카드 객체를 그대로 들고 있다가 저장 시 sig만 보낸다.
function pvpDefenseDraft(defense) {
    const d = defense || {};
    const maxSlots = Math.max(0, Number(d.maxSlots || 0));
    const source = Array.isArray(d.rules) && d.rules.length ? d.rules : PVP_DEFAULT_RULES;
    return {
        useEquipped: d.useEquipped !== false,
        mainCard: d.mainCard || null,
        slotCards: Array.from({ length: maxSlots }, (_, i) => (d.slotCards || [])[i] || null),
        rules: source.map(r => ({
            cond: r.cond || 'always',
            value: r.value == null ? null : Number(r.value),
            action: r.action || 'attack',
            skill: r.skill || null
        }))
    };
}

function pvpSection(title, caption, ...nodes) {
    return el('section', { class: 'pvp-section' },
        el('div', { class: 'pvp-section-head' },
            el('h3', null, title),
            caption ? el('span', { class: 'pvp-caption' }, caption) : null),
        ...nodes);
}

function pvpGoBattle(name) {
    location.href = '/pvp?opponent=' + encodeURIComponent(name);
}

function renderPvp() {
    const root = $('#pvpRoot');
    const d = pvpState.data;
    if (!root || !d) return;
    root.replaceChildren(el('div', { class: 'pvp-shell' },
        pvpMeNode(d),
        pvpOpponentsNode(d),
        pvpDeckNode(d),
        pvpRulesNode(d),
        el('div', { class: 'pvp-save-row' },
            el('button', { class: 'primary', type: 'button', disabled: pvpState.busy, onclick: savePvpDefense }, '저장')),
        pvpRankingNode(d),
        pvpHistoryNode(d)
    ));
}

function pvpMeNode(d) {
    const me = d.me || {};
    const daily = d.daily || {};
    const refreshLeft = Math.max(0, Number(daily.refreshMax || 0) - Number(daily.refreshUsed || 0));
    const extraLeft = Math.max(0, Number(daily.extraMax || 0) - Number(daily.extraUsed || 0));
    const battle = d.battle;
    return el('section', { class: 'pvp-section pvp-me' },
        el('div', { class: 'pvp-section-head' },
            el('h3', null, 'PVP'),
            el('div', { class: 'pvp-head-btns' },
                el('button', { class: 'pvp-refresh', type: 'button', disabled: !daily.canRefresh || pvpState.busy, onclick: refreshPvpOpponents },
                    '새로고침 (남은 ' + refreshLeft + '회)'),
                el('button', { class: 'pvp-extra', type: 'button', disabled: !daily.canBuyExtra || pvpState.busy, onclick: buyPvpExtraPlay },
                    (daily.extraFree ? '추가 플레이 무료' : '추가 플레이 ' + comma(daily.extraCost || 0) + '가넷') + ' (남은 ' + extraLeft + '회)'))),
        el('div', { class: 'pvp-me-grid' },
            el('div', { class: 'pvp-rating' },
                el('span', { class: 'pvp-metric-label' }, '레이팅'),
                el('div', { class: 'pvp-rating-line' },
                    el('b', null, comma(me.rating)),
                    me.rank ? el('span', { class: 'pvp-rank-badge rk' + me.rank }, comma(me.rank) + '위') : null)),
            el('div', { class: 'pvp-metric' },
                el('span', { class: 'pvp-metric-label' }, '전적'),
                el('div', { class: 'pvp-wl' },
                    el('b', { class: 'win' }, comma(me.wins) + '승'),
                    el('b', { class: 'lose' }, comma(me.losses) + '패'))),
            el('div', { class: 'pvp-metric' },
                el('span', { class: 'pvp-metric-label' }, '오늘 전투'),
                el('b', { class: 'pvp-metric-value' }, comma(daily.battlesUsed) + ' / ' + comma(daily.battlesMax)))),
        battle && battle.active ? el('div', { class: 'pvp-resume' },
            el('span', null, '진행 중인 전투 — ' + battle.opponent),
            el('button', { class: 'primary', type: 'button', onclick: () => pvpGoBattle(battle.opponent) }, '이어하기')) : null);
}

function pvpOpponentTile(o) {
    const done = o.result === 'win' || o.result === 'lose';
    const delta = Math.abs(Number(o.ratingDelta || 0));
    return el('div', { class: 'pvp-opp' + (done ? ' done' : '') },
        el('div', { class: 'pvp-opp-art' },
            o.cardImageUrl
                ? el('img', { src: o.cardImageUrl, alt: o.cardFormatted || o.cardName || '' })
                : el('div', { class: 'no-img' }, o.cardName || '카드 없음'),
            el('span', { class: 'pvp-kind' }, PVP_KIND_LABELS[o.kind] || o.kind || '')),
        el('div', { class: 'pvp-opp-name' }, o.name),
        el('div', { class: 'pvp-opp-meta' }, 'Lv. ' + comma(o.level), el('span', null, comma(o.rating))),
        done
            ? el('div', { class: 'pvp-opp-result ' + o.result }, (o.result === 'win' ? '승 +' : '패 −') + comma(delta),
                o.reward ? el('span', { class: 'pvp-opp-reward' }, o.reward) : null)
            : el('button', { class: 'primary pvp-opp-btn', type: 'button', onclick: () => pvpGoBattle(o.name) }, '도전'));
}

function pvpOpponentsNode(d) {
    const list = (d.daily && d.daily.opponents) || [];
    return pvpSection('오늘의 상대', null,
        list.length
            ? el('div', { class: 'pvp-opp-grid' }, ...list.map(pvpOpponentTile))
            : el('div', { class: 'empty' }, '오늘 매칭 가능한 상대가 없습니다'));
}

// emptyCardSlotNode()는 장착 슬롯 피커에 리스너가 고정돼 있어, 리스너 없는 복제본에 PVP 피커를 연결한다.
function pvpEmptyTile(onPick) {
    const node = emptyCardSlotNode().cloneNode(true);
    node.addEventListener('click', onPick);
    return node;
}

function pvpDeckTile(card, kind, index) {
    if (!card) return pvpEmptyTile(() => openPvpCardPicker(kind, index));
    return el('div', { class: 'pvp-tile' },
        cardNode(card, true, () => openPvpCardPicker(kind, index)),
        kind === 'slot'
            ? el('button', { class: 'pvp-tile-x', type: 'button', title: '슬롯 비우기', 'aria-label': '슬롯 비우기', onclick: () => pvpClearSlot(index) }, '×')
            : null);
}

function pvpClearSlot(index) {
    pvpState.draft.slotCards[index] = null;
    renderPvp();
}

function pvpSetUseEquipped(useEquipped) {
    if (pvpState.draft.useEquipped === useEquipped) return;
    pvpState.draft.useEquipped = useEquipped;
    renderPvp();
}

function pvpDeckNode(d) {
    const draft = pvpState.draft;
    const seg = el('div', { class: 'seg pvp-seg' },
        el('button', { class: draft.useEquipped ? 'on' : '', type: 'button', onclick: () => pvpSetUseEquipped(true) }, '장착 덱 사용'),
        el('button', { class: draft.useEquipped ? '' : 'on', type: 'button', onclick: () => pvpSetUseEquipped(false) }, '직접 설정'));
    const body = draft.useEquipped ? null : el('div', { class: 'pvp-deck' },
        el('div', { class: 'pvp-deck-col' },
            el('span', { class: 'pvp-deck-label' }, '메인 카드'),
            el('div', { class: 'pvp-deck-main' }, pvpDeckTile(draft.mainCard, 'main', 0))),
        el('div', { class: 'pvp-deck-col' },
            el('span', { class: 'pvp-deck-label' }, '슬롯 카드'),
            el('div', { class: 'pvp-deck-slots' }, ...draft.slotCards.map((c, i) => pvpDeckTile(c, 'slot', i)))));
    const warn = (d.defense && d.defense.valid === false)
        ? el('div', { class: 'pvp-warn' }, '방어 덱 카드를 찾을 수 없어 장착 덱으로 대체됩니다') : null;
    return pvpSection('방어 덱', null, seg, warn, body);
}

function openPvpCardPicker(kind, index) {
    const draft = pvpState.draft;
    // 같은 캐릭터라도 카드 타입(일반/전직)이 다르면 함께 등록 가능
    const cardKey = c => Number(c.id) + ':' + (c.type || '일반');
    const used = new Set();
    if (kind === 'slot') {
        if (draft.mainCard) used.add(cardKey(draft.mainCard));
        draft.slotCards.forEach((c, i) => { if (c && i !== index) used.add(cardKey(c)); });
    } else {
        draft.slotCards.forEach(c => { if (c) used.add(cardKey(c)); });
    }
    const cards = (pvpState.data.cards || []).filter(c =>
        c && !used.has(cardKey(c)) && (kind === 'main' || Number(c.star || 0) >= 4));
    const pick = card => {
        if (kind === 'main') draft.mainCard = card;
        else draft.slotCards[index] = card;
        closeModal();
        renderPvp();
    };
    openRichModal(kind === 'main' ? '방어 메인 카드' : '방어 슬롯 카드', null, [
        cards.length
            ? el('div', { class: 'card-grid eqm-card-pick' }, ...cards.map(c => cardNode(c, true, pick)))
            : el('div', { class: 'empty' }, kind === 'main' ? '선택할 수 있는 카드가 없습니다.' : '슬롯에 넣을 수 있는 카드가 없습니다.\n(5성 이상, 다른 카드와 다른 캐릭터)')
    ]);
}

function pvpSelect(options, value, onPick) {
    const sel = el('select', { class: 'pvp-select', onchange: e => onPick(e.target.value) },
        ...options.map(([v, label]) => el('option', { value: v }, label)));
    sel.value = value;
    return sel;
}

function pvpRuleRow(rule, index, skills) {
    const draft = pvpState.draft;
    const needsValue = PVP_VALUE_CONDS.includes(rule.cond);
    if (needsValue && rule.value == null) rule.value = 30;
    const valueInput = el('input', {
        class: 'pvp-num', type: 'number', min: '1', max: '99', inputmode: 'numeric',
        value: String(rule.value),
        oninput: e => { rule.value = Math.max(1, Math.min(99, Math.round(Number(e.target.value) || 1))); },
        onblur: e => { e.target.value = String(rule.value); }
    });
    const skillSel = pvpSelect(
        [['', '자동']].concat(skills.map(s => [s.name, s.name])),
        rule.skill && skills.some(s => s.name === rule.skill) ? rule.skill : '',
        v => { rule.skill = v || null; });
    const move = (from, to) => {
        if (to < 0 || to >= draft.rules.length) return;
        draft.rules.splice(to, 0, draft.rules.splice(from, 1)[0]);
        renderPvp();
    };
    return el('div', { class: 'pvp-rule' },
        el('span', { class: 'pvp-rule-no' }, String(index + 1)),
        pvpSelect(PVP_COND_OPTIONS, rule.cond, v => { rule.cond = v; renderPvp(); }),
        needsValue ? valueInput : null,
        pvpSelect(PVP_ACTION_OPTIONS, rule.action, v => { rule.action = v; renderPvp(); }),
        rule.action === 'skill' ? skillSel : null,
        el('div', { class: 'pvp-rule-btns' },
            el('button', { class: 'pvp-mini', type: 'button', title: '위로', disabled: index === 0, onclick: () => move(index, index - 1) }, '▲'),
            el('button', { class: 'pvp-mini', type: 'button', title: '아래로', disabled: index === draft.rules.length - 1, onclick: () => move(index, index + 1) }, '▼'),
            el('button', { class: 'pvp-mini', type: 'button', onclick: () => { draft.rules.splice(index, 1); renderPvp(); } }, '삭제')));
}

function pvpRulesNode(d) {
    const draft = pvpState.draft;
    const skills = (d.defense && d.defense.skills) || [];
    return pvpSection('방어 AI 규칙', '위에서부터 먼저 맞는 규칙을 실행',
        draft.rules.length
            ? el('div', { class: 'pvp-rules' }, ...draft.rules.map((r, i) => pvpRuleRow(r, i, skills)))
            : el('div', { class: 'empty' }, '규칙이 없으면 항상 공격합니다.'),
        el('div', { class: 'pvp-rule-actions' },
            el('button', {
                type: 'button', disabled: draft.rules.length >= PVP_MAX_RULES,
                onclick: () => { draft.rules.push({ cond: 'always', value: null, action: 'attack', skill: null }); renderPvp(); }
            }, '규칙 추가'),
            el('button', {
                type: 'button',
                onclick: () => { draft.rules = PVP_DEFAULT_RULES.map(r => Object.assign({}, r)); renderPvp(); }
            }, '기본값')));
}

function pvpRankingNode(d) {
    const list = d.ranking || [];
    const meName = d.me && d.me.name;
    if (!list.length) return pvpSection('랭킹 TOP 3', null, el('div', { class: 'empty' }, '랭킹 정보가 없습니다.'));
    return pvpSection('랭킹 TOP 3', null, el('div', { class: 'rank-list pvp-rank' },
        ...list.map(e => el('div', { class: 'rank-row' + (e.name === meName ? ' me' : '') },
            el('div', { class: 'rk ' + (e.rank === 1 ? 'gold' : e.rank === 2 ? 'silver' : e.rank === 3 ? 'bronze' : '') }, comma(e.rank) + '위'),
            el('div', { class: 'ttl' }, e.cardImageUrl ? el('img', { class: 'pvp-rank-card', src: e.cardImageUrl, alt: e.cardName || '' }) : null),
            el('div', { class: 'nm' }, e.name, el('span', { class: 'lv' }, 'Lv. ' + comma(e.level))),
            el('div', { class: 'vl' }, comma(e.rating),
                el('span', { class: 'pvp-rank-wl' }, comma(e.wins) + '승 ' + comma(e.losses) + '패'))))));
}

function pvpHistoryNode(d) {
    const list = d.history || [];
    if (!list.length) return pvpSection('최근 전적', null, el('div', { class: 'empty' }, '전적이 없습니다.'));
    return pvpSection('최근 전적', null, el('div', { class: 'pvp-hist' },
        ...list.map(h => el('div', { class: 'pvp-hist-row' },
            el('span', { class: 'pvp-role ' + (h.role === 'defense' ? 'def' : 'atk') }, h.role === 'defense' ? '방어' : '공격'),
            el('b', { class: 'pvp-hist-name' }, h.opponent),
            el('span', { class: 'pvp-hist-result ' + (h.result === 'win' ? 'win' : 'lose') }, h.result === 'win' ? '승' : '패'),
            el('span', { class: 'pvp-hist-delta ' + (h.result === 'win' ? 'win' : 'lose') },
                (h.result === 'win' ? '+' : '−') + comma(Math.abs(Number(h.ratingDelta || 0)))),
            h.reward ? el('span', { class: 'pvp-hist-reward' }, h.reward) : null,
            el('span', { class: 'pvp-hist-time' }, mailRelTime(h.at))))));
}

async function buyPvpExtraPlay() {
    if (pvpState.busy) return;
    const daily = pvpState.data.daily || {};
    const confirmText = daily.extraFree
        ? '신성한 유생의 축복으로 상대를 무료로 1명 추가할까요?'
        : '가넷 ' + comma(daily.extraCost || 0) + '개를 사용해 상대를 1명 추가할까요?\n(보유 가넷 ' + comma(pvpState.data.me && pvpState.data.me.garnet) + ')';
    if (!(await showConfirm(confirmText))) return;
    pvpState.busy = true;
    showLoading();
    try {
        const r = await postApi('/api/pvp/extra');
        if (r.ok === false) showAlert(r.message || '추가 플레이를 구매하지 못했습니다.');
        else {
            pvpState.data.daily = r.daily;
            if (pvpState.data.me) pvpState.data.me.garnet = r.garnet;
            showAlert(r.message || '상대가 추가되었습니다.');
        }
    } catch (e) {
        showAlert(e.message);
    } finally {
        pvpState.busy = false;
        hideLoading();
        renderPvp();
    }
}

async function refreshPvpOpponents() {
    if (pvpState.busy) return;
    if (!(await showConfirm('오늘의 상대를 새로고침할까요?\n이미 전투한 상대는 그대로 유지됩니다.'))) return;
    pvpState.busy = true;
    showLoading();
    try {
        const r = await postApi('/api/pvp/refresh');
        if (r.ok === false) showAlert(r.message || '새로고침하지 못했습니다.');
        else pvpState.data.daily = r.daily;
    } catch (e) {
        showAlert(e.message);
    } finally {
        pvpState.busy = false;
        hideLoading();
        renderPvp();
    }
}

function pvpRulePayload(rule) {
    const payload = { cond: rule.cond, action: rule.action };
    if (PVP_VALUE_CONDS.includes(rule.cond)) payload.value = Number(rule.value == null ? 30 : rule.value);
    if (rule.action === 'skill' && rule.skill) payload.skill = rule.skill;
    return payload;
}

async function savePvpDefense() {
    if (pvpState.busy) return;
    const draft = pvpState.draft;
    if (!draft.useEquipped && !draft.mainCard) { showAlert('방어 메인 카드를 선택하세요.'); return; }
    pvpState.busy = true;
    showLoading();
    try {
        const r = await postApi('/api/pvp/defense', {
            useEquipped: draft.useEquipped,
            mainCard: draft.useEquipped || !draft.mainCard ? null : draft.mainCard.sig,
            slotCards: draft.useEquipped ? [] : draft.slotCards.filter(Boolean).map(c => c.sig),
            rules: draft.rules.map(pvpRulePayload)
        });
        if (r.ok === false) { showAlert(r.message || '저장하지 못했습니다.'); return; }
        pvpState.data.defense = r.defense;
        pvpState.draft = pvpDefenseDraft(r.defense);
        showAlert(r.message || '방어 설정을 저장했습니다.');
    } catch (e) {
        showAlert(e.message);
    } finally {
        pvpState.busy = false;
        hideLoading();
        renderPvp();
    }
}

// ===== 랭킹 =====
let rankingData = null;
let rankingTab = 'cp';

function rankTitleImg(title) {
    if (!title || !title.imageUrl) return null;
    return el('img', { src: title.imageUrl, class: 'rank-ttl', alt: title.name || '', title: title.name || '' });
}

function rankRow(entry, isMe, valueFormatter) {
    const rk = entry.rank;
    const rkClass = rk === 1 ? 'gold' : rk === 2 ? 'silver' : rk === 3 ? 'bronze' : '';
    const medal = rk === 1 ? '🥇' : rk === 2 ? '🥈' : rk === 3 ? '🥉' : rk + '위';
    return el('div', { class: 'rank-row ' + (isMe ? 'me' : ''), onclick: () => loadProfile(entry.name).catch(e => showAlert(e.message)) },
        el('div', { class: 'rk ' + rkClass }, medal),
        el('div', { class: 'ttl' }, rankTitleImg(entry.title)),
        el('div', { class: 'nm' }, entry.name, el('span', { class: 'lv' }, 'Lv. ' + comma(entry.level))),
        el('div', { class: 'vl' }, valueFormatter(entry.value))
    );
}

function renderRanking() {
    if (!rankingData) return;
    const list = rankingTab === 'cp' ? rankingData.cp : rankingTab === 'exp' ? rankingData.exp : rankingData.worldBoss;
    const me = rankingTab === 'cp' ? rankingData.me.cp : rankingTab === 'exp' ? rankingData.me.exp : rankingData.me.worldBoss;
    const valueFormatter = rankingTab === 'cp' ? v => '⚔️ ' + comma(v) : rankingTab === 'exp' ? v => 'XP ' + comma(v) : v => '피해 ' + comma(v);
    const meBox = $('#rankMe');
    meBox.innerHTML = '';
    if (me) {
        meBox.className = 'rank-me';
        meBox.appendChild(el('div', { class: 'rk' }, comma(me.rank) + '위'));
        meBox.appendChild(el('div', { class: 'ttl' }, rankTitleImg(me.title)));
        meBox.appendChild(el('div', { class: 'nm' }, me.name, el('span', { class: 'lv' }, 'Lv. ' + comma(me.level)), el('span', { class: 'total' }, ' / ' + comma(rankingTab === 'worldBoss' ? list.length : rankingData.total) + '명')));
        meBox.appendChild(el('div', { class: 'vl' }, valueFormatter(me.value)));
    } else {
        meBox.className = '';
    }
    const listEl = $('#rankList');
    listEl.innerHTML = '';
    if (!list.length) {
        listEl.appendChild(el('div', { class: 'empty' }, '랭킹 데이터가 없습니다.'));
        return;
    }
    list.forEach(entry => listEl.appendChild(rankRow(entry, me && entry.name === me.name, valueFormatter)));
}

async function loadRanking() {
    if (!rankingData) {
        $('#rankList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
        try { rankingData = await api('/api/ranking'); }
        catch (e) { $('#rankList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
    }
    renderRanking();
}

$$('.rank-tab').forEach(btn => btn.onclick = () => {
    rankingTab = btn.dataset.tab;
    $$('.rank-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderRanking();
});

// ===== 도감 =====
let dexData = null;
let potentialDexData = null;
let dexTab = 'weapon';
let dexRarity = 'all';

function dexThumb(iconUrl, frameUrl, fallback, sizeClass) {
    const wrap = el('div', { class: sizeClass || 'dex-thumb' });
    if (frameUrl) wrap.appendChild(el('img', { src: frameUrl, class: 'frame', alt: '' }));
    if (iconUrl) wrap.appendChild(el('img', { src: iconUrl, class: 'icon', alt: '' }));
    else wrap.appendChild(el('span', { class: 'icon-fallback' }, fallback || '⚙️'));
    return wrap;
}

const CURRENCY_ICON = { gold: '🪙', garnet: '💠' };

function dexCard(entry) {
    const color = RARITY_COLORS[entry.rarity] || '#334155';
    const card = el('div', { class: 'dex-card' });
    card.style.setProperty('--rar', color);
    applyRarityCardClass(card, entry.rarity);

    const head = el('div', { class: 'dex-head' });
    head.appendChild(dexThumb(entry.iconUrl, entry.frameUrl, SLOT_ICONS[entry.type] || '⚙️'));
    head.appendChild(el('div', null,
        el('div', { class: 'dex-name' }, entry.name),
        el('div', { class: 'dex-meta' },
            entry.rarity ? rarityTag(entry.rarity) : null,
            el('span', { class: 'tag' }, entry.typeLabel),
            entry.noTrade ? el('span', { class: 'tag' }, '거래 불가') : null
        )
    ));
    card.appendChild(head);

    if (entry.desc) card.appendChild(el('div', { class: 'dex-desc' }, entry.desc));

    if (entry.baseStatLines && entry.baseStatLines.length) {
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '기본 능력치'));
        entry.baseStatLines.forEach(line => block.appendChild(el('div', null, line)));
        card.appendChild(block);
    }

    if (entry.specialLines && entry.specialLines.length) {
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '특수 효과'));
        entry.specialLines.forEach(line => block.appendChild(el('div', null, line)));
        card.appendChild(block);
    }

    if (entry.passive) {
        const block = el('div', { class: 'dex-passive' });
        block.appendChild(el('div', { class: 'dex-passive-label' }, '패시브 · ' + entry.passive.name));
        block.appendChild(el('div', { class: 'dex-passive-desc' }, entry.passive.desc));
        if (entry.passive.cooltime) {
            const ctSec = Math.round(entry.passive.cooltime / 1000);
            const ctText = ctSec % 60 === 0 ? (ctSec / 60) + '분' : ctSec + '초';
            block.appendChild(el('div', { class: 'dex-passive-cd' }, '재사용 대기시간: ' + ctText));
        }
        card.appendChild(block);
    }

    if (entry.set) {
        const block = el('div', { class: 'dex-stat-block' });
        block.appendChild(el('div', { class: 'dex-stat-title' }, '세트 효과 · ' + entry.set.name));
        if (entry.set.tiers && entry.set.tiers.length) {
            entry.set.tiers.forEach(t => block.appendChild(el('div', null, t.tier + '세트: ' + (t.lines && t.lines.length ? t.lines.join(', ') : '효과 없음'))));
        } else {
            block.appendChild(el('div', { style: { color: '#64748b' } }, 'PetSet.json에 효과가 정의되지 않음'));
        }
        card.appendChild(block);
    }

    if (entry.upgrades && entry.upgrades.length) {
        const det = el('details', { class: 'dex-collapse' });
        det.appendChild(el('summary', null, '강화 단계 (+1 ~ +' + entry.maxUpgradeLevel + ')'));
        const list = el('div', { class: 'dex-upgrade-list' });
        entry.upgrades.forEach(up => {
            list.appendChild(el('div', { class: 'dex-upgrade-row' },
                el('div', { class: 'lvl' }, '+' + up.level),
                el('div', { class: 'lines' }, ...(up.statLines.length ? up.statLines.map(l => el('div', null, l)) : [el('div', { style: { color: '#64748b' } }, '변화 없음')]))
            ));
        });
        det.appendChild(list);
        card.appendChild(det);
    }

    if (entry.evolution) {
        const evol = el('div', { class: 'dex-evol' });
        evol.appendChild(el('div', { class: 'dex-evol-title' }, '합성 진화'));
        const target = el('div', { class: 'dex-evol-target' });
        target.appendChild(dexThumb(entry.evolution.targetIconUrl, entry.evolution.targetFrameUrl, SLOT_ICONS[entry.evolution.targetType] || '⚙️', 'dex-evol-thumb'));
        target.appendChild(el('div', null,
            el('div', { style: { fontWeight: 800, color: '#f8fafc' } }, entry.evolution.targetName),
            el('div', { style: { fontSize: '11px', color: '#94a3b8' } }, entry.evolution.targetRarity || '')
        ));
        target.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-2)' } }, '+' + entry.evolution.requireLevel + ' x' + entry.evolution.requireCount));
        evol.appendChild(target);
        card.appendChild(evol);
    }

    if (entry.recipe) {
        const recipe = el('div', { class: 'dex-recipe' });
        recipe.appendChild(el('div', { class: 'dex-recipe-title' }, '제작 레시피 · ' + entry.recipe.name));
        entry.recipe.materials.forEach(mat => {
            const row = el('div', { class: 'dex-recipe-mat' });
            const fallback = CURRENCY_ICON[mat.type] || '📦';
            row.appendChild(dexThumb(mat.iconUrl, mat.frameUrl, fallback, 'dex-mat-thumb'));
            row.appendChild(el('div', null,
                el('div', { style: { fontWeight: 700, color: '#f8fafc' } }, mat.name),
                el('div', { style: { fontSize: '11px', color: '#94a3b8' } }, mat.typeLabel)
            ));
            row.appendChild(el('div', { class: 'dex-mat-count' }, 'x' + comma(mat.count)));
            recipe.appendChild(row);
        });
        card.appendChild(recipe);
    }

    return card;
}

const DEX_EQUIPMENT_TABS = new Set(['weapon', 'hat', 'armor', 'pants', 'shoes', 'accessory', 'support']);

function dexRichText(text) {
    const valuePattern = /((?:Lv\.\s*)?[+-]?\d+(?:\.\d+)?(?:%|초|분|회|개|성|단계)?|HP|MP)/g;
    return el('span', { class: 'dex-detail-rich' }, ...String(text || '').split(valuePattern).filter(Boolean).map(part =>
        /^(?:Lv\.\s*)?[+-]?\d|^(?:HP|MP)$/.test(part)
            ? el('strong', null, part)
            : document.createTextNode(part)
    ));
}

function dexDescriptionData(text, cooltime) {
    let value = String(text || '').replace(/\s+/g, ' ').trim();
    const cooldowns = [];
    const addCooldown = cooldown => {
        if (cooldown && !cooldowns.includes(cooldown)) cooldowns.push(cooldown);
    };
    const cooldownMs = Number(cooltime || 0);
    if (cooldownMs > 0) addCooldown(cooldownMs % 60000 === 0 ? cooldownMs / 60000 + '분' : Math.round(cooldownMs / 1000) + '초');
    // 괄호 안에 다른 설명과 함께 있는 쿨타임("(쿨타임 5분, 초월 단계에 따라 증가)")은 쿨타임만 떼고 괄호를 남긴다
    value = value.replace(/\(\s*(?:쿨타임|재사용 대기시간)\s*(\d+(?:\.\d+)?)\s*(초|분)(?!\s*(?:을|를)?\s*(?:감소|증가|연장|단축))\s*,\s*/g, (full, amount, unit) => {
        addCooldown(amount + unit);
        return '(';
    });
    value = value.replace(/,\s*(?:쿨타임|재사용 대기시간)\s*(\d+(?:\.\d+)?)\s*(초|분)(?!\s*(?:을|를)?\s*(?:감소|증가|연장|단축))\s*\)/g, (full, amount, unit) => {
        addCooldown(amount + unit);
        return ')';
    });
    value = value.replace(/\(?\s*(?:쿨타임|재사용 대기시간)\s*(\d+(?:\.\d+)?)\s*(초|분)(?!\s*(?:을|를)?\s*(?:감소|증가|연장|단축))\s*\)?/g, (full, amount, unit) => {
        addCooldown(amount + unit);
        return '';
    });
    value = value.replace(/\(\s*,\s*/g, '(').replace(/,\s*\)/g, ')').replace(/\(\s*\)/g, '').replace(/\s+([,.!?])/g, '$1').replace(/([,.!?]){2,}/g, '$1');
    // 문장 단위로 먼저 나누고, 조건절("~시", "~동안", "~경우" 등)로 시작하는 문장은 쉼표로 쪼개지 않는다
    // (예: "불사조 사용 시 8초간 치명타 확률 +10%, 불사조 피해량 +30%"를 조건 없는 조각으로 흩뜨리지 않기 위함)
    const conditionalLead = /(?:\s시|사용 시|적중 시|발동 시|동안|경우|이하|이상|마다|때|면|후|뒤)\s*[^,]*?[,]/;
    const fragments = value
        .replace(/([.!?])\s+/g, '$1\n')
        .split('\n')
        .flatMap(sentence => (conditionalLead.test(sentence) ? [sentence] : sentence.replace(/,\s+/g, ',\n').split('\n')))
        .map(line => line.trim().replace(/^[,.!?]\s*/, '').replace(/\s*[,.!?]$/, ''))
        .filter(Boolean);
    const lines = fragments.reduce((result, line) => {
        const previous = result[result.length - 1];
        const continuation = /(?:후|뒤|동안|경우|때|고|며|면서|거나|하여|해서|하되)$/.test(previous || '')
            || /^(?:최대|최소)\s*\d+(?:\.\d+)?(?:%|초|분|회|개|중첩|단계)?(?:까지)?\s*(?:감소|증가|적용|회복|제한)$/.test(line);
        if (previous && continuation) {
            result[result.length - 1] = previous + ', ' + line;
        } else {
            result.push(line);
        }
        return result;
    }, []);
    return { lines, cooldowns };
}

function dexEffectLabel(line) {
    if (/회복|보호막|회복량/.test(line)) return '회복·보호';
    if (/쿨타임|재사용 대기시간/.test(line)) return '쿨타임';
    if (/저항|방어력|받는 피해|회피|감소/.test(line)) return '방어';
    if (/공격|피해|치명타|관통|연격|속성 강화|화상/.test(line)) return '공격';
    if (/조건|이하|이상|장착|사용 시|적중 시|발동 시/.test(line)) return '조건';
    return '효과';
}

function dexEffectList(text, cooltime) {
    const data = dexDescriptionData(text, cooltime);
    const rows = data.lines.map(line => el('div', { class: 'dex-detail-effect-row' },
        el('span', { class: 'dex-detail-effect-kind' }, dexEffectLabel(line)),
        dexRichText(line)
    ));
    data.cooldowns.forEach(cooldown => rows.push(el('div', { class: 'dex-detail-effect-row cooldown' },
        el('span', { class: 'dex-detail-effect-kind' }, '쿨타임'),
        el('span', { class: 'dex-detail-rich' }, el('strong', null, cooldown))
    )));
    return el('div', { class: 'dex-detail-effects' }, ...rows);
}

function dexStatList(lines) {
    return el('div', { class: 'dex-detail-stats' }, ...(lines || []).map(line => {
        const match = String(line).match(/^(.*?)([+-]?\d.*)$/);
        return el('div', { class: 'dex-detail-stat-row' },
            el('span', null, match ? match[1].trim() : line),
            match ? el('strong', null, match[2].trim()) : null
        );
    }));
}

function dexTranscendStageText(text, stage) {
    return String(text || '').replace(/([+-]?\d+(?:\.\d+)?)(%?)\s*\((?:초월\s*)?(?:단계당\s*)?([+-]\d+(?:\.\d+)?)(%?)\)/g,
        (full, baseText, baseUnit, deltaText, deltaUnit) => {
            const base = Number(baseText);
            const delta = Number(deltaText);
            const value = base + delta * (stage - 1);
            const decimals = Math.max((baseText.split('.')[1] || '').length, (deltaText.split('.')[1] || '').length);
            const numberText = (baseText.startsWith('+') && value >= 0 ? '+' : '') + (decimals ? value.toFixed(decimals).replace(/\.0+$/, '') : String(Math.round(value)));
            return numberText + (baseUnit || deltaUnit);
        });
}

function dexTranscendStagesNode(entry, text) {
    if (entry.rarity !== '초월' || !/\((?:초월\s*)?(?:단계당\s*)?[+-]\d/.test(text || '')) return null;
    const body = el('div', { class: 'dex-stage-body' });
    const buttons = [1, 2, 3].map(stage => {
        const button = el('button', { class: 'dex-stage-button' + (stage === 1 ? ' active' : ''), type: 'button' }, stage + '단계');
        button.onclick = () => {
            buttons.forEach(item => item.classList.toggle('active', item === button));
            body.replaceChildren(dexEffectList(dexTranscendStageText(text, stage)));
        };
        return button;
    });
    body.replaceChildren(dexEffectList(dexTranscendStageText(text, 1)));
    return el('section', { class: 'dex-detail-section dex-stage-section' },
        el('div', { class: 'dex-detail-section-head' },
            el('div', null, el('strong', null, '초월 단계별 효과'), el('span', null, '선택한 단계에서 실제 적용되는 효과')),
            el('span', { class: 'dex-detail-section-mark' }, '3 STAGE')),
        el('div', { class: 'dex-stage-buttons' }, ...buttons),
        body
    );
}

function dexEquipmentCard(entry) {
    const card = el('button', { class: 'dex-gear-card', type: 'button', onclick: () => openDexEquipmentModal(entry), 'aria-label': entry.name + ' 상세 정보' },
        dexThumb(entry.iconUrl, entry.frameUrl, SLOT_ICONS[entry.type] || '⚙️', 'dex-gear-thumb'),
        el('div', { class: 'dex-gear-copy' },
            el('div', { class: 'dex-gear-name' }, entry.name),
            el('div', { class: 'dex-gear-meta' },
                el('span', { class: 'dex-gear-rarity' }, entry.rarity || '등급 없음'),
                el('span', { class: 'dex-gear-type' }, entry.typeLabel)
            ),
            el('div', { class: 'dex-gear-stats' }, ...(entry.baseStatLines || []).map(line => el('div', null, line)))
        )
    );
    card.style.setProperty('--rar', RARITY_COLORS[entry.rarity] || '#64748b');
    return card;
}

function dexEquipmentInfoNode(entry) {
    const nodes = [
        el('section', { class: 'dex-detail-section' },
            el('div', { class: 'dex-detail-section-head' }, el('div', null, el('strong', null, '기본 능력치'), el('span', null, '강화하지 않은 상태의 능력치'))),
            dexStatList(entry.baseStatLines || []))
    ];
    if (entry.conditionLines && entry.conditionLines.length) {
        nodes.push(el('section', { class: 'dex-detail-section' },
            el('div', { class: 'dex-detail-section-head' }, el('div', null, el('strong', null, '적용 조건'), el('span', null, '장착 및 추가 효과 조건'))),
            el('div', { class: 'dex-detail-condition-list' }, ...entry.conditionLines.map(line => el('div', null, dexRichText(line))))));
    }
    if (entry.desc && !entry.passive) {
        nodes.push(el('section', { class: 'dex-detail-section' },
            el('div', { class: 'dex-detail-section-head' }, el('div', null, el('strong', null, '장비 효과'), el('span', null, '장착 시 적용되는 고유 효과'))),
            dexEffectList(entry.desc)));
        const stages = dexTranscendStagesNode(entry, entry.desc);
        if (stages) nodes.push(stages);
    }
    return el('div', { class: 'dex-detail-stack' }, ...nodes);
}

function dexEnhancementNode(entry) {
    const levels = [{ level: 0, statLines: entry.baseStatLines || [] }].concat(entry.upgrades || []);
    const body = el('div', { class: 'dex-enhance-body' });
    const buttons = levels.map(item => {
        const button = el('button', { class: 'dex-enhance-level' + (item.level === 0 ? ' active' : ''), type: 'button' }, item.level === 0 ? '기본' : '+' + item.level);
        button.onclick = () => {
            buttons.forEach(levelButton => levelButton.classList.toggle('active', levelButton === button));
            body.replaceChildren(
                el('div', { class: 'dex-enhance-selected' }, item.level === 0 ? '기본 능력치' : '+' + item.level + ' 최종 능력치'),
                dexStatList(item.statLines || [])
            );
        };
        return button;
    });
    buttons[0].click();
    return el('div', { class: 'dex-detail-stack' },
        el('section', { class: 'dex-detail-section' },
            el('div', { class: 'dex-detail-section-head' }, el('div', null, el('strong', null, '강화 단계'), el('span', null, '단계를 선택하면 누적된 최종 능력치를 표시합니다'))),
            el('div', { class: 'dex-enhance-levels' }, ...buttons),
            body)
    );
}

function dexPassiveNode(entry) {
    const advanced = entry.rarity === '초월' || entry.rarity === '신화';
    const passiveText = advanced && entry.desc ? entry.desc : (entry.passive && entry.passive.desc || entry.desc || '');
    const nodes = [el('section', { class: 'dex-detail-section dex-passive-section' },
        el('div', { class: 'dex-detail-section-head' },
            el('div', null, el('strong', null, entry.passive && entry.passive.name || '패시브'), el('span', null, '장착 중 조건을 만족하면 자동으로 발동합니다')),
            el('span', { class: 'dex-detail-section-mark' }, 'PASSIVE')),
        dexEffectList(passiveText, entry.passive && entry.passive.cooltime))];
    const stages = dexTranscendStagesNode(entry, passiveText);
    if (stages) nodes.push(stages);
    return el('div', { class: 'dex-detail-stack' }, ...nodes);
}

function dexEvolutionNode(entry) {
    const target = entry.evolution;
    return el('div', { class: 'dex-detail-stack' },
        el('section', { class: 'dex-detail-section' },
            el('div', { class: 'dex-detail-section-head' }, el('div', null, el('strong', null, '합성 진화'), el('span', null, '동일 장비를 성장시켜 상위 장비로 진화합니다'))),
            el('div', { class: 'dex-evolution-flow' },
                el('div', { class: 'dex-evolution-item source' },
                    dexThumb(entry.iconUrl, entry.frameUrl, SLOT_ICONS[entry.type] || '⚙️', 'dex-evolution-thumb'),
                    el('div', null, el('strong', null, entry.name), el('span', null, entry.rarity))),
                el('div', { class: 'dex-evolution-arrow', 'aria-hidden': 'true' }, '→'),
                el('div', { class: 'dex-evolution-item target' },
                    dexThumb(target.targetIconUrl, target.targetFrameUrl, SLOT_ICONS[target.targetType] || '⚙️', 'dex-evolution-thumb'),
                    el('div', null, el('strong', null, target.targetName), el('span', null, target.targetRarity || '')))
            ),
            el('div', { class: 'dex-evolution-requirements' },
                el('div', null, el('span', null, '필요 강화'), el('strong', null, '+' + target.requireLevel)),
                el('div', null, el('span', null, '필요 수량'), el('strong', null, target.requireCount + '개'))
            ))
    );
}

function dexSetNode(entry) {
    const set = entry.set;
    const components = (set.components || []).map(component => {
        const current = component.type === entry.type && Number(component.id) === Number(entry.id);
        const target = dexData && (dexData[component.type] || []).find(item => Number(item.id) === Number(component.id));
        return el('button', {
            class: 'dex-set-component' + (current ? ' current' : ''),
            type: 'button',
            disabled: !target,
            onclick: target ? () => openDexEquipmentModal(target) : null,
            'aria-label': component.name + ' 상세 정보 열기'
        },
            dexThumb(component.iconUrl, component.frameUrl, SLOT_ICONS[component.type] || '⚙️', 'dex-set-component-thumb'),
            el('div', null, el('strong', null, component.name), el('span', null, component.typeLabel))
        );
    });
    const tiers = (set.tiers || []).map(tier => el('div', { class: 'dex-set-tier-detail' },
        el('div', { class: 'dex-set-tier-number' }, tier.tier + ' SET'),
        el('div', { class: 'dex-set-tier-body' }, ...(tier.lines || []).map(line => dexEffectList(line)))
    ));
    return el('div', { class: 'dex-detail-stack' },
        el('section', { class: 'dex-detail-section dex-set-section' },
            el('div', { class: 'dex-set-title' }, el('span', null, 'SET'), el('strong', null, set.name)),
            components.length ? el('div', { class: 'dex-set-components' }, ...components) : null),
        el('section', { class: 'dex-detail-section' },
            el('div', { class: 'dex-detail-section-head' }, el('div', null, el('strong', null, '세트 효과'), el('span', null, '장착한 세트 부위 수에 따라 활성화됩니다'))),
            el('div', { class: 'dex-set-tier-list' }, ...tiers))
    );
}

function dexDetailTabs(tabs) {
    const tabList = el('div', { class: 'dex-detail-tabs', role: 'tablist' });
    const panels = el('div', { class: 'dex-detail-panels' });
    tabs.forEach((tab, index) => {
        const button = el('button', { class: 'dex-detail-tab' + (index === 0 ? ' active' : ''), type: 'button', role: 'tab', 'aria-selected': String(index === 0) }, tab.label);
        const panel = el('div', { class: 'dex-detail-panel' + (index === 0 ? ' active' : ''), role: 'tabpanel' }, tab.node);
        button.onclick = () => {
            tabList.querySelectorAll('.dex-detail-tab').forEach(item => {
                const active = item === button;
                item.classList.toggle('active', active);
                item.setAttribute('aria-selected', String(active));
            });
            panels.querySelectorAll('.dex-detail-panel').forEach(item => item.classList.toggle('active', item === panel));
        };
        tabList.appendChild(button);
        panels.appendChild(panel);
    });
    return el('div', { class: 'dex-detail-tabbed' }, tabList, panels);
}

function openDexEquipmentModal(entry) {
    const hero = el('div', { class: 'dex-detail-hero' },
        dexThumb(entry.iconUrl, entry.frameUrl, SLOT_ICONS[entry.type] || '⚙️', 'dex-detail-thumb'),
        el('div', { class: 'dex-detail-hero-copy' },
            el('div', { class: 'dex-detail-name' }, entry.name),
            el('div', { class: 'dex-detail-meta' },
                el('span', null, entry.rarity || '등급 없음'),
                el('span', null, entry.typeLabel),
                entry.set ? el('span', null, entry.set.name + ' 세트') : null
            ))
    );
    hero.style.setProperty('--rar', RARITY_COLORS[entry.rarity] || '#64748b');
    const tabs = [{ label: '상세 정보', node: dexEquipmentInfoNode(entry) }];
    if (entry.upgrades && entry.upgrades.length) tabs.push({ label: '강화 단계', node: dexEnhancementNode(entry) });
    if (entry.passive) tabs.push({ label: '패시브', node: dexPassiveNode(entry) });
    if (entry.evolution) tabs.push({ label: '합성 진화', node: dexEvolutionNode(entry) });
    if (entry.set) tabs.push({ label: '세트 효과', node: dexSetNode(entry) });
    modalRequestToken++;
    setModalVariant('dex-equipment');
    $('#modalTitle').textContent = '';
    $('#modalSub').textContent = '';
    $('#modalBody').replaceChildren(hero, dexDetailTabs(tabs));
    $('#modalBg').classList.add('active');
}

function dexOrbCard(entry) {
    const card = el('article', { class: 'dex-orb-card' });
    const head = el('div', { class: 'dex-orb-head' },
        dexThumb(entry.iconUrl, entry.frameUrl, '🔮', 'dex-orb-thumb'),
        el('div', { class: 'dex-orb-identity' },
            el('div', { class: 'dex-orb-name' }, entry.name),
            el('div', { class: 'dex-orb-parts' },
                el('span', { class: 'dex-orb-parts-label' }, '부여 가능'),
                ...(entry.partLabels || []).map(part => el('span', { class: 'dex-orb-part' }, part))
            )
        )
    );
    const effect = el('div', { class: 'dex-orb-effect' },
        el('div', { class: 'dex-orb-effect-title' }, '부여 시 효과'),
        el('div', { class: 'dex-orb-effect-lines' },
            ...(entry.baseStatLines || []).map(line => el('div', null, line))
        )
    );
    card.append(head, effect);
    return card;
}

function renderOrbDex(grid, entries) {
    hideDexRarityFilter();
    grid.className = 'dex-orb-sections';
    grid.innerHTML = '';
    const grouped = new Map();
    entries.forEach(entry => {
        const category = entry.category || '기타';
        if (!grouped.has(category)) grouped.set(category, []);
        grouped.get(category).push(entry);
    });
    grouped.forEach((orbs, category) => {
        const parts = orbs[0] && orbs[0].categoryParts || [];
        const section = el('section', { class: 'dex-orb-section' },
            el('header', { class: 'dex-orb-section-head' },
                el('div', { class: 'dex-orb-section-title' }, category),
                el('div', { class: 'dex-orb-section-parts' },
                    el('span', null, '장착 부위'),
                    el('strong', null, parts.join(' · '))
                )
            ),
            el('div', { class: 'dex-orb-grid' }, ...orbs.map(dexOrbCard))
        );
        grid.appendChild(section);
    });
}

function dexSpecterCard(entry) {
    const card = el('article', { class: 'dex-orb-card' });
    const skill = entry.skill;
    const head = el('div', { class: 'dex-orb-head' },
        dexThumb(entry.iconUrl, entry.frameUrl, '★', 'dex-orb-thumb'),
        el('div', { class: 'dex-orb-identity' },
            el('div', { class: 'dex-orb-name' }, entry.name),
            el('div', { class: 'dex-orb-parts' },
                el('span', { class: 'dex-orb-parts-label' }, '부여 대상'),
                el('span', { class: 'dex-orb-part' }, '일반 카드')
            )
        )
    );
    const effect = el('div', { class: 'dex-orb-effect' },
        el('div', { class: 'dex-orb-effect-title' }, '부여 스킬'),
        el('div', { class: 'dex-orb-effect-lines' },
            skill ? el('div', null, skill.name + ' (MP ' + comma(skill.mpCost) + ' · 쿨타임 ' + skill.cooltimeText + ')') : el('div', null, '스킬 정보 없음'),
            ...((skill && skill.descLines) || []).map(line => el('div', null, line))
        )
    );
    card.append(head, effect);
    return card;
}

function renderSpecterDex(grid, entries) {
    hideDexRarityFilter();
    grid.className = 'dex-orb-sections';
    grid.innerHTML = '';
    const section = el('section', { class: 'dex-orb-section' },
        el('header', { class: 'dex-orb-section-head' },
            el('div', { class: 'dex-orb-section-title' }, '스펙터'),
            el('div', { class: 'dex-orb-section-parts' },
                el('span', null, '부여 대상'),
                el('strong', null, '일반 캐릭터 카드')
            )
        ),
        el('div', { class: 'dex-orb-grid' }, ...entries.map(dexSpecterCard))
    );
    grid.appendChild(section);
}

function dexCharacterCard(entry) {
    const card = el('div', { class: 'dex-card' });
    card.style.setProperty('--rar', 'var(--border-strong)');

    let view = '일반';

    // 일반/전직 토글 (전직이 있는 캐릭터만)
    let toggleBar = null;
    if (entry.hasJobClass) {
        toggleBar = el('div', { class: 'dex-char-toggle' });
        ['일반', '전직'].forEach(v => {
            const btn = el('button', { class: 'dex-char-toggle-btn' + (v === '일반' ? ' active' : ''), type: 'button' }, v);
            btn.onclick = () => {
                if (view === v) return;
                view = v;
                toggleBar.querySelectorAll('.dex-char-toggle-btn').forEach(b => b.classList.toggle('active', b.textContent === v));
                renderBody();
            };
            toggleBar.appendChild(btn);
        });
        card.appendChild(toggleBar);
    }

    const body = el('div', { style: { display: 'contents' } });
    card.appendChild(body);

    function renderSkills(skills) {
        if (!skills || !skills.length) return null;
        const det = el('details', { class: 'dex-collapse', open: true });
        det.appendChild(el('summary', null, '스킬'));
        const list = el('div', { class: 'dex-upgrade-list' });
        skills.forEach(skill => {
            list.appendChild(el('div', { class: 'dex-upgrade-row' },
                el('div', { class: 'lvl' }, skill.name),
                el('div', { class: 'lines' },
                    el('div', { style: { fontWeight: 800, color: '#f8fafc' } }, 'MP ' + comma(skill.mpCost) + ' · ' + skill.cooltimeText),
                    ...(skill.descLines || []).map(line => el('div', null, line))
                )
            ));
        });
        det.appendChild(list);
        return det;
    }

    function renderBody() {
        body.innerHTML = '';
        const isJob = view === '전직';
        const coverUrl = isJob ? entry.jobCoverUrl : entry.coverUrl;

        if (coverUrl) {
            body.appendChild(el('div', { style: { margin: '-14px -14px 0', aspectRatio: '16 / 9', borderRadius: '14px 14px 8px 8px', overflow: 'hidden', background: '#020617' } },
                el('img', { src: coverUrl, alt: entry.name, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
            ));
        }

        const head = el('div', { style: { display: 'grid', gap: '4px' } });
        head.appendChild(el('div', null,
            el('div', { class: 'dex-name' }, entry.name),
            el('div', { class: 'dex-meta' },
                el('span', { class: 'tag rarity' }, isJob ? '전직 카드' : (entry.typeLabel || '캐릭터 카드'))
            )
        ));
        body.appendChild(head);

        if (isJob && entry.jobClass) {
            const effs = entry.jobClass.slotEffects || [];
            if (effs.length) {
                const block = el('div', { class: 'dex-stat-block' });
                block.appendChild(el('div', { class: 'dex-stat-title' }, '카드 슬롯 효과 (전직)'));
                effs.forEach(eff => {
                    if (eff.valuesText) {
                        block.appendChild(el('div', null, eff.name + ' ' + eff.valuesText));
                        return;
                    }
                    block.appendChild(el('div', null, eff.name + ' ' + eff.baseText + ' (' + eff.requireStarText + ' 기준)'));
                    if (eff.perLevelText && Number(String(eff.perLevelText).replace(/[^0-9.-]/g, '')) !== 0)
                        block.appendChild(el('div', null, '이후 등급마다 +' + eff.perLevelText));
                });
                body.appendChild(block);
            }
            const skillsDet = renderSkills(entry.jobClass.skills);
            if (skillsDet) body.appendChild(skillsDet);
        } else {
            if (entry.slotEffect) {
                const eff = entry.slotEffect;
                const block = el('div', { class: 'dex-stat-block' });
                block.appendChild(el('div', { class: 'dex-stat-title' }, '카드 슬롯 효과'));
                if (eff.valuesText) {
                    block.appendChild(el('div', null, eff.name + ' ' + eff.valuesText));
                } else {
                    block.appendChild(el('div', null, eff.name + ' ' + eff.baseText + ' (' + eff.requireStarText + ' 기준)'));
                    if (eff.perLevelText && Number(String(eff.perLevelText).replace(/[^0-9.-]/g, '')) !== 0)
                        block.appendChild(el('div', null, '이후 등급마다 ' + (String(eff.perLevelText).trim().startsWith('-') ? '' : '+') + eff.perLevelText));
                }
                body.appendChild(block);
            }
            const skillsDet = renderSkills(entry.skills);
            if (skillsDet) body.appendChild(skillsDet);
        }
    }

    renderBody();
    return card;
}

let titlesData = null;

function dexTitleCard(entry) {
    const card = el('div', { class: 'dex-title-card' + (entry.unlocked ? '' : ' locked') + (entry.equipped ? ' equipped' : '') });
    const thumb = el('div', { class: 'dex-title-thumb' });
    thumb.appendChild(el('img', { src: entry.imageUrl, alt: entry.name, onerror: function () { this.style.display = 'none'; } }));
    card.appendChild(thumb);
    card.appendChild(el('div', { class: 'dex-title-name' }, entry.name));
    if (entry.statLines && entry.statLines.length) {
        const block = el('div', { class: 'dex-title-stats' });
        entry.statLines.forEach(line => block.appendChild(el('div', null, line)));
        card.appendChild(block);
    }
    card.appendChild(el('div', { class: 'dex-title-cond' }, '획득: ' + entry.description));
    if (!entry.unlocked) {
        const p = entry.progress || { current: 0, target: 0 };
        const pct = p.target > 0 ? Math.min(100, Math.round(p.current / p.target * 100)) : 0;
        const prog = el('div', { class: 'dex-title-prog' });
        const bar = el('div', { class: 'dex-title-prog-bar' }, el('div', { class: 'fill' }));
        bar.firstChild.style.width = pct + '%';
        prog.appendChild(bar);
        prog.appendChild(el('div', { class: 'dex-title-prog-text' }, '🔒 ' + comma(p.current) + ' / ' + comma(p.target) + ' (' + pct + '%)'));
        card.appendChild(prog);
    } else {
        const btn = el('button', { class: 'dex-title-btn' + (entry.equipped ? ' on' : ''), type: 'button' }, entry.equipped ? '✓ 장착 중 (해제)' : '장착');
        btn.onclick = async () => {
            btn.disabled = true;
            try {
                await postApi('/api/titles/equip', { id: entry.equipped ? null : entry.id });
                titlesData = await api('/api/titles');
                renderDex();
            } catch (e) { showAlert(e.message); btn.disabled = false; }
        };
        card.appendChild(btn);
    }
    return card;
}

function dexPotentialCard(typeData) {
    const card = el('div', { class: 'dex-pot-card' });
    card.appendChild(el('div', { class: 'dex-pot-cardhead' }, typeData.label + ' 잠재능력'));
    const tbody = el('tbody');
    (typeData.grades || []).forEach(g => {
        const groups = g.groups || [];
        if (!groups.length) return;
        groups.forEach((group, gi) => {
            const tr = el('tr', { class: gi === 0 ? 'grade-start' : '' });
            if (gi === 0) tr.appendChild(el('td', { class: 'c-grade', rowSpan: groups.length },
                el('span', { class: 'pot-grade ' + g.grade }, g.gradeLabel)));
            tr.appendChild(el('td', { class: 'c-rate' }, el('span', { class: 'dex-rate-pill' }, group.percent + '%')));
            const optCell = el('td', { class: 'c-opt' });
            const opts = group.options || [];
            if (!opts.length) optCell.appendChild(el('span', { class: 'dex-opt-none' }, '없음'));
            else opts.forEach(o => optCell.appendChild(el('span', { class: 'dex-opt-chip' }, o)));
            tr.appendChild(optCell);
            tbody.appendChild(tr);
        });
    });
    const table = el('table', { class: 'dex-pot-table' },
        el('thead', null, el('tr', null,
            el('th', { class: 'c-grade' }, '등급'),
            el('th', { class: 'c-rate' }, '확률'),
            el('th', { class: 'c-opt' }, '옵션'))),
        tbody);
    card.appendChild(el('div', { class: 'dex-pot-tablewrap' }, table));
    return card;
}

function hideDexRarityFilter() {
    const bar = $('#dexRarityFilterBar');
    if (bar) bar.hidden = true;
}

function applyDexRarityFilter(entries) {
    const list = Array.isArray(entries) ? entries : [];
    const bar = $('#dexRarityFilterBar');
    const select = $('#dexRarityFilter');
    const count = $('#dexRarityCount');
    const present = new Set(list.map(entry => entry && entry.rarity).filter(Boolean));
    if (!bar || !select || !present.size) {
        hideDexRarityFilter();
        return list;
    }

    const rarityOrder = Array.isArray(dexData && dexData.rarityOrder) ? dexData.rarityOrder : [];
    const rarities = rarityOrder.filter(rarity => present.has(rarity));
    Array.from(present).filter(rarity => !rarities.includes(rarity)).sort((a, b) => a.localeCompare(b, 'ko-KR')).forEach(rarity => rarities.push(rarity));
    if (dexRarity !== 'all' && !present.has(dexRarity)) dexRarity = 'all';

    select.replaceChildren(
        el('option', { value: 'all' }, '전체 등급'),
        ...rarities.map(rarity => el('option', { value: rarity }, rarity))
    );
    select.value = dexRarity;
    bar.hidden = false;

    const filtered = dexRarity === 'all' ? list : list.filter(entry => entry.rarity === dexRarity);
    if (count) count.textContent = dexRarity === 'all' ? comma(list.length) + '개' : comma(filtered.length) + ' / ' + comma(list.length) + '개';
    return filtered;
}

function renderDex() {
    const grid = $('#dexList');
    if (dexTab === 'potential') {
        hideDexRarityFilter();
        grid.className = 'dex-grid dex-pot-grid';
        if (!potentialDexData) return;
        grid.innerHTML = '';
        (potentialDexData.types || []).forEach(t => grid.appendChild(dexPotentialCard(t)));
        return;
    }
    if (dexTab === 'title') {
        hideDexRarityFilter();
        if (!titlesData) return;
        grid.className = 'dex-grid dex-title-grid';
        grid.innerHTML = '';
        const list = titlesData.titles || [];
        if (!list.length) { grid.appendChild(el('div', { class: 'empty' }, '칭호가 없습니다.')); return; }
        list.forEach(entry => grid.appendChild(dexTitleCard(entry)));
        return;
    }
    if (dexTab === 'orb') {
        if (!dexData) return;
        renderOrbDex(grid, dexData.orb || []);
        return;
    }
    if (dexTab === 'specter') {
        if (!dexData) return;
        renderSpecterDex(grid, dexData.specter || []);
        return;
    }
    const equipmentTab = DEX_EQUIPMENT_TABS.has(dexTab);
    grid.className = equipmentTab ? 'dex-grid dex-gear-grid' : 'dex-grid';
    if (!dexData) return;
    const list = applyDexRarityFilter(dexData[dexTab] || []);
    grid.innerHTML = '';
    if (!list.length) {
        grid.appendChild(el('div', { class: 'empty' }, '데이터가 없습니다.'));
        return;
    }
    list.forEach(entry => grid.appendChild(
        equipmentTab ? dexEquipmentCard(entry) : (dexTab === 'character' ? dexCharacterCard(entry) : dexCard(entry))
    ));
}

async function loadDex() {
    if (dexTab === 'potential') {
        hideDexRarityFilter();
        if (!potentialDexData) {
            $('#dexList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
            try { potentialDexData = await api('/api/dex/potential'); }
            catch (e) { $('#dexList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
        }
        renderDex();
        return;
    }
    if (dexTab === 'title') {
        hideDexRarityFilter();
        if (!titlesData) {
            $('#dexList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
            try { titlesData = await api('/api/titles'); }
            catch (e) { $('#dexList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
        }
        renderDex();
        return;
    }
    if (!dexData) {
        $('#dexList').replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
        try { dexData = await api('/api/dex/equipment'); }
        catch (e) { $('#dexList').replaceChildren(el('div', { class: 'empty err' }, e.message)); return; }
    }
    renderDex();
}

$$('.dex-tab').forEach(btn => btn.onclick = () => {
    dexTab = btn.dataset.tab;
    $$('.dex-tab').forEach(b => b.classList.toggle('active', b === btn));
    loadDex();
});

const dexSidebarMobileQuery = window.matchMedia('(max-width: 860px)');

function setDexSidebarVisible(visible) {
    const sidebar = document.querySelector('.dex-sidebar');
    if (!sidebar) return;
    sidebar.classList.toggle('is-concealed', dexSidebarMobileQuery.matches && !visible);
}

window.addEventListener('scroll', () => {
    if (activePage === 'dex' && dexSidebarMobileQuery.matches) setDexSidebarVisible(false);
}, { passive: true });

dexSidebarMobileQuery.addEventListener('change', event => {
    if (!event.matches) setDexSidebarVisible(true);
});

let dexSwipeStart = null;
document.addEventListener('touchstart', event => {
    const touch = event.touches && event.touches[0];
    dexSwipeStart = activePage === 'dex' && dexSidebarMobileQuery.matches && touch
        ? { x: touch.clientX, y: touch.clientY }
        : null;
}, { passive: true });

document.addEventListener('touchend', event => {
    if (!dexSwipeStart) return;
    const touch = event.changedTouches && event.changedTouches[0];
    if (touch) {
        const moveX = touch.clientX - dexSwipeStart.x;
        const moveY = Math.abs(touch.clientY - dexSwipeStart.y);
        if (moveX >= 32 && moveX > moveY * 1.15) setDexSidebarVisible(true);
    }
    dexSwipeStart = null;
}, { passive: true });

$('#dexRarityFilter').onchange = event => {
    dexRarity = event.target.value || 'all';
    renderDex();
};

let patchnoteData = null;
let patchnoteAdmin = false;
let patchView = 'list';
let patchSelectedId = null;
let patchReplyActive = null;

function countReplies(replies) {
    let n = 0;
    (replies || []).forEach(r => { n += 1 + countReplies(r.replies); });
    return n;
}

function formatDateTime(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString('ko-KR');
}

function escapeMarkdownHtml(text) {
    return String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderInlineMarkdown(text) {
    return escapeMarkdownHtml(text)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function markdownToHtml(text) {
    const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let inCode = false;
    let codeLines = [];
    let list = null;
    const closeList = () => {
        if (list) {
            out.push('</' + list + '>');
            list = null;
        }
    };
    lines.forEach(line => {
        if (line.trim().startsWith('```')) {
            if (inCode) {
                out.push('<pre><code>' + escapeMarkdownHtml(codeLines.join('\n')) + '</code></pre>');
                codeLines = [];
                inCode = false;
            } else {
                closeList();
                inCode = true;
            }
            return;
        }
        if (inCode) {
            codeLines.push(line);
            return;
        }
        if (/^###\s+/.test(line)) { closeList(); out.push('<h3>' + renderInlineMarkdown(line.replace(/^###\s+/, '')) + '</h3>'); return; }
        if (/^##\s+/.test(line)) { closeList(); out.push('<h2>' + renderInlineMarkdown(line.replace(/^##\s+/, '')) + '</h2>'); return; }
        if (/^#\s+/.test(line)) { closeList(); out.push('<h1>' + renderInlineMarkdown(line.replace(/^#\s+/, '')) + '</h1>'); return; }
        if (/^\s*[-*]\s+/.test(line)) {
            if (list !== 'ul') { closeList(); list = 'ul'; out.push('<ul>'); }
            out.push('<li>' + renderInlineMarkdown(line.replace(/^\s*[-*]\s+/, '')) + '</li>');
            return;
        }
        if (/^\s*\d+\.\s+/.test(line)) {
            if (list !== 'ol') { closeList(); list = 'ol'; out.push('<ol>'); }
            out.push('<li>' + renderInlineMarkdown(line.replace(/^\s*\d+\.\s+/, '')) + '</li>');
            return;
        }
        closeList();
        if (line.trim()) out.push('<p>' + renderInlineMarkdown(line) + '</p>');
    });
    closeList();
    if (inCode) out.push('<pre><code>' + escapeMarkdownHtml(codeLines.join('\n')) + '</code></pre>');
    return out.join('');
}

function replyForm(noteId, parentId) {
    const ta = el('textarea', { placeholder: parentId ? '대댓글 작성...' : '댓글 작성...' });
    const btn = el('button', { class: 'primary', onclick: async () => {
        const textbody = ta.value.trim();
        if (!textbody) return showAlert('내용을 입력해주세요.');
        btn.disabled = true;
        try {
            const data = await postApi('/api/patchnotes/' + encodeURIComponent(noteId) + '/replies', { parentId, textbody });
            patchnoteData = data.items || [];
            patchReplyActive = null;
            renderPatchnotes();
        } catch (e) {
            showAlert(e.message);
            btn.disabled = false;
        }
    } }, parentId ? '대댓글 등록' : '댓글 등록');
    return el('div', { class: 'reply-box' }, ta, el('div', { class: 'actions' }, btn));
}

function renderPatchReplies(noteId, replies, depth) {
    const wrap = el('div', { class: 'reply-list' });
    (replies || []).forEach(reply => {
        const isActive = patchReplyActive === reply.id;
        const head = el('div', { class: 'reply-head', onclick: () => {
            patchReplyActive = isActive ? null : reply.id;
            renderPatchnotes();
        } },
            el('div', { class: 'reply-meta' }, titleImg(reply.authorTitle), el('b', null, reply.authorName || '알 수 없음'), ' Lv. ' + comma(reply.authorLevel || 1) + ' · ' + formatDateTime(reply.date)),
            el('div', { class: 'reply-text' }, reply.textbody || ''),
            el('div', { class: 'reply-replybtn' }, isActive ? '답글 취소' : '답글 달기')
        );
        const item = el('div', { class: 'reply-item ' + (depth > 0 ? 'child ' : '') + (isActive ? 'active' : '') }, head);
        if (isActive) item.appendChild(replyForm(noteId, reply.id));
        if (reply.replies && reply.replies.length) item.appendChild(renderPatchReplies(noteId, reply.replies, depth + 1));
        wrap.appendChild(item);
    });
    return wrap;
}

function patchPostRow(note) {
    return el('div', { class: 'patch-post', onclick: () => {
        patchView = 'detail'; patchSelectedId = note.id; patchReplyActive = null;
        renderPatchnotes();
        const list = $('#patchList'); if (list) list.scrollIntoView({ block: 'start' });
    } },
        el('div', { class: 'pp-main' },
            el('div', { class: 'pp-title' }, note.title || '(제목 없음)'),
            el('div', { class: 'pp-date' }, formatDateTime(note.date))
        ),
        el('div', { class: 'pp-cmt' }, '댓글 ' + comma(countReplies(note.replies)))
    );
}

function renderPatchDetail(note) {
    const body = el('div', { class: 'markdown-body' });
    body.innerHTML = markdownToHtml(note.textbody || '');
    return el('div', { class: 'patch-detail' },
        el('button', { class: 'patch-back', onclick: () => {
            patchView = 'list'; patchSelectedId = null; patchReplyActive = null;
            renderPatchnotes();
        } }, '← 목록으로'),
        el('div', { class: 'patch-detail-head' },
            el('div', { class: 'patch-detail-title' }, note.title || '(제목 없음)'),
            el('div', { class: 'patch-detail-date' }, formatDateTime(note.date))
        ),
        body,
        el('div', { class: 'patch-comments' },
            el('div', { class: 'patch-comments-h' }, '댓글 ', el('span', null, comma(countReplies(note.replies)))),
            renderPatchReplies(note.id, note.replies || [], 0),
            replyForm(note.id, null)
        )
    );
}

function renderPatchnotes() {
    const list = $('#patchList');
    if (!list) return;
    list.innerHTML = '';
    const inDetail = patchView === 'detail' && patchSelectedId != null
        && patchnoteData && patchnoteData.some(n => n.id === patchSelectedId);
    if (!inDetail) { patchView = 'list'; patchSelectedId = null; }
    if ($('#patchNew')) $('#patchNew').style.display = (patchnoteAdmin && !inDetail) ? '' : 'none';
    if (inDetail && $('#patchEditor')) $('#patchEditor').classList.remove('active');
    if (!patchnoteData || patchnoteData.length === 0) {
        list.appendChild(el('div', { class: 'empty' }, '등록된 패치노트가 없습니다.'));
        return;
    }
    if (inDetail) {
        list.appendChild(renderPatchDetail(patchnoteData.find(n => n.id === patchSelectedId)));
        return;
    }
    const board = el('div', { class: 'patch-board' });
    patchnoteData.forEach(note => board.appendChild(patchPostRow(note)));
    list.appendChild(board);
}

async function loadPatchnotes() {
    const list = $('#patchList');
    if (!list) return;
    list.replaceChildren(el('div', { class: 'loading' }, '불러오는 중...'));
    try {
        const data = await api('/api/patchnotes');
        patchnoteData = data.items || [];
        patchnoteAdmin = !!data.admin;
        renderPatchnotes();
    } catch (e) {
        list.replaceChildren(el('div', { class: 'empty err' }, e.message));
    }
}

if ($('#patchNew')) $('#patchNew').onclick = () => $('#patchEditor').classList.add('active');
if ($('#patchCancel')) $('#patchCancel').onclick = () => $('#patchEditor').classList.remove('active');
if ($('#patchSubmit')) $('#patchSubmit').onclick = async () => {
    const title = $('#patchTitle').value.trim();
    const date = $('#patchDate').value.trim();
    const textbody = $('#patchBody').value.trim();
    if (!title) return showAlert('제목을 입력해주세요.');
    if (!textbody) return showAlert('본문을 입력해주세요.');
    $('#patchSubmit').disabled = true;
    try {
        const data = await postApi('/api/patchnotes', { title, date, textbody });
        patchnoteData = data.items || [];
        $('#patchTitle').value = '';
        $('#patchDate').value = '';
        $('#patchBody').value = '';
        $('#patchEditor').classList.remove('active');
        renderPatchnotes();
    } catch (e) {
        showAlert(e.message);
    } finally {
        $('#patchSubmit').disabled = false;
    }
};

// ===== 메일함 =====
function mailRelTime(ts) {
    const diff = Date.now() - Number(ts || 0);
    if (diff < 60000) return '방금';
    if (diff < 3600000) return Math.floor(diff / 60000) + '분 전';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '시간 전';
    const d = new Date(Number(ts));
    return (d.getMonth() + 1) + '월 ' + d.getDate() + '일';
}

// ----- 메일 전용 아이콘 / 모달 인프라 -----
const MAIL_SVG = {
    gift: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/></svg>`,
    item: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>`,
    equipment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/></svg>`,
    pet: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/></svg>`,
    check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
    close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
    pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>`
};
function mailSvg(name, cls) { const n = svgIcon(MAIL_SVG[name]); if (n && cls) n.setAttribute('class', cls); return n; }

function mailModalClose() { const bg = $('#mailModalBg'); if (bg) bg.classList.remove('active'); const m = $('#mailModal'); if (m) m.replaceChildren(); }
if ($('#mailModalBg')) $('#mailModalBg').onclick = e => { if (e.target === $('#mailModalBg')) mailModalClose(); };

function mailModalOpen(contentNode, opts) {
    opts = opts || {};
    const modal = $('#mailModal');
    modal.className = 'mail-modal' + (opts.wide ? ' wide' : '');
    const parts = [];
    if (opts.title) parts.push(el('div', { class: 'mm-head' },
        el('div', { class: 'mm-titlewrap' },
            opts.icon ? el('span', { class: 'mm-headicon' }, mailSvg(opts.icon)) : null,
            el('div', { class: 'mm-title' }, opts.title)),
        el('button', { class: 'mm-close', type: 'button', onclick: mailModalClose }, mailSvg('close'))
    ));
    parts.push(el('div', { class: 'mm-body' }, contentNode));
    if (opts.footer && opts.footer.length) parts.push(el('div', { class: 'mm-foot' }, ...opts.footer));
    modal.replaceChildren(...parts);
    $('#mailModalBg').classList.add('active');
}

function mailConfirm(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const cancel = el('button', { class: 'mm-btn ghost', type: 'button', onclick: () => { mailModalClose(); resolve(false); } }, opts.cancelText || '취소');
        const ok = el('button', { class: 'mm-btn ' + (opts.danger ? 'danger' : 'primary'), type: 'button', onclick: () => { mailModalClose(); resolve(true); } }, opts.confirmText || '확인');
        mailModalOpen(el('div', { class: 'mm-message' }, opts.message || ''), { title: opts.title || '확인', icon: opts.icon, footer: [cancel, ok] });
    });
}

function mailInfo(opts) {
    opts = opts || {};
    return new Promise(resolve => {
        const ok = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => { mailModalClose(); resolve(); } }, opts.confirmText || '확인');
        const body = el('div', { class: 'mm-message' });
        if (opts.message) body.appendChild(el('div', { class: 'mm-msg-text' }, opts.message));
        if (opts.extra) body.appendChild(opts.extra);
        mailModalOpen(body, { title: opts.title || '알림', icon: opts.icon, footer: [ok] });
    });
}

// 선물 아이콘 썸네일 (frame + icon, 삽니다 모달 스타일)
function mailGiftThumb(g) {
    const wrap = el('div', { class: 'mail-gift-thumb' });
    if (g.frameUrl) wrap.appendChild(el('img', { class: 'mg-frame', src: g.frameUrl, alt: '' }));
    if (g.iconUrl) wrap.appendChild(el('img', { class: 'mg-icon', src: g.iconUrl, alt: '', onerror: e => e.currentTarget.remove() }));
    else if (!g.frameUrl) wrap.appendChild(el('span', { class: 'mg-fallback' }, mailSvg(g.type === 'equipment' ? 'equipment' : g.type === 'pet' ? 'pet' : g.type === 'card' ? 'gift' : 'item')));
    return wrap;
}
function mailGiftRow(g) { return el('div', { class: 'mail-gift-item' }, mailGiftThumb(g), el('span', { class: 'mg-label' }, g.label)); }

function updateMailBadge() {
    document.querySelectorAll('.mail-badge').forEach(b => b.remove());
    const n = mailState.unread;
    if (!n || n <= 0) return;
    const label = n > 99 ? '99+' : String(n);
    $$('.group-tab[data-group="me"], .bottom-tab[data-group="me"]').forEach(t => t.appendChild(el('span', { class: 'mail-badge' }, label)));
    $$('.subnav-tab[data-page="mail"]').forEach(t => t.appendChild(el('span', { class: 'mail-badge' }, label)));
}

function renderMailList() {
    const listEl = $('#mailList');
    if (!listEl) return;
    if (!mailState.mails.length) {
        listEl.replaceChildren(el('div', { class: 'mailbox-empty' }, '받은 메일이 없습니다.'));
        return;
    }
    listEl.replaceChildren(...mailState.mails.map(m => {
        const tags = [];
        if (m.hasGifts) tags.push(el('span', { class: 'mail-tag-gift' + (m.claimed ? ' claimed' : '') }, mailSvg(m.claimed ? 'check' : 'gift', 'mtg-icon'), m.claimed ? '수령완료' : '선물 ' + m.gifts.length));
        return el('div', { class: 'mail-row' + (m.read ? '' : ' unread') + (m.id === mailState.selectedId ? ' active' : ''), onclick: () => openMailDetail(m.id) },
            el('span', { class: 'mail-dot' + (m.read ? ' read' : '') }),
            el('div', { class: 'mail-row-main' },
                el('div', { class: 'mail-row-top' },
                    el('span', { class: 'mail-row-from' }, m.gm ? el('span', { class: 'gm-tag' }, 'GM') : null, m.from),
                    el('span', { class: 'mail-row-date' }, mailRelTime(m.createdAt))),
                el('div', { class: 'mail-row-subject' }, m.subject),
                tags.length ? el('div', { class: 'mail-row-tags' }, ...tags) : null
            )
        );
    }));
}

function renderMailDetail(m) {
    const children = [
        el('h2', { class: 'mail-detail-subject' }, m.subject),
        el('div', { class: 'mail-detail-meta' },
            el('span', null, '보낸 사람'), el('b', null, m.gm ? el('span', { class: 'gm-tag' }, 'GM') : null, m.from),
            el('span', { style: 'margin-left:auto' }, new Date(m.createdAt).toLocaleString('ko-KR'))),
        el('div', { class: 'mail-detail-body' }, m.body || '(내용 없음)')
    ];
    if (m.hasGifts) {
        const giftBox = el('div', { class: 'mail-gift-box' },
            el('div', { class: 'mail-gift-title' }, mailSvg('gift'), '첨부된 선물'),
            el('div', { class: 'mail-gift-list' }, ...m.gifts.map(mailGiftRow))
        );
        if (m.claimed) {
            giftBox.appendChild(el('div', { class: 'mail-claimed-badge' }, mailSvg('check'), '수령 완료'));
        } else {
            giftBox.appendChild(el('button', { class: 'primary mail-claim-btn', type: 'button', onclick: () => claimMail(m.id) }, mailSvg('gift'), '선물 받기'));
        }
        children.push(giftBox);
    }
    $('#mailDetail').replaceChildren(...children);
}

async function openMailDetail(id) {
    const m = mailState.mails.find(x => x.id === id);
    if (!m) return;
    mailState.selectedId = id;
    $('#mailbox').classList.add('show-detail');
    $('#mailDetailEmpty').style.display = 'none';
    $('#mailDetail').style.display = '';
    renderMailDetail(m);
    renderMailList();
    if (!m.read) {
        m.read = true;
        mailState.unread = Math.max(0, mailState.unread - 1);
        updateMailBadge();
        renderMailList();
        try { await postApi('/api/mail/read', { id }); } catch (_) { }
    }
}

async function claimMail(id) {
    const m = mailState.mails.find(x => x.id === id);
    if (!m) return;
    const ok = await mailConfirm({ title: '선물 받기', icon: 'gift', message: '첨부된 선물을 모두 수령하시겠습니까?', confirmText: '받기' });
    if (!ok) return;
    try {
        await postApi('/api/mail/claim', { id });
        m.claimed = true;
        renderMailDetail(m);
        renderMailList();
        await mailInfo({ title: '수령 완료', icon: 'check', message: '선물을 수령했습니다.', extra: el('div', { class: 'mail-gift-list', style: 'margin-top:12px' }, ...m.gifts.map(mailGiftRow)) });
    } catch (e) { mailInfo({ title: '오류', message: e.message }); }
}

function renderMailPager() {
    const pager = $('#mailPager');
    if (!pager) return;
    if (mailState.totalPages <= 1) { pager.style.display = 'none'; pager.replaceChildren(); return; }
    pager.style.display = '';
    pager.replaceChildren(
        el('button', { disabled: mailState.page <= 1, onclick: () => loadMail(mailState.page - 1) }, '‹ 이전'),
        el('span', { class: 'mail-page-info' }, mailState.page + ' / ' + mailState.totalPages),
        el('button', { disabled: mailState.page >= mailState.totalPages, onclick: () => loadMail(mailState.page + 1) }, '다음 ›')
    );
}

async function loadMail(page) {
    const listEl = $('#mailList');
    if (listEl) listEl.replaceChildren(el('div', { class: 'mailbox-empty' }, '불러오는 중...'));
    const composeBtn = $('#mailComposeBtn');
    if (composeBtn) composeBtn.onclick = openMailCompose;
    const backBtn = $('#mailBackBtn');
    if (backBtn) backBtn.onclick = () => { mailState.selectedId = null; $('#mailbox').classList.remove('show-detail'); renderMailList(); };
    try {
        const box = await api('/api/mail?page=' + (Number(page) || 1));
        mailState.mails = box.mails || [];
        mailState.unread = box.unread || 0;
        mailState.page = box.page || 1;
        mailState.totalPages = box.totalPages || 1;
        renderMailList();
        renderMailPager();
        updateMailBadge();
        if (mailState.selectedId && mailState.mails.some(m => m.id === mailState.selectedId)) {
            openMailDetail(mailState.selectedId);
        } else if (!mailState.selectedId) {
            $('#mailbox').classList.remove('show-detail');
            $('#mailDetail').style.display = 'none';
            $('#mailDetailEmpty').style.display = '';
        }
    } catch (e) {
        if (listEl) listEl.replaceChildren(el('div', { class: 'mailbox-empty err' }, e.message));
    }
}

async function refreshMailBadge() {
    try {
        const box = await api('/api/mail?page=1');
        mailState.unread = box.unread || 0;
        updateMailBadge();
    } catch (_) { }
}

// ----- 메일 작성 (전용 모던 모달) -----
async function openMailCompose() {
    let giftable;
    try { giftable = await api('/api/mail/giftable'); } catch (e) { return mailInfo({ title: '오류', message: e.message }); }
    const gifts = [];
    const toInput = el('input', { class: 'mc-input', placeholder: '받는 사람 닉네임', maxLength: 10 });
    const subjectInput = el('input', { class: 'mc-input', placeholder: '제목 (최대 50자)', maxLength: 50 });
    const bodyInput = el('textarea', { class: 'mc-textarea', placeholder: '내용을 입력하세요...', maxLength: 1000 });
    const slotsEl = el('div', { class: 'mc-gift-slots' });
    const feeNote = el('div', { class: 'mc-fee-note' });
    const composeErr = el('div', { class: 'mc-error' });
    const baseMailFeeRate = Number(giftable.feeRate);
    let resolvedFeeRecipient = '';
    let feeRequestToken = 0;

    async function syncRecipientFee() {
        const to = toInput.value.trim();
        if (!to || to === resolvedFeeRecipient) return;
        const token = ++feeRequestToken;
        try {
            const data = await api('/api/mail/recipient-fee?to=' + encodeURIComponent(to));
            if (token !== feeRequestToken) return;
            giftable.feeRate = Number(data.feeRate);
            giftable.feeMin = Number(data.feeMin);
            resolvedFeeRecipient = to;
            composeErr.textContent = '';
            renderSlots();
        } catch (e) {
            if (token !== feeRequestToken) return;
            giftable.feeRate = baseMailFeeRate;
            resolvedFeeRecipient = '';
            composeErr.textContent = e.message;
            renderSlots();
        }
    }
    toInput.addEventListener('input', () => {
        if (toInput.value.trim() !== resolvedFeeRecipient) {
            giftable.feeRate = baseMailFeeRate;
            resolvedFeeRecipient = '';
            renderSlots();
        }
    });
    toInput.addEventListener('blur', () => { syncRecipientFee().catch(() => {}); });

    function giftDisplay(g) {
        if (g.type === 'gold') return { type: 'gold', iconUrl: giftable.goldIconUrl, label: comma(g.amount) + ' 골드' };
        if (g.type === 'garnet') return { type: 'garnet', iconUrl: giftable.garnetIconUrl, label: comma(g.amount) + ' 가넷' };
        if (g.type === 'point') return { type: 'point', iconUrl: giftable.pointIconUrl, label: comma(g.amount) + 'P' };
        return { type: g.type, iconUrl: g._icon, frameUrl: g._frame, label: g._label };
    }

    function renderSlots() {
        if (!gifts.length) slotsEl.replaceChildren(el('div', { class: 'mc-gift-empty' }, '담은 선물이 없습니다.'));
        else slotsEl.replaceChildren(...gifts.map((g, i) => {
            const d = giftDisplay(g);
            return el('div', { class: 'mc-gift-slot' },
                mailGiftThumb(d),
                el('span', { class: 'mc-slot-label' }, d.label),
                el('button', { class: 'mc-slot-remove', type: 'button', onclick: () => { gifts.splice(i, 1); renderSlots(); } }, mailSvg('close')));
        }));
        let fee = 0;
        gifts.forEach(g => { if (g.type === 'gold' || g.type === 'garnet') fee += Math.max(giftable.feeMin, Math.floor(g.amount * giftable.feeRate)); });
        feeNote.textContent = fee > 0 ? '받는 사람 기준 수수료 합계 ' + comma(fee) + ' · 수수료를 뺀 금액이 전달됩니다' : '';
    }

    function canAdd() {
        if (gifts.length >= giftable.maxGifts) { composeErr.textContent = '선물은 최대 ' + giftable.maxGifts + '개까지 담을 수 있습니다.'; return false; }
        composeErr.textContent = '';
        return true;
    }

    const field = (label, input) => el('div', { class: 'mc-field' }, el('label', { class: 'mc-label' }, label), input);
    const addBtn = (type, label, iconNode) => el('button', { class: 'mc-add-btn', type: 'button', onclick: () => { if (!canAdd()) return; if (type === 'gold' || type === 'garnet' || type === 'point') viewCurrency(type); else viewPicker(type); } }, el('span', { class: 'mc-add-ic' }, iconNode), el('span', null, label));

    function viewCompose() {
        renderSlots();
        const content = el('div', { class: 'mc-view' },
            field('받는 사람', toInput),
            field('제목', subjectInput),
            field('내용', bodyInput),
            el('div', { class: 'mc-section-label' }, '선물 (최대 ' + giftable.maxGifts + '개)'),
            el('div', { class: 'mc-add-row' },
                addBtn('gold', '골드', giftable.goldIconUrl ? el('img', { class: 'mc-add-img', src: giftable.goldIconUrl, alt: '' }) : mailSvg('item')),
                addBtn('garnet', '가넷', giftable.garnetIconUrl ? el('img', { class: 'mc-add-img', src: giftable.garnetIconUrl, alt: '' }) : mailSvg('item')),
                addBtn('point', '포인트', giftable.pointIconUrl ? el('img', { class: 'mc-add-img', src: giftable.pointIconUrl, alt: '' }) : mailSvg('item')),
                addBtn('equipment', '장비', mailSvg('equipment')),
                addBtn('pet', '펫', mailSvg('pet')),
                addBtn('item', '아이템', mailSvg('item')),
                addBtn('avatar', '아바타', mailSvg('gift'))),
            slotsEl, feeNote, composeErr
        );
        const cancel = el('button', { class: 'mm-btn ghost', type: 'button', onclick: mailModalClose }, '닫기');
        const send = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => doSend(send) }, '보내기');
        mailModalOpen(content, { title: '메일 쓰기', icon: 'pencil', wide: true, footer: [cancel, send] });
    }

    async function viewCurrency(type) {
        const name = type === 'gold' ? '골드' : type === 'garnet' ? '가넷' : '포인트';
        if (type !== 'point' && toInput.value.trim()) await syncRecipientFee();
        const balance = type === 'gold' ? giftable.gold : type === 'garnet' ? giftable.garnet : giftable.point;
        const reserved = gifts.filter(g => g.type === type).reduce((sum, g) => sum + Number(g.amount || 0), 0);
        const max = Math.max(0, balance - reserved);
        const iconUrl = type === 'gold' ? giftable.goldIconUrl : type === 'garnet' ? giftable.garnetIconUrl : giftable.pointIconUrl;
        const hasFee = type !== 'point';
        const input = el('input', { class: 'mc-input', type: 'text', inputmode: 'numeric', placeholder: '0' });
        const errEl = el('div', { class: 'mc-error' });
        const preview = el('div', { class: 'mc-preview' });
        input.addEventListener('input', () => {
            const a = Math.floor(Number(String(input.value).replace(/[^0-9]/g, '')));
            if (a > 0 && hasFee) { const fee = Math.max(giftable.feeMin, Math.floor(a * giftable.feeRate)); preview.textContent = '받는 사람 기준 수수료 ' + comma(fee) + ' · ' + comma(Math.max(0, a - fee)) + ' 수령'; }
            else if (a > 0) preview.textContent = '받는 사람 ' + comma(a) + 'P 수령';
            else preview.textContent = '';
        });
        const content = el('div', { class: 'mc-view' },
            el('div', { class: 'mc-asset-head' }, iconUrl ? el('img', { class: 'mc-asset-img', src: iconUrl, alt: '' }) : null,
                el('div', null, el('div', { class: 'mc-asset-name' }, name), el('div', { class: 'mc-asset-bal' }, '보유 ' + comma(balance) + (reserved > 0 ? ' · 이미 담음 ' + comma(reserved) : '')))),
            el('label', { class: 'mc-label' }, name + ' 수량'), input, preview, errEl);
        const back = el('button', { class: 'mm-btn ghost', type: 'button', onclick: viewCompose }, '뒤로');
        const add = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => {
            const amount = Math.floor(Number(String(input.value).replace(/[^0-9]/g, '')));
            if (!(amount > 0)) { errEl.textContent = '수량을 입력하세요.'; return; }
            if (amount > max) { errEl.textContent = '보유량을 초과했습니다.'; return; }
            const fee = hasFee ? Math.max(giftable.feeMin, Math.floor(amount * giftable.feeRate)) : 0;
            if (hasFee && amount - fee < 1) { errEl.textContent = '수수료(' + comma(fee) + ') 이상이어야 합니다.'; return; }
            gifts.push({ type, amount });
            viewCompose();
        } }, '담기');
        mailModalOpen(content, { title: name + ' 담기', wide: true, footer: [back, add] });
        setTimeout(() => input.focus(), 60);
    }

    function viewPicker(kind) {
        const usedNums = new Set(gifts.filter(g => g.type === 'equipment').map(g => g.number));
        const usedIdx = new Set(gifts.filter(g => g.type === 'pet').map(g => g.index));
        const usedAvatars = new Set(gifts.filter(g => g.type === 'avatar').map(g => g.name));
        let opts = kind === 'equipment' ? giftable.equipment : kind === 'pet' ? giftable.pets : kind === 'avatar' ? (giftable.avatars || []) : giftable.items;
        if (kind === 'equipment') opts = opts.filter(o => !usedNums.has(o.number));
        else if (kind === 'pet') opts = opts.filter(o => !usedIdx.has(o.index));
        else if (kind === 'avatar') opts = opts.filter(o => !usedAvatars.has(o.name));
        const title = kind === 'equipment' ? '장비 선택' : kind === 'pet' ? '펫 선택' : kind === 'avatar' ? '아바타 선택' : '아이템 선택';
        const list = el('div', { class: 'mc-pick-list' });
        if (!opts.length) list.appendChild(el('div', { class: 'mc-gift-empty' }, kind === 'avatar' ? '보낼 수 있는 아바타가 없습니다.\n(프레스티지 · 거래 횟수를 소진한 한정판 제외)' : '보낼 수 있는 항목이 없습니다.'));
        else opts.forEach(o => {
            const sub = kind === 'item' ? ('보유 ' + comma(o.count))
                : kind === 'avatar' ? ('아바타 · ' + (o.grade || '일반') + (o.grade === '한정' ? ' (전송 후 재거래 불가)' : ''))
                : (o.rarity + (o.level > 0 ? ' · +' + o.level : ''));
            list.appendChild(el('div', { class: 'mc-pick-row', onclick: () => pickGift(kind, o) },
                mailGiftThumb({ type: kind, iconUrl: o.iconUrl || o.imageUrl, frameUrl: o.iconUrl ? o.frameUrl : null }),
                el('div', { class: 'mc-pick-main' }, el('div', { class: 'mc-pick-name' }, o.name), el('div', { class: 'mc-pick-sub' }, sub))));
        });
        const back = el('button', { class: 'mm-btn ghost', type: 'button', onclick: viewCompose }, '뒤로');
        mailModalOpen(el('div', { class: 'mc-view' }, list), { title, wide: true, footer: [back] });
    }

    function pickGift(kind, o) {
        if (kind === 'equipment') { gifts.push({ type: 'equipment', number: o.number, _label: o.name + (o.level > 0 ? ' +' + o.level : ''), _icon: o.iconUrl, _frame: o.frameUrl }); viewCompose(); }
        else if (kind === 'pet') { gifts.push({ type: 'pet', index: o.index, _label: o.name + (o.level > 0 ? ' +' + o.level : ''), _icon: o.iconUrl, _frame: o.frameUrl }); viewCompose(); }
        else if (kind === 'avatar') { gifts.push({ type: 'avatar', name: o.name, _label: o.name + ' 아바타' + (o.grade === '한정' ? ' [한정]' : ''), _icon: o.iconUrl || o.imageUrl, _frame: o.iconUrl ? o.frameUrl : null }); viewCompose(); }
        else viewItemCount(o);
    }

    function viewItemCount(o) {
        const input = el('input', { class: 'mc-input', type: 'text', inputmode: 'numeric', value: '1' });
        const errEl = el('div', { class: 'mc-error' });
        const content = el('div', { class: 'mc-view' },
            el('div', { class: 'mc-asset-head' }, mailGiftThumb({ type: 'item', iconUrl: o.iconUrl, frameUrl: o.frameUrl }),
                el('div', null, el('div', { class: 'mc-asset-name' }, o.name), el('div', { class: 'mc-asset-bal' }, '보유 ' + comma(o.count)))),
            el('label', { class: 'mc-label' }, '보낼 수량'), input, errEl);
        const back = el('button', { class: 'mm-btn ghost', type: 'button', onclick: () => viewPicker('item') }, '뒤로');
        const add = el('button', { class: 'mm-btn primary', type: 'button', onclick: () => {
            const count = Math.floor(Number(String(input.value).replace(/[^0-9]/g, '')));
            if (!(count > 0) || count > o.count) { errEl.textContent = '수량이 올바르지 않습니다.'; return; }
            gifts.push({ type: 'item', id: o.id, count, _label: o.name + ' x' + comma(count), _icon: o.iconUrl, _frame: o.frameUrl });
            viewCompose();
        } }, '담기');
        mailModalOpen(content, { title: o.name, wide: true, footer: [back, add] });
        setTimeout(() => input.focus(), 60);
    }

    async function doSend(btn) {
        composeErr.textContent = '';
        const to = toInput.value.trim();
        if (!to) { composeErr.textContent = '받는 사람을 입력해주세요.'; return; }
        if (!subjectInput.value.trim() && !bodyInput.value.trim() && !gifts.length) { composeErr.textContent = '내용 또는 선물을 입력해주세요.'; return; }
        btn.disabled = true;
        try {
            const payload = gifts.map(g => { const c = {}; for (const k in g) if (k[0] !== '_') c[k] = g[k]; return c; });
            const r = await postApi('/api/mail/send', { to, subject: subjectInput.value.trim(), body: bodyInput.value.trim(), gifts: payload });
            mailModalClose();
            await mailInfo({ title: '발송 완료', icon: 'check', message: to + '님에게 메일을 보냈습니다.' + (r.fee ? '\n골드/가넷 수수료 ' + comma(r.fee) + ' 제외 후 전달됩니다.' : '') });
        } catch (e) { composeErr.textContent = e.message; btn.disabled = false; }
    }

    viewCompose();
}

(async () => {
    try {
        const me = await api('/api/me');
        myName = me.name;
        const profile = await api('/api/profile');
        renderProfile(profile);
        refreshMailBadge();
        const tab = new URLSearchParams(location.search).get('tab');
        const initialPage = (typeof window !== 'undefined' && window.__INITIAL_PAGE) || '';
        if (tab && GROUPS.some(g => g.pages.includes(tab))) activatePage(tab);
        else if (initialPage && GROUPS.some(g => g.pages.includes(initialPage))) activatePage(initialPage);
        else activatePage('home');
    } catch (e) {
        $('#app').replaceChildren(el('section', { class: 'panel' }, el('h2', null, '오류'), el('p', { class: 'err' }, e.message)));
    }
})();
