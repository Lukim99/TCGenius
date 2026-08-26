const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const rpgenius = fs.readFileSync(path.join(root, 'rpgenius.js'), 'utf8');
const hfieldClient = fs.readFileSync(path.join(root, 'public', 'hfield.js'), 'utf8');
const generalField = server.slice(server.indexOf('// ===== 일반 필드 ====='), server.indexOf('// ===== PVP ====='));

[
    "server.get('/api/field'",
    "server.post('/api/field/enter'",
    "server.post('/api/field/cancel-entry'",
    "server.post('/api/field/attack'",
    "server.post('/api/field/skill'",
    "server.post('/api/field/use-consumable'",
    "server.post('/api/field/leave'",
    "server.post('/api/field/fragment'"
].forEach(contract => assert.ok(generalField.includes(contract), '누락된 일반 필드 API 계약: ' + contract));

[
    'rpgenius.enqueueFieldAction(seed',
    'rpgenius.enterField(user, dungeon.name',
    'rpgenius.useBasicAttackInField(user)',
    'rpgenius.useSkillInField(user, skillName)',
    'rpgenius.useItem(user, item.name, 1)',
    'rpgenius.leaveField(user)',
    'rpgenius.consumeFragment(user)'
].forEach(contract => assert.ok(generalField.includes(contract), '채팅 솔로 사냥 정식 로직 위임이 누락되었습니다: ' + contract));

