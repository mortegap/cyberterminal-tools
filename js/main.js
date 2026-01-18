/**
 * NETRUNNER TERMINAL - Main Navigation Module
 * Handles boot sequence, navigation, and common functionality
 */

(function() {
    'use strict';

    // DOM Elements
    const bootScreen = document.getElementById('boot-screen');
    const terminal = document.getElementById('terminal');
    const mainMenu = document.getElementById('main-menu');
    const contentContainer = document.getElementById('content-container');
    const backBtn = document.getElementById('back-btn');
    const menuOptions = document.querySelectorAll('.menu-option');

    // Sections
    const sections = {
        'encoder': document.getElementById('encoder-section'),
        'hacking-game': document.getElementById('hacking-game-section'),
        'cipher': document.getElementById('cipher-section')
    };

    // Boot sequence duration (matches CSS animation)
    const BOOT_DURATION = 4000;

    /**
     * Initialize the terminal after boot sequence
     */
    function initTerminal() {
        setTimeout(() => {
            bootScreen.classList.add('hidden');
            terminal.classList.remove('hidden');
        }, BOOT_DURATION);
    }

    /**
     * Navigate to a specific section
     * @param {string} sectionId - The section to navigate to
     */
    function navigateToSection(sectionId) {
        if (!sections[sectionId]) return;

        // Hide menu, show content container
        mainMenu.classList.add('hidden');
        contentContainer.classList.remove('hidden');

        // Hide all sections, show target
        Object.values(sections).forEach(section => {
            section.classList.add('hidden');
        });
        sections[sectionId].classList.remove('hidden');

        // Trigger section-specific initialization
        if (sectionId === 'hacking-game' && window.HackingGame) {
            window.HackingGame.init();
        }
    }

    /**
     * Navigate back to main menu
     */
    function navigateToMenu() {
        contentContainer.classList.add('hidden');
        mainMenu.classList.remove('hidden');

        // Hide all sections
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

        // Add click effect
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
     * Play a click sound effect (optional enhancement)
     */
    function playClickSound() {
        // Audio could be added here for enhanced UX
        // const audio = new Audio('sounds/click.wav');
        // audio.volume = 0.3;
        // audio.play();
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        // Menu options
        menuOptions.forEach(option => {
            option.addEventListener('click', handleMenuClick);
        });

        // Back button
        backBtn.addEventListener('click', handleBackClick);

        // Keyboard navigation
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !contentContainer.classList.contains('hidden')) {
                handleBackClick();
            }
        });
    }

    /**
     * Initialize the application
     */
    function init() {
        initTerminal();
        initEventListeners();
    }

    // Start application when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose navigation functions globally for other modules
    window.Terminal = {
        navigateToSection,
        navigateToMenu
    };

})();
