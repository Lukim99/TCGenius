const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const name of ['.env', '.env.local']) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (!match || process.env[match[1].trim()]) continue;
        process.env[match[1].trim()] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    }
}

const rpgenius = require('../rpgenius.js');

(async () => {
    await rpgenius.initRpgeniusData();
    await rpgenius.migrateBlackCurtainContent();
    const items = rpgenius.getDataCache('Item', []);
    const bundles = rpgenius.getDataCache('Bundle', []);
    const recipes = rpgenius.getDataCache('Recipe', []);
    const names = ['흑막의 영혼석', '흑막의 영혼석 조각', '흑막의 상급 꾸러미', '흑막의 중급 꾸러미', '흑막의 하급 꾸러미'];
    console.log(JSON.stringify({
        itemCount: items.length,
        bundleCount: bundles.length,
        recipeCount: recipes.length,
        items: names.map(name => {
            const id = items.findIndex(item => item && item.name == name);
            return { id, name, pack: id >= 0 ? items[id].pack : undefined };
        })
    }, null, 2));
})().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
