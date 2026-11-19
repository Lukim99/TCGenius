// 증강 연출 흐름: 치명타 계열. 형식은 ../lab.js의 AugLab.define 설명을 본다.
// 사건과 지속 상태의 모양은 docs/paradise-augment-fx.md, 서버의 실제 순서는 paradise_prism.js를 따른다.

// 결실: 공격(일반 공격과 스킬) 수를 세어 3번째마다 확정 치명타. 지속 상태 count는 지난 발동 뒤의 공격 수(0~2).
// 치명타 피해량 +100%라 실험자의 치명타 배율은 2.5배다(평소 1.5배).
AugLab.define('fruition', {
    aura: { count: 0 },
    demo: async L => {
        L.caption('결실을 가지면 치명타가 저절로 터지지 않습니다');
        await L.wait(1);
        L.caption('첫 번째 공격: 치명타 없음'); L.aura({ count: 1 }); L.attack(); await L.wait(1.2);
        L.caption('두 번째 공격: 스킬도 공격으로 셉니다'); L.aura({ count: 2 }); L.skill(); await L.wait(1.6);
        L.caption('세 번째 공격: 확정 치명타, 치명타 피해량 +100%'); L.aura({ count: 0 }); L.attack({ crit: true, cues: ['fruition'], base: L.atk * 1.3 }); await L.wait(2);
    },
    signals: [
        { label: '세 번째 공격: 확정 치명타', run: L => { L.aura({ count: 0 }); L.attack({ crit: true, cues: ['fruition'], base: L.atk * 1.3 }); } },
        // 박자가 2이면 다음 공격은 반드시 치명타라 평범한 공격이 올 수 없다. 단추마다 앞 상태를 먼저 맞춘다.
        { label: '첫 번째 공격: 열매가 맺힘', run: L => { L.aura({ count: 0 }); L.aura({ count: 1 }); L.attack(); } },
        { label: '두 번째 공격: 열매가 다 익음', run: L => { L.aura({ count: 1 }); L.aura({ count: 2 }); L.attack(); } }
    ],
    controls: [{ key: 'count', label: '지난 발동 뒤 공격 수(2면 다음 공격이 발동)', type: 'range', min: 0, max: 2 }],
    notes: [
        '막는 것은 자연 치명타뿐입니다. 다른 효과의 확정 치명타(운명의 수동변속, 결투 신청)는 그대로 터집니다.',
        '일반 공격, 스킬, 소환수의 공격을 모두 공격으로 셉니다(지속 피해는 세지 않음). 세 번째가 소환수의 공격이면 그 공격이 확정 치명타입니다. 검무는 8타가 각각 공격입니다. 박자는 탐험 내내 이어집니다.'
    ],
    live: '일반 공격이나 스킬을 세 번 쓰세요. 세 번째 공격이 확정 치명타입니다. "증강 상태 채우기"를 누르면 바로 다음 공격이 세 번째가 됩니다.'
});

