/**
 * NETRUNNER TERMINAL - Transmissions Module
 * GM-pushed messages: polling, urgent interrupts, toasts and inbox
 */

(function() {
    'use strict';

    const READ_KEY = 'ct_msgs_read';
    const DEFAULT_POLL_SECONDS = 10;

    let messages = [];
    let readSet = new Set(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
    const announced = new Set();
    let overlayEl = null;
    let overlayQueue = [];
    let overlayBusy = false;
    let pollTimer = null;
    let listEl = null;
    let detailEl = null;

    /**
     * Persist the read message ids
     */
    function saveRead() {
        localStorage.setItem(READ_KEY, JSON.stringify([...readSet]));
    }

    /**
     * Mark a message as read and refresh UI
     * @param {Object} msg - Message object
     */
    function markRead(msg) {
        if (readSet.has(msg.id)) return;
        readSet.add(msg.id);
        saveRead();
        refreshUI();
    }

    /**
     * Messages visible to the current operator right now
     * @returns {Object[]}
     */
    function visibleMessages() {
        const handle = (Terminal.getHandle() || '').toLowerCase();
        const now = Date.now();

        return messages
            .filter(m => {
                if (!m || !m.id) return false;
                if (m.time && Date.parse(m.time) > now) return false;
                if (m.to && m.to !== 'all' && m.to.toLowerCase() !== handle) return false;
                return true;
            })
            .sort((a, b) => Date.parse(b.time || 0) - Date.parse(a.time || 0));
    }

    /**
     * Render the inbox list in the COMMS section
     */
    function renderList() {
        if (!listEl) return;

        const visible = visibleMessages();
        listEl.innerHTML = '';

        if (!visible.length) {
            listEl.innerHTML = '<div class="comms-empty">// NO TRANSMISSIONS ON RECORD</div>';
            return;
        }

        visible.forEach(msg => {
            const row = document.createElement('button');
            row.className = 'comms-row' + (readSet.has(msg.id) ? '' : ' unread');
            row.innerHTML =
                '<span class="comms-row-status">' + (readSet.has(msg.id) ? '&nbsp;' : '&#9679;') + '</span>' +
                '<span class="comms-row-from">' + Utils.escapeHtml(msg.from || 'UNKNOWN') + '</span>' +
                '<span class="comms-row-subject">' + Utils.escapeHtml(msg.subject || '(no subject)') + '</span>' +
                '<span class="comms-row-time">' + Utils.escapeHtml(formatTime(msg.time)) + '</span>';
            row.addEventListener('click', () => openDetail(msg));
            listEl.appendChild(row);
        });
    }

    /**
     * Format a message timestamp for display
     * @param {string} iso - ISO timestamp
     * @returns {string}
     */
    function formatTime(iso) {
        if (!iso) return '--';
        const d = new Date(iso);
        if (isNaN(d.getTime())) return '--';
        return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    /**
     * Show a message in the detail panel
     * @param {Object} msg - Message object
     */
    function openDetail(msg) {
        markRead(msg);
        detailEl.classList.remove('hidden');
        detailEl.querySelector('.comms-detail-subject').textContent = msg.subject || '(no subject)';
        detailEl.querySelector('.comms-detail-meta').textContent =
            'FROM: ' + (msg.from || 'UNKNOWN') + '  //  TO: ' + (msg.to || 'all') + '  //  ' + formatTime(msg.time);
        const bodyEl = detailEl.querySelector('.comms-detail-body');
        Utils.typeText(bodyEl, msg.body || '', { speed: 4, tick: true });
        Utils.revealOnMobile(detailEl);
    }

    /**
     * Build the full screen transmission overlay once
     */
    function buildOverlay() {
        if (overlayEl) return;

        overlayEl = document.createElement('div');
        overlayEl.className = 'transmission-overlay hidden';
        overlayEl.innerHTML = [
            '<div class="transmission-box">',
            '    <div class="transmission-header">&#9608; INCOMING TRANSMISSION // PRIORITY ALPHA</div>',
            '    <div class="transmission-meta"></div>',
            '    <div class="transmission-subject"></div>',
            '    <div class="transmission-body"></div>',
            '    <button class="cyber-btn primary transmission-ack"><span class="btn-text">ACKNOWLEDGE</span></button>',
            '</div>'
        ].join('\n');
        document.body.appendChild(overlayEl);

        overlayEl.querySelector('.transmission-ack').addEventListener('click', () => {
            overlayEl.classList.add('hidden');
            overlayBusy = false;
            processOverlayQueue();
        });
    }

    /**
     * Show the next queued urgent message
     */
    function processOverlayQueue() {
        if (overlayBusy || !overlayQueue.length) return;

        const msg = overlayQueue.shift();
        overlayBusy = true;
        buildOverlay();
        markRead(msg);

        overlayEl.querySelector('.transmission-meta').textContent =
            'FROM: ' + (msg.from || 'UNKNOWN') + '  //  TO: ' + (msg.to || 'all');
        overlayEl.querySelector('.transmission-subject').textContent = msg.subject || '';
        overlayEl.classList.remove('hidden');

        if (window.Sound) {
            Sound.alarm();
            Sound.staticBurst(0.4);
        }

        const bodyEl = overlayEl.querySelector('.transmission-body');
        Utils.typeText(bodyEl, msg.body || '', { speed: 18, tick: true });
    }

    /**
     * Show a corner toast for a normal priority message
     * @param {Object} msg - Message object
     */
    function showToast(msg) {
        let stack = document.getElementById('toast-stack');
        if (!stack) {
            stack = document.createElement('div');
            stack.id = 'toast-stack';
            stack.className = 'toast-stack';
            document.body.appendChild(stack);
        }

        const toast = document.createElement('div');
        toast.className = 'comms-toast';
        toast.innerHTML =
            '<span class="toast-title">&gt;&gt; INCOMING TRANSMISSION</span>' +
            '<span class="toast-from">FROM: ' + Utils.escapeHtml(msg.from || 'UNKNOWN') + '</span>';
        toast.addEventListener('click', () => {
            toast.remove();
            Terminal.navigateToSection('comms');
        });
        stack.appendChild(toast);

        if (window.Sound) Sound.confirm();
        setTimeout(() => toast.remove(), 6000);
    }

    /**
     * Refresh badge and list
     */
    function refreshUI() {
        const unread = visibleMessages().filter(m => !readSet.has(m.id));
        Terminal.setUnread(unread.length);
        renderList();
    }

    /**
     * Handle fresh data from the poller
     * @param {Object|null} data - Parsed messages.json
     */
    function onData(data) {
        if (!data || !Array.isArray(data.messages)) return;
        messages = data.messages;

        if (!Terminal.getHandle()) return;

        const unread = visibleMessages().filter(m => !readSet.has(m.id));
        refreshUI();

        unread.forEach(msg => {
            if (announced.has(msg.id)) return;
            announced.add(msg.id);
            if (msg.priority === 'urgent') {
                overlayQueue.push(msg);
            } else {
                showToast(msg);
            }
        });

        processOverlayQueue();
    }

    /**
     * Start polling, using the GM configured interval when available
     */
    async function startPolling() {
        const config = await DataLoader.load('config');
        const seconds = (config && config.pollIntervalSeconds) || DEFAULT_POLL_SECONDS;
        pollTimer = DataLoader.poll('messages', onData, Math.max(5, seconds) * 1000);
    }

    /**
     * Called when the COMMS section is opened
     */
    function onEnter() {
        renderList();
    }

    function isOverlayOpen() {
        return !!(overlayEl && !overlayEl.classList.contains('hidden'));
    }

    /**
     * Initialize the module
     */
    function init() {
        listEl = document.getElementById('comms-list');
        detailEl = document.getElementById('comms-detail');
        startPolling();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Transmissions = {
        onEnter,
        isOverlayOpen
    };

})();
