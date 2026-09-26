/**
 * NETRUNNER TERMINAL - Main Navigation Module
 * Boot sequence, operator login, navigation, config and instability
 */

(function() {
    'use strict';

    // DOM Elements
    const bootScreen = document.getElementById('boot-screen');
    const loginScreen = document.getElementById('login-screen');
    const loginInput = document.getElementById('login-handle');
    const loginBtn = document.getElementById('login-btn');
    const loginError = document.getElementById('login-error');
    const terminal = document.getElementById('terminal');
    const mainMenu = document.getElementById('main-menu');
    const contentContainer = document.getElementById('content-container');
    const backBtn = document.getElementById('back-btn');
    const menuOptions = document.querySelectorAll('.menu-option');
    const operatorDisplay = document.getElementById('operator-display');
    const commsBadge = document.getElementById('comms-badge');
    const muteBtn = document.getElementById('mute-btn');
    const menuMotd = document.getElementById('menu-motd');

    const HANDLE_KEY = 'ct_handle';
    const BOOT_KEY = 'ct_booted';
    const HANDLE_PATTERN = /^[A-Za-z0-9_-]{2,16}$/;
    const BOOT_DURATION = 4000;

    // Sections discovered from the DOM
    const sections = {};
    document.querySelectorAll('.tool-section').forEach(section => {
        sections[section.id.replace(/-section$/, '')] = section;
    });

    // Per-section activation hooks
    const sectionHooks = {
        'hacking-game': () => window.HackingGame && HackingGame.init(),
        'cli': () => window.CLI && CLI.onEnter(),
        'netarch': () => window.NetArch && NetArch.onEnter(),
        'databank': () => window.Databank && Databank.onEnter(),
        'comms': () => window.Transmissions && Transmissions.onEnter(),
        'signal': () => window.SignalTuner && SignalTuner.onEnter(),
        'icebreaker': () => window.Icebreaker && Icebreaker.onEnter()
    };

    let bootTimer = null;
    let instabilityLevel = 0;
    let instabilityTimer = null;

    /**
     * Get the logged in operator handle
     * @returns {string|null}
     */
    function getHandle() {
        return localStorage.getItem(HANDLE_KEY);
    }

    /**
     * Finish the boot sequence and continue to login or terminal
     */
    function finishBoot() {
        if (bootTimer) {
            clearTimeout(bootTimer);
            bootTimer = null;
        }
        bootScreen.classList.add('hidden');
        sessionStorage.setItem(BOOT_KEY, '1');

        if (getHandle()) {
            enterTerminal();
        } else {
            showLogin();
        }
    }

    /**
     * Run or skip the boot sequence
     */
    function initBoot() {
        if (sessionStorage.getItem(BOOT_KEY)) {
            finishBoot();
            return;
        }

        bootTimer = setTimeout(finishBoot, BOOT_DURATION);

        const skip = () => finishBoot();
        bootScreen.addEventListener('click', skip, { once: true });
        document.addEventListener('keydown', function onKey() {
            document.removeEventListener('keydown', onKey);
            if (!bootScreen.classList.contains('hidden')) skip();
        });
    }

    /**
     * Show the operator login screen
     */
    function showLogin() {
        loginScreen.classList.remove('hidden');
        loginInput.focus();
    }

    /**
     * Validate and store the operator handle
     */
    function submitLogin() {
        const handle = loginInput.value.trim();

        if (!HANDLE_PATTERN.test(handle)) {
            loginError.textContent = 'INVALID HANDLE // 2-16 chars, letters, digits, _ or -';
            loginError.classList.remove('hidden');
            if (window.Sound) Sound.error();
            return;
        }

        localStorage.setItem(HANDLE_KEY, handle);
        loginError.classList.add('hidden');
        loginScreen.classList.add('hidden');
        if (window.Sound) Sound.confirm();
        enterTerminal();
    }

    /**
     * Clear the operator identity and restart
     */
    function logout() {
        localStorage.removeItem(HANDLE_KEY);
        location.reload();
    }

    /**
     * Show the main terminal UI
     */
    function enterTerminal() {
        terminal.classList.remove('hidden');
        operatorDisplay.textContent = 'OPR://' + getHandle().toUpperCase();
    }

    /**
     * Update the unread transmissions badge
     * @param {number} count - Unread message count
     */
    function setUnread(count) {
        if (count > 0) {
            commsBadge.textContent = 'MSG [' + count + ']';
            commsBadge.classList.remove('hidden');
        } else {
            commsBadge.classList.add('hidden');
        }
    }

    /**
     * Navigate to a specific section
     * @param {string} sectionId - The section to navigate to
     */
    function navigateToSection(sectionId) {
        if (!sections[sectionId]) return;

        mainMenu.classList.add('hidden');
        contentContainer.classList.remove('hidden');

        Object.values(sections).forEach(section => {
            section.classList.add('hidden');
        });
        sections[sectionId].classList.remove('hidden');

        if (sectionHooks[sectionId]) {
            sectionHooks[sectionId]();
        }
    }

    /**
     * Navigate back to main menu
     */
    function navigateToMenu() {
        contentContainer.classList.add('hidden');
        mainMenu.classList.remove('hidden');

        Object.values(sections).forEach(section => {
            section.classList.add('hidden');
        });
    }

    /**
     * Handle menu option click
     * @param {Event} event - Click event
     */
    function handleMenuClick(event) {
        const option = event.currentTarget;
        const sectionId = option.dataset.section;

        option.classList.add('glitch-effect');
        setTimeout(() => {
            option.classList.remove('glitch-effect');
            navigateToSection(sectionId);
        }, 150);
    }

    /**
     * Handle back button click
     */
    function handleBackClick() {
        backBtn.classList.add('glitch-effect');
        setTimeout(() => {
            backBtn.classList.remove('glitch-effect');
            navigateToMenu();
        }, 150);
    }

    /**
     * Update the mute button label
     */
    function updateMuteBtn() {
        muteBtn.textContent = Sound.isMuted() ? 'SND:OFF' : 'SND:ON';
        muteBtn.classList.toggle('muted', Sound.isMuted());
    }

    /**
     * Apply GM config: motd and instability level
     * @param {Object|null} config - Parsed config.json
     */
    function applyConfig(config) {
        if (!config) return;

        if (config.motd && menuMotd) {
            menuMotd.textContent = '// ' + config.motd;
        }

        const level = Math.max(0, Math.min(3, parseInt(config.instability, 10) || 0));
        if (level !== instabilityLevel) {
            instabilityLevel = level;
            document.body.classList.remove('instability-1', 'instability-2', 'instability-3');
            if (level > 0) {
                document.body.classList.add('instability-' + level);
            }
        }
    }

    /**
     * Random glitch bursts driven by the instability level
     */
    function instabilityTick() {
        if (instabilityLevel < 2) return;
        if (Math.random() > 0.25 * instabilityLevel) return;

        const candidates = document.querySelectorAll(
            '.tool-section:not(.hidden), .main-menu:not(.hidden), .terminal-header'
        );
        if (!candidates.length) return;

        const target = candidates[Math.floor(Math.random() * candidates.length)];
        target.classList.add('glitch-effect');
        setTimeout(() => target.classList.remove('glitch-effect'), 350);

        if (instabilityLevel >= 3 && window.Sound) {
            Sound.staticBurst(0.15);
        }
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        menuOptions.forEach(option => {
            option.addEventListener('click', handleMenuClick);
        });

        backBtn.addEventListener('click', handleBackClick);

        loginBtn.addEventListener('click', submitLogin);
        loginInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') submitLogin();
        });

        muteBtn.addEventListener('click', () => {
            Sound.toggleMute();
            updateMuteBtn();
            if (!Sound.isMuted()) Sound.confirm();
        });

        commsBadge.addEventListener('click', () => navigateToSection('comms'));

        // Subtle click sound on interactive elements
        document.addEventListener('click', (event) => {
            if (event.target.closest('.cyber-btn, .menu-option, .mode-btn, .back-btn')) {
                Sound.click();
            }
        });

        // Keyboard activation for non-button elements acting as buttons
        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const target = event.target;
            if (target.getAttribute && target.getAttribute('role') === 'button' && target.tagName !== 'BUTTON') {
                event.preventDefault();
                target.click();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            if (window.Modal && Modal.isOpen()) return;
            if (window.Transmissions && Transmissions.isOverlayOpen()) return;
            if (!contentContainer.classList.contains('hidden')) {
                handleBackClick();
            }
        });
    }

    /**
     * Initialize the application
     */
    function init() {
        initBoot();
        initEventListeners();
        updateMuteBtn();

        DataLoader.poll('config', applyConfig, 15000);
        instabilityTimer = setInterval(instabilityTick, 7000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose navigation functions globally for other modules
    window.Terminal = {
        navigateToSection,
        navigateToMenu,
        getHandle,
        logout,
        setUnread
    };

})();
