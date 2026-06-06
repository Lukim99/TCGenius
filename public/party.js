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

    function showNotice(text, kind, ttl) {
        const stack = $('#pqNoticeStack');
        const node = el('div', { class: 'pq-notice ' + (kind || 'info') }, text);
        stack.append(node);
        setTimeout(() => { node.style.transition = 'opacity .3s'; node.style.opacity = '0'; }, Math.max(800, (ttl || 4000) - 300));
        setTimeout(() => { node.remove(); }, ttl || 4000);
        // 5개 초과 시 가장 오래된 제거
        while (stack.childElementCount > 5) stack.firstElementChild.remove();
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
            for (const b of buffs) b.remain = Math.max(0, Number(b.remain || 0) - dt);
        }
    }

    function updateBuffChips() {
        if (!currentRoom) return;
        $$('.pq-party-row[data-member]').forEach(row => {
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
                remain = Number(b && b.remain || 0);
            }
            if (remain > 0) {
                const label = chip.dataset.label || buffId || '버프';
                chip.textContent = label + ' ' + remain.toFixed(1) + 's';
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
        $$('.pq-skill-btn[data-kind="skill"]').forEach(btn => {
            const skillName = btn.dataset.skill || '';
            const isPassive = btn.dataset.passive === '1';
            const remain = Number((r.cooldowns && r.cooldowns[skillName]) || 0);
            const blocked = isPassive || dead || remain > 0 || acd > 0;
            btn.disabled = blocked;
            const cd = btn.querySelector('.cd');
            const text = remain > 0 ? remain.toFixed(1) : (acd > 0 && !isPassive ? acd.toFixed(1) : '');
            if (cd) {
                cd.textContent = text;
                cd.style.display = text ? '' : 'none';
            }
        });
        $$('.pq-skill-btn[data-kind="potion"]').forEach(btn => {
            btn.disabled = dead || pcd > 0;
            const cd = btn.querySelector('.cd');
            if (cd) {
                cd.textContent = pcd > 0 ? pcd.toFixed(1) : '';
                cd.style.display = pcd > 0 ? '' : 'none';
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
        const blocked = dead || currentRoom.awaitingChoices || acd > 0;
        btn.disabled = blocked;
        btn.textContent = acd > 0 ? ('⏳ ' + acd.toFixed(1) + 's') : '⚔ 공격';
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
            meta.append(el('span', { class: 'pq-pill' }, '👥 ' + r.memberCount + '/' + r.maxPlayers));
            if (r.hasPassword) meta.append(el('span', { class: 'pq-pill lock' }, '🔒 비공개'));
            meta.append(el('span', { class: 'pq-pill' }, r.state === 'lobby' ? '대기 중' : '준비 중'));
            const card = el('div', { class: 'pq-room-card', onClick: () => attemptJoin(r) },
                el('div', null,
                    el('div', { class: 'pq-room-quest' }, r.questName),
                    el('div', { class: 'pq-room-title' }, r.hostName + '님의 파티')
                ),
                el('div', { style: 'align-self:center;color:#a5b4fc;font-weight:800' }, '→'),
                meta
            );
            root.append(card);
        }
    }

    function populateQuestSelect() {
        const sel = $('#pqCreateQuest');
        sel.replaceChildren();
        for (const q of questDefs) {
            sel.append(el('option', { value: q.id }, q.name));
        }
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

    // ====== 방 화면 ======
    function applyRoomSnapshot(snap) {
        currentRoom = snap;
        localBuffTickAt = Date.now();
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
                    el('div', { class: 'pq-name' }, m.name, tags),
                    el('div', { class: 'pq-pos' + (m.position ? ' set' : '') }, m.position || '포지션 미선택')
                ),
                el('div', null)
            );
            root.append(row);
        }
    }

    function renderPositions(snap) {
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
        const shouldStick = log.scrollTop + log.clientHeight >= log.scrollHeight - 12;
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
            readyBtn.disabled = !myMember.position;
        }
        const allReady = snap.members.length > 0 && snap.members.every(m => m.position && m.ready);
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
        $('#pqPhaseLabel').textContent = snap.phaseType ? snap.phaseType.toUpperCase() : 'PHASE';
        $('#pqPhaseName').textContent = snap.phaseName || '-';

        const stage = $('#pqPhaseStage');
        if (snap.state === 'cleared' || snap.state === 'failed') {
            stage.replaceChildren(renderResult(snap));
        } else if (snap.phaseType === 'mob') {
            if (!document.getElementById('pqMobStage')) stage.replaceChildren(renderMobStage(snap));
            else updateMobStage(snap);
        } else if (snap.phaseType === 'elite' || snap.phaseType === 'boss') {
            if (!snap.monster) { stage.replaceChildren(); }
            else if (!document.getElementById('pqBossStage')) stage.replaceChildren(renderBossStage(snap));
            else updateBossStage(snap);
        } else {
            stage.replaceChildren();
        }

        renderPlayMembers(snap);
        renderSkillBar(snap);
        renderPotionBar(snap);
        if (snap.state === 'cleared' && snap.result && Array.isArray(snap.result.rewards) && snap.result.rewards.length && shownRewardRoomId !== snap.id) {
            shownRewardRoomId = snap.id;
            openRewardModal(snap.result.rewards);
        }
    }

    function renderResult(snap) {
        const r = snap.result || {};
        const cls = r.cleared ? 'cleared' : 'failed';
        const wrap = el('div', { class: 'pq-panel pq-result ' + cls });
        wrap.append(el('div', { class: 'big' }, r.cleared ? '🎉 클리어!' : '💀 실패'));
        wrap.append(el('div', { style: 'color:#cbd5e1;font-size:13px' }, r.reason || ''));
        if (r.cleared && r.rewards && r.rewards.length) {
            wrap.append(el('button', { class: 'pq-btn primary', type: 'button', onClick: () => openRewardModal(r.rewards) }, '🎁 파티 보상 확인'));
        } else if (r.cleared) {
            wrap.append(el('div', { style: 'color:#94a3b8;font-size:12px' }, '보상 지급 중...'));
        }
        if (snap.hostName === me) {
            const btn = el('button', { class: 'pq-btn', type: 'button', style: 'margin-top:12px' }, '🔄 다시 도전');
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                try {
                    const res = await fetch('/api/party/restart', { method: 'POST' });
                    const data = await res.json();
                    if (data.error) { alert(data.error); btn.disabled = false; }
                } catch (_) { btn.disabled = false; }
            });
            wrap.append(btn);
        }
        return wrap;
    }

    function openRewardModal(rewards) {
        const root = $('#pqRewardList');
        root.replaceChildren();
        (rewards || []).forEach(rv => {
            const item = rv.item || {};
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
                    el('div', { class: 'item' }, item.name ? item.name + (item.count > 1 ? ' x' + item.count : '') : (rv.error || '보상 없음')),
                    lines.length ? el('div', { class: 'meta' }, lines.join(' · ')) : null
                )
            ));
        });
        $('#pqRewardBg').classList.add('active');
    }

    function renderMobStage(snap) {
        const wrap = el('div', { class: 'pq-mob-counter' });
        wrap.append(el('div', { class: 'lbl' }, '잡몹 처치'));
        wrap.append(el('div', { id: 'pqMobCount', class: 'n' }, (snap.sharedKillCount || 0).toLocaleString() + ' / ' + (snap.killTarget || 0).toLocaleString()));
        const bar = el('div', { class: 'pq-prog gauge', style: 'width:100%' }, el('div', { id: 'pqMobBarFill', class: 'fill' }));
        wrap.append(bar);
        const pct = (snap.killTarget > 0 ? (snap.sharedKillCount / snap.killTarget) : 0) * 100;
        bar.firstChild.style.width = Math.min(100, pct) + '%';
        const myMember = snap.members.find(m => m.name === me);
        const r = myMember && myMember.runtime;
        const dead = !myMember || (r && r.dead);
        const acd = r && r.actionCdRemain ? r.actionCdRemain : 0;
        const btn = el('button', {
            id: 'pqAttackBtn',
            class: 'pq-attack-btn',
            disabled: dead || snap.awaitingChoices || acd > 0 ? true : false,
            onClick: manualAttack
        }, acd > 0 ? ('⏳ ' + acd.toFixed(1) + 's') : '⚔ 공격');
        const container = el('div', { id: 'pqMobStage', class: 'pq-mob-stage' }, wrap, btn);
        return container;
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

    function makeHpBar(r, className) {
        const hp = el('div', { class: 'pq-prog hp' + (className ? ' ' + className : '') }, el('div', { class: 'fill' }));
        hp.firstChild.style.width = hpPct(r) + '%';
        return hp;
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
        main.textContent = (payload.crit ? '✦ ' : '') + '-' + Number(payload.damage || 0).toLocaleString();
        pop.append(main);
        if (payload.comboTotal > 1) pop.append(el('span', { class: 'sub combo-label' }, payload.comboIndex + '/' + payload.comboTotal + ' HIT'));
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
        if (isMe) {
            const btn = document.getElementById('pqAttackBtn');
            if (btn) {
                btn.classList.add('flash');
                setTimeout(() => btn.classList.remove('flash'), 120);
            }
        }
    }

    function renderBossStage(snap) {
        const m = snap.monster;
        if (!m) return el('div');
        const myMember = snap.members.find(mm => mm.name === me);
        const r = myMember && myMember.runtime;
        const dead = !myMember || (r && r.dead);
        const acd = r && r.actionCdRemain ? r.actionCdRemain : 0;
        const hasIllust = snap.questId === 'blackHodu' && snap.phaseType === 'boss';
        const wrap = el('div', { id: 'pqBossStage', class: 'pq-mob-stage' + (hasIllust ? ' has-illust' : '') });
        const boss = el('div', { class: 'pq-boss' + (hasIllust ? ' boss-illust-mode' : '') });
        boss.append(el('div', { class: 'pq-boss-head' },
            el('div', { class: 'pq-boss-name' }, m.name, el('span', { id: 'pqBossStun', style: Number(m.stunRemain || 0) > 0 ? 'margin-left:8px;color:#fbbf24;font-size:12px' : 'display:none' }, Number(m.stunRemain || 0) > 0 ? ('기절 ' + Number(m.stunRemain || 0).toFixed(1) + 's') : '')),
            el('div', { id: 'pqBossHpVal', class: 'pq-boss-hpval' }, m.hp + ' / ' + m.hpMax)
        ));
        const hpBar = el('div', { class: 'pq-prog hp' + (hasIllust ? ' boss-hp' : '') }, el('div', { id: 'pqBossHpFill', class: 'fill' }));
        hpBar.firstChild.style.width = (m.hpMax > 0 ? (m.hp / m.hpMax * 100) : 0) + '%';
        boss.append(hpBar);
        const gBar = el('div', { class: 'pq-prog gauge' }, el('div', { id: 'pqBossGaugeFill', class: 'fill' }));
        gBar.firstChild.style.width = (m.gauge || 0) + '%';
        boss.append(gBar);
        boss.append(el('div', { id: 'pqBossPattern', style: m.nextPattern ? 'color:#fbbf24;font-size:12px;font-weight:800;text-align:center' : 'display:none' }, m.nextPattern || ''));
        if (hasIllust) {
            const illustWrap = el('div', { id: 'pqBossIllust', class: 'pq-boss-illust-wrap' });
            const img = el('img', { class: 'pq-boss-illust', src: '../DB/RPGenius/ui/흑화 호두.png', alt: '흑화 호두', draggable: 'false' });
            illustWrap.append(img);
            boss.append(illustWrap);
        }
        const btn = el('button', {
            id: 'pqAttackBtn',
            class: 'pq-attack-btn',
            disabled: dead || snap.awaitingChoices || acd > 0 ? true : false,
            onClick: manualAttack
        }, acd > 0 ? ('⏳ ' + acd.toFixed(1) + 's') : '⚔ 공격');
        wrap.append(boss, btn);
        return wrap;
    }

    function updateBossMonster(monster) {
        if (!monster) return;
        const hpVal = document.getElementById('pqBossHpVal');
        const hpFill = document.getElementById('pqBossHpFill');
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
        if (hpVal) hpVal.textContent = monster.hp + ' / ' + monster.hpMax;
        if (hpFill) hpFill.style.width = (monster.hpMax > 0 ? (monster.hp / monster.hpMax * 100) : 0) + '%';
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
        const grid = el('div', { class: 'pq-party-mini-grid' });
        for (const m of snap.members) {
            if (m.name === me) continue;
            const r = m.runtime;
            const isTaunt = (snap.monster && snap.monster.tauntTarget === m.name) || (snap.tauntTarget === m.name && Number(snap.tauntRemain || 0) > 0);
            const row = el('div', {
                class: 'pq-party-row pq-party-mini' + (r && r.dead ? ' dead' : '') + (isTaunt ? ' taunt' : ''),
                'data-member': m.name
            });
            row.append(el('div', { class: 'ph' },
                el('div', { class: 'nm' }, m.name + (m.name === me ? ' (나)' : '')),
                el('div', { class: 'pos' }, m.position || '-')
            ));
            if (r) {
                row.append(makeHpBar(r));
                const mp = el('div', { class: 'pq-prog mp' }, el('div', { class: 'fill' }));
                mp.firstChild.style.width = (r.mpMax > 0 ? (r.mp / r.mpMax * 100) : 0) + '%';
                row.append(mp);
            }
            grid.append(row);
        }
        root.append(grid);
        const mine = snap.members.find(m => m.name === me);
        if (mine && mine.runtime) {
            const buffs = [];
            if ((snap.monster && snap.monster.tauntTarget === me) || (snap.tauntTarget === me && Number(snap.tauntRemain || 0) > 0)) buffs.push({ id: 'taunt', label: '도발', remain: snap.tauntRemain || (snap.monster && snap.monster.tauntRemain) || 0 });
            (mine.runtime.buffs || []).forEach(b => buffs.push(b));
            root.append(el('div', { class: 'pq-my-hp' },
                el('div', { class: 'top' }, el('span', null, '내 체력'), el('span', null, hpPct(mine.runtime).toFixed(1) + '%')),
                makeHpBar(mine.runtime),
                el('div', { class: 'vals' }, el('span', null, mine.runtime.hp + ' / ' + mine.runtime.hpMax), el('span', null, 'MP ' + mine.runtime.mp + ' / ' + mine.runtime.mpMax)),
                makeMpBar(mine.runtime),
                buffs.length ? el('div', { class: 'pq-buff-row pq-my-buffs' },
                    ...buffs.map(b => {
                        const label = b.label || b.id || '버프';
                        return el('span', {
                            class: 'pq-buff-chip',
                            'data-member': me,
                            'data-buff-id': b.id === 'taunt' || label === '도발' ? 'taunt' : String(b.id || b.label || ''),
                            'data-label': label
                        }, label + (Number(b.remain || 0) > 0 ? ' ' + Number(b.remain || 0).toFixed(1) + 's' : ''));
                    })
                ) : null
            ));
        }
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
            wrap.append(el('span', { class: 'pq-potion-chip' }, '🧪 ' + p.name + ' × ' + p.count));
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
        for (const p of list) {
            const btn = el('button', {
                class: 'pq-skill-btn',
                'data-kind': 'potion',
                disabled: cdRemain > 0 || (r && r.dead) ? true : false,
                onClick: async () => {
                    myCD.potion = Math.max(myCD.potion, Date.now() + 3000);
                    applyMyDeadlinesToRuntime();
                    updateSkillPotionButtons();
                    try { await api('/api/party/use-potion', { method: 'POST', body: JSON.stringify({ name: p.name }) }); } catch (e) { toast(e.message); }
                }
            },
                el('div', null, '🧪 ' + p.name),
                el('div', { class: 'mp' }, '× ' + p.count),
                el('div', { class: 'cd', style: cdRemain > 0 ? '' : 'display:none' }, cdRemain > 0 ? cdRemain.toFixed(1) : '')
            );
            bar.append(btn);
        }
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
        for (const skillName of myMember.skills) {
            const sd = skillDefs[skillName] || {};
            const remain = cooldowns[skillName] || 0;
            const isPassive = sd.type === 'passive';
            const blocked = isPassive || (myMember.runtime && myMember.runtime.dead) || remain > 0 || acd > 0;
            const overlay = remain > 0 ? remain.toFixed(1) : (acd > 0 && !isPassive ? acd.toFixed(1) : null);
            const btn = el('button', {
                class: 'pq-skill-btn',
                'data-kind': 'skill',
                'data-skill': skillName,
                'data-passive': isPassive ? '1' : '0',
                disabled: blocked ? true : false,
                onClick: () => useSkillFlow(skillName, sd)
            },
                el('div', null, skillName),
                isPassive ? el('div', { class: 'mp' }, '패시브') : (sd.mp ? el('div', { class: 'mp' }, 'MP ' + sd.mp) : null),
                el('div', { class: 'cd', style: overlay ? '' : 'display:none' }, overlay || '')
            );
            bar.append(btn);
        }
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
            // 낙관적 로컬 쿨다운 — 행동 쿨 + 스킬 쿨
            const now = Date.now();
            myCD.action = Math.max(myCD.action, now + getMyActionCooldownMs());
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
        $('#pqCreateBg').classList.add('active');
    };
    $('#pqCreateCancel').onclick = () => $('#pqCreateBg').classList.remove('active');
    $('#pqCreateConfirm').onclick = async () => {
        const questId = $('#pqCreateQuest').value;
        const password = $('#pqCreatePw').value;
        try {
            await api('/api/party/rooms', { method: 'POST', body: JSON.stringify({ questId, password }) });
            $('#pqCreateBg').classList.remove('active');
            await afterEnterRoom();
        } catch (e) { toast(e.message); }
    };

    $('#pqJoinCancel').onclick = () => $('#pqJoinBg').classList.remove('active');

    $('#pqOpenPotion').onclick = () => openPotionModal();
    $('#pqPotionCancel').onclick = () => $('#pqPotionBg').classList.remove('active');
    $('#pqRewardClose').onclick = () => $('#pqRewardBg').classList.remove('active');

    async function leaveRoom() {
        try { await api('/api/party/leave', { method: 'POST', body: JSON.stringify({}) }); } catch (_) {}
        closeStream();
        stopLocalCdTimer();
        myCD.action = 0; myCD.potion = 0; myCD.skills = {};
        skillBarSig = '';
        potionBarSig = '';
        localBuffTickAt = 0;
        currentRoom = null;
        await loadLobby();
    }
    $('#pqLeave').onclick = leaveRoom;
    $('#pqPlayLeave').onclick = leaveRoom;

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
