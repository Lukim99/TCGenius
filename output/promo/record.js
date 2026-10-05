// 실제 레이드 화면을 CDP 스크린캐스트로 고화질 녹화하고, 연출 비트의 시각을 기록한다.
const fs = require('fs');
const path = require('path');
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');

const OUT = process.argv[2];
const CTL = 'http://127.0.0.1:4556/';
const GAME = 'http://127.0.0.1:4555';
fs.mkdirSync(path.join(OUT, 'frames'), { recursive: true });
const beat = async (name, arg) => (await fetch(CTL + name + (arg !== undefined ? '/' + encodeURIComponent(arg) : ''))).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
const marks = [];
let t0 = 0;
const mark = label => { const t = (Date.now() - t0) / 1000; marks.push({ t, label }); console.log(t.toFixed(2), label); };

(async () => {
    await beat('setup');
    const ck = await beat('cookie');
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1480 }, deviceScaleFactor: 1 });
    await ctx.addCookies([{ name: 'rpg_admin', value: ck.cookie, domain: '127.0.0.1', path: '/' }]);
    const page = await ctx.newPage();
    page.on('pageerror', e => console.log('pageerror', e.message));
    await page.goto(GAME + '/party');
    // 촬영 화면: 실제 반응형 레이아웃에서 프레임을 창 전체로 넓혀 전투 무대를 16:9에 가깝게 키운다.
    await page.addStyleTag({ content: '.frame{width:100vw!important;height:100vh!important;border-radius:0!important;box-shadow:none!important}' });
    await page.waitForTimeout(1500);

    const cdp = await ctx.newCDPSession(page);
    const index = [];
    let n = 0;
    cdp.on('Page.screencastFrame', async f => {
        const file = String(n++).padStart(6, '0') + '.jpg';
        index.push({ file, ts: f.metadata.timestamp });
        fs.writeFile(path.join(OUT, 'frames', file), Buffer.from(f.data, 'base64'), () => {});
        cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
    });
    t0 = Date.now();
    const wallStart = Date.now() / 1000;
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1920, maxHeight: 1480, everyNthFrame: 1 });

    // 내 캐릭터의 공격/스킬은 실제 단축키 입력으로 진행한다.
    let attacking = false;
    (async () => {
        let i = 0;
        while (true) {
            if (attacking) {
                i++;
                const key = i % 9 === 0 ? 'Digit1' : i % 13 === 0 ? 'Digit2' : 'Space';
                await page.keyboard.press(key === 'Space' ? ' ' : key === 'Digit1' ? '1' : '2').catch(() => {});
            }
            await wait(430 + Math.random() * 120);
        }
    })();
    const click = async sel => { try { await page.click(sel, { timeout: 2500 }); return true; } catch (e) { console.log('click fail', sel, e.message.split('\n')[0]); return false; } };
    const clickText = async (text, fallback) => {
        try { await page.click(`#pqMansionRoot button:has-text("${text}")`, { timeout: 1500, force: true }); return true; }
        catch (e) { console.log('click fail', text, e.message.split('\n')[0]); if (fallback) console.log('fallback', JSON.stringify(await beat('act', fallback))); return false; }
    };
    const evOf = async kind => ((await state()).events || []).find(e => e.kind === kind);
    const saveIndex = () => fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({ wallStart, frames: index, marks }, null, 1));
    setInterval(saveIndex, 3000);
    const waitClear = async (max = 10000) => { const end = Date.now() + max; while (Date.now() < end) { const st = await state(); if (!(st.events || []).length) return; await wait(150); } console.log('waitClear timeout'); };
    const waitEvent = async (kind, max = 6000) => { const end = Date.now() + max; while (Date.now() < end) { if (await evOf(kind)) return true; await wait(100); } console.log('waitEvent timeout', kind); return false; };
    const state = () => beat('state');

    mark('lobby');
    await wait(3500);
    await click('button:has-text("준비")');
    await wait(900);
    mark('start-click');
    await click('button:has-text("퀘스트 시작")');
    await wait(300);
    await beat('boost');
    await beat('floor', 0.705);
    mark('intro');
    await wait(4200);
    attacking = true;
    mark('p1-combat');
    await wait(5000);

    mark('shards'); await beat('pattern', 'shards'); await wait(5200);
    mark('harden'); await beat('pattern', 'harden'); await wait(4800);
    mark('blessing'); await beat('pattern', 'blessing'); await wait(1600);
    await clickText('받아들이기', 'blessing:accept'); mark('blessing-accept'); await wait(3600);

    await waitClear();
    mark('pillars'); await beat('floor', 0.52); await beat('pillars'); await waitEvent('pillars'); mark('pillars-on'); await wait(1600);
    // 내 손으로 두 번 옮기고, 나머지는 파티원이 맞춘다.
    for (let k = 0; k < 2; k++) {
        const ev = await evOf('pillars');
        if (!ev) break;
        const from = ev.loads.indexOf(Math.max(...ev.loads)), to = ev.loads.indexOf(Math.min(...ev.loads));
        const pillars = await page.$$('#pqMansionRoot .mr-pillar');
        if (pillars[from] && pillars[to]) { await pillars[from].click().catch(() => {}); await wait(250); await pillars[to].click().catch(() => {}); }
        await wait(600);
    }
    await beat('solvePillars');
    mark('pillars-solving');
    await wait(5500);

    await waitClear();
    attacking = false; await beat('bots', '0'); await wait(900);
    mark('sculpture'); await beat('floor', 0.03); await beat('sculpture'); await waitEvent('sculpture', 9000); mark('sculpture-on'); await wait(1200);
    for (let k = 0; k < 2; k++) { await page.keyboard.press(' '); await wait(650); }
    await beat('gauge', 100); await wait(700);
    await click('[data-support="눈뜬 장님"]'); mark('eyes'); await wait(900);
    await clickText('완성', 'sculpture:finish'); mark('sculpture-finish'); attacking = true; await beat('bots', '1'); await wait(4200);

    mark('p1-kill'); await beat('floor', 'off'); await beat('killPhase'); await wait(9000);
    let s = await state(); mark('phase ' + s.phase + ' ' + s.state);
    await beat('floor', 0.755); await wait(3500);

    await waitClear(); mark('resonance'); await beat('pattern', 'resonance'); await wait(4800);
    await waitClear(); mark('echo'); await beat('pattern', 'echo'); await wait(5200);
    await waitClear(); mark('wall'); await beat('pattern', 'wall'); await wait(2800);
    await waitClear(); mark('pulse'); await beat('pattern', 'pulse'); await wait(1500);
    let ev = await evOf('pulse');
    if (ev) { const a = ev.pulse === 'gather' ? 'release' : 'absorb'; await clickText(a === 'release' ? '방출' : '흡수', 'pulse:' + a); }
    mark('pulse-choice'); await wait(3500);
    await beat('gauge', 100); await wait(500);
    await click('[data-support="오로라"]'); mark('aurora'); await wait(3500);

    await waitClear();
    mark('trial'); await beat('floor', 0.1); await beat('trial'); await waitEvent('trial'); mark('trial-on'); await wait(8600);
    mark('trial-shield'); await beat('gauge', 100); await wait(1200);
    await click('[data-support="피카츄"]'); mark('pikachu');
    for (let k = 0; k < 20; k++) { s = await state(); if (!s.events?.some(e => e.kind === 'trial')) break; await wait(500); }
    mark('trial-done'); await wait(3500);

    mark('to-hp1'); await beat('floor', 1 / 24000000 + 1e-12); await beat('toHpOne'); await wait(6500);
    s = await state(); mark('form ' + s.form);
    await beat('floor', 0.06); await wait(2500);
    mark('inversion'); await beat('inversionSoon'); await wait(1300);
    ev = await evOf('inversion');
    if (ev) { const a = ev.pulse === 'gather' ? 'absorb' : 'release'; await clickText(a === 'release' ? '방출' : '흡수', 'inversion:' + a); }
    mark('inversion-choice'); await wait(3200);
    mark('rupture'); await beat('rupture'); await wait(3500);

    mark('kill'); await beat('floor', 'off'); await beat('kill'); await wait(2500);
    attacking = false;
    await wait(9000);
    mark('end');
    await cdp.send('Page.stopScreencast');
    await wait(800);
    saveIndex();
    await browser.close();
    process.exit(0);
})();
