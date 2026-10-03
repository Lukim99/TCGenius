const rpg = require('./rpgenius');
const sessions = new Map();

const stat = (key, label, min = 0, max = 1e9, percent = false) => ({ key, label, min, max, percent, step: percent ? 1 : key === 'maxCmb' ? 1 : 10 });
const playerStats = [
    stat('atk', '공격력'), stat('def', '방어력'), stat('hp', '최대 HP', 1), stat('mp', '최대 MP'), stat('pnt', '방어 관통력'),
    stat('pntPercent', '방어 관통률', 0, 1, true), stat('crit', '치명타 확률', 0, 1, true), stat('critMul', '치명타 피해', 1, 20, true),
    stat('critDef', '치명타 피해 감소', 0, 1, true), stat('cmb', '연격 확률', 0, 1, true), stat('maxCmb', '추가 연격 횟수', 0, 20),
    stat('avd', '회피율', 0, 1, true), stat('afterBasic', '일반 공격 피해', -1, 100, true), stat('afterSkill', '스킬 공격 피해', -1, 100, true),
    stat('damageBonus', '일반 몬스터 피해', -1, 100, true), stat('eliteDmg', '엘리트 피해', -1, 100, true), stat('bossDmg', '보스 피해', -1, 100, true),
    stat('finalDamage', '최종 피해', -1, 100, true), stat('extraDamage', '추가 피해', -1, 100, true), stat('takenDamage', '받는 피해', -1, 100, true),
    stat('skillTrueDmg', '스킬 고정 피해'), stat('skillCooldown', '스킬 쿨타임 보정(ms)', -600000, 600000),
    ...['fire', 'water', 'light', 'dark'].flatMap((element, i) => [stat(element + 'Atk', ['화', '수', '명', '암'][i] + '속성 강화'), stat(element + 'Res', ['화', '수', '명', '암'][i] + '속성 저항')]),
    stat('allElementAtk', '모든 속성 강화'), stat('allElementRes', '모든 속성 저항')
];
const targetStats = [
    ...playerStats.filter(entry => ['atk', 'def', 'hp', 'pnt', 'pntPercent', 'crit', 'critMul', 'critDef', 'cmb', 'maxCmb', 'fireRes', 'waterRes', 'lightRes', 'darkRes', 'allElementRes', 'takenDamage'].includes(entry.key))
];

function validateStats(input, schema) {
    const result = {};
    for (const entry of schema) {
        if (!input || !Object.hasOwn(input, entry.key)) continue;
        const value = input[entry.key];
        if (typeof value !== 'number' || !Number.isFinite(value) || value < entry.min || value > entry.max || entry.key === 'maxCmb' && !Number.isInteger(value)) throw new Error(entry.label + ' 설정 범위를 확인해주세요.');
        result[entry.key] = value;
    }
    return result;
}

function configure(realUser, config = {}) {
    const current = sessions.get(realUser.name);
    if (!config || typeof config !== 'object') throw new Error('훈련장 설정을 확인해주세요.');
    const overrides = config.restorePlayer ? {} : config.player ? validateStats(config.player, playerStats) : current ? current.field.training.overrides : {};
    const previousTarget = current && current.field.training.target;
    const target = Object.assign({ name: '훈련장 허수아비', kind: 'normal', hp: 1000000, def: 0, atk: 0, pnt: 0, pntPercent: 0, crit: 0, critMul: 1.5, critDef: 0, cmb: 0, maxCmb: 0, counterAttack: false }, previousTarget, validateStats(config.target, targetStats));
    if (config.target && Object.hasOwn(config.target, 'kind')) {
        if (!['normal', 'elite', 'boss'].includes(config.target.kind)) throw new Error('허수아비 종류를 확인해주세요.');
        target.kind = config.target.kind;
    }
    if (config.target && Object.hasOwn(config.target, 'counterAttack')) {
        if (typeof config.target.counterAttack !== 'boolean') throw new Error('허수아비 반격 설정을 확인해주세요.');
        target.counterAttack = config.target.counterAttack;
    }
    if (current) { rpg.clearFieldRuntimeTimers(current.name); rpg.drainFieldTickEvents(current.name); rpg.drainFieldActionEffectIds(current.name); }
    const user = Object.assign(Object.create(Object.getPrototypeOf(realUser)), structuredClone(realUser));
    user.name = 'training:' + realUser.name;
    user.pendingFragment = null;
    user.fieldCooldowns = { nextActionAt: 0, skillCooldowns: {} };
    user.field = { name: '훈련장', enteredAt: Date.now(), nextActionAt: 0, skillCooldowns: {}, equipmentState: {}, training: {
        overrides, target, targetHp: target.hp, touchedAt: Date.now(),
        metrics: { damage: 0, received: 0, hits: 0, criticals: 0, kills: 0, lastDamage: 0, maxDamage: 0, startedAt: null }
    } };
    user.save = async () => { throw new Error('훈련장 캐릭터는 저장할 수 없습니다.'); };
    const stats = rpg.calculateUserStats(user);
    user.hp = Number(stats.hp || 1);
    user.mp = Number(stats.mp || 0);
    sessions.set(realUser.name, user);
    return user;
}

function get(realUser) {
    const now = Date.now();
    for (const [name, user] of sessions) if (now - user.field.training.touchedAt > 30 * 60 * 1000) { sessions.delete(name); rpg.drainFieldTickEvents(user.name); rpg.drainFieldActionEffectIds(user.name); }
    const user = sessions.get(realUser.name) || configure(realUser);
    user.field.training.touchedAt = now;
    return user;
}

function describe(user) {
    const data = user.field.training, stats = rpg.calculateUserStats(user);
    const elapsed = data.metrics.startedAt ? Math.max(1, (Date.now() - data.metrics.startedAt) / 1000) : 0;
    return {
        target: data.target, overrides: data.overrides, stats,
        playerStats, targetStats,
        metrics: Object.assign({}, data.metrics, { elapsed, dps: elapsed ? Math.round(data.metrics.damage / elapsed) : 0 })
    };
}

module.exports = { configure, get, describe };
