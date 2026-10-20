// 전투 규칙, 탐험 계약, 유물 거래를 바꾸는 증강.
const a = (id, name, floors, rarity, category, desc, effect = {}, options = {}) => ({
    id, name, floors, rarity, category, desc, effect, ...options
});
module.exports = [
    a('pocketSand', '주머니 속 모래', 4, 'silver', 'defense', '매 전투 처음 받는 적의 공격을 한 번 무효화합니다.', { pocketSand: 1 }),
    a('windupKey', '태엽 감는 손', 5, 'silver', 'skill', '일반 공격을 3번 적중시키면 남은 쿨타임이 가장 긴 스킬의 쿨타임이 3초 줄어듭니다.', { windupKey: 1 }),
    a('paperWard', '접어 만든 성벽', 5, 'silver', 'defense', '스킬로 소비한 MP의 3배만큼 10초 동안 유지되는 보호막을 생성합니다. 보호막은 최대 HP의 25%까지 생성하며, 기존 보호막을 교체합니다.', { paperWard: 1 }),
    a('sparkJar', '불꽃 저금통', 6, 'silver', 'critical', '직접 공격에서 치명타가 나오지 않을 때마다 불꽃을 모읍니다. 3개를 모으면 다음 직접 공격이 확정 치명타가 됩니다.', { sparkJar: 1 }),
    a('basicContract', '검 한 자루의 약속', 5, 'silver', 'reward', '다음 2회 전투를 스킬 없이 승리하면 5성 일반 카드 계약을 얻습니다. 스킬을 사용하면 계약에 실패합니다.', {}, { quest: { battles: 2, condition: 'basicOnly', reward: { star: 5, type: '일반' } } }),
    a('criticalContract', '급소 사냥 의뢰', 7, 'silver', 'reward', '다음 3회 전투에서 직접 공격 치명타를 합계 5회 이상 내고 모두 승리하면 회랑 유물을 얻습니다.', {}, { quest: { battles: 3, condition: 'criticals', target: 5, reward: { relics: 1 } } }),
    a('puzzleInvite', '접힌 석판 지도', -3, 'silver', 'exploration', '현자의 봉인으로 향하는 샛길을 찾습니다. 다음 방은 퍼즐 사건입니다.', {}, { encounter: 'puzzle' }),
    a('chestInvite', '상자방의 주소', 5, 'silver', 'exploration', '다음 방에서 세 개의 상자를 만납니다.', {}, { encounter: 'chests' }),
    a('forgeInvite', '대장장이의 명함', 5, 'silver', 'exploration', '장착한 장비를 손볼 기회입니다. 다음 방에서 대장장이를 만납니다.', {}, { encounter: 'forge', requiresEquipment: true }),
    a('backpackExchange', '헌 유물 보상', 3, 'silver', 'reward', '일반 회랑 유물 하나를 무작위로 반납하고 5성 전직 카드 계약을 얻습니다.', {}, { special: 'relicCard', requiresRelics: 1 }),
    a('checkpoint', '손때 묻은 책갈피', -5, 'silver', 'recovery', '앞으로 3회 전투에서 승리하면 HP·MP를 전부 회복하고 뒤틀림을 30 낮춥니다.', {}, { quest: { battles: 3, reward: { restore: true } } }),
    a('relicParcel', '세 번 접은 소포', 8, 'silver', 'reward', '앞으로 3회 전투에서 승리하면 소포가 열리고 회랑 유물 하나를 얻습니다.', {}, { quest: { battles: 3, reward: { relics: 1 } } }),
    a('spellContract', '마법사의 증명', 10, 'gold', 'reward', '다음 3회 전투마다 서로 다른 스킬을 2개 이상 사용하고 승리하면 7성 전직 카드 계약을 얻습니다.', {}, { quest: { battles: 3, condition: 'twoSpells', reward: { star: 7, type: '전직' } } }),
    a('duelistContract', '상처 없는 결투', 12, 'gold', 'reward', '다음 3회 전투 중 2회 이상 피격으로 HP를 잃지 않고 승리하면 7성 일반 카드 계약을 얻습니다.', {}, { quest: { battles: 3, condition: 'untouched', target: 2, reward: { star: 7, type: '일반' } } }),
    a('eliteBounty', '도박사의 현상수배', 10, 'gold', 'reward', '다음 두 번의 조우가 엘리트로 고정됩니다. 두 번 모두 승리하면 회랑 유물 2개를 얻습니다.', {}, { quest: { battles: 2, forceElite: true, reward: { relics: 2 } } }),
    a('echoStrike', '메아리 저장고', 12, 'gold', 'basic', '직접 공격 두 번을 한 쌍으로 묶습니다. 두 번째 공격에 첫 공격 피해의 40%가 메아리로 더해집니다.', { echoStrike: 1 }),
    a('relicRoulette', '유물 환전소', 8, 'gold', 'exploration', '일반 회랑 유물 하나를 무작위로 반납하고, 다른 유물 2개를 즉시 뽑습니다.', {}, { special: 'relicExchange', requiresRelics: 1 }),
    a('skillRelay', '바통 터치', 10, 'gold', 'skill', '스킬을 사용하면 다른 스킬들의 남은 쿨타임이 1.5초씩 줄어듭니다.', { skillRelay: 1 }),
    a('emptyHand', '빈손으로 왕좌까지', 20, 'prismatic', 'reward', '일반 회랑 유물을 전부 반납하고 9성 전직 카드 계약을 획득합니다.', {}, { special: 'relicCrown', requiresRelics: 3 }),
    a('sevenBells', '일곱 번째 종소리', 15, 'prismatic', 'reward', '1~7의 숫자 세 개를 추첨합니다. 777이면 9성 각성, 다른 숫자 셋이 같으면 8성 전직, 둘만 같으면 7성 일반 카드 계약을 획득합니다. 모두 다르면 유물 2개를 획득합니다.', {}, { special: 'slotMachine' }),
    a('doubleSignature', '계약서에 덧쓴 서명', 10, 'prismatic', 'reward', '보유한 카드 계약 하나에 운명을 겁니다. 50% 확률로 같은 계약을 하나 더 얻고, 실패하면 그 계약을 잃습니다.', {}, { special: 'doubleContract', requiresCardContract: true }),
    a('deathHandshake', '사신과의 계약', 15, 'prismatic', 'risk', 'HP 1로 다음 엘리트 전투를 시작합니다. 승리하면 8성 각성 카드 계약을 얻습니다.', {}, { special: 'oneHp', quest: { battles: 1, forceElite: true, reward: { star: 8, type: '각성' } } }),
    a('stolenTurn', '훔쳐 온 한 턴', 15, 'prismatic', 'skill', '직접 공격을 5번 적중시키면 가장 긴 스킬 쿨타임을 초기화하고, 다음에 받는 적의 공격을 한 번 무효화합니다.', { stolenTurn: 1 }),
    a('revengeVault', '복수의 금고', 12, 'prismatic', 'risk', '피격으로 잃은 HP를 저장했다가 다음 스킬 공격에 추가 피해로 돌려줍니다. 최대 HP의 2배까지 저장됩니다.', { revengeVault: 1 }),
    a('overkillParcel', '남은 일격의 행선지', 15, 'prismatic', 'basic', '직접 공격으로 적을 처치하고 남은 피해를 다음 전투 첫 직접 공격에 보냅니다. 다음 적 최대 HP의 30%까지 전달합니다.', { overkillParcel: 1 }),
    a('tricksterGift', '장난신의 선물', 12, 'prismatic', 'reward', '봉인된 선물을 즉시 엽니다. 같은 확률로 회랑 유물 3개 또는 7성 각성 카드 계약을 얻습니다.', {}, { special: 'tricksterGift' }),
    a('museumNight', '박물관 야간 개장', 20, 'prismatic', 'exploration', '회랑 유물 3개를 즉시 얻습니다. 다음 엘리트의 HP가 50% 늘어납니다.', {}, { special: 'museumNight' }),
    a('clockHeart', '멈춘 시계의 심장', 15, 'prismatic', 'skill', '매 전투 처음 사용하는 스킬에는 쿨타임이 생기지 않습니다.', { clockHeart: 1 }),
    a('phoenixPact', '불사조의 담보', 20, 'prismatic', 'defense', '사망할 때 일반 회랑 유물 하나를 태우고 HP 30%로 살아납니다. 탐험당 최대 3회 발동합니다. 태울 유물이 없으면 발동하지 않습니다.', { phoenixPact: 1 }),
    a('treasureMap', '황금 방으로 가는 샛길', 15, 'prismatic', 'exploration', '즉시 상자 방으로 이동합니다. 다음 황금 상자에서 저주가 나오면 대신 회랑 유물 하나를 얻습니다.', { goldAmnesty: 1 }, { encounter: 'chests' })
];
