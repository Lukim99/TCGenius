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

function escapeDcHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function normalizeDcExternalUrl(value) {
    const url = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error('허용되지 않은 외부 링크입니다.');
    }
    const normalized = url.toString();
    if (/\^#\^|\{\{_OG_START::|::OG_END_\}\}/.test(normalized)) {
        throw new Error('허용되지 않은 외부 링크입니다.');
    }
    return normalized;
}

function sanitizeDcOgText(value, fallback) {
    const text = String(value || fallback || '')
        .replace(/\^#\^/g, ' ')
        .replace(/\{\{_OG_START::|::OG_END_\}\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return escapeDcHtml(text);
}

function buildDcHyperlinkMemo(value) {
    const url = normalizeDcExternalUrl(value);
    const escapedUrl = escapeDcHtml(url);
    return `<p><a class="lnk" href="${escapedUrl}" target="_blank">${escapedUrl}</a></p><p><br></p>`;
}

// 모바일 편집기의 copy_textarea()가 서버에 제출하는 공식 OG 직렬화 형식.
// 서버가 og-href와 _OG_START 토큰을 최종 하이퍼링크/OG 카드 HTML로 변환한다.
function buildDcOgLinkMemo(value, metadata = {}) {
    const url = normalizeDcExternalUrl(value);
    if (!metadata || ![true, 'true'].includes(metadata.result)) {
        return buildDcHyperlinkMemo(url);
    }

    let imageUrl;
    try {
        imageUrl = normalizeDcExternalUrl(metadata.image);
    } catch (error) {
        return buildDcHyperlinkMemo(url);
    }

    const title = sanitizeDcOgText(metadata.title, 'X 게시물');
    const description = sanitizeDcOgText(metadata.description, 'X에서 게시물 보기');
    const escapedUrl = escapeDcHtml(url);
    return `<div class="og-href">${escapedUrl}</div>`
        + `<div class="og">{{_OG_START::${url}^#^${title}^#^${description}^#^${imageUrl}::OG_END_}}</div>`
        + '<p><br></p>';
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

function normalizeDcVerificationTitle(value) {
    let normalized = '';
    for (const char of String(value || '')) {
        normalized += char.codePointAt(0) > 0xFFFF ? '?' : char;
    }
    return normalized.replace(/\s+/g, ' ').trim();
}

function findDcPostsInList($, title, accountId) {
    const found = [];
    const expectedTitle = title == null ? null : normalizeDcVerificationTitle(title);

    $('li').each((i, element) => {
        const $row = $(element);
        const rowTitle = $row.find('.subjectin').first().text().trim();
        const rowAccountId = $row.find('.blockInfo').first().attr('data-info');
        if (accountId && rowAccountId !== accountId) return;
        if (expectedTitle !== null && normalizeDcVerificationTitle(rowTitle) !== expectedTitle) return;

        const href = $row.find('a[href*="/board/"]').first().attr('href') || '';
        const postNo = extractDcPostNo(null, href);
        if (postNo) found.push({ postNo, href, title: rowTitle, accountId: rowAccountId });
    });

    return found;
}

function findDcPostInList($, title, accountId) {
    const post = findDcPostsInList($, title, accountId)[0];
    return post ? { postNo: post.postNo, href: post.href } : null;
}

function collectDcPostNosInList($) {
    const postNos = new Set();
    $('a[href*="/board/"]').each((i, element) => {
        const postNo = extractDcPostNo(null, $(element).attr('href') || '');
        if (postNo) postNos.add(postNo);
    });
    return [...postNos];
}

function hasDcExternalLink($, expectedUrl) {
    let expected;
    try {
        const url = new URL(normalizeDcExternalUrl(expectedUrl));
        expected = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}`;
    } catch (error) {
        return false;
    }

    let found = false;
    $('a[href]').each((i, element) => {
        if (found) return;
        try {
            const url = new URL($(element).attr('href'), 'https://m.dcinside.com');
            const comparable = `${url.protocol}//${url.hostname.toLowerCase()}${url.pathname.replace(/\/$/, '')}`;
            if (comparable === expected) found = true;
        } catch (error) {
            // 잘못된 링크는 무시한다.
        }
    });
    return found;
}

function parseDcCommentSubmitResponse(data) {
    if (data && typeof data === 'object') {
        const failed = data.result === false || data.result === 0 || data.result === '0' || data.result === 'false';
        if (failed) {
            const message = String(data.cause || data.message || data.msg || '댓글 작성 실패').trim();
            return { success: false, code: message, message };
        }
        if (Object.prototype.hasOwnProperty.call(data, 'result')) return { success: true };
    }

    const text = String(data ?? '').trim();
    const parts = text.split('||');
    if (parts[0].trim().toLowerCase() === 'false') {
        const code = (parts[1] || '').trim();
        const message = (code === 'nomember' ? parts[2] : parts[1]) || '댓글 작성 실패';
        return { success: false, code, message: String(message).trim() };
    }

    return { success: true };
}

function collectDcCommentNos(comments) {
    if (!Array.isArray(comments)) return [];
    return comments
        .map(comment => String(comment?.no ?? comment?.commentNo ?? ''))
        .filter(no => /^\d+$/.test(no) && no !== '0');
}

function findNewDcComment(comments, content, accountId, previousCommentNos = []) {
    if (!Array.isArray(comments)) return null;
    const previous = new Set([...previousCommentNos].map(String));
    const expectedContent = String(content ?? '').replace(/\r\n/g, '\n').trim();

    for (const comment of comments) {
        const commentNo = String(comment?.no ?? comment?.commentNo ?? '');
        const commentContent = String(comment?.memo ?? comment?.content ?? '').replace(/\r\n/g, '\n').trim();
        const commentAccountId = String(comment?.user_id ?? comment?.accountId ?? '');
        if (!/^\d+$/.test(commentNo) || commentNo === '0' || previous.has(commentNo)) continue;
        if (commentContent !== expectedContent) continue;
        if (accountId && commentAccountId !== accountId) continue;
        return { commentNo, content: commentContent, accountId: commentAccountId };
    }

    return null;
}

function extractDcPostNosForGallery(values, galleryId) {
    const expectedGalleryId = String(galleryId || '').trim().toLowerCase();
    if (!expectedGalleryId) return [];

    const postNos = new Set();
    for (const value of Array.isArray(values) ? values : [values]) {
        const text = String(value || '').replace(/&amp;/gi, '&');
        const candidates = text.match(/https?:\/\/[^\s<>"'`]+/gi) || [];

        for (const candidate of candidates) {
            const normalized = candidate.replace(/[\])}>.,!?;:。！？]+$/g, '');
            try {
                const url = new URL(normalized);
                if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) continue;

                const hostname = url.hostname.toLowerCase();
                let linkedGalleryId = '';
                let postNo = '';
                if (hostname === 'm.dcinside.com') {
                    const match = url.pathname.match(/^\/board\/([^/]+)\/([1-9]\d*)\/?$/i);
                    if (!match) continue;
                    linkedGalleryId = decodeURIComponent(match[1]).toLowerCase();
                    postNo = match[2];
                } else if (hostname === 'gall.dcinside.com') {
                    if (!/^\/(?:mgallery\/)?board\/view\/?$/i.test(url.pathname)) continue;
                    linkedGalleryId = String(url.searchParams.get('id') || '').toLowerCase();
                    postNo = String(url.searchParams.get('no') || '');
                } else {
                    continue;
                }

                if (linkedGalleryId === expectedGalleryId && /^[1-9]\d*$/.test(postNo)) {
                    postNos.add(postNo);
                }
            } catch (error) {
                // URL로 해석할 수 없는 텍스트는 무시한다.
            }
        }
    }

    return [...postNos];
}

