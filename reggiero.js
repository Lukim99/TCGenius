'use strict';

// 스냅샷에 이미 적용된 값을 빼고 현재 상태를 적용해 필드·레이드·PVP에서 중복 가산을 막는다.
function applyBlackWhite(stats, startedAt, now = Date.now()) {
    if (!stats.blackWhitePower) return stats;
    const black = Math.floor(Math.max(0, now - (startedAt ?? now)) / 10000) % 2 === 0;
    const value = Number(stats.blackWhitePower) * (black ? 1 : -1);
    const delta = value - Number(stats.blackWhiteApplied || 0);
    stats.darkAtk = Number(stats.darkAtk || 0) + delta;
    stats.lightAtk = Number(stats.lightAtk || 0) - delta;
    stats.blackWhiteApplied = value;
    return stats;
}
module.exports = { applyBlackWhite };