assert.ok(generalField.includes("const user = await rpgenius.getRPGUserByName(req.session.name);\n            if (!user) throw new Error('유저를 찾을 수 없습니다.');"), '필드 큐 안에서 최신 유저를 다시 조회해야 합니다.');
assert.ok((generalField.match(/await user\.save\(\)/g) || []).length >= 7, '모든 일반 필드 변경 경로는 결과를 저장해야 합니다.');
assert.ok(rpgenius.includes('const pendingFragmentBlock = getPendingFragmentBlockMessage(user);'), '채팅과 웹이 같은 편린 행동 차단 규칙을 사용해야 합니다.');
assert.ok(generalField.includes('const message = rpgenius.getPendingFragmentBlockMessage(user);'), '일반 필드 API도 공용 편린 차단 규칙을 사용해야 합니다.');
assert.ok(server.includes('function parseFieldIncomingHits(message)'), '일반/H필드의 받는 타격 로그를 개별 피해로 파싱해야 합니다.');
assert.ok((server.match(/label: labelMatch \? labelMatch\[1\]\.trim\(\) : null/g) || []).length >= 2, '일반/H필드는 추가 피해 항목의 이름도 보존해야 합니다.');
assert.ok((server.match(/receivedHits,/g) || []).length >= 2, '일반/H필드 이벤트 모두 receivedHits를 전달해야 합니다.');
assert.ok(hfieldClient.includes('event.receivedHits'), '일반/H필드 UI는 받는 타격을 개별로 표시해야 합니다.');
assert.ok(hfieldClient.includes('receivedDelay + index * 95'), '받는 연격은 타격별 간격을 두고 피격 연출해야 합니다.');
assert.ok(hfieldClient.includes("skill:hit.label||(index===0?event.skillName||'':'')") && hfieldClient.includes("skill:hit.label||''"), '일반/H필드 UI는 각 추가 피해의 이름을 해당 수치와 함께 표시해야 합니다.');
assert.ok(server.includes('effectElement: getWebFieldAttackElement(user, action, skillName, state.skills)') && server.includes('receivedEffectElement:'), '일반/H필드는 양쪽 공격의 실제 속성을 화면에 전달해야 합니다.');
assert.ok(hfieldClient.includes('ELEMENT_EFFECT_COLORS') && hfieldClient.includes("effect.kind === 'burn'") && hfieldClient.includes("effect.kind === 'summon'") && hfieldClient.includes("effect.kind === 'equipment'") && hfieldClient.includes("effect.kind === 'skill'"), '일반/H필드는 화상·소환수·장비·스킬 전용 이펙트를 사용해야 합니다.');
assert.ok(hfieldClient.includes("effect.element === '명'") && hfieldClient.includes("effect.element === '암'") && hfieldClient.includes("effect.element === '수'"), '일반/H필드는 화/수/명/암 속성별 이펙트를 구분해야 합니다.');
assert.ok(hfieldClient.includes('outgoingHits.slice(1).forEach') && hfieldClient.includes('hits:[presentationHit]'), '연격과 추가 피해는 각 개별 수치에 맞는 이펙트를 순서대로 재생해야 합니다.');
assert.ok(rpgenius.includes('const effectContext = getFieldCombatContext(user);') && rpgenius.includes('getFieldCombatTargetKey(user, effectContext) !== tickTargetKey'), 'overdue 장비 DoT는 매 효과 직전에 현재 대상과 페이즈를 다시 검증해야 합니다.');
assert.ok(rpgenius.includes("phaseChanged: sameField && before.phase != phaseAfter") && rpgenius.includes('rewards: getFieldTickRewards(user, before, message)'), '백그라운드 틱은 피해/처치뿐 아니라 페이즈 전환과 보상도 이벤트에 보존해야 합니다.');
assert.ok(rpgenius.includes('clearFieldTickEvents(userName);\n    delete activeFieldChannels[userName];'), '필드 퇴장 시 웹 틱 이벤트 버퍼를 함께 비워야 합니다.');
assert.ok(generalField.includes('state.events = drainWebFieldTickEvents(user.name, state, true);'), '일반 필드 폴링은 일반몹 틱의 피해와 처치 이벤트를 공용 매퍼로 전달해야 합니다.');
assert.ok(server.includes("action: 'tick'") && server.includes('rewards: Array.isArray(event && event.rewards)'), '웹 틱 이벤트는 렌더러가 소비할 action/hits/rewards 계약으로 매핑되어야 합니다.');
assert.ok(server.includes('drainFieldActionEffectIds(user.name)') && server.includes('triggeredEffectIds,'), '일반/H필드는 실제로 발동한 장비·세트 이펙트 ID를 전투 이벤트에 전달해야 합니다.');
assert.ok(hfieldClient.includes('effectCatalog.assetUrl(effectId)') && hfieldClient.includes('drawEffectAssets(time)'), '일반/H필드는 개별 생성 이펙트 PNG를 WebGL 텍스처로 재생해야 합니다.');
assert.ok(hfieldClient.includes("effectCatalog.effectIdsFor(event, 'target', hit)") && hfieldClient.includes('effectCatalog.skillTarget(event)'), '일반/H필드는 공격·버프·복합 스킬의 표시 위치를 공용 분류로 결정해야 합니다.');
assert.ok(hfieldClient.includes("skillAudience === 'actor' || skillAudience === 'both'") && hfieldClient.includes("this.attackKind = skillAudience === 'actor' ? 'buff'"), '자기 버프는 시전자에게만 표시하고 공격 돌진을 재생하지 않아야 합니다.');
assert.ok(hfieldClient.includes('presentationIndex: index + 1') && hfieldClient.includes('this.recentEffects'), '연격 피해 수치는 유지하면서 같은 전체 스킬 이펙트의 중복 재생은 억제해야 합니다.');
assert.ok(hfieldClient.includes('profile.alpha') && hfieldClient.includes('this.effectSprites.slice(-8)'), '일반/H필드 이펙트는 투명도와 동시 표시 수를 제한해야 합니다.');
assert.ok(hfieldClient.includes('playerEffectPoint(role)') && hfieldClient.includes('targetEffectPoint(display, event, advanceMob)'), '모바일 전투 이펙트는 시전자와 대상 종류별 기준점을 사용해야 합니다.');
assert.ok(hfieldClient.includes("y: narrow ? .58 : .54") && hfieldClient.includes("y: position[1] - (narrow ? .07 : .085) * position[2]"), '모바일 기둥과 잡몹 이펙트는 실제 렌더 위치에 맞춰야 합니다.');
assert.ok(hfieldClient.includes("receivedY=narrow?.68:.55") && hfieldClient.includes("y:narrow?.68:.54"), '모바일 피격·처치 숫자는 하단 캐릭터와 잡몹 위치에 맞춰야 합니다.');
assert.ok(hfieldClient.includes(': Math.min(killed, positions.length)') && hfieldClient.includes('if (!strong) this.mobHiddenUntil[slot] = now + 780'), '일반 처치 연출은 실제 처치 수만큼의 잡몹 슬롯만 숨겨야 합니다.');
assert.ok(hfieldClient.includes('if (strong) this.mobRespawnAt = now + 2100') && hfieldClient.includes('const allHidden = time < this.mobRespawnAt && !returning'), '전체 잡몹 밀쳐내기는 엘리트 조우 연출에서만 사용해야 합니다.');
assert.ok(hfieldClient.includes("if(regularMode&&event.eliteEncountered)") && hfieldClient.includes("else if(!regularMode&&event.phaseChanged)"), '백그라운드 틱으로 발생한 일반/H필드 페이즈 전환도 화면에 연출해야 합니다.');
assert.ok(hfieldClient.includes('const fragmentEvent=result.event||{},fragmentRewards=Array.isArray(fragmentEvent.rewards)'), '편린 보상은 event.rewards 한 위치에서 읽어야 합니다.');
assert.ok(hfieldClient.includes("bgm: uiAsset(regularMode ? 'sfx/사냥.mp3' : 'sfx/부타게임H.mp3')"), '일반 필드는 사냥.mp3를, H필드는 기존 배경음악을 사용해야 합니다.');
assert.ok(fs.existsSync(path.join(root, 'DB', 'RPGenius', 'ui', 'sfx', '사냥.mp3')), '일반 필드 배경음악 파일이 필요합니다.');
assert.strictEqual((generalField.match(/field-atlas-[^']+-clean\.png/g) || []).length, 8, '일반 필드 28곳은 몬스터가 겹치지 않는 정리 아틀라스를 사용해야 합니다.');

const cleanAtlasRoot = path.join(root, 'DB', 'RPGenius', 'ui', '필드', '몬스터');
[
    ['field-atlas-1-clean.png', 4], ['field-atlas-2-clean.png', 4], ['field-atlas-3-clean.png', 4],
    ['field-atlas-4a-clean.png', 2], ['field-atlas-4b-clean.png', 2], ['field-atlas-5-clean.png', 4],
    ['field-atlas-6-clean.png', 4], ['field-atlas-7-clean.png', 4]
].forEach(([file, rows]) => {
    const buffer = fs.readFileSync(path.join(cleanAtlasRoot, file));
    assert.strictEqual(buffer.subarray(1, 4).toString('ascii'), 'PNG', file + ' 파일은 PNG여야 합니다.');
    assert.strictEqual(buffer.readUInt32BE(16), 1024, file + ' 너비는 두 개의 동일한 몬스터 셀이어야 합니다.');
    assert.strictEqual(buffer.readUInt32BE(20), rows * 512, file + ' 높이는 필드마다 독립된 몬스터 셀이어야 합니다.');
});

console.log('general_field_parity.test.js: OK');
