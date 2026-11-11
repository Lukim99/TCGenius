'use strict';

// 명시 실행 전용. 요청된 효과와 해당 설명만 변경하며 서버 시작에서는 호출하지 않는다.
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('node:util');
const PATCHES = [
    ['궁택토', '초월 단계당 스킬 공격력 +10%.', '초월 단계당 스킬 공격력 +10%, 쿨타임 감소 +5%.'],
    ['감옥열쇠', '치명타 확률이 100%를 초과할 경우 초과한 치명타 확률 1%당 스킬 피해량 +0.2%(단계당 +0.1%).', '치명타 확률은 최대 80%까지 적용되며, 초과하는 치명타 확률 1%당 스킬 피해량 +2%(단계당 +0.5%).'],
    ['범부의 대나무', '백억이요 사용 시 10초간', '백억이요 사용 시 120초간'],
    ['범부의 대나무', '7중첩 시 10초간 진정한 범부: 공격력 +30%(단계당 +5%)', '7중첩 시 전투 종료까지 진정한 범부: 공격력 +30%(단계당 +10%)'],
    ['교촌 주머니', '초월 단계당 스킬 쿨타임 -1%', '초월 단계당 스킬 쿨타임 감소 +4%'],
    ['정수 필터망', '6초간 수속성 공격력 +8%(단계당 +3%)', '15초간 수속성 공격 시 추가 피해 +15%(단계당 +5%, 중복 불가)'],
    ['흐음티콘', '지속 피해량 +40%(단계당 +15%)', '지속 피해량 +30%(단계당 +10%)'],
    ['검은 잔향 하의', 'HP 60% 이하에서 스킬 공격력 +10%(단계당 +3%)', 'HP 80% 이하에서 스킬 공격력 +10%(단계당 +5%)'],
    ['레인보우 프리즘', '합계 1000 이상이면 최종 피해 +15%(단계당 +5%)', '합계 1000 이상이면 최종 피해 +12%(단계당 +4%)']
];
const SET_PATCHES = [
    ['마나번', '4', '최종 공격력 +5%', '최종 공격력 +15%'],
    ['검은 잔향', '4', '쿨타임 12초', '쿨타임 4초'],
    ['천공의 심판', '4', '가한 피해량의 15%', '가한 피해량의 5%'],
    ['심해의 순환', '4', '궁극기 쿨타임 3초 감소(쿨타임 12초).', '궁극기 쿨타임 3초 감소(쿨타임 4초), 수속성 강화 +150.'],
    ['TCG의 유산', '2', '치명타 확률 +5%', '치명타 확률 +10%']
];
function replaceRequested(text, before, after, name) {
    if (typeof text !== 'string') throw Error('설명 확인 필요: ' + name);
    if (text.includes(after)) return text;
    if (!text.includes(before)) throw Error('운영 설명이 감사 시점과 다릅니다: ' + name);
    return text.replace(before, after);
}
function patchEquipment(before) {
    const after = structuredClone(before);
    const items = Object.values(after).flat().filter(item => item && typeof item === 'object');
    const find = name => {
        const matches = items.filter(item => item.name === name);
        if (matches.length !== 1) throw Error('운영 장비 확인 필요: ' + name);
        return matches[0];
    };
    for (const [name, oldText, newText] of PATCHES) {
        const item = find(name);
        item.desc = replaceRequested(item.desc, oldText, newText, name);
    }
    for (const [name, text] of [
        ['무한홀덤덱', '일반 공격 피해량 +15%(단계당 +3%).'],
        ['존버의 미학', '10초간 스킬을 사용하지 않으면 일반 공격 피해량 +20%.']
    ]) {
        const item = find(name);
        if (!item.desc.includes(text)) item.desc = text + ' ' + item.desc;
    }
    for (const [name, key, value] of [['궁택토', 'cooldown', .05], ['무한홀덤덱', 'afterBasic', .15]]) {
        const item = find(name);
        if (!item.plusStat || item.plusStat[key] != null && item.plusStat[key] !== value) throw Error('운영 스탯 확인 필요: ' + name + '.' + key);
        item.plusStat[key] = value;
    }
    for (const [name, count, oldText, newText] of SET_PATCHES) {
        const matches = items.filter(item => item.set === name);
        if (!matches.length) throw Error('운영 세트 확인 필요: ' + name);
        for (const item of matches) {
            item.setEffects[count] = replaceRequested(item.setEffects?.[count], oldText, newText, item.name);
            if (name === 'TCG의 유산') item.setEffects[count] = item.setEffects[count].replace('장비(TCG의 유산 한정) 효과', '장비 효과');
        }
    }
    return after;
}
async function main() {
    const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
    const { DynamoDBDocumentClient, GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
    const db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'ap-northeast-2', credentials: { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_KEY_ID } }));
    const read = async () => (await db.send(new GetCommand({ TableName: 'rpgenius_data', Key: { key: 'Equipment' }, ConsistentRead: true }))).Item?.data;
    const before = await read(), after = patchEquipment(before);
    const changes = [];
    for (const [slot, entries] of Object.entries(before)) if (Array.isArray(entries)) entries.forEach((item, index) => {
        if (!isDeepStrictEqual(item, after[slot][index])) changes.push({ slot, index, name: item.name, before: { desc: item.desc, plusStat: item.plusStat, setEffects: item.setEffects }, after: { desc: after[slot][index].desc, plusStat: after[slot][index].plusStat, setEffects: after[slot][index].setEffects } });
    });
    console.log(JSON.stringify({ count: changes.length, changes }, null, 2));
    if (!process.argv.includes('--apply') || !changes.length) return;
    const backup = path.join(__dirname, '..', 'output', 'november-balance', 'before-' + Date.now() + '.json');
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.writeFileSync(backup, JSON.stringify(before, null, 2), { flag: 'wx' });
    await db.send(new UpdateCommand({ TableName: 'rpgenius_data', Key: { key: 'Equipment' }, UpdateExpression: 'SET #data = :after', ConditionExpression: '#data = :before', ExpressionAttributeNames: { '#data': 'data' }, ExpressionAttributeValues: { ':after': after, ':before': before } }));
    if (!isDeepStrictEqual(await read(), after)) throw Error('운영 장비 변경 후 검증 불일치');
    console.log('요청 장비 변경 및 읽기 검증 완료. 백업: ' + backup);
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { patchEquipment, PATCHES, SET_PATCHES };
