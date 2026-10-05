// 레이드 공통 패턴 HUD. 대저택의 입력 기믹도 같은 카드 구조로 표시한다.
// party.js가 고정 dock에 SSE마다 MansionRaidUI.update(root, view, { me, host, send })를 호출한다.
// 사건은 id로 키잉해 한 번만 만들고 이후에는 숫자·상태만 패치한다 (누르던 버튼 교체·초점 유실 방지).
(() => {
    'use strict';

    const LETTERS = ['a', 'b', 'c', 'd', 'e'];
    const PILLAR_NAMES = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];
    const PILLAR_SCALE = 12;
    const PILLAR_CD_MS = 500;
    const OUTCOME_MS = 2600;
    const ERROR_MS = 2500;
    const URGENT_SEC = 1.5;
    const MY_TURN = '◆ 내 차례';
    const DIFFICULTY_LABEL = { normal: 'NORMAL', hard: 'HARD', nightmare: 'NIGHTMARE' };
    const FORM_LABEL = { body: '본체', echo: '잔향', transition: '잔향 전환' };

    const roots = new WeakMap();
    const local = new Map(); // eventId -> 이 클라이언트만 아는 입력 상태
    const shownOutcomes = new Set(); // 루트가 다시 만들어져도 결과 연출은 id당 1회

    // ===== DOM 헬퍼 =====
    function node(tag, cls, text) {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = String(text);
        return n;
    }
    // click만 받는다 — 터치·마우스·키보드 모두 1회만 발생 (pointerdown과 겹쳐 두 번 보내지 않음)
    function button(cls, text, onPress) {
        const b = node('button', cls, text);
        b.type = 'button';
        b.addEventListener('click', e => {
            if (b.getAttribute('aria-disabled') === 'true') { e.preventDefault(); return; }
            onPress(e);
        });
        return b;
    }
    function setText(n, text) {
        text = String(text);
        if (n.textContent !== text) n.textContent = text;
    }
    // disabled 속성 대신 aria-disabled — 초점이 버튼에서 튕겨 나가지 않는다
    function setDisabled(b, on) {
        if (on) b.setAttribute('aria-disabled', 'true');
        else b.removeAttribute('aria-disabled');
    }
    function setPressed(b, on) { b.setAttribute('aria-pressed', on ? 'true' : 'false'); }
    const fmt = v => Math.max(0, Math.round(Number(v) || 0)).toLocaleString('ko-KR');
    const pctText = v => (Math.round(v * 10) / 10) + '%';
    const names = list => Array.isArray(list) ? list.filter(Boolean).map(String) : [];

    function loc(id) {
        let s = local.get(id);
        if (!s) {
            s = { from: null, cdUntil: 0, typed: [], inflight: 0, failed: false, chain: null, choice: null, pending: new Set(), err: '', errUntil: 0 };
            local.set(id, s);
        }
        return s;
    }
    function isHost(st) {
        const h = st.ctx.host;
        return h === true || (typeof h === 'string' && !!h && h === st.ctx.me);
    }
    function hostName(st) {
        const h = st.ctx.host;
        if (typeof h === 'string') return h;
        return h === true ? (st.ctx.me || '') : '';
    }
    function fail(ls, e) {
        ls.err = (e && e.message) || '요청 실패';
        ls.errUntil = performance.now() + ERROR_MS;
    }

    // 같은 사건·같은 행동은 응답 전까지 한 번만 보낸다
    function act(st, card, payload, key, onFail) {
        const ls = loc(card.id);
        const send = st.ctx.send;
        if (st.ctx.readOnly || ls.pending.has(key) || typeof send !== 'function') return;
        ls.pending.add(key);
        patchCard(st, card);
        Promise.resolve()
            .then(() => send(Object.assign({ eventId: card.ev.id }, payload)))
            .catch(e => { fail(ls, e); if (onFail) onFail(); })
            .finally(() => {
                ls.pending.delete(key);
                if (st.cards.get(card.id) === card) patchCard(st, card);
            });
    }

    // ===== 기믹별 구성 =====
    const KINDS = {
        raidCue: {
            who: '참여',
            build(st, card) {
                card.progress = node('div', 'mr-cue-progress');
                card.body.append(card.progress);
            },
            patch(st, card) {
                const ev = card.ev, targets = names(ev.targets), responded = names(ev.responded);
                card.progress.hidden = !ev.requiresResponse;
                setText(card.progress, ev.need ? responded.length + ' / ' + ev.need : '참여 ' + responded.length);
                return { mine: targets.includes(st.ctx.me), tag: ev.tag || '시전', who: targets.length ? targets : responded, whoLabel: targets.length ? '대상' : '참여' };
            }
        },
        pillars: {
            who: '이동',
            build(st, card) {
                const grid = node('div', 'mr-pillars');
                card.pillars = PILLAR_NAMES.map((name, i) => {
                    const b = button('mr-pillar', null, () => onPillar(st, card, i));
                    const pick = node('span', 'mr-pillar-pick');
                    const col = node('span', 'mr-pillar-col');
                    const fill = node('i', 'mr-pillar-fill');
                    col.append(fill);
                    const val = node('b', 'mr-pillar-val');
                    b.append(pick, node('span', 'mr-pillar-idx', name), col, val);
                    grid.append(b);
                    return { b, pick, fill, val };
                });
                card.cd = node('div', 'mr-cd');
                card.cdFill = node('i');
                card.cd.append(card.cdFill);
                card.body.append(grid, card.cd);
            },
            patch(st, card, ls) {
                const loads = normLoads(card.ev.loads);
                if (ls.from != null && !(loads[ls.from] > 0)) ls.from = null;
                const lock = card.expired;
                if (lock) ls.from = null;
                card.pillars.forEach((p, i) => {
                    const v = loads[i];
                    const picked = ls.from === i;
                    setText(p.val, v);
                    p.fill.style.height = (Math.min(1, Math.max(0, v) / PILLAR_SCALE) * 100) + '%';
                    setText(p.pick, picked ? '출발' : (ls.from != null ? '도착' : ''));
                    setPressed(p.b, picked);
                    setDisabled(p.b, lock || (ls.from == null && v <= 0));
                    p.b.setAttribute('aria-label', '기둥 ' + (i + 1) + ' 하중 ' + v + (picked ? ' (출발 선택됨)' : ''));
                });
                return {
                    mine: !lock,
                    tag: '전원'
                };
            }
        },

        sculpture: {
            who: '',
            build(st, card) {
                const g = node('div', 'mr-gauge');
                card.gFill = node('i', 'mr-gauge-fill');
                card.gMark = node('i', 'mr-gauge-mark');
                g.append(card.gFill, card.gMark);
                const nums = node('div', 'mr-nums');
                card.dmg = node('b', 'mr-num');
                card.pct = node('span', 'mr-pct');
                nums.append(card.dmg, card.pct);
                card.finish = button('mr-act mr-finish', '완성', () => act(st, card, { action: 'finish' }, 'finish'));
                card.body.append(g, nums, card.finish);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const max = Math.max(1, Number(ev.hpMax) || 1);
                const serverTime = Date.now() - Number(st.ctx.serverOffset || 0);
                const steps = !card.expired && ev.decayNextAt ? Math.max(0, 1 + Math.floor((serverTime - ev.decayNextAt) / 100)) : 0;
                const dmg = Math.min(max, Math.max(0, (Number(ev.damage) || 0) - steps * max / 1000));
                const pct = Math.min(100, dmg / max * 100);
                card.gFill.style.transform = 'scaleX(' + (pct / 100) + ')';
                card.gMark.style.left = pct + '%';
                setText(card.dmg, fmt(dmg) + ' / ' + fmt(max));
                setText(card.pct, pctText(pct));
                const host = isHost(st);
                const hname = hostName(st);
                const pressed = names(ev.responded).includes(st.ctx.me) || ls.pending.has('finish');
                card.finish.hidden = !host;
                const mine = host && !pressed && !card.expired;
                return {
                    mine,
                    tag: host ? '공대장 (나)' : '공대장 ' + hname
                };
            }
        },

        burden: {
            who: '분담',
            build(st, card) {
                const info = node('div', 'mr-split');
                card.split = node('b', 'mr-big');
                info.append(card.split);
                card.support = button('mr-act', '받쳐주기', () => act(st, card, { action: 'support' }, 'support'));
                card.body.append(info, card.support);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const me = st.ctx.me;
                const target = ev.target ? String(ev.target) : '';
                const group = Array.from(new Set([target].concat(names(ev.responded)).filter(Boolean)));
                const count = Math.max(1, group.length);
                setText(card.split, count + '명');
                const meTarget = !!me && target === me;
                const joined = group.includes(me) || ls.pending.has('support');
                card.support.hidden = meTarget;
                setText(card.support, joined ? '✓ 받쳐주는 중' : '받쳐주기');
                setPressed(card.support, joined);
                setDisabled(card.support, joined || card.expired);
                const mine = !meTarget && !joined && !card.expired;
                return {
                    mine,
                    tag: meTarget ? '지정 대상 (나)' : (mine ? MY_TURN : '지정 ' + target),
                    who: group
                };
            }
        },

        blessing: {
            who: '',
            build(st, card) {
                const row = node('div', 'mr-btn-row');
                card.accept = button('mr-act', '받아들이기', () => choose(st, card, 'accept'));
                card.reject = button('mr-act', '거절하기', () => choose(st, card, 'reject'));
                row.append(card.accept, card.reject);
                card.body.append(row);
                card.btnRow = row;
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const target = ev.target ? String(ev.target) : '';
                const meTarget = !!st.ctx.me && target === st.ctx.me;
                const done = names(ev.responded).includes(target) || !!ls.choice;
                card.btnRow.hidden = !meTarget;
                setPressed(card.accept, ls.choice === 'accept');
                setPressed(card.reject, ls.choice === 'reject');
                const lock = done || card.expired || ls.pending.has('choice');
                setDisabled(card.accept, lock);
                setDisabled(card.reject, lock);
                const mine = meTarget && !done && !card.expired;
                return {
                    mine,
                    tag: meTarget ? (mine ? MY_TURN : '대상 (나)') : '대상 ' + target
                };
            }
        },

        dictation: {
            who: '완료',
            build(st, card) {
                const seqWrap = node('div', 'mr-seq-wrap');
                seqWrap.append(node('span', 'mr-row-k', '제시'));
                card.seq = node('div', 'mr-seq');
                seqWrap.append(card.seq);
                const inWrap = node('div', 'mr-seq-wrap mr-input-row');
                inWrap.append(node('span', 'mr-row-k', '입력'));
                card.typed = node('div', 'mr-seq mr-typed');
                inWrap.append(card.typed);
                const keys = node('div', 'mr-keys');
                card.keys = LETTERS.map(letter => {
                    const b = button('mr-act mr-key', letter, () => onLetter(st, card, letter));
                    b.setAttribute('aria-label', '글자 ' + letter);
                    keys.append(b);
                    return b;
                });
                card.seqLen = 0;
                card.body.append(seqWrap, inWrap, keys);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const seq = Array.isArray(ev.sequence) ? ev.sequence.map(c => String(c).toLowerCase()) : [];
                const len = seq.length || (st.view && st.view.difficulty === 'normal' ? 4 : 6);
                if (card.seqLen !== len) {
                    card.seqLen = len;
                    card.seqSlots = rebuildSlots(card.seq, len);
                    card.typedSlots = rebuildSlots(card.typed, len);
                }
                // 서버 입력 기록과 합친다 — 보내는 중에는 로컬이 앞서므로 서버가 따라잡았을 때만 채택
                const answers = ev.answers && st.ctx.me ? ev.answers[st.ctx.me] : null;
                if (Array.isArray(answers)) {
                    const server = answers.map(c => String(c).toLowerCase());
                    if (server.length >= ls.typed.length || (ls.inflight === 0 && ls.failed)) {
                        ls.typed = server.slice(0, len);
                        ls.failed = false;
                    }
                }
                for (let i = 0; i < len; i++) {
                    const s = card.seqSlots[i];
                    setText(s.v, seq[i] || '?');
                    const t = card.typedSlots[i];
                    const c = ls.typed[i];
                    const state = c == null ? (i === ls.typed.length ? 'next' : 'empty') : 'in';
                    t.slot.dataset.state = state;
                    setText(t.v, c || '');
                }
                const full = ls.typed.length >= len;
                const lock = full || card.expired;
                card.keys.forEach(b => setDisabled(b, lock));
                return {
                    mine: !lock,
                    tag: lock ? '전원' : MY_TURN
                };
            }
        },

        pulse: pulseKind(),
        inversion: pulseKind(),

        trial: {
            who: '',
            build(st, card) {
                const info = node('div', 'mr-split');
                card.big = node('b', 'mr-big');
                card.sub = node('span', 'mr-sub');
                info.append(card.big, card.sub);
                card.shieldBar = node('div', 'mr-shield');
                card.shieldFill = node('i');
                card.shieldBar.append(card.shieldFill);
                card.body.append(info, card.shieldBar);
            },
            patch(st, card) {
                const ev = card.ev;
                const shield = ev.stage === 'shield';
                card.node.dataset.stage = shield ? 'shield' : 'record';
                card.shieldBar.hidden = !shield;
                if (shield) {
                    const max = Math.max(1, Number(ev.shieldMax) || 1);
                    const cur = Math.max(0, Number(ev.shield) || 0);
                    setText(card.big, fmt(cur));
                    setText(card.sub, '/ ' + fmt(max) + ' 보호막');
                    card.shieldFill.style.transform = 'scaleX(' + Math.min(1, cur / max) + ')';
                } else {
                    setText(card.big, fmt(ev.recorded));
                    setText(card.sub, '기록');
                }
                return {
                    mine: false,
                    tag: '전원'
                };
            }
        },

        transition: {
            who: '',
            build() {},
            patch() { return { mine: false, tag: '전원' }; }
        }
    };

    function pulseKind() {
        return {
            who: '',
            build(st, card) {
                const cue = node('div', 'mr-cue');
                card.cueWord = node('b', 'mr-cue-word');
                cue.append(card.cueWord);
                const row = node('div', 'mr-btn-row');
                card.absorb = button('mr-act', '흡수', () => choose(st, card, 'absorb'));
                card.release = button('mr-act', '방출', () => choose(st, card, 'release'));
                row.append(card.absorb, card.release);
                card.btnRow = row;
                card.body.append(cue, row);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const cue = ev.pulse === 'scatter' ? 'scatter' : 'gather';
                setText(card.cueWord, ev.cueText || (cue === 'gather' ? '기운이 한점으로 모여듭니다' : '기운이 사방으로 흩어집니다'));
                const target = ev.target ? String(ev.target) : '';
                const meTarget = !!st.ctx.me && target === st.ctx.me;
                const done = names(ev.responded).includes(target) || !!ls.choice;
                card.btnRow.hidden = !meTarget;
                setPressed(card.absorb, ls.choice === 'absorb');
                setPressed(card.release, ls.choice === 'release');
                const lock = done || card.expired || ls.pending.has('choice');
                setDisabled(card.absorb, lock);
                setDisabled(card.release, lock);
                const mine = meTarget && !done && !card.expired;
                return {
                    mine,
                    tag: meTarget ? (mine ? MY_TURN : '담당 (나)') : '담당 ' + target
                };
            }
        };
    }

    function normLoads(loads) {
        const arr = Array.isArray(loads) ? loads : [];
        return [0, 1, 2, 3].map(i => Math.round(Number(arr[i]) || 0));
    }

    function rebuildSlots(row, len) {
        const slots = [];
        row.replaceChildren();
        for (let i = 0; i < len; i++) {
            const slot = node('span', 'mr-slot');
            const v = node('b');
            slot.append(v);
            row.append(slot);
            slots.push({ slot, v });
        }
        return slots;
    }

    function choose(st, card, choice) {
        const ls = loc(card.id);
        if (ls.choice || card.expired || typeof st.ctx.send !== 'function') return;
        ls.choice = choice;
        // 실패하면 다시 고를 수 있게 되돌린다
        act(st, card, { action: choice }, 'choice', () => { ls.choice = null; });
    }

    function onPillar(st, card, i) {
        const ls = loc(card.id);
        const loads = normLoads(card.ev.loads);
        if (ls.from == null) {
            if (loads[i] > 0) ls.from = i;
        } else if (ls.from === i) {
            ls.from = null;
        } else {
            const now = performance.now();
            if (now < ls.cdUntil || ls.pending.has('transfer')) return;
            ls.cdUntil = now + PILLAR_CD_MS;
            // 출발 선택은 유지 — 같은 기둥에서 연속으로 옮길 수 있다
            act(st, card, { action: 'transfer', from: ls.from, to: i }, 'transfer');
        }
        patchCard(st, card);
    }

    function onLetter(st, card, letter) {
        const ls = loc(card.id);
        const send = st.ctx.send;
        if (st.ctx.readOnly || card.expired || ls.typed.length >= card.seqLen || typeof send !== 'function') return;
        ls.typed.push(letter);
        ls.inflight++;
        // 글자 순서가 서버에 그대로 도착하도록 직렬로 보낸다
        ls.chain = (ls.chain || Promise.resolve())
            .then(() => send({ eventId: card.ev.id, action: 'letter', letter }))
            .catch(e => { ls.failed = true; fail(ls, e); })
            .finally(() => {
                ls.inflight--;
                if (st.cards.get(card.id) === card) patchCard(st, card);
            });
        patchCard(st, card);
    }

    // ===== 카드 =====
    function buildCard(st, ev) {
        const kind = String(ev.kind || '');
        const spec = KINDS[kind];
        const card = { id: String(ev.id), kind, ev, spec, deadline: 0, duration: 0, lastTime: '', expired: false, whoSig: null };
        if (!spec) return buildForecast(st, card);
        const n = node('section', 'mr-ev');
        n.dataset.kind = kind;
        const head = node('div', 'mr-ev-head');
        card.tag = node('span', 'mr-ev-tag');
        card.title = node('b', 'mr-ev-title');
        card.time = node('span', 'mr-ev-time');
        card.time.setAttribute('aria-hidden', 'true');
        head.append(card.tag, card.title, card.time);
        card.message = node('div', 'mr-ev-message');
        const bar = node('div', 'mr-ev-bar');
        card.barFill = node('i');
        bar.append(card.barFill);
        card.body = node('div', 'mr-ev-body');
        card.who = node('div', 'mr-ev-who');
        card.err = node('div', 'mr-ev-err');
        card.err.setAttribute('role', 'alert');
        card.err.hidden = true;
        n.append(head, card.message, bar, card.body, card.who, card.err);
        card.node = n;
        spec.build(st, card);
        st.list.append(n);
        return card;
    }

    function buildForecast(st, card) {
        card.forecast = true;
        const n = node('div', 'mr-fc');
        n.dataset.kind = card.kind;
        card.title = node('b', 'mr-fc-title');
        card.hint = node('span', 'mr-fc-hint');
        card.time = node('span', 'mr-fc-time');
        card.time.setAttribute('aria-hidden', 'true');
        card.message = node('div', 'mr-fc-message');
        n.append(node('span', 'mr-fc-mark', '!'), card.title, card.hint, card.time, card.message);
        card.node = n;
        st.fc.append(n);
        return card;
    }

    function patchCard(st, card) {
        const ev = card.ev;
        const me = st.ctx.me;
        setText(card.title, ev.label || card.kind);
        card.message.hidden = !ev.message;
        setText(card.message, ev.message || '');
        if (card.forecast) {
            const targets = names(ev.targets).concat(ev.target ? [String(ev.target)] : []);
            const uniq = Array.from(new Set(targets));
            const hit = !!me && uniq.includes(me);
            card.node.dataset.mine = hit ? '1' : '';
            const who = uniq.length ? uniq.map(x => x === me ? '나' : x).join(', ') : '';
            card.hint.hidden = !who;
            setText(card.hint, (hit ? '◆ ' : '') + who);
            return;
        }
        const ls = loc(card.id);
        const r = card.spec.patch(st, card, ls) || {};
        card.node.dataset.mine = !st.ctx.readOnly && r.mine ? '1' : '';
        if (st.ctx.readOnly) card.node.querySelectorAll('button').forEach(b => setDisabled(b, true));
        setText(card.tag, r.tag || '전원');
        patchWho(st, card, r.whoLabel || card.spec.who, r.who || names(ev.responded));
        const showErr = !!ls.err && performance.now() < ls.errUntil;
        card.err.hidden = !showErr;
        if (showErr) setText(card.err, ls.err);
    }

    function patchWho(st, card, label, list) {
        const me = st.ctx.me;
        const sig = label + '|' + list.join('|');
        if (card.whoSig === sig) return;
        card.whoSig = sig;
        card.who.hidden = !label || !list.length;
        if (card.who.hidden) { card.who.replaceChildren(); return; }
        card.who.replaceChildren(node('span', 'mr-who-k', label + ' ' + list.length),
            ...list.map(n => node('span', 'mr-chip' + (n === me ? ' me' : ''), n === me ? n + ' (나)' : n)));
    }

    // ===== 상단 (난이도·형태·전환) =====
    function mount(root) {
        root.classList.add('mr-root');
        root.replaceChildren();
        const st = { root, ctx: {}, view: null, cards: new Map(), timer: 0, transitionDeadline: 0, transitionText: '', outcomeTimer: 0 };
        st.outcome = node('div', 'mr-outcome');
        st.outcome.setAttribute('role', 'status');
        st.outcome.hidden = true;
        st.head = node('div', 'mr-head');
        st.diff = node('span', 'mr-diff');
        st.form = node('span', 'mr-form');
        st.formSub = node('span', 'mr-form-sub', '전투 정지');
        st.formTime = node('b', 'mr-form-time');
        st.head.append(st.diff, st.form, st.formSub, st.formTime);
        st.list = node('div', 'mr-list');
        st.fc = node('div', 'mr-fc-list');
        root.append(st.outcome, st.head, st.list, st.fc);
        return st;
    }

    function patchHead(st, view, now) {
        st.head.hidden = !!view.generic;
        const form = view.form || 'body';
        st.root.dataset.difficulty = view.difficulty || 'normal';
        st.head.dataset.form = form;
        setText(st.diff, DIFFICULTY_LABEL[view.difficulty] || '');
        setText(st.form, FORM_LABEL[form] || '');
        setText(st.formSub, view.transitionMessage || '전투 정지');
        st.transitionDeadline = form === 'transition' ? now + Math.max(0, Number(view.transitionRemain) || 0) * 1000 : 0;
        st.formTime.hidden = !st.transitionDeadline;
        st.transitionText = '';
    }

    function showOutcome(st, oc) {
        if (!oc || oc.id == null) return;
        const key = String(oc.id);
        if (shownOutcomes.has(key)) return;
        shownOutcomes.add(key);
        if (shownOutcomes.size > 200) shownOutcomes.delete(shownOutcomes.values().next().value);
        st.outcome.dataset.ok = oc.ok ? '1' : '0';
        st.outcome.replaceChildren(node('b', 'mr-oc-mark', oc.ok ? '◆ 성공' : '✕ 실패'), node('span', 'mr-oc-label', oc.label || ''));
        st.outcome.hidden = false;
        st.outcome.classList.remove('in');
        void st.outcome.offsetWidth;
        st.outcome.classList.add('in');
        clearTimeout(st.outcomeTimer);
        st.outcomeTimer = setTimeout(() => { st.outcome.hidden = true; syncMode(st); }, OUTCOME_MS);
    }

    // 보여줄 것이 있을 때만 자리를 차지한다. play 화면에는 대저택 전용 배분 클래스(.mr-on)를 붙인다.
    function syncMode(st) {
        const view = st.view;
        let mode = 'idle';
        let stack = '';
        if (view) {
            const cards = Array.from(st.cards.values());
            // 조작 패널이 둘 이상이면 좁은 화면에서 패널을 압축한다 (mansion-raid.css)
            if (cards.filter(c => !c.forecast).length > 1) stack = 'multi';
            if (view.form === 'transition') mode = 'transition';
            else if (cards.some(c => !c.forecast)) mode = 'event';
            else if (cards.length) mode = 'forecast';
            else if (!st.outcome.hidden) mode = 'outcome';
        }
        if (st.root.dataset.mode !== mode) st.root.dataset.mode = mode;
        if (st.root.dataset.stack !== stack) st.root.dataset.stack = stack;
        st.root.hidden = mode === 'idle';
        const screen = st.root.closest('.pq-screen');
        if (screen) screen.dataset.mr = mode;
    }

    // ===== 타이머 — 서버 remain을 받은 시점 기준으로 로컬 보간 =====
    function tick(st) {
        if (!st.root.isConnected) { stopTick(st); return; }
        const now = performance.now();
        for (const card of st.cards.values()) {
            if (card.persistent) continue;
            const remain = Math.max(0, (card.deadline - now) / 1000);
            const t = remain.toFixed(1);
            if (t !== card.lastTime) {
                card.lastTime = t;
                setText(card.time, remain > 0 || card.forecast ? t + 's' : '마감');
                if (card.barFill) card.barFill.style.transform = 'scaleX(' + (card.duration > 0 ? Math.min(1, remain / card.duration) : 0) + ')';
                card.node.classList.toggle('urgent', remain > 0 && remain <= URGENT_SEC);
                const expired = remain <= 0;
                if (expired !== card.expired) {
                    card.expired = expired;
                    card.node.classList.toggle('expired', expired);
                    patchCard(st, card);
                }
            }
            if (card.forecast) continue;
            if (card.kind === 'sculpture') KINDS.sculpture.patch(st, card, loc(card.id));
            const ls = loc(card.id);
            if (card.cd) {
                const left = Math.max(0, ls.cdUntil - now);
                card.cd.classList.toggle('on', left > 0);
                card.cdFill.style.transform = 'scaleX(' + (left / PILLAR_CD_MS) + ')';
            }
            if (!card.err.hidden && now >= ls.errUntil) card.err.hidden = true;
        }
        if (st.transitionDeadline) {
            const t = Math.max(0, (st.transitionDeadline - now) / 1000).toFixed(1) + 's';
            if (t !== st.transitionText) { st.transitionText = t; setText(st.formTime, t); }
        }
    }
    function startTick(st) {
        if (!st.timer) st.timer = setInterval(() => tick(st), 100);
    }
    function stopTick(st) {
        if (st.timer) { clearInterval(st.timer); st.timer = 0; }
    }

    // ===== 진입점 =====
    function update(root, view, ctx) {
        if (!root) return;
        let st = roots.get(root);
        if (!st) { st = mount(root); roots.set(root, st); }
        st.ctx = ctx || {};
        st.root.dataset.readonly = st.ctx.readOnly ? '1' : '';
        st.view = view || null;
        if (!view) {
            for (const card of st.cards.values()) card.node.remove();
            st.cards.clear();
            local.clear();
            stopTick(st);
            syncMode(st);
            return;
        }
        const now = performance.now();
        patchHead(st, view, now);
        const seen = new Set();
        for (const ev of Array.isArray(view.events) ? view.events : []) {
            if (!ev || ev.id == null) continue;
            if (ev.presentation === 'speech') continue;
            if (st.ctx.visualOnly?.(ev)) continue;
            const id = String(ev.id);
            if (seen.has(id)) continue;
            seen.add(id);
            let card = st.cards.get(id);
            if (card && card.kind !== String(ev.kind || '')) { card.node.remove(); card = null; }
            if (!card) {
                card = buildCard(st, ev); st.cards.set(id, card);
                if (!st.ctx.readOnly && !card.forecast) root.scrollTop = 0;
            }
            card.ev = ev;
            card.persistent = ev.remain == null;
            card.node.dataset.persistent = card.persistent ? '1' : '';
            card.time.hidden = card.persistent;
            if (card.barFill) card.barFill.parentElement.hidden = card.persistent;
            const remain = Math.max(0, Number(ev.remain) || 0);
            card.deadline = now + remain * 1000;
            card.duration = Math.max(Number(ev.duration) || 0, remain);
            card.lastTime = '';
            card.expired = !card.persistent && remain <= 0;
            card.node.classList.toggle('expired', card.expired);
            patchCard(st, card);
        }
        for (const [id, card] of st.cards) {
            if (seen.has(id)) continue;
            card.node.remove();
            st.cards.delete(id);
        }
        for (const id of Array.from(local.keys())) if (!seen.has(id)) local.delete(id);
        showOutcome(st, view.outcome);
        syncMode(st);
        tick(st);
        startTick(st);
    }

    window.MansionRaidUI = { update };
})();
