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
    let selectedResultMember = '';
    // 클라이언트 로컬 쿨다운 데드라인 (epoch ms) 
    const myCD = { action: 0, skills: {}, potion: 0 };
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
        // 서버가 남은 초로 보내줌 — 데드라인으로 변환. 로컬 클릭 직후 시점이면 로컬값이 더 클 수 있으므로 max로 병합.
        myCD.action = Math.max(myCD.action, now + Number(r.actionCdRemain || 0) * 1000);
        myCD.potion = Math.max(myCD.potion, now + Number(r.potionCdRemain || 0) * 1000);
        // 서버 cooldowns: { skillName: 남은초 }. 서버에 없는 키는 만료된 것이므로 로컬도 청소.
        const serverSkills = r.cooldowns || {};
        const merged = {};
        for (const k of Object.keys(serverSkills)) {
            const serverEpoch = now + Number(serverSkills[k] || 0) * 1000;
            merged[k] = Math.max(myCD.skills[k] || 0, serverEpoch);
        }
        // 로컬에서 방금 클릭해 추가한 데드라인이 서버 스냅샷보다 빨라 누락되는 경우 (스냅샷 송신 시점 기준)
        for (const k of Object.keys(myCD.skills)) {
            if (myCD.skills[k] > now && !(k in merged)) merged[k] = myCD.skills[k];
        }
        myCD.skills = merged;
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
        }, 150);
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
            const blocked = isPassive || dead || seal > 0 || remain > 0 || acd > 0 || needCharge;
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
            btn.disabled = dead || seal > 0 || pcd > 0;
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
        const blocked = dead || currentRoom.awaitingChoices || seal > 0 || acd > 0;
        btn.disabled = blocked;
        btn.textContent = seal > 0 ? ('봉인 ' + seal.toFixed(1) + 's') : (acd > 0 ? (acd.toFixed(1) + 's') : '공격');
    }

    function getMyActionCooldownMs() {
        if (!currentRoom) return 2500;
        const myMember = currentRoom.members.find(m => m.name === me);
        const mul = myMember && myMember.runtime ? Number(myMember.runtime.actionCdMul || 1) : 1;
        return Math.max(500, 2500 * mul);
    }

    async function manualAttack() {
        myCD.action = Math.max(myCD.action, Date.now() + getMyActionCooldownMs());
        applyMyDeadlinesToRuntime();
        updateAttackBtn();
        updateSkillPotionButtons();
        try { await api('/api/party/attack', { method: 'POST', body: JSON.stringify({}) }); } catch (e) { toast(e.message); }
    }

    async function api(path, opts) {
        const res = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
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

    function renderRoomList(list) {
        const root = $('#pqRoomList');
        root.replaceChildren();
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.gap = '10px';
        if (!list.length) {
            root.append(el('div', { class: 'pq-empty' }, '생성된 파티가 없습니다.'));
            return;
        }
        for (const r of list) {
            const meta = el('div', { class: 'pq-room-meta' });
            meta.append(el('span', { class: 'pq-pill' }, r.memberCount + '/' + r.maxPlayers + '명'));
            if (r.hasPassword) meta.append(el('span', { class: 'pq-pill lock' }, '비공개'));
            meta.append(el('span', { class: 'pq-pill' }, r.state === 'lobby' ? '대기 중' : '준비 중'));
            const card = el('div', { class: 'pq-room-card', onClick: () => attemptJoin(r) },
                el('div', null,
                    el('div', { class: 'pq-room-quest' }, r.questName),
                    el('div', { class: 'pq-room-title' }, r.hostName + '님의 파티')
                ),
                el('div', { style: 'align-self:center;color:var(--text-2);font-weight:700' }, '→'),
                meta
            );
            root.append(card);
        }
    }

    let questPickerIdx = 0;

    function renderQuestCard() {
        const q = questDefs[questPickerIdx];
        if (!q) return;
        const difficulty = /Extreme/i.test(q.id) ? 'extreme' : (/Hard/i.test(q.id) ? 'hard' : 'normal');
        const card = $('#pqQuestCard');
        card.dataset.difficulty = difficulty;
        const imgWrap = $('#pqQuestCardImg');
        imgWrap.replaceChildren();
        if (q.coverImage) {
            imgWrap.append(el('img', { src: '/rpg-ui?file=' + encodeURIComponent(q.coverImage), alt: q.name, draggable: false, decoding: 'async' }));
        } else {
            imgWrap.append(el('div', { class: 'pq-quest-no-img' }, 'NO IMAGE'));
        }
        $('#pqQuestDifficulty').textContent = difficulty.toUpperCase();
        $('#pqQuestCardName').textContent = q.name;
        const meta = $('#pqQuestCardMeta');
        meta.replaceChildren();
        if (q.minLevel) meta.append(el('span', null, '입장 Lv.' + q.minLevel));
        if (q.recommendedPower) meta.append(el('span', null, '전투력 ' + Number(q.recommendedPower).toLocaleString()));
        meta.append(el('span', null, q.minPlayers + '–' + q.maxPlayers + ' PLAYER'));
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

    function attemptJoin(r) {
        if (r.hasPassword) {
            const sub = $('#pqJoinSub');
            sub.textContent = r.questName + ' · ' + r.hostName + '님의 파티';
            $('#pqJoinPw').value = '';
            $('#pqJoinBg').classList.add('active');
            $('#pqJoinConfirm').onclick = async () => {
                const pw = $('#pqJoinPw').value;
                try {
                    await api('/api/party/rooms/' + r.id + '/join', { method: 'POST', body: JSON.stringify({ password: pw }) });
                    $('#pqJoinBg').classList.remove('active');
                    afterEnterRoom();
                } catch (e) { toast(e.message); }
            };
        } else {
            (async () => {
                try {
                    await api('/api/party/rooms/' + r.id + '/join', { method: 'POST', body: JSON.stringify({}) });
                    afterEnterRoom();
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
    const bgm = new Audio('/rpg-ui?file=' + encodeURIComponent('boss fight.mp3'));
    bgm.loop = true;
    bgm.volume = sound.bgm;
    bgm.preload = 'none';
    let bgmWanted = false;
    function syncBgm(snap) {
        const want = !!(snap && snap.state === 'inProgress');
        if (want) preloadSfx();
        if (want === bgmWanted && !(want && bgm.paused)) return;
        bgmWanted = want;
        if (want) { if (sound.bgm > 0) bgm.play().catch(() => {}); }
        else { bgm.pause(); try { bgm.currentTime = 0; } catch (_) {} }
    }
    // 자동재생 차단(새로고침 재접속 등) 대비 — 첫 상호작용에서 재시도
    for (const evt of ['pointerdown', 'keydown']) {
        document.addEventListener(evt, () => { if (bgmWanted && sound.bgm > 0 && bgm.paused) bgm.play().catch(() => {}); }, true);
    }

    // ====== 효과음 (Kenney CC0 → DB/RPGenius/ui/sfx) ======
    const SFX_FILES = {
        hit: ['sfx/hit_0.mp3', 'sfx/hit_1.mp3', 'sfx/hit_2.mp3'],
        crit: ['sfx/crit.mp3'],
        skill: ['sfx/skill.mp3'],
        potion: ['sfx/potion.mp3'],
        count: ['sfx/count.mp3'],
        start: ['sfx/start.mp3'],
        clear: ['sfx/clear.mp3'],
        fail: ['sfx/fail.mp3']
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
        if (!currentRoom || currentRoom.state !== 'inProgress') return;
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
        if (prev === 'inProgress' && (snap.state === 'cleared' || snap.state === 'failed')) playSfx(snap.state === 'cleared' ? 'clear' : 'fail');
    }

    // ====== 방 화면 ======
    function applyRoomSnapshot(snap) {
        currentRoom = snap;
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

    function renderQuestInfo(snap) {
        const box = $('#pqQuestInfo');
        box.replaceChildren();
        const def = snap.questDef;
        if (!def) {
            box.append(el('div', null, '진행 중인 퀘스트입니다.'));
            return;
        }
        if (def.description) box.append(el('div', null, def.description));
        const phases = (def.phases || []).map(p => p.name).join(' · ');
        if (phases) box.append(el('div', { style: 'margin-top:6px' }, el('b', null, '페이즈: '), phases));
        if (def.potionLimit) box.append(el('div', { style: 'margin-top:4px;color:#94a3b8' }, '물약 최대 ' + def.potionLimit + '개 휴대 가능'));
    }

    function renderMembers(snap) {
        const root = $('#pqMemberList');
        root.replaceChildren();
        for (const m of snap.members) {
            const tags = el('div', { class: 'pq-row', style: 'gap:4px' });
            if (m.name === snap.hostName) tags.append(el('span', { class: 'pq-tag host' }, '공대장'));
            if (m.ready) tags.append(el('span', { class: 'pq-tag ready' }, '준비'));
            if (!m.online) tags.append(el('span', { class: 'pq-tag off' }, '오프라인'));
            const row = el('div', {
                class: 'pq-member' + (m.name === snap.hostName ? ' host' : '') + (m.name === me ? ' me' : '')
            },
                el('div', { class: 'pq-avatar' }, (m.name || '?').slice(0, 1)),
                el('div', null,
                    el('div', { class: 'pq-name' }, titleImg(m.title), el('span', { class: 'pq-lv' }, 'Lv.' + (m.level || 1) + ' '), m.name, tags),
                    snap.noPositions ? null : el('div', { class: 'pq-pos' + (m.position ? ' set' : '') }, m.position || '포지션 미선택')
                ),
                el('div', null)
            );
            root.append(row);
        }
    }

    function renderPositions(snap) {
        const panel = $('#pqPositionPanel');
        if (panel) panel.style.display = snap.noPositions ? 'none' : '';
        if (snap.noPositions) return;
        const grid = $('#pqPositionGrid');
        grid.replaceChildren();
        const myMember = snap.members.find(m => m.name === me);
        const myPos = myMember && myMember.position;
        const taken = new Set(snap.members.filter(m => m.name !== me && m.position).map(m => m.position));
        for (const pos of (snap.positions || [])) {
            const isMine = pos === myPos;
            const isTaken = taken.has(pos);
            const btn = el('button', {
                class: 'pq-position-btn' + (isMine ? ' active' : '') + (isTaken && !isMine ? ' taken' : ''),
                disabled: isTaken && !isMine ? true : false,
                onClick: async () => {
                    try {
                        const next = isMine ? '' : pos;
                        await api('/api/party/position', { method: 'POST', body: JSON.stringify({ position: next }) });
                    } catch (e) { toast(e.message); }
                }
            }, pos);
            grid.append(btn);
        }
        const detail = $('#pqPositionDetail');
        if (myPos && POS_DETAILS[myPos]) {
            detail.style.display = 'grid';
            detail.replaceChildren(...POS_DETAILS[myPos].map(line => el('div', null, '• ' + line)));
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
    }

    function renderRoomControls(snap) {
        const myMember = snap.members.find(m => m.name === me);
        const isHost = snap.hostName === me;
        const readyBtn = $('#pqReadyBtn');
        const startBtn = $('#pqStartBtn');
        if (myMember) {
            readyBtn.textContent = myMember.ready ? '준비 해제' : '준비';
            readyBtn.classList.toggle('primary', !myMember.ready);
            readyBtn.disabled = !snap.noPositions && !myMember.position;
        }
        const allReady = snap.members.length > 0 && snap.members.every(m => (snap.noPositions || m.position) && m.ready);
        startBtn.style.display = isHost ? 'inline-flex' : 'none';
        startBtn.disabled = !allReady;
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
        const ended = snap.state === 'cleared' || snap.state === 'failed';
        const playScreen = document.querySelector('.pq-screen[data-screen="play"]');
        if (playScreen) playScreen.classList.toggle('result-mode', ended);
        $('#pqPhaseLabel').textContent = snap.phaseType ? snap.phaseType.toUpperCase() : 'PHASE';
        $('#pqPhaseName').textContent = snap.phaseName || '-';

        const stage = $('#pqPhaseStage');
        const actionRow = $('#pqActionRow');
        if (actionRow) actionRow.style.display = ended ? 'none' : '';
        if (ended) {
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

        syncVoteModal(snap);
        renderSupportBar(snap);
        renderPlayMembers(snap);
        renderSkillBar(snap);
        renderPotionBar(snap);
        if (snap.state === 'cleared' && snap.result && Array.isArray(snap.result.rewards) && snap.result.rewards.length && shownRewardRoomId !== snap.id) {
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
        if (r.statistics) wrap.append(renderBattleStatistics(r.statistics));
        const footer = el('div', { class: 'pq-result-footer' });
        if (r.cleared && r.rewards && r.rewards.length) {
            footer.append(el('button', { class: 'pq-btn primary', type: 'button', onClick: () => openRewardModal(r.rewards) }, '파티 보상 확인'));
        } else if (r.cleared) {
            footer.append(el('div', { class: 'pq-result-reward-wait' }, '보상 지급 중...'));
        }
        if (snap.hostName === me) {
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

    function battleMetric(label, value, cls, suffix) {
        return el('div', { class: 'pq-battle-metric ' + (cls || '') },
            el('span', null, label),
            el('strong', null, battleNumber(value) + (suffix || ''))
        );
    }

    function battleRows(items, valueKey, emptyText) {
        const list = Array.isArray(items) ? items.filter(item => Number(item && item[valueKey] || 0) > 0) : [];
        if (!list.length) return el('div', { class: 'pq-battle-empty' }, emptyText || '기록 없음');
        const max = Math.max(...list.map(item => Number(item[valueKey] || 0)), 1);
        return el('div', { class: 'pq-battle-rows' }, ...list.map(item => {
            const value = Number(item[valueKey] || 0);
            return el('div', { class: 'pq-battle-row' },
                el('div', { class: 'pq-battle-row-head' },
                    el('span', null, item.name || '-'),
                    el('b', null, battleNumber(value))
                ),
                el('div', { class: 'pq-battle-row-bar' },
                    el('i', { style: 'width:' + Math.max(2, value / max * 100).toFixed(2) + '%' })
                )
            );
        }));
    }

    function battleCountList(items, emptyText) {
        const list = Array.isArray(items) ? items.filter(item => Number(item && item.count || 0) > 0) : [];
        if (!list.length) return el('div', { class: 'pq-battle-empty compact' }, emptyText || '기록 없음');
        return el('div', { class: 'pq-battle-count-list' }, ...list.map(item =>
            el('div', { class: 'pq-battle-count-row' },
                el('span', null, item.name || '-'),
                el('b', null, battleNumber(item.count) + '회')
            )
        ));
    }

    function renderBattleMemberDetail(member) {
        const reduced = member.damageReduced || {};
        const card = member.card || {};
        const head = el('div', { class: 'pq-battle-member-head' });
        const portrait = el('div', { class: 'pq-battle-member-portrait' });
        if (card.imageUrl) portrait.append(el('img', { src: card.imageUrl, alt: card.name || member.name || '' }));
        else portrait.append(el('span', null, String(member.name || '?').slice(0, 1)));
        head.append(portrait, el('div', { class: 'pq-battle-member-name' },
            el('strong', null, member.name || '-'),
            el('span', null, (member.position || '자유 포지션') + ' · 딜 기여도 ' + Number(member.damageShare || 0).toFixed(1) + '%')
        ));

        const metrics = el('div', { class: 'pq-battle-member-metrics' },
            battleMetric('전체 딜량', member.damage, 'damage'),
            battleMetric('받은 피해량', member.damageTaken, 'taken'),
            battleMetric('감소한 피해량', reduced.total, 'reduced'),
            battleMetric('회복량', member.healing, 'healing'),
            battleMetric('아군 회복량', member.allyHealing, 'ally-healing')
        );

        const damageSection = el('section', { class: 'pq-battle-section damage-section' },
            el('div', { class: 'pq-battle-section-title' }, el('b', null, '피해 분석'), el('span', null, '실제로 적용된 피해 기준')),
            el('div', { class: 'pq-battle-type-grid' },
                battleMetric('고정 피해', member.fixedDamage, 'fixed'),
                battleMetric('치명타 피해', member.criticalDamage, 'critical'),
                battleMetric('운명 피해', member.destinyDamage, 'destiny')
            ),
            el('div', { class: 'pq-battle-subtitle' }, '공격·스킬별 피해'),
            battleRows(member.damageBySource, 'damage', '피해 기록 없음')
        );

        const reductionItems = [
            { name: '방어력', value: reduced.defense },
            { name: '속성 저항', value: reduced.resistance },
            { name: '받는 피해 감소 효과', value: reduced.buff },
            { name: '보호막', value: reduced.shield },
            { name: '회피·대신 받기 등', value: reduced.other }
        ];
        const defenseSection = el('section', { class: 'pq-battle-section defense-section' },
            el('div', { class: 'pq-battle-section-title' }, el('b', null, '생존 분석'), el('span', null, '피해가 줄어든 원인별 합계')),
            battleRows(reductionItems, 'value', '감소한 피해 없음')
        );

        const actionsSection = el('section', { class: 'pq-battle-section actions-section' },
            el('div', { class: 'pq-battle-section-title' }, el('b', null, '행동 기록'), el('span', null, '전투 중 실제 사용 횟수')),
            el('div', { class: 'pq-battle-action-grid' },
                battleMetric('공격 횟수', member.attackCount, 'attack', '회'),
                battleMetric('스킬 사용', member.skillUseCount, 'skill', '회'),
                battleMetric('물약 사용', member.potionUseCount, 'potion', '회')
            ),
            el('div', { class: 'pq-battle-subtitle' }, '스킬 사용 내역'),
            battleCountList(member.skillUses, '사용한 스킬 없음'),
            el('div', { class: 'pq-battle-subtitle potion-title' }, '물약 사용 내역'),
            battleCountList(member.potionUses, '사용한 물약 없음')
        );

        return el('div', { class: 'pq-battle-member-detail' }, head, metrics,
            el('div', { class: 'pq-battle-detail-grid' }, damageSection, defenseSection, actionsSection)
        );
    }

    function renderBattleStatistics(statistics) {
        const members = Array.isArray(statistics.members) ? statistics.members : [];
        const party = statistics.party || {};
        if (!members.length) return el('div', { class: 'pq-battle-empty' }, '전투 통계가 없습니다.');
        if (!selectedResultMember || !members.some(member => member.name === selectedResultMember)) {
            selectedResultMember = members.some(member => member.name === me) ? me : members[0].name;
        }
        const root = el('div', { class: 'pq-battle-stats' });
        root.append(el('div', { class: 'pq-battle-title' },
            el('div', null, el('span', null, 'BATTLE REPORT'), el('h3', null, '전투 통계')),
            el('b', null, battleDuration(statistics.durationSeconds))
        ));
        root.append(el('div', { class: 'pq-battle-party-summary' },
            battleMetric('파티 전체 딜량', party.damage, 'damage'),
            battleMetric('받은 피해량', party.damageTaken, 'taken'),
            battleMetric('감소한 피해량', party.damageReduced, 'reduced'),
            battleMetric('총 회복 기여', Number(party.healing || 0) + Number(party.allyHealing || 0), 'healing')
        ));

        const detail = el('div', { class: 'pq-battle-detail-host' });
        const selector = el('div', { class: 'pq-battle-member-tabs', role: 'tablist', 'aria-label': '파티원 전투 통계' });
        const buttons = [];
        const selectMember = name => {
            selectedResultMember = name;
            buttons.forEach(button => {
                const active = button.getAttribute('data-member') === name;
                button.classList.toggle('active', active);
                button.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            const member = members.find(item => item.name === name) || members[0];
            detail.replaceChildren(renderBattleMemberDetail(member));
        };
        members.forEach((member, index) => {
            const card = member.card || {};
            const thumb = el('span', { class: 'pq-battle-tab-thumb' });
            if (card.imageUrl) thumb.append(el('img', { src: card.imageUrl, alt: '' }));
            else thumb.append(String(index + 1));
            const button = el('button', { class: 'pq-battle-member-tab', type: 'button', role: 'tab', 'data-member': member.name, onClick: () => selectMember(member.name) },
                thumb,
                el('span', { class: 'pq-battle-tab-copy' },
                    el('b', null, member.name || '-'),
                    el('small', null, battleNumber(member.damage) + ' · ' + Number(member.damageShare || 0).toFixed(1) + '%')
                )
            );
            buttons.push(button);
            selector.append(button);
        });
        root.append(selector, detail);
        selectMember(selectedResultMember);
        return root;
    }

    function openRewardModal(rewards) {
        const root = $('#pqRewardList');
        root.replaceChildren();
        (rewards || []).forEach(rv => {
            // 부타게임은 기본 보상 여러 개 + 추가 보상 1개 → items 배열, 그 외는 단일 item
            const list = Array.isArray(rv.items) && rv.items.length ? rv.items : (rv.item ? [rv.item] : []);
            const item = list.find(x => x && x.bonus) || rv.item || list[0] || {};
            const thumb = el('div', { class: 'pq-reward-thumb' });
            const frameUrl = item.frameUrl || ('/item-image?dir=' + encodeURIComponent('프레임') + '&file=' + encodeURIComponent(Number(item.rewardIndex || 0) === 1 ? '특수.png' : '아이템.png'));
            thumb.append(el('img', { class: 'frame', src: frameUrl, alt: '' }));
            if (item.iconUrl) thumb.append(el('img', { class: 'icon', src: item.iconUrl, alt: item.name || '' }));
            else thumb.append(el('span', { class: 'fallback' }, '🎁'));
            const lines = [];
            if (rv.exp) lines.push('XP +' + Number(rv.exp || 0).toLocaleString());
            if (rv.gold) lines.push('골드 +' + Number(rv.gold || 0).toLocaleString());
            if (rv.levelUps) lines.push('레벨업 +' + rv.levelUps);
            root.append(el('div', { class: 'pq-reward-row' },
                thumb,
                el('div', { class: 'info' },
                    el('div', { class: 'owner' }, rv.name || '-'),
                    rv.weeklyLocked
                        ? el('div', { class: 'item', style: 'color:#fbbf24' }, '이번 주 보상을 이미 수령했습니다')
                        : list.length
                            ? el('div', { class: 'item' }, ...list.map(it => el('div', null, (it.bonus ? '✨ ' : '') + it.name + (it.count > 1 ? ' x' + Number(it.count).toLocaleString() : ''))))
                            : el('div', { class: 'item' }, rv.error || '보상 없음'),
                    lines.length ? el('div', { class: 'meta' }, lines.join(' · ')) : null
                )
            ));
        });
        $('#pqRewardBg').classList.add('active');
    }

    function openFirstClearModal(fc) {
        if (!fc) return;
        const titleEl = $('#pqFirstClearTitle');
        if (titleEl) titleEl.textContent = (fc.questName || '') + ' 최초 클리어!';
        const root = $('#pqFirstClearList');
        root.replaceChildren();
        (fc.rewards || []).forEach(rw => {
            const thumb = el('div', { class: 'pq-fc-thumb' });
            if (rw.kind === 'item') {
                thumb.append(el('img', { class: 'frame', src: rw.frameUrl || ('/item-image?dir=' + encodeURIComponent('프레임') + '&file=' + encodeURIComponent('아이템.png')), alt: '' }));
                if (rw.iconUrl) thumb.append(el('img', { class: 'icon', src: rw.iconUrl, alt: rw.name || '' }));
                else thumb.append(el('span', { class: 'fallback' }, '🎁'));
            } else if (rw.kind === 'gold' || rw.kind === 'garnet') {
                thumb.append(el('img', { class: 'icon', src: '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent((rw.kind === 'gold' ? '골드' : '가넷') + '.png'), alt: rw.name || '' }));
            } else {
                thumb.append(el('span', { class: 'fallback' }, '🏆'));
            }
            let amount;
            if (rw.kind === 'item') amount = 'x' + (rw.count || 1);
            else if (rw.kind === 'gold' || rw.kind === 'garnet') amount = '+' + Number(rw.count || 0).toLocaleString();
            else amount = '획득';
            root.append(el('div', { class: 'pq-fc-row' },
                thumb,
                el('div', { class: 'pq-fc-name' }, rw.kind === 'title' ? '칭호 「' + rw.name + '」' : rw.name),
                el('div', { class: 'pq-fc-amount' }, amount)
            ));
        });
        $('#pqFirstClearBg').classList.add('active');
    }

    function renderMobStage(snap) {
        const wrap = el('div', { id: 'pqMobStage', class: 'pq-stage-mob' });
        wrap.append(el('div', { class: 'lbl' }, '잡몹 처치'));
        wrap.append(el('div', { id: 'pqMobCount', class: 'n' }, (snap.sharedKillCount || 0).toLocaleString() + ' / ' + (snap.killTarget || 0).toLocaleString()));
        const bar = el('div', { class: 'pq-prog gauge' }, el('div', { id: 'pqMobBarFill', class: 'fill' }));
        wrap.append(bar);
        const pct = (snap.killTarget > 0 ? (snap.sharedKillCount / snap.killTarget) : 0) * 100;
        bar.firstChild.style.width = Math.min(100, pct) + '%';
        updateAttackBtn();
        return wrap;
    }

    function updateMobCounter(total, target) {
        const c = document.getElementById('pqMobCount');
        const f = document.getElementById('pqMobBarFill');
        if (c) c.textContent = (total || 0).toLocaleString() + ' / ' + (target || 0).toLocaleString();
        if (f) f.style.width = Math.min(100, (target > 0 ? (total / target) : 0) * 100) + '%';
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
        if (payload.kills > 1) pop.append(el('span', { class: 'sub' }, '×' + payload.kills.toLocaleString() + ' 처치'));
        else if (payload.skill) pop.append(el('span', { class: 'sub' }, payload.skill));
        if (hasFixed) pop.append(el('span', { class: 'sub fixed-label' }, '고정 ' + Number(payload.fixedDamage || 0).toLocaleString()));
        if (hasDestiny) pop.append(el('span', { class: 'sub fixed-label' }, '운명 ' + Number(payload.destinyDamage || 0).toLocaleString()));
        const offsetX = illustHost ? (30 + Math.random() * 40) : (50 + (Math.random() * 30 - 15));
        const offsetY = illustHost ? (20 + Math.random() * 40) : null;
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
        return m ? (m.name || '') + '|' + (m.image || '') : '';
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
        if (hasIllust) {
            const illustWrap = el('div', { id: 'pqBossIllust', class: 'pq-stage-illust' });
            illustWrap.append(el('img', { id: 'pqBossIllustImg', src: m.image, alt: m.name, draggable: 'false' }));
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
        hud.append(el('div', { id: 'pqBossPattern', class: 'pq-boss-pattern', style: m.nextPattern ? '' : 'display:none' }, m.nextPattern || ''));
        wrap.append(hud);
        updateEnrageLabel(m);
        updateAttackBtn();
        return wrap;
    }

    function updateBossMonster(monster) {
        if (!monster) return;
        updateEnrageLabel(monster);
        // 폭주 모드 등으로 일러스트/이름이 바뀌면 스테이지를 다시 그린다
        const sig = bossStageSigOf(monster);
        if (bossStageSig && bossStageSig !== sig && currentRoom) {
            const stage = document.getElementById('pqPhaseStage');
            if (stage && document.getElementById('pqBossStage')) {
                stage.replaceChildren(renderBossStage(currentRoom));
                return;
            }
        }
        applyBossHpWidths(monster);
        const hpVal = document.getElementById('pqBossHpVal');
        const gaugeFill = document.getElementById('pqBossGaugeFill');
        const stun = document.getElementById('pqBossStun');
        const pattern = document.getElementById('pqBossPattern');
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
        if (pattern) {
            pattern.style.display = monster.nextPattern ? '' : 'none';
            pattern.textContent = monster.nextPattern || '';
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
            if (m.card) img.append(el('span', { class: 'star' }, '★' + (Number(m.card.star || 0) + 1)));
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

    function renderPotionSummary(snap) {
        const sum = $('#pqPotionSummary');
        if (!sum) return;
        const myMember = snap.members.find(m => m.name === me);
        const list = (myMember && myMember.potions) || [];
        const limit = snap.potionLimit || 0;
        sum.replaceChildren();
        const total = list.reduce((s, p) => s + Number(p.count || 0), 0);
        sum.append(el('div', { style: 'color:#94a3b8;margin-bottom:4px' }, '휴대: ' + total + ' / ' + limit));
        if (!list.length) {
            sum.append(el('div', { style: 'color:#64748b;font-style:italic' }, '선택된 물약이 없습니다.'));
            return;
        }
        const wrap = el('div');
        for (const p of list) {
            wrap.append(el('span', { class: 'pq-potion-chip' }, p.name + ' × ' + p.count));
        }
        sum.append(wrap);
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
            const row = el('div', { class: 'pq-potion-row' });
            row.append(el('div', { class: 'nm' }, p.name));
            const stepper = el('div', { class: 'pq-potion-stepper' });
            const input = el('input', { type: 'number', min: '0', max: String(p.count), value: String(state[p.name] || 0) });
            const minus = el('button', { type: 'button', onClick: () => {
                const cur = Number(input.value) || 0;
                input.value = String(Math.max(0, cur - 1));
                state[p.name] = Number(input.value);
                refreshTotalDisplay();
            } }, '−');
            const plus = el('button', { type: 'button', onClick: () => {
                const cur = Number(input.value) || 0;
                const max = Math.min(p.count, cur + 1);
                if (totalSelected() - (state[p.name] || 0) + max > limit) { toast('휴대 한도 초과'); return; }
                input.value = String(max);
                state[p.name] = max;
                refreshTotalDisplay();
            } }, '+');
            input.addEventListener('change', () => {
                let n = Math.max(0, Math.floor(Number(input.value) || 0));
                n = Math.min(p.count, n);
                if (totalSelected() - (state[p.name] || 0) + n > limit) {
                    n = Math.max(0, limit - (totalSelected() - (state[p.name] || 0)));
                    toast('휴대 한도에 맞게 조정되었습니다.');
                }
                input.value = String(n);
                state[p.name] = n;
                refreshTotalDisplay();
            });
            stepper.append(minus, input, plus);
            const right = el('div', { style: 'display:flex;flex-direction:column;align-items:flex-end;gap:4px' },
                el('div', { class: 'own' }, '보유 ' + p.count),
                stepper
            );
            row.append(right);
            row.append(el('div', { class: 'ef' }, p.desc));
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
        const sig = list.map(p => p.name + ':' + p.count).join('|');
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
                class: 'pq-skill-btn',
                'data-kind': 'potion',
                disabled: cdRemain > 0 || (r && r.dead) ? true : false,
                onClick: async () => {
                    playSfx('potion');
                    myCD.potion = Math.max(myCD.potion, Date.now() + 3000);
                    applyMyDeadlinesToRuntime();
                    updateSkillPotionButtons();
                    try { await api('/api/party/use-potion', { method: 'POST', body: JSON.stringify({ name: p.name }) }); } catch (e) { toast(e.message); }
                }
            },
                keyCode ? el('span', { class: 'key' }, keyLabel(keyCode)) : null,
                el('div', null, p.name),
                el('div', { class: 'mp' }, '× ' + p.count),
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
            const blocked = isPassive || (myMember.runtime && myMember.runtime.dead) || remain > 0 || acd > 0 || needCharge;
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
                    s.icon ? el('img', { src: s.icon, alt: s.name, style: 'width:34px;height:34px;object-fit:cover;border-radius:6px' }) : null,
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
            btn.disabled = !(ready && isHost);
            btn.style.outline = ready && isHost ? '2px solid #fbbf24' : '';
        });
    }

    async function useSupportSkillFlow(skillName) {
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
            // 낙관적 로컬 쿨다운 — 행동 쿨 + 스킬 쿨 (시벌론은 서버가 행동 쿨을 초기화하므로 로컬도 초기화)
            const now = Date.now();
            myCD.action = skillName === '시벌론' ? 0 : Math.max(myCD.action, now + getMyActionCooldownMs());
            const cdSec = Math.max(0.5, Number((sd && sd.cd) || 0) * getMySkillCdMul());
            myCD.skills[skillName] = Math.max(myCD.skills[skillName] || 0, now + cdSec * 1000);
            applyMyDeadlinesToRuntime();
            updateSkillPotionButtons();
            updateAttackBtn();
            await api('/api/party/skill', { method: 'POST', body: JSON.stringify(payload) });
        } catch (e) { toast(e.message); }
    }

    function getMySkillCdMul() {
        if (!currentRoom) return 1;
        const myMember = currentRoom.members.find(m => m.name === me);
        if (!myMember) return 1;
        const def = currentRoom.questDef;
        if (!def || !def.positions) return 1;
        const pos = def.positions[myMember.position];
        if (!pos || !pos.stats) return 1;
        return Number(pos.stats.skillCd || 1);
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
        if (!vote) {
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
            $('#pqVoteDone').textContent = dead && !voted ? '전투불능 상태에서는 투표할 수 없습니다.' : '투표 완료 — 결과를 기다리는 중...';
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
            stream = new EventSource('/api/party/stream');
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
        try { await api('/api/party/leave', { method: 'POST', body: JSON.stringify({}) }); } catch (_) {}
        closeStream();
        stopLocalCdTimer();
        hideBattleIntro();
        syncBgm(null);
        lastRoomState = null;
        myCD.action = 0; myCD.potion = 0; myCD.skills = {};
        skillBarSig = '';
        potionBarSig = '';
        localBuffTickAt = 0;
        currentRoom = null;
        await loadLobby();
    }
    $('#pqLeave').onclick = leaveRoom;
    $('#pqPlayLeave').onclick = async () => {
        if (currentRoom && currentRoom.state === 'inProgress' && !(await showConfirm('전투 중입니다. 파티에서 나가시겠습니까?'))) return;
        leaveRoom();
    };
    $('#pqAttackBtn').onclick = manualAttack;

    // 전투 화면 채팅/로그 탭
    function showGameTab(which) {
        $('#pqTabChat').classList.toggle('on', which === 'chat');
        $('#pqTabLog').classList.toggle('on', which === 'log');
        $('#pqPlayChat').style.display = which === 'chat' ? '' : 'none';
        $('#pqPlayChatForm').style.display = which === 'chat' ? '' : 'none';
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
            bgm.volume = sound.bgm;
            if (sound.bgm <= 0) bgm.pause();
            else if (bgmWanted && bgm.paused) bgm.play().catch(() => {});
            $('#pqVolBgmVal').textContent = Math.round(sound.bgm * 100) + '%';
            saveSound();
        });
        $('#pqVolSfx').addEventListener('input', e => {
            sound.sfx = clamp01(Number(e.target.value) / 100);
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
        if (!currentRoom) return;
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
