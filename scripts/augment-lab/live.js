// 실전: 메모리 DB의 실제 천상 전투를 실험실 단추로 조작한다.
// 모든 조작은 서버의 필드 행동 큐에서 한다(열려 있는 천상 화면의 폴링과 겹치지 않게). 화면은 다음 폴링(1초 안)에 바뀐다.
const sandbox = require('../paradise-lab/sandbox');
const { prime } = require('./prime');
const { rpg, corridor, AUGMENTS } = sandbox;

async function act(body) {
    const action = String(body.action || '');
    if (action === 'start') {
        const ids = [...new Set((Array.isArray(body.augments) ? body.augments : []).filter(id => AUGMENTS.some(a => a.id === id)))];
        if (!ids.length) return { ok: false, message: '증강을 하나 이상 골라주세요.' };
        const wave = Number(body.wave) === 2;
        // 적은 실제 체력 그대로 둔다. 최대 HP 비례 피해(천사, 표식 폭발, 상처 등)가 실제 크기로 보인다.
        await sandbox.queue(() => sandbox.scenario('combat', new URLSearchParams({ augments: ids.join(','), wave: wave ? '2' : '', tough: '0' })));
        const names = ids.map(id => AUGMENTS.find(a => a.id === id).name);
        return { ok: true, message: `${names.length > 3 ? names.length + '종' : names.join(', ')} 증강으로 새 전투를 시작했습니다${wave ? '(둘째 적)' : ''}. 적이 빨리 쓰러지면 적 체력 가득을 누르세요.` };
    }
    return sandbox.queue(async user => {
        const run = user.paradise;
        if (!run || run.status !== 'active' || run.phase !== 'combat' || !run.enemy || !user.field?.paradise) return { ok: false, message: '전투 중이 아닙니다. 새 전투 시작을 누르세요.' };
        const stats = rpg.calculateUserStats(user), resources = corridor.getResources(user);
        let message;
        if (action === 'enemyOne') { run.enemy.hp = 1; message = '적 HP를 1로 만들었습니다. 다음 공격에 쓰러집니다.'; }
        else if (action === 'enemyFull') { run.enemy.hp = run.enemy.maxHp; message = '적 체력을 가득 채웠습니다.'; }
        else if (action === 'enemyAttack') { user.field.nextEnemyAttackAt = Date.now(); message = '적이 곧 공격합니다.'; }
        else if (action === 'myHp') { const ratio = Math.max(0, Math.min(1, Number(body.ratio) || 0)); resources.hp = Math.max(1, Math.round(stats.hp * ratio)); message = `내 HP를 ${Math.round(ratio * 100)}%로 만들었습니다.`; }
        else if (action === 'heal') { resources.hp = stats.hp; resources.mp = stats.mp; message = 'HP와 MP를 가득 채웠습니다.'; }
        else if (action === 'refill') { user.field.skillCooldowns = {}; user.field.nextActionAt = 0; resources.mp = stats.mp; message = '스킬 쿨타임을 초기화하고 MP를 채웠습니다.'; }
        else if (action === 'prime') message = prime(user, String(body.augment || ''));
        else return { ok: false, message: '알 수 없는 조작입니다: ' + action };
        run.revision++;
        await user.save();
        return { ok: true, message };
    });
}

module.exports = { act };
