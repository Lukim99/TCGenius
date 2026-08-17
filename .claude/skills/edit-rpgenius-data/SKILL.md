---
name: edit-rpgenius-data
description: Directly read/modify/add entries in DynamoDB rpgenius_data (Equipment, Item, Pet, Pack, Bundle, Shop, Fashion, …) - e.g. design a new weapon/armor/item/pet and write it into Key:Equipment or Key:Item. Supports batch (many entries at once). Knows which RPGenius data is DynamoDB vs disk JSON, and where data-only stops and code is needed (초월/신화 named effects, passives, orbs). Triggers - "장비 추가", "아이템 추가", "펫 추가", "rpgenius_data 수정", "DynamoDB에 직접 넣어", "마검 만들어 넣어줘".
---

# Directly edit rpgenius_data in DynamoDB

Designs game content (equipment/items/pets/packs/…) and writes it straight into the `rpgenius_data` DynamoDB table — the **live runtime source** (`getDataCache('Item'|'Equipment'|'Pet'|…)`), NOT the `DB/RPGenius/*.json` seeds (Item.json / Equipment.json on disk are stale — Equipment.json still has 4 types, no 초월).

## Which data lives where (check before editing)
- **DynamoDB `rpgenius_data`** (whitelist `RPGENIUS_DATA_KEYS`, rpgenius.js ~line 18 — writes to any other key throw): `Equipment`, `Item`, `Pet`, `Pack`, `Bundle`, `Shop`, `Recipe`, `Coupon`, `Fashion`, `Bait`, `Patchnote`, `Banner`, `Capsule100`, `Prob`, `Ceil`, `HotDealOverride`, `NameMatch` + state/log keys (`Auction`, `BuyOrder`, `ShopState`, `TradeLog`, `EliteState`, `WorldBossState`, `VoteState`, `Logs`, `PointLogs`, `PunchRank`, `PunchState`, `Ices`). Admin panel edits these.
- **Disk JSON, read at runtime** (edit the file, keep CRLF/indent; not this skill's DynamoDB path): `CharacterCards.json`, `Skills.json`, `BaseStat.json`, `ExpTable.json`, `Dungeon.json`, `WorldBoss.json`, `ExtraSkills.json`, `EquipmentPassive.json`, `Potential.json`, `Orb.json`, `PetSet.json`, `titles.json` (module-cached → restart), `PartyQuest.json` (partyquest.js).
- Code-defined catalog: `transcend_equipment.js` (초월/신화 definitions, set texts, per-name effects, unique passive ids 6+, `applyEquipmentBalancePatch` which overrides `desc`/stat for a few names on every load).

## ⚠️ Safety first (PRODUCTION data)
- Each key is ONE DynamoDB item holding the whole array/object (`{ key, data }`). **Read-modify-write the entire value** — a bad write replaces everything for that key.
- **Always back up** the current value to a local file before writing. **Verify** by re-reading after.
- **Cache staleness**: the server caches rpgenius_data in memory at boot. A direct write is NOT seen until the key is reloaded — restart, or (as admin) `GET /api/data/:key` (calls `loadRpgeniusDataEntry` → refreshes cache; for Equipment it also re-applies `applyEquipmentBalancePatch`). Tell the user.
- Avoid running while an admin is editing the same key in the panel (read-modify-write race). Keep under DynamoDB's **400KB/item**.

## Environment
AWS keys in **`.env.local`** (no dotenv in the app — parse it yourself). Exact names (non-standard secret name): `AWS_ACCESS_KEY_ID`, `AWS_SECRET_KEY_ID` (← not `AWS_SECRET_ACCESS_KEY`). Region `ap-northeast-2`, table `rpgenius_data`, key attribute `key`, payload `data`. SDK installed: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`.

## Procedure
1. **Read live + back up**: GET the key, save `data` to `scratchpad/backup-<key>-<ts>.json`.
2. **Infer schema from existing entries** of the same kind (same `rarity`+`type`); mirror the field set and **interpolate stats between neighbours** (don't invent wild numbers). Read LIVE for the real current list + counts.
3. **Assign ids** = array index. Equipment ids are **per-type** (append to `data.weapon` / `data.hat` / …). Item/Pet ids are the array index (append; **never reorder/delete** — ids are referenced from user inventories, Pack/Bundle/Shop/Recipe, `require`, `evolution`).
4. **Design** the entries. For batch, build all, compute ids, link them (`evolution`, `require`), then ONE write.
5. **Write** the whole value back (PutCommand `{ key, data }`).
6. **Verify**: re-GET, confirm new entries present and length increased by N. Report ids.
7. Remind the user to **reload the cache** (restart or admin `GET /api/data/:key`).

### Reusable script template (adapt the `// DESIGN` block)
Put the script in the **project root** so `node_modules` resolves, OR require the SDK via absolute paths (Node resolves relative to the SCRIPT's folder, not cwd).
```js
const fs = require('fs');
const ROOT = 'c:/Users/dodom/Downloads/tcgenius';
const { DynamoDBClient } = require(ROOT + '/node_modules/@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require(ROOT + '/node_modules/@aws-sdk/lib-dynamodb');

const env = Object.fromEntries(fs.readFileSync(ROOT + '/.env.local','utf8').split(/\r?\n/)
  .filter(l => l.includes('=')).map(l => { const i=l.indexOf('='); return [l.slice(0,i).trim(), l.slice(i+1).trim()]; }));
const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2',
  credentials: { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_KEY_ID } }));

(async () => {
  const KEY = 'Equipment';
  const got = await doc.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: KEY } }));
  const data = got.Item.data;
  fs.mkdirSync('scratchpad', { recursive: true });
  fs.writeFileSync(`scratchpad/backup-${KEY}-${Date.now()}.json`, JSON.stringify(data));

  // DESIGN: mutate `data` here. e.g. const id = data.weapon.length; data.weapon.push({ ... });

  await doc.send(new PutCommand({ TableName: 'rpgenius_data', Item: { key: KEY, data } }));
  const after = (await doc.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: KEY } }))).Item.data;
  console.log('verify weapon count:', after.weapon.length);
})().catch(e => { console.error(e); process.exit(1); });
```

## Equipment schema (`Key:Equipment` → `{ weapon:[], hat:[], armor:[], pants:[], shoes:[], accessory:[], support:[] }`, id = index per type)
- `name`, `desc` (free text, "고유 옵션" display), `rarity` — order `일반 < 고급 < 레어 < 희귀 < 에픽 < 유니크 < 영웅 < 레전더리 < 전설 < 초월 < 신화 < 고유` (`EQUIPMENT_TRADE_RARITY_ORDER`).
- `stat` {}: flat — `atk`,`def`,`hp`,`mp`,`pnt`,`crit`,`critMul`,`critDef`,`cmb`,`maxCmb`,`skillTrueDmg`, element `fireAtk/waterAtk/lightAtk/darkAtk` (강화), `fireRes/…` (저항), `allElementAtk`/`allElementRes` (모든 속성) — see `EQUIP_STAT_LABELS`. `plusStat` {}: percent — `atk`,`def`,`hp`,`mp`,`afterBasic`,`afterSkill`,`finalDamage`,`extraDamage`,`eliteDmg`,`bossDmg`,`crit`,`critMul`, … (see `EQUIP_PLUSSTAT_LABELS`). Unknown keys are summed but won't display/count — use `add-rpg-stat` for new keys.
- `upgrade`: array of `{ stat:{}, plusStat:{} }` per +level (length = max level; 초월/신화 use 15). Interpolate from a same-rarity neighbour's curve.
- `statRange`/`plusStatRange` (support only: rolled ranges), `dynamicBonus.mainCardStar` (`{"<star>": num|{stat,plusStat}}`).
- `passive_id`: index into merged passive list = **`EquipmentPassive.json` 0-5** (0=운명, 1=심연, 2=별빛의 축복, 3=불굴, 4=마력 감응, 5=가시 — behavior hardcoded by index) **∪ transcend unique passives 6+** (`transcend_equipment.js` `uniquePassiveDescriptions`, ids by insertion order — display-only unless code matches the equipment NAME). Reference an EXISTING id only.
- `evolution`: id of the evolved equipment **in the same type array** (3-item 10강 합성 결과). Create the evolved entry first, then set the base's `evolution`.
- `set` (+ `setEffects: {"2":"…","4":"…"}` display text) — numeric set bonuses are hardcoded by set NAME in `applyTranscendEquipmentStats`; a new set name = text only.
- Optional: `requireLevel`, `underLevel`, `require` (`[{type:'무기'|'갑옷'|'장신구', weapon_id|armor_id|accessory_id}]`), `requireMainCard` (`[cardId]`), `exactlyStar`, `category` (accessory: one per category), `no_trade`, `isRaid` (excluded from 유니크 장비 상자).
- Trade rules are derived, not data: 초월/신화 → 1 trade, consumed on equip; `no_trade` → 0; ≥유니크 → 5; else unlimited.

## Item schema (`Key:Item` → array, id = index)
- `name`, `type` (`재료`/`티켓`/`사용`/`소모품`/`가챠`/`번들`/`미끼`/`이벤트`), `desc`, `no_trade?`, `sellPrice?` (absent = unsellable), `rarity?`, `require?` (`[{id,count}]` consumed per use).
- `소모품`: `use_func: [{ type:'체력회복'|'마나회복'|'체력회복%'|'마나회복%'|'경험치획득'|'경험치비약'|'골드비약', amount, duration? }]`.
- `사용`: `use:'<action>'` + fields — `장신구선택권`{`rarity`}, `장비강화권`{`ug:{level,roll}`}, `영혼석`{`soul:{name,date,weapon?,armor?}`}, `아이템선택`{`choices:[{id,count}]`} (choose-1-of-N, no code), `보주` (item **name must equal an `Orb.json` orb name**), `보주선택`, `초월선택`/`초월상자`{`tradeUsed?`}, `초월업그레이드`, `생명수`, `가위`, `잠재능력부여`{`tier?`}, `변환`/`캐릭터변환`{`charId`,`can?`}, `패션적용`{`fashion?`}, … New actions need code — `add-rpg-use-item`.
- `가챠`: `pack:<Pack index>` (+`num`), or `pack:{type:'캐릭터 카드팩'|'전직 캐릭터 카드팩'|'장비 상자'|'보조 장비 상자'|'펫', rarity?}`, or `use:'초월상자'|'보주상자'`. `번들`: `pack:<Bundle index>`.
- 100일/이벤트 items etc. are matched by NAME constants in code (e.g. `CAPSULE100_COIN_ITEM_NAME`) — keep names exact.

## Pet schema (`Key:Pet` → array, id = index)
`{ name, desc, rarity ('일반'|'레어'|'에픽'|'유니크'|'레전더리'|'신화'|'고유'), stat:{}, plusStat:{}, upgrade?:[{stat?,plusStat?,special?}], special?:{ fishingSpeed, fishBasket, autoFragment, hpRegen, mpRegen, canShortcut, autoAttend }, requireLevel?, set? }` — `set` name → tiers in disk `PetSet.json` `{ "<set>": [tier1, tier2, …] }`. Pet gacha = item `pack:{type:'펫', rarity}`.

## Boundaries — data vs code
This skill only writes **data**. Needs **code** when:
- **초월/신화 equipment with a named effect**: gameplay effects are string-matched on `data.name` (`applyTranscendEquipmentStats` switch, `getEquippedNamed`/`stepValue`/`stageOf` in rpgenius.js, `getTranscendEquipmentEntry(member,'<name>')` in partyquest.js, `uniqueStaticPerStageEffects`/`conditionalCombatPowerEffects` in transcend_equipment.js). Data-only gives: dex/equip/stats/upgrade/trade/`transcendStage`/set-count. Anything else needs code by name — flag it and offer separately.
- A **new passive effect**: `passive_id` must reference an existing behavior; a novel effect = EquipmentPassive.json/`uniquePassiveDescriptions` entry (append only — ids are positional) **+ code**.
- New `use` actions, stat keys, elements, equipment types → `add-rpg-use-item` / `add-rpg-stat` / `add-rpg-element` / `add-rpg-equipment-part`. Existing elements (화/수/명/암 + 모든속성) are plain stats and work as data immediately.
- Images (server.js `getItemIconUrl`/`getEquipmentIconUrl`/`getPetIconUrl`): item `DB/RPGenius/itemImage/<type>/<name>.png` (보주 items → `itemImage/보주/`), equipment `itemImage/장비/<rarity> <name>.png`, pet `itemImage/펫/<rarity> <name>.png` — add the files or the icon is blank.

## Batch
For "N개 + 진화버전 N개": design all 2N entries in memory, append to the type array, set each base's `evolution` to its evolved id, then ONE PutCommand. Verify count increased by 2N.
