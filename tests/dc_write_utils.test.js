const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const {
    collectDcFormFields,
    extractDcPostNo,
    findDcPostInList,
    getDcFailureMessage,
    isDcWriteSuccess,
    parseDcResponseData,
    resolveDcFormAction
} = require('../dc_write_utils');

const $ = cheerio.load(`
    <form id="writeForm" action="https://mupload.dcinside.com/write_new.php" method="post" enctype="multipart/form-data">
        <input name="name" value="고정닉" disabled>
        <input name="subject" value="기존 제목">
        <textarea name="memo">기존 본문</textarea>
        <input name="id" value="tree" type="hidden">
        <input name="files" type="file">
        <input name="disabled_field" value="제외" disabled>
        <input name="add_watermark" type="checkbox" value="on">
        <input name="notice" type="checkbox" value="1" checked>
        <input name="kind" type="radio" value="a">
        <input name="kind" type="radio" value="b" checked>
        <select name="headtext">
            <option value="">선택</option>
            <option value="notice" selected>공지</option>
        </select>
        <select name="tags" multiple>
            <option value="one" selected>하나</option>
            <option value="two" selected>둘</option>
        </select>
        <input class="hide-robot" name="honey_test" value="1">
        <button name="submit_button" type="submit" value="submit">등록</button>
    </form>
`);

const fields = collectDcFormFields($, $('#writeForm'));
const params = new URLSearchParams(fields);

assert.strictEqual(params.get('name'), '고정닉', '페이지 스크립트가 제출 직전에 활성화하는 name은 포함해야 한다.');
assert.strictEqual(params.get('subject'), '기존 제목');
assert.strictEqual(params.get('memo'), '기존 본문');
assert.strictEqual(params.get('id'), 'tree');
assert.strictEqual(params.get('notice'), '1');
assert.strictEqual(params.get('kind'), 'b');
assert.strictEqual(params.get('headtext'), 'notice');
assert.deepStrictEqual(params.getAll('tags'), ['one', 'two']);
assert.strictEqual(params.get('honey_test'), '1');
assert.strictEqual(params.has('files'), false, '파일 입력은 문자열 폼 필드로 보내면 안 된다.');
assert.strictEqual(params.has('disabled_field'), false);
assert.strictEqual(params.has('add_watermark'), false, '선택하지 않은 체크박스는 제출하면 안 된다.');
assert.strictEqual(params.has('submit_button'), false);

assert.strictEqual(
    resolveDcFormAction('https://mupload.dcinside.com/write_new.php', 'https://m.dcinside.com/write/tree'),
    'https://mupload.dcinside.com/write_new.php'
);
assert.strictEqual(
    resolveDcFormAction('/ajax/w_write', 'https://m.dcinside.com/write/tree'),
    'https://m.dcinside.com/ajax/w_write'
);
assert.throws(
    () => resolveDcFormAction('https://example.com/write', 'https://m.dcinside.com/write/tree'),
    /허용되지 않은/
);
assert.throws(
    () => resolveDcFormAction('http://m.dcinside.com/write', 'https://m.dcinside.com/write/tree'),
    /허용되지 않은/
);

assert.deepStrictEqual(parseDcResponseData('{"result":true,"no":123}'), { result: true, no: 123 });
assert.strictEqual(parseDcResponseData('plain response'), 'plain response');
assert.strictEqual(extractDcPostNo({ data: { no: 12345 } }), '12345');
assert.strictEqual(extractDcPostNo(null, '/board/tree/67890'), '67890');
assert.strictEqual(extractDcPostNo(null, '/board/view/?id=tree&no=24680'), '24680');
assert.strictEqual(extractDcPostNo('<script>location.href="/board/tree/13579"</script>'), '13579');
assert.strictEqual(extractDcPostNo('<script>location.href="https:\\/\\/m.dcinside.com\\/board\\/tree\\/97531"</script>'), '97531');
assert.strictEqual(isDcWriteSuccess('{"result":"success","no":"123"}'), true);
assert.strictEqual(isDcWriteSuccess({ result: false, cause: '차단됨' }), false);
assert.strictEqual(getDcFailureMessage({ result: false, cause: '차단됨' }), '차단됨');
assert.strictEqual(getDcFailureMessage('<html>오류</html>'), '작성 실패');

const listPage = cheerio.load(`
    <ul>
        <li>
            <div class="gall-detail-lnktb">
                <a href="https://m.dcinside.com/board/thesingularity/1323631" class="lt">
                    <span class="subjectin">안녕하세요</span>
                </a>
            </div>
            <span class="blockInfo" data-info="shelf7467"></span>
        </li>
    </ul>
`);
assert.deepStrictEqual(findDcPostInList(listPage, '안녕하세요', 'shelf7467'), {
    postNo: '1323631',
    href: 'https://m.dcinside.com/board/thesingularity/1323631'
});

const engineSource = fs.readFileSync(path.join(__dirname, '..', 'new_engine.js'), 'utf8');
const writeStart = engineSource.indexOf('async function doDcWritePost');
const writeEnd = engineSource.indexOf('\nfunction get_captcha_key', writeStart);
const writeSource = engineSource.slice(writeStart, writeEnd);
const accessIndex = writeSource.indexOf('/ajax/access');
const filterIndex = writeSource.indexOf('/ajax/w_filter');
const submitIndex = writeSource.indexOf('axios.post(action, multipart');

assert.ok(writeStart >= 0 && writeEnd > writeStart, 'doDcWritePost 함수 범위를 찾을 수 있어야 한다.');
assert.ok(accessIndex >= 0 && filterIndex > accessIndex && submitIndex > filterIndex, 'access → w_filter → multipart 제출 순서를 유지해야 한다.');
assert.ok(writeSource.includes('finally {'));
assert.ok(writeSource.includes('agent.destroy()'), '예외가 발생해도 프록시 에이전트를 정리해야 한다.');

console.log('dc_write_utils.test.js: OK');
