const STORAGE_KEY = 'bidDbEditKey';
const EDIT_KEY_HEADER = 'x-edit-key';
const NON_MUTATING_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
let cachedEditKey = sessionStorage.getItem(STORAGE_KEY) || '';

function setEditKey(value) {
    cachedEditKey = value;
    if (value) {
        sessionStorage.setItem(STORAGE_KEY, value);
    } else {
        sessionStorage.removeItem(STORAGE_KEY);
    }
    updateEditLockIndicator();
}

function getEditKey() {
    return cachedEditKey;
}

function updateEditLockIndicator() {
    const toggle = document.querySelector('[data-edit-lock-toggle]');
    if (!toggle) return;

    if (cachedEditKey) {
        toggle.textContent = '🔓 Editing';
        toggle.setAttribute('aria-pressed', 'true');
        toggle.title = 'Editing unlocked. Click to lock again.';
    } else {
        toggle.textContent = '🔒 Locked';
        toggle.setAttribute('aria-pressed', 'false');
        toggle.title = 'Editing locked. Click to enter the edit key.';
    }
}

async function ensureEditKey() {
    if (cachedEditKey) {
        return cachedEditKey;
    }

    const input = window.prompt('Enter the shared edit key to make changes:');
    if (input && input.trim()) {
        setEditKey(input.trim());
        return cachedEditKey;
    }

    return null;
}

async function apiFetch(resource, options = {}) {
    const opts = { ...options };
    const method = (opts.method || 'GET').toUpperCase();
    const headers = new Headers(opts.headers || {});

    if (!NON_MUTATING_METHODS.has(method)) {
        let key = getEditKey();
        if (!key) {
            key = await ensureEditKey();
        }

        if (!key) {
            throw new Error('Edit key is required to modify data.');
        }

        headers.set(EDIT_KEY_HEADER, key);
    } else if (getEditKey()) {
        headers.set(EDIT_KEY_HEADER, getEditKey());
    }

    opts.headers = headers;
    return fetch(resource, opts);
}

window.apiFetch = apiFetch;
window.bidDbEditKey = {
    clear: () => setEditKey(''),
    ensure: ensureEditKey,
    get: getEditKey,
    updateIndicator: updateEditLockIndicator
};

document.addEventListener('DOMContentLoaded', () => {
    updateEditLockIndicator();

    document.body.addEventListener('click', async (event) => {
        const toggle = event.target.closest('[data-edit-lock-toggle]');
        if (!toggle) return;

        event.preventDefault();
        if (getEditKey()) {
            setEditKey('');
            alert('Editing locked. Enter the edit key again to make changes.');
        } else {
            await ensureEditKey();
        }
    });
});
