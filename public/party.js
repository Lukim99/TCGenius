// 파티 퀘스트 클라이언트 (로비 + 방 + 전투)
(() => {
    'use strict';
    const $ = sel => document.querySelector(sel);
    const $$ = sel => Array.from(document.querySelectorAll(sel));
    const me = window.PARTY_ME || '';

    let questDefs = [];
    let currentRoom = null;
    let stream = null;
    let lastTickAt = 0;
    let shownRewardRoomId = null;
    let localBuffTickAt = 0;
    let skillBarSig = '';
    let potionBarSig = '';
    let bossStageSig = '';
    let voteSig = '';
    let supportBarSig = '';
    let raidEffects = null;
    let sceneObserver = null;
    // 클라이언트 로컬 쿨다운 데드라인 (epoch ms) 
    const myCD = { action: 0, skills: {}, potion: 0 };
    const pendingCD = { action: false, potion: false };
    let cooldownClockOffset = null, lastCooldownServerTime = 0;
    let localCdTimer = null;

    const POS_DETAILS = {
        '탱커':   ['최종 체력 +30%', '최종 방어력 +30%', '입히는 피해 -50%'],
        '브루저': ['최종 체력 +5%', '최종 방어력 +5%', '최종 공격력 +5%'],
        '메인딜러': ['최종 체력 -50%', '최종 방어력 -50%', '최종 공격력 +10%', '입히는 피해 +65%', '방어력 관통 +30%'],
        '서브딜러': ['최종 체력 -30%', '최종 방어력 -30%', '입히는 피해 +15%', '스킬 공격 피해 +30%', '최종 MP +20%'],
        '서포터':  ['MP 소모 -25%', '스킬 쿨타임 -30%', '입히는 피해 -75%']
    };

    function el(tag, attrs, ...children) {
        const node = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(([k, v]) => {
            if (v === false || v == null) return;
            if (k === 'class') node.className = v;
            else if (k === 'style') node.setAttribute('style', v);
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
            else node.setAttribute(k, v);
        });
        for (const c of children) {
            if (c == null || c === false) continue;
            node.append(c instanceof Node ? c : document.createTextNode(String(c)));
        }
        return node;
    }

    function toast(msg) {
        const t = $('#pqToast');
        t.textContent = msg;
        t.classList.add('active');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => t.classList.remove('active'), 2400);
    }

    function formatCardStar(star) {
        const displayStar = Number(star || 0) + 1;
        return { 10: '𝛧', 11: '𝛴', 12: '𝛀' }[displayStar] || displayStar + '성';
    }

    // 공통 메시지 모달 (네이티브 alert/confirm 대체)
    function openMsgModal(message, isConfirm) {
        return new Promise(resolve => {
            const bg = el('div', { class: 'msg-modal-bg' });
            const done = val => { bg.remove(); resolve(val); };
            const okBtn = el('button', { class: 'msg-modal-btn primary', type: 'button', onClick: () => done(true) }, '확인');
            const actions = isConfirm
                ? [el('button', { class: 'msg-modal-btn', type: 'button', onClick: () => done(false) }, '취소'), okBtn]
                : [okBtn];
            bg.append(el('div', { class: 'msg-modal' },
                el('div', { class: 'msg-modal-text' }, String(message)),
                el('div', { class: 'msg-modal-actions' }, ...actions)));
            bg.addEventListener('click', e => { if (e.target === bg && !isConfirm) done(true); });
            bg.addEventListener('keydown', e => { if (e.key === 'Escape') done(!isConfirm); });
            document.body.appendChild(bg);
            setTimeout(() => okBtn.focus(), 30);
        });
    }
    const showAlert = message => openMsgModal(message, false);
    const showConfirm = message => openMsgModal(message, true);

    // 칭호 이미지 뱃지. title: { name, imageUrl } | null
    function titleImg(title) {
        if (!title || !title.imageUrl) return null;
        return el('img', { class: 'title-badge', src: title.imageUrl, alt: title.name || '', title: title.name || '' });
    }

    function showNotice(text, kind, ttl) {
        if (isPhaseTransitionActive()) return;
        const stack = $('#pqNoticeStack');
        const node = el('div', { class: 'pq-notice ' + (kind || 'info') }, text);
        stack.append(node);
        // 시야 방해 최소화: 표시 시간 상한 + 스택 3개 제한
        ttl = Math.min(Number(ttl) || 4000, 3200);
        setTimeout(() => { node.style.transition = 'opacity .3s'; node.style.opacity = '0'; }, Math.max(800, ttl - 300));
        setTimeout(() => { node.remove(); }, ttl);
        while (stack.childElementCount > 3) stack.firstElementChild.remove();
    }

    function syncMyDeadlinesFromSnapshot(snap) {
        if (!snap || !Array.isArray(snap.members)) return;
        const myMember = snap.members.find(m => m.name === me);
        if (!myMember || !myMember.runtime) {
            myCD.action = 0; myCD.potion = 0; myCD.skills = {};
            return;
        }
        const now = Date.now();
        const r = myMember.runtime;
        const serverTime = Number(snap.serverNow || 0);
        if (serverTime && serverTime < lastCooldownServerTime) return;
        if (serverTime) {
            lastCooldownServerTime = serverTime;
            const offset = now - serverTime;
            cooldownClockOffset = cooldownClockOffset == null ? offset : Math.min(cooldownClockOffset, offset);
        }
        const offset = cooldownClockOffset || 0;
        // 실제 종료 시각을 유지한다. 감소/초기화도 서버 값으로 즉시 교체한다.
        myCD.action = r.actionUntil != null ? Number(r.actionUntil) + offset : now + Number(r.actionCdRemain || 0) * 1000;
        myCD.potion = r.potionUntil != null ? Number(r.potionUntil) + offset : now + Number(r.potionCdRemain || 0) * 1000;
        myCD.skills = r.cooldownsUntil != null
            ? Object.fromEntries(Object.entries(r.cooldownsUntil).map(([key, until]) => [key, Number(until) + offset]))
            : Object.fromEntries(Object.entries(r.cooldowns || {}).map(([key, remain]) => [key, now + Number(remain) * 1000]));
    }

    function applyMyDeadlinesToRuntime() {
        if (!currentRoom) return false;
        const myMember = currentRoom.members.find(m => m.name === me);
        if (!myMember || !myMember.runtime) return false;
        const now = Date.now();
        const r = myMember.runtime;
        const actionRemain = Math.max(0, (myCD.action - now) / 1000);
        const potionRemain = Math.max(0, (myCD.potion - now) / 1000);
        r.actionCdRemain = actionRemain;
        r.potionCdRemain = potionRemain;
        const cooldowns = {};
        for (const k of Object.keys(myCD.skills)) {
            const remain = Math.max(0, (myCD.skills[k] - now) / 1000);
            if (remain > 0) cooldowns[k] = remain;
            else delete myCD.skills[k];
        }
        r.cooldowns = cooldowns;
        return true;
    }

    function ensureLocalCdTimer() {
        if (localCdTimer) return;
        localCdTimer = setInterval(() => {
            if (!currentRoom || (currentRoom.state !== 'inProgress')) return;
            if (!applyMyDeadlinesToRuntime()) return;
            applyLocalBuffTick();
            updateSkillPotionButtons();
            updateBuffChips();
            updateAttackBtn();
        }, 100);
    }

    function applyLocalBuffTick() {
        if (!currentRoom) return;
        const now = Date.now();
        if (!localBuffTickAt) { localBuffTickAt = now; return; }
        const dt = Math.max(0, (now - localBuffTickAt) / 1000);
        localBuffTickAt = now;
        if (Number(currentRoom.tauntRemain || 0) > 0) {
            currentRoom.tauntRemain = Math.max(0, Number(currentRoom.tauntRemain || 0) - dt);
            if (currentRoom.tauntRemain <= 0) currentRoom.tauntTarget = null;
        }
        for (const m of currentRoom.members || []) {
            const buffs = m.runtime && Array.isArray(m.runtime.buffs) ? m.runtime.buffs : [];
            for (const b of buffs) { if (b.remain == null) continue; b.remain = Math.max(0, Number(b.remain || 0) - dt); }
            if (m.runtime && Number(m.runtime.sealRemain || 0) > 0) m.runtime.sealRemain = Math.max(0, Number(m.runtime.sealRemain) - dt);
        }
        if (currentRoom.voteState) {
            currentRoom.voteState.deadline = Math.max(0, Number(currentRoom.voteState.deadline || 0) - dt);
            updateVoteTimer();
        }
    }

    // 영구 버프는 remain이 null로 내려온다 → 잔여시간 없이 라벨(스택)만 표시
    function buffChipText(label, remain) {
        return remain == null ? label : label + ' ' + Number(remain || 0).toFixed(1) + 's';
    }

    function updateBuffChips() {
        if (!currentRoom) return;
        $$('.pq-char-card[data-member]').forEach(row => {
            const memberName = row.dataset.member || '';
            const taunted = currentRoom.tauntTarget === memberName && Number(currentRoom.tauntRemain || 0) > 0;
            row.classList.toggle('taunt', taunted);
        });
        $$('.pq-buff-chip').forEach(chip => {
            const memberName = chip.dataset.member || '';
            const buffId = chip.dataset.buffId || '';
            const m = currentRoom.members.find(mm => mm.name === memberName);
            let remain = 0;
            if (buffId === 'taunt') {
                const taunted = currentRoom.tauntTarget === memberName || (currentRoom.monster && currentRoom.monster.tauntTarget === memberName);
                remain = taunted ? Number(currentRoom.tauntRemain || (currentRoom.monster && currentRoom.monster.tauntRemain) || 0) : 0;
            } else if (m && m.runtime && Array.isArray(m.runtime.buffs)) {
                const b = m.runtime.buffs.find(bb => String(bb.id || bb.label || '') === buffId);
                remain = b ? b.remain : 0;
            }
            const label = chip.dataset.label || buffId || '버프';
            if (remain == null || Number(remain) > 0) {
                chip.textContent = buffChipText(label, remain);
                chip.style.display = '';
            } else {
                chip.style.display = 'none';
            }
        });
    }

    function updateSkillPotionButtons() {
        if (!currentRoom) return;
        const myMember = currentRoom.members.find(m => m.name === me);
        if (!myMember || !myMember.runtime) return;
        const r = myMember.runtime;
        const acd = Number(r.actionCdRemain || 0);
        const pcd = Number(r.potionCdRemain || 0);
        const dead = !!r.dead;
        const transitioning = isPhaseTransitionActive() || currentRoom.monster?.mansion?.form === 'transition';
        const seal = Number(r.sealRemain || 0);
        const bar = $('#pqSkillBar');
        if (bar) bar.style.opacity = seal > 0 ? '.45' : '';
        const sealOverlay = $('#pqSealOverlay');
        if (sealOverlay) {
            sealOverlay.style.display = seal > 0 ? '' : 'none';
            if (seal > 0) sealOverlay.textContent = '봉인 ' + seal.toFixed(1) + 's';
        }
        $$('.pq-skill-btn[data-kind="skill"]').forEach(btn => {
            const skillName = btn.dataset.skill || '';
            const isPassive = btn.dataset.passive === '1';
            const remain = Number((r.cooldowns && r.cooldowns[skillName]) || 0);
            // 시벌론: 일반 공격 5회 충전 후 활성화 — 충전 부족 시 게이지 표시
            const needCharge = skillName === '시벌론' && Number(r.sivalonCharge || 0) < 5;
            const blocked = pendingCD.action || isPassive || dead || transitioning || seal > 0 || remain > 0 || acd > 0 || needCharge;
            btn.disabled = blocked;
            const cd = btn.querySelector('.cd');
            const text = seal > 0 && !isPassive ? ('봉인 ' + seal.toFixed(1))
                : (remain > 0 ? remain.toFixed(1)
                : (needCharge ? '충전 ' + Number(r.sivalonCharge || 0) + '/5'
                : (acd > 0 && !isPassive ? acd.toFixed(1) : '')));
            if (cd) {
                cd.textContent = text;
                cd.style.display = text ? '' : 'none';
            }
        });
        $$('.pq-skill-btn[data-kind="potion"]').forEach(btn => {
            btn.disabled = pendingCD.potion || dead || transitioning || seal > 0 || pcd > 0;
            btn.dataset.block = dead || transitioning || seal > 0 ? '1' : '';
            btn.style.setProperty('--cd', String(Math.min(1, pcd / 3)));
            const cd = btn.querySelector('.cd');
            if (cd) {
                const text = seal > 0 ? '봉인' : (pcd > 0 ? pcd.toFixed(1) : '');
                cd.textContent = text;
                cd.style.display = text ? '' : 'none';
            }
        });
    }

    function stopLocalCdTimer() {
        if (localCdTimer) { clearInterval(localCdTimer); localCdTimer = null; }
    }

    function updateAttackBtn() {
        const btn = document.getElementById('pqAttackBtn');
        if (!btn || !currentRoom) return;
        const myMember = currentRoom.members.find(m => m.name === me);
        if (!myMember) return;
        const r = myMember.runtime || {};
        const acd = Number(r.actionCdRemain || 0);
        const dead = !!r.dead;
        const seal = Number(r.sealRemain || 0);
        const gateTransition = isPhaseTransitionActive();
        const transition = gateTransition || currentRoom.monster?.mansion?.form === 'transition';
        const stone = currentRoom.monster?.mansion?.events?.some(event => event.kind === 'sculpture');
        const blocked = pendingCD.action || dead || currentRoom.awaitingChoices || seal > 0 || acd > 0 || transition;
        btn.disabled = blocked;
        btn.textContent = gateTransition ? '관문 전환 중' : seal > 0 ? ('봉인 ' + seal.toFixed(1) + 's') : (transition ? '잔향 전환 중' : acd > 0 ? (acd.toFixed(1) + 's') : stone ? '석재 공격' : '공격');
    }

    async function manualAttack() {
        try { await performPartyAction('/api/party/attack', {}, 'action'); } catch (e) { toast(e.message); }
    }

    async function performPartyAction(path, payload, kind) {
        if (currentRoom?.spectating) return;
        if (isPhaseTransitionActive()) return;
        if (!currentRoom || pendingCD[kind]) return;
        const roomId = currentRoom.id;
        const sync = state => {
            if (!state || state.roomId !== currentRoom?.id) return;
            syncMyDeadlinesFromSnapshot({ serverNow: state.serverNow, members: [{ name: me, runtime: state }] });
            applyMyDeadlinesToRuntime();
        };
        pendingCD[kind] = true;
        updateAttackBtn(); updateSkillPotionButtons();
        try {
            const result = await api(path, { method: 'POST', body: JSON.stringify(payload) });
            sync(result.cooldowns);
        } catch (e) {
            sync(e.cooldowns);
            throw e;
        } finally {
            if (currentRoom?.id === roomId) {
                pendingCD[kind] = false;
                updateAttackBtn(); updateSkillPotionButtons();
            }
        }
    }

    async function api(path, opts) {
        const res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { const error = new Error(data.error || ('HTTP ' + res.status)); error.cooldowns = data.cooldowns; throw error; }
        return data;
    }

    function showScreen(name) {
        $$('.pq-screen[data-screen]').forEach(s => s.classList.toggle('active', s.dataset.screen === name));
        $('#pqCreateFab').style.display = name === 'lobby' ? 'block' : 'none';
        // 전투 화면은 스크롤 없는 게임 HUD 모드
        $('#frame').classList.toggle('game', name === 'play');
        const titleByScreen = { lobby: '파티 퀘스트', room: '파티 준비', play: '파티 진행 중' };
        $('#pqTitle').textContent = titleByScreen[name] || '파티 퀘스트';
    }

    // ====== 로비 ======
    async function loadLobby() {
        try {
            const [questsResp, roomsResp] = await Promise.all([
                api('/api/party/quests'),
                api('/api/party/rooms')
            ]);
            questDefs = questsResp.quests || [];
            populateQuestSelect();
            if (roomsResp.my) {
                applyRoomSnapshot(roomsResp.my);
                openStream();
                showRoomScreenForState();
                return;
            }
            renderRoomList(roomsResp.rooms || []);
            showScreen('lobby');
        } catch (e) {
            toast(e.message || '불러오기 실패');
        }
    }

    // 퀘스트 ID 난이도 분류: Nightmare > Extreme > Hard > Normal
    function questDifficulty(id) {
        const s = String(id || '');
        return /Nightmare/i.test(s) ? 'nightmare' : (/Extreme/i.test(s) ? 'extreme' : (/Hard/i.test(s) ? 'hard' : 'normal'));
    }
    function coverUrl(file) { return file ? '/rpg-ui?file=' + encodeURIComponent(file) : ''; }
    function questMeta(id) { return questDefs.find(q => q.id === id) || null; }

    function renderRoomList(list) {
        const root = $('#pqRoomList');
        root.replaceChildren();
        root.classList.add('pq-room-list');
        if (!list.length) {
            root.append(el('div', { class: 'pq-empty' }, '생성된 파티가 없습니다.'));
            return;
        }
        for (const r of list) {
            const q = questMeta(r.questId);
            const difficulty = questDifficulty(r.questId);
            const count = Number(r.memberCount || 0);
            const max = Number(r.maxPlayers || 0);
            const full = max > 0 && count >= max;
            const cover = el('div', { class: 'pq-room-cover' });
            if (q && q.coverImage) cover.append(el('img', { src: coverUrl(q.coverImage), alt: '', loading: 'lazy', decoding: 'async', draggable: 'false', onError: e => e.currentTarget.remove() }));
            const pips = el('div', { class: 'pq-room-pips', 'aria-hidden': 'true' });
            for (let i = 0; i < max; i++) pips.append(el('i', { class: i < count ? 'on' : null }));
            const fighting = r.state === 'inProgress';
            root.append(el('article', { class: 'pq-room-card' + (full ? ' full' : ''), 'data-difficulty': difficulty },
                cover,
                el('div', { class: 'pq-room-body' },
                    el('span', { class: 'pq-diff-tag', 'data-difficulty': difficulty }, difficulty.toUpperCase()),
                    el('div', { class: 'pq-room-quest' }, r.questName),
                    el('div', { class: 'pq-room-title' }, r.hostName + '님의 파티')
                ),
                el('div', { class: 'pq-room-side' },
                    el('b', null, count + '/' + max),
                    pips,
                    r.hasPassword ? el('span', { class: 'lock' }, '비공개') : el('span', null, fighting ? '전투 중' : full ? '인원 마감' : r.state === 'lobby' ? '대기 중' : '준비 중'),
                    el('div', { class: 'pq-room-entry' },
                        !fighting && !full ? el('button', { type: 'button', class: 'pq-btn', onClick: () => attemptJoin(r) }, '입장') : null,
                        el('button', { type: 'button', class: 'pq-btn primary', onClick: () => attemptJoin(r, true) }, '관전'))
                )
            ));
        }
    }

    let questPickerIdx = 0;

    function renderQuestCard() {
        const q = questDefs[questPickerIdx];
        if (!q) return;
        const difficulty = questDifficulty(q.id);
        const card = $('#pqQuestCard');
        card.dataset.difficulty = difficulty;
        const imgWrap = $('#pqQuestCardImg');
        imgWrap.replaceChildren();
        if (q.coverImage) {
            imgWrap.append(el('img', { src: coverUrl(q.coverImage), alt: q.name, draggable: false, decoding: 'async' }));
        } else {
            imgWrap.append(el('div', { class: 'pq-quest-no-img' }, 'NO IMAGE'));
        }
        $('#pqQuestDifficulty').textContent = difficulty.toUpperCase();
        $('#pqQuestCardName').textContent = q.name;
        const meta = $('#pqQuestCardMeta');
        meta.replaceChildren();
        if (q.minLevel) meta.append(el('span', null, '입장 Lv.' + q.minLevel));
        if (q.recommendedPower) meta.append(el('span', null, '전투력 ' + Number(q.recommendedPower).toLocaleString()));
        meta.append(el('span', null, q.minPlayers + '~' + q.maxPlayers + '인'));
        if (q.locked) meta.append(el('span', null, q.unlockError || '퀘스트 보상으로 해금 필요'));
        $('#pqCreateConfirm').disabled = !!q.locked;
        const pager = $('#pqQuestPager');
        if (pager) pager.textContent = (questPickerIdx + 1) + ' / ' + questDefs.length;
        const prev = $('#pqQuestPrev');
        const next = $('#pqQuestNext');
        if (prev) prev.disabled = questPickerIdx === 0;
        if (next) next.disabled = questPickerIdx === questDefs.length - 1;
    }

    function populateQuestSelect() {
        questPickerIdx = 0;
        renderQuestCard();
        const prev = $('#pqQuestPrev');
        const next = $('#pqQuestNext');
        if (prev) prev.onclick = () => { if (questPickerIdx > 0) { questPickerIdx--; renderQuestCard(); } };
        if (next) next.onclick = () => { if (questPickerIdx < questDefs.length - 1) { questPickerIdx++; renderQuestCard(); } };
    }

    function attemptJoin(r, spectate = false) {
        const enter = async password => {
            await api('/api/party/rooms/' + r.id + (spectate ? '/spectate' : '/join'), { method: 'POST', body: JSON.stringify({ password }) });
            await afterEnterRoom();
        };
        if (r.hasPassword) {
            $('#pqJoinTitle').textContent = spectate ? '파티 관전' : '파티 입장';
            $('#pqJoinConfirm').textContent = spectate ? '관전' : '입장';
            const sub = $('#pqJoinSub');
            sub.textContent = r.hostName + '님의 파티 (' + r.questName + ')';
            $('#pqJoinPw').value = '';
            $('#pqJoinBg').classList.add('active');
            $('#pqJoinConfirm').onclick = async () => {
                const pw = $('#pqJoinPw').value;
                try {
                    await enter(pw);
                    $('#pqJoinBg').classList.remove('active');
                } catch (e) { toast(e.message); }
            };
        } else {
            (async () => {
                try {
                    await enter('');
                } catch (e) { toast(e.message); }
            })();
        }
    }

    async function afterEnterRoom() {
        try {
            const resp = await api('/api/party/me');
            if (resp.room) applyRoomSnapshot(resp.room);
            openStream();
            showRoomScreenForState();
        } catch (e) { toast(e.message); }
    }

    // ====== 사운드 설정 ======
    const SOUND_DEFAULTS = { bgm: 0.18, sfx: 0.5 };
    function clamp01(n) { n = Number(n); return isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; }
    function loadSound() {
        try {
            const raw = JSON.parse(localStorage.getItem('pqSound') || 'null');
            if (raw) return { bgm: clamp01(raw.bgm), sfx: clamp01(raw.sfx) };
        } catch (_) {}
        return Object.assign({}, SOUND_DEFAULTS);
    }
    const sound = loadSound();
    function saveSound() { try { localStorage.setItem('pqSound', JSON.stringify(sound)); } catch (_) {} }

    // ====== 전투 BGM ======
    const RAID_BGM = {
        blackHodu: ['boss fight.mp3'],
        blackHoduExtreme: ['boss fight.mp3'],
        butaGame: ['sfx/부타게임.mp3'],
        butaGameHard: ['sfx/부타게임.mp3'],
        mansionNormal: ['sfx/E세계대저택 1관문.mp3', 'sfx/E세계대저택 2관문.mp3'],
        mansionHard: ['sfx/E세계대저택 1관문.mp3', 'sfx/E세계대저택 2관문.mp3'],
        mansionNightmare: ['sfx/E세계대저택 1관문.mp3', 'sfx/E세계대저택 2관문.mp3']
    };
    let bgm = new Audio();
    bgm.loop = true;
    bgm.volume = sound.bgm;
    bgm.preload = 'none';
    let bgmWanted = false;
    let bgmUrl = '';
    let fadingBgm = null, bgmFadeFrame = null, bgmPlayPending = null;
    let bgmBlend = 1, fadingGain = 1;
    let defeatActive = false;
    let defeatTimer = null;
    let defeatFrame = null;
    let defeatVeil = null;
    function updateBgmVolume() {
        bgm.volume = sound.bgm * bgmBlend;
        if (fadingBgm) fadingBgm.volume = sound.bgm * fadingGain * Math.sqrt(Math.max(0, 1 - bgmBlend * bgmBlend));
    }
    function finishBgmFade() {
        cancelAnimationFrame(bgmFadeFrame);
        bgmFadeFrame = null;
        if (fadingBgm) fadingBgm.pause();
        fadingBgm = null;
        bgmBlend = 1;
        updateBgmVolume();
    }
    function playBgm() {
        const audio = bgm;
        if (!bgmWanted || sound.bgm <= 0 || bgmPlayPending === audio || !audio.paused) return;
        bgmPlayPending = audio;
        audio.play().then(() => {
            if (bgmPlayPending === audio) bgmPlayPending = null;
            if (audio !== bgm) { if (audio !== fadingBgm) audio.pause(); return; }
            if (!bgmWanted || sound.bgm <= 0) { audio.pause(); return; }
            if (!fadingBgm) return;
            const started = performance.now();
            const fade = () => {
                const progress = Math.min(1, (performance.now() - started) / 1500);
                bgmBlend = Math.sin(progress * Math.PI / 2);
                updateBgmVolume();
                if (progress >= 1) finishBgmFade();
                else bgmFadeFrame = requestAnimationFrame(fade);
            };
            bgmFadeFrame = requestAnimationFrame(fade);
        }).catch(() => { if (bgmPlayPending === audio) bgmPlayPending = null; });
    }
    function syncBgm(snap) {
        const tracks = RAID_BGM[snap?.questId];
        const file = tracks?.[snap?.phaseIndex] || tracks?.[0];
        const url = file ? '/rpg-ui?file=' + encodeURIComponent(file) : '';
        const want = !!(url && snap && (snap.state === 'inProgress' || defeatActive));
        if (want && url !== bgmUrl) {
            const previous = bgm;
            const keepPrevious = bgmWanted && !previous.paused && sound.bgm > 0;
            const previousGain = sound.bgm > 0 ? previous.volume / sound.bgm : 1;
            finishBgmFade();
            bgm = new Audio(url);
            bgm.loop = true; bgm.preload = 'none';
            bgmBlend = keepPrevious ? 0 : 1;
            if (keepPrevious) { fadingBgm = previous; fadingGain = previousGain; }
            else previous.pause();
            updateBgmVolume();
            bgmUrl = url;
        }
        if (want) preloadSfx();
        if (want === bgmWanted && !(want && bgm.paused)) return;
        bgmWanted = want;
        if (want) playBgm();
        else { finishBgmFade(); bgm.pause(); try { bgm.currentTime = 0; } catch (_) {} }
    }
    // 자동재생 차단(새로고침 재접속 등) 대비 — 첫 상호작용에서 재시도
    for (const evt of ['pointerdown', 'keydown']) {
        document.addEventListener(evt, playBgm, true);
    }

    // ====== 효과음 (기존 전투음 유지, 종료 음원 출처: docs/raid-assets.md) ======
    const SFX_FILES = {
        hit: ['sfx/hit_0.mp3', 'sfx/hit_1.mp3', 'sfx/hit_2.mp3'],
        crit: ['sfx/crit.mp3'],
        skill: ['sfx/skill.mp3'],
        potion: ['sfx/potion.mp3'],
        count: ['sfx/count.mp3'],
        start: ['sfx/start.mp3'],
        clear: ['sfx/raid/raid-clear-v2.mp3'],
        fail: ['sfx/raid/raid-fail-v2.mp3']
    };
    const sfxCache = {};
    let sfxPreloaded = false;
    let lastHitSfxAt = 0;
    function sfxBase(file) {
        let base = sfxCache[file];
        if (!base) {
            base = new Audio('/rpg-ui?file=' + encodeURIComponent(file));
            base.preload = 'auto';
            sfxCache[file] = base;
        }
        return base;
    }
    function preloadSfx() {
        if (sfxPreloaded) return;
        sfxPreloaded = true;
        Object.values(SFX_FILES).forEach(files => files.forEach(sfxBase));
    }
    function playSfx(name) {
        if (sound.sfx <= 0) return;
        const files = SFX_FILES[name];
        if (!files) return;
        // 타격음은 연타·파티원 동시 타격 시 과밀 방지
        if (name === 'hit' || name === 'crit') {
            const now = Date.now();
            if (now - lastHitSfxAt < 70) return;
            lastHitSfxAt = now;
        }
        const file = files.length > 1 ? files[Math.floor(Math.random() * files.length)] : files[0];
        const a = sfxBase(file).cloneNode();
        a.volume = sound.sfx;
        a.play().catch(() => {});
    }

    // ====== 키 바인딩 ======
    const KEYBIND_DEFAULTS = {
        attack: 'Space',
        skills: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'],
        potions: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT']
    };
    let keybinds = loadKeybinds();

    function loadKeybinds() {
        try {
            const raw = JSON.parse(localStorage.getItem('pqKeybinds') || 'null');
            if (raw && Array.isArray(raw.skills) && Array.isArray(raw.potions)) {
                return {
                    attack: typeof raw.attack === 'string' || raw.attack === null ? raw.attack : KEYBIND_DEFAULTS.attack,
                    skills: KEYBIND_DEFAULTS.skills.map((d, i) => raw.skills[i] === null || typeof raw.skills[i] === 'string' ? raw.skills[i] : d),
                    potions: KEYBIND_DEFAULTS.potions.map((d, i) => raw.potions[i] === null || typeof raw.potions[i] === 'string' ? raw.potions[i] : d)
                };
            }
        } catch (_) {}
        return JSON.parse(JSON.stringify(KEYBIND_DEFAULTS));
    }
    function saveKeybinds() { try { localStorage.setItem('pqKeybinds', JSON.stringify(keybinds)); } catch (_) {} }

    function keyLabel(code) {
        if (!code) return '없음';
        if (code.startsWith('Digit')) return code.slice(5);
        if (code.startsWith('Key')) return code.slice(3);
        if (code.startsWith('Numpad')) return 'Num' + code.slice(6);
        if (code.startsWith('Arrow')) return { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }[code] || code;
        const map = { Space: 'Space', ShiftLeft: 'LShift', ShiftRight: 'RShift', ControlLeft: 'LCtrl', ControlRight: 'RCtrl', AltLeft: 'LAlt', AltRight: 'RAlt', Backquote: '`', Minus: '-', Equal: '=', Tab: 'Tab', CapsLock: 'Caps', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']' };
        return map[code] || code;
    }

    function updateAttackKeyHint() {
        const node = document.getElementById('pqAttackKey');
        if (node) node.textContent = keybinds.attack ? keyLabel(keybinds.attack) : '';
    }

    // 전투 중 키 입력 → 해당 슬롯 버튼 클릭 (버튼의 disabled/쿨다운 로직을 그대로 탄다)
    document.addEventListener('keydown', e => {
        if (e.repeat) return;
        if (!currentRoom || currentRoom.spectating || currentRoom.state !== 'inProgress') return;
        const play = document.querySelector('.pq-screen[data-screen="play"]');
        if (!play || !play.classList.contains('active')) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA') return;
        if (document.querySelector('.pq-modal-bg.active')) return;
        const intro = document.getElementById('pqIntro');
        if (intro && intro.classList.contains('active')) return;
        let btn = null;
        if (keybinds.attack && e.code === keybinds.attack) btn = document.getElementById('pqAttackBtn');
        else {
            const si = e.code ? keybinds.skills.indexOf(e.code) : -1;
            if (si >= 0) btn = document.querySelectorAll('#pqSkillBar .pq-skill-btn')[si];
            else {
                const pi = e.code ? keybinds.potions.indexOf(e.code) : -1;
                if (pi >= 0) btn = document.querySelectorAll('#pqPotionBar .pq-skill-btn')[pi];
            }
        }
        if (!btn) return;
        e.preventDefault();
        const ae = document.activeElement;
        if (ae && ae.tagName === 'BUTTON') ae.blur(); // Space 네이티브 재활성화 방지
        if (!btn.disabled) btn.click();
    });

    // ====== 단축키 설정 모달 (로비) ======
    let kbCapture = null; // { set: fn, node: 버튼 }

    function keybindRows() {
        const rows = [{ label: '공격', get: () => keybinds.attack, set: v => { keybinds.attack = v; } }];
        keybinds.skills.forEach((_, i) => rows.push({ label: '스킬 ' + (i + 1), get: () => keybinds.skills[i], set: v => { keybinds.skills[i] = v; } }));
        keybinds.potions.forEach((_, i) => rows.push({ label: '물약 ' + (i + 1), get: () => keybinds.potions[i], set: v => { keybinds.potions[i] = v; } }));
        return rows;
    }

    function unbindCode(code) {
        if (!code) return;
        if (keybinds.attack === code) keybinds.attack = null;
        keybinds.skills = keybinds.skills.map(c => c === code ? null : c);
        keybinds.potions = keybinds.potions.map(c => c === code ? null : c);
    }

    function renderKeybindList() {
        const root = $('#pqKeybindList');
        if (!root) return;
        root.replaceChildren();
        for (const row of keybindRows()) {
            const code = row.get();
            const kb = el('button', { type: 'button', class: 'kb' + (code ? '' : ' empty') }, keyLabel(code));
            kb.addEventListener('click', () => startKeyCapture(row, kb));
            root.append(el('div', { class: 'pq-keybind-row' }, el('span', null, row.label), kb));
        }
    }

    function startKeyCapture(row, node) {
        stopKeyCapture();
        kbCapture = { row, node };
        node.classList.add('listening');
        node.textContent = '키 입력...';
    }
    function stopKeyCapture() {
        if (kbCapture && kbCapture.node) kbCapture.node.classList.remove('listening');
        kbCapture = null;
    }

    // 캡처 단계 keydown — 전투 핸들러보다 먼저(capture) 가로챈다
    document.addEventListener('keydown', e => {
        if (!kbCapture) return;
        e.preventDefault();
        e.stopPropagation();
        const { row } = kbCapture;
        if (e.code === 'Escape') { stopKeyCapture(); renderKeybindList(); return; }
        if (e.code === 'Backspace' || e.code === 'Delete') row.set(null);
        else { unbindCode(e.code); row.set(e.code); }
        saveKeybinds();
        stopKeyCapture();
        renderKeybindList();
        updateAttackKeyHint();
        skillBarSig = ''; potionBarSig = ''; // 다음 렌더에서 키 힌트 갱신
    }, true);

    // ====== 전투 시작 연출 ======
    // 대기방→전투 전환에서만 발동 (전투 중 새로고침/재접속은 제외).
    // 연출 중에는 오버레이가 입력을 막고, 서버도 introUntil까지 전투를 동결한다 (partyquest.js INTRO_GRACE_MS와 동기).
    let lastRoomState = null;
    let introTimer = null;

    function resetDefeatPresentation() {
        if (!defeatActive && !defeatTimer && !defeatFrame && !defeatVeil) return;
        finishBgmFade();
        clearTimeout(defeatTimer);
        cancelAnimationFrame(defeatFrame);
        defeatTimer = defeatFrame = null;
        defeatActive = false;
        defeatVeil?.remove();
        defeatVeil = null;
        document.querySelector('.pq-screen[data-screen="play"]')?.classList.remove('defeat-pending');
        bgm.playbackRate = 1;
        bgm.preservesPitch = true;
        bgm.volume = sound.bgm;
    }

    function syncDefeatPresentation(snap, previous) {
        if (snap.state !== 'failed') { resetDefeatPresentation(); return; }
        const remaining = Number(snap.result?.defeatRemainingMs || 0);
        if (defeatActive || remaining <= 0) return;
        hideBattleIntro();
        hidePhaseTransition();
        finishBgmFade();
        $('#pqTargetBg').classList.remove('active');
        defeatActive = true;
        const screen = document.querySelector('.pq-screen[data-screen="play"]');
        if (previous?.id !== snap.id || previous.state !== 'inProgress') {
            const cover = roomQuest(snap).coverImage;
            $('#pqPhaseStage').replaceChildren(el('div', { class: 'pq-defeat-still' },
                cover ? el('img', { src: coverUrl(cover), alt: '' }) : null));
        }
        screen.classList.add('defeat-pending');
        defeatVeil = el('div', { class: 'pq-defeat-veil', 'aria-hidden': 'true' });
        screen.append(defeatVeil);
        bgm.preservesPitch = false;
        const deadline = performance.now() + remaining;
        const frame = () => {
            if (!defeatActive) return;
            const progress = Math.min(1, Math.max(0, 1 - (deadline - performance.now()) / 3000));
            bgm.playbackRate = 1 - .65 * progress * progress;
            bgm.volume = sound.bgm * Math.pow(1 - progress, 1.7);
            defeatVeil.style.opacity = String(progress);
            defeatFrame = requestAnimationFrame(frame);
        };
        frame();
        defeatTimer = setTimeout(() => {
            resetDefeatPresentation();
            if (currentRoom?.id !== snap.id || currentRoom.state !== 'failed') return;
            syncBgm(currentRoom);
            playSfx('fail');
            renderPlayUI();
        }, remaining);
    }

    function hideBattleIntro() {
        clearTimeout(introTimer);
        introTimer = null;
        const root = $('#pqIntro');
        if (root) root.classList.remove('active');
    }

    function playBattleIntro(snap) {
        const root = $('#pqIntro');
        if (!root) return;
        clearTimeout(introTimer);
        $('#pqIntroQuest').textContent = snap.questName || '파티 퀘스트';
        const count = $('#pqIntroCount');
        root.classList.add('active');
        const seq = ['3', '2', '1', '전투 개시'];
        let i = 0;
        const step = () => {
            if (i >= seq.length) { hideBattleIntro(); return; }
            const v = seq[i++];
            count.textContent = v;
            count.classList.toggle('start', v === '전투 개시');
            count.classList.remove('pop');
            void count.offsetWidth;
            count.classList.add('pop');
            playSfx(v === '전투 개시' ? 'start' : 'count');
            introTimer = setTimeout(step, v === '전투 개시' ? 950 : 800);
        };
        // 페이드 인(.45s)이 자리잡은 뒤 카운트 시작
        introTimer = setTimeout(step, 450);
    }

    function maybePlayIntro(snap) {
        const prev = lastRoomState;
        lastRoomState = snap ? snap.state : null;
        if (!snap) return;
        if (snap.state === 'inProgress' && (prev === 'lobby' || prev === 'preparing')) playBattleIntro(snap);
        if (prev === 'inProgress' && (snap.state === 'cleared' || (snap.state === 'failed' && !defeatActive))) playSfx(snap.state === 'cleared' ? 'clear' : 'fail');
    }

    let phaseCut = null, phaseCutTimer = null;
    function isPhaseTransitionActive() {
        return currentRoom?.state === 'inProgress' && Number(currentRoom.phaseTransition?.endsAt || 0) + (cooldownClockOffset || 0) > Date.now();
    }
    function hidePhaseTransition() {
        clearTimeout(phaseCutTimer);
        phaseCutTimer = null;
        phaseCut?.remove(); phaseCut = null;
        document.querySelector('.pq-screen[data-screen="play"]')?.classList.remove('gate-transition');
    }
    function syncPhaseTransition(snap) {
        const transition = snap.phaseTransition;
        if (!isPhaseTransitionActive()) { hidePhaseTransition(); return; }
        if (phaseCut?.dataset.id === transition.id) return;
        hidePhaseTransition(); hideBattleIntro();
        const screen = document.querySelector('.pq-screen[data-screen="play"]');
        const stage = screen?.querySelector('.pq-game-stagewrap');
        if (!stage) return;
        screen.classList.add('gate-transition');
        $('#pqNoticeStack').replaceChildren();
        const elapsed = Math.max(0, Date.now() - Number(transition.startedAt) - (cooldownClockOffset || 0));
        phaseCut = el('div', { class: 'pq-gate-cut', 'data-id': transition.id, role: 'status', 'aria-label': transition.phaseName + ' ' + transition.toName });
        phaseCut.style.setProperty('--gate-offset', '-' + elapsed + 'ms');
        for (const [kind, image, background, scene] of [['prev', transition.fromImage, transition.fromBackground, transition.fromScene],
            ['next', transition.toImage, transition.toBackground, transition.toScene]]) {
            if (scene && background) phaseCut.append(el('div', { class: 'pq-gate-layer ' + kind }, renderRaidScene({ image, background, scene })));
            else if (image) phaseCut.append(el('img', { class: 'pq-gate-' + kind, src: image, alt: '', draggable: 'false' }));
        }
        phaseCut.append(el('i', { class: 'pq-gate-line', 'aria-hidden': 'true' }),
            el('div', { class: 'pq-gate-title' }, el('span', null, transition.phaseNumber + '관문'), el('b', null, transition.toName)));
        stage.append(phaseCut);
        syncRaidScenes();
        phaseCutTimer = setTimeout(() => {
            hidePhaseTransition();
            updateRaidPatterns();
            updateAttackBtn(); updateSkillPotionButtons(); updateSupportGauge();
        }, Math.max(0, Number(transition.endsAt) + (cooldownClockOffset || 0) - Date.now()));
    }
    function updateRaidPatterns() {
        if (!window.MansionRaidUI) return;
        const snap = currentRoom, monster = snap?.monster;
        const view = snap?.state !== 'inProgress' || isPhaseTransitionActive() ? null
            : monster?.mansion || (monster ? { generic: true, events: monster.patternEvents || [] } : null);
        if (!raidEffects && window.RaidPatternFX) raidEffects = RaidPatternFX.create($('#pqRaidFx'));
        const purification = snap?.state === 'inProgress' && snap.phaseType === 'mob' && !isPhaseTransitionActive()
            ? { progress: Math.min(1, (snap.sharedKillCount || 0) / Math.max(1, snap.killTarget)), complete: snap.sharedKillCount >= snap.killTarget } : null;
        raidEffects?.update(view, { scope: snap ? snap.id + ':' + snap.startedAt + ':' + snap.phaseIndex : '', volume: sound.sfx, purification });
        MansionRaidUI.update($('#pqMansionRoot'), view, { me: snap?.spectating ? '' : me, host: snap?.hostName, serverOffset: cooldownClockOffset || 0,
            readOnly: !!snap?.spectating, visualOnly: raidEffects?.visualOnly,
            send: snap?.spectating ? null : payload => api('/api/party/mansion-action', { method: 'POST', body: JSON.stringify(payload) }) });
    }

    // ====== 방 화면 ======
    function applyRoomSnapshot(snap) {
        const previous = currentRoom;
        if (previous?.id !== snap.id) {
            cooldownClockOffset = null; lastCooldownServerTime = 0; lastTickAt = 0;
            pendingCD.action = false; pendingCD.potion = false;
        }
        currentRoom = snap;
        $('#frame').classList.toggle('spectating', !!snap.spectating);
        const watchBadge = $('#pqSpectatorBadge');
        if (watchBadge) { watchBadge.hidden = !snap.spectating; watchBadge.textContent = '관전'; }
        $('#pqPlayLeave').textContent = snap.spectating ? '관전 종료' : '← 나가기';
        $('#pqLeave').textContent = snap.spectating ? '관전 종료' : '← 나가기';
        if (snap.spectating && previous?.id !== snap.id) showGameTab('log');
        if (snap.spectating && snap.combatLog) {
            const log = $('#pqCombatLog'), top = log.scrollTop;
            const stick = previous?.id !== snap.id || !log.closest('.pq-game-chat').classList.contains('open') || top + log.clientHeight >= log.scrollHeight - 12;
            log.replaceChildren(...snap.combatLog.map(entry => el('div', { class: 'ln ' + (entry.severity || 'info') }, entry.text)));
            if (stick) requestAnimationFrame(() => { if (currentRoom?.id === snap.id) log.scrollTop = log.scrollHeight; });
            else log.scrollTop = top;
        }
        syncDefeatPresentation(snap, previous);
        localBuffTickAt = Date.now();
        maybePlayIntro(snap);
        syncBgm(snap);
        $('#pqRoomQuestName').textContent = snap.questName || '';
        renderQuestInfo(snap);
        renderMembers(snap);
        renderPositions(snap);
        renderChat(snap.chat || []);
        renderRoomControls(snap);
        renderPotionSummary(snap);
        syncMyDeadlinesFromSnapshot(snap);
        syncPhaseTransition(snap);
        applyMyDeadlinesToRuntime();
        ensureLocalCdTimer();
        // 전투 화면
        renderPlayUI();
        // 선택지 모달
        const myMember = snap.members.find(m => m.name === me);
        if (snap.awaitingChoices && myMember && myMember.pendingChoices && myMember.pendingChoices.length) {
            openChoiceModal(myMember.pendingChoices);
        } else {
            $('#pqChoiceBg').classList.remove('active');
        }
    }

    // 스냅샷 정의 + 퀘스트 목록 정의(커버, 입장 조건) 병합
    function roomQuest(snap) {
        const def = snap.questDef || {};
        return Object.assign({}, questMeta(def.id || snap.questId) || {}, def);
    }

    let heroCoverSrc = null;
    function renderQuestInfo(snap) {
        const q = roomQuest(snap);
        const difficulty = questDifficulty(q.id || snap.questId);
        const hero = $('#pqRaidHero');
        if (hero) {
            hero.dataset.difficulty = difficulty;
            const tag = $('#pqRaidDiff');
            tag.dataset.difficulty = difficulty;
            tag.textContent = difficulty.toUpperCase();
            const src = coverUrl(q.coverImage);
            if (src !== heroCoverSrc) {
                heroCoverSrc = src;
                $('#pqRaidCover').replaceChildren(...(src ? [el('img', { src, alt: '', draggable: 'false', decoding: 'async', onError: e => e.currentTarget.remove() })] : []));
            }
            const lv = q.minLevel || q.level;
            const power = q.recommendedPower || q.power;
            const facts = [];
            if (lv) facts.push(['입장', 'Lv.' + lv]);
            if (power) facts.push(['권장 전투력', Number(power).toLocaleString()]);
            if (q.maxPlayers) facts.push(['인원', (q.minPlayers || 1) + '~' + q.maxPlayers + '인']);
            $('#pqRaidFacts').replaceChildren(...facts.map(([k, v]) => el('span', null, el('i', null, k), v)));
        }
        const host = $('#pqRoomHost');
        if (host) host.textContent = snap.hostName ? snap.hostName + '님의 파티' : '';
        const box = $('#pqQuestInfo');
        box.replaceChildren();
        if (!snap.questDef) {
            box.append(el('p', null, '진행 중인 퀘스트입니다.'));
            return;
        }
        if (q.description) box.append(el('p', null, q.description));
        const phases = q.phases || [];
        if (phases.length) box.append(el('ol', { class: 'pq-phase-route' },
            ...phases.map((p, i) => el('li', { 'data-type': p.type || '' }, el('b', null, String(i + 1)), p.name))));
    }

    // 파티원+카드 URL → img. 스냅샷마다 초상화를 다시 요청하지 않도록 노드를 재사용 (실패 시 null)
    const portraitCache = new Map();
    function slotPlaceholder(m) {
        return el('span', { class: 'pq-slot-ph' }, (m.name || '?').slice(0, 1));
    }
    function slotPortrait(m, key) {
        let img = key ? portraitCache.get(key) : null;
        if (key && img === undefined) {
            const node = el('img', { src: m.card.imageUrl, alt: m.card.name || '', draggable: 'false', decoding: 'async' });
            node.addEventListener('error', () => {
                portraitCache.set(key, null);
                node.replaceWith(slotPlaceholder(m));
            });
            portraitCache.set(key, node);
            img = node;
        }
        return img || slotPlaceholder(m);
    }

    function renderMembers(snap) {
        const root = $('#pqMemberList');
        const members = snap.members || [];
        const slots = Math.max(members.length, Number(roomQuest(snap).maxPlayers || 0), 1);
        root.style.setProperty('--slots', String(slots));
        const used = new Set();
        const cards = members.map(m => {
            const isHost = m.name === snap.hostName;
            const key = m.card && m.card.imageUrl ? m.name + '|' + m.card.imageUrl : '';
            if (key) used.add(key);
            const art = el('div', { class: 'pq-slot-art' }, slotPortrait(m, key));
            if (m.card) {
                art.append(el('span', { class: 'pq-slot-star' }, formatCardStar(m.card.star)));
            }
            if (isHost) art.append(el('span', { class: 'pq-slot-lead' }, '공대장'));
            if (m.card) art.append(el('span', { class: 'pq-slot-card' }, el('span', null, m.card.name || ''), m.card.type ? el('i', null, m.card.type) : null));
            const state = !m.online ? ['off', '오프라인'] : m.ready ? ['ready', '준비 완료'] : ['wait', '준비 전'];
            return el('div', { class: 'pq-slot ' + state[0] + (isHost ? ' host' : '') + (m.name === me ? ' me' : '') },
                art,
                el('div', { class: 'pq-slot-plate' },
                    el('div', { class: 'pq-slot-name' }, titleImg(m.title), el('span', { class: 't', title: m.name }, m.name)),
                    el('div', { class: 'pq-slot-sub' },
                        el('span', null, 'Lv.' + (m.level || 1)),
                        snap.noPositions ? null : el('span', { class: 'pos' + (m.position ? ' set' : '') }, m.position || '미선택')
                    )
                ),
                el('div', { class: 'pq-slot-state' }, state[1])
            );
        });
        for (let i = members.length; i < slots; i++) {
            cards.push(el('div', { class: 'pq-slot empty' },
                el('div', { class: 'pq-slot-art' }, el('span', { class: 'pq-slot-ph' }, '빈 자리')),
                el('div', { class: 'pq-slot-state' }, '모집 중')));
        }
        for (const key of portraitCache.keys()) if (!used.has(key)) portraitCache.delete(key);
        root.replaceChildren(...cards);
        const count = $('#pqPartyCount');
        if (count) count.textContent = members.length + ' / ' + slots;
    }

    function renderPositions(snap) {
        const panel = $('#pqPositionPanel');
        if (panel) panel.style.display = snap.noPositions ? 'none' : '';
        if (snap.noPositions) return;
        const grid = $('#pqPositionGrid');
        grid.replaceChildren();
        const myMember = snap.members.find(m => m.name === me);
        const myPos = myMember && myMember.position;
        const owners = {};
        snap.members.forEach(m => { if (m.name !== me && m.position) owners[m.position] = m.name; });
        for (const pos of (snap.positions || [])) {
            const isMine = pos === myPos;
            const isTaken = pos in owners;
            const btn = el('button', {
                type: 'button',
                class: 'pq-position-btn' + (isMine ? ' active' : '') + (isTaken && !isMine ? ' taken' : ''),
                disabled: isTaken && !isMine ? true : false,
                onClick: async () => {
                    try {
                        const next = isMine ? '' : pos;
                        await api('/api/party/position', { method: 'POST', body: JSON.stringify({ position: next }) });
                    } catch (e) { toast(e.message); }
                }
            }, el('span', null, pos), isTaken && !isMine ? el('small', null, owners[pos]) : null);
            grid.append(btn);
        }
        const detail = $('#pqPositionDetail');
        if (myPos && POS_DETAILS[myPos]) {
            detail.style.display = 'grid';
            detail.replaceChildren(...POS_DETAILS[myPos].map(line => el('div', null, line)));
        } else {
            detail.style.display = 'none';
        }
    }

    function renderChat(chatList) {
        const lobbyChat = $('#pqChat');
        const playChat = $('#pqPlayChat');
        const build = root => {
            root.replaceChildren();
            for (const c of chatList) {
                root.append(el('div', { class: 'pq-chat-line' },
                    el('span', { class: 'from' }, c.from + ':'),
                    c.text
                ));
            }
            root.scrollTop = root.scrollHeight;
        };
        if (lobbyChat) build(lobbyChat);
        if (playChat) build(playChat);
    }

    function appendChat(entry) {
        for (const root of [$('#pqChat'), $('#pqPlayChat')]) {
            if (!root) continue;
            root.append(el('div', { class: 'pq-chat-line' },
                el('span', { class: 'from' }, entry.from + ':'),
                entry.text
            ));
            root.scrollTop = root.scrollHeight;
        }
    }

    function appendCombat(entry) {
        const log = $('#pqCombatLog');
        if (!log) return;
        const ln = el('div', { class: 'ln ' + (entry.severity || 'info') }, entry.text);
        // 접힌 오버레이에선 스크롤 조작이 불가능하므로 항상 바닥 고정 (펼침 상태에서만 stick 판정)
        const box = log.closest('.pq-game-chat');
        const collapsed = box && !box.classList.contains('open');
        const shouldStick = collapsed || log.scrollTop + log.clientHeight >= log.scrollHeight - 12;
        log.append(ln);
        while (log.childElementCount > 120) log.firstElementChild.remove();
        if (shouldStick) log.scrollTop = log.scrollHeight;
        const resultLog = $('#pqResultLog');
        if (resultLog) {
            const stick = resultLog.scrollTop + resultLog.clientHeight >= resultLog.scrollHeight - 12;
            resultLog.append(el('div', { class: 'ln ' + (entry.severity || 'info') }, entry.text));
            while (resultLog.childElementCount > 120) resultLog.firstElementChild.remove();
            if (stick) resultLog.scrollTop = resultLog.scrollHeight;
        }
    }

    function renderRoomControls(snap) {
        const myMember = snap.members.find(m => m.name === me);
        const isHost = snap.hostName === me;
        const readyBtn = $('#pqReadyBtn');
        readyBtn.hidden = !!snap.spectating;
        const startBtn = $('#pqStartBtn');
        if (myMember) {
            readyBtn.textContent = myMember.ready ? '준비 해제' : '준비';
            readyBtn.classList.toggle('primary', !myMember.ready);
            readyBtn.disabled = !snap.noPositions && !myMember.position;
        }
        const allReady = snap.members.length > 0 && snap.members.every(m => (snap.noPositions || m.position) && m.ready);
        startBtn.style.display = isHost ? 'inline-flex' : 'none';
        startBtn.disabled = !allReady;
        const status = $('#pqRoomStatus');
        if (status) {
            const readyCount = snap.members.filter(m => m.ready).length;
            let hint = '';
            if (myMember && !snap.noPositions && !myMember.position) hint = '포지션을 선택하세요';
            else if (isHost) hint = allReady ? '시작 가능' : '전원 준비 시 시작';
            else if (myMember && myMember.ready) hint = '공대장 시작 대기';
            status.replaceChildren(el('b', null, '준비 ' + readyCount + ' / ' + snap.members.length), hint ? el('span', null, hint) : null);
        }
    }

    function showRoomScreenForState() {
        if (!currentRoom) { showScreen('lobby'); return; }
        if (currentRoom.state === 'inProgress' || currentRoom.state === 'cleared' || currentRoom.state === 'failed') {
            showScreen('play');
        } else {
            showScreen('room');
        }
    }

    // ====== 전투 화면 렌더 ======
    function renderPlayUI() {
        if (!currentRoom) return;
        const snap = currentRoom;
        const ended = !defeatActive && (snap.state === 'cleared' || snap.state === 'failed');
        const playScreen = document.querySelector('.pq-screen[data-screen="play"]');
        if (playScreen) {
            playScreen.classList.add('raid-dock');
            playScreen.classList.toggle('result-mode', ended);
            playScreen.classList.toggle('spectate', !!snap.spectating);
            playScreen.dataset.support = (snap.supportSkills || []).length ? '1' : '';
        }
        $('#pqPhaseLabel').textContent = snap.phaseType === 'mob' ? '정화' : snap.phaseType ? snap.phaseType.toUpperCase() : 'PHASE';
        $('#pqPhaseName').textContent = snap.phaseName || '-';

        const stage = $('#pqPhaseStage');
        stage.style.backgroundImage = snap.monster?.background || snap.phaseArtwork?.background ? ''
            : 'url(' + JSON.stringify(coverUrl(roomQuest(snap).coverImage)) + ')';
        const actionRow = $('#pqActionRow');
        if (actionRow) actionRow.style.display = ended || defeatActive || snap.spectating ? 'none' : '';
        if (defeatActive) {
            updateEnrageLabel(null);
        } else if (ended) {
            bossStageSig = '';
            updateEnrageLabel(null);
            stage.replaceChildren(renderResult(snap));
        } else if (snap.phaseType === 'mob') {
            bossStageSig = '';
            updateEnrageLabel(null);
            if (!document.getElementById('pqMobStage')) stage.replaceChildren(renderMobStage(snap));
            else updateMobStage(snap);
        } else if (snap.phaseType === 'elite' || snap.phaseType === 'boss') {
            if (!snap.monster) { bossStageSig = ''; updateEnrageLabel(null); stage.replaceChildren(); }
            else if (!document.getElementById('pqBossStage') || bossStageSig !== bossStageSigOf(snap.monster)) stage.replaceChildren(renderBossStage(snap));
            else updateBossStage(snap);
        } else {
            bossStageSig = '';
            updateEnrageLabel(null);
            stage.replaceChildren();
        }

        syncRaidScenes();
        updateRaidPatterns();
        syncVoteModal(snap);
        renderSupportBar(snap);
        renderPlayMembers(snap);
        renderSkillBar(snap);
        renderPotionBar(snap);
        if (!snap.spectating && snap.state === 'cleared' && snap.result && Array.isArray(snap.result.rewards) && snap.result.rewards.length && shownRewardRoomId !== snap.id) {
            shownRewardRoomId = snap.id;
            openRewardModal(snap.result.rewards);
            const mine = snap.result.rewards.find(rv => rv.name === me);
            if (mine && mine.firstClear) openFirstClearModal(mine.firstClear);
        }
    }

    function renderResult(snap) {
        const r = snap.result || {};
        const cls = r.cleared ? 'cleared' : 'failed';
        const wrap = el('div', { class: 'pq-panel pq-result ' + cls });
        wrap.append(el('div', { class: 'pq-result-head' },
            el('div', { class: 'big' }, r.cleared ? '클리어' : '실패'),
            el('div', { class: 'pq-result-reason' }, r.reason || '')
        ));
        if (r.statistics) wrap.append(renderBattleGraph(r.statistics));
        const log = el('div', { id: 'pqResultLog', class: 'pq-combat-log pq-result-log-lines', role: 'log', 'aria-label': '전투 로그' },
            ...(snap.combatLog || []).map(entry => el('div', { class: 'ln ' + (entry.severity || 'info') }, entry.text)));
        wrap.append(el('details', { class: 'pq-result-log', open: !r.cleared }, el('summary', null, '전투 로그'), log));
        const footer = el('div', { class: 'pq-result-footer' });
        if (r.cleared && r.rewards && r.rewards.length) {
            footer.append(el('button', { class: 'pq-btn primary', type: 'button', onClick: () => openRewardModal(r.rewards) }, '파티 보상 확인'));
        } else if (r.cleared && !snap.spectating) {
            footer.append(el('div', { class: 'pq-result-reward-wait' }, '보상 지급 중...'));
        }
        if (!snap.spectating && snap.hostName === me) {
            const btn = el('button', { class: 'pq-btn', type: 'button' }, '다시 도전');
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const res = await fetch('/api/party/restart', { method: 'POST' });
                    const data = await res.json();
                    if (data.error) { showAlert(data.error); btn.disabled = false; }
                } catch (_) { btn.disabled = false; }
            });
            footer.append(btn);
        }
        if (footer.childElementCount) wrap.append(footer);
        return wrap;
    }

    function battleNumber(value) {
        return Math.max(0, Math.round(Number(value || 0))).toLocaleString();
    }

    function battleDuration(seconds) {
        const total = Math.max(0, Math.round(Number(seconds || 0)));
        const minutes = Math.floor(total / 60);
        const remain = total % 60;
        return minutes > 0 ? minutes + '분 ' + remain + '초' : remain + '초';
    }

    function renderBattleGraph(statistics) {
        const members = Array.isArray(statistics.members) ? statistics.members : [];
        if (!members.length) return el('div', { class: 'pq-battle-empty' }, '전투 통계가 없습니다.');
        const maxDamage = Math.max(...members.map(member => Number(member.damage || 0)), 1);
        const totalDamage = members.reduce((sum, member) => sum + Number(member.damage || 0), 0);
        const root = el('div', { class: 'pq-battle-stats simple' });
        root.append(el('div', { class: 'pq-battle-title' },
            el('div', null, el('span', null, 'BATTLE REPORT'), el('h3', null, '딜량 그래프')),
            el('b', null, battleDuration(statistics.durationSeconds))
        ));
        const graph = el('div', { class: 'pq-damage-graph' });
        members.forEach((member, index) => {
            const card = member.card || {};
            const portrait = el('div', { class: 'pq-damage-portrait' });
            if (card.imageUrl) portrait.append(el('img', { src: card.imageUrl, alt: card.name || member.name || '' }));
            else portrait.append(el('span', null, String(index + 1)));
            const share = totalDamage > 0 ? Number(member.damage || 0) / totalDamage * 100 : 0;
            graph.append(el('div', { class: 'pq-damage-player' },
                portrait,
                el('div', { class: 'pq-damage-player-body' },
                    el('div', { class: 'pq-damage-player-head' },
                        el('div', null, el('strong', null, member.name || '-'), el('span', null, member.position || '파티원')),
                        el('b', null, battleNumber(member.damage))
                    ),
                    el('div', { class: 'pq-damage-track' },
                        el('i', { style: 'width:' + Math.max(0, Number(member.damage || 0) / maxDamage * 100).toFixed(2) + '%' })
                    ),
                    el('div', { class: 'pq-damage-share' }, '딜 기여도 ' + share.toFixed(1) + '%'),
                    el('div', { class: 'pq-damage-secondary' },
                        el('span', null, '받은 피해 ', el('b', null, battleNumber(member.damageTaken))),
                        el('span', null, '감소한 피해 ', el('b', null, battleNumber(member.damageReduced))),
                        el('span', null, '아군 회복 ', el('b', null, battleNumber(member.allyHealing)))
                    )
                )
            ));
        });
        root.append(graph);
        return root;
    }

    function frameImageUrl(file) {
        return '/item-image?dir=' + encodeURIComponent('프레임') + '&file=' + encodeURIComponent(file);
    }

    // 보상 한 줄: 아이템 아트 + 이름 + 수량. frameUrl이 없으면 defaultFrame, 화폐는 프레임 없이 아이콘만
    function lootRow(it, defaultFrame, amount) {
        const art = el('div', { class: 'pq-loot-art' });
        const currency = it.kind === 'currency' ? it.currency : it.kind;
        const currencyName = { gold: '골드', garnet: '가넷', mileage: '마일리지' }[currency];
        const fallback = () => el('span', { class: 'pq-loot-fallback' }, currencyName ? { gold: '🪙', garnet: '💎', mileage: 'Ⓜ' }[currency] : it.kind === 'title' ? '🏆' : '🎁');
        const imageError = e => e.currentTarget.replaceWith(fallback());
        if (currencyName) {
            art.append(el('img', { class: 'pq-loot-icon currency', src: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent(currencyName + '.png'), alt: '', onError: imageError }));
        } else {
            const frame = it.frameUrl || defaultFrame;
            if (frame) art.append(el('img', { class: 'pq-loot-frame', src: frame, alt: '' }));
            if (it.iconUrl) art.append(el('img', { class: 'pq-loot-icon', src: it.iconUrl, alt: '', onError: imageError }));
            else art.append(fallback());
        }
        return el('div', { class: 'pq-loot-row' + (it.bonus ? ' bonus' : '') },
            art,
            el('div', { class: 'pq-loot-name' },
                it.kind === 'title' ? '칭호 「' + (it.name || '') + '」' : (it.name || '-'),
                it.bonus ? el('span', { class: 'pq-loot-tag' }, '추가 보상') : null),
            amount ? el('b', { class: 'pq-loot-qty' }, amount) : null
        );
    }

    function rewardItems(rv) {
        if (currentRoom?.questId === 'mansionNightmare' && rv.firstClear) return rv.firstClear.rewards || [];
        // 부타게임은 기본 보상 여러 개 + 추가 보상 1개 → items 배열, 그 외는 단일 item
        return Array.isArray(rv.items) && rv.items.length ? rv.items : (rv.item ? [rv.item] : []);
    }

    function rewardAmount(item) {
        if (item.kind === 'title') return '획득';
        const currency = item.kind === 'currency' || item.kind === 'gold' || item.kind === 'garnet';
        return (currency ? '+' : '×') + Number(item.count || 1).toLocaleString();
    }

    function rewardBody(rv) {
        const list = rewardItems(rv);
        const body = el('div', { class: 'pq-loot-body' });
        if (rv.weeklyLocked) body.append(el('div', { class: 'pq-loot-note warn' }, '이번 주 보상 횟수를 모두 사용했습니다.'));
        if (rv.error) body.append(el('div', { class: 'pq-loot-note error' }, String(rv.error)));
        if (list.length) {
            body.append(el('div', { class: 'pq-loot-items' }, ...list.map(raw => {
                const item = raw || {};
                const frame = frameImageUrl(Number(item.rewardIndex || 0) === 1 ? '특수.png' : '아이템.png');
                return lootRow(item, frame, rewardAmount(item));
            })));
        } else if (!rv.weeklyLocked && !rv.error) {
            body.append(el('div', { class: 'pq-loot-note empty' }, currentRoom?.questId === 'mansionNightmare'
                ? '나이트메어는 최초 클리어 보상만 지급됩니다.' : '보상 없음'));
        }
        const chips = [];
        if (rv.exp) chips.push(['XP', '+' + Number(rv.exp).toLocaleString()]);
        if (rv.gold) chips.push(['골드', '+' + Number(rv.gold).toLocaleString()]);
        if (rv.levelUps) chips.push(['레벨업', '+' + rv.levelUps]);
        if (chips.length) body.append(el('div', { class: 'pq-loot-chips' }, ...chips.map(([k, v]) => el('span', { class: 'pq-loot-chip' }, k + ' ', el('b', null, v)))));
        return body;
    }

    function openRewardModal(rewards) {
        const all = (rewards || []).slice().sort((a, b) => (b.name === me) - (a.name === me));
        const root = $('#pqRewardList');
        root.replaceChildren();
        const solo = all.length === 1 && all[0].name === me;
        $('#pqRewardSummary').textContent = all.length > 1 ? '파티원별 획득 보상' : '획득 보상';
        all.forEach(rv => {
            if (solo) { root.append(rewardBody(rv)); return; }
            const isMe = rv.name === me;
            const count = rewardItems(rv).length;
            const state = rv.weeklyLocked ? '주간 한도' : rv.error ? '오류' : count ? '보상 ' + count + '개' : '보상 없음';
            root.append(el('details', { class: 'pq-loot-member' + (isMe ? ' me' : ''), open: isMe ? '' : false },
                el('summary', null,
                    el('span', { class: 'who' }, (rv.name || '-') + (isMe ? ' (나)' : '')),
                    el('span', { class: 'state' }, state)),
                rewardBody(rv)
            ));
        });
        root.scrollTop = 0;
        $('#pqRewardBg').classList.add('active');
    }

    function openFirstClearModal(fc) {
        if (!fc) return;
        const titleEl = $('#pqFirstClearTitle');
        if (titleEl) titleEl.textContent = (fc.questName || '') + ' 최초 클리어';
        const root = $('#pqFirstClearList');
        root.replaceChildren();
        (fc.rewards || []).forEach(rw => {
            root.append(lootRow(rw, rw.kind === 'item' ? frameImageUrl('아이템.png') : null, rewardAmount(rw)));
        });
        root.scrollTop = 0;
        $('#pqFirstClearBg').classList.add('active');
    }

    // 배경과 전경은 같은 원본 좌표에서 함께 확대/잘라낸다. 별도 contain 배치로 구도가 어긋나지 않게 한다.
    function renderRaidScene(art, boss = false, name = '') {
        const plane = el('div', { class: 'pq-scene-plane', 'data-aspect': art.scene.aspect });
        if (art.scene.alignY === 0) { plane.style.top = '0'; plane.style.transform = 'translateX(-50%)'; }
        if (art.background) plane.append(el('img', { class: 'pq-stage-background', src: art.background, alt: '', draggable: 'false' }));
        if (art.image) {
            const subject = art.scene.subject || [0, 0, 1, 1];
            const foreground = el('div', { id: boss ? 'pqBossIllust' : null, class: 'pq-stage-illust pq-scene-foreground',
                'data-framed': art.scene.framed === false ? '0' : '1' });
            if (art.scene.framed === false) {
                foreground.style.cssText = 'left:' + subject[0] * 100 + '%;top:' + subject[1] * 100 + '%;width:' + subject[2] * 100 + '%;height:' + subject[3] * 100 + '%';
            }
            foreground.append(el('img', { id: boss ? 'pqBossIllustImg' : null, src: art.image, alt: name, draggable: 'false',
                'data-sprite': '1', 'data-subject': art.scene.framed === false ? '[0,0,1,1]' : JSON.stringify(subject) }));
            plane.append(foreground);
        }
        return plane;
    }

    function syncRaidScenes() {
        const stage = $('#pqPhaseStage');
        if (!sceneObserver && window.ResizeObserver) { sceneObserver = new ResizeObserver(syncRaidScenes); sceneObserver.observe(stage); }
        document.querySelector('.pq-game-stagewrap').querySelectorAll('.pq-scene-plane').forEach(plane => {
            const parent = plane.parentElement, aspect = Number(plane.dataset.aspect);
            const width = Math.max(parent.clientWidth, parent.clientHeight * aspect);
            plane.style.width = width + 'px'; plane.style.height = width / aspect + 'px';
        });
    }

    function renderMobStage(snap) {
        const wrap = el('div', { id: 'pqMobStage', class: 'pq-stage-mob' });
        if (snap.phaseArtwork?.background) wrap.append(renderRaidScene(snap.phaseArtwork));
        const hud = el('div', { class: 'pq-purification-hud' }, el('div', { class: 'lbl' }, '어둠 정화'), el('div', { id: 'pqMobCount', class: 'n' }));
        const bar = el('div', { class: 'pq-prog gauge' }, el('div', { id: 'pqMobBarFill', class: 'fill' }));
        hud.append(bar); wrap.append(hud);
        const pct = Math.min(100, (snap.sharedKillCount || 0) / Math.max(1, snap.killTarget) * 100);
        hud.querySelector('.n').textContent = pct.toFixed(1) + '%';
        bar.firstChild.style.width = pct + '%';
        updateAttackBtn();
        return wrap;
    }

    function updateMobCounter(total, target) {
        const c = document.getElementById('pqMobCount');
        const f = document.getElementById('pqMobBarFill');
        if (c) c.textContent = Math.min(100, (total || 0) / Math.max(1, target) * 100).toFixed(1) + '%';
        if (f) f.style.width = Math.min(100, (target > 0 ? (total / target) : 0) * 100) + '%';
        updateRaidPatterns();
    }

    function updateMobStage(snap) {
        updateMobCounter(snap.sharedKillCount, snap.killTarget);
        updateAttackBtn();
    }

    function updateBossStage(snap) {
        if (snap.monster) updateBossMonster(snap.monster);
        updateAttackBtn();
    }

    function hpPct(r) {
        return r && r.hpMax > 0 ? Math.max(0, Math.min(100, r.hp / r.hpMax * 100)) : 0;
    }

    // HP바 — 보호막은 LoL식으로 체력 위에 흰색 세그먼트로 얹는다.
    // 체력+보호막이 최대치를 넘으면 총합 기준으로 스케일.
    function makeHpBar(r, className) {
        const bar = el('div', { class: 'pq-prog hp' + (className ? ' ' + className : '') }, el('div', { class: 'fill' }));
        const hp = Math.max(0, Number(r && r.hp || 0));
        const max = Math.max(1, Number(r && r.hpMax || 1));
        const shield = Math.max(0, Number(r && r.shield || 0));
        const total = Math.max(max, hp + shield);
        bar.firstChild.style.width = (hp / total * 100) + '%';
        if (shield > 0) {
            const sf = el('div', { class: 'shield-fill' });
            sf.style.left = (hp / total * 100) + '%';
            sf.style.width = (shield / total * 100) + '%';
            bar.append(sf);
        }
        return bar;
    }

    function makeMpBar(r, className) {
        const mp = el('div', { class: 'pq-prog mp' + (className ? ' ' + className : '') }, el('div', { class: 'fill' }));
        mp.firstChild.style.width = (r && r.mpMax > 0 ? Math.max(0, Math.min(100, r.mp / r.mpMax * 100)) : 0) + '%';
        return mp;
    }

    function showDamagePop(payload) {
        const details = Array.isArray(payload.hitDetails) ? payload.hitDetails.filter(h => Number(h && h.damage || 0) > 0) : [];
        if (details.length > 1) {
            details.forEach((hit, index) => {
                setTimeout(() => showSingleDamagePop(Object.assign({}, payload, {
                    damage: hit.damage,
                    fixedDamage: hit.fixedDamage || 0,
                    destinyDamage: hit.destinyDamage || 0,
                    crit: !!hit.crit,
                    comboLastCrit: !!hit.comboLastCrit,
                    kills: index === details.length - 1 ? payload.kills : 0,
                    skill: index === details.length - 1 ? payload.skill : null,
                    comboIndex: index + 1,
                    comboTotal: details.length
                })), index * 115);
            });
            return;
        }
        showSingleDamagePop(payload);
    }

    function showSingleDamagePop(payload) {
        const illustHost = document.getElementById('pqBossIllust');
        const host = illustHost || document.getElementById('pqMobStage') || document.getElementById('pqBossStage');
        if (!host) return;
        const isMe = payload.by === me;
        const hasFixed = Number(payload.fixedDamage || 0) > 0;
        const hasDestiny = Number(payload.destinyDamage || 0) > 0;
        const cls = 'pq-dmg-pop' + (payload.crit ? ' crit' : '') + ((hasFixed || hasDestiny) ? ' fixed' : '') + (isMe ? '' : ' other');
        const pop = el('div', { class: cls });
        if (!isMe) pop.append(el('span', { class: 'by' }, payload.by));
        const main = document.createElement('span');
        main.textContent = '-' + Number(payload.damage || 0).toLocaleString();
        pop.append(main);
        if (payload.comboTotal > 1) pop.append(el('span', { class: 'sub combo-label' }, payload.comboIndex + '/' + payload.comboTotal + ' HIT'));
        if (payload.comboLastCrit) pop.append(el('span', { class: 'sub combo-label' }, '최대 연격'));
        if (payload.kills > 1) pop.append(el('span', { class: 'sub' }, '정화 +' + (payload.kills / Math.max(1, payload.target || currentRoom?.killTarget) * 100).toFixed(1) + '%'));
        else if (payload.skill) pop.append(el('span', { class: 'sub' }, payload.skill));
        if (hasFixed) pop.append(el('span', { class: 'sub fixed-label' }, '고정 ' + Number(payload.fixedDamage || 0).toLocaleString()));
        if (hasDestiny) pop.append(el('span', { class: 'sub fixed-label' }, '운명 ' + Number(payload.destinyDamage || 0).toLocaleString()));
        const subject = illustHost ? JSON.parse($('#pqBossIllustImg')?.dataset.subject || '[0,0,1,1]') : null;
        const offsetX = subject ? (subject[0] + subject[2] * (.35 + Math.random() * .3)) * 100 : (50 + Math.random() * 30 - 15);
        const offsetY = subject ? (subject[1] + subject[3] * (.25 + Math.random() * .35)) * 100 : null;
        pop.style.left = offsetX + '%';
        if (offsetY !== null) pop.style.top = offsetY + '%';
        host.append(pop);
        setTimeout(() => { if (pop.parentNode) pop.parentNode.removeChild(pop); }, 1000);
        playSfx(payload.crit ? 'crit' : 'hit');
        // 피격 셰이크 — 보스 일러스트를 잠깐 흔든다
        const bossImg = document.getElementById('pqBossIllustImg');
        if (bossImg) {
            bossImg.classList.remove('shake');
            void bossImg.offsetWidth;
            bossImg.classList.add('shake');
        }
        if (isMe) {
            const btn = document.getElementById('pqAttackBtn');
            if (btn) {
                btn.classList.add('flash');
                setTimeout(() => btn.classList.remove('flash'), 120);
            }
        }
    }

    function bossStageSigOf(m) {
        return m ? (m.name || '') + '|' + (m.image || '') + '|' + (m.background || '') : '';
    }

    const BOSS_HP_LINE_SIZE = 10000;

    function bossHpLayerState(m) {
        const hp = Math.max(0, Number(m.hp || 0));
        const configuredLines = Math.max(0, Number(m.hpLines || 0));
        if (configuredLines <= 0) return { layered: false, hp, lines: 0, current: hp };
        if (hp <= 0) return { layered: true, hp: 0, lines: 0, current: 0 };
        const lines = Math.min(configuredLines, Math.max(0, Math.ceil(hp / BOSS_HP_LINE_SIZE) - 1));
        return {
            layered: true,
            hp,
            lines,
            current: Math.max(1, hp - lines * BOSS_HP_LINE_SIZE)
        };
    }

    // hpLines 보스는 1만 단위의 현재 층만 표시하고, 뒤에 남은 층을 다른 색으로 비친다.
    function applyBossHpWidths(m, fillEl, shieldEl, backEl) {
        fillEl = fillEl || document.getElementById('pqBossHpFill');
        shieldEl = shieldEl || document.getElementById('pqBossShieldFill');
        backEl = backEl || document.getElementById('pqBossHpBack');
        if (!fillEl) return;
        const state = bossHpLayerState(m);
        const hp = state.hp;
        const max = Math.max(1, Number(m.hpMax || 1));
        const shield = Math.max(0, Number(m.shield || 0));
        const bar = fillEl.parentElement;
        if (bar) {
            bar.classList.toggle('layered', state.layered);
            bar.dataset.layerTone = String(state.lines % 4);
            bar.dataset.backTone = String(Math.max(0, state.lines - 1) % 4);
        }
        if (backEl) backEl.style.display = state.layered && state.lines > 0 ? '' : 'none';

        const hpPct = state.layered ? (state.current / BOSS_HP_LINE_SIZE * 100) : (hp / max * 100);
        fillEl.style.width = Math.max(0, Math.min(100, hpPct)) + '%';
        if (shieldEl) {
            if (state.layered) {
                const shieldPct = Math.min(100, shield / BOSS_HP_LINE_SIZE * 100);
                shieldEl.style.left = shieldPct >= 100 ? '0%' : Math.min(100, hpPct) + '%';
                shieldEl.style.width = shieldPct >= 100 ? '100%' : Math.min(shieldPct, Math.max(0, 100 - hpPct)) + '%';
            } else {
                const total = Math.max(max, hp + shield);
                shieldEl.style.left = (hp / total * 100) + '%';
                shieldEl.style.width = (shield / total * 100) + '%';
            }
            shieldEl.style.display = shield > 0 ? '' : 'none';
        }
    }

    // HP바 안 중앙에 들어가는 수치
    function bossHpText(m) {
        return Number(m.hp || 0).toLocaleString() + ' / ' + Number(m.hpMax || 0).toLocaleString();
    }

    // hpLines가 있으면 현재 1만 HP 층 뒤에 남은 체력바 수를 표시한다.
    function bossHpLinesText(m) {
        const state = bossHpLayerState(m);
        if (!state.layered) return '';
        return '×' + state.lines;
    }

    function updateEnrageLabel(m) {
        const node = document.getElementById('pqEnrage');
        if (!node) return;
        if (m && m.enraged) {
            node.style.display = '';
            node.classList.add('urgent');
            node.textContent = '광폭화!';
        } else if (m && m.enrageRemain != null) {
            const s = Math.max(0, Math.round(Number(m.enrageRemain || 0)));
            node.style.display = '';
            node.classList.toggle('urgent', s < 60);
            node.textContent = '광폭화까지 ' + String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
        } else {
            node.style.display = 'none';
            node.classList.remove('urgent');
        }
    }

    function renderBossStage(snap) {
        const m = snap.monster;
        if (!m) return el('div');
        bossStageSig = bossStageSigOf(m);
        const hasIllust = !!m.image;
        const wrap = el('div', { id: 'pqBossStage', class: 'pq-stage-boss' + (hasIllust ? '' : ' no-illust') });
        if (m.scene) { wrap.classList.add('registered-scene'); wrap.append(renderRaidScene(m, true, m.name)); }
        else if (hasIllust) {
            const illustWrap = el('div', { id: 'pqBossIllust', class: 'pq-stage-illust' });
            illustWrap.append(el('img', { id: 'pqBossIllustImg', src: m.image, alt: m.name, draggable: 'false', 'data-sprite': m.sprite ? '1' : '' }));
            wrap.append(illustWrap);
        }
        const hud = el('div', { class: 'pq-stage-hud' });
        hud.append(el('div', { class: 'pq-boss-head' },
            el('div', { class: 'pq-boss-name' }, m.name, el('span', { id: 'pqBossStun', style: Number(m.stunRemain || 0) > 0 ? 'margin-left:8px;color:#fbbf24;font-size:12px' : 'display:none' }, Number(m.stunRemain || 0) > 0 ? ('기절 ' + Number(m.stunRemain || 0).toFixed(1) + 's') : ''))
        ));
        const linesText = bossHpLinesText(m);
        const hpBar = el('div', { class: 'pq-prog hp pq-boss-hpbar' },
            el('div', { id: 'pqBossHpBack', class: 'pq-hp-layer-back', style: 'display:none' }),
            el('div', { id: 'pqBossHpFill', class: 'fill' }),
            el('div', { id: 'pqBossShieldFill', class: 'shield-fill', style: 'display:none' }),
            el('div', { id: 'pqBossHpVal', class: 'pq-hp-text' }, bossHpText(m)),
            el('div', { id: 'pqBossHpLines', class: 'pq-hp-lines', style: linesText ? '' : 'display:none' }, linesText)
        );
        applyBossHpWidths(m, hpBar.querySelector('.fill'), hpBar.querySelector('.shield-fill'), hpBar.querySelector('.pq-hp-layer-back'));
        hud.append(hpBar);
        const gBar = el('div', { class: 'pq-prog gauge' }, el('div', { id: 'pqBossGaugeFill', class: 'fill' }));
        gBar.firstChild.style.width = (m.gauge || 0) + '%';
        hud.append(gBar);
        wrap.append(hud);
        updateEnrageLabel(m);
        updateAttackBtn();
        return wrap;
    }

    function updateBossMonster(monster) {
        if (!monster) return;
        updateRaidPatterns();
        updateEnrageLabel(monster);
        // 폭주 모드 등으로 일러스트/이름이 바뀌면 스테이지를 다시 그린다
        const sig = bossStageSigOf(monster);
        if (bossStageSig && bossStageSig !== sig && currentRoom) {
            const stage = document.getElementById('pqPhaseStage');
            if (stage && document.getElementById('pqBossStage')) {
                stage.replaceChildren(renderBossStage(currentRoom));
                syncRaidScenes();
                return;
            }
        }
        applyBossHpWidths(monster);
        const hpVal = document.getElementById('pqBossHpVal');
        const gaugeFill = document.getElementById('pqBossGaugeFill');
        const stun = document.getElementById('pqBossStun');
        const bossNameEl = document.querySelector('.pq-boss-name');
        if (bossNameEl) {
            // 이름 텍스트만 교체 (pqBossStun span은 보존)
            const stunSpan = document.getElementById('pqBossStun');
            bossNameEl.textContent = monster.name;
            if (stunSpan) bossNameEl.appendChild(stunSpan);
        }
        if (hpVal) hpVal.textContent = bossHpText(monster);
        const hpLines = document.getElementById('pqBossHpLines');
        if (hpLines) {
            const t = bossHpLinesText(monster);
            hpLines.textContent = t;
            hpLines.style.display = t ? '' : 'none';
        }
        if (gaugeFill) gaugeFill.style.width = (monster.gauge || 0) + '%';
        if (stun) {
            const remain = Number(monster.stunRemain || 0);
            stun.style.display = remain > 0 ? '' : 'none';
            stun.textContent = remain > 0 ? ('기절 ' + remain.toFixed(1) + 's') : '';
        }
    }

    function renderPlayMembers(snap) {
        const root = $('#pqPlayMembers');
        if (!root) return;
        root.replaceChildren();
        for (const m of snap.members) {
            const r = m.runtime;
            const isMe = m.name === me;
            const isTaunt = (snap.monster && snap.monster.tauntTarget === m.name) || (snap.tauntTarget === m.name && Number(snap.tauntRemain || 0) > 0);
            const card = el('div', {
                class: 'pq-char-card' + (isMe ? ' me' : '') + (r && r.dead ? ' dead' : '') + (isTaunt ? ' taunt' : '') + (detailMemberName === m.name ? ' sel' : ''),
                'data-member': m.name,
                onClick: () => toggleMemberDetail(m.name)
            });
            const img = el('div', { class: 'img' },
                m.card && m.card.imageUrl
                    ? el('img', { src: m.card.imageUrl, alt: '', draggable: 'false' })
                    : el('span', { class: 'ph' }, (m.name || '?').slice(0, 1))
            );
            if (!snap.noPositions && m.position) img.append(el('span', { class: 'pos' }, m.position));
            if (m.card) img.append(el('span', { class: 'star' }, formatCardStar(m.card.star)));
            if (r && r.dead) img.append(el('span', { class: 'ko' }, '전투불능'));
            // 버프 칩 — 카드 일러스트 하단 오버레이. 내 카드는 전체 버프, 타인은 주요 디버프만.
            const chips = [];
            if (r) {
                if (isMe) {
                    if (isTaunt) chips.push({ id: 'taunt', label: '도발', remain: snap.tauntRemain || (snap.monster && snap.monster.tauntRemain) || 0 });
                    (r.buffs || []).forEach(b => chips.push(b));
                } else {
                    const tdu = (r.buffs || []).find(b => b.id === 'takenDamageUp');
                    if (tdu) chips.push(tdu);
                    if (Number(r.sealRemain || 0) > 0) chips.push({ id: '_seal', label: '봉인', remain: r.sealRemain });
                }
            }
            if (chips.length) img.append(el('div', { class: 'pq-buff-row' },
                ...chips.map(b => {
                    const label = b.label || b.id || '버프';
                    // 봉인 칩은 스냅샷 재렌더에만 의존 (updateBuffChips가 buffs 배열에서 못 찾아 숨기지 않도록 data 속성 생략)
                    if (b.id === '_seal') return el('span', { class: 'pq-buff-chip seal' }, buffChipText(label, b.remain));
                    return el('span', {
                        class: 'pq-buff-chip',
                        'data-member': m.name,
                        'data-buff-id': b.id === 'taunt' || label === '도발' ? 'taunt' : String(b.id || b.label || ''),
                        'data-label': label
                    }, buffChipText(label, b.remain));
                })
            ));
            card.append(img);
            card.append(el('div', { class: 'nm' }, titleImg(m.title), el('span', { class: 't' }, m.name)));
            if (r) {
                card.append(makeHpBar(r));
                card.append(makeMpBar(r));
            }
            root.append(card);
        }
        const mine = snap.members.find(m => m.name === me);
        const ao = $('#pqAttackOrder');
        if (ao) ao.textContent = mine && mine.runtime && mine.runtime.attackOrder ? '다음 공격 ' + mine.runtime.attackOrder + '번째' : '';
        renderMyVitals(mine);
        renderMemberDetail();
        raidEffects?.markTargets();
    }

    // 내 HP/MP 플레이트 — 스테이지 우하단, 전체 수치 표시. 접으면 작은 칩만 남는다.
    let vitalsFolded = false;
    try { vitalsFolded = localStorage.getItem('pqVitalsFolded') === '1'; } catch (_) {}
    function toggleVitals() {
        vitalsFolded = !vitalsFolded;
        try { localStorage.setItem('pqVitalsFolded', vitalsFolded ? '1' : '0'); } catch (_) {}
        if (currentRoom) renderPlayMembers(currentRoom);
    }
    function renderMyVitals(mine) {
        const box = $('#pqMyVitals');
        if (!box) return;
        const r = mine && mine.runtime;
        const inPlay = currentRoom && (currentRoom.state === 'inProgress');
        if (!r || !inPlay) { box.style.display = 'none'; return; }
        box.style.display = '';
        box.classList.toggle('folded', vitalsFolded);
        const shield = Math.max(0, Number(r.shield || 0));
        if (vitalsFolded) {
            box.replaceChildren(el('button', { class: 'vt-chip', type: 'button', onClick: toggleVitals },
                '▸ HP ' + hpPct(r).toFixed(0) + '%' + (shield > 0 ? ' +' : '')));
            return;
        }
        box.replaceChildren(
            el('div', { class: 'vrow' },
                el('span', { class: 'lbl' }, 'HP'),
                el('b', { class: 'hpv' }, Number(r.hp).toLocaleString() + ' / ' + Number(r.hpMax).toLocaleString() + (shield > 0 ? ' +' + shield.toLocaleString() : '')),
                el('button', { class: 'vt-fold', type: 'button', title: '접기', onClick: toggleVitals }, '▾')
            ),
            makeHpBar(r),
            el('div', { class: 'vrow' },
                el('span', { class: 'lbl' }, 'MP'),
                el('b', null, Number(r.mp).toLocaleString() + ' / ' + Number(r.mpMax).toLocaleString())
            ),
            makeMpBar(r)
        );
    }

    // 파티원 카드 클릭 → 상세 HP/MP 팝업 (틱마다 갱신)
    let detailMemberName = null;
    function toggleMemberDetail(name) {
        detailMemberName = detailMemberName === name ? null : name;
        if (currentRoom) renderPlayMembers(currentRoom);
    }
    function renderMemberDetail() {
        const box = $('#pqMemberDetail');
        if (!box) return;
        const m = detailMemberName && currentRoom ? currentRoom.members.find(mm => mm.name === detailMemberName) : null;
        if (!m || !m.runtime) {
            if (!m) detailMemberName = null;
            box.style.display = 'none';
            return;
        }
        const r = m.runtime;
        const shield = Math.max(0, Number(r.shield || 0));
        box.style.display = '';
        box.replaceChildren(...[
            el('div', { class: 'head' },
                titleImg(m.title),
                el('b', null, m.name + (m.name === me ? ' (나)' : '')),
                m.position ? el('span', { class: 'pos' }, m.position) : null,
                el('button', { class: 'x', type: 'button', onClick: () => { detailMemberName = null; renderMemberDetail(); } }, '×')
            ),
            el('div', { class: 'line' }, el('span', null, 'HP'), el('b', { class: 'hpv' }, Number(r.hp).toLocaleString() + ' / ' + Number(r.hpMax).toLocaleString() + ' (' + hpPct(r).toFixed(1) + '%)')),
            makeHpBar(r),
            shield > 0 ? el('div', { class: 'line' }, el('span', null, '보호막'), el('b', { class: 'shv' }, shield.toLocaleString())) : null,
            el('div', { class: 'line' }, el('span', null, 'MP'), el('b', null, Number(r.mp).toLocaleString() + ' / ' + Number(r.mpMax).toLocaleString())),
            makeMpBar(r),
            r.dead ? el('div', { class: 'line dead' }, '전투불능') : null
        ].filter(Boolean));
    }

    // 물약 아이콘. iconUrl이 없거나 로드 실패 시 이름 첫 글자 플레이스홀더
    function potionIcon(p) {
        const ph = () => el('span', { class: 'pq-potion-ph' }, String(p.name || '?').slice(0, 1));
        return p.iconUrl ? el('img', { src: p.iconUrl, class: p.name === '투신의 함성 포션' ? 'pq-potion-full' : '', alt: '', draggable: 'false', decoding: 'async', onError: e => e.currentTarget.replaceWith(ph()) }) : ph();
    }

    let potionSummarySig = '';
    function renderPotionSummary(snap) {
        const sum = $('#pqPotionSummary');
        if (!sum) return;
        const myMember = snap.members.find(m => m.name === me);
        const list = (myMember && myMember.potions) || [];
        const limit = snap.potionLimit || 0;
        const total = list.reduce((s, p) => s + Number(p.count || 0), 0);
        const count = $('#pqPotionCount');
        if (count) count.textContent = total + ' / ' + limit;
        const sig = list.map(p => p.name + ':' + p.count + ':' + (p.iconUrl || '')).join('|');
        if (sig === potionSummarySig && sum.childElementCount) return;
        potionSummarySig = sig;
        if (!list.length) {
            sum.replaceChildren(el('button', { type: 'button', class: 'pq-belt-empty', onClick: () => openPotionModal() }, '선택한 물약 없음'));
            return;
        }
        sum.replaceChildren(...list.map(p => el('div', { class: 'pq-belt-slot', title: p.name + ' ×' + p.count },
            el('div', { class: 'pq-belt-icon' }, potionIcon(p), el('b', null, '×' + p.count)),
            el('span', null, p.name)
        )));
    }

    async function openPotionModal() {
        if (!currentRoom) return;
        const limit = currentRoom.potionLimit || 0;
        $('#pqPotionLimitInfo').textContent = '최대 ' + limit + '개까지 휴대할 수 있습니다.';
        const editor = $('#pqPotionListEditor');
        editor.replaceChildren(el('div', { style: 'color:#94a3b8;text-align:center;padding:18px' }, '불러오는 중...'));
        $('#pqPotionBg').classList.add('active');
        let available;
        try {
            const resp = await api('/api/party/potions/available');
            available = resp.potions || [];
        } catch (e) {
            toast(e.message);
            editor.replaceChildren(el('div', { style: 'color:#fecaca;text-align:center;padding:18px' }, '불러오기 실패'));
            return;
        }
        const myMember = currentRoom.members.find(m => m.name === me);
        const currentMap = {};
        for (const p of (myMember && myMember.potions) || []) currentMap[p.name] = Number(p.count || 0);
        editor.replaceChildren();
        if (!available.length) {
            editor.append(el('div', { style: 'color:#94a3b8;text-align:center;padding:18px' }, '인벤토리에 사용 가능한 물약이 없습니다.'));
        }
        const state = {}; // name -> count
        for (const p of available) state[p.name] = currentMap[p.name] || 0;

        function totalSelected() {
            return Object.values(state).reduce((s, n) => s + n, 0);
        }
        function refreshTotalDisplay() {
            $('#pqPotionLimitInfo').textContent = '선택 ' + totalSelected() + ' / ' + limit;
        }
        refreshTotalDisplay();

        for (const p of available) {
            const row = el('div', { class: 'pq-potion-row' + (state[p.name] ? ' on' : '') });
            const mark = () => row.classList.toggle('on', (state[p.name] || 0) > 0);
            row.append(el('div', { class: 'pq-potion-art' }, potionIcon(p)));
            row.append(el('div', { class: 'pq-potion-info' },
                el('div', { class: 'nm' }, p.name),
                p.desc ? el('div', { class: 'ef' }, p.desc) : null,
                el('div', { class: 'own' }, '보유 ' + p.count)
            ));
            const stepper = el('div', { class: 'pq-potion-stepper' });
            const input = el('input', { type: 'number', min: '0', max: String(p.count), value: String(state[p.name] || 0), 'aria-label': p.name + ' 휴대 수량' });
            const minus = el('button', { type: 'button', 'aria-label': '줄이기', onClick: () => {
                const cur = Number(input.value) || 0;
                input.value = String(Math.max(0, cur - 1));
                state[p.name] = Number(input.value);
                refreshTotalDisplay();
                mark();
            } }, '−');
            const plus = el('button', { type: 'button', 'aria-label': '늘리기', onClick: () => {
                const cur = Number(input.value) || 0;
                const max = Math.min(p.count, cur + 1);
                if (totalSelected() - (state[p.name] || 0) + max > limit) { toast('휴대 한도 초과'); return; }
                input.value = String(max);
                state[p.name] = max;
                refreshTotalDisplay();
                mark();
            } }, '+');
            input.addEventListener('input', () => {
                let n = Math.max(0, Math.floor(Number(input.value) || 0));
                n = Math.min(p.count, n);
                if (totalSelected() - (state[p.name] || 0) + n > limit) {
                    n = Math.max(0, limit - (totalSelected() - (state[p.name] || 0)));
                    toast('휴대 한도에 맞게 조정되었습니다.');
                }
                input.value = String(n);
                state[p.name] = n;
                refreshTotalDisplay();
                mark();
            });
            stepper.append(minus, input, plus);
            row.append(stepper);
            editor.append(row);
        }

        $('#pqPotionSave').onclick = async () => {
            const items = Object.entries(state)
                .filter(([_, n]) => n > 0)
                .map(([name, count]) => ({ name, count }));
            try {
                await api('/api/party/potions', { method: 'POST', body: JSON.stringify({ items }) });
                $('#pqPotionBg').classList.remove('active');
            } catch (e) { toast(e.message); }
        };
    }

    function renderPotionBar(snap) {
        const bar = $('#pqPotionBar');
        if (!bar) return;
        const myMember = snap.members.find(m => m.name === me);
        const list = (myMember && myMember.potions) || [];
        const sig = list.map(p => p.name + ':' + p.count + ':' + (p.iconUrl || '')).join('|');
        if (potionBarSig === sig && bar.childElementCount) { updateSkillPotionButtons(); return; }
        potionBarSig = sig;
        bar.replaceChildren();
        if (!list.length) {
            bar.append(el('div', { style: 'color:#94a3b8;font-size:12px;padding:8px' }, '휴대 물약 없음'));
            return;
        }
        const r = myMember && myMember.runtime;
        const cdRemain = r && r.potionCdRemain ? r.potionCdRemain : 0;
        list.forEach((p, i) => {
            const keyCode = keybinds.potions[i];
            const btn = el('button', {
                class: 'pq-skill-btn pq-battle-potion', type: 'button', title: p.name, 'aria-label': p.name + ' ' + p.count + '개',
                'data-kind': 'potion',
                disabled: pendingCD.potion || cdRemain > 0 || (r && r.dead) ? true : false,
                onClick: async () => {
                    playSfx('potion');
                    try { await performPartyAction('/api/party/use-potion', { name: p.name }, 'potion'); } catch (e) { toast(e.message); }
                }
            },
                keyCode ? el('span', { class: 'key' }, keyLabel(keyCode)) : null,
                el('span', { class: 'pq-battle-potion-art' }, potionIcon(p)),
                el('span', { class: 'pq-battle-potion-count' }, '×' + p.count),
                el('div', { class: 'cd', style: cdRemain > 0 ? '' : 'display:none' }, cdRemain > 0 ? cdRemain.toFixed(1) : '')
            );
            bar.append(btn);
        });
    }

    function renderSkillBar(snap) {
        const bar = $('#pqSkillBar');
        if (!bar) return;
        const myMember = snap.members.find(m => m.name === me);
        if (!myMember || !(myMember.skills || []).length) {
            if (skillBarSig === 'empty' && bar.childElementCount) return;
            skillBarSig = 'empty';
            bar.replaceChildren();
            bar.append(el('div', { style: 'color:#94a3b8;font-size:12px;padding:8px' }, '스킬 없음'));
            return;
        }
        const def = snap.questDef || {};
        const skillDefs = Object.assign({}, def.skills || {}, def.extraSkills || {}, myMember.skillDefs || {});
        const sig = (myMember.skills || []).map(skillName => {
            const sd = skillDefs[skillName] || {};
            return skillName + ':' + (sd.type || '') + ':' + (sd.mp || '') + ':' + (sd.cd || '') + ':' + (sd.target || '');
        }).join('|');
        if (skillBarSig === sig && bar.childElementCount) { updateSkillPotionButtons(); return; }
        skillBarSig = sig;
        bar.replaceChildren();
        const cooldowns = (myMember.runtime && myMember.runtime.cooldowns) || {};
        const acd = (myMember.runtime && myMember.runtime.actionCdRemain) || 0;
        myMember.skills.forEach((skillName, i) => {
            const sd = skillDefs[skillName] || {};
            const remain = cooldowns[skillName] || 0;
            const isPassive = sd.type === 'passive';
            const charge = Number(myMember.runtime && myMember.runtime.sivalonCharge || 0);
            const needCharge = skillName === '시벌론' && charge < 5;
            const blocked = pendingCD.action || isPassive || (myMember.runtime && myMember.runtime.dead) || remain > 0 || acd > 0 || needCharge;
            const overlay = remain > 0 ? remain.toFixed(1) : (needCharge ? '충전 ' + charge + '/5' : (acd > 0 && !isPassive ? acd.toFixed(1) : null));
            const keyCode = isPassive ? null : keybinds.skills[i];
            const btn = el('button', {
                class: 'pq-skill-btn',
                'data-kind': 'skill',
                'data-skill': skillName,
                'data-passive': isPassive ? '1' : '0',
                disabled: blocked ? true : false,
                onClick: () => useSkillFlow(skillName, sd)
            },
                keyCode ? el('span', { class: 'key' }, keyLabel(keyCode)) : null,
                el('div', null, skillName),
                isPassive ? el('div', { class: 'mp' }, '패시브') : (sd.mp ? el('div', { class: 'mp' }, 'MP ' + sd.mp) : null),
                el('div', { class: 'cd', style: overlay ? '' : 'display:none' }, overlay || '')
            );
            bar.append(btn);
        });
    }

    // ====== 공대장 지원군 스킬 ======
    function renderSupportBar(snap) {
        const panel = $('#pqSupportPanel');
        if (!panel) return;
        const skills = snap.supportSkills;
        if (!skills || !skills.length || snap.state !== 'inProgress') {
            supportBarSig = '';
            panel.style.display = 'none';
            return;
        }
        panel.style.display = '';
        const isHost = snap.hostName === me;
        const sig = skills.map(s => s.name).join(',') + '|' + (isHost ? '1' : '0');
        if (sig !== supportBarSig) {
            supportBarSig = sig;
            const bar = $('#pqSupportSkills');
            bar.replaceChildren();
            for (const s of skills) {
                const btn = el('button', {
                    class: 'pq-skill-btn pq-support-btn',
                    'data-support': s.name,
                    type: 'button',
                    disabled: true,
                    onClick: () => useSupportSkillFlow(s.name)
                },
                    s.icon ? el('img', { src: s.icon, alt: '', class: 'pq-support-icon' }) : null,
                    el('div', null, s.name)
                );
                if (!isHost) btn.title = '공대장만 사용할 수 있습니다.';
                bar.append(btn);
            }
        }
        updateSupportGauge();
    }

    function updateSupportGauge() {
        const panel = $('#pqSupportPanel');
        if (!panel || panel.style.display === 'none' || !currentRoom) return;
        const gauge = Number(currentRoom.supportGauge || 0);
        const ready = gauge >= 100;
        const isHost = currentRoom.hostName === me;
        const val = $('#pqSupportGaugeVal');
        const fill = $('#pqSupportGaugeFill');
        if (val) val.textContent = Math.min(100, Math.floor(gauge)) + '%' + (ready ? ' READY' : '');
        if (fill) {
            fill.style.width = Math.min(100, gauge) + '%';
            fill.style.background = ready ? 'linear-gradient(90deg,#fbbf24,#f97316)' : '';
        }
        $$('.pq-support-btn').forEach(btn => {
            btn.disabled = isPhaseTransitionActive() || !(ready && isHost);
            btn.style.outline = ready && isHost ? '2px solid #fbbf24' : '';
        });
    }

    async function useSupportSkillFlow(skillName) {
        if (isPhaseTransitionActive()) return;
        try {
            await api('/api/party/support-skill', { method: 'POST', body: JSON.stringify({ skill: skillName }) });
        } catch (e) { toast(e.message); }
    }

    async function useSkillFlow(skillName, sd) {
        try {
            const targetType = sd && sd.target;
            let payload;
            if (targetType === 'ally') {
                const target = await pickAllyTarget('회복/지원 대상 선택');
                if (!target) return;
                payload = { skill: skillName, target };
            } else {
                payload = { skill: skillName };
            }
            playSfx('skill');
            await performPartyAction('/api/party/skill', payload, 'action');
        } catch (e) { toast(e.message); }
    }

    function pickAllyTarget(title) {
        return new Promise(resolve => {
            const list = $('#pqTargetList');
            list.replaceChildren();
            $('#pqTargetTitle').textContent = title || '대상 선택';
            const snap = currentRoom;
            const choose = name => {
                $('#pqTargetBg').classList.remove('active');
                resolve(name);
            };
            for (const m of snap.members) {
                if (m.runtime && m.runtime.dead) continue;
                const r = m.runtime;
                const pct = hpPct(r);
                const row = el('div', { class: 'pq-target-row', onClick: () => choose(m.name) },
                    el('div', null, m.name + (m.name === me ? ' (나)' : '')),
                    el('div', { class: 'pq-target-hp' },
                        el('div', { class: 'txt' }, r ? (r.hp + ' / ' + r.hpMax) : ''),
                        el('div', { class: 'pct' }, r ? pct.toFixed(1) + '%' : ''),
                        r ? makeHpBar(r) : null
                    )
                );
                list.append(row);
            }
            $('#pqTargetCancel').onclick = () => { $('#pqTargetBg').classList.remove('active'); resolve(null); };
            $('#pqTargetBg').classList.add('active');
        });
    }

    // ====== 시간제한 투표 ======
    function syncVoteModal(snap) {
        const bg = $('#pqVoteBg');
        if (!bg) return;
        const vote = snap && snap.voteState;
        if (!vote || snap.spectating) {
            voteSig = '';
            bg.classList.remove('active');
            return;
        }
        const mine = snap.members.find(m => m.name === me);
        const voted = !!(vote.votes && vote.votes[me]);
        const dead = !mine || !mine.runtime || mine.runtime.dead;
        const sig = vote.prompt + '|' + (vote.candidates || []).join(',') + '|' + (voted ? '1' : '0') + '|' + (dead ? '1' : '0') + '|' + Object.values(vote.votes || {}).join(',');
        if (sig !== voteSig) {
            voteSig = sig;
            $('#pqVoteTitle').textContent = vote.prompt;
            $('#pqVoteDone').style.display = voted || dead ? '' : 'none';
            $('#pqVoteDone').textContent = dead && !voted ? '전투불능 상태에서는 투표할 수 없습니다.' : '투표 완료. 결과를 기다리는 중입니다.';
            const list = $('#pqVoteList');
            list.replaceChildren();
            const myVote = (vote.votes || {})[me];
            for (const name of (vote.candidates || [])) {
                const count = Object.values(vote.votes || {}).filter(v => v === name).length;
                const isMine = myVote === name;
                const row = el('div', {
                    class: 'pq-target-row pq-vote-row' + (voted || dead ? ' disabled' : '') + (isMine ? ' mine' : ''),
                    style: (voted || dead) && !isMine ? 'opacity:.55' : '',
                    onClick: async () => {
                        if (voted || dead) return;
                        try { await api('/api/party/vote', { method: 'POST', body: JSON.stringify({ target: name }) }); }
                        catch (e) { toast(e.message); }
                    }
                },
                    el('div', null, name + (name === me ? ' (나)' : ''), isMine ? el('span', { class: 'pq-vote-mine' }, '✓ 내 선택') : null),
                    el('div', { class: 'pq-target-hp' }, el('div', { class: 'txt' }, count > 0 ? count + '표' : ''))
                );
                list.append(row);
            }
        }
        updateVoteTimer();
        bg.classList.add('active');
    }

    function updateVoteTimer() {
        const node = $('#pqVoteTimer');
        if (!node || !currentRoom || !currentRoom.voteState) return;
        node.textContent = '남은 시간 ' + Math.max(0, Number(currentRoom.voteState.deadline || 0)).toFixed(1) + 's';
    }

    function openChoiceModal(choices) {
        const root = $('#pqChoiceList');
        root.replaceChildren();
        const snap = currentRoom;
        const def = snap && snap.questDef ? Object.assign({}, snap.questDef.skills || {}, snap.questDef.extraSkills || {}) : {};
        for (const sk of choices) {
            const sd = def[sk] || {};
            const desc = sd.desc || (sd.type === 'passive' ? '패시브 효과' : '활성 스킬');
            root.append(el('div', { class: 'pq-choice', onClick: async () => {
                try {
                    await api('/api/party/pick-skill', { method: 'POST', body: JSON.stringify({ skill: sk }) });
                    $('#pqChoiceBg').classList.remove('active');
                } catch (e) { toast(e.message); }
            } },
                el('div', { class: 'ttl' }, sk + (sd.type === 'passive' ? ' [패시브]' : '')),
                el('div', { class: 'desc' }, desc)
            ));
        }
        $('#pqChoiceBg').classList.add('active');
    }

    // ====== SSE ======
    function openStream() {
        closeStream();
        try {
            stream = new EventSource(currentRoom?.spectating ? '/api/party/spectate/stream' : '/api/party/stream');
            stream.addEventListener('room-closed', () => { toast('파티가 종료되었습니다.'); leaveRoom(); });
            stream.addEventListener('room', e => {
                try {
                    const snap = JSON.parse(e.data);
                    applyRoomSnapshot(snap);
                    showRoomScreenForState();
                } catch (_) {}
            });
            stream.addEventListener('chat', e => {
                try { appendChat(JSON.parse(e.data)); } catch (_) {}
            });
            stream.addEventListener('notice', e => {
                try { const n = JSON.parse(e.data); showNotice(n.text, n.kind, n.ttl); } catch (_) {}
            });
            stream.addEventListener('combat', e => {
                try { appendCombat(JSON.parse(e.data)); } catch (_) {}
            });
            stream.addEventListener('kill', e => {
                try {
                    const k = JSON.parse(e.data);
                    if (currentRoom) {
                        currentRoom.sharedKillCount = k.total;
                        currentRoom.killTarget = k.target;
                    }
                    updateMobCounter(k.total, k.target);
                    if (typeof k.damage === 'number') showDamagePop(k);
                } catch (_) {}
            });
            stream.addEventListener('hit', e => {
                try {
                    const h = JSON.parse(e.data);
                    if (currentRoom && h.monster) {
                        currentRoom.monster = h.monster;
                        updateBossMonster(h.monster);
                    }
                    if (typeof h.damage === 'number') showDamagePop(h);
                } catch (_) {}
            });
            stream.addEventListener('tick', e => {
                try {
                    const t = JSON.parse(e.data);
                    const now = Date.now();
                    if (now - lastTickAt < 100) return; // 클라 렌더 절약
                    lastTickAt = now;
                    if (currentRoom) {
                        currentRoom.members = t.members || currentRoom.members;
                        syncMyDeadlinesFromSnapshot(t);
                        applyMyDeadlinesToRuntime();
                        currentRoom.monster = t.monster || currentRoom.monster;
                        if (typeof t.tauntTarget !== 'undefined') currentRoom.tauntTarget = t.tauntTarget;
                        if (typeof t.tauntRemain !== 'undefined') currentRoom.tauntRemain = t.tauntRemain;
                        if (typeof t.supportGauge !== 'undefined') { currentRoom.supportGauge = t.supportGauge; updateSupportGauge(); }
                        localBuffTickAt = now;
                        if ((currentRoom.phaseType === 'elite' || currentRoom.phaseType === 'boss') && document.getElementById('pqBossStage')) {
                            updateBossMonster(currentRoom.monster);
                            renderPlayMembers(currentRoom);
                            updateSkillPotionButtons();
                            updateAttackBtn();
                        } else {
                            renderPlayUI();
                        }
                    }
                } catch (_) {}
            });
            stream.addEventListener('error', () => {});
        } catch (e) {}
    }
    function closeStream() {
        if (stream) { try { stream.close(); } catch (_) {} stream = null; }
    }

    // ====== 이벤트 핸들러 ======
    $('#pqHome').onclick = () => { location.href = '/'; };
    $('#pqRefresh').onclick = () => loadLobby();

    $('#pqCreateFab').onclick = () => {
        $('#pqCreatePw').value = '';
        renderQuestCard();
        $('#pqCreateBg').classList.add('active');
    };
    function closeCreateModal() { $('#pqCreateBg').classList.remove('active'); }
    $('#pqCreateCancel').onclick = closeCreateModal;
    $('#pqCreateClose').onclick = closeCreateModal;
    $('#pqCreateBg').addEventListener('click', e => { if (e.target === e.currentTarget) closeCreateModal(); });
    $('#pqCreateConfirm').onclick = async () => {
        if (questDefs[questPickerIdx] && questDefs[questPickerIdx].locked) return toast(questDefs[questPickerIdx].unlockError);
        const questId = questDefs[questPickerIdx] && questDefs[questPickerIdx].id;
        const password = $('#pqCreatePw').value;
        const button = $('#pqCreateConfirm');
        button.disabled = true;
        button.textContent = '생성 중...';
        try {
            await api('/api/party/rooms', { method: 'POST', body: JSON.stringify({ questId, password }) });
            closeCreateModal();
            await afterEnterRoom();
        } catch (e) {
            toast(e.message);
        } finally {
            button.disabled = false;
            button.textContent = '원정대 생성';
        }
    };

    $('#pqJoinCancel').onclick = () => $('#pqJoinBg').classList.remove('active');

    $('#pqOpenPotion').onclick = () => openPotionModal();
    $('#pqPotionCancel').onclick = () => $('#pqPotionBg').classList.remove('active');
    $('#pqRewardClose').onclick = () => $('#pqRewardBg').classList.remove('active');
    $('#pqFirstClearClose').onclick = () => $('#pqFirstClearBg').classList.remove('active');

    async function leaveRoom() {
        resetDefeatPresentation();
        try { await api(currentRoom?.spectating ? '/api/party/spectate/leave' : '/api/party/leave', { method: 'POST', body: JSON.stringify({}) }); } catch (_) {}
        closeStream();
        stopLocalCdTimer();
        hideBattleIntro();
        hidePhaseTransition();
        syncBgm(null);
        raidEffects?.reset();
        lastRoomState = null;
        myCD.action = 0; myCD.potion = 0; myCD.skills = {};
        pendingCD.action = false; pendingCD.potion = false;
        cooldownClockOffset = null; lastCooldownServerTime = 0;
        skillBarSig = '';
        potionBarSig = '';
        localBuffTickAt = 0;
        currentRoom = null;
        updateRaidPatterns();
        syncVoteModal(null);
        $('#pqChoiceBg').classList.remove('active');
        $('#pqTargetBg').classList.remove('active');
        renderMemberDetail();
        $('#frame').classList.remove('spectating');
        showScreen('lobby');
        await loadLobby();
    }
    $('#pqLeave').onclick = leaveRoom;
    $('#pqPlayLeave').onclick = async () => {
        if (currentRoom && !currentRoom.spectating && currentRoom.state === 'inProgress' && !(await showConfirm('전투 중입니다. 파티에서 나가시겠습니까?'))) return;
        leaveRoom();
    };
    $('#pqAttackBtn').onclick = manualAttack;

    // 전투 화면 채팅/로그 탭
    function showGameTab(which) {
        $('#pqTabChat').classList.toggle('on', which === 'chat');
        $('#pqTabLog').classList.toggle('on', which === 'log');
        $('#pqPlayChat').style.display = which === 'chat' ? '' : 'none';
        $('#pqPlayChatForm').style.display = which === 'chat' && !currentRoom?.spectating ? '' : 'none';
        $('#pqCombatLog').style.display = which === 'log' ? '' : 'none';
        if (which === 'chat') { const c = $('#pqPlayChat'); c.scrollTop = c.scrollHeight; }
        else { const l = $('#pqCombatLog'); l.scrollTop = l.scrollHeight; }
    }
    $('#pqTabChat').onclick = () => showGameTab('chat');
    $('#pqTabLog').onclick = () => showGameTab('log');

    // 설정 모달 (사운드 + 단축키)
    function syncVolumeUI() {
        const bgmSlider = $('#pqVolBgm'), sfxSlider = $('#pqVolSfx');
        if (!bgmSlider) return;
        bgmSlider.value = String(Math.round(sound.bgm * 100));
        sfxSlider.value = String(Math.round(sound.sfx * 100));
        $('#pqVolBgmVal').textContent = Math.round(sound.bgm * 100) + '%';
        $('#pqVolSfxVal').textContent = Math.round(sound.sfx * 100) + '%';
    }
    if ($('#pqVolBgm')) {
        $('#pqVolBgm').addEventListener('input', e => {
            sound.bgm = clamp01(Number(e.target.value) / 100);
            updateBgmVolume();
            if (sound.bgm <= 0) { finishBgmFade(); bgm.pause(); }
            else playBgm();
            $('#pqVolBgmVal').textContent = Math.round(sound.bgm * 100) + '%';
            saveSound();
        });
        $('#pqVolSfx').addEventListener('input', e => {
            sound.sfx = clamp01(Number(e.target.value) / 100);
            raidEffects?.setVolume(sound.sfx);
            $('#pqVolSfxVal').textContent = Math.round(sound.sfx * 100) + '%';
            saveSound();
        });
        // 슬라이더에서 손 뗄 때 미리듣기
        $('#pqVolSfx').addEventListener('change', () => playSfx('hit'));
    }
    function openSettings() {
        renderKeybindList();
        syncVolumeUI();
        $('#pqKeybindBg').classList.add('active');
    }
    if ($('#pqSettingsBtn')) $('#pqSettingsBtn').onclick = openSettings; // 전투 중에도 조절 가능
    if ($('#pqRoomSettings')) $('#pqRoomSettings').onclick = openSettings;
    if ($('#pqKeybindOpen')) {
        $('#pqKeybindOpen').onclick = openSettings;
        $('#pqKeybindClose').onclick = () => { stopKeyCapture(); $('#pqKeybindBg').classList.remove('active'); };
        $('#pqKeybindReset').onclick = () => {
            keybinds = JSON.parse(JSON.stringify(KEYBIND_DEFAULTS));
            saveKeybinds();
            renderKeybindList();
            updateAttackKeyHint();
            skillBarSig = ''; potionBarSig = '';
        };
    }
    updateAttackKeyHint();
    // 기본은 접힌 상태(최근 몇 줄만 반투명 표시) — 일러스트를 가리지 않게. 클릭하면 펼침.
    const gameChat = $('#pqGameChat');
    if (gameChat) {
        gameChat.addEventListener('click', () => {
            if (gameChat.classList.contains('open')) return;
            gameChat.classList.add('open');
            const c = $('#pqPlayChat'); c.scrollTop = c.scrollHeight;
            const l = $('#pqCombatLog'); l.scrollTop = l.scrollHeight;
        });
        const collapseBtn = $('#pqChatCollapse');
        if (collapseBtn) collapseBtn.onclick = e => {
            e.stopPropagation();
            gameChat.classList.remove('open');
            // 높이가 줄어든 접힌 뷰에서도 최신 줄이 보이게 재고정
            const c = $('#pqPlayChat'); c.scrollTop = c.scrollHeight;
            const l = $('#pqCombatLog'); l.scrollTop = l.scrollHeight;
        };
    }

    $('#pqReadyBtn').onclick = async () => {
        if (!currentRoom || currentRoom.spectating) return;
        const myMember = currentRoom.members.find(m => m.name === me);
        const next = !(myMember && myMember.ready);
        try { await api('/api/party/ready', { method: 'POST', body: JSON.stringify({ ready: next }) }); } catch (e) { toast(e.message); }
    };

    $('#pqStartBtn').onclick = async () => {
        try { await api('/api/party/start', { method: 'POST', body: JSON.stringify({}) }); } catch (e) { toast(e.message); }
    };

    function bindChatForm(formId, inputId) {
        const form = document.getElementById(formId);
        const input = document.getElementById(inputId);
        if (!form || !input) return;
        form.addEventListener('submit', async ev => {
            ev.preventDefault();
            if (currentRoom?.spectating) return;
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            try { await api('/api/party/chat', { method: 'POST', body: JSON.stringify({ text }) }); } catch (e) { toast(e.message); }
        });
    }
    bindChatForm('pqChatForm', 'pqChatInput');
    bindChatForm('pqPlayChatForm', 'pqPlayChatInput');

    window.addEventListener('beforeunload', () => closeStream());

    loadLobby();
})();
