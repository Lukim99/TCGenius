// 천상 전용 확장 훅. 전투와 선택 상태는 각 기능의 탐험 데이터에 저장한다.
const modules = [require('./paradise_traits'), require('./paradise_playful'), require('./paradise_stones')];
const active = user => user?.paradise?.status === 'active' && user.paradise.mode !== 'hell' && user.field?.paradise === true;
function call(hook, user, ...args) {
    if (!active(user)) return;
    for (const feature of modules) feature[hook]?.(user, ...args);
}
function incomingMultiplier(user, damage) {
    if (!active(user) || damage <= 0) return 1;
    return modules.reduce((value, feature) => value * (feature.incomingMultiplier?.(user, damage) ?? 1), 1);
}
function survive(user, nextHp, maxHp) {
    if (!active(user) || nextHp > 0) return nextHp;
    for (const feature of modules) {
        const hp = feature.survive?.(user, nextHp, maxHp);
        if (hp > 0) return hp;
    }
    return 0;
}
function view(user) {
    return active(user) ? modules.flatMap(feature => feature.view?.(user) || []) : [];
}
module.exports = { call, incomingMultiplier, survive, view };
