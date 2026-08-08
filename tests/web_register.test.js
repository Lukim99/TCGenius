const assert = require('assert');
const fs = require('fs');
const path = require('path');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=]+)=(.*)$/);
    if (match) process.env[match[1].trim()] = match[2].trim();
}

const rpg = require('../rpgenius');

// ponytail: 검증 실패(read-only) 경로만 검사. 성공 경로는 실제 유저를 생성하므로 테스트하지 않는다.
(async () => {
    let r = await rpg.webRegisterRPGUser('닉네임!@#', 'test-ua');
    assert.strictEqual(r.error, '닉네임은 한글, 영어, 숫자 및 공백만 들어갈 수 있습니다.');

    r = await rpg.webRegisterRPGUser('', 'test-ua');
    assert.strictEqual(r.error, '닉네임은 한글, 영어, 숫자 및 공백만 들어갈 수 있습니다.');

    r = await rpg.webRegisterRPGUser('가나다라마바사아자차카', 'test-ua');
    assert.strictEqual(r.error, '닉네임은 최대 10글자로 설정하셔야 합니다.');

    console.log('web_register.test.js OK');
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
