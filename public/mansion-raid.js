// E세계 대저택 레이드 — 기믹 HUD.
// party.js가 보스 스테이지 아래 별도 root에 SSE마다 MansionRaidUI.update(root, view, { me, host, send })를 호출한다.
// 사건은 id로 키잉해 한 번만 만들고 이후에는 숫자·상태만 패치한다 (누르던 버튼 교체·초점 유실 방지).
(() => {
    'use strict';

    const LETTERS = ['a', 'b', 'c', 'd', 'e'];
    const PILLAR_NAMES = ['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'];
    const PILLAR_GOAL = 6;
    const PILLAR_SCALE = 12;
    const PILLAR_CD_MS = 500;
    const OUTCOME_MS = 2600;
    const ERROR_MS = 2500;
    const URGENT_SEC = 1.5;
    const MY_TURN = '◆ 내 차례';
    const DIFFICULTY_LABEL = { normal: 'NORMAL', hard: 'HARD', nightmare: 'NIGHTMARE' };
    const FORM_LABEL = { body: '본체', echo: '잔향', transition: '잔향 전환' };
    const FORECAST_HINT = {
        shards: '전원에게 1초 간격으로 3회 타격',
        resonance: '전원에게 암속성 피해',
        echo: '대상에게 1초 후 타격, 3초 후 후속 타격',
        harden: '보스가 피해를 줄이고 감소한 만큼 회복'
    };

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
    const pctOf = v => { v = Number(v) || 0; return v > 0 && v <= 1 ? v * 100 : v; };
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
        if (ls.pending.has(key) || typeof send !== 'function') return;
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
        pillars: {
            who: '이동',
            build(st, card) {
                const grid = node('div', 'mr-pillars');
                card.pillars = PILLAR_NAMES.map((name, i) => {
                    const b = button('mr-pillar', null, () => onPillar(st, card, i));
                    const pick = node('span', 'mr-pillar-pick');
                    const col = node('span', 'mr-pillar-col');
                    const fill = node('i', 'mr-pillar-fill');
                    col.append(fill, node('i', 'mr-pillar-goal'));
                    const val = node('b', 'mr-pillar-val');
                    const diff = node('span', 'mr-pillar-diff');
                    b.append(pick, node('span', 'mr-pillar-idx', name), col, val, diff);
                    grid.append(b);
                    return { b, pick, fill, val, diff };
                });
                card.cd = node('div', 'mr-cd');
                card.cdFill = node('i');
                card.cd.append(card.cdFill);
                card.body.append(grid, card.cd);
            },
            patch(st, card, ls) {
                const loads = normLoads(card.ev.loads);
                if (ls.from != null && !(loads[ls.from] > 0)) ls.from = null;
                const done = loads.every(v => v === PILLAR_GOAL);
                const lock = card.expired || done;
                if (lock) ls.from = null;
                card.pillars.forEach((p, i) => {
                    const v = loads[i];
                    const d = v - PILLAR_GOAL;
                    const picked = ls.from === i;
                    setText(p.val, v);
                    p.fill.style.height = (Math.min(1, Math.max(0, v) / PILLAR_SCALE) * 100) + '%';
                    p.b.dataset.state = d === 0 ? 'ok' : (d > 0 ? 'over' : 'under');
                    setText(p.diff, d === 0 ? '✓ 정량' : (d > 0 ? '▲ +' + d : '▼ −' + Math.abs(d)));
                    setText(p.pick, picked ? '출발' : (ls.from != null ? '도착' : ''));
                    setPressed(p.b, picked);
                    setDisabled(p.b, lock || (ls.from == null && v <= 0));
                    p.b.setAttribute('aria-label', '기둥 ' + (i + 1) + ' 하중 ' + v + (picked ? ' (출발 선택됨)' : ''));
                });
                return {
                    mine: !lock,
                    tag: '전원',
                    doText: done ? '모든 기둥 하중 6 달성. 판정 대기 중'
                        : card.expired ? '시간 종료'
                        : ls.from == null ? '하중을 모두 6으로 맞추세요. 출발 기둥 선택'
                        : PILLAR_NAMES[ls.from] + '에서 옮길 기둥 선택 (다시 누르면 취소)'
                };
            }
        },

        sculpture: {
            who: '',
            build(st, card) {
                const g = node('div', 'mr-gauge');
                card.zone = node('i', 'mr-gauge-zone');
                card.gFill = node('i', 'mr-gauge-fill');
                card.gMark = node('i', 'mr-gauge-mark');
                card.zoneLo = node('span', 'mr-gauge-lbl');
                card.zoneHi = node('span', 'mr-gauge-lbl');
                g.append(card.gFill, card.zone, card.gMark, card.zoneLo, card.zoneHi);
                const nums = node('div', 'mr-nums');
                card.zoneState = node('span', 'mr-zone-state');
                card.dmg = node('b', 'mr-num');
                card.pct = node('span', 'mr-pct');
                nums.append(card.zoneState, card.dmg, card.pct);
                card.hidden75 = node('div', 'mr-hidden', '눈뜬 장님 효과: 석재 진행률 75%');
                card.hidden75.hidden = true;
                card.finish = button('mr-act mr-finish', '완성', () => act(st, card, { action: 'finish' }, 'finish'));
                card.body.append(g, nums, card.hidden75, card.finish);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const max = Math.max(1, Number(ev.hpMax) || 1);
                const dmg = Math.max(0, Number(ev.damage) || 0);
                const pct = Math.min(100, dmg / max * 100);
                const lo = Math.max(0, Math.min(100, pctOf(ev.minPct)));
                const hi = Math.max(lo, Math.min(100, pctOf(ev.maxPct)));
                card.zone.style.left = lo + '%';
                card.zone.style.width = (hi - lo) + '%';
                card.zoneLo.style.left = lo + '%';
                card.zoneHi.style.left = hi + '%';
                setText(card.zoneLo, pctText(lo));
                setText(card.zoneHi, pctText(hi));
                card.gFill.style.transform = 'scaleX(' + (pct / 100) + ')';
                card.gMark.style.left = pct + '%';
                const zone = pct < lo ? 'under' : (pct > hi ? 'over' : 'in');
                card.node.dataset.zone = zone;
                setText(card.zoneState, zone === 'in' ? '◆ 성공 구간' : (zone === 'under' ? '▼ 부족' : '▲ 초과'));
                setText(card.dmg, fmt(dmg) + ' / ' + fmt(max));
                setText(card.pct, pctText(pct));
                card.hidden75.hidden = Math.abs(pct - 75) > 0.05;
                const host = isHost(st);
                const hname = hostName(st);
                const pressed = names(ev.responded).includes(st.ctx.me) || ls.pending.has('finish');
                card.finish.hidden = !host;
                setText(card.finish, pressed ? '판정 중' : (zone === 'in' ? '완성' : '완성 (구간 밖)'));
                setDisabled(card.finish, card.expired || pressed);
                const mine = host && !pressed && !card.expired;
                return {
                    mine,
                    tag: host ? (mine ? MY_TURN : '공대장 (나)') : '공대장 ' + hname,
                    doText: host ? '성공 구간에 도달하면 완성을 누르세요'
                        : '석재 공격. 성공 구간에서 공대장이 완성 선택'
                };
            }
        },

        burden: {
            who: '분담',
            build(st, card) {
                const info = node('div', 'mr-split');
                card.split = node('b', 'mr-big');
                card.splitSub = node('span', 'mr-sub');
                info.append(card.split, card.splitSub);
                card.support = button('mr-act', '받쳐주기', () => act(st, card, { action: 'support' }, 'support'));
                card.body.append(info, card.support);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const me = st.ctx.me;
                const target = ev.target ? String(ev.target) : '';
                const group = Array.from(new Set([target].concat(names(ev.responded)).filter(Boolean)));
                const count = Math.max(1, group.length);
                const total = Math.max(0, Number(ev.damage) || 0);
                setText(card.split, '1인 ' + fmt(total / count));
                setText(card.splitSub, '분담 ' + count + '명 (총 ' + fmt(total) + ')');
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
                    doText: meTarget ? '동료와 피해를 나누어 받습니다'
                        : joined ? '참여 중. ' + target + '와 피해 분담'
                        : target + '의 피해를 함께 받으려면 참여하세요',
                    who: group
                };
            }
        },

        blessing: {
            who: '',
            build(st, card) {
                const lines = node('div', 'mr-lines');
                card.acceptLine = node('div', 'mr-line');
                card.rejectLine = node('div', 'mr-line', '거절: 효과 없음 (미응답 시 거절)');
                lines.append(card.acceptLine, card.rejectLine);
                const row = node('div', 'mr-btn-row');
                card.accept = button('mr-act', '받아들이기', () => choose(st, card, 'accept'));
                card.reject = button('mr-act', '거절하기', () => choose(st, card, 'reject'));
                row.append(card.accept, card.reject);
                card.body.append(lines, row);
                card.btnRow = row;
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const target = ev.target ? String(ev.target) : '';
                const meTarget = !!st.ctx.me && target === st.ctx.me;
                const hpPct = st.view && st.view.difficulty === 'normal' ? 12 : 18;
                setText(card.acceptLine, '수락: 8초간 최종 피해 +20%, 종료 시 최대 HP ' + hpPct + '% 피해');
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
                    tag: meTarget ? (mine ? MY_TURN : '대상 (나)') : '대상 ' + target,
                    doText: meTarget
                        ? (done ? (ls.choice === 'accept' ? '수락' : ls.choice === 'reject' ? '거절' : '선택') + ' 완료. 결과 대기 중' : '받아들일지 선택')
                        : (done ? target + ' 선택 완료' : target + ' 선택 대기')
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
                const inWrap = node('div', 'mr-seq-wrap');
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
                let allOk = true;
                for (let i = 0; i < len; i++) {
                    const s = card.seqSlots[i];
                    setText(s.v, seq[i] || '?');
                    const t = card.typedSlots[i];
                    const c = ls.typed[i];
                    const state = c == null ? (i === ls.typed.length ? 'next' : 'empty') : (!seq[i] ? 'in' : (c === seq[i] ? 'ok' : 'ng'));
                    if (state === 'ng') allOk = false;
                    t.slot.dataset.state = state;
                    setText(t.v, c || '');
                    setText(t.m, state === 'ok' ? '✓' : (state === 'ng' ? '✕' : ''));
                }
                const full = ls.typed.length >= len;
                const lock = full || card.expired;
                card.keys.forEach(b => setDisabled(b, lock));
                return {
                    mine: !lock,
                    tag: lock ? '전원' : MY_TURN,
                    doText: full ? (seq.length ? (allOk ? '입력 일치. 결과 대기 중' : '입력 불일치. 결과 대기 중') : '입력 완료. 결과 대기 중')
                        : card.expired ? '시간 종료'
                        : '표시된 글자를 순서대로 입력하세요'
                };
            }
        },

        pulse: pulseKind(false),
        inversion: pulseKind(true),

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
                    setText(card.sub, '기록 피해로 보호막 결정');
                }
                return {
                    mine: false,
                    tag: shield ? '전원 파괴' : '전원 기록',
                    doText: shield ? '제한 시간 안에 보호막을 파괴하세요' : '최대한 공격하세요. 보스 공격 정지, 지원군 피해 제외'
                };
            }
        },

        transition: {
            who: '',
            build() {},
            patch() { return { mine: false, tag: '전원', doText: '잔향 전환 중 (전투 정지)' }; }
        }
    };

    function pulseKind(inverse) {
        return {
            who: '',
            build(st, card) {
                const cue = node('div', 'mr-cue');
                card.cueGlyph = node('span', 'mr-cue-glyph');
                card.cueWord = node('b', 'mr-cue-word');
                cue.append(card.cueGlyph, card.cueWord);
                card.rule = node('div', 'mr-rule', inverse ? '모여듦: 흡수 / 흩어짐: 방출 (반전)' : '모여듦: 방출 / 흩어짐: 흡수');
                const row = node('div', 'mr-btn-row');
                card.absorb = button('mr-act', '흡수', () => choose(st, card, 'absorb'));
                card.release = button('mr-act', '방출', () => choose(st, card, 'release'));
                row.append(card.absorb, card.release);
                card.btnRow = row;
                card.body.append(cue, card.rule, row);
            },
            patch(st, card, ls) {
                const ev = card.ev;
                const cue = ev.pulse === 'scatter' ? 'scatter' : 'gather';
                card.node.dataset.cue = cue;
                setText(card.cueGlyph, cue === 'gather' ? '→ ● ←' : '← ● →');
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
                    tag: meTarget ? (mine ? MY_TURN : '담당 (나)') : '담당 ' + target,
                    doText: meTarget
                        ? (done ? '응답 완료. 결과 대기 중' : (inverse ? '반전된 규칙에 맞춰 선택하세요' : '신호를 보고 선택'))
                        : (done ? target + ' 응답 완료' : target + ' 대응 중. 계속 공격하세요')
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
            const m = node('i');
            slot.append(v, m);
            row.append(slot);
            slots.push({ slot, v, m });
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
        if (card.expired || ls.typed.length >= card.seqLen || typeof send !== 'function') return;
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
        card.doEl = node('div', 'mr-ev-do');
        card.body = node('div', 'mr-ev-body');
        card.who = node('div', 'mr-ev-who');
        card.err = node('div', 'mr-ev-err');
        card.err.setAttribute('role', 'alert');
        card.err.hidden = true;
        n.append(head, card.message, bar, card.doEl, card.body, card.who, card.err);
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
            const base = FORECAST_HINT[card.kind] || '';
            const who = uniq.length ? uniq.map(x => x === me ? '나' : x).join(', ') : '';
            setText(card.hint, (hit ? '◆ ' : '') + [who, base].filter(Boolean).join(': '));
            return;
        }
        const ls = loc(card.id);
        const r = card.spec.patch(st, card, ls) || {};
        card.node.dataset.mine = r.mine ? '1' : '';
        setText(card.tag, r.tag || '전원');
        setText(card.doEl, r.doText || '');
        patchWho(st, card, card.spec.who, r.who || names(ev.responded));
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
        if (screen) screen.classList.toggle('mr-on', !!view);
    }

    // ===== 타이머 — 서버 remain을 받은 시점 기준으로 로컬 보간 =====
    function tick(st) {
        if (!st.root.isConnected) { stopTick(st); return; }
        const now = performance.now();
        for (const card of st.cards.values()) {
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
            const id = String(ev.id);
            if (seen.has(id)) continue;
            seen.add(id);
            let card = st.cards.get(id);
            if (card && card.kind !== String(ev.kind || '')) { card.node.remove(); card = null; }
            if (!card) { card = buildCard(st, ev); st.cards.set(id, card); }
            card.ev = ev;
            const remain = Math.max(0, Number(ev.remain) || 0);
            card.deadline = now + remain * 1000;
            card.duration = Math.max(Number(ev.duration) || 0, remain);
            card.lastTime = '';
            card.expired = remain <= 0;
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
