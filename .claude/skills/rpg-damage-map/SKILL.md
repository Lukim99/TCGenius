---
name: rpg-damage-map
description: Reference map of the RPGenius damage pipeline - where player→monster and monster→player damage is computed in solo (rpgenius.js) vs party (partyquest.js), the single chokepoints, extra.* hooks, element application, and concurrency. Use before adding/changing any combat effect to know where to hook in. Triggers - "데미지 흐름", "어디에 끼워야", "전투 계산 구조", "damage pipeline".
---

# RPGenius damage pipeline map

Load this before touching combat. Two engines: **solo** (`rpgenius.js`) and **party quest** (`partyquest.js`). They share data (Skills/Equipment/stats) but have SEPARATE damage code — changes usually need both. Verify with the `rpg-check` skill.

## SOLO (rpgenius.js)
**Player → monster** — single chokepoint: `calculateAttackHitResult(rawDamage, def, pnt, stats, slotEffects, extra, defenderStats)`.
- Per-hit order: `baseDamage = rawDamage × (1 + extra.damageBonusMul) × (1 + finalDamage% + extra.finalDamageBonus)` → crit → defense reduction → flat adds (000 / skillTrueDmg) → variance → **element multiplier LAST** (`extra.attackElement`, vs `defenderStats[resKey]`).
- Entry funnels (all set `extra.attackElement = getAttackElement(user, skill|null)`):
  - `applyFieldDamageAction(user, context, rawDamage, extra, actionType, skill)` ← the manual-attack chokepoint (basic/skill/worldboss). Also applies 수나타 owner buff via `extra.damageBonusMul`.
  - `buildHuntResult` (normal), `buildEliteHuntResult` (elite), `applyWorldBossDamageAction`/`dealDamageToWorldBoss` (worldboss).
  - Skill effects set in `executeMainCardSkillInField` (basic in `useBasicAttackInField`).
- **Monster → player**: `calculateMonsterAttackHitResult(monster, playerStats, slotEffects, extra)` (uses its own `{attackElement: monster.element}`; player resist applies). Worldboss-skill→player: `runWorldBossSkillTick` (~`getDamageAfterDefense`, element via `boss.element`/`skill.element`).
- **Summons** (auto-attack): `runFieldIktaeBotTick` / `runFieldSunataTick` (timers `fieldIktaeBotTimers`/`fieldSunataTimers`, 4s/5s). They call build*/dealDamageToWorldBoss with `extra.summonAttack` (zeroes retaliation) + `isBotAutoAttack`.

## PARTY (partyquest.js)
**Player → monster** — single chokepoint: `calculateOutgoingDamage(attacker, monster, room, rawDamage, extra)`.
- Used by EVERY player attack: basic (`computeBasicDamage`→`performBasicAttack`), main-card skills (`executeMainCardSkillEffect`→`dealSkillDamageToMonster`), quest skills (`executeSkillEffect` inline), mob-phase, iktae/sunata ticks.
- Per-hit: `rawDamage × contextMul × (1 + finalDamage%) × dealtDmgMul × getFinalDamageMul(attacker)` → crit → defense → fixed/000/skillTrueDmg → variance → **element LAST** (`extra.skillElement`, resolved with `attacker.baseSnapshot.elementChain`). `getFinalDamageMul` carries 복수의칼날 / 마력감응 / **수나타 buff**.
- `applyPlayerDamageToBoss(room, mon, attacker, dmg)` gates 흑화 호두 익스트림 (invincibility / shield role-lock / curse). Reflect/fixed reflects use `calculateNormalDamageToMonster` (NO element — fixed).
- **Monster → player**: `computeMonsterDamage` (main basic/counter — element via `mon.element` + player resist) and `calculateNormalDamageToMember` (치명 반사). All land via `applyDamageToMember`.
- **Summons**: room-tick member loop in `stepRoom` (iktaeBot + sunata blocks), 5s/4s `nextAttackAt`.
- Stats are a **snapshot**: `member.baseSnapshot = {stats, slotEffects, mainCardSkills, immortalArmor, manaResonance, thorns, elementChain}` (built from `calculateUserStats(user)` at room start). Live tweaks go on `member.runtime.*`.

## extra.* hooks (shared names unless noted)
`damageBonusMul`, `finalDamageBonus`(solo)/`getFinalDamageMul`(party), `forceCritical`, `disableCritical`, `critChanceMul`, `critMulBonus`, `pnt`, `hitCount`, `extraOnCrit`, `skillTrueDmg`, `lifeStealFromPreMitigation`, `summonAttack`, `attackElement`(solo)/`skillElement`(party).
Solo also: `receivedDamageMul`, `basicAttackSkill`, `user.field.shield`, `getFieldBuffs(user)`. Party also: `caster.runtime.*` (shield/atkBuff/takenDmgMul/sunata/iktaeBot…), `upsertMemberBuff`, `partyMpFlat`.

## Element (see [[element-system]])
Multiplier `max(0, 1 + (공격자 강화 − 대상 저항) × 0.001)`, applied LAST in both chokepoints. Attacker element: weapon > skill(`element`) > 보조 > 갑옷 > 장신구. Monster resist = numeric `stat.fireRes` etc.; monster attack type = top-level `element` (string).

## Concurrency
Solo timer ticks (bot/sunata/worldboss) join the user's command queue via `enqueueFieldTick(userName, fn)` → `enqueueUserCommand(fieldQueueKeys[name]||name, fn)` to avoid load-modify-save races with the user's manual attack. Party combat is synchronous in-memory room state (no awaits between read/write) → atomic vs the 200ms `stepRoom` tick.
