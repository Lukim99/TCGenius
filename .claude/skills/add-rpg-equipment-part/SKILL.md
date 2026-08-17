---
name: add-rpg-equipment-part
description: Add a new RPGenius equipment slot/part type beyond the current 7 (weapon/hat/armor/pants/shoes/accessory/support), e.g. 망토/emblem. Cross-cutting architectural change - the type lists are partly constant-driven and partly hardcoded across rpgenius.js, partyquest.js, server.js, public/app.js, public/admin.js, transcend_equipment.js. Triggers - "장비 부위 추가", "새 장비 슬롯", "new equipment slot", "add equipment part".
---

# Add an RPGenius equipment part (slot type)

⚠️ **Cross-cutting.** Types today: `weapon, hat, armor, pants, shoes, accessory, support` (7). Two canonical constants in rpgenius.js (~line 50): `EQUIPMENT_SINGLE_SLOTS = ['weapon','hat','armor','pants','shoes','support']` (one object per slot; **support included, accessory NOT**) and `EQUIPMENT_TYPE_LABELS = {…all 7…}`. Many sites derive from these and auto-adapt; **many others still hardcode literal lists** — the 2026-07 hat/pants/shoes addition left real gaps (listed below) that a new type must not repeat. Decide first: **single-slot** (like weapon — `user.equipments.<type>` is one object; add to BOTH constants) or **multi-slot** (like accessory — id→object map; far more bespoke code — strongly consider extending accessory instead).

## Data model
- Equipment data: `getDataCache('Equipment')` = `{ weapon:[], hat:[], armor:[], pants:[], shoes:[], accessory:[], support:[], <new>:[] }` (DynamoDB Key:Equipment via admin or `edit-rpgenius-data`; disk `Equipment.json` is a stale 4-type seed). `getEquipmentData(type,id)` is generic. `PUT /api/data/Equipment` (server.js) validates a `requiredSlots` list — add `<new>` there or admin saves 400.
- Potential: `equipmentTypeSupportsPotential(type)` → `getPotentialData()[getPotentialEquipmentType(type)]`; `getPotentialEquipmentType` collapses `hat/pants/shoes → 'armor'` (Potential.json keys are only weapon/armor/accessory/support, DISK). Map the new type there (reuse a table) or add a `Potential.json["<new>"]` table + `POTENTIAL_REROLL_COST` key.
- Orbs: per-orb `parts` array in `DB/RPGenius/Orb.json` — the new type accepts orbs only if listed. Souls: `getSoulTargets`/`applySoulToEquipment` literal lists (`['weapon','hat','armor','pants','shoes']`) + admin `soulEditor` (weapon/armor only). Element chain: `getEquipmentElementChain` enumerates each slot explicitly (`rest = support > hat > armor > pants > shoes > accessory`) — insert the new slot at the intended priority ([[element-system]]).

## rpgenius.js sites
Auto (via constants): `calculateUserStats` gear loop (`EQUIPMENT_SINGLE_SLOTS.filter(t => t != 'support')` — base+upgrade+potential+soul+orb), `getEquippedEquipmentRefs`/`getEquippedEquipmentData` (refs `{type, equip, slotKey?}`), `equipItemByNumber`/`unequipEquipmentByNumber` single-slot branch, `getEquippedPassiveIds`/`findEquipWithPassiveId`, `cleanupExpiredSouls`, underLevel auto-unequip, `findEquipmentByName`, `formatEquipmentInventory`.
**Hardcoded — edit each** (grep the literal `'weapon', 'hat', 'armor', 'pants', 'shoes'`): default `user.equipments` object literals (`{ weapon:null, hat:null, … accessory:{}, support:null, pet:[] }` — 4 copies, grep `hat: null`), profile `formatEquippedEquipment('무기'`…`'신발'` calls, detail `formatEquippedEquipmentDetail` loop (`[['모자','hat'],…]`), `grantHellEquipment` / `getTranscendChoiceCandidates` / `초월상자` pools, `grantEquipmentBox` (still only weapon/armor/accessory), reward/recipe `*_id` maps (`weapon_id/armor_id/accessory_id/support_id` only — hat/pants/shoes can't be recipe outputs or quest rewards today), `require` types (`'무기'|'갑옷'|'장신구'`), `getEquipmentUpgradeCost` type multipliers, disassemble type rules, `getEquipmentElementChain`.

## partyquest.js
`getImmortalArmorSnapshot`/`getManaResonanceSnapshot`/`getThornsSnapshot` build `slots = [['weapon',…],['armor',…],…accessory,['support',…]]` — **only 4 types** (a passive on hat/pants/shoes is invisible in party). Add the new type there (and fix the 3 armor-likes if you're in there). Also the Korean→type maps (grep `'무기': 'weapon'`), quest reward `equipmentMap`.

## Web sites
- **server.js**: `buildEquipmentDex` (explicit `pack()` per type + set-grouping list), dex tab HTML `data-tab="<type>"` list (grep `data-tab="shoes"`), ~12 duplicated `{ weapon:'무기', hat:'모자', … }` label maps (grep `pants: '하의'` / `PRESET_TYPE_LABELS`), `buildInventoryEquipment` gear list, `/api/lookup/equipment`, auction/trade lookup packs, buy-order `equipType` validation, `'장비 상자'` outcome list, `requiredSlots` (above).
- **public/app.js**: `SLOT_ICONS`, `EQUIP_TYPE_ORDER`, `REG_SLOT_SVGS` (4 real icons; hat/pants/shoes alias armor), inventory `byType` + `gearSlotNode` calls, `PRESET_GEAR_LAYOUT`, preset detail list, `DEX_EQUIPMENT_TABS`, `dexTab` default, buy-order `equipType` default.
- **public/admin.js**: `EQUIPMENT_SLOT_DEFS` drives the editor tabs (auto). Hardcoded 4-type maps to extend: grant editor `{'무기':'weapon',…}`/`*_id`, `TYPE_TO_SLOT`/`TYPE_TO_KEY`, `REWARD_TYPES`/`MATERIAL_TYPES`/`CRAFTED_TYPES`, delete-reference scan `idKey` map (undefined for hat/pants/shoes → scan silently skipped), `soulEditor` slots (grep `accessory_id` to find them all).
- transcend_equipment.js: `definitions` split armor-likes by `armorSlot` — only relevant if the new type gets 초월 gear.

## Combat power
Generic — the new slot's stats reach `computeCombatPowerFromStats` once step 1 folds them into `stats`. No CP change unless it adds a brand-new stat (`add-rpg-stat`).

## Sweep & verify
1. **Sweep with all 7 anchors** — `grep -rnE "weapon|hat|armor|pants|shoes|accessory|support" rpgenius.js partyquest.js server.js public/app.js public/admin.js` and, at every place the existing types are listed together, add the new one. Grepping only `accessory` misses the gear-only lists; grepping only `armor` misses accessory/support-only lists.
2. `node -c rpgenius.js partyquest.js server.js public/app.js public/admin.js` + `node tests/admin_equipment_slots.test.js` (existing slot-list test — extend it).
3. Manually: equip an item of the new type → stat in profile + 전투력 changes + dex tab renders + admin can create/assign it + potential/orb/soul behave as designed + party snapshot sees its passive.

## Safety — all-or-nothing
A **partially** added type is worse than none: stats may not aggregate, equip/unequip may corrupt `user.equipments`, display may crash on an unknown slot, party may silently ignore it. Treat the lists above as a checklist and complete every item before shipping. If the new part is conceptually "another accessory slot," strongly prefer raising `user.maxAccessory`/extending the accessory mechanism — far less surface. Raise that option with the user.
