// Preload for offline capture: node -r ./mock_dynamo.js server.js
// Replaces the DynamoDB DocumentClient with an in-memory store seeded from local JSON,
// so the real web app (server.js + public/*) renders without any cloud access.
const path = require('path');
const fs = require('fs');

const ROOT = process.env.RPG_ROOT || path.resolve(__dirname, '..', '..', '..', '..');   // repo root
const SEED = process.env.RPG_SEED || path.join(__dirname, 'seed.json');
const lib = require(require.resolve('@aws-sdk/lib-dynamodb', { paths: [ROOT] }));

const KEY_OF = { rpgenius_data: 'key', rpgenius_user: 'id', rpgenius_sid: 'senderId', rpgenius_mail: 'id' };
const tables = {};
const table = name => (tables[name] = tables[name] || new Map());
const clone = v => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const keyValue = (name, key) => key[KEY_OF[name] || Object.keys(key)[0]];

function loadSeed() {
    const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
    for (const [name, items] of Object.entries(seed)) {
        for (const item of items) table(name).set(keyValue(name, item), item);
    }
    console.log('[mock-dynamo] seeded', Object.entries(tables).map(([n, t]) => n + ':' + t.size).join(' '));
}

function applyUpdate(item, input) {
    const names = input.ExpressionAttributeNames || {};
    const values = input.ExpressionAttributeValues || {};
    const attr = token => names[token] || token;
    const expr = input.UpdateExpression || '';
    const sections = expr.split(/\b(SET|REMOVE|ADD)\b/).map(s => s.trim()).filter(Boolean);
    for (let i = 0; i < sections.length; i += 2) {
        const op = sections[i];
        const parts = sections[i + 1].split(/,(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
            if (op === 'REMOVE') { delete item[attr(part)]; continue; }
            const [lhs, rhs] = part.split(/=|\s+(?=:)/).map(s => s.trim());
            const key = attr(lhs);
            if (op === 'ADD') { item[key] = (Number(item[key]) || 0) + Number(values[rhs]); continue; }
            const la = rhs.match(/^list_append\(if_not_exists\(([^,]+),([^)]+)\),([^)]+)\)$/);
            if (la) {
                const base = item[attr(la[1].trim())] !== undefined ? item[attr(la[1].trim())] : values[la[2].trim()];
                item[key] = [].concat(clone(base) || [], clone(values[la[3].trim()]) || []);
            } else {
                item[key] = clone(values[rhs]);
            }
        }
    }
    return item;
}

async function send(cmd) {
    const kind = cmd.constructor && cmd.constructor.name;
    const input = cmd.input || {};
    switch (kind) {
        case 'GetCommand': {
            const item = table(input.TableName).get(keyValue(input.TableName, input.Key));
            return { Item: clone(item) };
        }
        case 'PutCommand': {
            table(input.TableName).set(keyValue(input.TableName, input.Item), clone(input.Item));
            return {};
        }
        case 'DeleteCommand': {
            table(input.TableName).delete(keyValue(input.TableName, input.Key));
            return {};
        }
        case 'UpdateCommand': {
            const t = table(input.TableName);
            const k = keyValue(input.TableName, input.Key);
            const item = t.get(k) || clone(input.Key);
            t.set(k, applyUpdate(item, input));
            return { Attributes: clone(t.get(k)) };
        }
        case 'ScanCommand': {
            return { Items: [...table(input.TableName).values()].map(clone) };
        }
        case 'BatchGetCommand': {
            const Responses = {};
            for (const [name, req] of Object.entries(input.RequestItems || {})) {
                Responses[name] = (req.Keys || []).map(key => table(name).get(keyValue(name, key))).filter(Boolean).map(clone);
            }
            return { Responses, UnprocessedKeys: {} };
        }
        case 'BatchWriteCommand': {
            for (const [name, reqs] of Object.entries(input.RequestItems || {})) {
                for (const req of reqs) {
                    if (req.PutRequest) table(name).set(keyValue(name, req.PutRequest.Item), clone(req.PutRequest.Item));
                    if (req.DeleteRequest) table(name).delete(keyValue(name, req.DeleteRequest.Key));
                }
            }
            return { UnprocessedItems: {} };
        }
        case 'TransactWriteCommand': {
            for (const entry of input.TransactItems || []) {
                if (entry.Put) await send({ constructor: { name: 'PutCommand' }, input: entry.Put });
                if (entry.Update) await send({ constructor: { name: 'UpdateCommand' }, input: entry.Update });
                if (entry.Delete) await send({ constructor: { name: 'DeleteCommand' }, input: entry.Delete });
            }
            return {};
        }
        default:
            console.warn('[mock-dynamo] unsupported command', kind);
            return {};
    }
}

loadSeed();
lib.DynamoDBDocumentClient.from = () => ({ send, destroy() {}, config: {} });

// After boot: fill every seeded account's HP/MP to its real computed maximum (the game refuses entry at HP <= 1).
setTimeout(async () => {
    const rpg = require(path.join(ROOT, 'rpgenius.js'));
    for (const item of table('rpgenius_user').values()) {
        const user = await rpg.getRPGUserByName(item.name);
        if (!user) continue;
        const stats = rpg.calculateUserStats(user);
        user.hp = Number(stats.hp || 0);
        user.mp = Number(stats.mp || 0);
        await user.save();
    }
    console.log('[mock-dynamo] hp/mp filled');
}, 1500);
