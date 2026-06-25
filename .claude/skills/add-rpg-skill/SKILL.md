---
name: add-rpg-skill
description: Add a new RPGenius character-card / job-class skill end-to-end. Use when adding or editing a main-card skill so the data and BOTH combat handlers (solo + party) stay in sync. Triggers - "스킬 추가", "궁극기 추가", "캐릭터 스킬 만들어", "add rpg skill".
---

# Add an RPGenius main-card skill

RPGenius main-card skills live in `DB/RPGenius/Skills.json` and are wired by **name** into TWO combat handlers. The #1 footgun is wiring only one side — then the skill works in solo OR party but not both. Always do both.

## Files & where things live
- **Data**: `DB/RPGenius/Skills.json` — array of skill objects. Index = position in array. **CRLF line endings + 4-space indent** (preserve).
- **Solo handler**: `rpgenius.js` → `executeMainCardSkillInField` — name-based `if (skillData.skill.name == 'X') { ... }` blocks.
- **Party handler**: `partyquest.js` → `executeMainCardSkillEffect` — name-based `if (skillName === 'X') { ... }` blocks (`const skill = def.raw`).
- **Class (전직) skills**: also reference the new index in `DB/RPGenius/CharacterCards.json` → `card.class.skills`. Base-card skills go in `card.skills`. `getMainCardSkills` (rpgenius) / `getMainCardSkillEntries` (partyquest) auto-include `class.skills` for `type==='전직'`.
- NOT this skill: worldboss-chosen skills (빙결 등) live in `ExtraSkills.json` / `useWorldBossChosenSkill` — separate system.

## Skill data format
```json
{
  "name": "스킬명",
  "desc": "공격력의 ${1}로 공격합니다. ...",   // ${n} → format[n-1], rendered ×100 for ratios
  "element": "화|수|명|암",                    // optional → element-system damage + auto "[화]속성 " prefix
  "format": [ { "base": 4.44, "per_star": 0.44 }, { "base": 100, "per_star": 0, "type": "flat" } ],
  "mp_cost": 444,
  "cooltime": 144000                            // ms
}
```
- `getSkillValue(skill, idx, star)` = `format[idx].base + format[idx].per_star * star`. `multiplier = getSkillValue(skill, 0, star)` is the attack ratio.
- **element**: do NOT write `[화]속성` in `desc` — `skillElementPrefix` prepends it automatically (see [[element-system]]). Element damage applies via the element multiplier; the skill just needs the `element` field.
- `type:"flat"` on a format entry = displayed as a raw number, not a percent (e.g. 방관 +100).

## Procedure
1. **Append** the skill object to `Skills.json` (note its new index).
2. **Reference the index from a card** (else the skill is unreachable/dead — nothing in `Skills.json` is used unless a card points at it): base skill → the card's `skills`; 전직/class skill → `card.class.skills` in `CharacterCards.json`. Use a small Node script to preserve CRLF/4-space (see existing migration pattern).
3. **Solo handler** — add an `if (skillData.skill.name == '스킬명')` block in `executeMainCardSkillInField`, setting `extra.*` / field buffs. For pure damage skills no block is needed (multiplier handles it). **Summons / non-damage skills must `return` early** (mirror `익테봇 소환` / `수나타 소환`: set cooldown, `setFieldNextActionAt`/`setWorldBossNextActionAt`, return lines).
4. **Party handler** — add the matching `if (skillName === '스킬명')` block in `executeMainCardSkillEffect`. `skill = def.raw`; `extra.skillElement` is already set from `skill.element`. Summons/non-damage `return` early (mirror `익테봇 소환` / `수나타 소환`).
5. **Verify** (always): `node -c rpgenius.js && node -c partyquest.js` and JSON-validate `Skills.json` + `CharacterCards.json`. Confirm the skill is reachable in BOTH `executeMainCardSkillInField` and `executeMainCardSkillEffect`.

## Locate the insertion points (no line numbers — grep)
```bash
grep -n "skillData.skill.name == 'KICK BACK'" rpgenius.js     # solo: add your block just after a similar handler
grep -n "skillName === 'KICK BACK'" partyquest.js             # party: same
grep -n "name == '익테봇 소환'\|skillName === '익테봇 소환'" rpgenius.js partyquest.js  # summon/early-return pattern to mirror
```

## Worked examples (minimal)
**A. Pure damage + element — data only, NO handler needed** (multiplier + element system do the work):
```json
{ "name": "화염참", "desc": "공격력의 ${1}로 공격합니다.", "element": "화",
  "format": [ { "base": 3.2, "per_star": 0.2 } ], "mp_cost": 60, "cooltime": 9000 }
```
**B. Effect skill (+방관) — data + BOTH handlers** (mirror `댄져`):
- Solo, in `executeMainCardSkillInField`:
  `if (skillData.skill.name == '관통격') extra.pnt = Number(stats.pnt || 0) + getSkillValue(skillData.skill, 1, star);`
- Party, in `executeMainCardSkillEffect`:
  `if (skillName === '관통격') extra.pnt = Number(stats.pnt || 0) + getSkillValue(skill, 1, star);`
- Both read `${2}` from `format[1]`. Verify the skill is reachable in both files before declaring done.

## extra.* hooks (reuse before inventing new ones)
Damage shaping (both): `damageBonusMul` (+x to baseDamage), `forceCritical`, `disableCritical`, `critChanceMul`, `critMulBonus`, `pnt` (override penetration), `skillTrueDmg`, `hitCount`, `extraOnCrit`, `lifeStealFromPreMitigation`.
- **Solo only**: `extra.receivedDamageMul` (this hit's incoming retaliation ×), `extra.shieldNotice` + `user.field.shield = {amount, expired_at}`, `basicAttackSkill` (count as basic for rawDamage), field buffs via `getFieldBuffs(user)` (`nextBasicDamageBonus`/`nextSkillDamageBonus`/`nextDamageReduction`/`receivedDamageReduction`/`receivedDamageMultiplier`).
- **Party only**: `caster.runtime.*` — `shield`/`shieldHits`/`shieldExpireAt`, `takenDmgMul` (sustained incoming ×), `atkBuff`, `nextBasicDamageBonus`/`nextSkillDamageBonus`/`nextDamageReduction`, `critBoostNext`, `trueDamageOnCritNext`, `dodgeNext`; UI chip via `upsertMemberBuff(caster, {id,label,value,remain})`; party-wide shield = loop `room.members`. `extra.partyMpFlat`, `extra.lifeStealFromPreMitigation`.
- **Summons** (attack-only, no HP): mirror `수나타 소환` — solo `user.field.sunata` + `fieldSunataTimers` tick; party `caster.runtime.sunata` + room-tick block in `stepRoom` member loop. Owner damage buff applied once (solo `applyFieldDamageAction` → `extra.damageBonusMul`; party `getFinalDamageMul`). Summon auto-attacks must not provoke retaliation (`extra.summonAttack` zeroes solo fieldDamage).

## Gotchas
- **Solo-only effects are legitimately one-sided.** Most effect skills need BOTH handlers, but solo-hunt-only mechanics (goldBonus/expBonus/kill-count) have no party equivalent — e.g. `백억이요` sets `extra.goldBonus` in solo only, on purpose. Don't invent a party handler just to satisfy `rpg-check` §5's diff; only wire both sides when the effect is meaningful in party combat.
- Item data is NOT from `Item.json` at runtime; irrelevant here but don't reach for it.
- Match the existing per-skill block style; don't refactor adjacent handlers.
- Balance numbers (cooltime/mp/ratios) come from the user — don't invent silently; ask if unspecified.
