/**
 * NETRUNNER TERMINAL - NET Architecture Module
 * Cyberpunk RED architecture navigator: floors revealed as the
 * netrunner descends, driven by GM-authored data
 */

(function() {
    'use strict';

    const STORE_KEY = 'ct_netarch';

    let listEl = null;
    let detailEl = null;
    let titleEl = null;
    let subtitleEl = null;
    let floorsEl = null;

    let architectures = [];
    let current = null;
    let progress = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');

    const FLOOR_META = {
        password: { label: 'PASSWORD GATE', cls: 'floor-password' },
        file: { label: 'FILE NODE', cls: 'floor-file' },
        control: { label: 'CONTROL NODE', cls: 'floor-control' },
        ice: { label: 'BLACK ICE', cls: 'floor-ice' }
    };

    /**
     * Persist per-architecture revealed floor counts
     */
    function saveProgress() {
        localStorage.setItem(STORE_KEY, JSON.stringify(progress));
    }

    /**
     * Render the architecture selection list
     */
    function renderList() {
        listEl.innerHTML = '';
        detailEl.classList.add('hidden');
        listEl.classList.remove('hidden');

        if (!architectures.length) {
            listEl.innerHTML = '<div class="comms-empty">// NO ARCHITECTURES MAPPED. GM must populate data/netarch.json</div>';
            return;
        }

        architectures.forEach(arch => {
            const revealed = progress[arch.id] || 0;
            const card = document.createElement('button');
            card.className = 'netarch-card';
            card.innerHTML =
                '<span class="netarch-card-name">' + Utils.escapeHtml(arch.name) + '</span>' +
                '<span class="netarch-card-info">DIFFICULTY: ' + Utils.escapeHtml(arch.difficulty || 'UNKNOWN') +
                '  //  FLOORS: ' + revealed + '/' + arch.floors.length + ' BREACHED</span>';
            card.addEventListener('click', () => openArch(arch));
            listEl.appendChild(card);
        });
    }

    /**
     * Open one architecture in detail view
     * @param {Object} arch - Architecture definition
     */
    function openArch(arch) {
        current = arch;
        listEl.classList.add('hidden');
        detailEl.classList.remove('hidden');
        titleEl.textContent = arch.name;
        subtitleEl.textContent = '// DIFFICULTY: ' + (arch.difficulty || 'UNKNOWN') +
            (arch.description ? '  //  ' + arch.description : '');
        renderFloors();
    }

    /**
     * Render the vertical floor lattice
     */
    function renderFloors() {
        const revealed = progress[current.id] || 0;
        floorsEl.innerHTML = '';

        current.floors.forEach((floor, index) => {
            const meta = FLOOR_META[floor.type] || FLOOR_META.file;
            const el = document.createElement('div');

            if (index < revealed) {
                el.className = 'netarch-floor revealed ' + meta.cls;
                let inner =
                    '<div class="floor-level">FLOOR ' + (index + 1) + '</div>' +
                    '<div class="floor-type">' + meta.label + (floor.ice ? ' // ' + Utils.escapeHtml(floor.ice) : '') + '</div>' +
                    '<div class="floor-name">' + Utils.escapeHtml(floor.name || '') + '</div>';
                if (floor.dv) {
                    inner += '<div class="floor-dv">DV ' + Utils.escapeHtml(String(floor.dv)) + '</div>';
                }
                if (floor.description) {
                    inner += '<div class="floor-desc">' + Utils.escapeHtml(floor.description) + '</div>';
                }
                if (floor.content) {
                    inner += '<pre class="floor-content">' + Utils.escapeHtml(floor.content) + '</pre>';
                }
                el.innerHTML = inner;
            } else if (index === revealed) {
                el.className = 'netarch-floor next';
                el.innerHTML =
                    '<div class="floor-level">FLOOR ' + (index + 1) + '</div>' +
                    '<div class="floor-type">???</div>' +
                    '<button class="cyber-btn primary floor-breach-btn"><span class="btn-text">BREACH FLOOR</span></button>';
                el.querySelector('.floor-breach-btn').addEventListener('click', () => breachFloor(index));
            } else {
                el.className = 'netarch-floor locked';
                el.innerHTML =
                    '<div class="floor-level">FLOOR ' + (index + 1) + '</div>' +
                    '<div class="floor-type">&#9608;&#9608;&#9608; NO SIGNAL &#9608;&#9608;&#9608;</div>';
            }

            floorsEl.appendChild(el);
        });

        if (revealed >= current.floors.length) {
            const done = document.createElement('div');
            done.className = 'netarch-complete';
            done.textContent = '// ARCHITECTURE FULLY BREACHED';
            floorsEl.appendChild(done);
        }
    }

    /**
     * Reveal the next floor
     * @param {number} index - Floor index being breached
     */
    function breachFloor(index) {
        const floor = current.floors[index];
        progress[current.id] = index + 1;
        saveProgress();

        if (window.Sound) {
            if (floor.type === 'ice') {
                Sound.alarm();
            } else {
                Sound.confirm();
            }
        }

        renderFloors();
        const revealedEl = floorsEl.children[index];
        if (revealedEl) {
            revealedEl.classList.add('glitch-effect');
            setTimeout(() => revealedEl.classList.remove('glitch-effect'), 400);
        }
    }

    /**
     * Reset progress on the current architecture
     */
    async function resetArch() {
        const ok = await Modal.confirm({
            title: 'RESET ARCHITECTURE',
            message: 'Wipe breach progress for ' + current.name + '?'
        });
        if (!ok) return;

        delete progress[current.id];
        saveProgress();
        renderFloors();
    }

    /**
     * Called when the section is opened
     */
    async function onEnter() {
        // Always refetch so GM edits made mid-session show up
        const data = await DataLoader.load('netarch', true);
        architectures = ((data && data.architectures) || [])
            .filter(arch => arch && arch.id && Array.isArray(arch.floors));
        renderList();
    }

    /**
     * Initialize the module
     */
    function init() {
        listEl = document.getElementById('netarch-list');
        detailEl = document.getElementById('netarch-detail');
        titleEl = document.getElementById('netarch-title');
        subtitleEl = document.getElementById('netarch-subtitle');
        floorsEl = document.getElementById('netarch-floors');
        if (!listEl) return;

        document.getElementById('netarch-back').addEventListener('click', renderList);
        document.getElementById('netarch-reset').addEventListener('click', resetArch);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.NetArch = {
        onEnter
    };

})();
