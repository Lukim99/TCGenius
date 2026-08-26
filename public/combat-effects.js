(function (root, factory) {
    const api = factory();
    if (typeof module == 'object' && module.exports) module.exports = api;
    else root.CombatEffects = api;
})(typeof globalThis != 'undefined' ? globalThis : this, function () {
    'use strict';

    const DIRS = Object.freeze({
        skill: '스킬', equipment: '장비', set: '세트', summon: '소환수',
        element: '속성', combat: '전투'
    });
    const ELEMENTS = new Set(['화', '수', '명', '암']);
    const FIXED_MULTI_HIT_SKILLS = new Set(['포커 못 하시네']);
    const id = (kind, name) => kind + ':' + String(name || '').trim();
    const unique = values => Array.from(new Set((values || []).filter(Boolean)));
    const add = (values, value) => {
        if (Array.isArray(value)) value.forEach(entry => add(values, entry));
        else if (value && !values.includes(value)) values.push(value);
    };

    const SKILL_RESULTS = Object.freeze({
        '자인': [id('combat', '버프'), id('combat', '공격력 강화')],
        '시벌론': [id('combat', '행동 가속')],
        '글버지': [id('combat', '보호막 부여')],
        '불사조': [id('combat', '받는 피해 증가')],
        '피아스트': [id('combat', '보호막 부여'), id('combat', 'MP 회복')],
        '수업끝': [id('combat', '받는 피해 감소')],
        'SUPER EASY': [id('combat', '치명타 피해 증가')],
        '백억이요': [id('combat', '골드 획득')],
        '건력': [id('combat', 'HP 봉인'), id('combat', '공격력 강화'), id('combat', '받는 피해 감소')],
        '청정수 투척': [id('combat', '방어 관통 강화')],
        '비리': [id('combat', '치명타 확정')],
        '유드 알레프': [id('combat', '버프'), id('combat', '공격력 강화')],
        '안면강타': [id('combat', '중첩 획득')],
        '감사합니다 친구야': [id('combat', '받는 피해 감소'), id('combat', '보호막 부여')],
        'KICK BACK': [id('combat', '치명타 피해 증가')],
        '54버스트': [id('combat', '치명타 확정')],
        '처형박수': [id('combat', '받는 피해 증가')],
        '핫식스의정력': [id('combat', '보호막 부여')],
        '이어브피': [id('combat', '보호막 부여')],
        '댄져': [id('combat', '방어 관통 강화')],
        '수나타 소환': [id('summon', '수나타 강화')],
        '나인 멘스 모리스': [id('combat', '중첩 소모')],
        '유서새김': [id('combat', '표식 부여'), id('combat', '방어력 감소')],
        '범인은 이 안에': [id('combat', '자해'), id('combat', '방어 관통 강화'), id('combat', '버프')],
        '빙결': [id('combat', '빙결')],
        '피의 맛': [id('combat', '생명력 흡수')],
        '가속': [id('combat', '행동 가속')],
        '카운터': [id('combat', '카운터')],
        '000': [id('combat', '고정 피해')],
        '갈취': [id('combat', '골드 획득')],
        '카르마': [id('combat', '중첩 소모')],
        '자폭': [id('combat', '소환 해제')]
    });

    // 스킬 원본 설명 기준: 공격 연출은 대상, 자기 강화/회복 연출은 시전자에게 배치한다.
    const SKILL_TARGETS = Object.freeze({
        '자인': 'both', '시벌론': 'actor', '글버지': 'both', '불사조': 'both', '피아스트': 'both',
        '수업끝': 'both', 'SUPER EASY': 'target', '백억이요': 'target', '건력': 'actor', '청정수 투척': 'target',
        '비리': 'target', '익테봇 소환': 'actor', '유드 알레프': 'both', '안면강타': 'both',
        '감사합니다 친구야': 'both', 'KICK BACK': 'target', '54버스트': 'target', '처형박수': 'both',
        '핫식스의정력': 'both', '이어브피': 'both', '댄져': 'target', '끝판왕': 'target',
        '초특급한탕': 'target', '수나타 소환': 'actor', '나인 멘스 모리스': 'both',
        '포커 못 하시네': 'target', '유서새김': 'target', '범인은 이 안에': 'actor', '빅뱅': 'target',
        '정권': 'target', '빙결': 'target', '피의 맛': 'both', '가속': 'actor', '카운터': 'actor',
        '000': 'target', '럭키펀치': 'target', '갈취': 'target', '카르마': 'target', '자폭': 'actor'
    });
    const ACTOR_COMBAT_EFFECTS = new Set([
        '버프', '공격력 강화', '행동 가속', '보호막 부여', 'HP 회복', 'MP 회복', '생명력 흡수',
        '받는 피해 감소', '받는 피해 증가', '치명타 확률 증가', '치명타 피해 증가', '치명타 확정',
        '방어 관통 강화', '속성 강화', '속성 저항', '쿨타임 감소', 'HP 봉인', 'MP 소모',
        '카운터', '무적', '방어', '상태 해제', '중첩 획득', '중첩 소모', '골드 획득', '소환 해제', '자해'
    ]);

    function sourceEffects(source) {
        const name = String(source || '').trim();
        if (!name) return [];
        if (/익테봇/.test(name)) return [id('summon', '익테봇 공격')];
        if (/수나타/.test(name)) return [id('summon', '수나타 공격')];
        if (/장송곡 폭발/.test(name)) return [id('set', '잿불의 장송곡'), id('combat', '장송곡 폭발')];
        if (/종말 화상 폭발/.test(name)) return [id('equipment', '종말을 걷는 장송곡'), id('combat', '화상 폭발')];
        if (/화상 폭발/.test(name)) return [id('equipment', '잿불 신발'), id('combat', '화상 폭발')];
        if (/겁화/.test(name)) return [id('equipment', '종말을 걷는 장송곡'), id('combat', '겁화 틱')];
        if (/화상/.test(name)) return [id('equipment', '잿불 모자'), id('combat', '화상 틱')];
        if (/그림자 공격/.test(name)) return [id('set', '검은 잔향'), id('combat', '그림자 공격')];
        if (/천공 폭발|심판 폭발/.test(name)) return [id('set', '천공의 심판'), id('combat', '천공 폭발')];
        if (/유서새김/.test(name)) return [id('skill', '유서새김'), id('combat', '표식 지속 피해')];
        if (/불굴/.test(name)) return [id('equipment', '불굴'), id('combat', 'HP 회복')];
        if (/가시 반사/.test(name)) return [id('equipment', '가시'), id('combat', '가시 반사')];
        return [];
    }

    function labelEffects(label) {
        const text = String(label || '').trim();
        if (!text) return [];
        if (/셀레스티아/.test(text)) return [id('equipment', '별빛의 축복'), id('combat', '고정 피해')];
        if (/000 추가 피해/.test(text)) return [id('equipment', '000 장비'), id('combat', '고정 피해')];
        if (/스킬 고정 피해/.test(text)) return [id('equipment', '데우스 엑스 마키나'), id('combat', '고정 피해')];
        if (/일회 고정 피해|고정 피해/.test(text)) return [id('combat', '고정 피해')];
        if (/치명 명속성 추가 피해/.test(text)) return [id('equipment', '천공의 모자'), id('element', '명'), id('combat', '속성 추가 피해')];
        if (/명속성 추가 피해/.test(text)) return [id('element', '명'), id('combat', '속성 추가 피해')];
        if (/비리의 맛/.test(text)) return [id('equipment', '비리의 맛'), id('element', '암'), id('combat', '추가 피해')];
        if (/심해 추가 피해/.test(text)) return [id('equipment', '심해의 모자'), id('element', '수'), id('combat', '추가 피해')];
        if (/프리즘 추가 공격/.test(text)) return [id('equipment', '레인보우 프리즘'), id('combat', '프리즘 추가 공격')];
        if (/심연 추가 공격/.test(text)) return [id('equipment', '심연'), id('combat', '추가 피해')];
        if (/속성 추가 피해/.test(text)) return [id('combat', '속성 추가 피해')];
        if (/중퇴 추가 피해/.test(text)) return [id('equipment', '왓 타임 이즈 잇 나우'), id('combat', '추가 피해')];
        if (/종말 화상 폭발/.test(text)) return [id('equipment', '종말을 걷는 장송곡'), id('combat', '화상 폭발')];
        if (/화상 폭발/.test(text)) return [id('equipment', '잿불 신발'), id('combat', '화상 폭발')];
        if (/징수의 총 처형/.test(text)) return [id('equipment', '징수의 총'), id('combat', '처형')];
        if (/보호막 흡수/.test(text)) return [id('combat', '보호막 흡수')];
        if (/익테봇 피해 대행/.test(text)) return [id('summon', '익테봇 피해대행')];
        if (/가시 반사/.test(text)) return [id('equipment', '가시'), id('combat', '가시 반사')];
        if (/장비 추가 피해|후속 추가 피해|일회 추가 피해|추가 피해/.test(text)) return [id('combat', '추가 피해')];
        return sourceEffects(text);
    }

    function skillEffects(skillName, text) {
        const name = String(skillName || '').trim();
        const values = [];
        if (name) add(values, id('skill', name));
        add(values, SKILL_RESULTS[name]);
        if (/상태 해제/.test(String(text || ''))) add(values, id('combat', '상태 해제'));
        return values;
    }

    function skillTarget(event) {
        const value = event || {};
        if (['actor', 'target', 'both'].includes(value.effectTarget)) return value.effectTarget;
        const name = String(value.skillName || value.source || '').trim();
        if (SKILL_TARGETS[name]) return SKILL_TARGETS[name];
        const hits = Array.isArray(value.hits) ? value.hits : [];
        const attacks = Number(value.damage || 0) > 0 || !!value.dodged || hits.some(hit => Number(hit && hit.damage || 0) > 0);
        const supports = Number(value.heal || value.mpRecovery || value.shield || 0) > 0
            || /보호막|회복|강화|증가|감소|가속|무적|카운터|버프/.test(String(value.text || value.message || ''));
        return attacks && supports ? 'both' : attacks ? 'target' : 'actor';
    }

    function isActorEffect(effectId, event) {
        const parsed = parseEffectId(effectId);
        if (!parsed) return false;
        if (parsed.kind == 'skill') return ['actor', 'both'].includes(skillTarget(event));
        if (parsed.kind == 'summon') return /강화|소환 해제/.test(parsed.name);
        return parsed.kind == 'combat' && ACTOR_COMBAT_EFFECTS.has(parsed.name);
    }

    function effectIdsFor(event, role, hit) {
        const value = event || {}, side = role == 'actor' ? 'actor' : 'target';
        const action = String(value.action || '');
        const source = value.skillName || value.source || '';
        const supplied = unique(hit && Array.isArray(hit.effectIds) && hit.effectIds.length ? hit.effectIds : value.effectIds);
        if (action != 'skill') return supplied;
        const target = skillTarget(value);
        if (side == 'actor') {
            if (target == 'target') return [];
            const values = skillEffects(source, value.text || value.message);
            supplied.forEach(effectId => { if (isActorEffect(effectId, value)) add(values, effectId); });
            return unique(values);
        }
        if (target == 'actor') return [];
        return supplied.filter(effectId => {
            const parsed = parseEffectId(effectId);
            return parsed && (parsed.kind == 'skill' || !isActorEffect(effectId, value));
        });
    }

    function presentationEffectIds(effectIds, limit) {
        const values = unique(effectIds);
        const maximum = Math.max(1, Number(limit || 2));
        const generic = /^(기본 공격|추가 피해|속성 추가 피해|버프|디버프)$/;
        return values.map((effectId, index) => {
            const parsed = parseEffectId(effectId) || { kind: '', name: '' };
            const score = parsed.kind == 'skill' ? 100
                : parsed.kind == 'summon' ? 94
                : parsed.kind == 'equipment' || parsed.kind == 'set' ? 88
                : parsed.kind == 'combat' ? (generic.test(parsed.name) ? 45 : 72)
                : parsed.kind == 'element' ? 54 : 0;
            return { effectId, index, score };
        }).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, maximum).map(entry => entry.effectId);
    }

    function eventEffectIds(event) {
        const value = event || {};
        const action = String(value.action || '');
        const source = value.skillName || value.source || '';
        const values = unique(value.effectIds);
        add(values, value.triggeredEffectIds);
        if (action == 'attack') add(values, id('combat', '기본 공격'));
        else if (action == 'skill') add(values, skillEffects(source, value.text || value.message));
        else if (action == 'summon' || action == 'dot' || action == 'tick') add(values, sourceEffects(source));
        else if (action == 'shield') {
            if (source) add(values, id('skill', source));
            add(values, id('combat', '보호막 부여'));
        } else if (action == 'heal') add(values, sourceEffects(value.text || source).concat(id('combat', 'HP 회복')));
        else if (action == 'defend') add(values, id('combat', '방어'));
        else if (action == 'consumable') {
            if (Number(value.recoveredHp || 0) > 0) add(values, id('combat', 'HP 회복'));
            if (Number(value.recoveredMp || 0) > 0) add(values, id('combat', 'MP 회복'));
        }
        if (value.dodged) add(values, id('combat', '회피'));
        if (Number(value.selfDamage || 0) > 0) add(values, id('combat', '자해'));
        if (Number(value.heal || 0) > 0 || Number(value.targetHeal || 0) > 0) add(values, id('combat', 'HP 회복'));
        if (Number(value.mpRecovery || 0) > 0) add(values, id('combat', 'MP 회복'));
        if (ELEMENTS.has(value.effectElement)) add(values, id('element', value.effectElement));
        return unique(values);
    }

    function hitEffectIds(event, hit, index, options) {
        const value = event || {}, component = hit || {}, opts = options || {};
        const action = String(value.action || '');
        const source = value.skillName || value.source || '';
        const values = unique(component.effectIds);
        add(values, value.triggeredEffectIds);
        if (component.type == 'absorbed') add(values, id('combat', '보호막 흡수'));
        else if (component.type == 'summonAbsorbed') add(values, id('summon', '익테봇 피해대행'));
        else if (action == 'skill') add(values, id('skill', source));
        else if (action == 'summon' || action == 'dot' || action == 'tick') add(values, sourceEffects(source));
        else add(values, id('combat', '기본 공격'));
        add(values, labelEffects(component.label));
        if (component.shieldBroken) add(values, id('combat', '보호막 파괴'));
        const inferredCombo = !opts.received && index > 0 && !component.label && !FIXED_MULTI_HIT_SKILLS.has(String(source));
        if (component.isComboHit || component.combo || inferredCombo) add(values, id('combat', '연격 추가타'));
        if (component.critical || component.isCritical) add(values, id('combat', '치명타'));
        if (component.destiny || component.isDestinyDamage) add(values, [id('equipment', '운명'), id('combat', '운명 피해')]);
        const element = opts.received ? value.receivedEffectElement : value.effectElement;
        if (ELEMENTS.has(element)) add(values, id('element', element));
        return unique(values);
    }

    function annotateEvent(event) {
        if (!event || typeof event != 'object') return event;
        if (event.action == 'skill') event.effectTarget = skillTarget(event);
        event.effectIds = eventEffectIds(event);
        if (Array.isArray(event.hits)) event.hits.forEach((hit, index) => { if (hit) hit.effectIds = hitEffectIds(event, hit, index); });
        if (Array.isArray(event.receivedHits)) event.receivedHits.forEach((hit, index) => { if (hit) hit.effectIds = hitEffectIds(event, hit, index, { received: true }); });
        if (Array.isArray(event.reflectedHits)) event.reflectedHits.forEach(hit => {
            if (hit) hit.effectIds = unique([].concat(hit.effectIds || [], id('equipment', '가시'), id('combat', '가시 반사')));
        });
        return event;
    }

    function parseEffectId(effectId) {
        const text = String(effectId || ''), separator = text.indexOf(':');
        if (separator <= 0) return null;
        const kind = text.slice(0, separator), name = text.slice(separator + 1).trim();
        return DIRS[kind] && name ? { kind, name, dir: DIRS[kind] } : null;
    }

    function assetPath(effectId) {
        const parsed = parseEffectId(effectId);
        return parsed ? '필드/이펙트/' + parsed.dir + '/' + parsed.name + '.png' : null;
    }

    function assetUrl(effectId) {
        const path = assetPath(effectId);
        return path ? '/rpg-ui?file=' + encodeURIComponent(path) : null;
    }

    function motionProfile(effectId) {
        const parsed = parseEffectId(effectId) || { kind: 'combat', name: '' };
        const aura = /회복|흡수|강화|감소|저항|버프|디버프|봉인|소모|가속|중첩|상태 해제|무적|방어$/.test(parsed.name);
        const heavy = /폭발|처형|자폭|천공|치명타|프리즘/.test(parsed.name);
        return {
            duration: heavy ? 620 : aura ? 720 : 540,
            size: parsed.kind == 'skill' ? .25 : parsed.kind == 'set' ? .23 : parsed.kind == 'equipment' ? .21 : aura ? .18 : .2,
            alpha: parsed.kind == 'skill' ? .58 : parsed.kind == 'set' ? .5 : parsed.kind == 'equipment' ? .48 : aura ? .44 : .52,
            aura,
            rotation: aura ? 0 : parsed.kind == 'element' ? .04 : -.02
        };
    }

    return {
        DIRS, SKILL_TARGETS, id, unique, sourceEffects, labelEffects, skillEffects, skillTarget,
        effectIdsFor, presentationEffectIds,
        eventEffectIds, hitEffectIds, annotateEvent, parseEffectId,
        assetPath, assetUrl, motionProfile
    };
});
