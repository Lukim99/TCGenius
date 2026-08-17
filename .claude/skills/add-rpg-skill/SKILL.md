---
name: add-rpg-skill
description: Add a new RPGenius character-card / job-class skill end-to-end. Use when adding or editing a main-card skill so the data and BOTH combat handlers (solo + party) stay in sync - pure damage, effect/pnt skills, charge/state skills, DoT/mark, summons, multi-hit-as-basic, party buffs. Triggers - "스킬 추가", "궁극기 추가", "캐릭터 스킬 만들어", "add rpg skill".
---

# Add an RPGenius main-card skill

Main-card skills live in `DB/RPGenius/Skills.json` (DISK, 28 entries today) and are wired by **name** into TWO independent if-chain handlers. The #1 footgun is wiring only one side — the skill then works in solo OR party but not both. Always do both. There is no third place (H필드 = web front over solo; colosseum unrelated).

## Files & where things live
- **Data**: `DB/RPGenius/Skills.json` — array; index = position. **CRLF + 4-space** (preserve). Party synthesizes its defs from the same entry (`toPartyMainCardSkillDef` → `{mp, cd, target, raw: skill, star}`).
- **Solo handler**: `rpgenius.js` → `executeMainCardSkillInField(user, skillName)` — `if (skillData.skill.name == 'X') { ... }` blocks (`skillData = findUsableSkill(user, name)`, `star`, `stats`, `slotEffects`, `mpCost` already computed; `extra` is pre-seeded by `prepareTranscendSkillEffects` (초월 장비 스킬 훅) — add onto it, don't replace).
- **Party handler**: `partyquest.js` → `executeMainCardSkillEffect(room, caster, skillName, def, targetName, equipmentSkill)` — `if (skillName === 'X') { ... }` blocks (`skill = def.raw`, `stats = caster.baseSnapshot.stats`, `rawDamage` precomputed, `extra.skillElement` set from `skill.element`).
- **Class (전직) skills**: reference the index in `DB/RPGenius/CharacterCards.json` → `card.class.skills` (base skills → `card.skills`). `getMainCardSkills` (rpgenius) / `getMainCardSkillEntries` (partyquest) auto-include `class.skills` for `type==='전직'`. **궁극기 has no data flag** — "ultimate" = the LAST entry of the user's skill list (`isUltimateSkillForUser`; party mirrors) → put the class ultimate last in `class.skills`.
- NOT this skill: worldboss chosen skills (빙결 등, `ExtraSkills.json` / `useWorldBossChosenSkill`), party quest skills (`PartyQuest.json` `skills`), 자폭 (`executeSelfDestructInField`).

## Skill data format (unchanged — 6 fields only)
```json
{
  "name": "스킬명",
  "desc": "공격력의 ${1}로 공격합니다. ...",   // ${n} → format[n-1], rendered ×100 as % unless type:"flat"
  "element": "화|수|명|암",                    // optional → element multiplier + auto "[화]속성 " prefix
  "format": [ { "base": 4.44, "per_star": 0.44 }, { "base": 100, "per_star": 0, "type": "flat" } ],
  "mp_cost": 444,
  "cooltime": 144000                            // ms (0 allowed for charge-gated skills like 시벌론)
}
```
- `getSkillValue(skill, idx, star)` = `format[idx].base + per_star × star` (both files). `multiplier = getSkillValue(skill, 0, star)` is the attack ratio.
- **element**: don't write `[화]속성` in `desc` — `skillElementPrefix` prepends it. Note weapon element (or weapon orb element) overrides the skill's element in `getAttackElement`.

## Procedure
1. **Append** to `Skills.json` (note the index). Reference it from a card (`skills` / `class.skills`) — unreferenced entries are dead.
2. **Solo handler** — add `if (skillData.skill.name == '스킬명') {…}` in `executeMainCardSkillInField`. Pure damage: no block. Effects: set `extra.*` / `user.field.*` and fall through to the common tail (`rawDamage = atk × multiplier × (1 + afterSkill + slot.skillDamageBonus…)` → `commitFieldSkillCooldown` → `applyFieldDamageAction(user, context, rawDamage, extra, 'skill', skill)`).
   **Non-damage / summon / state skills must `return` early** after doing their own bookkeeping: `commitFieldSkillCooldown(user, skillData.skill, stats, equipmentSkill, now)` + `isWorldBoss ? setWorldBossNextActionAt(user) : setNextFieldActionAt(user)` (or `setFieldNextActionAt(user, now)` to allow an instant follow-up like 시벌론) + `return lines.join('\n')`. Mirror `익테봇 소환`/`수나타 소환`/`유서새김`/`건력`/`시벌론`.
3. **Party handler** — add the matching `if (skillName === '스킬명') {…}` in `executeMainCardSkillEffect`. Damage skills fall through to `dealSkillDamageToMonster`; non-damage skills set `caster.runtime.*` (+ `upsertMemberBuff(caster, {id,label,value,remain})` for the HUD chip) and `return`. Targeted buffs use `targetName` (mirror `범인은 이 안에`); party-wide loops `room.members`.
4. **State that must persist across attacks** — solo: `user.field.<x>` (`{expired_at,…}`) read via a small getter (mirror `getGunryeokState`/`isSivalonActive`) and consumed in `applyFieldDamageAction`/`useBasicAttackInField`/`calculateUserStats` as needed; party: `caster.runtime.<x>` consumed in `calculateOutgoingDamage`/`getFinalDamageMul`/`stepRoom`. Charge gates go BEFORE the MP deduction (mirror 시벌론 `sivalonCharge`).
5. **Verify**: `node -c rpgenius.js && node -c partyquest.js`, JSON-validate `Skills.json` + `CharacterCards.json`, `rpg-check` §5 (scoped handler-parity diff), and ideally a test in the `tests/skill_remake.test.js` style (`await rpg.initRpgeniusData()`, `new rpg.RPGUser(name, id)`, `rpg.useSkillInField(user, '스킬명')`, `rpg.useBasicAttackInField(user, null)`; hits live DynamoDB via `.env.local`).

## Locate the insertion points (grep, not line numbers)
```bash
grep -n "skillData.skill.name == 'KICK BACK'" rpgenius.js     # solo effect handler to mirror
grep -n "skillName === 'KICK BACK'" partyquest.js             # party same
grep -n "name == '익테봇 소환'\|skillName === '익테봇 소환'" rpgenius.js partyquest.js  # summon / early-return pattern
grep -n "name == '유서새김'\|skillName === '유서새김'" rpgenius.js partyquest.js        # DoT/mark + timer pattern (startFieldMark / runtime.dots)
grep -n "name == '포커 못 하시네'\|skillName === '포커 못 하시네'" rpgenius.js partyquest.js  # multi-hit counted as basic (extra.hitCount=9, basicAttackSkill / isBasic)
```

## Worked examples (minimal)
**A. Pure damage + element — data only, NO handler**:
```json
{ "name": "화염참", "desc": "공격력의 ${1}로 공격합니다.", "element": "화",
  "format": [ { "base": 3.2, "per_star": 0.2 } ], "mp_cost": 60, "cooltime": 9000 }
```
**B. Effect skill (+방관) — data + BOTH handlers** (mirror `댄져`):
- Solo: `if (skillData.skill.name == '관통격') extra.pntBonus = Number(extra.pntBonus || 0) + getSkillValue(skillData.skill, 1, star);`
- Party: `if (skillName === '관통격') extra.pntBonus = Number(extra.pntBonus || 0) + getSkillValue(skill, 1, star);`
(`extra.pnt` overrides penetration outright; `extra.pntBonus` adds — prefer adding.) Both read `${2}` = `format[1]`.

## extra.* hooks (reuse before inventing — full map in `rpg-damage-map`)
- **Both**: `damageBonusMul` (+x), `finalDamageBonus` (+x to final%), `extraDamageBonus`, `forceCritical`, `disableCritical`, `critChanceBonus`, `critChanceMul`, `critMulBonus`, `pnt`/`pntBonus`, `defReductionBonus`, `hitCount`, `skillTrueDmg`, `oneTimeFinalDamage`, `lifeStealFromPreMitigation`, `summonAttack`, `disableEquipmentBonusDamage`, `perAttackUnitExtras`.
- **Solo only**: `receivedDamageMul` (this hit's retaliation ×), `shieldNotice` + `user.field.shield = {amount, expired_at}` (blocked by `stats.disableShield`), `basicAttackSkill` (count as basic), `goldBonus`, `oneTimeTrueDmg`; field buffs via `getFieldBuffs(user)` (`nextBasicDamageBonus`/`nextSkillDamageBonus`/`nextDamageReduction`/`nextFinalDamageBonus`/`pntBuff`/`receivedDamageReduction`/`receivedDamageMultiplier`); summon durations scale with `stats.summonDuration`.
- **Party only**: `extraOnCrit`, `partyMpFlat`, `trueDamageOnCrit`; `caster.runtime.*` — `shield`/`shieldHits`/`shieldExpireAt`, `takenDmgMul`, `atkBuff`, `nextBasicDamageBonus`/`nextSkillDamageBonus`/`nextDamageReduction`/`nextFinalDamageBonus`, `critBoostNext`, `trueDamageOnCritNext`, `dodgeNext`, `pntBonusValue`/`pntBonusUntil`, `dots`, `stackCounters`; monster debuffs via `addMonsterDebuff(mon, {id,type,value,remain})`.
- **Summons** (attack-only): solo `user.field.sunata`/`iktaeBot` + `startFieldSunata`/`startFieldIktaeBot` timers (`enqueueFieldTick`); party `caster.runtime.sunata`/`iktaeBot` + `stepRoom` block (`nextAttackAt`). Owner buff: solo in `applyTranscendPreAttack`, party in `getFinalDamageMul`. Auto-attacks pass `summonAttack` (no retaliation) + `disableEquipmentBonusDamage`.

## Gotchas
- **By-design one-sided skills exist**: `백억이요` (`extra.goldBonus`) is solo-only — party has no gold-per-kill. Don't invent a party handler just to satisfy the parity diff; wire both sides only when the effect is meaningful there.
- Skill names also appear OUTSIDE the two handlers (transcend equipment interplay: `preparePartyTranscendSkill`, `applyTranscendPreAttack`, `skill.name ==` hooks) — those are not the handler; `rpg-check` §5 scopes the diff to the two handler bodies.
- Match the existing per-skill block style; don't refactor adjacent handlers. Never assign `undefined` into `user.field.*`/`pendingAction` (DynamoDB save throws).
- Balance numbers (cooltime/mp/ratios) come from the user — ask if unspecified.
