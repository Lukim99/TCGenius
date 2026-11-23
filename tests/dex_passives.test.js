'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { describe, stageText } = require('../public/dex-passives');
const equipment = require('../DB/RPGenius/Equipment.json');

test('조건에 딸린 효과와 불이익을 함께 표시하고 지속시간을 그 묶음에 둔다', () => {
    const { blocks } = describe('불사조 사용 시 8초간 치명타 확률 +10%, 불사조 피해량 +30%, 받는 피해 +50%.');
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].when, '불사조 사용 시');
    assert.deepEqual(blocks[0].lines, ['치명타 확률 +10%, 불사조 피해량 +30%, 받는 피해 +50%.']);
    assert.deepEqual(blocks[0].meta, [{ label: '지속', value: '8초' }]);
});

test('발동 확률과 재사용 시간은 다른 조건의 효과에 섞이지 않는다', () => {
    const { blocks } = describe('공격 시 25% 확률로 추가 공격. (쿨타임 5초) 피격 시 HP 2% 회복(쿨타임 10초).');
    assert.equal(blocks[0].when, '공격 시');
    assert.deepEqual(blocks[0].meta, [{ label: '발동 확률', value: '25%' }, { label: '재사용', value: '5초' }]);
    assert.equal(blocks[1].when, '피격 시');
    assert.deepEqual(blocks[1].meta, [{ label: '재사용', value: '10초' }]);
    assert.deepEqual(describe('공격 시 추가 피해(쿨타임 60초).', 60000).shared, []);
});

test('재사용 시간 설명과 효과로서의 쿨타임 감소를 구분한다', () => {
    const { blocks } = describe('스킬 적중 시 해당 스킬의 남은 쿨타임 8%, 최대 5초 감소. 쿨타임 8초. 발동 시 최대 MP의 3% 회복.');
    assert.ok(blocks[0].lines[0].includes('남은 쿨타임 8%, 최대 5초 감소'));
    assert.deepEqual(blocks[0].meta, [{ label: '재사용', value: '8초' }]);
    assert.equal(blocks[1].when, '발동 시');
    assert.deepEqual(blocks[1].meta, []);
});

test('분기, 중첩 제한, 자원 소모와 이후의 회복 설명을 보존한다', () => {
    const text = '공격 시 MP 2%를 소모해 60초간 모든 속성 강화 +60. 이후 체력 20% 회복. 앞면(50%): 수속성 강화 +250. 뒷면(50%): 치명타 확률 +20%.';
    const { blocks } = describe(text);
    assert.equal(blocks[0].when, '공격 시');
    assert.equal(blocks[0].lines.length, 2);
    assert.ok(blocks[0].lines[0].includes('MP 2%를 소모해 60초간'));
    assert.ok(blocks[1].lines[0].startsWith('앞면(50%)'));
    assert.ok(blocks[2].lines[0].startsWith('뒷면(50%)'));
});

test('알 수 없는 설명에 임의의 발동 조건을 붙이지 않는다', () => {
    const { blocks } = describe('저체력 추가 강화. 공격 순서를 확인할 수 있음.');
    assert.ok(blocks.every(block => block.when === ''));
    assert.deepEqual(blocks.flatMap(block => block.lines), ['저체력 추가 강화.', '공격 순서를 확인할 수 있음.']);
});

test('초월 단계는 선택한 수치만 표시하고 중복 불가 같은 제한은 남긴다', () => {
    const text = '추가 피해 +15%(단계당 +5%, 중복 불가). MP 0.5%(단계당 +0.5%) 회복. 공격력 +777(+77).';
    assert.equal(stageText(text, 1), '추가 피해 +15% (중복 불가). MP 0.5% 회복. 공격력 +777.');
    assert.equal(stageText(text, 3), '추가 피해 +25% (중복 불가). MP 1.5% 회복. 공격력 +931.');
});

test('문장형 초월 증가량도 같은 단계 선택에 반영한다', () => {
    const text = '명속성 공격의 최종 피해가 10% 증가합니다. 초월 단계마다 5%p 추가로 증가합니다.';
    assert.equal(stageText(text, 3), '명속성 공격의 최종 피해가 20% 증가합니다.');
    const ambiguous = 'HP 20% 이하에서 피해가 10% 증가합니다. 초월 단계마다 5%p 증가합니다.';
    assert.equal(stageText(ambiguous, 3), ambiguous, '증가 대상이 불명확하면 원문을 유지한다');
});

test('기존 장비 설명 전체에서 표시 변환으로 수치가 빠지거나 추가되지 않는다', () => {
    const numbers = text => (text.match(/\d+(?:\.\d+)?/g) || []).sort();
    for (const entry of Object.values(equipment).flat().filter(entry => entry?.passive_id != null)) {
        const text = stageText(entry.desc, 2);
        const { blocks } = describe(text);
        const displayed = blocks.map(block => [block.when, ...block.lines, ...block.meta.map(row => row.value)].join(' ')).join(' ');
        assert.deepEqual(numbers(displayed), numbers(text), entry.name);
    }
});
