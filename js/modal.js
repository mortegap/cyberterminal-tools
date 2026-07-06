/**
 * NETRUNNER TERMINAL - Modal System
 * Themed replacement for alert/confirm/prompt
 */

(function() {
    'use strict';

    let overlay = null;
    let titleEl = null;
    let messageEl = null;
    let inputEl = null;
    let actionsEl = null;
    let resolver = null;
    let escHandler = null;

    /**
     * Build the modal DOM once
     */
    function build() {
        if (overlay) return;

        overlay = document.createElement('div');
        overlay.className = 'cyber-modal-overlay hidden';
        overlay.innerHTML = [
            '<div class="cyber-modal">',
            '    <div class="modal-title"></div>',
            '    <div class="modal-message"></div>',
            '    <input type="text" class="cyber-input modal-input hidden">',
            '    <div class="modal-actions"></div>',
            '</div>'
        ].join('\n');
        document.body.appendChild(overlay);

        titleEl = overlay.querySelector('.modal-title');
        messageEl = overlay.querySelector('.modal-message');
        inputEl = overlay.querySelector('.modal-input');
        actionsEl = overlay.querySelector('.modal-actions');

        inputEl.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(inputEl.value);
            }
        });
    }

    /**
     * Close the modal and resolve the pending promise
     * @param {*} value - Resolution value
     */
    function finish(value) {
        overlay.classList.add('hidden');
        if (escHandler) {
            document.removeEventListener('keydown', escHandler, true);
            escHandler = null;
        }
        if (resolver) {
            const resolve = resolver;
            resolver = null;
            resolve(value);
        }
    }

    /**
     * Open the modal with a given configuration
     * @param {Object} config - title, message, tone, input, buttons
     * @returns {Promise<*>}
     */
    function open(config) {
        build();

        // Resolve any previous modal as cancelled
        if (resolver) finish(config.cancelValue);

        titleEl.textContent = config.title || 'SYSTEM';
        titleEl.className = 'modal-title tone-' + (config.tone || 'info');
        messageEl.textContent = config.message || '';
        messageEl.classList.toggle('hidden', !config.message);

        if (config.input) {
            inputEl.classList.remove('hidden');
            inputEl.value = '';
            inputEl.type = config.mask ? 'password' : 'text';
            inputEl.placeholder = config.placeholder || '';
        } else {
            inputEl.classList.add('hidden');
        }

        actionsEl.innerHTML = '';
        config.buttons.forEach(btn => {
            const el = document.createElement('button');
            el.className = 'cyber-btn ' + (btn.style || 'secondary');
            el.innerHTML = '<span class="btn-text">' + Utils.escapeHtml(btn.text) + '</span>';
            el.addEventListener('click', () => {
                finish(btn.value === '__input__' ? inputEl.value : btn.value);
            });
            actionsEl.appendChild(el);
        });

        overlay.classList.remove('hidden');
        if (config.input) inputEl.focus();

        escHandler = (event) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                finish(config.cancelValue);
            }
        };
        document.addEventListener('keydown', escHandler, true);

        return new Promise(resolve => {
            resolver = resolve;
        });
    }

    /**
     * Show an informational dialog
     * @param {Object} options - title, message, tone
     * @returns {Promise<void>}
     */
    function alert(options) {
        return open({
            title: options.title,
            message: options.message,
            tone: options.tone || 'info',
            cancelValue: undefined,
            buttons: [{ text: options.okText || 'ACKNOWLEDGE', value: undefined, style: 'primary' }]
        });
    }

    /**
     * Show a yes/no confirmation dialog
     * @param {Object} options - title, message, tone, yesText, noText
     * @returns {Promise<boolean>}
     */
    function confirm(options) {
        return open({
            title: options.title,
            message: options.message,
            tone: options.tone || 'warning',
            cancelValue: false,
            buttons: [
                { text: options.yesText || 'CONFIRM', value: true, style: 'primary' },
                { text: options.noText || 'ABORT', value: false, style: 'tertiary' }
            ]
        });
    }

    /**
     * Show a text input dialog
     * @param {Object} options - title, message, placeholder, mask
     * @returns {Promise<string|null>} Input value or null if cancelled
     */
    function prompt(options) {
        return open({
            title: options.title,
            message: options.message,
            tone: options.tone || 'info',
            input: true,
            mask: options.mask,
            placeholder: options.placeholder,
            cancelValue: null,
            buttons: [
                { text: options.okText || 'SUBMIT', value: '__input__', style: 'primary' },
                { text: options.noText || 'ABORT', value: null, style: 'tertiary' }
            ]
        });
    }

    function isOpen() {
        return !!(overlay && !overlay.classList.contains('hidden'));
    }

    window.Modal = {
        alert,
        confirm,
        prompt,
        isOpen
    };

})();
