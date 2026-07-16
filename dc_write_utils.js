function collectDcFormFields($, $form) {
    const fields = [];

    $form.find('input[name], textarea[name], select[name]').each((i, element) => {
        const $element = $(element);
        const name = $element.attr('name');
        const tagName = element.tagName.toLowerCase();

        if (!name || ($element.is('[disabled]') && name !== 'name')) return;

        if (tagName === 'input') {
            const type = ($element.attr('type') || 'text').toLowerCase();
            if (['button', 'file', 'image', 'reset', 'submit'].includes(type)) return;
            if (['checkbox', 'radio'].includes(type) && !$element.is('[checked]')) return;

            let value = $element.attr('value');
            if (value === undefined) value = ['checkbox', 'radio'].includes(type) ? 'on' : '';
            fields.push([name, value]);
            return;
        }

        if (tagName === 'textarea') {
            fields.push([name, $element.text()]);
            return;
        }

        const isMultiple = $element.is('[multiple]');
        let $options = $element.find('option').filter((j, option) => !$(option).is('[disabled]'));
        let $selected = $options.filter('[selected]');
        if (!$selected.length && !isMultiple && $options.length) $selected = $options.first();

        $selected.each((j, option) => {
            const $option = $(option);
            fields.push([name, $option.attr('value') ?? $option.text()]);
        });
    });

    return fields;
}

function parseDcResponseData(data) {
    if (typeof data !== 'string') return data;

    const trimmed = data.trim();
    if (!trimmed) return '';

    try {
        return JSON.parse(trimmed);
    } catch (error) {
        return data;
    }
}

function resolveDcFormAction(action, baseUrl) {
    const resolved = new URL(action || baseUrl, baseUrl);
    if (resolved.protocol !== 'https:' || !/(^|\.)dcinside\.com$/i.test(resolved.hostname)) {
        throw new Error('허용되지 않은 글쓰기 폼 action입니다.');
    }
    return resolved.toString();
}

function extractDcPostNo(data, location = '') {
    const parsed = parseDcResponseData(data);
    const candidates = [
        parsed?.no,
        parsed?.postNo,
        typeof parsed?.data === 'object' ? parsed?.data?.no : parsed?.data
    ];

    for (const candidate of candidates) {
        if (/^\d+$/.test(String(candidate ?? ''))) return String(candidate);
    }

    for (const rawValue of [location, typeof data === 'string' ? data : '']) {
        const value = rawValue.replace(/\\\//g, '/').replace(/&amp;/g, '&');
        if (!value) continue;

        try {
            const url = new URL(value, 'https://m.dcinside.com');
            const queryNo = url.searchParams.get('no');
            if (/^\d+$/.test(queryNo || '')) return queryNo;

            const pathMatch = url.pathname.match(/\/(\d+)\/?$/);
            if (pathMatch) return pathMatch[1];
        } catch (error) {
            // 응답 HTML/스크립트는 아래 정규식으로 확인한다.
        }

        const queryMatch = value.match(/[?&]no=(\d+)/);
        if (queryMatch) return queryMatch[1];

        const pathMatch = value.match(/\/board\/[^\s"']+\/(\d+)(?:[?\s"']|$)/);
        if (pathMatch) return pathMatch[1];
    }

    return null;
}

function findDcPostInList($, title, accountId) {
    let found = null;

    $('li').each((i, element) => {
        if (found) return;

        const $row = $(element);
        const rowTitle = $row.find('.subjectin').first().text().trim();
        const rowAccountId = $row.find('.blockInfo').first().attr('data-info');
        if (rowTitle !== title || rowAccountId !== accountId) return;

        const href = $row.find('a[href*="/board/"]').first().attr('href') || '';
        const postNo = extractDcPostNo(null, href);
        if (postNo) found = { postNo, href };
    });

    return found;
}

function isDcWriteSuccess(data, location = '') {
    if (extractDcPostNo(data, location)) return true;

    const parsed = parseDcResponseData(data);
    if (parsed === true || parsed === 'true' || parsed === 'success') return true;
    if (!parsed || typeof parsed !== 'object') return false;

    return parsed.success === true
        || parsed.result === true
        || parsed.result === 'true'
        || parsed.result === 'success'
        || parsed.cause === 'success';
}

function getDcFailureMessage(data, fallback = '작성 실패') {
    const parsed = parseDcResponseData(data);
    if (parsed && typeof parsed === 'object') {
        return parsed.cause || parsed.message || parsed.msg || fallback;
    }
    if (typeof parsed === 'string' && parsed.length <= 200 && !/<[^>]+>/.test(parsed)) {
        return parsed || fallback;
    }
    return fallback;
}

module.exports = {
    collectDcFormFields,
    extractDcPostNo,
    findDcPostInList,
    getDcFailureMessage,
    isDcWriteSuccess,
    parseDcResponseData,
    resolveDcFormAction
};
