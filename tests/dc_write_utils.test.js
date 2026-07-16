const assert = require('assert');
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const {
    buildDcHyperlinkMemo,
    buildDcOgLinkMemo,
    collectDcFormFields,
    escapeDcHtml,
    extractDcPostNo,
    findDcPostInList,
    getDcFailureMessage,
    isDcWriteSuccess,
    normalizeDcExternalUrl,
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

const xPostUrl = 'https://x.com/thsottiaux/status/2077775690058125383';
const xImageUrl = 'https://play-lh.googleusercontent.com/x-icon.png';
const ogMemo = buildDcOgLinkMemo(xPostUrl, {
    result: true,
    image: xImageUrl,
    title: 'Tibo님(@thsottiaux)',
    description: 'How do you pronounce Sol '
});
assert.strictEqual(
    ogMemo,
    `<div class="og-href">${xPostUrl}</div>`
        + `<div class="og">{{_OG_START::${xPostUrl}^#^Tibo님(@thsottiaux)^#^How do you pronounce Sol^#^${xImageUrl}::OG_END_}}</div>`
        + '<p><br></p>'
);
assert.strictEqual(
    buildDcOgLinkMemo(xPostUrl, { result: false }),
    `<p><a class="lnk" href="${xPostUrl}" target="_blank">${xPostUrl}</a></p><p><br></p>`
);
assert.strictEqual(
    buildDcOgLinkMemo(xPostUrl, { result: true, image: 'javascript:alert(1)' }),
    buildDcHyperlinkMemo(xPostUrl)
);
const escapedOgMemo = buildDcOgLinkMemo(xPostUrl, {
    result: true,
    image: xImageUrl,
    title: '<b>제목</b>^#^추가',
    description: '"설명" {{_OG_START::삽입'
});
assert.ok(escapedOgMemo.includes('&lt;b&gt;제목&lt;/b&gt; 추가'));
assert.ok(escapedOgMemo.includes('&quot;설명&quot; 삽입'));
assert.strictEqual((escapedOgMemo.match(/\^#\^/g) || []).length, 3, 'OG 구분자는 정확히 세 개여야 한다.');
assert.strictEqual(escapeDcHtml('<a "x">'), '&lt;a &quot;x&quot;&gt;');
assert.strictEqual(normalizeDcExternalUrl(xPostUrl), xPostUrl);
assert.throws(() => normalizeDcExternalUrl('javascript:alert(1)'), /허용되지 않은/);

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
const ogIndex = writeSource.indexOf('/api/oglink');
const accessIndex = writeSource.indexOf('/ajax/access');
const filterIndex = writeSource.indexOf('/ajax/w_filter');
const submitIndex = writeSource.indexOf('axios.post(action, multipart');

assert.ok(writeStart >= 0 && writeEnd > writeStart, 'doDcWritePost 함수 범위를 찾을 수 있어야 한다.');
assert.ok(ogIndex >= 0 && accessIndex > ogIndex, 'OG 메타데이터는 access 검증 전에 편집기와 같은 순서로 조회해야 한다.');
assert.ok(accessIndex >= 0 && filterIndex > accessIndex && submitIndex > filterIndex, 'access → w_filter → multipart 제출 순서를 유지해야 한다.');
assert.ok(writeSource.includes('finally {'));
assert.ok(writeSource.includes('agent.destroy()'), '예외가 발생해도 프록시 에이전트를 정리해야 한다.');

console.log('dc_write_utils.test.js: OK');
