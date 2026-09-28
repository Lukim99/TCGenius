// Static captures of the real web UI (desktop 1440x900 @2x, mobile 390x844 @3x, standalone 1920x1080).
// Usage: node shots.js [name,name,...]
const path = require('path');
const fs = require('fs');
const { open, settle } = require('./browser');

const OUT = path.join(__dirname, '..', 'assets', 'shots');
fs.mkdirSync(OUT, { recursive: true });

const click = sel => async page => { await page.click(sel); await settle(page, 900); };
const tab = name => '/?tab=' + encodeURIComponent(name);

const DESKTOP = [
    { name: 'profile', url: tab('info'), full: true },
    { name: 'profile_cards', url: tab('info'), prep: click('[data-pftab="cards"]'), full: true },
    { name: 'profile_stats', url: tab('info'), prep: click('[data-pftab="stats"]'), full: true },
    { name: 'profile_blessings', url: tab('info'), prep: click('[data-pftab="blessings"]'), full: true },
    { name: 'inventory_items', url: tab('inventory'), full: true },
    { name: 'inventory_cards', url: tab('inventory'), prep: click('.inv-kind-tab[data-kind="cards"]'), full: true },
    { name: 'inventory_equipment', url: tab('inventory'), prep: click('.inv-kind-tab[data-kind="equipment"]'), full: true },
    { name: 'inventory_pets', url: tab('inventory'), prep: click('.inv-kind-tab[data-kind="pet"]'), full: true },
    { name: 'hunt', url: tab('사냥') },
    {
        name: 'combine_ready', url: tab('combine'), prep: async page => {
            // Three same-grade (Zeta) normal cards; the pool re-renders after every pick, so re-query each time.
            for (const who of ['[𝛧] 오버라이드', '[𝛧] 일레이나', '[𝛧] 마쉐비']) { await page.click('.combine-pool-card:has-text("' + who + '")'); await page.waitForTimeout(300); }
            await settle(page, 900);
        }
    },
    { name: 'jobcombine', url: tab('jobcombine') },
    { name: 'equipment_synthesis', url: tab('equipment-synthesis') },
    { name: 'dex_weapon', url: tab('dex'), full: true },
    { name: 'dex_accessory', url: tab('dex'), prep: click('.dex-tab[data-tab="accessory"]'), full: true },
    { name: 'dex_character', url: tab('dex'), prep: click('.dex-tab[data-tab="character"]'), full: true },
    { name: 'dex_title', url: tab('dex'), prep: click('.dex-tab[data-tab="title"]'), full: true },
    { name: 'shop_hotdeal', url: tab('shop') },
    { name: 'shop_garnet', url: tab('shop'), prep: async page => { await page.click('.shop-tab >> text=가넷'); await settle(page, 900); }, full: true },
    { name: 'shop_transcend', url: tab('shop'), prep: async page => { await page.click('.shop-tab >> text=초월'); await settle(page, 900); }, full: true },
    { name: 'shop_package', url: tab('shop'), prep: async page => { await page.click('.shop-tab >> text=패키지'); await settle(page, 900); }, full: true },
    { name: 'auction', url: tab('auction'), full: true },
    { name: 'buyorder', url: tab('buyorder'), full: true },
    { name: 'ranking', url: tab('ranking'), full: true },
    { name: 'lockbox', url: tab('자물쇠') },
    { name: 'levelreward', url: tab('레벨보상'), full: true },
    { name: 'patchnotes', url: tab('patchnotes'), full: true },
    { name: 'pvp_board', url: tab('pvp'), full: true },
    { name: 'chat_public', url: tab('chat'), prep: async page => { await page.click('#webChatRoomList >> text=자유 채팅 1'); await settle(page, 1200); } },
    { name: 'chat_bot', url: tab('chat'), prep: async page => { await page.click('#webChatRoomList >> text=RPGenius 개인 채팅'); await settle(page, 1200); } },
    { name: 'home', url: '/' }
];
const STANDALONE = [
    { name: 'field_select', url: '/field' },
    { name: 'hfield_lobby', url: '/hfield' },
    { name: 'party_lobby', url: '/party' }
];
const MOBILE = [
    { name: 'm_profile', url: tab('info'), full: true },
    { name: 'm_inventory', url: tab('inventory') },
    { name: 'm_hunt', url: tab('사냥') },
    { name: 'm_shop', url: tab('shop') },
    { name: 'm_lockbox', url: tab('자물쇠') },
    { name: 'm_field', url: '/field' },
    { name: 'm_hfield', url: '/hfield' }
];

async function run(list, opts) {
    const only = process.argv[2] ? new Set(process.argv[2].split(',')) : null;
    const todo = list.filter(s => !only || only.has(s.name));
    if (!todo.length) return;
    const { browser, page, BASE } = await open(opts);
    for (const shot of todo) {
        await page.goto(BASE + shot.url);
        await settle(page, opts.wait || 1500);
        if (shot.prep) await shot.prep(page);
        await page.screenshot({ path: path.join(OUT, shot.name + '.png'), fullPage: !!shot.full });
        console.log('shot', shot.name);
    }
    await browser.close();
}

(async () => {
    await run(DESKTOP, { width: 1440, height: 900, scale: 2 });
    await run(STANDALONE, { width: 1920, height: 1080, scale: 1, wait: 3500 });
    await run(MOBILE, { width: 390, height: 844, scale: 3, mobile: true, wait: 2500 });
})().catch(e => { console.error(e); process.exit(1); });
