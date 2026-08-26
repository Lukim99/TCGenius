const assert = require('assert');
const fs = require('fs');
const path = require('path');
const transcendEquipment = require('../transcend_equipment');
const combatEffects = require('../public/combat-effects');

const ROOT = path.join(__dirname, '..', 'DB', 'RPGenius', 'ui', '필드', '이펙트');
const skills = require('../DB/RPGenius/Skills.json');
const extraSkills = require('../DB/RPGenius/ExtraSkills.json');
const equipmentPassives = require('../DB/RPGenius/EquipmentPassive.json');

const expected = {
    '속성': ['화', '수', '명', '암'],
    '스킬': [...skills, ...extraSkills].map(skill => skill.name).concat('자폭'),
    '소환수': ['익테봇 공격', '익테봇 피해대행', '수나타 공격', '수나타 강화'],
    '장비': Object.keys(transcendEquipment.uniquePassiveDescriptions)
        .concat(equipmentPassives.map(passive => passive.name), ['000 장비', '데우스 엑스 마키나', '징수의 총']),
    '세트': Object.keys(transcendEquipment.setEffects),
    '전투': [
        '기본 공격', '치명타', '운명 피해', '연격 추가타', '추가 피해', '고정 피해', '속성 추가 피해', '프리즘 추가 공격',
        '화상 부여', '화상 틱', '화상 폭발', '겁화 부여', '겁화 틱', '장송곡 폭발', '심판 표식', '천공 폭발', '그림자 공격',
        '표식 부여', '표식 지속 피해', '보호막 부여', '보호막 흡수', '보호막 파괴', 'HP 회복', 'MP 회복', '생명력 흡수',
        '마나 흡수', '회피', '가시 반사', '처형', '방어', '자해', '상태 해제', '버프', '디버프', '공격력 강화',
        '공격력 감소', '방어력 감소', '방어 관통 강화', '받는 피해 증가', '받는 피해 감소', '치명타 확률 증가',
        '치명타 피해 증가', '치명타 확정', '속성 강화', '속성 저항', '쿨타임 감소', '행동 가속', 'HP 봉인', 'MP 소모',
        '빙결', '카운터', '기절', '무적', '중첩 획득', '중첩 소모', '골드 획득', '소환 해제'
    ]
};

function inspectPng(file) {
    const png = fs.readFileSync(file);
    assert.strictEqual(png.subarray(1, 4).toString('ascii'), 'PNG', file + ' 파일 형식');
    assert.strictEqual(png.readUInt32BE(16), 512, file + ' 너비');
    assert.strictEqual(png.readUInt32BE(20), 512, file + ' 높이');
    assert.strictEqual(png[25], 6, file + '는 투명 알파를 가진 RGBA PNG여야 한다.');
}

