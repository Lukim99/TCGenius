const { open } = require('./browser');
(async () => {
    const { browser, page } = await open({ scale: 1 });
    const send = async text => { await page.evaluate(async text => fetch('/api/chat/me/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) }), text); await page.waitForTimeout(1500); };
    for (const c of ['/rpg 필드입장 월도랜드5', '/rpg 공격', '/rpg 공격', '/rpg 스킬 불사조']) await send(c);
    const hist = await page.evaluate(async () => (await fetch('/api/chat/me/history')).json());
    for (const m of hist.messages) console.log('---', m.sender.type, '\n' + m.text + (m.moreText ? '\n[more]\n' + m.moreText : ''));
    await browser.close();
})();
