(() => {
    const characterId = document.currentScript.dataset.characterId;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, options) => {
        const url = new URL(input instanceof Request ? input.url : input, location.href);
        if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, options);
        const headers = new Headers(options?.headers || (input instanceof Request ? input.headers : undefined));
        headers.set('X-Character-Id', characterId);
        const response = await originalFetch(input, { ...options, headers });
        if (response.status === 409) {
            const body = await response.clone().json().catch(() => ({}));
            if (body.code === 'CHARACTER_CHANGED') location.replace('/characters');
        }
        return response;
    };
})();
