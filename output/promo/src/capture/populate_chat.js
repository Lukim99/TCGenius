// Fill the real web chat (public room 1) with a short conversation between seeded accounts.
const { open } = require('./browser');

const LINES = [
    ['별빛사냥꾼', 'RIVAL0', '흑화 호두 익스트림 가실 분 구해요 (2/5)'],
    ['새벽달', 'RIVAL1', '저요! 딜러 자리 비었나요?'],
    ['코인요정', 'RIVAL2', '핫딜샵에 6성 카드팩 떴어요 👀'],
    ['지니어스', 'PROMO2026', '방금 낮과 밤의 경계 +15 성공했습니다 🔥'],
    ['포커페이스', 'RIVAL4', 'ㄷㄷ 초월 3단계 +15면 전투력 몇이에요?'],
    ['지니어스', 'PROMO2026', '200만 넘었어요 ㅎㅎ 월드보스 흑막 같이 잡아요'],
    ['딜러의귀환', 'RIVAL3', '추석 이벤트 보름달 누르면 전직 카드팩 줘요!'],
    ['루나틱', 'RIVAL5', '오늘 밤 레이드 파티 모집합니다 🙌']
];

(async () => {
    const sessions = {};
    for (const [name, code, text] of LINES) {
        if (!sessions[name]) sessions[name] = await open({ scale: 1, name, code });
        const { page } = sessions[name];
        const r = await page.evaluate(async text => {
            const res = await fetch('/api/chat/public-1/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
            return res.status;
        }, text);
        console.log(name, r);
        await page.waitForTimeout(650);
    }
    for (const s of Object.values(sessions)) await s.browser.close();
})().catch(e => { console.error(e); process.exit(1); });
