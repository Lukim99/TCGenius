// Writes ad/clipman.js from each captured clip's log.json (fps, frame count, labelled marks).
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'assets', 'clips');
const man = {};
for (const name of fs.readdirSync(dir)) {
    const log = path.join(dir, name, 'log.json');
    if (fs.existsSync(log)) man[name] = JSON.parse(fs.readFileSync(log, 'utf8'));
}
fs.writeFileSync(path.join(__dirname, 'ad', 'clipman.js'), 'window.CLIPMAN = ' + JSON.stringify(man) + ';\n');
console.log('clipman:', Object.entries(man).map(([k, v]) => k + '(' + v.frames + ')').join(' '));
