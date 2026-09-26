/**
 * NETRUNNER TERMINAL - Shared Utilities
 * HTML escaping, clipboard with fallback, typewriter effect
 */

(function() {
    'use strict';

    /**
     * Escape HTML to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Copy text to clipboard with fallback for non-secure contexts
     * @param {string} text - Text to copy
     * @returns {Promise<boolean>} Whether copy succeeded
     */
    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch (error) {
            // Fall through to legacy path
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();

        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (error) {
            ok = false;
        }
        document.body.removeChild(textarea);
        return ok;
    }

    /**
     * Wire a copy button with visual feedback
     * @param {HTMLElement} btn - Button element
     * @param {function} getText - Returns the text to copy
     */
    function bindCopyButton(btn, getText) {
        btn.addEventListener('click', async () => {
            const text = getText();
            if (!text) return;

            const ok = await copyText(text);
            const label = btn.querySelector('.copy-text') || btn;
            const original = label.textContent;
            label.textContent = ok ? 'COPIED!' : 'COPY FAILED';
            btn.classList.add('copied');

            setTimeout(() => {
                label.textContent = original;
                btn.classList.remove('copied');
            }, 2000);
        });
    }

    /**
     * Typewriter text effect
     * @param {HTMLElement} el - Target element
     * @param {string} text - Text to type
     * @param {Object} options - speed (ms/char), tick (play key sounds)
     * @returns {Promise} Resolves when typing completes
     */
    function typeText(el, text, options = {}) {
        const speed = options.speed || 10;

        // Cancel a previous typing run on the same element so texts never interleave
        if (el._typeCancel) el._typeCancel();
        el.textContent = '';

        return new Promise(resolve => {
            if (!text) {
                resolve();
                return;
            }

            let i = 0;
            const timer = setInterval(() => {
                el.textContent += text.charAt(i);
                i++;
                if (options.tick && window.Sound && i % 4 === 0) {
                    Sound.keyTick();
                }
                if (i >= text.length) {
                    finish();
                }
            }, speed);

            function finish() {
                clearInterval(timer);
                el._typeCancel = null;
                resolve();
            }

            el._typeCancel = finish;
        });
    }

    /**
     * Scroll a detail panel into view when it renders below its list
     * (single column mobile layout)
     * @param {HTMLElement} el - Panel element
     */
    function revealOnMobile(el) {
        if (window.matchMedia('(max-width: 767px)').matches) {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    /**
     * Whether a picked file looks like the expected media kind. Some
     * platforms report an empty or odd MIME type (e.g. video/ogg for .ogg),
     * so fall back to the extension.
     * @param {File} file - Picked file
     * @param {string} kind - 'audio' or 'image'
     * @returns {boolean}
     */
    function isFileKind(file, kind) {
        if (file.type && file.type.startsWith(kind + '/')) return true;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        const known = {
            audio: ['wav', 'mp3', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'webm'],
            image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
        };
        return (known[kind] || []).includes(ext);
    }

    window.Utils = {
        escapeHtml,
        revealOnMobile,
        isFileKind,
        copyText,
        bindCopyButton,
        typeText
    };

})();
