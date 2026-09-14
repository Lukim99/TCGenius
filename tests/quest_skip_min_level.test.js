const assert = require('assert');
const { DynamoDBDocumentClient } = require('@aws-sdk/lib-dynamodb');
DynamoDBDocumentClient.prototype.send = async command => {
    if (command.constructor.name === 'GetCommand') return {};
    if (command.constructor.name === 'ScanCommand') return { Items: [] };
    throw new Error('Unexpected isolated DB command: ' + command.constructor.name);
};

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
