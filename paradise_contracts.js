// 카드 계약만 같은 후보군의 다른 보상보다 드물게 뽑는다. 전체 등급/이벤트 확률은 유지한다.
const WEIGHT = .35;
const isCardReward = entry => !!(entry.cardContract || entry.quest?.reward?.star || entry.prize?.star);
const isCombatReward = entry => entry.cardContract === 'combat' || !!entry.quest?.reward?.star;
function pick(list, random = Math.random) {
    const weight = entry => isCardReward(entry) ? WEIGHT : 1;
    let roll = random() * list.reduce((sum, entry) => sum + weight(entry), 0);
    return list.find(entry => (roll -= weight(entry)) < 0) || list.at(-1);
}
module.exports = { WEIGHT, isCardReward, isCombatReward, pick };
