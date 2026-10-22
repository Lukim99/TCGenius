const corridor = require('./paradise');
const hell = require('./paradise_hell');
const combatEffects = require('./public/combat-effects');
const progression = require('./paradise_progression');
const shop = require('./paradise_shop');

function registerParadiseRoutes(server, { rpgenius, requireUser, getSession, serializeCard, getCharacterSprite, getMonsterSprite, getEquipmentIconUrl, getItemIconUrl, getCombatView }) {
    const weeklyRewards = require('./paradise_rewards');
    weeklyRewards.startWeeklyRewards();
    const advanceCombat = async user => {
        const timeAdvanced = corridor.advanceTime(user);
        const resourcesAdded = corridor.active(user) && !user.paradise.resources;
        if (resourcesAdded) { corridor.getResources(user); user.paradise.revision++; }
        const chestLimitChanged = hell.normalizeChestSelection(user);
        const rebalanced = corridor.rebalanceEnemy(user);
        const offerNormalized = corridor.normalizeAugmentOffer(user);
        const relicOfferNormalized = corridor.normalizeRelicOffer(user);
        const advanced = rpgenius.advanceParadiseCombat(user);
        if (!timeAdvanced && !resourcesAdded && !chestLimitChanged && !rebalanced && !offerNormalized && !relicOfferNormalized && !advanced) return;
        const keys = Object.keys(user).filter(key => key !== 'id' && !key.startsWith('__') && user[key] !== undefined && typeof user[key] !== 'function');
        await rpgenius.commitProtectedUserChange(user, keys);
    };
    const rewardView = (reward, user) => {
        const card = reward.kind === 'card' ? serializeCard(reward.card, user) : null;
        return { kind: reward.kind, name: card?.name || reward.name, count: reward.count,
            iconUrl: reward.kind === 'item' ? getItemIconUrl(rpgenius.getDataCache('Item', [])[reward.id])
                : reward.kind === 'gold' ? '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png') : card?.imageUrl || null,
            ...(card ? { star: card.starText, cardType: card.type } : {}) };
    };
    const revealView = (reveal, user) => reveal?.kind === 'rewards' ? { ...reveal, items: reveal.items.map(reward => rewardView(reward, user)) } : reveal || null;
    const state = user => {
        const stats = rpgenius.calculateUserStats(user), slotEffects = rpgenius.calculateCardSlotEffects(user);
        const context = { stats, slotEffects }, view = corridor.view(user, stats, slotEffects);
        const items = rpgenius.getDataCache('Item', []);
        view.shop = shop.view(user, getItemIconUrl);
        view.ticket.iconUrl = getItemIconUrl(items.find(item => item?.name === view.ticket.name));
        view.progression.tokenIconUrl = getItemIconUrl(items.find(item => item?.name === progression.TOKEN));
        view.weeklyRewards = structuredClone(view.weeklyRewards);
        for (const reward of [...view.weeklyRewards.participation, ...view.weeklyRewards.ranks.flatMap(row => row.rewards)]) {
            reward.name ||= reward.type;
            reward.iconUrl = reward.type === '가넷' ? '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('가넷.png') : getItemIconUrl(items.find(item => item?.name === reward.name));
        }
        for (const key of view.hell.keys) key.iconUrl = getItemIconUrl(items.find(item => item?.name === key.name));
        view.player.card = serializeCard(user.main_card, user, context);
        view.player.sprite = getCharacterSprite(view.player.card);
        if (view.run?.enemy) view.run.enemy.sprite = view.run.enemy.characterCard ? getCharacterSprite(serializeCard(view.run.enemy.characterCard, user, context)) : view.run.enemy.kind === 'mirror' ? view.player.sprite : getMonsterSprite(view.run.enemy);
        if (view.run) view.run.combatLog = user.paradise.combatLog || [];
        if (view.run) view.run.combatEvents = user.paradise.combatEvents || [];
        if (view.run?.phase === 'combat') {
            view.battle = getCombatView(user, view, stats);
            if (user.paradise.battle?.hackCard) {
                const card = serializeCard(user.paradise.battle.hackCard, user, context);
                for (const skill of card.skills || []) if (!view.battle.skills.some(s => s.name === skill.name)) view.battle.skills.push({ ...skill, cooldownEnd: Number(user.field.skillCooldowns[skill.name] || 0), borrowed: true });
            }
            const characters = require('./paradise_augments_characters'), blocked = characters.skillBlocked(user) || require('./paradise_routes').skillBlocked(user);
            const mechanics = require('./paradise_mechanics');
            view.battle.skills.push(...mechanics.skillView(user, stats));
            for (const skill of view.battle.skills) {
                if (blocked) skill.disabledReason = blocked;
                if (characters.freeSkill(user, skill.name)) skill.mpCost = 0;
                const payment = mechanics.payment(user, stats, skill.mpCost, skill.name);
                skill.mpCost = payment.cost;
                if (payment.hpCost) skill.hpCost = Number(skill.hpCost || 0) + payment.hpCost;
            }
        }
        if (view.run?.rewardSummary) view.run.rewardSummary = view.run.rewardSummary.map(reward => rewardView(reward, user));
        if (view.run?.mode === 'hell') for (const chest of view.run.chests) {
            const reward = user.paradise.rewardTable.find(row => row.id === chest.category);
            chest.categoryName ||= reward?.name;
            chest.rewardText ||= chest.description.split(/\n| · 상급 강화석/)[0];
            chest.iconUrl = reward?.kind === 'item' ? getItemIconUrl(items.find(item => item?.name === (reward.items?.[chest.tier] || reward.item))) : null;
            chest.stonesIconUrl = getItemIconUrl(items.find(item => item?.name === '상급 강화석'));
        }
        if (view.run?.mode !== 'hell' && view.run?.rewards) for (const reward of view.run.rewards) {
            reward.iconUrl = reward.type === '아이템' ? getItemIconUrl(items.find(item => item?.name === reward.name))
                : reward.type === '골드' ? '/item-image?dir=' + encodeURIComponent('화폐') + '&file=' + encodeURIComponent('골드.png') : null;
        }
        if (view.run) for (const choice of view.run.choices) {
            if (choice.character != null) choice.iconUrl = view.player.sprite;
            if (choice.equipment) {
                const equipped = rpgenius.getEquippedEquipmentData(user).find(e => e.data.name === choice.equipment);
                if (equipped) choice.iconUrl = getEquipmentIconUrl(equipped.data);
            }
        }
        return view;
    };
    server.get('/paradise', (req, res) => {
        if (!getSession(req)?.name) return res.redirect('/');
        res.type('html').send(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#05090e"><title>낙원</title><link rel="stylesheet" href="/static/paradise.css"></head><body><main id="paradiseRoot" aria-label="낙원"><canvas id="paScene" aria-hidden="true"></canvas><div id="paBattle" hidden><canvas id="hfCanvas" aria-hidden="true"></canvas><canvas id="hfHud" aria-hidden="true"></canvas></div><canvas id="paHud" aria-hidden="true"></canvas><div id="paControls" aria-label="게임 조작"></div><form id="paPuzzle" hidden></form><div id="paLive" class="sr-only" role="status" aria-live="polite"></div><div id="paFatal" hidden></div></main><noscript>낙원에 입장하려면 JavaScript를 켜주세요.</noscript><script>window.FIELD_MODE="paradise";</script><link rel="stylesheet" href="/static/ultimate-cutscene.css"><script src="/static/ultimate-cutscene.js"></script><script src="/static/combat-effects.js" defer></script><script src="/static/paradise-audio.js" defer></script><script src="/static/hfield.js" defer></script><script src="/static/paradise-lobby.js" defer></script><script src="/static/paradise-shop.js" defer></script><script src="/static/paradise.js" defer></script></body></html>`);
    });
    server.get('/api/paradise', requireUser, async (req, res) => {
        try {
            const user = await rpgenius.getRPGUserByName(req.session.name);
            if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
            res.setHeader('Cache-Control', 'no-store');
            const view = await rpgenius.enqueueFieldAction(user, async () => {
                const latest = await rpgenius.getRPGUserByName(req.session.name);
                await advanceCombat(latest);
                return state(latest);
            });
            res.json(view);
        } catch (error) { console.error('[paradise view]', error.message); res.status(500).json({ error: '회랑 상태를 불러오지 못했습니다.' }); }
    });
    server.get('/api/paradise/ranking', requireUser, async (req, res) => {
        try {
            const user = await rpgenius.getRPGUserByName(req.session.name);
            if (!user) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
            res.setHeader('Cache-Control', 'no-store');
            res.json(corridor.buildWeeklyRanking(await rpgenius.getParadiseWeeklyRecords(), user));
        } catch (error) { console.error('[paradise ranking]', error.message); res.status(500).json({ error: '주간 랭킹을 불러오지 못했습니다.' }); }
    });
    server.post('/api/paradise/shop/buy', requireUser, async (req, res) => {
        const body = req.body || {};
        try {
            const seed = await rpgenius.getRPGUserByName(req.session.name);
            if (!seed) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
            if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '') || !Number.isSafeInteger(body.revision) || body.revision < 0) return res.status(400).json({ error: '낙원 상점을 다시 열어주세요.' });
            const payload = await rpgenius.enqueueFieldAction(seed, async () => {
                const user = await rpgenius.getRPGUserByName(req.session.name);
                const receipt = user.paradiseShopReceipt;
                const purchaseView = purchase => ({ ...purchase, iconUrl: getItemIconUrl(rpgenius.getDataCache('Item', [])[purchase.itemId]) });
                if (receipt?.id === body.requestId) return receipt.product === body.product && receipt.quantity === body.quantity
                    ? { ok: true, message: receipt.message, purchase: purchaseView(receipt.purchase), state: state(user) }
                    : { error: '이미 다른 구매에 사용한 요청입니다.' };
                if (Number(user.paradiseShop?.revision || 0) !== body.revision || shop.catalogRevision() !== body.catalogRevision) return { error: '상점 정보가 변경되었습니다. 가격과 잔액을 다시 확인해주세요.', stale: true, state: state(user) };
                const result = shop.buy(user, body);
                if (result.error) return { ...result, state: state(user) };
                user.paradiseShopReceipt = { id: body.requestId, product: body.product, quantity: body.quantity, message: result.message, purchase: result.purchase };
                await rpgenius.commitProtectedUserChange(user, ['inventory', 'gold', 'paradiseShop', 'paradiseShopReceipt']);
                return { ok: true, message: result.message, purchase: purchaseView(result.purchase), state: state(user) };
            });
            res.status(payload.stale ? 409 : payload.error ? 400 : 200).json(payload);
        } catch (error) {
            console.error('[paradise shop]', error.message);
            res.status(503).json({ error: '구매 저장 결과를 확인하지 못했습니다. 같은 요청으로 재시도해주세요.', retryable: true });
        }
    });
    for (const action of ['unlockEquipment', 'enhance', 'unlockTrait', 'rerollTrait']) {
        server.post('/api/paradise/progression/' + action, requireUser, async (req, res) => {
            const body = req.body || {};
            if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '') || !Number.isSafeInteger(body.revision) || body.revision < 0) return res.status(400).json({ error: '낙원 화면을 새로 열어주세요.' });
            try {
                const seed = await rpgenius.getRPGUserByName(req.session.name);
                if (!seed) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
                const payload = await rpgenius.enqueueFieldAction(seed, async () => {
                    const user = await rpgenius.getRPGUserByName(req.session.name), receipt = user.paradiseProgressionReceipt;
                    if (receipt?.id === body.requestId) return receipt.action === action ? { ok: true, message: receipt.message, state: state(user) } : { error: '이미 사용한 요청입니다.' };
                    if (progression.view(user).revision !== body.revision) return { error: '다른 화면에서 강화가 진행되었습니다. 현재 상태를 불러왔습니다.', stale: true, state: state(user) };
                    const result = progression.mutate(user, action, body);
                    if (result.error) return { ...result, state: state(user) };
                    user.paradiseProgressionReceipt = { id: body.requestId, action, message: result.message };
                    await rpgenius.commitProtectedUserChange(user, ['inventory', 'paradiseProgression', 'paradiseProgressionReceipt']);
                    return { ok: true, message: result.message, state: state(user) };
                });
                res.status(payload.error ? 400 : 200).json(payload);
            } catch (error) {
                console.error('[paradise progression]', error.message);
                res.status(503).json({ error: '저장을 확인하지 못했습니다. 같은 요청으로 재시도해주세요.', retryable: true });
            }
        });
    }
    for (const action of ['enter', 'augment', 'reroll', 'route', 'relic', 'event', 'puzzle', 'attack', 'skill', 'retire', 'claim', 'dismiss', 'descend', 'altar', 'continue', 'chest']) {
        server.post('/api/paradise/' + action, requireUser, async (req, res) => {
            const body = req.body || {};
            if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '') || !Number.isSafeInteger(body.revision) || body.revision < 0 || body.runId != null && typeof body.runId !== 'string') return res.status(400).json({ error: '낙원 화면을 새로 열어주세요.' });
            try {
                await weeklyRewards.settleWeekly();
                const seed = await rpgenius.getRPGUserByName(req.session.name);
                if (!seed) return res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
                const payload = await rpgenius.enqueueFieldAction(seed, async () => {
                    const user = await rpgenius.getRPGUserByName(req.session.name);
                    await advanceCombat(user);
                    const receipt = user.paradiseReceipt;
                    if (receipt?.id === body.requestId) {
                        if (receipt.action !== action) return { error: '이미 다른 동작에 사용한 요청입니다.' };
                        return { ok: true, message: receipt.message, reveal: revealView(receipt.reveal, user), state: state(user) };
                    }
                    if (Number(user.paradise?.revision || 0) !== body.revision || (user.paradise?.id || null) !== (body.runId || null)) return { error: '다른 화면에서 탐험이 진행되었습니다. 현재 상태를 다시 불러왔습니다.', state: state(user), stale: true };
                    if (!['enter', 'claim', 'chest', 'dismiss'].includes(action) && !corridor.active(user) && !(action === 'retire' && corridor.view(user).run?.canReturn)) return { error: '진행 중인 낙원 탐험이 없습니다.', state: state(user) };
                    let result;
                    if (action === 'enter') result = body.mode === 'hell' ? hell.enter(user, body.key) : body.mode && body.mode !== 'heaven' ? { error: '알 수 없는 낙원 입장입니다.' } : corridor.enter(user);
                    else if (action === 'descend') result = hell.descend(user, body.side);
                    else if (action === 'altar') result = hell.altar(user);
                    else if (action === 'continue') result = user.paradise.mode === 'hell' ? hell.continueAltar(user) : corridor.continueExploration(user);
                    else if (action === 'chest') result = hell.openChest(user, body.chest);
                    else if (action === 'augment') result = corridor.chooseAugment(user, body.choice);
                    else if (action === 'reroll') result = corridor.rerollAugment(user, body.choice);
                    else if (action === 'route') result = corridor.chooseRoute(user, body.choice);
                    else if (action === 'relic') result = corridor.chooseRelic(user, body.choice);
                    else if (action === 'event') result = corridor.chooseEvent(user, body.choice);
                    else if (action === 'puzzle') result = corridor.answerPuzzle(user, body.skip === true ? null : body.answer);
                    else if (action === 'claim') result = corridor.claim(user);
                    else if (action === 'dismiss') result = corridor.dismiss(user);
                    else if (action === 'retire') result = corridor.finish(user);
                    else {
                        if (user.paradise.phase !== 'combat') return { error: '전투 중에만 공격할 수 있습니다.', state: state(user) };
                        const sequence = Number(user.paradise.combatSequence || 0), enemyId = user.paradise.enemy.id;
                        const message = action === 'attack' ? await rpgenius.useBasicAttackInField(user) : await rpgenius.useSkillInField(user, typeof body.skill === 'string' ? body.skill : '');
                        result = String(message).startsWith('❌') ? { error: String(message).replace(/^❌\s*/, '') } : { message };
                        const triggeredEffectIds = rpgenius.drainFieldActionEffectIds(user.name);
                        if (!result.error && action === 'skill' && Number(user.paradise.combatSequence || 0) === sequence) {
                            const run = user.paradise;
                            run.combatSequence = sequence + 1;
                            run.combatEvents = [...(run.combatEvents || []), combatEffects.annotateEvent({
                                id: run.id + ':' + run.combatSequence, at: Date.now(), enemyId,
                                action: 'skill', skillName: body.skill, triggeredEffectIds, hits: [], receivedHits: [], damage: 0, received: 0
                            })].slice(-12);
                        }
                    }
                    if (result.error) return { ...result, state: state(user) };
                    if (user.paradise.rewardReveal) {
                        result.reveal ||= user.paradise.rewardReveal;
                        result.message = [result.message, user.paradise.rewardReveal.text].filter(Boolean).join('\n');
                        delete user.paradise.rewardReveal;
                    }
                    user.paradise.revision++;
                    user.paradiseReceipt = { id: body.requestId, action, message: result.message || '완료', reveal: result.reveal || null };
                    // 입장권, 탐험 전이, 카드/재화 정산을 동일한 유저 문서에 조건부 저장한다.
                    const keys = Object.keys(user).filter(key => key !== 'id' && !key.startsWith('__') && user[key] !== undefined && typeof user[key] !== 'function');
                    await rpgenius.commitProtectedUserChange(user, keys);
                    return { ok: true, message: result.message, reveal: revealView(result.reveal, user), state: state(user) };
                });
                res.status(payload.error ? payload.stale ? 409 : 400 : 200).json(payload);
            } catch (error) {
                console.error('[paradise ' + action + ']', error.message);
                res.status(503).json({ error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 시도해주세요.', retryable: true });
            }
        });
    }
}
module.exports = { registerParadiseRoutes };