(function () {
    // 같은 응답에 함께 오는 사건(일반 공격과 그 직후의 반격)을 무대에 한 번에 넣는다.
    // L의 함수는 사건을 하나씩 넣으므로 그동안만 무대의 push를 모았다가 한꺼번에 넘긴다. 그래야 hfield가 반격을 타격이 닿은 뒤로 늦춘다.
    function together(make) {
        const stage = document.getElementById('stage').contentWindow.AugStage, push = stage.push, list = [];
        stage.push = events => { list.push(...events); return 0; };
        try { make(); } finally { stage.push = push; }
        return list.length ? stage.push(list) : 0;
    }
    // 실험자 공격력 기준의 한 타(±8%). k는 공격력 배율(치명타면 치명타 배율을 곱해 넘긴다).
    const roll = (L, k) => Math.round(L.atk * k * L.random(92, 108) / 100);
    const percent = L => Math.round(L.model.player.hp / L.model.player.maxHp * 100);
    const at = (L, time) => L.wait(Math.max(0, time - L.now()) / 1000);

    // 치명적인 운명: 치명타 확률은 최대 20%로 고정(낮으면 그대로), 치명타 피해량 +300%(실험자는 4.5배).
    // 일반 공격과 스킬이 치명타로 맞힌 타수만큼 대상에 운명이 쌓인다(적 한 마리마다 새로, 최대 99).
    // 스킬 운명(MP, 쿨타임 없음)은 7중첩을 소모해 공격력의 7% 피해. 그 공격이 치명타면 남은 HP와 보호막만큼 고정 피해로 처형한다.
    const FATE_CRIT = 4.5, FATE_LOCKED = { name: '운명', disabledReason: '운명 7중첩 필요' };
    const fateKill = L => L.kill({ skill: '운명', hits: [roll(L, .07 * FATE_CRIT)], crit: true, cues: ['fatalDestiny.execute'], extraHits: [{ damage: L.model.target.hp, fixed: true, label: '처형' }], pause: 2.4 });
    AugLab.define('fatalDestiny', {
        aura: { stacks: 0 },
        skills: [FATE_LOCKED],
        demo: async L => {
            L.caption('치명타 확률은 최대 20%, 치명타 피해량 +300%'); await L.wait(1.2);
            L.caption('치명타가 아닌 공격: 운명이 쌓이지 않습니다'); L.attack({ hits: [roll(L, 1)] }); await L.wait(1.1);
            L.caption('치명타 적중: 대상에게 운명 1중첩'); L.aura({ stacks: 1 }); L.attack({ hits: [roll(L, FATE_CRIT)], crit: true }); await L.wait(1.2);
            L.caption('연격 두 타가 모두 치명타: 2중첩 더'); L.aura({ stacks: 3 }); L.attack({ hits: [roll(L, FATE_CRIT), roll(L, FATE_CRIT)], crit: 2 }); await L.wait(1.3);
            L.caption('공격을 이어 가 6중첩까지 쌓았습니다'); L.aura({ stacks: 6 }); await L.wait(1.1);
            L.caption('스킬 치명타로 7중첩: 운명을 쓸 수 있습니다'); L.aura({ stacks: 7 }); L.skills(['운명']); L.skill(null, { hits: [roll(L, 1.8 * FATE_CRIT)], crit: true }); await L.wait(1.6);
            // 서버는 스킬을 쓰는 순간 7중첩을 덜고 공격한다. 치명타가 아니면 공격력의 7% 피해뿐이다.
            L.caption('운명: 7중첩 소모, 치명타가 아니라 7% 피해뿐'); L.aura({ stacks: 0 }); L.skills([FATE_LOCKED]); L.skill('운명', { hits: [roll(L, .07)] }); await L.wait(2.4);
            L.caption('다시 7중첩을 쌓았습니다'); L.aura({ stacks: 7 }); L.skills(['운명']); await L.wait(1.1);
            // 처치한 응답에서 천상 화면은 쓰러지는 적을 붙들고 이전 상태(7중첩)로 그린다. 새 상태는 둘째 적과 함께 온다.
            L.caption('운명이 치명타: 남은 HP 전부를 처형합니다'); await fateKill(L);
            L.aura({ stacks: 0 }); L.skills([FATE_LOCKED]);
            L.caption('둘째 적: 운명은 0중첩부터 다시 쌓습니다'); await L.wait(1.6);
        },
        signals: [
            { label: '치명타 적중: 운명 1중첩', run: L => { const n = (L.state && L.state.stacks) || 0, from = n >= 7 ? 0 : n; L.aura({ stacks: from }); L.aura({ stacks: from + 1 }); L.skills([from + 1 >= 7 ? '운명' : FATE_LOCKED]); L.attack({ hits: [roll(L, FATE_CRIT)], crit: true }); } },
            { label: '7중첩 완성: 별이 이어지고 운명이 켜짐', run: L => { L.aura({ stacks: 6 }); L.aura({ stacks: 7 }); L.skills(['운명']); L.attack({ hits: [roll(L, FATE_CRIT)], crit: true }); } },
            { label: '운명: 치명타가 아니면 7% 피해뿐', run: L => { L.aura({ stacks: 7 }); L.aura({ stacks: 0 }); L.skills([FATE_LOCKED]); L.skill('운명', { hits: [roll(L, .07)] }); } },
            { label: '운명: 치명타로 처형', run: async L => { L.aura({ stacks: 7 }); L.skills(['운명']); await fateKill(L); L.aura({ stacks: 0 }); L.skills([FATE_LOCKED]); } }
        ],
        controls: [{ key: 'stacks', label: '대상의 운명 중첩(7부터 운명 사용, 최대 99)', type: 'range', min: 0, max: 9 }],
        notes: [
            '치명타 확률은 20%를 넘으면 20%로 고정되고 낮으면 그대로입니다. 치명타 피해량은 +300%입니다.',
            '운명은 치명타로 맞힌 타수만큼 쌓입니다(연격은 타마다). 소환수의 공격도 치명타면 쌓입니다(소환수는 결실 같은 확정 치명타일 때만 치명타가 납니다). 지속 피해는 쌓지 않습니다. 대상에 붙는 중첩이라 2마리 전투의 둘째 적은 0부터 시작합니다.',
            '스킬 운명은 MP와 쿨타임 없이 7중첩을 소모하고 공격력의 7% 피해를 줍니다. 이 공격이 치명타일 때만 대상의 남은 HP와 보호막만큼 고정 피해로 처형하며 엘리트와 보스도 예외가 없습니다. 치명타가 아니면 중첩만 사라집니다.',
            '중첩은 7을 넘어 쌓이고(최대 99) 운명은 7만 씁니다. 결실의 세 번째 공격과 변속의 확정 치명타가 운명에 걸리면 반드시 처형합니다.'
        ],
        live: '실험자 캐릭터는 치명타 확률이 0%라 실전에서는 운명이 저절로 쌓이지 않고 처형도 나오지 않습니다. "증강 상태 채우기"로 운명 중첩을 발동 직전까지 채우세요. 처형을 보려면 아래에서 운명의 수동변속을 더하고 "새 전투 시작"을 누른 뒤, 일반 공격 2회로 변속을 켜고 변속 다음에 운명을 쓰세요. 처음 적은 체력이 10억이라 처형 피해가 아주 크게 보입니다. 처형 뒤 둘째 적은 0중첩부터 시작합니다.'
    });

    // 결투 신청: 전투를 시작하면 준비(ready). 그 전투의 첫 일반 스킬(궁극기 제외)이 적에게 피해를 입히면 결투가 걸리고(pending),
    // 적이 같은 응답 안에서 바로 반격한다(피해 -75%). 반격을 받으면 10초 동안 나와 적의 행동 쿨타임이 50% 줄어든다(haste, until까지). 그 뒤로 끝(done).
    // 사건의 순서: 내 스킬 사건에 duelChallenge, 이어지는 적의 반격 사건(counter: true)에 duelChallenge.counter와 duelChallenge.haste.
    const duel = (L, o = {}) => together(() => {
        const quarter = Math.round(L.model.player.maxHp * .11 * .25 * L.random(95, 105) / 100);
        L.aura({ stage: 'haste', until: L.now() + 10000 });
        L.skill(undefined, { cues: ['duelChallenge'] });
        L.enemy(Object.assign({ counter: true, damage: quarter, cues: ['duelChallenge.counter', 'duelChallenge.haste'] }, o));
    });
    AugLab.define('duelChallenge', {
        aura: { stage: 'ready', until: 0 },
        demo: async L => {
            const blow = () => Math.round(L.model.player.maxHp * .11 * L.random(95, 105) / 100);
            L.caption('전투 시작: 둘 사이에 결투의 세검이 놓입니다'); await L.wait(1.3);
            L.caption('일반 공격은 결투를 걸지 않습니다'); L.attack(); await L.wait(1.2);
            L.caption('첫 일반 스킬: 결투 신청, 적이 바로 반격(피해 -75%)'); duel(L); await L.wait(1.9);
            L.caption('10초 동안 나와 적 모두 행동 쿨타임 -50%');
            for (let i = 0; i < 3; i++) { L.attack(); await L.wait(.6); L.enemy({ damage: blow() }); await L.wait(.6); }
            L.caption('서로 두 배로 빨리 주고받습니다'); L.skill(); await L.wait(.9); L.enemy({ damage: blow() }); await L.wait(.7); L.attack(); await L.wait(.7);
            L.caption('발밑의 고리가 남은 시간입니다'); await L.wait(2.3);
            L.caption('10초가 지나면 가속이 걷힙니다'); await L.wait(1.4); L.aura({ stage: 'done' });
            L.caption('그 뒤로는 평소 속도입니다'); L.attack(); await L.wait(1.3);
        },
        signals: [
            { label: '첫 일반 스킬: 결투 신청, 반격, 서로 가속', run: L => { L.aura({ stage: 'ready', until: 0 }); duel(L); } },
            { label: '결투 신청만(내 스킬)', run: L => { L.aura({ stage: 'pending', until: 0 }); L.skill(undefined, { cues: ['duelChallenge'] }); } },
            { label: '적의 반격(피해 -75%)과 가속 시작', run: L => { L.aura({ stage: 'haste', until: L.now() + 10000 }); L.enemy({ counter: true, damage: Math.round(L.model.player.maxHp * .0275), cues: ['duelChallenge.counter', 'duelChallenge.haste'] }); } },
            { label: '가속이 끝나는 순간(2초 남음)', run: L => { L.aura({ stage: 'haste', until: L.now() + 2000 }); } }
        ],
        controls: [{ key: 'stage', label: '결투 단계', type: 'choice', options: [{ label: '준비', value: 'ready' }, { label: '결투 걸림(반격 직전)', value: 'pending' }, { label: '끝남', value: 'done' }] }],
        notes: [
            '결투를 거는 것은 그 전투에서 적에게 피해를 입힌 첫 일반 스킬입니다. 일반 공격과 궁극기는 결투를 걸지 않습니다.',
            '적의 반격은 스킬과 같은 응답 안에서 바로 오고, 피해는 평소의 25%입니다(75% 감소).',
            '반격을 받은 순간부터 10초 동안 나와 적의 행동 쿨타임이 모두 50% 줄어듭니다. 지속 상태의 until이 끝나는 시각이고, 발밑의 고리가 남은 시간을 보입니다.',
            '그 스킬로 적이 쓰러지거나 거울 전투이면 결투가 걸리지 않고, 반격도 가속도 없습니다.',
            '예전의 "반격 뒤 확정 치명타"는 없어졌습니다.'
        ],
        live: '"새 전투 시작"을 누르고 일반 스킬(궁극기 제외)을 쓰면 적이 곧바로 반격합니다. 반격 피해는 평소의 25%이고, 그 뒤 10초 동안 나와 적 모두 두 배로 빨리 행동합니다. 일반 공격으로는 결투가 걸리지 않습니다.'
    });

    // 운명의 수동변속: 자연 치명타를 막는다. 치명타가 아닌 직접 공격이 적중할 때마다 세어 2회마다 운명 1중첩(최대 3).
    // 스킬 변속(행동 시간, MP, 쿨타임 없음)은 1중첩을 써서 다음 직접 공격을 확정 치명타로 만든다. 모두 탐험 내내 이어진다.
    const SHIFT_EMPTY = { name: '변속', disabledReason: '운명 중첩 없음' }, SHIFT_SET = { name: '변속', disabledReason: '변속 완료' };
    const shiftReady = stacks => stacks >= 1 ? '변속' : SHIFT_EMPTY;
    AugLab.define('manualShift', {
        aura: { stacks: 0, max: 3, armed: false },
        skills: [SHIFT_EMPTY],
        demo: async L => {
            L.caption('치명타가 저절로 터지지 않습니다'); await L.wait(1.1);
            L.caption('치명타가 아닌 공격 1회째'); L.attack(); await L.wait(1.1);
            L.caption('스킬도 셉니다. 2회째에 운명 1중첩'); L.aura({ stacks: 1 }); L.skills(['변속']); L.skill(); await L.wait(1.5);
            L.caption('3회째'); L.attack(); await L.wait(1.1);
            L.caption('4회째: 운명 2중첩'); L.aura({ stacks: 2 }); L.attack(); await L.wait(1.3);
            L.caption('변속: 1중첩을 써서 다음 공격을 확정 치명타로'); L.aura({ stacks: 1, armed: true }); L.skills([SHIFT_SET]); L.skill('변속', { hits: 0 }); await L.wait(1);
            L.caption('변속한 공격: 확정 치명타'); L.aura({ armed: false }); L.skills(['변속']); L.attack({ crit: true, cues: ['manualShift.crit'] }); await L.wait(1.5);
            L.caption('5회째: 치명타였던 공격은 세지 않습니다'); L.attack(); await L.wait(1.1);
            L.caption('6회째 공격으로 첫 적 처치'); await L.kill();
            L.aura({ stacks: 2 });
            L.caption('둘째 적: 운명 2중첩이 그대로 이어집니다'); await L.wait(1.6);
        },
        signals: [
            { label: '치명타 아닌 공격 2회째: 운명 1중첩', run: L => { const n = (L.state && L.state.stacks) || 0, from = n >= 3 ? 0 : n; L.aura({ stacks: from, armed: false }); L.aura({ stacks: from + 1 }); L.skills(['변속']); L.attack(); } },
            { label: '변속: 다음 공격을 확정 치명타로', run: L => { const n = Math.max(1, (L.state && L.state.stacks) || 0); L.aura({ stacks: n, armed: false }); L.aura({ stacks: n - 1, armed: true }); L.skills([SHIFT_SET]); L.skill('변속', { hits: 0 }); } },
            { label: '변속한 공격: 확정 치명타', run: L => { const n = (L.state && L.state.stacks) || 0; L.aura({ armed: true }); L.aura({ armed: false }); L.skills([shiftReady(n)]); L.attack({ crit: true, cues: ['manualShift.crit'] }); } }
        ],
        controls: [
            { key: 'stacks', label: '운명 중첩(최대 3)', type: 'range', min: 0, max: 3 },
            { key: 'armed', label: '변속을 걸어 둠(다음 공격 확정 치명타)', type: 'toggle' }
        ],
        notes: [
            '자연 치명타만 막습니다. 결실의 세 번째 공격과 결투 신청의 확정 치명타는 그대로 터집니다.',
            '치명타가 아닌 직접 공격(일반 공격과 스킬)이 적중할 때만 셉니다. 2회마다 1중첩, 최대 3중첩입니다. 지속 피해, 소환수, 치명타였던 공격은 세지 않습니다.',
            '변속은 MP와 쿨타임 없이 1중첩을 쓰고 행동 시간도 쓰지 않습니다. 걸어 둔 동안에는 다시 쓸 수 없고(변속 완료), 확정 치명타는 바로 다음 직접 공격에 걸립니다(스킬 포함).',
            '중첩, 걸어 둔 변속, 2회를 세는 박자는 탐험 내내 이어집니다. 둘째 적과 다음 전투에도 그대로 남습니다.'
        ],
        live: '치명타가 아닌 공격을 2회 할 때마다 운명이 1중첩 쌓이고(최대 3), 1중첩부터 스킬 변속을 쓸 수 있습니다. 변속 뒤 바로 다음 공격이 확정 치명타입니다. "증강 상태 채우기"를 누르면 발동 직전까지 중첩이 찹니다. 중첩은 다음 적으로 이어지니 "적 HP 1"을 누르고 공격해 첫 적을 쓰러뜨려 확인해 보세요. "새 전투 시작"은 탐험을 새로 시작하므로 중첩도 0이 됩니다.'
    });

    // 고통스러운 상처: 일반 공격(검무 포함)의 치명타 타수를 세어 5회마다 상처(10초 동안 2초마다 대상 최대 HP의 4%, 방어력 무시, 암속성 지속 피해).
    // 다시 5회를 채우면 새 상처로 바뀐다(겹치지 않음). 쌓인 횟수와 상처는 적에게 붙어, 첫 적이 쓰러지면 사라진다.
    const wound = L => L.tick('고통스러운 상처', { dot: true, damage: Math.round(L.model.target.maxHp * .04), cues: ['painfulWound'], extra: { effectElement: '암' } });
    AugLab.define('painfulWound', {
        aura: { until: 0, crits: 0 },
        demo: async L => {
            L.caption('일반 공격의 치명타를 5회 셉니다'); await L.wait(1);
            L.caption('일반 공격 치명타 1회'); L.aura({ crits: 1 }); L.attack({ crit: true }); await L.wait(1.1);
            L.caption('연격 두 타 모두 치명타: 3회'); L.aura({ crits: 3 }); L.attack({ hits: 2, crit: 2 }); await L.wait(1.2);
            L.caption('스킬의 치명타는 세지 않습니다'); L.skill(null, { crit: true }); await L.wait(1.5);
            const start = L.now();
            L.caption('5회: 고통스러운 상처, 10초 동안'); L.aura({ crits: 0, until: start + 10000 }); L.attack({ hits: 2, crit: 2, cues: ['painfulWound.apply'] });
            // 10초 동안 2초마다 5회. 그 사이에도 공격은 이어지고, 치명타는 다음 상처를 위해 다시 쌓인다.
            const between = [() => L.attack(), () => { L.aura({ crits: 1 }); L.attack({ crit: true }); }, () => L.attack(), () => { L.aura({ crits: 2 }); L.attack({ hits: 2, crit: 1 }); }, () => L.attack()];
            for (let i = 1; i <= 5; i++) {
                await at(L, start + i * 2000 - 1000); between[i - 1]();
                await at(L, start + i * 2000);
                if (i === 5) L.aura({ until: 0 });
                wound(L); L.caption(i < 5 ? '상처 피해 ' + i + '/5회, 남은 ' + (10 - i * 2) + '초' : '상처 피해 5/5회, 10초가 끝났습니다');
            }
            await L.wait(1);
            L.caption('첫 적 처치'); await L.kill({ pause: 1.4 });
            L.aura({ crits: 0 });
            L.caption('둘째 적: 치명타 횟수를 0부터 다시 셉니다'); await L.wait(1.5);
        },
        signals: [
            { label: '일반 공격 치명타 1회 쌓기', run: L => { const n = (L.state && L.state.crits) || 0, from = n >= 4 ? 0 : n; L.aura({ crits: from }); L.aura({ crits: from + 1 }); L.attack({ crit: true }); } },
            { label: '치명타 5회째: 상처를 남김', run: L => { L.aura({ crits: 4 }); L.aura({ crits: 0, until: L.now() + 10000 }); L.attack({ crit: true, cues: ['painfulWound.apply'] }); } },
            { label: '상처 피해(2초마다 최대 HP의 4%)', run: L => { if (!(L.state && L.state.until > L.now())) L.aura({ until: L.now() + 10000 }); wound(L); } }
        ],
        controls: [
            { key: 'until', label: '상처(10초)', type: 'window', ms: 10000 },
            { key: 'crits', label: '다음 상처까지 쌓인 치명타(0~4)', type: 'range', min: 0, max: 4 }
        ],
        notes: [
            '일반 공격(검무 포함)이 치명타로 맞힌 타수만 셉니다. 연격은 타마다 1회이고, 스킬의 치명타는 세지 않습니다.',
            '5회를 채우면 상처를 남기고 넘친 횟수는 다음 상처로 이어집니다. 상처는 10초 동안 2초마다 대상 최대 HP의 4%(5회, 합계 20%)이며 방어력을 거치지 않습니다.',
            '상처가 남아 있을 때 다시 5회를 채우면 겹치지 않고 새 상처로 바뀌어 10초가 처음부터 흐릅니다.',
            '쌓인 횟수와 상처는 적에게 붙습니다. 첫 적이 쓰러지면 남은 상처 피해는 사라지고 둘째 적은 0회부터 셉니다. 적을 쓰러뜨린 공격으로 5회를 채우면 상처는 걸리지 않습니다.'
        ],
        live: '실험자 캐릭터는 치명타 확률이 0%라 실전에서는 상처가 저절로 걸리지 않습니다. "증강 상태 채우기"로 치명타 횟수를 발동 직전까지 채우고, 아래에서 결실이나 운명의 수동변속을 더해 확정 치명타를 일반 공격으로 맞히세요(증강을 더한 뒤에는 "새 전투 시작"). 처음 적은 체력이 10억이라 상처 한 번에 4천만 피해가 보입니다. "적 HP 1"로 첫 적을 쓰러뜨리면 상처가 사라지고 둘째 적은 0회부터 셉니다.'
    });

    // 죽을 각오로: HP가 20% 미만인 동안 받는 피해 +100%, 내가 주는 모든 피해가 방어력을 무시하는 고정 피해.
    // 발동 장면은 적의 공격을 맞은 뒤 HP가 20% 미만일 때 전투(2마리 전체)마다 한 번. 고정 피해 숫자에는 치명타 표시가 붙지 않는다.
    const fixedHits = (L, k, n) => Array.from({ length: n || 1 }, () => ({ damage: roll(L, k), fixed: true, label: '고정 피해' }));
    AugLab.define('deathWish', {
        aura: { active: false },
        setup: L => L.player({ hp: Math.round(L.model.player.maxHp * .35) }),
        demo: async L => {
            const blow = () => Math.round(L.model.player.maxHp * L.random(79, 83) / 1000);   // 적의 한 번 공격(최대 HP의 8% 안팎)
            L.caption('HP 35%: 아직 평소와 같습니다'); L.attack(); await L.wait(1.3);
            L.enemy({ damage: blow() }); L.caption('적의 공격: HP ' + percent(L) + '%'); await L.wait(1.4);
            L.caption('평소의 피해 숫자'); L.attack({ hits: 2 }); await L.wait(1.2);
            L.aura({ active: true }); L.enemy({ damage: blow(), cues: ['deathWish.awaken'] });
            L.caption('HP ' + percent(L) + '%: 20% 아래라 죽을 각오로 발동'); await L.wait(1.9);
            L.caption('내 공격이 모두 고정 피해가 됩니다'); L.attack({ hits: 0, extraHits: fixedHits(L, 1.06, 2) }); await L.wait(1.2);
            L.caption('스킬도 방어력을 무시하는 고정 피해'); L.skill(null, { hits: 0, extraHits: fixedHits(L, 1.9) }); await L.wait(1.6);
            L.caption('받는 피해 +100%: 같은 공격이 두 배로'); L.enemy({ damage: 2 * blow() }); await L.wait(1.6);
            L.caption('HP ' + percent(L) + '%: 한 번 더 맞으면 쓰러집니다'); L.attack({ hits: 0, extraHits: fixedHits(L, 1.06) }); await L.wait(1.6);
        },
        signals: [
            { label: '적의 공격으로 HP 20% 미만: 발동', run: L => { const m = L.model.player.maxHp; L.player({ hp: Math.round(m * .27) }); L.aura({ active: false }); L.aura({ active: true }); L.enemy({ damage: Math.round(m * .08), cues: ['deathWish.awaken'] }); } },
            { label: '켜진 동안 내 공격: 고정 피해', run: L => { L.player({ hp: Math.round(L.model.player.maxHp * .15) }); L.aura({ active: true }); L.attack({ hits: 0, extraHits: fixedHits(L, 1.06, 2) }); } },
            { label: '켜진 동안 적의 공격: 피해 두 배', run: L => { const m = L.model.player.maxHp; L.player({ hp: Math.round(m * .19) }); L.aura({ active: true }); L.enemy({ damage: Math.round(m * .16) }); } }
        ],
        controls: [{ key: 'active', label: '발동 중(HP 20% 미만)', type: 'toggle' }],
        notes: [
            'HP가 최대 HP의 20% 미만인 동안에만 켜지고, 20% 이상으로 회복하면 꺼집니다.',
            '켜진 동안 받는 피해 +100%입니다. HP를 20% 아래로 끌어내린 그 공격은 평소 피해이고, 다음 피격부터 두 배입니다.',
            '켜진 동안 내가 주는 모든 피해(일반 공격, 스킬, 지속 피해, 소환수, 증강 피해)가 방어력을 무시하는 고정 피해가 됩니다. 치명타도 고정 피해 숫자로 보입니다.',
            '발동 장면은 적의 공격을 맞은 뒤 HP가 20% 미만일 때 한 전투(2마리 전체)에 한 번 나옵니다. 같은 전투에서 회복했다 다시 내려가면 효과만 켜지고, HP가 20% 미만인 채 시작한 전투는 첫 피격 때 장면이 나옵니다.'
        ],
        live: '"내 HP 25%"를 누른 뒤 "적이 바로 공격"을 누르세요. 그 공격으로 HP가 20% 아래로 내려가면 발동 장면이 나오고, 그 뒤 내 피해 숫자가 고정 피해로 바뀝니다. 실전의 적은 한 번에 최대 HP의 16% 안팎을 주므로 다음 피격(두 배)에는 바로 쓰러지니, 공격해 본 뒤 "HP와 MP 가득"으로 되돌리세요. "내 HP 5%"는 장면 없이 효과만 켭니다. 발동 장면은 한 전투에 한 번이라 다시 보려면 "새 전투 시작"을 누르세요. "증강 상태 채우기"로 발동 직전 상태를 만들 수도 있습니다.'
    });
})();
