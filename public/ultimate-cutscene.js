(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.UltimateCutscene = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // 기본 궁극기 WebP의 재생 길이. 유니크 외형은 서버가 지정한 전용 연출을 사용한다.
    const CLIPS = Object.freeze([
        ['빵귤', '유드 알레프', 1799], ['뭔마', '안면강타', 1799],
        ['글렌첵', '핫식스의정력', 1799], ['오버라이드', '처형박수', 1799],
        ['일레이나', '이어브피', 1799], ['진필규', '감사합니다 친구야', 1799],
        ['켄시', 'KICK BACK', 1799], ['제우스', '초특급한탕', 1799],
        ['타이란트', '끝판왕', 1799], ['마쉐비', '댄져', 1799],
        ['딜러장', '54버스트', 1799], ['이익태', '수나타 소환', 2399],
        ['안성재', '포커 못 하시네', 1999], ['흠시원', '범인은 이 안에', 2199],
        ['일리온', '느억맘', 1799], ['워뇨띠', '원영적사고 모드 전환', 1799],
        ['키노', '카스 살포', 1799]
    ].map(([character, skill, duration]) => Object.freeze({ character, skill, duration })));
    const assetUrl = (clip, still = false) => (still ? clip.posterUrl : clip.url) || '/rpg-ui?file=' + encodeURIComponent('궁극기/' + clip.character + (still ? '-still' : '') + '-v1.webp');

    function find(event, cardName) {
        if (!event || event.action !== 'skill' || event.skipped || event.error) return null;
        const scene = event.uniqueCutscene;
        if (scene?.url && scene.skillName === event.skillName) return { character: scene.characterName, skill: scene.skillName, url: scene.url, posterUrl: scene.posterUrl, duration: 1800 };
        return CLIPS.find(clip => clip.skill === event.skillName
            || event.skillName === '빅뱅' && clip.character === cardName) || null;
    }

    function create(options = {}) {
        // 전투 무대의 transform/overflow와 무관하게 실제 화면 너비로 재생한다.
        const host = document.body, now = options.now || Date.now;
        const reduced = matchMedia('(prefers-reduced-motion: reduce)');
        const layer = document.createElement('div');
        layer.className = 'ultimate-cutscene' + (options.host ? ' ultimate-cutscene-contained' : '');
        layer.setAttribute('aria-hidden', 'true');
        layer.hidden = true;
        host.appendChild(layer);
        const blobs = new Map(), seen = new Set(), queue = [];
        let active = false, generation = 0, timer = null, objectUrl = null;
        // fold(0~1): 전투 연출이 뒤따르는 화면에서는 클립을 그 비율만큼만 보이고 띠를 빠르게 접는다. 접힌 뒤에 스킬 장면이 시작된다.
        const fold = options.fold > 0 && options.fold < 1 ? options.fold : 0, FOLD_MS = 150;
        const shown = clip => reduced.matches ? 1000 : fold ? Math.round(clip.duration * fold) : clip.duration;

        function load(clip) {
            const url = assetUrl(clip, reduced.matches);
            if (!blobs.has(url)) blobs.set(url, fetch(url).then(response => {
                if (!response.ok) throw new Error('컷씬 이미지 ' + response.status);
                return response.blob();
            }).catch(() => { blobs.delete(url); return null; }));
            return blobs.get(url);
        }
        function clearImage() {
            clearTimeout(timer);
            if (fold) layer.classList.remove('ultimate-cutscene-folding');
            layer.replaceChildren();
            layer.hidden = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
        function reset(clearSeen = true) {
            generation++;
            queue.length = 0;
            active = false;
            if (clearSeen) seen.clear();
            clearImage();
        }
        async function next() {
            if (active || !queue.length || document.hidden) return;
            active = true;
            const clip = queue.shift(), token = generation, blob = await load(clip);
            if (token !== generation) return;
            if (!blob || document.hidden) { active = false; next(); return; }
            const image = new Image();
            image.alt = '';
            image.draggable = false;
            // 매 시전마다 새 Blob URL을 사용해 브라우저가 1회 재생 WebP를 첫 프레임부터 시작하게 한다.
            objectUrl = URL.createObjectURL(blob);
            image.onload = () => {
                if (token !== generation) return;
                layer.dataset.character = clip.character;
                layer.replaceChildren(image);
                layer.hidden = false;
                const done = () => { clearImage(); active = false; next(); };
                timer = setTimeout(() => {
                    if (!fold || reduced.matches) { done(); return; }
                    layer.classList.add('ultimate-cutscene-folding');
                    timer = setTimeout(done, FOLD_MS);
                }, shown(clip));
            };
            image.onerror = () => { if (token === generation) { clearImage(); active = false; next(); } };
            image.src = objectUrl;
        }
        function play(event, cardName) {
            const clip = find(event, cardName);
            if (!clip || document.hidden || event.at && now() - event.at > 2500) return 0;
            const id = event.id ?? (event.seq != null ? event.actor + ':' + event.seq : null);
            if (id != null) {
                if (seen.has(id)) return 0;
                seen.add(id);
                if (seen.size > 128) seen.delete(seen.values().next().value);
            }
            queue.push(clip);
            next();
            // 돌려주는 값은 띠가 접히기 시작하는 시각(ms)이다.
            return shown(clip);
        }
        function prepare(skills, cardName) {
            for (const skill of skills || []) {
                const clip = find({ action: 'skill', skillName: typeof skill === 'string' ? skill : skill.name }, cardName);
                if (clip) load(clip);
            }
        }
        const hide = () => { if (document.hidden) reset(false); };
        document.addEventListener('visibilitychange', hide);
        window.addEventListener('pagehide', reset);
        return { play, prepare, reset, destroy() {
            reset();
            layer.remove();
            document.removeEventListener('visibilitychange', hide);
            window.removeEventListener('pagehide', reset);
        } };
    }
    return { CLIPS, assetUrl, find, create };
});
