// 증강 연출 흐름: 이기어검술, 한 칸씩 오르는 검무, 백화요란, 검무, 보호막 흡수, 두 가지 정체성. 형식은 ../lab.js의 AugLab.define 설명을 본다.
// 사건과 지속 상태의 모양은 docs/paradise-augment-fx.md, 서버의 실제 순서와 수치는 paradise_prism.js를 따른다
// (계단은 paradise_mechanics.prepareAttack, 떠다니는 검의 틱은 paradise_mechanics.addDot/takeTicks, 보호막의 흡수 순서는 paradise_shield_hits.js).
// 행동 사이는 실제 행동 쿨타임(2~3초)보다 짧게 줄였다. 이기어검술만 4초 규칙을 보이려고 실제 간격으로 둔다.
(function () {
    const sum = list => list.reduce((total, hit) => total + Number(hit.damage || 0), 0);
    // 한 타의 피해: lab.js의 L.attack과 같은 폭으로 흔든다.
    const roll = (L, base) => L.random(base * .85, base * 1.2);

    // ---------- 이기어검술 ----------
    // 떠다니는 검의 틱: 소환수 공격이라 dot: false, 공격력의 70%(방어력 적용, 치명타 없음).
    const swordTick = L => L.tick('떠다니는 검', { cues: ['flyingSword'] });
    AugLab.define('flyingSword', {
        aura: { swords: 0, ready: false },
        demo: async L => {
            L.caption('전투가 시작되면 4초 시계가 돕니다');
            await L.wait(1);
            L.caption('4초가 지나기 전의 일반 공격은 검을 부르지 않습니다'); L.attack();
            for (let s = 1; s <= 3; s++) { await L.wait(1); L.caption('공격하지 않은 지 ' + s + '초'); }
            await L.wait(1);
            L.caption('4초가 지나 등 뒤에 검의 윤곽이 떠오릅니다'); L.aura({ ready: true });
            await L.wait(1);
            L.caption('다음 일반 공격이 떠다니는 검을 부릅니다'); L.aura({ swords: 1, ready: false }); L.attack({ cues: ['flyingSword.summon'] });
            await L.wait(1);
            L.caption('검이 1초마다 공격력의 70%로 칩니다 1/3'); swordTick(L);
            await L.wait(1);
            L.caption('검의 두 번째 공격 2/3'); swordTick(L);
            // 소환한 공격의 행동 쿨타임(2~3초)이 끝날 무렵 첫 적을 쓰러뜨린다. 2.2초 전 공격이라 검을 또 부르지 않는다.
            await L.wait(.2);
            L.caption('검이 떠 있는 채로 첫 적을 쓰러뜨립니다');
            await L.kill({ pause: .75 });
            await L.wait(.05);
            L.caption('검은 다음 적을 마저 치고 사라집니다 3/3'); L.aura({ swords: 0 }); swordTick(L);
            await L.wait(1.8);
        },
        signals: [
            { label: '검 소환과 세 번의 공격', run: async L => {
                L.aura({ swords: 0, ready: true }); await L.wait(.6);
                L.aura({ swords: 1, ready: false }); L.attack({ cues: ['flyingSword.summon'] });
                for (let i = 1; i <= 3; i++) { await L.wait(1); if (i === 3) L.aura({ swords: 0 }); swordTick(L); }
            } },
            { label: '떠다니는 검의 공격 한 번', run: L => { if (!(L.state && L.state.swords > 0)) L.aura({ swords: 1, ready: false }); swordTick(L); } }
        ],
        controls: [
            { key: 'swords', label: '떠 있는 검(4초 조건 때문에 많아야 1자루)', type: 'choice', options: [{ label: '없음', value: 0 }, { label: '1자루', value: 1 }] },
            { key: 'ready', label: '다음 일반 공격이 검을 부름(4초 동안 공격 안 함)', type: 'toggle' }
        ],
        notes: [
            '4초는 마지막 직접 공격(일반 공격과 스킬)부터 세고, 전투가 시작될 때도 0부터 셉니다. 스킬은 시계를 다시 돌리기만 하고 검을 부르지 않습니다. 검무는 일반 공격으로 쳐서 검을 부릅니다.',
            '검은 소환 1초 뒤부터 1초마다 세 번, 공격력의 70% 피해를 줍니다. 방어력이 적용되고 치명타는 없습니다. 지속 피해가 아니라 소환수 공격입니다.',
            '일반 공격과 스킬 뒤의 행동 쿨타임이 2~3초라(가속은 0.5초 짧음) 쿨타임이 끝나자마자 공격하면 검이 나오지 않습니다. 1~2초를 더 쉬어야 합니다.',
            '2마리 전투의 다음 적에게도 떠 있던 검이 남아 마저 공격합니다. 4초 시계도 첫 적을 쓰러뜨린 공격부터 이어집니다. 검을 부를 공격으로 적을 쓰러뜨리면 검은 나오지 않습니다.'
        ],
        live: '일반 공격을 한 번 하고 4초 넘게 기다린 뒤 다시 일반 공격을 하세요. 등 뒤에 검의 윤곽이 보이면 준비된 것입니다. 검이 떠 있을 때 "적 HP 1"을 누르고 공격하면 다음 적으로 이어지는 모습을 볼 수 있습니다. "증강 상태 채우기"를 누르면 발동 직전 상태가 됩니다.'
    });

    // ---------- 한 칸씩 오르는 검무 ----------
    // 지속 상태 step은 다음 일반 공격의 최소 연격(1~3). 일반 공격을 할 때마다 한 칸 오르고, 3 다음은 1이다.
    const stair = (L, from, hits, cue) => { L.aura({ step: from % 3 + 1 }); return L.attack({ hits, cues: cue ? ['comboStaircase.3'] : [] }); };
    AugLab.define('comboStaircase', {
        aura: { step: 1 },
        demo: async L => {
            L.caption('발 앞의 계단이 다음 일반 공격의 최소 연격입니다');
            await L.wait(1.2);
            L.caption('1단계 일반 공격: 1연격'); stair(L, 1, 1); await L.wait(1.4);
            L.caption('2단계 일반 공격: 최소 2연격'); stair(L, 2, 2); await L.wait(1.4);
            L.caption('3단계 일반 공격: 최소 3연격'); stair(L, 3, 3, true); await L.wait(1.8);
            L.caption('스킬은 계단을 움직이지 않습니다'); L.skill(); await L.wait(1.6);
            L.caption('3연격 다음은 다시 1연격부터'); stair(L, 1, 1); await L.wait(1.4);
            L.caption('2단계 공격으로 첫 적을 쓰러뜨립니다'); L.aura({ step: 3 });
            await L.kill({ hits: 2, pause: 1.5 });
            await L.wait(.8);
            L.caption('둘째 적에게도 계단이 이어져 3연격'); stair(L, 3, 3, true);
            await L.wait(2);
        },
        signals: [
            { label: '1단계: 1연격 일반 공격', run: async L => { L.aura({ step: 1 }); await L.wait(.4); stair(L, 1, 1); } },
            { label: '2단계: 최소 2연격 일반 공격', run: async L => { L.aura({ step: 2 }); await L.wait(.4); stair(L, 2, 2); } },
            { label: '3단계: 최소 3연격 일반 공격', run: async L => { L.aura({ step: 3 }); await L.wait(.4); stair(L, 3, 3, true); } }
        ],
        controls: [{ key: 'step', label: '다음 일반 공격의 최소 연격(밝힌 계단 칸)', type: 'range', min: 1, max: 3 }],
        notes: [
            '계단은 일반 공격만 오릅니다. 검무는 8회 고정이라 연격이 없어 계단을 움직이지 않고, 다른 스킬도 계단을 움직이지 않습니다.',
            '최소 연격이라 연격 확률로 더 칠 수 있습니다. 3연격 장면은 3타 이상인 일반 공격마다 나오므로 최대 연격 횟수가 늘면 1, 2단계에서도 나올 수 있습니다.',
            '계단은 전투마다 1연격부터 시작하고, 2마리 전투의 둘째 적에게도 이어집니다.'
        ],
        live: '일반 공격을 이어서 쓰세요. 최소 연격이 1, 2, 3 순서로 오르고 세 번째 공격에서 3연격 장면이 나옵니다. 스킬은 계단을 움직이지 않습니다. "증강 상태 채우기"를 누르면 발동 직전 상태가 됩니다.'
    });

    // ---------- 백화요란 ----------
    // 만개: 그 공격에 백화요란 피해(한 송이당 공격력의 120%, 방어력 적용, 치명타 없음)가 붙고, 그 10%만큼 HP를 회복한다.
    function bloomAttack(L, flowers, skill) {
        const hit = { damage: Math.round(L.atk * 1.2 * flowers * L.random(72, 80) / 100), critical: false, label: '백화요란' }, p = L.model.player;
        L.aura({ flowers: 0 }); L.player({ hp: Math.min(p.maxHp, p.hp + Math.round(hit.damage * .10)) });
        const o = { cues: ['hundredFlowers.bloom'], extraHits: [hit] };
        return skill ? L.skill(undefined, o) : L.attack(o);
    }
    AugLab.define('hundredFlowers', {
        aura: { flowers: 0 },
        demo: async L => {
            L.caption('직접 공격마다 적의 몸에 꽃이 맺힙니다'); await L.wait(1.2);
            L.caption('일반 공격: 꽃 1송이'); L.aura({ flowers: 1 }); L.attack(); await L.wait(1.4);
            L.caption('같은 형태가 이어지면 1송이씩'); L.aura({ flowers: 2 }); L.attack(); await L.wait(1.4);
            L.caption('형태를 바꾼 스킬: 2송이'); L.aura({ flowers: 4 }); L.skill(); await L.wait(1.6);
            L.caption('다시 바꾼 일반 공격으로 6송이, 만개'); bloomAttack(L, 6); await L.wait(1.3);
            L.caption('만개 피해의 10%만큼 HP를 회복합니다'); await L.wait(1.2);
            L.caption('만개 뒤에는 다시 1송이부터'); L.aura({ flowers: 1 }); L.attack(); await L.wait(1.4);
            // 꽃과 직전 형태는 적에게 붙어 있어 처치 응답에서 바로 0이 된다.
            L.caption('꽃이 맺힌 첫 적을 쓰러뜨립니다'); L.aura({ flowers: 0 });
            await L.kill({ pause: 1.5 });
            await L.wait(1.5);
            // 자인의 쿨타임(8초)이 끝난 뒤의 스킬. 새 적에서는 직전 형태도 지워져 1송이다.
            L.caption('새 적의 첫 공격은 스킬이어도 1송이'); L.aura({ flowers: 1 }); L.skill();
            await L.wait(2);
        },
        signals: [
            { label: '꽃 1송이(같은 형태로 공격)', run: L => { const n = (L.state && L.state.flowers) || 0; L.aura({ flowers: n % 5 + 1 }); L.attack(); } },
            { label: '꽃 2송이(형태를 바꾼 스킬)', run: L => { const n = (L.state && L.state.flowers) || 0; L.aura({ flowers: n + 2 > 5 ? 2 : n + 2 }); L.skill(); } },
            { label: '만개(6송이가 되는 공격)', run: async L => { L.aura({ flowers: 5 }); await L.wait(.5); bloomAttack(L, 6); } }
        ],
        controls: [{ key: 'flowers', label: '맺힌 꽃(6송이가 되는 공격에서 만개)', type: 'range', min: 0, max: 5 }],
        notes: [
            '형태는 일반 공격과 스킬 이름별로 나눕니다. 스킬 다음 다른 스킬도 2송이입니다. 검무는 일반 공격 형태입니다. 지속 피해와 소환수 공격은 꽃을 맺지 않습니다.',
            '6송이 이상이 되는 공격에서 바로 핍니다. 그 공격으로 7송이가 되면 7송이가 모두 터집니다. 한 송이당 공격력의 120% 피해(방어력 적용, 치명타 없음)를 그 공격에 더하고, 그 피해의 10%만큼 HP를 회복합니다.',
            '꽃과 직전 형태는 적에게 붙어 있어 2마리 전투의 다음 적에서 다시 시작합니다. 새 적의 첫 공격은 형태와 관계없이 1송이입니다.'
        ],
        live: '일반 공격과 스킬을 섞어 쓰면 형태가 바뀔 때마다 2송이가 맺히고, 6송이가 되는 공격에서 만개합니다. "증강 상태 채우기"를 누르면 발동 직전 상태가 됩니다. "적 HP 1"을 누르고 공격하면 꽃이 새 적에서 다시 시작하는 것을 볼 수 있습니다.'
    });

    // ---------- 검무 ----------
    // 검무: MP 390, 쿨타임 45초. 한 타는 공격력의 50%이고 치명타는 타마다 따로 판정한다. 사건은 action 'skill', skillName '검무', 8타.
    // 서버와 같은 모양으로 보낸다: 타마다 strike(1~8)가 붙은 hits, strikeInterval 100, strikes[{ cues, auras }].
    // 한 타에 딸린 추가 타격(신성한 번개 등)은 그 타의 strike를 갖고, auras는 그 타 직후의 지속 상태 전체다. 사건의 triggeredEffectIds에는 모든 타의 신호를 합쳐 둔다.
    // o.crit: 치명타 타수, o.cues: { 타: [신호] }, o.extras: { 타: [{ damage, label }] }, o.auras: 타 → 그 타 직후의 지속 상태
    function dance(L, o = {}) {
        const p = L.model.player, base = L.atk * .5, hits = [], strikes = [], union = [];
        L.player({ mp: Math.max(p.mp, 390) - 390 });
        L.skills([{ name: '검무', cooldownEnd: L.now() + 45000 }]);
        for (let strike = 1; strike <= 8; strike++) {
            const critical = strike <= (o.crit || 0);
            hits.push({ damage: Math.round(L.random(base * .85, base * 1.2) * (critical ? 1.9 : 1)), critical, strike });
            ((o.extras || {})[strike] || []).forEach(hit => hits.push(Object.assign({ critical: false, strike }, hit)));
            const cues = ((o.cues || {})[strike] || []).map(name => 'augment:' + name);
            cues.forEach(id => { if (!union.includes(id)) union.push(id); });
            strikes.push({ cues, auras: o.auras ? o.auras(strike) : L.model.auras.slice() });
        }
        const extra = { hits, damage: hits.reduce((total, hit) => total + hit.damage, 0), criticalCount: hits.filter(hit => hit.critical).length, strikeInterval: 100, strikes };
        return L.skill('검무', { cues: union, extra });
    }
    // 다른 증강과 함께 가진 검무: 3타마다 신성한 번개와 악마 사냥꾼이 떨어지고, 타마다 정복자 중첩이 오르고 갑옷이 깎인다.
    function showerDance(L) {
        const own = ['conqueror', 'armorShred', 'holyLightning', 'demonHunter'], rest = L.model.auras.filter(entry => !own.includes(entry.id));
        const after = strike => rest.concat([{ id: 'conqueror', stacks: Math.min(10, strike + 2), max: 10 }, { id: 'armorShred', percent: Math.min(30, strike * 5) }, { id: 'holyLightning', count: strike % 3 }, { id: 'demonHunter', count: strike % 3 }]);
        const bolt = () => [{ damage: Math.round(L.atk * .9), label: '신성한 번개' }, { damage: Math.round(L.atk * .35), label: '악마 사냥꾼' }];
        dance(L, { crit: 2, cues: { 3: ['holyLightning', 'demonHunter'], 6: ['holyLightning', 'demonHunter', 'armorShred.max'], 8: ['conqueror.max'] }, extras: { 3: bolt(), 6: bolt() }, auras: after });
        // 춤이 끝나면 화면은 평소 상태로 돌아간다. 마지막 타의 상태를 그대로 남긴다.
        after(8).slice(rest.length).forEach(entry => L.auraOf(entry.id, entry));
    }
    AugLab.define('swordDance', {
        aura: {},
        skills: ['검무'],
        demo: async L => {
            L.caption('스킬 단추에 검무가 생깁니다'); await L.wait(1.2);
            L.caption('평소처럼 일반 공격'); L.attack(); await L.wait(1.4);
            L.caption('검무: 공격력의 50%로 8번 벱니다'); dance(L, { crit: 1 }); await L.wait(2.4);
            L.caption('MP 390을 쓰고 45초 쿨타임이 돕니다'); await L.wait(1.6);
            L.caption('첫 적을 쓰러뜨립니다');
            await L.kill({ pause: .9 });
            await L.wait(1);
            L.caption('둘째 적에게도 검무 쿨타임이 이어집니다'); await L.wait(1.2);
            L.attack(); await L.wait(1.4);
            L.skill(); await L.wait(1.8);
        },
        signals: [{ label: '검무 8번 베기', run: L => dance(L) }, { label: '증강이 얹힌 검무', run: L => showerDance(L) }],
        notes: [
            '검무의 8타는 한 타 한 타가 일반 공격이자 직접 공격입니다. 결실, 신성한 번개, 악마 사냥꾼, 정복자, 갑옷 깎아내기, 백화요란, 운명의 수동변속이 타마다 세고, 원펀치 룰, 결투 신청, 이기어검술, 움직일수록 깊게, 선택의 시간, 고통스러운 상처도 타마다 반응합니다.',
            '8회 고정이라 한 타는 늘 1회 타격이고 연격과 한 칸씩 오르는 검무는 붙지 않습니다. 화면에는 검무 한 번으로 묶여 보이고, 그사이 적의 맞공격도 한 번으로 묶입니다. 적이 쓰러지면 남은 타는 멈추고, 죽음을 초월하는 자의 마지막 기회에는 행동 한 번으로 셉니다.',
            '동시에 일반 스킬이라 MP와 쿨타임 감소(스탯, 가을)를 받고 주문의 계절을 바꾸며, 리플레이로 다시 쓸 수 있습니다. 정신력 캐릭터는 MP 390 대신 정신력의 15%를 씁니다.',
            '쿨타임은 2마리 전투의 다음 적에게도 이어지므로 한 전투에서 두 적 모두에게 쓰기는 어렵습니다.'
        ],
        live: '스킬 단추의 검무를 누르세요(MP 390). 쿨타임이 45초라 다시 보려면 "쿨타임 초기화"를 누르세요. 일반 공격처럼 반응하는지 보려면 이기어검술이나 원펀치 룰 같은 증강을 함께 가질 증강에 더한 뒤 새 전투를 시작하세요.'
    });

    // ---------- 보호막 흡수 ----------
    // 적 보호막(유리 금고 같은 갈림길 기믹, 거울 전투)은 shieldLayers로 보인다. 내 보호막은 10초 뒤 저절로 꺼진다.
    const enemyShield = L => Number(L.model.target.shield || 0);
    function setEnemyShield(L, amount) {
        amount = Math.max(0, Math.round(amount));
        L.target({ shield: amount, shieldLayers: amount ? [{ source: 'route:glassVault', caster: '', amount, expiresAt: 0 }] : [] });
    }
    function setMyShield(L, amount, expiresAt) {
        amount = Math.max(0, Math.round(amount));
        L.player({ shield: amount, shieldLayers: amount ? [{ source: 'paradise:shieldSiphon', caster: '', amount, expiresAt: expiresAt || L.now() + 10000 }] : [] });
    }
    // 한 번의 직접 공격. 적 보호막이 있으면 타격 합의 10%를 흡수의 일격으로 더하고(그 절반이 내 보호막, 쌓이지 않고 바뀜),
    // 적 보호막은 타격 순서대로 받아 낸다: 받아 낸 몫은 type 'absorbed', 남은 몫만 HP 피해(사건의 damage)다.
    function siphon(L, raw, skill) {
        const shield = enemyShield(L), bonus = shield > 0 ? Math.round(sum(raw) * .10) : 0;
        const details = raw.concat(bonus ? [{ damage: bonus, critical: false, label: '흡수의 일격' }] : []), hits = [];
        let left = shield;
        for (const detail of details) {
            const absorbed = Math.min(detail.damage, left); left -= absorbed;
            if (absorbed > 0) hits.push(Object.assign({}, detail, { damage: absorbed, type: 'absorbed' }));
            if (detail.damage > absorbed) hits.push(Object.assign({}, detail, { damage: detail.damage - absorbed }));
        }
        if (shield > 0) setEnemyShield(L, left);
        if (bonus) setMyShield(L, bonus * .5);
        const o = { cues: bonus ? ['shieldSiphon'] : [], extra: { hits, damage: sum(hits.filter(hit => hit.type !== 'absorbed')), criticalCount: raw.filter(hit => hit.critical).length } };
        return skill ? L.skill(undefined, o) : L.attack(o);
    }
    // 적의 공격: 내 보호막이 먼저 받아 내고 남은 몫이 HP 피해다.
    function enemyAttack(L) {
        const p = L.model.player, layer = (p.shieldLayers || [])[0], mine = layer && layer.expiresAt > L.now() ? Number(p.shield || 0) : 0;
        const raw = L.random(p.maxHp * .08, p.maxHp * .14), absorbed = Math.min(mine, raw), received = raw - absorbed;
        setMyShield(L, mine - absorbed, layer && layer.expiresAt);
        return L.enemy({ damage: received, extra: { receivedHits: [{ damage: received, critical: false }].concat(absorbed ? [{ damage: absorbed, type: 'absorbed' }] : []) } });
    }
    const hitOf = (L, base) => ({ damage: roll(L, base), critical: false });
    AugLab.define('shieldSiphon', {
        aura: {},
        setup: L => setEnemyShield(L, L.atk * 3),
        demo: async L => {
            const first = hitOf(L, L.atk), strong = hitOf(L, L.atk * 1.8);
            // 첫 일반 공격은 다 받아 내고, 스킬의 첫 타격 중간에서 깨지는 양.
            setEnemyShield(L, first.damage * 1.1 + strong.damage * .6);
            L.caption('적이 보호막을 두르고 있습니다'); await L.wait(1.2);
            L.caption('보호막을 때리면 피해 10%를 더합니다'); siphon(L, [first]); await L.wait(1.1);
            L.caption('추가 피해의 절반이 내 보호막이 됩니다'); await L.wait(1.1);
            L.caption('얻은 보호막이 적의 공격을 먼저 받습니다'); enemyAttack(L); await L.wait(1.4);
            L.caption('보호막을 깨는 스킬에도 붙습니다'); siphon(L, [strong], true); await L.wait(1.6);
            L.caption('보호막이 사라지면 발동하지 않습니다'); siphon(L, [hitOf(L, L.atk)]); await L.wait(1);
            L.caption('새로 얻은 보호막도 다음 공격을 받습니다'); enemyAttack(L); await L.wait(1.8);
        },
        signals: [
            { label: '보호막을 두른 적을 일반 공격', run: L => { if (enemyShield(L) < L.atk * 1.4) setEnemyShield(L, L.atk * 3); siphon(L, [hitOf(L, L.atk)]); } },
            { label: '보호막을 두른 적에게 스킬', run: L => { if (enemyShield(L) < L.atk * 2.4) setEnemyShield(L, L.atk * 3); siphon(L, [hitOf(L, L.atk * 1.8)], true); } },
            { label: '보호막을 깨는 일반 공격', run: L => { const hit = hitOf(L, L.atk); setEnemyShield(L, hit.damage * .4); siphon(L, [hit]); } },
            { label: '얻은 보호막이 적의 공격을 받음', run: async L => { if (!(Number(L.model.player.shield || 0) > 0)) { setMyShield(L, L.atk * .05); await L.wait(.5); } enemyAttack(L); } }
        ],
        notes: [
            '적에게 보호막이 있을 때 직접 공격(일반 공격과 스킬)마다 그 공격 피해의 10%를 흡수의 일격으로 더합니다. 보호막을 깨는 공격에도 붙고, 지속 피해와 소환수 공격에는 붙지 않습니다.',
            '흡수의 일격의 50%가 내 보호막이 되어 10초 유지됩니다. 다시 발동하면 쌓이지 않고 마지막 발동의 양으로 바뀌며 10초가 다시 시작됩니다.',
            '흡수의 일격도 적 보호막이 먼저 받아 냅니다. 받아 낸 몫은 괄호 안의 흰 숫자로 보이고 적 HP는 줄지 않습니다.',
            '천상에서 적이 보호막을 얻는 경우는 유리 금고 같은 갈림길 기믹과 거울 전투입니다. 이 무대에서는 적에게 보호막을 직접 둘렀습니다.'
        ],
        live: '적에게 보호막이 있어야 발동합니다. "증강 상태 채우기"를 누르면 발동 직전 상태가 됩니다. 그 뒤 일반 공격이나 스킬을 쓰면 적 체력 막대의 보호막이 줄고 내 HP 옆에 보호막 수치가 붙습니다.'
    });

    // ---------- 두 가지 정체성 ----------
    // 빌린 카드는 증강을 얻을 때 무작위로 정해진다. 무대에서는 예로 제우스(성급은 내 메인 카드와 같은 6)의 백억이요를 빌린다.
    // 실제 천상 화면에서는 paradise_web.js가 그 카드의 스킬을 borrowed: true로 스킬 단추 줄에 더한다.
    const BORROWED = { name: '백억이요', sourceCard: '제우스', element: '명', mpCost: 77, resourceLabel: 'MP', cooltimeText: '7초', descLines: ['공격력의 159%로 공격합니다. 이 스킬로 처치 시 골드 획득량이 +7% 증가합니다.'], borrowed: true, augmentSkill: false };
    function borrowed(L) {
        const p = L.model.player;
        L.player({ mp: Math.max(p.mp, BORROWED.mpCost) - BORROWED.mpCost });
        L.skills([Object.assign({}, BORROWED, { cooldownEnd: L.now() + 7000 })]);
        return L.skill(BORROWED.name, { base: L.atk * 1.59, extra: { effectElement: '명' } });
    }
    AugLab.define('dualIdentity', {
        aura: { cardName: '제우스' },
        skills: [BORROWED],
        demo: async L => {
            L.caption('제우스의 스킬 백억이요가 단추에 생깁니다'); await L.wait(1.2);
            L.caption('어깨 뒤의 흑백 문양이 두 정체성의 표시'); L.attack(); await L.wait(1.4);
            L.caption('내 카드의 스킬 자인'); L.skill(); await L.wait(1.6);
            L.caption('빌린 백억이요를 내 스킬처럼 씁니다'); borrowed(L); await L.wait(2);
            L.caption('첫 적을 쓰러뜨립니다');
            await L.kill({ pause: 1.5 });
            await L.wait(.3);
            L.caption('빌린 스킬과 쿨타임이 다음 적에도 남습니다'); await L.wait(1.4);
            L.attack(); await L.wait(1.9);
            L.caption('쿨타임 7초가 끝나 백억이요를 다시 씁니다'); borrowed(L);
            await L.wait(2);
        },
        signals: [{ label: '빌린 스킬 백억이요 사용', run: L => borrowed(L) }],
        controls: [{ key: 'cardName', label: '빌린 카드 이름(흑백 문양과 무대의 단추는 그대로)', type: 'choice', options: ['제우스', '일레이나', '오버라이드', '키노'].map(name => ({ label: name, value: name })) }],
        notes: [
            '증강을 얻을 때 내 메인 카드가 아닌, 스킬이 있는 캐릭터 카드 하나를 무작위로 정합니다. 그 카드의 일반 스킬(전직 스킬과 궁극기는 빼고)을 내 메인 카드와 같은 성급으로 얻습니다.',
            '빌린 스킬 단추의 오른쪽 위에 빌려 온 카드 이름이 작게 붙습니다. 빌린 스킬은 내 스킬과 같은 규칙으로 쿨타임을 쓰고, 2마리 전투의 다음 적과 이후 전투에서도 탐험 내내 같은 카드로 남습니다.',
            '정신력을 쓰는 키노가 빌리면 MP 비용의 절반을 정신력으로 냅니다(최대 정신력의 80%까지). 다른 카드가 키노의 아이돌 할래?를 빌리면 정신력 비용의 두 배를 MP로 냅니다.',
            '흑백 문양은 가진 동안 늘 떠 있는 표시이고 따로 발동 장면은 없습니다. 무대에서는 예로 제우스의 백억이요를 빌렸습니다.'
        ],
        live: '"새 전투 시작"을 누를 때마다 무작위 카드가 정해지고, 그 카드의 스킬이 스킬 단추 줄에 더해집니다. 그 단추를 눌러 써 보세요. "적 HP 1"을 누르고 첫 적을 쓰러뜨려도 스킬이 남는지 볼 수 있습니다.'
    });
})();
