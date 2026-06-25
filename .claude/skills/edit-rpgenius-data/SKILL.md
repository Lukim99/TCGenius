---
name: edit-rpgenius-data
description: Directly read/modify/add entries in DynamoDB rpgenius_data (Equipment, Item, etc.) - e.g. design a new weapon/armor/item and write it into Key:Equipment or Key:Item. Supports batch (many entries at once). Triggers - "장비 추가", "아이템 추가", "rpgenius_data 수정", "DynamoDB에 직접 넣어", "마검 만들어 넣어줘".
---

# Directly edit rpgenius_data in DynamoDB

Designs game content (equipment/items/…) and writes it straight into the `rpgenius_data` DynamoDB table — the **live runtime source** (`getDataCache('Item'|'Equipment'|…)`), NOT the `DB/RPGenius/*.json` seeds (those are stale).

## ⚠️ Safety first (this is PRODUCTION data)
- Each rpgenius_data **key is ONE DynamoDB item** holding the whole array/object (`{ key, data }`). You MUST **read-modify-write the entire value** — never partial. A bad write replaces everything for that key.
- **Always back up** the current value to a local file before writing.
- **Verify** by re-reading after the write.
- **Cache staleness**: the running server caches rpgenius_data in memory at boot. A direct DynamoDB write is NOT seen by the live game until the key is reloaded — either restart the server, or (as admin) hit `GET /api/data/:key` (calls `loadRpgeniusDataEntry` → refreshes cache). Tell the user this.
- Avoid running while an admin is editing the same key in the panel (read-modify-write race; rare for Equipment/Item).
- Keep total value under DynamoDB's **400KB/item** limit (Item/Equipment are small today; fine).

## Environment
AWS keys live in **`.env.local`** (no dotenv in the app — parse it yourself). Exact names (note the non-standard secret name):
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_KEY_ID`  ← (not `AWS_SECRET_ACCESS_KEY`)

Region `ap-northeast-2`, table `rpgenius_data`, key attribute `key`, payload attribute `data`. SDK already installed: `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`.

## Procedure
1. **Read live + back up**: GET the key (`Equipment`/`Item`/…), save the returned `data` to `scratchpad/backup-<key>-<ts>.json`.
2. **Infer schema from existing entries** of the same kind (same `rarity`+`type`). Mirror their field set and **interpolate stats sensibly** between neighbours (don't invent wild numbers). The disk JSON shows shape but read LIVE for the real current list + counts.
3. **Assign ids** = array index. Equipment ids are **per-type** (append to `data.weapon` / `data.armor` / …). Item ids are the array index in `data` (append).
4. **Design** the entry/entries (see schemas below). For batch, build all entries, compute ids, link them, then ONE write.
5. **Write** the whole modified value back (PutCommand with `{ key, data }`).
6. **Verify**: re-GET, confirm new entries present and array length increased by N. Report ids.
7. Remind the user to **reload the cache** (restart or admin `GET /api/data/:key`).

### Reusable script template (adapt the `// DESIGN` block)
Put the script in the **project root** so `node_modules` resolves, OR (if you keep it in scratchpad) require the SDK via absolute paths as below — Node resolves modules relative to the SCRIPT's folder, not the cwd.
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
  fs.mkdirSync('scratchpad', { recursive: true });   // ./scratchpad isn't guaranteed to exist → writeFileSync would crash without this
  fs.writeFileSync(`scratchpad/backup-${KEY}-${Date.now()}.json`, JSON.stringify(data));

  // DESIGN: mutate `data` here. e.g. const id = data.weapon.length; data.weapon.push({ ... });

  await doc.send(new PutCommand({ TableName: 'rpgenius_data', Item: { key: KEY, data } }));
  const after = (await doc.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: KEY } }))).Item.data;
  console.log('verify weapon count:', after.weapon.length);
})().catch(e => { console.error(e); process.exit(1); });
```

## Equipment schema (`Key:Equipment` → `{ weapon:[], armor:[], accessory:[], support:[] }`, id = index per type)
- `name`, `desc`, `rarity` (`레어`/`에픽`/`유니크`/`레전더리` 등).
- `stat` {}: base flat stats — `atk`,`def`,`hp`,`mp`,`pnt`,`crit`,`critMul`,`critDef`,`cmb`,`maxCmb`,`skillTrueDmg`, **element**: `fireAtk`/`waterAtk`/`lightAtk`/`darkAtk` (강화), `fireRes`/… (저항). [[element-system]]
- `plusStat` {}: percent — `atk`,`def`,`hp`,`mp`,`afterBasic`,`afterSkill`,`finalDamage`,`eliteDmg`,`bossDmg`,`crit`,`critMul`, … (see EQUIP_PLUSSTAT_LABELS).
- `upgrade`: array of `{ stat:{}, plusStat:{} }` per +level (length = max upgrade level). Interpolate increments from a same-rarity neighbour's curve.
- `statRange` {} (support only): rolled stat ranges.
- `passive_id`: index into **EquipmentPassive.json** (a DISK file, 0=운명, 1=심연, 2=별빛, 3=불굴, 4=마력감응, 5=가시). Reference an EXISTING passive only.
- `evolution`: `<id>` of the evolved equipment **in the same type array** (합성 진화 결과). For "base → evolved" pairs, create the evolved entry first, then set the base's `evolution` to that id.
- Optional: `requireLevel`, `underLevel`, `require` (`[{type:'장신구',accessory_id}]`), `requireMainCard`, `exactlyStar`.

## Item schema (`Key:Item` → array, id = index)
- `name`, `type` (`재료`/`티켓`/`사용`/`소모품`/`가챠`/`번들`/`미끼`/`이벤트`/…), `desc`, `no_trade?`, `sellPrice?`, `rarity?`.
- `소모품`: `use_func: [{ type:'체력회복'|'마나회복'|'경험치획득'|…, amount, duration? }]` (effects dispatched in `applyUseFunc`).
- `사용`: `use:'<action>'` + action fields (dispatched in `useItem`). New actions need code — see `add-rpg-use-item`.
- `가챠`/`번들`: `pack` (index into Pack/Bundle). `require: [{id,count}]` for consumed materials.

## Boundaries — data vs code
This skill only writes **data**. If the request needs **new behavior**:
- A **new passive effect** (e.g. "공격 시 25% 확률로 [암]속성 강화 +100"): the equipment's `passive_id` references EquipmentPassive.json, but the EFFECT is wired in code by passive_id. A novel effect needs an EquipmentPassive.json entry **+ code** (mirror existing passive handling). Adding the equipment alone will NOT make a new passive work — flag this and offer the code work separately.
- New `use` actions, stats, elements → use `add-rpg-use-item` / `add-rpg-stat` / `add-rpg-element`. Existing elements (화/수/명/암) are plain stats and work as data immediately.

## Batch
For "N개 + 진화버전 N개": design all 2N entries in memory, append to the type array, set each base's `evolution` to its evolved id, then ONE PutCommand. Verify count increased by 2N.
