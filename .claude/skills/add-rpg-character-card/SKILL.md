---
name: add-rpg-character-card
description: Add a new RPGenius character card (name + slot effect + skills + 전직/job class + images) end-to-end, including the base-slot-effect code wiring by card name, optional new slot-effect keys, full skill implementation, card image files, and verify. Triggers - "캐릭터 카드 추가", "카드 만들어", "신규 캐릭터", "add character card".
---

# Add an RPGenius character card

Inputs: **name**, **slot effect** (base label + base/per_level), **skills**, a **전직 (class)** block (every existing card has one — 14 cards, ids 0-13, newest 안성재(12)/흠시원(13)), and **image files**. A card is identified by its **array index = id** (`user.main_card.id`, `user.card_slot[].id`).

Traps: (1) a slot effect's `effect` key must exist in the `calculateCardSlotEffects` initializer — the JSON alone does nothing for unknown keys; (2) a **new slot-effect KEY** needs an initializer + label + combat consumers (or a stat mapping) in both engines; (3) images are looked up by **name-based directory/filenames** — no image = no card art anywhere; (4) skills need the dual handler from `add-rpg-skill`.

## 1. Card data — `DB/RPGenius/CharacterCards.json` (DISK, not DynamoDB; CRLF + 4-space; append at end → id = new index)
Read at runtime via `readJson(CHARACTER_CARDS_PATH)` (rpgenius.js/server.js) and mtime-cached in partyquest.js — no server restart needed for data, but keep the file valid.
```json
{
  "name": "카드명",
  "slot_effect": { "effect": "<effectKey>", "name": "<표시 라벨>", "values": [<★5>, <★6>, ..., <★12>] },
  "skills": [ <Skills.json index> ],
  "class": {
    "name": "전직",
    "slot_effects": [ { "effect": "<effectKey>", "name": "<라벨>", "values": [ ...8 entries ] }, { ... } ],
    "skills": [ <Skills.json index> ]
  }
}
```
- 2026-08 model: both base `slot_effect` and class `slot_effects[]` carry an `effect` key and a per-star `values` array (index 0 = ★5/star 4 … index 7 = ★12/star 11; `getSlotEffectValueAtStar`). Legacy `base`/`per_level` still works as fallback. Flat (non-%) effects (e.g. element enhance) add `"type": "flat"`.
- Slot effects come from **`user.card_slot`** (slotted cards, not the main card), activate at **★5+** (`star >= 4`). Same character may be slotted twice if card **type differs** (일반 vs 전직) — dup check is id+type (equip funcs in rpgenius.js, pvp `validateDefensePayload`, client filters in public/app.js).
- Cards without a `class` block are automatically excluded from 전직 conversion/packs (`hasJobClass`).

## 2. Slot effect wiring — generic by `effect` key (base AND class)
`calculateCardSlotEffects` (rpgenius.js) applies `effects[se.effect] += value` for any key in its initializer (unknown keys silently ignored). Penalty keys map to their bonus counterpart with a minus: `skillDamageReduction` → `skillDamageBonus -=`, `basicDamageReduction` → `basicDamageBonus -=` (store positive values in JSON).
Effect keys in the initializer (2026-08): `expBonus` · `hpDamageReduction` · `killRecoveryChance` · `crit` · `mpCostReduction` · `damageBonus` · `critMul` · `goldBonus` · `itemDropChance` · `defReduction` · `basicDamageBonus` · `skillDamageBonus` · `nonElementFinalDamage` · `tenthHitFinalAtk` · `skillCoolReduction` · `shieldEfficiency` · `attackBuffEfficiency` · `finalDamage` · `takenDamageIncrease` · `maxHpBonus` · `lightAtk`/`waterAtk`/`darkAtk`(flat) · `ultimateDamage` · `shieldFinalDamage`. Set the JSON `name` to the matching label in `formatCardSlotEffectLines`.
Stat-mapped keys (absorbed into stats inside `calculateUserStats`, so they flow to solo/party/PVP/전투력 automatically): `skillCoolReduction`→cooldown, `shieldEfficiency`, `attackBuffEfficiency`, `finalDamage`, `takenDamageIncrease`→takenDamage, `ultimateDamage`, `lightAtk`/`waterAtk`/`darkAtk`, `maxHpBonus`→hp×. `shieldFinalDamage` is consumed directly in party `calculateOutgoingDamage` (mon.shield>0) and pvp `dealDamage`.

