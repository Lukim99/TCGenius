---
name: add-rpg-element
description: Add a new RPGenius damage element beyond 화/수/명/암 (e.g. 풍/뇌). Registers the element char in the two key maps, its 강화/저항 stat pair, labels, potential rolls, the hardcoded element arrays (CP, per-unit, party, web palette), and verifies it flows through solo + party damage. Triggers - "속성 추가", "새 속성", "new element", "add rpg element".
---

# Add an RPGenius element

The element system (see [[element-system]]) is keyed by single Korean chars. Adding an element = **register the char in 2 maps + add its 강화/저항 stat pair + sweep the hardcoded element arrays**. `allElementAtk`/`allElementRes` (모든 속성) already fold into every element automatically.

## 1. Register the element char (rpgenius.js, grep `ELEMENT_ATK_KEYS = `)
```js
const ELEMENT_ATK_KEYS = { ..., '풍': 'windAtk' };
const ELEMENT_RES_KEYS = { ..., '풍': 'windRes' };
```
This alone makes: `getEquipItemElement`/`getEquipmentElementChain`/`getAttackElement` recognize it, `getElementDamageMultiplier` work (+all-element fold), `getWorldBossDefenderStats` pass `windRes` through (iterates `ELEMENT_RES_KEYS`; note `allElementRes` is NOT passed for bosses), `skillElementPrefix` accept it, the Kakao 〈속성〉 block list it, monster attack `element:'풍'` apply. partyquest.js uses `rpgenius.ELEMENT_ATK_KEYS` → `resolvePartyAttackElement` automatic. Orb `element` field (weapon orbs set the attack element) is validated against the same map.

## 2. Add the stat pair `windAtk` / `windRes`
Flat stats — follow `add-rpg-stat`: `EQUIP_STAT_LABELS` + `SUPPORT_STAT_LABELS` + upgrade-preview `statNames` (rpgenius.js), `FLAT_STAT_DEFS` (admin.js, kind `'int'`), server.js `PROFILE_STAT_GROUPS` 속성 group + `PROFILE_STAT_LABELS` + `PROFILE_STAT_NUMERIC`, `buildStatDiffs` labels. Labels `'[풍]속성 강화'` / `'[풍]속성 저항'`. No `formatStatValue` change (flat ints).

## 3. Sweep the hardcoded element arrays (they do NOT derive from the maps)
`grep -n "fireAtk" rpgenius.js partyquest.js transcend_equipment.js server.js public/*.js tests/*.js` and add the new key wherever the 4 are listed together:
- rpgenius.js: `computeCombatPowerFromStats` offense/defense element arrays (grep `ELEMENT_COVERAGE`), per-hit `hitStats` unit-element adds (`['allElementAtk', 'fireAtk', 'waterAtk', 'lightAtk', 'darkAtk']`), rainbow total.
- partyquest.js: rainbow total + per-unit array (same literal); transcend_equipment.js `resolveConditionalCombatPowerEffect` element sum.
- public/app.js: orb element regex `/\[([화수암명])\]속성/` + `elementPalette` hue map (add the char + a hue pair or it falls back to a name hash).
- tests/combat_power.test.js `supportedEquipmentStatKeys` (add both keys or the test fails once gear uses them).

## 4. Potential rolls (DB/RPGenius/Potential.json — DISK, no cache; keys weapon/armor/accessory/support, pools bronze/silver/gold/platinum; hat/pants/shoes reuse armor)
Add the new element's roll next to the existing four in the same groups (a `roll` entry is `{ "stat": { "windAtk": 2 } }`):
- weapon/support → 강화 in **group[1]** (atk/pnt/element line): 2 / 4 / 7 / 10
- armor → 저항 in **group[0]** (hp/mp/def/res line): 3 / 6 / 9 / 12
- accessory → 저항 in group[0]: 2 / 4 / 7 / 10 **and** 강화 in group[1]: 1 / 3 / 6 / 9
No generator script exists — write a small idempotent Node script (skip if `group.roll.some(r => r.stat && r.stat[key] != null)`), preserve CRLF+4-space (`JSON.stringify(data,null,4).replace(/\n/g,'\r\n')+'\r\n'`), then `JSON.parse` the file to confirm. Group rolls are uniform, so each added roll dilutes the others — say so.

## 5. (Optional) assign the element to content
Skills: `"element": "풍"` in Skills.json. Monsters: top-level `"element":"풍"` + numeric `stat.windRes` (party) / `windRes` (Dungeon.json/WorldBoss.json). Orbs: `"element": "풍"` (weapon parts). Equipment: `stat.windAtk` via admin once step 2 is done. See [[element-system]] / [[job-classes]].

## 6. Verify
- `node -c rpgenius.js && node -c partyquest.js && node -c server.js && node -c public/app.js && node -c public/admin.js`; `JSON.parse` Potential.json; `node tests/combat_power.test.js`.
- `rpg-check` §3 with `KEYS="windAtk windRes"` (rpgenius ≥3 / admin ≥1 / server ≥2).
- The element appears in the dex 잠재능력 tab and web profile 속성 group; an item with `windAtk` makes `getAttackElement` return `'풍'`; damage scales by `(windAtk + allElementAtk − target windRes − allElementRes) × 0.1%` in solo AND party.
