/**
 * NETRUNNER TERMINAL - Icebreaker Module
 * Password cracking puzzle: limited attempts, lockout timers and
 * GM-defined rewards from data/gates.json
 */

(function() {
    'use strict';

    const STORE_KEY = 'ct_gates';
    const CRACK_DURATION_MS = 2200;

    let listEl = null;
    let detailEl = null;

    let targets = [];
    let state = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    let current = null;
    let cracking = false;
    let countdownTimer = null;
    let loaded = false;

    /**
     * Persist gate state
     */
    function saveState() {
        localStorage.setItem(STORE_KEY, JSON.stringify(state));
    }

    /**
     * Get mutable state for a target
     * @param {Object} target - Gate definition
     * @returns {Object}
     */
    function getState(target) {
        if (!state[target.id]) {
            state[target.id] = { attemptsUsed: 0, lockedUntil: 0, breached: false };
        }
        return state[target.id];
    }

    /**
     * Whether a target is currently locked out
     */
    function isLockedOut(target) {
        return getState(target).lockedUntil > Date.now();
    }

    /**
     * Render the target list
     */
    function renderList() {
        listEl.innerHTML = '';
        detailEl.classList.add('hidden');
        listEl.classList.remove('hidden');
        stopCountdown();

        if (!targets.length) {
            listEl.innerHTML = '<div class="comms-empty">// NO TARGETS IN RANGE. GM must populate data/gates.json</div>';
            return;
        }

        targets.forEach(target => {
            const ts = getState(target);
            let status = 'LOCKED';
            let cls = '';

            if (ts.breached) {
                status = 'BREACHED';
                cls = ' breached';
            } else if (isLockedOut(target)) {
                status = 'ICE LOCKOUT';
                cls = ' lockout';
            }

            const card = document.createElement('button');
            card.className = 'gate-card' + cls;
            card.innerHTML =
                '<span class="gate-card-name">' + Utils.escapeHtml(target.name) + '</span>' +
                '<span class="gate-card-status">[' + status + ']</span>';
            card.addEventListener('click', () => openTarget(target));
            listEl.appendChild(card);
        });
    }

    /**
     * Open a target in the detail panel
     * @param {Object} target - Gate definition
     */
    function openTarget(target) {
        current = target;
        listEl.classList.add('hidden');
        detailEl.classList.remove('hidden');
        renderDetail();
    }

    /**
     * Render the detail panel for the current target
     */
    function renderDetail() {
        stopCountdown();
        const ts = getState(current);
        const maxAttempts = current.maxAttempts || 5;

        detailEl.querySelector('.gate-name').textContent = current.name;
        detailEl.querySelector('.gate-hint').textContent = current.hint ? '// HINT: ' + current.hint : '';

        const statusEl = detailEl.querySelector('.gate-status');
        const inputRow = detailEl.querySelector('.gate-input-row');
        const progressEl = detailEl.querySelector('.gate-progress');
        const rewardEl = detailEl.querySelector('.gate-reward');

        progressEl.textContent = '';
        progressEl.classList.add('hidden');

        if (ts.breached) {
            statusEl.textContent = '>> ACCESS GRANTED';
            statusEl.className = 'gate-status success';
            inputRow.classList.add('hidden');
            rewardEl.textContent = current.reward || '';
            rewardEl.classList.remove('hidden');
            return;
        }

        rewardEl.classList.add('hidden');

        if (isLockedOut(current)) {
            inputRow.classList.add('hidden');
            statusEl.className = 'gate-status lockout';
            const update = () => {
                const remaining = Math.max(0, Math.ceil((ts.lockedUntil - Date.now()) / 1000));
                statusEl.textContent = '>> ICE LOCKOUT // RETRY IN ' + remaining + 's';
                if (remaining <= 0) renderDetail();
            };
            update();
            countdownTimer = setInterval(update, 1000);
            return;
        }

        statusEl.textContent = '>> ATTEMPTS REMAINING: ' + (maxAttempts - ts.attemptsUsed);
        statusEl.className = 'gate-status';
        inputRow.classList.remove('hidden');
        detailEl.querySelector('.gate-password').value = '';
    }

    /**
     * Stop the lockout countdown timer
     */
    function stopCountdown() {
        if (countdownTimer) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    }

    /**
     * Run the cracking animation then evaluate the attempt
     */
    function runCrack() {
        if (cracking || !current) return;

        const input = detailEl.querySelector('.gate-password');
        const attempt = input.value.trim();
        if (!attempt) return;

        cracking = true;
        const progressEl = detailEl.querySelector('.gate-progress');
        progressEl.classList.remove('hidden');

        const started = Date.now();
        const spinner = setInterval(() => {
            let line = 'INJECTING >> ';
            for (let i = 0; i < 24; i++) {
                line += Math.floor(Math.random() * 16).toString(16).toUpperCase();
            }
            progressEl.textContent = line;
            if (window.Sound && Math.random() < 0.4) Sound.keyTick();
        }, 60);

        setTimeout(() => {
            clearInterval(spinner);
            cracking = false;
            evaluate(attempt);
        }, CRACK_DURATION_MS);
    }

    /**
     * Evaluate a password attempt
     * @param {string} attempt - Entered password
     */
    function evaluate(attempt) {
        const ts = getState(current);
        const maxAttempts = current.maxAttempts || 5;

        if (attempt.toLowerCase() === String(current.password).toLowerCase()) {
            ts.breached = true;
            saveState();
            if (window.Sound) Sound.confirm();
        } else {
            ts.attemptsUsed++;
            if (ts.attemptsUsed >= maxAttempts) {
                ts.attemptsUsed = 0;
                ts.lockedUntil = Date.now() + (current.lockoutSeconds || 60) * 1000;
                if (window.Sound) Sound.alarm();
            } else {
                if (window.Sound) Sound.error();
            }
            saveState();
        }

        renderDetail();
    }

    /**
     * Called when the section is opened
     */
    async function onEnter() {
        if (!loaded) {
            const data = await DataLoader.load('gates');
            targets = (data && data.targets) || [];
            loaded = true;
        }
        renderList();
    }

    /**
     * Initialize the module
     */
    function init() {
        listEl = document.getElementById('gate-list');
        detailEl = document.getElementById('gate-detail');
        if (!listEl) return;

        document.getElementById('gate-back').addEventListener('click', renderList);
        document.getElementById('gate-run').addEventListener('click', runCrack);
        detailEl.querySelector('.gate-password').addEventListener('keydown', (event) => {
            if (event.key === 'Enter') runCrack();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Icebreaker = {
        onEnter
    };

})();
