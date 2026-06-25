---
name: add-rpg-character-card
description: Add a new RPGenius character card (name + slot effect + skills, optionally a 전직/job class) end-to-end, including the base-slot-effect code wiring and full skill implementation, then verify. Triggers - "캐릭터 카드 추가", "카드 만들어", "신규 캐릭터", "add character card".
---

# Add an RPGenius character card

Inputs: **name**, **slot effect** (type + base/per_level), **skills**, and OPTIONALLY a **전직 (class)** block. A card is identified by its **array index = id** (`user.main_card.id`).

The trap: a card's **base slot effect is wired by card NAME in code** — the JSON alone does nothing. The 전직 class slot effects are generic. Skill effects need the dual handler from `add-rpg-skill`.

## 1. Card data — `DB/RPGenius/CharacterCards.json` (CRLF + 4-space; append at end → id = new index)
```json
{
  "name": "카드명",
  "slot_effect": { "name": "<표시 라벨>", "base": 0.03, "per_level": 0.012 },
  "skills": [ <Skills.json index>, ... ],
  "class": {                                  // optional (전직)
    "name": "전직",
    "slot_effects": [ { "effect": "<effectKey>", "name": "<라벨>", "base": 0.015, "per_level": 0.006 }, ... ],
    "skills": [ <Skills.json index>, ... ]
  }
}
```
- `slot_effect.name` is **display-only** (shown in card detail). The actual effect TYPE comes from step 2's code mapping (base cards have NO `effect` field — that's the gotcha).
- Slot effects activate only at **★5+** (`star >= 4`); value = `base + per_level*(star-4)`.

## 2. ⚠️ Base slot effect — wire the card NAME → effect key (REQUIRED)
`calculateCardSlotEffects` (rpgenius.js, grep `cardData.name == '빵귤'`) hardcodes each base card:
```js
if (cardData.name == '카드명') effects.<effectKey> += value;   // add this line
```
Without it the base slot effect does NOTHING. Pick the **effect key** (the 12 valid keys, also used by 전직):
`expBonus` · `hpDamageReduction`(감소) · `killRecoveryChance` · `crit` · `mpCostReduction`(감소) · `damageBonus` · `critMul` · `goldBonus` · `itemDropChance` · `defReduction` · `basicDamageBonus` · `skillDamageBonus`.
- **감소형** (`hpDamageReduction`, `mpCostReduction`): use `+= Math.abs(value)` (mirror existing lines).
- The display label per effect key already exists in `formatCardSlotEffectLines` — set `slot_effect.name` to match it for a consistent card-detail line.

## 3. 전직 (optional) — generic, no per-name wiring
The class branch in `calculateCardSlotEffects` is generic: `effects[se.effect] += value` for any of the 12 keys (감소형 → Math.abs). So a `class.slot_effects` entry with a valid `effect` key **just works** — no code line needed. Class skills are auto-included for `type==='전직'` main cards (`getMainCardSkills` / `getMainCardSkillEntries`).

## 4. Skills — implement them fully (data + BOTH handlers)
Every index in `skills` / `class.skills` must point to a real `Skills.json` entry, and any skill with special effects needs handlers in **both** `executeMainCardSkillInField` (rpgenius.js, solo) and `executeMainCardSkillEffect` (partyquest.js, party). **Use the `add-rpg-skill` skill** for each new skill (it covers the dual handler, element field, summon pattern, etc.). Pure-damage skills need data only. Don't ship a card whose skill works in solo but not party (or vice-versa).

## 5. Automatic — DO NOT touch (handled by array index)
- **Base stats**: shared per-**star** table (`getBaseStat` indexes BaseStat.json by `card.star`, NOT by card id) → no BaseStat change.
- **Dex**: `buildCharacterDex` maps all cards → new card auto-appears.
- **Obtainability**: random card packs / combine use `randomInt(0, characterCards.length-1)` → new card auto-rollable; admin can grant by id. (To force it into a *specific* pack pool, edit that pack — otherwise nothing needed.)

## 6. Verify
- `node -c rpgenius.js partyquest.js` + JSON-validate `CharacterCards.json` + `Skills.json`.
- Confirm the **base slot effect line exists** in `calculateCardSlotEffects` for the new name (else slot effect is dead).
- Confirm each skill is reachable in **both** `executeMainCardSkillInField` and `executeMainCardSkillEffect` (grep the skill name in both).
- Card detail (slot_effect + skills) and dex render; ★5+ test shows the slot effect via `formatCardSlotEffectLines`.

Related: `add-rpg-skill` (the card's skills), [[job-classes]] (전직 structure + the slot-effect generalization), [[element-system]] (skill element field), `rpg-check`.
