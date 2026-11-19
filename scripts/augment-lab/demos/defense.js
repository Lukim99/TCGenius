// 증강 연출 흐름: 방어 계열(읽어 낸 살의, 되감기, 천사강림, 죽음을 초월하는 자, 가시 갑옷)과 영혼 수확자. 형식은 ../lab.js의 AugLab.define 설명과 critical.js를 본다.
// 사건과 지속 상태의 모양은 docs/paradise-augment-fx.md, 서버의 실제 순서는 paradise_prism.js와 rpgenius.js(receiveParadiseDamage, advanceParadiseCombat)를 따른다.
// 수치는 실험실 캐릭터(공격력 235, 최대 HP 2,431, 방어력 98)가 1층 일반 적에게 맞는 실제 값을 모래상자에서 재어 맞췄다.
// 적의 보통 공격은 최대 HP의 15.5%쯤(가시 갑옷이면 14%), 치명타는 23.5%, 연격으로 두 번 맞으면 한 번에 30%를 넘는다.
// 일반 적은 3.5초마다 공격하고(paradise.enemyAttackInterval), 2마리 전투의 둘째 적은 나온 뒤 3.5초에 첫 공격을 한다.
(function () {
    'use strict';
    const ENEMY = 3.5;
    // 기준 시각에서 몇 초 뒤인지로 기다린다. 대기가 조금씩 밀려도 10초 창과 6초 보호가 실제 길이를 지킨다.
    const from = (L, base) => seconds => L.wait(Math.max(0, base + seconds * 1000 - L.now()) / 1000);
    const left = (L, until) => Math.max(0, Math.ceil((until - L.now()) / 1000));
    const fmt = n => Math.round(Number(n) || 0).toLocaleString('ko-KR');
    const maxHp = L => Number(L.model.player.maxHp) || 2431;
    const hpNow = L => Number(L.model.player.hp) || 0;
    const ratio = L => Math.round(hpNow(L) / maxHp(L) * 100);
    const pct = (L, r) => Math.round(maxHp(L) * r);
    const setHp = (L, hp) => L.player({ hp: Math.max(0, Math.min(maxHp(L), Math.round(hp))) });
    const heal = (L, amount) => setHp(L, hpNow(L) + amount);
    const foeHp = (L, r) => L.target({ hp: Math.round(L.model.target.maxHp * r) });
    // 적의 공격 피해: 보통은 최대 HP의 15~16%, base를 주면 그 비율(연격 .31, 가시 갑옷 .135).
    const blow = (L, base) => Math.round(maxHp(L) * ((base || .15) + Math.random() * .01));
    // L에 없는 값(방어력, 내 스킬의 원래 MP와 쿨타임)은 무대가 받아 둔 실제 전투 화면에서 읽는다.
    function scene() { try { return document.getElementById('stage').contentWindow.AugStage.scene.battle; } catch (_) { return null; } }
    const stat = (key, fallback) => { const b = scene(), value = Number(b && b.player && b.player[key]); return value > 0 ? value : fallback; };
    const mine = () => { const b = scene(); return (b && b.skills && b.skills[0]) || { name: '스킬', mpCost: 0, cooltimeText: '8초' }; };
    const cooldownOf = () => (parseFloat(mine().cooltimeText) || 8) * 1000;
    // 내 캐릭터 스킬 단추의 쿨타임과 MP 표시. L.skills는 증강 스킬만 바꾸므로 무대 모델의 스킬 목록을 고친 뒤 다시 그린다.
    function mySkill(L, patch) { L.model.skills = L.model.skills.map(skill => skill.augmentSkill ? skill : Object.assign({}, skill, patch)); L.player({}); }

    // ---------- 읽어 낸 살의 ----------
    // 지속 상태: count(살의, 맞은 횟수 0~2), foresight(미리 굴려 둔 다음 적 공격), parry(간파 준비).
    const READING = { name: '간파', disabledReason: '살의를 읽는 중' }, PARRYING = { name: '간파', disabledReason: '간파 준비됨' };
    const UNREAD = { count: 0, foresight: null, parry: false };
    const foresee = (L, o) => Object.assign({ damage: blow(L), critical: false, avoided: false }, o);
    // 간파: 피해 없는 시전자 쪽 스킬 사건(useUtility). 최대 HP의 10%를 회복한다.
    function useParry(L) { L.aura({ parry: true }); L.skills([PARRYING]); heal(L, pct(L, .10)); L.skill('간파', { hits: 0, extra: { actor: 'player', effectTarget: 'actor' } }); }
    async function readyForesight(L, parry) {
        const s = L.state || {};
        if (s.foresight && !!s.parry === parry) return s.foresight;
        const foresight = s.foresight || foresee(L);
        L.aura({ count: 2, foresight, parry }); L.skills([parry ? PARRYING : '간파']);
        await L.wait(.8);
        return foresight;
    }
    AugLab.define('readIntent', {
        aura: { count: 0, foresight: null, parry: false },
        skills: [READING],
        demo: async L => {
            const at = from(L, L.now());
            foeHp(L, .18);
            L.caption('적의 공격을 두 번 맞으면 다음 공격이 보입니다');
            await at(.8); L.attack();
            await at(1.5); L.aura({ count: 1 }); L.enemy({ damage: blow(L) }); L.caption('첫 피격: 살의 1회, 적 어깨의 눈이 뜨기 시작');
            await at(2.5); L.attack();
            await at(3.5); L.attack();
            await at(4.5); L.attack();
            // 두 번째 피격. 서버는 이 순간 다음 적 공격을 미리 굴려 둔다(치명타와 회피까지).
            await at(5); const next = foresee(L);
            L.aura({ count: 2, foresight: next }); L.skills(['간파']); L.enemy({ damage: blow(L) });
            L.caption(`두 번째 피격: 다음 공격의 예정 피해 ${fmt(next.damage)}`);
            await at(6.3); useParry(L); L.caption('간파: HP 10% 회복, 내 다음 행동은 2초 늦게');
            await at(8.5); L.aura(UNREAD); L.skills([READING]); L.enemy({ damage: 0, cues: ['readIntent.parry'] }); L.caption('예정된 공격을 막아 피해 0, 살의는 0부터');
            await at(9.3); L.attack();
            await at(10.3); L.attack();
            await at(11.3); L.attack();
            await at(12); L.aura({ count: 1 }); L.enemy({ damage: blow(L) }); L.caption('다시 맞아 살의 1회');
            await at(12.8); L.caption('첫 적 처치'); await L.kill();
            L.aura(UNREAD); L.caption('둘째 적: 살의를 0부터 다시 셉니다');
            await at(16.4);
        },
        signals: [
            { label: '두 번째 피격: 예정 피해가 보임', run: L => { L.aura({ count: 1, foresight: null, parry: false }); L.aura({ count: 2, foresight: foresee(L) }); L.skills(['간파']); L.enemy({ damage: blow(L) }); } },
            { label: '간파: HP 10% 회복, 막을 준비', run: async L => { await readyForesight(L, false); useParry(L); } },
            { label: '간파로 막은 적 공격(피해 0)', run: async L => { await readyForesight(L, true); L.aura(UNREAD); L.skills([READING]); L.enemy({ damage: 0, cues: ['readIntent.parry'] }); } },
            { label: '간파 없이 예정 피해가 그대로 들어옴', run: async L => { const fore = await readyForesight(L, false); L.aura(UNREAD); L.skills([READING]); L.enemy(fore.avoided ? { avoided: true } : { damage: fore.damage, crit: fore.critical }); } }
        ],
        controls: [
            { key: 'count', label: '살의(맞은 횟수, 2면 예정 피해가 보임)', type: 'range', min: 0, max: 2 },
            { key: 'foresight', label: '예정 피해(눈 아래 수치)', type: 'choice', get options() { const hp = stat('maxHp', 2431); return [
                { label: '없음', value: null },
                { label: '보통', value: { damage: Math.round(hp * .155), critical: false, avoided: false } },
                { label: '치명타', value: { damage: Math.round(hp * .235), critical: true, avoided: false } },
                { label: '회피', value: { damage: 0, critical: false, avoided: true } }]; } },
            { key: 'parry', label: '간파 준비(다음 적 공격을 막음)', type: 'toggle' }
        ],
        notes: [
            '적의 공격을 맞을 때마다 살의 1회이고, 회피한 공격은 세지 않습니다. 2회가 되는 순간 다음 적 공격을 미리 굴려 예정 피해로 보여 주며, 그 공격은 수치와 치명타, 회피까지 그대로 들어옵니다.',
            '간파는 예정 피해가 보일 때만 쓰며 쿨타임과 MP가 없습니다. 쓰면 최대 HP의 10%를 회복하고 내 다음 행동이 2초 늦어지며, 다음 적 공격 한 번을 피해 0으로 막습니다. 예정이 회피였다면 간파는 그대로 남아 그다음 공격을 막습니다.',
            '결투 신청과 원펀치 룰의 반격은 살의로 세지 않고, 예정 피해와 간파의 대상에서도 빠집니다. 거울 전투에서는 동작하지 않습니다.',
            '적에게 붙는 상태라 2마리 전투의 둘째 적에서는 살의, 예정 피해, 걸어 둔 간파가 모두 처음부터 다시 시작합니다.'
        ],
        live: '적이 바로 공격을 한 번 누르고 맞은 뒤 한 번 더 누르세요. 두 번째에 적 어깨의 눈이 다 뜨이고 예정 피해가 보입니다. 그때 스킬 간파를 누르고 적이 바로 공격을 누르면 막아 냅니다. 증강 상태 채우기를 누르면 발동 바로 전 상태가 됩니다.'
    });

    // ---------- 되감기 ----------
    // 지속 상태: used(이번 2마리 전투에서 썼는지), guardUntil(받는 피해 -50%가 끝나는 시각).
    const GUARD_MS = 6000;
    AugLab.define('timeRewind', {
        aura: { used: false, guardUntil: 0 },
        demo: async L => {
            const at = from(L, L.now()), start = hpNow(L);
            foeHp(L, .25);
            L.caption('한 번에 HP 25% 이상 잃으면 3초 전으로 되감습니다');
            await at(.6); L.attack();
            await at(1.2); const small = blow(L); L.enemy({ damage: small }); L.caption(`보통 피격 ${Math.round(small / maxHp(L) * 100)}%: 되감기는 일어나지 않습니다`);
            await at(2.2); L.attack();
            await at(3.2); L.attack();
            await at(4.2); L.attack();
            // 연격으로 한 번에 30% 넘게 잃는다. 서버의 HP 기록은 첫 피격 뒤 HP를 다음 내 공격(2.2초)에야 남기므로,
            // 3초 전(1.7초)에 해당하는 기록은 첫 피격 전 HP다. 그래서 첫 피격까지 함께 되돌아온다(설명의 세 번째 줄).
            await at(4.7); const big = blow(L, .31), guard = L.now() + GUARD_MS;
            L.aura({ used: true, guardUntil: guard }); L.enemy({ damage: big, cues: ['timeRewind'] }); setHp(L, start);
            L.caption(`한 번에 ${Math.round(big / maxHp(L) * 100)}%를 잃어 HP를 3초 전으로 되감습니다`);
            await at(5.9); L.attack(); L.caption(`첫 피격 전 HP ${ratio(L)}%까지 돌아왔습니다. 보호 ${left(L, guard)}초`);
            await at(6.9); L.attack(); L.caption(`보호 남은 ${left(L, guard)}초: 받는 피해 -50%`);
            await at(7.9); L.attack();
            await at(8.2); const half = Math.round(blow(L) / 2); L.enemy({ damage: half }); L.caption(`보호 남은 ${left(L, guard)}초: 보통 공격이 절반 ${fmt(half)}만`);
            await at(9.2); L.attack(); L.caption(`보호 남은 ${left(L, guard)}초`);
            await at(10.2); L.attack();
            await at(10.7); L.caption('6초가 지나 보호가 끝났습니다');
            await at(11.2); L.caption('첫 적 처치'); await L.kill();
            L.caption('둘째 적: 되감기는 2마리 전투에 한 번뿐');
            await at(13.8); L.attack();
            await at(14.8); L.attack();
            await at(15.8); L.attack();
            await at(12.8 + ENEMY); const again = blow(L, .31); L.enemy({ damage: again }); L.caption(`다시 ${Math.round(again / maxHp(L) * 100)}%를 잃어도 이번에는 그대로입니다`);
            await at(18.6);
        },
        signals: [
            { label: '큰 피격: HP를 3초 전으로 되감기', run: L => { L.aura({ used: false, guardUntil: 0 }); if (hpNow(L) < pct(L, .6)) setHp(L, pct(L, .82)); const before = hpNow(L); L.aura({ used: true, guardUntil: L.now() + GUARD_MS }); L.enemy({ damage: blow(L, .31), cues: ['timeRewind'] }); setHp(L, before); } },
            { label: '쓰러질 피해도 되감기', run: L => { L.aura({ used: false, guardUntil: 0 }); setHp(L, pct(L, .4)); const before = hpNow(L); L.aura({ used: true, guardUntil: L.now() + GUARD_MS }); L.enemy({ damage: pct(L, .45), cues: ['timeRewind'] }); setHp(L, before); } },
            { label: '6초 보호 중의 피격(피해 절반)', run: async L => { const s = L.state || {}; if (!(s.guardUntil > L.now() + 600)) { L.aura({ used: true, guardUntil: L.now() + GUARD_MS }); await L.wait(.7); } L.enemy({ damage: Math.round(blow(L) / 2) }); } }
        ],
        controls: [
            { key: 'used', label: '이번 전투에 이미 발동함', type: 'toggle' },
            { key: 'guardUntil', label: '받는 피해 -50% 보호(6초)', type: 'window', ms: GUARD_MS }
        ],
        notes: [
            '적의 공격 한 번으로 최대 HP의 25% 이상을 잃으면 HP를 3초 전 기록으로 되돌리고, 그 뒤 6초 동안 받는 피해를 절반으로 줄입니다. 보호막이 막은 만큼은 잃은 HP로 세지 않습니다.',
            '쓰러질 피해도 되돌립니다. 다만 잃을 수 있는 HP는 남은 HP까지라서, HP가 최대 HP의 25%보다 적으면 발동하지 않습니다.',
            '3초 전 HP는 피격 순간이 아니라 그다음 내 공격이나 화면 갱신(1초마다) 때 기록됩니다. 그래서 일반 적(3.5초 간격)과 싸우면 직전 피격까지 함께 되돌아오는 일이 많습니다. 흐름 재생도 이 동작을 따릅니다.',
            '2마리 전투 전체에서 한 번입니다. 둘째 적에게 넘어가도 다시 발동하지 않고, 진행 중인 6초 보호는 이어집니다.'
        ],
        live: '이 실험실 적의 보통 공격은 최대 HP의 15%쯤이라 발동하지 않습니다. 적이 연격으로 두 번 때려 한 번에 25% 넘게 잃을 때만 저절로 발동하니, 증강 상태 채우기로 발동 바로 전 상태를 만든 뒤 적이 바로 공격을 누르세요. 다시 보려면 새 전투 시작을 누릅니다.'
    });

    // ---------- 천사강림 ----------
    // 지속 상태: until(천사가 싸우는 10초가 끝나는 시각), used(이번 탐험에서 내려왔는지).
    const ANGEL_MS = 10000;
    // 천사의 일격: 공격력의 600%(명속성, 방어력 적용. 1층 적에게 75%쯤 들어간다)에 대상 최대 HP의 7%. 입힌 피해의 5%를 회복한다.
    function angelStrike(L, extra) {
        const damage = Math.round(L.atk * 6 * (.74 + Math.random() * .02) + L.model.target.maxHp * .07);
        L.tick('천사', { damage, cues: ['angelDescent'], extra }); heal(L, damage * .05);
        return damage;
    }
    async function angelHere(L) {
        const s = L.state || {};
        if (s.until > L.now() + 1500) return;
        L.aura({ until: L.now() + ANGEL_MS - 2000, used: true });
        await L.wait(1.3);
    }
    AugLab.define('angelDescent', {
        aura: { until: 0, used: false },
        demo: async L => {
            const at = from(L, L.now());
            setHp(L, pct(L, .41)); foeHp(L, .35);
            L.caption('HP가 처음 20% 아래로 내려가면 천사가 옵니다');
            await at(.8); L.attack();
            await at(1.6); L.enemy({ damage: blow(L) }); L.caption(`적의 공격에 HP ${ratio(L)}%: 아직 20% 이상입니다`);
            await at(2.6); L.attack();
            await at(3.6); L.attack();
            await at(4.6); L.attack();
            // HP가 20% 아래로 내려간 피격(그 공격은 막지 못한다). 이 순간부터 10초.
            await at(1.6 + ENEMY); const until = L.now() + ANGEL_MS, w = from(L, until - ANGEL_MS);
            L.aura({ until, used: true }); L.enemy({ damage: blow(L), cues: ['angelDescent.descend'] });
            L.caption(`HP ${ratio(L)}%: 천사가 내려옵니다. 남은 10초`);
            await w(1); L.attack();
            await w(2); angelStrike(L); L.caption(`남은 ${left(L, until)}초: 천사의 공격, 입힌 피해의 5% 회복`);
            await w(3); L.attack();
            await w(ENEMY); L.enemy({ damage: 0, cues: ['angelDescent.guard'] }); L.caption(`남은 ${left(L, until)}초: 적의 공격을 천사가 막아 피해 0`);
            await w(4); angelStrike(L, { cleared: true, nextWave: 2, waveTotal: 2 }); L.caption(`남은 ${left(L, until)}초: 천사의 공격에 첫 적이 쓰러집니다`);
            await w(5.6); L.nextEnemy(); L.caption(`남은 ${left(L, until)}초: 둘째 적에게도 이어 싸웁니다`);
            await w(6); angelStrike(L);
            await w(6.6); L.attack();
            await w(7.6); L.attack();
            await w(8); angelStrike(L); L.caption(`남은 ${left(L, until)}초: 천사의 네 번째 공격`);
            await w(5.6 + ENEMY); L.enemy({ damage: 0, cues: ['angelDescent.guard'] }); L.caption(`남은 ${left(L, until)}초: 둘째 적의 공격도 막아 냅니다`);
            await w(10); angelStrike(L); L.caption('10초: 다섯 번째 공격을 끝으로 천사가 떠납니다');
            await w(11); L.attack();
            await w(12); L.attack();
            await w(5.6 + ENEMY * 2); L.enemy({ damage: blow(L) }); L.caption(`HP ${ratio(L)}%: 천사는 탐험에 한 번뿐입니다`);
            await w(15);
        },
        signals: [
            { label: '천사 강림(HP가 처음 20% 아래로)', run: L => { L.aura({ until: 0, used: false }); setHp(L, pct(L, .26)); L.aura({ until: L.now() + ANGEL_MS, used: true }); L.enemy({ damage: blow(L), cues: ['angelDescent.descend'] }); } },
            { label: '천사의 공격(피해의 5% 회복)', run: async L => { await angelHere(L); angelStrike(L); } },
            { label: '천사가 막아 낸 적 공격(피해 0)', run: async L => { await angelHere(L); L.enemy({ damage: 0, cues: ['angelDescent.guard'] }); } }
        ],
        controls: [
            { key: 'until', label: '천사가 싸우는 10초', type: 'window', ms: ANGEL_MS },
            { key: 'used', label: '이번 탐험에 이미 내려옴', type: 'toggle' }
        ],
        notes: [
            '탐험 전체에서 한 번입니다. 적의 공격을 받은 뒤 HP가 0보다 크고 최대 HP의 20% 미만이면 내려옵니다. 그 공격 자체는 막지 못하고, 그 공격에 쓰러지면 천사는 오지 않습니다.',
            '천사가 있는 10초 동안 적의 공격은 반격까지 모두 피해 0입니다(원문의 "대신 싸운다"를 이렇게 해석). 나도 그동안 함께 공격할 수 있습니다.',
            '천사는 2초마다 다섯 번(2, 4, 6, 8, 10초) 공격합니다. 공격력의 600%(명속성, 방어력 적용, 치명타 없음)에 대상 최대 HP의 7%를 더하고, 입힌 피해의 5%만큼 HP를 회복합니다.',
            '2마리 전투의 첫 적이 쓰러져도 천사는 둘째 적에게 남은 시간만큼 이어 싸우고 막아 줍니다.'
        ],
        live: '내 HP 25%를 누른 뒤 적이 바로 공격을 누르면 HP가 20% 아래로 내려가며 천사가 내려옵니다. 10초 안에 적이 바로 공격을 다시 눌러 천사가 막는 모습을 보세요. 탐험에 한 번뿐이라 다시 보려면 새 전투 시작을 누릅니다. 실전의 적은 체력을 크게 두어서 최대 HP 7% 피해가 아주 큰 수로 보입니다.'
    });

    // ---------- 죽음을 초월하는 자 ----------
    // 지속 상태: until(마지막 기회가 끝나는 시각, 그동안 HP는 0으로 보인다), attacksLeft(남은 직접 공격 수, 머리 위 촛불).
    const LAST_MS = 10000;
    // HP 0이 된 피격: 마지막 기회를 열고 모든 스킬 쿨타임을 초기화하며, 기회 동안 스킬은 MP 없이 쓴다.
    function openLastChance(L, damage) {
        const until = L.now() + LAST_MS;
        L.aura({ until, attacksLeft: 2 }); L.enemy({ damage, cues: ['transcendDeath.trigger'] }); setHp(L, 0);
        mySkill(L, { cooldownEnd: L.now(), mpCost: 0 });
        return until;
    }
    async function inLastChance(L, attacksLeft) {
        const s = L.state || {};
        if (s.until > L.now() + 1000) { if (s.attacksLeft !== attacksLeft) L.aura({ attacksLeft }); return; }
        L.aura({ until: L.now() + LAST_MS - 2000, attacksLeft }); setHp(L, 0); mySkill(L, { cooldownEnd: L.now(), mpCost: 0 });
        await L.wait(.9);
    }
    AugLab.define('transcendDeath', {
        aura: { until: 0, attacksLeft: 0 },
        demo: async L => {
            const at = from(L, L.now()), skill = mine(), cooldown = cooldownOf();
            setHp(L, pct(L, .12)); foeHp(L, .09);
            L.caption('HP 12%: 다음 공격을 맞으면 HP가 0이 됩니다');
            await at(.3); L.skill(); mySkill(L, { cooldownEnd: L.now() + cooldown }); L.player({ mp: Math.max(0, L.model.player.mp - (skill.mpCost || 0)) });
            await at(1.8); let until = openLastChance(L, blow(L)), w = from(L, until - LAST_MS);
            L.caption('HP 0: 쓰러지는 대신 마지막 기회, 남은 10초');
            await w(1.2); L.caption(`남은 ${left(L, until)}초: 스킬 쿨타임 초기화, MP 소모 없음`);
            await w(2.2); L.aura({ attacksLeft: 1 }); L.attack(); L.caption(`남은 ${left(L, until)}초: 공격 1번 사용, 1번 남음`);
            await w(ENEMY); L.enemy({ damage: 0 }); L.caption(`남은 ${left(L, until)}초: 적의 공격은 피해 0`);
            // 두 번째 공격(스킬)으로 첫 적을 쓰러뜨린다. 처치 사건에 부활이 함께 실리고 HP 30%가 된다.
            await w(5); L.caption(`남은 ${left(L, until)}초에 처치: HP 30%로 부활합니다`);
            L.aura({ until: 0, attacksLeft: 0 }); setHp(L, pct(L, .3)); mySkill(L, { cooldownEnd: L.now() + cooldown, mpCost: skill.mpCost || 0 });
            await L.kill({ skill: skill.name, base: L.atk * 1.8, cues: ['transcendDeath.revive'] });
            L.caption('둘째 적. 마지막 기회는 횟수 제한이 없습니다');
            await w(7.6); L.attack();
            await w(8.6); L.attack();
            await w(9.6); L.attack();
            await w(6.6 + ENEMY); until = openLastChance(L, blow(L, .31)); w = from(L, until - LAST_MS);
            L.caption('적의 연격에 다시 HP 0: 새 기회, 남은 10초');
            await w(1); L.aura({ attacksLeft: 1 }); L.attack(); L.caption(`남은 ${left(L, until)}초: 공격 1번 사용, 1번 남음`);
            await w(2.2); L.caption(`남은 ${left(L, until)}초: 남은 공격을 쓰지 않고 기다리면`);
            await w(ENEMY); L.enemy({ damage: 0 }); L.caption(`남은 ${left(L, until)}초: 적의 공격은 계속 피해 0`);
            await w(5); L.caption(`남은 ${left(L, until)}초: 시간만 흐릅니다`);
            await w(ENEMY * 2); L.enemy({ damage: 0 }); L.caption(`남은 ${left(L, until)}초`);
            await w(8); L.caption(`남은 ${left(L, until)}초`);
            await w(9); L.caption(`남은 ${left(L, until)}초`);
            await w(10); L.aura({ until: 0, attacksLeft: 0 }); setHp(L, 0); mySkill(L, { mpCost: skill.mpCost || 0 }); L.defeat(['transcendDeath.fail']);
            L.caption('10초가 지나 그대로 쓰러집니다. 탐험 끝');
            await w(12.6);
        },
        signals: [
            { label: 'HP 0: 마지막 기회 시작', run: L => { L.aura({ until: 0, attacksLeft: 0 }); setHp(L, pct(L, .1)); openLastChance(L, blow(L)); } },
            { label: '기회 안에 처치: HP 30%로 부활', run: async L => { await inLastChance(L, 1); L.aura({ until: 0, attacksLeft: 0 }); setHp(L, pct(L, .3)); mySkill(L, { mpCost: mine().mpCost || 0 }); await L.kill({ cues: ['transcendDeath.revive'] }); } },
            { label: '두 번째 공격에도 살아 있는 적: 바로 패배', run: async L => { await inLastChance(L, 1); L.aura({ until: 0, attacksLeft: 0 }); setHp(L, 0); mySkill(L, { mpCost: mine().mpCost || 0 }); L.attack({ cues: ['transcendDeath.fail'], extra: { defeated: true } }); } },
            { label: '10초가 지나 패배', run: async L => { L.aura({ until: L.now() + 1500, attacksLeft: 1 }); setHp(L, 0); mySkill(L, { mpCost: 0 }); await L.wait(1.5); L.aura({ until: 0, attacksLeft: 0 }); mySkill(L, { mpCost: mine().mpCost || 0 }); L.defeat(['transcendDeath.fail']); } },
            { label: '기회 중의 적 공격(피해 0)', run: async L => { await inLastChance(L, (L.state && L.state.attacksLeft) || 2); L.enemy({ damage: 0 }); } }
        ],
        controls: [
            { key: 'until', label: '마지막 기회 10초(HP 0으로 보임)', type: 'window', ms: LAST_MS },
            { key: 'attacksLeft', label: '남은 공격(머리 위 촛불)', type: 'range', min: 0, max: 2 }
        ],
        notes: [
            'HP가 0이 되는 순간 쓰러지는 대신 10초의 마지막 기회가 시작됩니다. 10초 제한은 원문에 없지만 공격하지 않고 버티는 상태를 막으려고 넣었습니다. 유물 같은 다른 부활 효과가 있으면 그쪽이 먼저 발동합니다.',
            '기회 동안 HP는 0으로 보이고 적의 공격은 피해 0입니다. 시작할 때 궁극기를 포함한 모든 스킬 쿨타임이 초기화되고, 기회 동안 스킬은 MP 없이 씁니다.',
            '직접 공격(일반 공격, 스킬) 두 번 안에 적을 쓰러뜨리면 HP 30%로 부활합니다. 검무는 8타여도 행동 한 번으로 셉니다. 지속 피해나 소환수가 쓰러뜨려도 되고, 2마리 전투의 첫 적도 됩니다. 두 번째 공격 뒤에도 적이 살아 있으면 그 자리에서, 10초가 지나면 그때 패배합니다.',
            '횟수 제한이 없습니다. 부활한 뒤 HP가 다시 0이 되면 같은 전투에서도 또 시작됩니다.'
        ],
        live: '내 HP 5%를 누른 뒤 적이 바로 공격을 누르면 HP가 0이 되며 마지막 기회가 시작됩니다. 부활을 보려면 적 HP 1을 누르고 공격하세요. 두 번 공격하고도 적이 살아 있거나 10초가 지나면 패배합니다. 패배한 뒤에는 새 전투 시작을 누릅니다.'
    });

    // ---------- 가시 갑옷 ----------
    // 지속 상태는 없다(항목만 있다). 방어력 +20%가 먼저 붙고, 적의 공격 한 번에 그 방어력의 300%를 고정 피해로 되돌린다.
    const thorns = () => Math.round(Math.round(stat('def', 98) * 1.2) * 3);
    const thornBlow = L => blow(L, .135);
    const SHIELD = 600;
    // 가시 갑옷 반사가 실린 적의 공격. 반사로 적이 쓰러지면 처치 사건이 된다. receivedHits를 주면 그 모양(보호막 흡수)을 쓴다.
    function thornHit(L, o) {
        const reflect = thorns(), hp = Math.max(0, L.model.target.hp - reflect), cleared = hp <= 0;
        const extra = Object.assign({ targetHp: hp }, cleared ? { cleared: true, nextWave: 2, waveTotal: 2 } : {}, o && o.extra);
        L.target({ hp });
        L.enemy(Object.assign({ damage: thornBlow(L), reflected: [{ damage: reflect, label: '가시 갑옷', fixed: true }], cues: ['thornArmor'] }, o, { extra }));
        return cleared;
    }
    // 보호막이 피해를 다 막은 피격: 받은 피해 0과 흡수한 양. 반사는 막기 전 피해를 기준으로 그대로 일어난다.
    function shieldedThornHit(L) {
        const layer = (L.model.player.shieldLayers || [])[0], amount = layer ? layer.amount : 0, damage = thornBlow(L), absorbed = Math.min(amount, damage);
        L.player({ shieldLayers: amount - absorbed > 0 ? [{ amount: amount - absorbed, expiresAt: layer.expiresAt }] : [] });
        thornHit(L, { damage: damage - absorbed, extra: { receivedHits: [{ damage: damage - absorbed, critical: false }, { damage: absorbed, type: 'absorbed' }] } });
    }
    AugLab.define('thornArmor', {
        aura: {},
        demo: async L => {
            const at = from(L, L.now()), hit = () => L.attack({ hits: [Math.round(L.atk * 1.02)] });
            foeHp(L, .13);
            L.caption('방어력 +20%, 맞을 때마다 방어력의 300%를 반사');
            await at(.6); hit();
            await at(1.4); thornHit(L); L.caption(`맞을 때마다 고정 피해 ${fmt(thorns())}를 되돌립니다`);
            await at(2.4); hit();
            await at(3.4); hit();
            await at(1.4 + ENEMY); if (L.model.target.hp >= thorns()) L.target({ hp: thorns() - 80 });
            thornHit(L); L.caption('되돌린 피해로 첫 적이 쓰러집니다');
            await at(4.9 + 1.6); L.nextEnemy(); L.caption('둘째 적. 가시 갑옷은 그대로입니다');
            await at(7.4); L.player({ shieldLayers: [{ amount: SHIELD, expiresAt: L.now() + 20000 }] }); L.caption(`다른 효과로 보호막 ${fmt(SHIELD)}가 생겼습니다`);
            await at(8); hit();
            await at(9); hit();
            await at(6.5 + ENEMY); shieldedThornHit(L); L.caption('보호막이 피해를 다 막아도 반사합니다');
            await at(11); hit();
            await at(12); hit();
            await at(6.5 + ENEMY * 2); L.enemy({ avoided: true }); L.caption('회피한 공격은 반사하지 않습니다');
            await at(15.5);
        },
        signals: [
            { label: '피격: 가시 갑옷 반사', run: L => { if (L.model.target.hp <= thorns()) foeHp(L, .9); thornHit(L); } },
            { label: '보호막이 다 막은 피격도 반사', run: async L => { const layer = (L.model.player.shieldLayers || [])[0]; if (!layer || layer.amount < pct(L, .17)) { L.player({ shieldLayers: [{ amount: SHIELD, expiresAt: L.now() + 20000 }] }); await L.wait(.6); } if (L.model.target.hp <= thorns()) foeHp(L, .9); shieldedThornHit(L); } },
            { label: '반사로 적 처치', run: async L => { L.target({ hp: Math.round(thorns() * .6) }); await L.wait(.6); thornHit(L); await L.wait(1.6); L.nextEnemy(); } }
        ],
        notes: [
            '방어력 +20%가 먼저 붙고 반사는 그 방어력의 300%입니다. 이 실험실 캐릭터는 방어력 98이 118이 되어 354를 되돌립니다. 반사는 고정 피해라 적의 방어력에 줄지 않고 적을 쓰러뜨릴 수도 있습니다.',
            '적의 공격 한 번에 한 번 반사합니다. 연격으로 여러 번 맞아도 한 번이고, 결투 신청과 원펀치 룰의 반격에도 반사합니다.',
            '보호막이 피해를 다 막아도 반사합니다. 회피했거나 천사, 간파, 마지막 기회로 피해가 0이 된 공격은 반사하지 않고, 그 공격에 내가 쓰러지면 반사 피해도 들어가지 않습니다.'
        ],
        live: '적이 바로 공격을 누를 때마다 적의 몸 위에 가시 갑옷 고정 피해가 뜹니다. 적 HP 1을 누른 뒤 적이 바로 공격을 누르면 반사로 적이 쓰러지고 둘째 적이 나옵니다.'
    });

    // ---------- 영혼 수확자 ----------
    // 지속 상태: souls(탐험 내내 모은 영혼, 곁을 도는 혼불). 스킬 명계의 부름은 영혼이 있을 때만 쓴다.
    const CALL = '명계의 부름', NO_SOUL = { name: CALL, disabledReason: '영혼 없음' };
    // 영혼 하나당 공격력의 144%를 한 번의 고정 피해로(서버는 일회 고정 피해, 표시 이름은 고정 피해).
    function callReaper(L) {
        const souls = (L.state && L.state.souls) || 0, damage = Math.round(L.atk * 1.44 * souls * (.98 + Math.random() * .04));
        L.aura({ souls: 0 }); L.skills([NO_SOUL]);
        L.skill(CALL, { hits: 0, extraHits: [{ damage, fixed: true, label: '고정 피해' }] });
        return { souls, damage };
    }
    function harvest(L) { const souls = ((L.state && L.state.souls) || 0) + 1; L.aura({ souls }); L.skills([CALL]); heal(L, pct(L, .05)); return souls; }
    AugLab.define('soulReaper', {
        aura: { souls: 0 },
        skills: [NO_SOUL],
        demo: async L => {
            const at = from(L, L.now());
            foeHp(L, .06); L.aura({ souls: 2 }); L.skills([CALL]);
            L.caption('지난 전투에서 모은 영혼 2개로 시작합니다');
            await at(.8); L.attack();
            await at(1.6); L.enemy({ damage: blow(L) });
            await at(2); L.attack();
            await at(3); const souls = harvest(L); L.caption(`처치: 영혼 ${souls}개, 최대 HP 5% 회복`); await L.kill({ cues: ['soulReaper.harvest'] });
            L.caption('2마리 전투의 첫 적도 처치로 셉니다');
            await at(5.4); L.attack();
            await at(6.4); const call = callReaper(L); L.caption(`명계의 부름: 영혼 ${call.souls}개, 고정 피해 ${fmt(call.damage)}`);
            await at(4.6 + ENEMY); L.enemy({ damage: blow(L) });
            await at(9); L.attack(); L.caption('영혼을 모두 썼습니다. 처치로 다시 모읍니다');
            await at(11);
        },
        signals: [
            { label: '처치: 영혼 수확, HP 5% 회복', run: async L => { harvest(L); await L.kill({ cues: ['soulReaper.harvest'] }); } },
            { label: '명계의 부름(모은 영혼 모두)', run: async L => { if (!(L.state && L.state.souls > 0)) { L.aura({ souls: 3 }); L.skills([CALL]); await L.wait(.9); } callReaper(L); } }
        ],
        controls: [{ key: 'souls', label: '모은 영혼(곁을 도는 혼불, 8개까지 보임)', type: 'range', min: 0, max: 8 }],
        notes: [
            '적을 쓰러뜨릴 때마다 영혼 1개를 거두고 최대 HP의 5%를 회복합니다. 2마리 전투의 첫 적도 세고, 지속 피해나 소환수, 가시 갑옷 반사로 쓰러뜨려도 셉니다.',
            '영혼은 탐험 내내 쌓이고 전투가 끝나도 남습니다.',
            '명계의 부름은 영혼이 1개 이상일 때만 쓰며 MP와 쿨타임이 없습니다. 모은 영혼을 모두 써서 영혼 하나당 공격력의 144%를 한 번의 고정 피해로 입힙니다(이 캐릭터는 영혼 1개에 338). 고정 피해라 적의 방어력에 줄지 않습니다.'
        ],
        live: '적 HP 1을 누르고 공격하면 처치와 함께 영혼을 거둡니다. 2마리 전투라 첫 적도 셉니다. 영혼이 생기면 명계의 부름 단추가 켜지니 둘째 적에게 써 보세요. 증강 상태 채우기를 누르면 발동 바로 전 상태가 됩니다.'
    });
})();
