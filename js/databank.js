/**
 * NETRUNNER TERMINAL - Databank Module
 * Searchable dossier database with code-locked redacted sections
 */

(function() {
    'use strict';

    const UNLOCK_KEY = 'ct_databank';
    const REDACT_PATTERN = /\{\{redacted:([A-Za-z0-9_-]+)\}\}/g;

    let searchEl = null;
    let listEl = null;
    let detailEl = null;

    let records = [];
    let unlockedSet = new Set(JSON.parse(localStorage.getItem(UNLOCK_KEY) || '[]'));
    let currentRecord = null;

    /**
     * Persist unlocked redaction keys
     */
    function saveUnlocked() {
        localStorage.setItem(UNLOCK_KEY, JSON.stringify([...unlockedSet]));
    }

    /**
     * Filter records by search query
     * @param {string} query - Search text
     * @returns {Object[]}
     */
    function filterRecords(query) {
        const q = query.trim().toLowerCase();
        if (!q) return records;

        return records.filter(r => {
            const haystack = [
                r.name, r.alias, r.type,
                ...(r.tags || [])
            ].filter(Boolean).join(' ').toLowerCase();
            return haystack.includes(q);
        });
    }

    /**
     * Render the record list
     */
    function renderList() {
        const visible = filterRecords(searchEl.value);
        listEl.innerHTML = '';

        if (!visible.length) {
            listEl.innerHTML = '<div class="comms-empty">// NO RECORDS MATCH QUERY</div>';
            return;
        }

        visible.forEach(record => {
            const row = document.createElement('button');
            row.className = 'db-row' + (currentRecord && currentRecord.id === record.id ? ' active' : '');
            row.innerHTML =
                '<span class="db-row-type">' + Utils.escapeHtml(record.type || 'DATA') + '</span>' +
                '<span class="db-row-name">' + Utils.escapeHtml(record.name || record.id) + '</span>';
            row.addEventListener('click', () => selectRecord(record));
            listEl.appendChild(row);
        });
    }

    /**
     * Render a record body, replacing redaction tokens with
     * interactive locked blocks
     * @param {Object} record - Record definition
     * @param {HTMLElement} container - Target element
     */
    function renderBody(record, container) {
        container.innerHTML = '';
        const body = record.body || '';
        let lastIndex = 0;

        for (const match of body.matchAll(REDACT_PATTERN)) {
            container.appendChild(
                document.createTextNode(body.slice(lastIndex, match.index))
            );
            container.appendChild(buildRedaction(record, match[1]));
            lastIndex = match.index + match[0].length;
        }
        container.appendChild(document.createTextNode(body.slice(lastIndex)));
    }

    /**
     * Build a redacted span, revealed if already unlocked
     * @param {Object} record - Parent record
     * @param {string} key - Redaction key
     * @returns {HTMLElement}
     */
    function buildRedaction(record, key) {
        const span = document.createElement('span');
        const def = (record.redacted || {})[key];
        const storeKey = record.id + ':' + key;

        if (!def) {
            span.className = 'db-redacted';
            span.textContent = '[DATA CORRUPTED]';
            return span;
        }

        if (unlockedSet.has(storeKey)) {
            span.className = 'db-revealed';
            span.textContent = def.content;
            return span;
        }

        span.className = 'db-redacted locked';
        span.textContent = '[REDACTED]';
        span.title = 'Access code required';
        span.addEventListener('click', async () => {
            const code = await Modal.prompt({
                title: 'RESTRICTED DATA',
                message: 'Enter access code to decrypt this section.',
                placeholder: 'Access code...',
                tone: 'warning'
            });
            if (code === null) return;

            if (code.trim().toLowerCase() === String(def.code).toLowerCase()) {
                unlockedSet.add(storeKey);
                saveUnlocked();
                if (window.Sound) Sound.confirm();
                openRecord(record);
            } else {
                if (window.Sound) Sound.error();
                Modal.alert({
                    title: 'ACCESS DENIED',
                    message: 'Invalid access code. Attempt logged.',
                    tone: 'error'
                });
            }
        });

        return span;
    }

    /**
     * Show a record in the detail panel
     * @param {Object} record - Record definition
     */
    function openRecord(record) {
        currentRecord = record;
        renderList();
        detailEl.classList.remove('hidden');

        detailEl.querySelector('.db-name').textContent = record.name || record.id;
        detailEl.querySelector('.db-meta').textContent =
            (record.type || 'DATA') +
            (record.alias ? '  //  AKA: ' + record.alias : '') +
            (record.tags && record.tags.length ? '  //  TAGS: ' + record.tags.join(', ') : '');

        const fieldsEl = detailEl.querySelector('.db-fields');
        fieldsEl.innerHTML = '';
        Object.entries(record.fields || {}).forEach(([key, value]) => {
            const row = document.createElement('div');
            row.className = 'db-field';
            row.innerHTML =
                '<span class="db-field-key">' + Utils.escapeHtml(key) + '</span>' +
                '<span class="db-field-value">' + Utils.escapeHtml(String(value)) + '</span>';
            fieldsEl.appendChild(row);
        });

        renderBody(record, detailEl.querySelector('.db-body'));
    }

    /**
     * Open a record from the list and bring it into view on mobile
     * @param {Object} record - Record definition
     */
    function selectRecord(record) {
        openRecord(record);
        Utils.revealOnMobile(detailEl);
    }

    /**
     * Called when the section is opened
     */
    async function onEnter() {
        // Always refetch so GM edits made mid-session show up
        const data = await DataLoader.load('databank', true);
        records = ((data && data.records) || []).filter(record => record && record.id);

        // Keep the open dossier in sync with the fresh data
        if (currentRecord) {
            const fresh = records.find(record => record.id === currentRecord.id);
            if (fresh) {
                openRecord(fresh);
                return;
            }
            currentRecord = null;
            detailEl.classList.add('hidden');
        }
        renderList();
    }

    /**
     * Initialize the module
     */
    function init() {
        searchEl = document.getElementById('databank-search');
        listEl = document.getElementById('databank-list');
        detailEl = document.getElementById('databank-detail');
        if (!searchEl) return;

        searchEl.addEventListener('input', renderList);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Databank = {
        onEnter
    };

})();
