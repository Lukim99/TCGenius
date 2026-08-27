const assert = require('assert');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*([^#=]+)=(.*)$/);
        if (match) process.env[match[1].trim()] = match[2].trim();
    }
}

const rpg = require('../rpgenius');
const quest = {
    id: 1,
    name: '스킵 기준 테스트',
    categories: ['일반'],
    minLevel: 10,
    maxLevel: 100,
    skippable: true,
    objectives: [{ type: 'kill', count: 1 }],
    rewards: [],
    unlock: { type: 'always' },
    enabled: true
};

rpg.__setQuestDefs([quest]);

const belowThreshold = { level: 39, quests: {} };
assert.strictEqual(rpg.buildQuestBoard(belowThreshold)[0].canSkip, false);
assert.match(rpg.claimQuestReward(belowThreshold, quest.id, { skip: true }).error, /최소 레벨\(Lv\.10\)/);

const atThreshold = { level: 40, quests: {} };
assert.strictEqual(rpg.buildQuestBoard(atThreshold)[0].canSkip, true);
assert.strictEqual(rpg.claimQuestReward(atThreshold, quest.id, { skip: true }).ok, true);

rpg.__setQuestDefs([Object.assign({}, quest, { maxLevel: 999 })]);
assert.strictEqual(rpg.buildQuestBoard({ level: 40, quests: {} })[0].maxLevel, 300);

console.log('quest_skip_min_level.test.js: OK');