### 2b. Only if the card needs a NEW effect key
Reusing an existing key needs nothing else. A brand-new key needs: the `effects` initializer + a `formatCardSlotEffectLines` label + either a stat mapping in `calculateUserStats` (preferred when an equivalent stat exists) or **consumers in both engines** — solo (`applyFieldDamageAction`/`calculateAttackHitResult` area — mirror `tenthHitFinalAtk`/`nonElementFinalDamage`, grep `fieldSlot.tenthHitFinalAtk`) and party (`calculateOutgoingDamage` — grep `slotEffects.tenthHitFinalAtk`), plus web profile mapping in server.js `SLOT_EFFECT_TO_STAT` if it should show as a stat. See `rpg-damage-map`.

## 3. 전직 (class)
Class skills are auto-included for `type==='전직'` main cards (`getMainCardSkills` rpgenius / `getMainCardSkillEntries` partyquest). Prestige (`user.prestige`/`user.jobPrestige`) is a USER flag (exp/gold bonus + art variants) — nothing per card.

## 4. Skills — implement fully (data + BOTH handlers)
Every index in `skills` / `class.skills` must point to a real `DB/RPGenius/Skills.json` entry (28 entries today, DISK). Special effects need handlers in **both** `executeMainCardSkillInField` (rpgenius.js) and `executeMainCardSkillEffect` (partyquest.js) — **use `add-rpg-skill`** per skill (covers charge/state skills, summons, element, early-return). Pure-damage skills need data only. Don't ship a card whose skill works in solo but not party.

## 5. Images (name-based lookup, `fs.existsSync`-gated)
Directory **`DB/RPGenius/cardImage/<카드명>/`** with `NN` = 2-digit `star+1` (01…12):
- base `NN <카드명>.png`, 전직 `NN 전직 <카드명>.png`, prestige `NN 프레스티지 <카드명>.png` / `NN 프레스티지 전직 <카드명>.png`, fashion `NN <패션명> <카드명>.png` (+ 전직/프레스티지 variants), dex covers `캐릭터표지.png` / `전직 캐릭터표지.png`.
- Builders: server.js `getCardImageUrl` (web) and rpgenius.js `sendUserMainCardImage` (Kakao) — both name/dir based, no code change for a new card. H필드 sprites (optional, server.js `getHFieldCharacterSprite`): `DB/RPGenius/ui/필드/캐릭터/<카드명>__<일반|전직>__<스킨>.png` → `<카드명>__전직.png` → `<카드명>.png` → generic fallback.

## 6. Optional name/id hooks
- 전용 초월 무기 → `transcend_equipment.js` `MAIN_CARD_IDS` (name→id) + equipment `requireMainCard: [id]`.
- 패션 → Fashion data (DynamoDB `Fashion`, disk fallback) entry with `primary_card: [id]`.
- `/RPGenius 캐릭터카드 선택 [이름]` resolves by name automatically (`findCharacterCardByName`).

## 7. Automatic — DO NOT touch
- **Base stats**: `getBaseStat` indexes `BaseStat.json` by `card.star` (12 rows), NOT by card id.
- **Dex**: `buildCharacterDex` (server.js) maps all cards.
- **Obtainability**: card packs pick uniformly from `candidateIds` (all cards; 전직 packs filter `hasJobClass`), combine/convert pools likewise → new card auto-rollable; admin can grant by id.

## 8. Verify
- `node -c rpgenius.js partyquest.js server.js` + JSON-validate `CharacterCards.json` + `Skills.json` (CRLF/4-space preserved).
- Every slot effect's **`effect` key exists in the `calculateCardSlotEffects` initializer** (else dead); if a new key was added, its label + stat mapping or both consumers exist.
- Each skill reachable in **both** handlers (`rpg-check` §5). Image files exist for the stars you ship (at least `01…` for the pack range) — dex shows the card, card detail shows slot_effect + skills, ★5+ slotted card shows the effect via `formatCardSlotEffectLines`.
- Optional: extend `tests/skill_remake.test.js` pattern (`new rpg.RPGUser`, `rpg.useSkillInField`) for the new skills.

Related: `add-rpg-skill`, [[job-classes]] (전직 structure), [[element-system]] (skill element), `rpg-check`.
