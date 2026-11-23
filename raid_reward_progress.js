'use strict';

function fromLegacy(user) {
    const progress = {};
    for (const key of ['hoduRewardWeek', 'hoduRewardCount', 'butaRewardWeek', 'mansionRewardWeek', 'mansionNightmareFirst']) {
        if (user.titleProgress?.[key] !== undefined) progress[key] = structuredClone(user.titleProgress[key]);
    }
    if (user.titles?.includes('hoduExtreme')) progress.hoduExtremeFirst = true;
    return progress;
}

function getProgress(user) {
    if (user.raidRewardProgress === undefined) {
        // 기존 계정은 명시적인 이전 작업으로 1번 캐릭터에만 기록을 승계한다.
        // 누락된 이전을 새 캐릭터로 취급하면 최초 보상이 재지급될 수 있다.
        if (user.accountId) throw new Error('캐릭터별 레이드 보상 기록 이전이 필요합니다.');
        user.raidRewardProgress = fromLegacy(user);
    }
    return user.raidRewardProgress;
}

module.exports = { fromLegacy, getProgress };