function parseDcMobileComments($) {
    const comments = [];
    let parentCommentNo = null;

    $('li.comment[no], li.comment-add[no]').each((index, element) => {
        const $comment = $(element);
        const commentNo = String($comment.attr('no') || '');
        if (!/^\d+$/.test(commentNo)) return;

        const isReply = $comment.hasClass('comment-add');
        if (!isReply) parentCommentNo = commentNo;
        const $content = $comment.find('p.txt').first();
        const links = [];
        $content.find('a[href]').each((linkIndex, link) => {
            const href = String($(link).attr('href') || '').trim();
            if (href && !links.includes(href)) links.push(href);
        });
        comments.push({
            commentNo,
            memberNo: String($comment.attr('m_no') || '0'),
            accountId: String($comment.find('.blockCommentId').first().attr('data-info') || ''),
            content: $content.text().replace(/\r\n/g, '\n').trim(),
            links,
            isReply,
            parentCommentNo: isReply ? parentCommentNo : null
        });
    });

    return comments;
}

function isDcWriteSuccess(data, location = '') {
    if (extractDcPostNo(data, location)) return true;

    const parsed = parseDcResponseData(data);
    if (parsed === true || parsed === 'true' || parsed === 'success') return true;
    if (typeof parsed === 'string') {
        const metaTags = parsed.match(/<meta\b[^>]*>/gi) || [];
        for (const tag of metaTags) {
            if (!/\bhttp-equiv\s*=\s*(?:["']\s*)?refresh\b/i.test(tag)) continue;

            const quotedContent = tag.match(/\bcontent\s*=\s*(["'])(.*?)\1/i);
            const bareContent = tag.match(/\bcontent\s*=\s*([^\s>]+)/i);
            const content = (quotedContent?.[2] || bareContent?.[1] || '').replace(/&amp;/gi, '&');
            const redirectValue = content.match(/(?:^|;)\s*url\s*=\s*(.+)$/i)?.[1]?.trim();
            if (!redirectValue) continue;

            try {
                const redirectUrl = new URL(redirectValue.replace(/^["']|["']$/g, ''), 'https://m.dcinside.com');
                if (redirectUrl.hostname.toLowerCase() === 'm.dcinside.com'
                    && /^\/board(?:\/|$)/i.test(redirectUrl.pathname)) {
                    return true;
                }
            } catch (error) {
                // 올바른 DC 게시판 URL이 아닌 meta refresh는 성공으로 보지 않는다.
            }
        }
    }
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
    buildDcHyperlinkMemo,
    buildDcOgLinkMemo,
    collectDcCommentNos,
    collectDcPostNosInList,
    collectDcFormFields,
    escapeDcHtml,
    extractDcPostNosForGallery,
    extractDcPostNo,
    findNewDcComment,
    findDcPostInList,
    findDcPostsInList,
    getDcFailureMessage,
    hasDcExternalLink,
    isDcWriteSuccess,
    normalizeDcExternalUrl,
    normalizeDcVerificationTitle,
    parseDcCommentSubmitResponse,
    parseDcMobileComments,
    parseDcResponseData,
    resolveDcFormAction
};
