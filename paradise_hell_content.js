const KEYS = [
    { name: '지옥 열쇠', drops: 5, icon: 'hell-key' },
    { name: '화려한 지옥 열쇠', drops: 6, icon: 'hell-key-ornate' },
    { name: '찬란한 지옥 열쇠', drops: 7, icon: 'hell-key-radiant' }
];
// 명시 등록용 최초 보상표. 실행 중에는 운영 Paradise.hell과 입장 시 저장한 표를 사용한다.
const INITIAL_CONFIG = { enabled: true, rewards: [
    { id: 'orb', name: '보주', kind: 'orb', counts: [1,2,3,4,5,6,7,8,10,12,15] },
    { id: 'protection', name: '보호권', kind: 'item', items: ['장비 보호권','고급 장비 보호권','장비 보호권','장비 보호권', ...Array(7).fill('고급 장비 보호권')], counts: [1,1,2,3,3,5,7,10,12,15,20] },
    { id: 'normalCard', name: '일반카드', kind: 'card', cardType: '일반', stars: [5,6,6,7,7,8,8,9,9,10,10], counts: [3,2,4,2,4,2,4,2,4,2,4] },
    { id: 'jobCard', name: '전직카드', kind: 'card', cardType: '전직', stars: [5,6,6,7,7,8,8,9,9,10,10], counts: [2,1,3,1,3,1,3,1,3,1,3] },
    { id: 'awakeningCard', name: '각성카드', kind: 'card', cardType: '각성', stars: [5,5,6,6,7,7,8,8,9,9,10], counts: [1,3,1,3,1,3,1,3,1,3,1] },
    { id: 'bait', name: '미끼', kind: 'item', item: '익명 지렁이', counts: [20,50,100,150,250,300,400,600,800,1200,2000] },
    { id: 'invitation', name: '초대장', kind: 'item', item: '헬 초대장', counts: [100,150,200,300,400,550,700,900,1200,1600,2000] },
    { id: 'key', name: '열쇠', kind: 'item', item: '지니어스의 열쇠', counts: [10,30,50,75,90,120,150,200,250,300,500] },
    { id: 'fragment', name: '초월조각', kind: 'item', item: '초월 조각', counts: [3,6,10,15,20,30,40,55,70,95,130] }
] };
module.exports = { KEYS, INITIAL_CONFIG };
