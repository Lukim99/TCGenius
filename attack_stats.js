'use strict';

// 공격력 증감은 모두 plusStats.atk에 합산한다. baseAtk는 % 적용 전 수치다.
function addPercent(stats, amount, flat = 0) {
    if (!amount && !flat) return stats;
    const previous = Number(stats.plusStats?.atk || 0);
    if (stats.baseAtk == null) stats.baseAtk = Number(stats.atk || 0) / (1 + previous);
    stats.baseAtk += flat;
    stats.plusStats = { ...stats.plusStats, atk: previous + Number(amount) };
    stats.atk = Math.max(0, Math.round(stats.baseAtk * (1 + stats.plusStats.atk)));
    return stats;
}

// 이미 공격력으로 만든 스킬/일반 공격 피해에 타격 시점의 공격력%를 합산한다.
function ratio(stats, amount, flat = 0) {
    if (!amount && !flat) return 1;
    const percent = Number(stats.plusStats?.atk || 0);
    const base = Number(stats.baseAtk ?? (Number(stats.atk || 0) / (1 + percent)));
    return Number(stats.atk || 0) > 0 ? Math.max(0, (base + flat) * (1 + percent + amount)) / stats.atk : 1;
}

module.exports = { addPercent, ratio };
