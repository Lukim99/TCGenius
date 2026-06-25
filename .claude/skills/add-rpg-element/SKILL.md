---
name: add-rpg-element
description: Add a new RPGenius damage element beyond 화/수/명/암 (e.g. 풍/뇌). Registers the element char, its 강화/저항 stat pair, labels, potential rolls, and verifies it flows through solo + party damage. Triggers - "속성 추가", "새 속성", "new element", "add rpg element".
---

# Add an RPGenius element

The element system (see [[element-system]]) is keyed by single Korean chars. Adding an element = **register the char in 2 maps + add its 강화/저항 stat pair**. Most plumbing (party, worldboss resist, profile display) reads those maps and is automatic.

## 1. Register the element char (rpgenius.js)
Add to BOTH maps (grep `ELEMENT_ATK_KEYS`):
```js
const ELEMENT_ATK_KEYS = { ..., '풍': 'windAtk' };
const ELEMENT_RES_KEYS = { ..., '풍': 'windRes' };
```
This alone makes: `getAttackElement`/`getEquipmentElementChain` recognize it, `getElementDamageMultiplier` work, `getWorldBossDefenderStats` pass `windRes` through (it iterates `ELEMENT_RES_KEYS`), and the profile 〈속성〉 block list it. partyquest.js uses `rpgenius.ELEMENT_ATK_KEYS` → automatic.

## 2. Add the stat pair `windAtk` / `windRes`
These are flat stats — follow the `add-rpg-stat` skill: add to `EQUIP_STAT_LABELS` + `SUPPORT_STAT_LABELS` + upgrade-preview `statNames` (rpgenius.js) and `FLAT_STAT_DEFS` (admin.js). Labels like `'[풍]속성 강화'` / `'[풍]속성 저항'`. No `formatStatValue` change (flat ints).

## 3. Potential rolls (DB/RPGenius/Potential.json)
Add the new element's 강화/저항 to the same groups the existing 4 use (idempotent Node script; mirror the prior element migration):
- weapon/support → 강화 into the **공격 라인** (group containing `stat.atk`): bronze 2 / silver 4 / gold 7 / platinum 10
- armor → 저항 into the **방어 라인** (groups[0]): 3 / 6 / 9 / 12
- accessory → 저항 into groups[0] (2/4/7/10) + 강화 into the atk group (1/3/6/9)
Roll shape: `{ "stat": { "windAtk": 2 } }`. Preserve CRLF+4-space (write with `JSON.stringify(data,null,4).replace(/\n/g,'\r\n')+'\r\n'`).
**Idempotency (mandatory)**: before pushing, skip if the group already has a roll with that key (`group.roll.some(r => r.stat && r.stat[key] != null)`) — re-running must not double-add. After writing, `JSON.parse` the file to confirm it's still valid.

## 4. (Optional) assign the element to content
Skills: `"element": "풍"` in Skills.json. Monsters: top-level `"element":"풍"` + numeric `stat.windRes` (see [[element-system]] / [[job-classes]]).

## 5. Verify
- `node -c rpgenius.js` + `JSON.parse` Potential.json.
- `rpg-check` §3 with `KEYS="windAtk windRes"` (must be present in rpgenius≥3 / admin≥1).
- The element appears in the dex 잠재능력 tab; an item with `windAtk` makes `getAttackElement` return `'풍'` and damage scales by `(windAtk − target windRes) × 0.1%`.