let total = 0;
for (const [category, names] of Object.entries(expected)) {
    const uniqueNames = [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ko'));
    const actualNames = fs.readdirSync(path.join(ROOT, category))
        .filter(name => name.endsWith('.png'))
        .map(name => path.basename(name, '.png'))
        .sort((a, b) => a.localeCompare(b, 'ko'));
    assert.deepStrictEqual(actualNames, uniqueNames, category + ' 이펙트가 데이터 정의와 정확히 일치해야 한다.');
    uniqueNames.forEach(name => inspectPng(path.join(ROOT, category, name + '.png')));
    total += uniqueNames.length;
}

assert.strictEqual(total, 212, '전체 개별 이펙트 수');

const attackEvent = combatEffects.annotateEvent({
    actor: 'opp', action: 'attack', effectElement: '화',
    triggeredEffectIds: ['equipment:마나번 햇'],
    hits: [
        { damage: 100, type: 'hit', isComboHit: false },
        { damage: 90, type: 'hit', isComboHit: true },
        { damage: 70, type: 'additional', label: '프리즘 추가 공격' },
        { damage: 15, type: 'summonAbsorbed', label: '익테봇 피해 대행' }
    ]
});
assert.ok(attackEvent.effectIds.includes('equipment:마나번 햇'), '실제 발동 장비는 이벤트 이펙트로 전달돼야 한다.');
assert.ok(attackEvent.hits[1].effectIds.includes('combat:연격 추가타'), '연격 추가타는 독립 이펙트여야 한다.');
assert.ok(attackEvent.hits[2].effectIds.includes('equipment:레인보우 프리즘') && attackEvent.hits[2].effectIds.includes('combat:프리즘 추가 공격'), '프리즘 수치는 전용 이펙트를 가져야 한다.');
assert.ok(attackEvent.hits[3].effectIds.includes('summon:익테봇 피해대행'), '소환수 피해 대행은 전용 이펙트를 가져야 한다.');
assert.ok(attackEvent.hits.slice(0, 3).every(hit => hit.effectIds.includes('element:화')), '각 공격 수치에 속성 이펙트가 붙어야 한다.');

const burnEvent = combatEffects.annotateEvent({ actor: 'me', action: 'dot', skillName: '화상', effectElement: '화', hits: [{ damage: 33, label: '화상' }] });
assert.ok(burnEvent.hits[0].effectIds.includes('combat:화상 틱') && burnEvent.hits[0].effectIds.includes('equipment:잿불 모자'), '화상 틱은 부여 장비와 틱 전용 이펙트를 가져야 한다.');
assert.ok(combatEffects.labelEffects('심연 추가 공격').includes('equipment:심연'), '심연의 추가 공격을 연격으로 오인하지 않고 독립 장비 이펙트로 표시해야 한다.');

const actorSkill = combatEffects.annotateEvent({ actor: 'opp', action: 'skill', skillName: '가속', text: '행동 쿨타임이 감소합니다.' });
const targetSkill = combatEffects.annotateEvent({ actor: 'opp', action: 'skill', skillName: '빅뱅', damage: 120, hits: [{ damage: 120 }] });
const mixedSkill = combatEffects.annotateEvent({ actor: 'opp', action: 'skill', skillName: '자인', damage: 100, hits: [{ damage: 100 }] });
assert.strictEqual(actorSkill.effectTarget, 'actor', '순수 버프 스킬은 시전자에게만 표시해야 한다.');
assert.ok(combatEffects.effectIdsFor(actorSkill, 'actor').includes('skill:가속') && combatEffects.effectIdsFor(actorSkill, 'target').length === 0, '상대가 쓰는 버프도 상대 시전자 위치에만 표시해야 한다.');
assert.strictEqual(targetSkill.effectTarget, 'target', '순수 공격 스킬은 대상에게만 표시해야 한다.');
assert.ok(combatEffects.effectIdsFor(targetSkill, 'target', targetSkill.hits[0]).includes('skill:빅뱅') && combatEffects.effectIdsFor(targetSkill, 'actor').length === 0, '상대가 쓰는 공격도 피격 대상 위치에만 표시해야 한다.');
assert.strictEqual(mixedSkill.effectTarget, 'both', '공격과 버프가 함께 있는 스킬은 양쪽에 표시해야 한다.');
assert.ok(combatEffects.effectIdsFor(mixedSkill, 'actor').includes('combat:공격력 강화'), '복합 스킬의 강화 이펙트는 시전자에게 표시해야 한다.');
assert.ok(!combatEffects.effectIdsFor(mixedSkill, 'target', mixedSkill.hits[0]).includes('combat:공격력 강화'), '복합 스킬의 자기 강화 이펙트를 피격 대상에게 표시하면 안 된다.');
[...skills, ...extraSkills].map(skill => skill.name).concat('자폭').forEach(name => {
    assert.ok(['actor', 'target', 'both'].includes(combatEffects.SKILL_TARGETS[name]), name + ' 스킬 표시 대상 분류');
});
assert.strictEqual(combatEffects.presentationEffectIds(['skill:자인', 'equipment:레인보우 프리즘', 'element:화'], 2).length, 2, '한 위치에 동시에 표시하는 PNG 이펙트 수를 제한해야 한다.');
const skillMotion = combatEffects.motionProfile('skill:자인');
assert.ok(skillMotion.size <= .25 && skillMotion.alpha <= .6, '스킬 PNG 이펙트는 화면을 가리지 않는 크기와 투명도를 사용해야 한다.');

const runtimeSource = ['rpgenius.js', 'pvp.js', path.join('public', 'combat-effects.js')]
    .map(file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
const runtimeRefs = [];
for (const match of runtimeSource.matchAll(/(?:markTriggeredCombatEffect|markTriggeredEffect)\([^\n]*?['"](equipment|set|summon|element|combat|skill)['"]\s*,\s*['"]([^'"]+)['"]/g)) runtimeRefs.push([match[1], match[2]]);
for (const match of runtimeSource.matchAll(/markEquipment\(['"]([^'"]+)['"]\)/g)) runtimeRefs.push(['equipment', match[1]]);
for (const match of runtimeSource.matchAll(/markSet\(['"]([^'"]+)['"]\)/g)) runtimeRefs.push(['set', match[1]]);
for (const [kind, name] of runtimeRefs) {
    const asset = combatEffects.assetPath(combatEffects.id(kind, name));
    assert.ok(asset && fs.existsSync(path.join(__dirname, '..', 'DB', 'RPGenius', 'ui', asset)), kind + ':' + name + ' 런타임 이펙트 파일');
}
console.log('combat effect assets test passed (' + total + ')');
