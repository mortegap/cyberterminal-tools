/**
 * NETRUNNER TERMINAL - Encoder/Decoder Module
 * Binary, Hexadecimal, Base64, and ASCII85 conversion utility
 */

(function() {
    'use strict';

    // DOM Elements
    const modeButtons = document.querySelectorAll('#encoder-section [data-mode]');
    const inputField = document.getElementById('encoder-input');
    const outputField = document.getElementById('encoder-output');
    const encodeBtn = document.getElementById('encode-btn');
    const decodeBtn = document.getElementById('decode-btn');
    const clearBtn = document.getElementById('clear-btn');
    const copyBtn = document.getElementById('copy-btn');

    // Current mode
    let currentMode = 'binary';

    /**
     * Decode raw bytes as UTF-8, falling back to Latin-1 for
     * legacy one-byte-per-character payloads
     * @param {number[]} bytes - Byte values (0-255)
     * @returns {string} Decoded text
     */
    function bytesToText(bytes) {
        try {
            return new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes));
        } catch (e) {
            return bytes.map(byte => String.fromCharCode(byte)).join('');
        }
    }

    /**
     * Split encoded input into byte tokens. Space separated tokens are
     * used as is, longer runs are chunked (e.g. "48656c6c6f" -> 48 65 6c...)
     * @param {string} input - Encoded string
     * @param {number} width - Characters per byte (8 for binary, 2 for hex)
     * @returns {string[]} Byte tokens
     */
    function splitTokens(input, width) {
        const tokens = [];
        input.trim().split(/\s+/).forEach(token => {
            if (token.length > width && token.length % width === 0) {
                for (let i = 0; i < token.length; i += width) {
                    tokens.push(token.slice(i, i + width));
                }
            } else {
                tokens.push(token);
            }
        });
        return tokens;
    }

    /**
     * Convert text to binary
     * @param {string} text - Input text
     * @returns {string} Binary representation (UTF-8 octets)
     */
    function textToBinary(text) {
        return Array.from(new TextEncoder().encode(text))
            .map(byte => byte.toString(2).padStart(8, '0'))
            .join(' ');
    }

    /**
     * Convert binary to text
     * @param {string} binary - Binary string (octets, spaces optional)
     * @returns {string} Decoded text
     */
    function binaryToText(binary) {
        const octets = splitTokens(binary.replace(/^0b/i, ''), 8);

        for (const octet of octets) {
            if (!/^[01]{1,8}$/.test(octet)) {
                throw new Error('Invalid binary format. Use 8-bit groups of 0s and 1s.');
            }
        }

        return bytesToText(octets.map(octet => parseInt(octet, 2)));
    }

    /**
     * Convert text to hexadecimal
     * @param {string} text - Input text
     * @returns {string} Hexadecimal representation (UTF-8 bytes)
     */
    function textToHex(text) {
        return Array.from(new TextEncoder().encode(text))
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join(' ');
    }

    /**
     * Convert hexadecimal to text
     * @param {string} hex - Hexadecimal string (bytes, spaces optional)
     * @returns {string} Decoded text
     */
    function hexToText(hex) {
        const cleaned = hex.replace(/0x/gi, ' ').replace(/[,:]/g, ' ');
        const bytes = splitTokens(cleaned, 2);

        for (const byte of bytes) {
            if (!/^[0-9a-fA-F]{1,2}$/.test(byte)) {
                throw new Error('Invalid hexadecimal format. Use byte pairs of 0-9 and A-F.');
            }
        }

        return bytesToText(bytes.map(byte => parseInt(byte, 16)));
    }

    /**
     * Convert text to Base64
     * @param {string} text - Input text
     * @returns {string} Base64 encoded string
     */
    function textToBase64(text) {
        // Handle Unicode characters properly
        const bytes = new TextEncoder().encode(text);
        let binary = '';
        bytes.forEach(byte => binary += String.fromCharCode(byte));
        return btoa(binary);
    }

    /**
     * Convert Base64 to text
     * @param {string} base64 - Base64 encoded string
     * @returns {string} Decoded text
     */
    function base64ToText(base64) {
        // Remove whitespace
        const cleaned = base64.trim().replace(/\s+/g, '');

        // Validate Base64 format
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
            throw new Error('Invalid Base64 format.');
        }

        try {
            const binary = atob(cleaned);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return new TextDecoder().decode(bytes);
        } catch (e) {
            throw new Error('Invalid Base64 format.');
        }
    }

    /**
     * Convert text to ASCII85 (also known as Base85)
     * @param {string} text - Input text
     * @returns {string} ASCII85 encoded string
     */
    function textToAscii85(text) {
        const bytes = new TextEncoder().encode(text);
        let result = '<~';

        // Process 4 bytes at a time
        for (let i = 0; i < bytes.length; i += 4) {
            let chunk = 0;
            let chunkLen = Math.min(4, bytes.length - i);

            // Build 32-bit value from up to 4 bytes
            for (let j = 0; j < 4; j++) {
                chunk = chunk * 256 + (j < chunkLen ? bytes[i + j] : 0);
            }

            // Special case: 4 zero bytes become 'z'
            if (chunk === 0 && chunkLen === 4) {
                result += 'z';
            } else {
                // Convert to base-85
                let encoded = '';
                for (let j = 0; j < 5; j++) {
                    encoded = String.fromCharCode(33 + (chunk % 85)) + encoded;
                    chunk = Math.floor(chunk / 85);
                }
                // Only output as many characters as needed
                result += encoded.substring(0, chunkLen + 1);
            }
        }

        result += '~>';
        return result;
    }

    /**
     * Convert ASCII85 to text
     * @param {string} ascii85 - ASCII85 encoded string
     * @returns {string} Decoded text
     */
    function ascii85ToText(ascii85) {
        // Remove whitespace
        let data = ascii85.trim().replace(/\s+/g, '');

        // Remove delimiters if present
        if (data.startsWith('<~')) {
            data = data.substring(2);
        }
        if (data.endsWith('~>')) {
            data = data.substring(0, data.length - 2);
        }

        const result = [];
        let i = 0;

        while (i < data.length) {
            // Handle 'z' special case (4 zero bytes)
            if (data[i] === 'z') {
                result.push(0, 0, 0, 0);
                i++;
                continue;
            }

            // Get up to 5 characters
            let chunk = 0;
            let chunkLen = Math.min(5, data.length - i);

            for (let j = 0; j < chunkLen; j++) {
                const charCode = data.charCodeAt(i + j) - 33;
                if (charCode < 0 || charCode > 84) {
                    throw new Error('Invalid ASCII85 character.');
                }
                chunk = chunk * 85 + charCode;
            }

            // Pad with 'u' (84) if less than 5 characters
            for (let j = chunkLen; j < 5; j++) {
                chunk = chunk * 85 + 84;
            }

            // Extract bytes (big-endian)
            const bytes = [
                (chunk >> 24) & 0xFF,
                (chunk >> 16) & 0xFF,
                (chunk >> 8) & 0xFF,
                chunk & 0xFF
            ];

            // Only output as many bytes as encoded
            for (let j = 0; j < chunkLen - 1; j++) {
                result.push(bytes[j]);
            }

            i += chunkLen;
        }

        return new TextDecoder().decode(new Uint8Array(result));
    }

    /**
     * Encode the input based on current mode
     */
    function encode() {
        const input = inputField.value;

        if (!input.trim()) {
            showOutput('No input data provided.', true);
            return;
        }

        try {
            let result;
            switch (currentMode) {
                case 'binary':
                    result = textToBinary(input);
                    break;
                case 'hex':
                    result = textToHex(input);
                    break;
                case 'base64':
                    result = textToBase64(input);
                    break;
                case 'ascii85':
                    result = textToAscii85(input);
                    break;
                default:
                    result = textToBinary(input);
            }
            showOutput(result);
            animateOutput();
        } catch (error) {
            showOutput(`Error: ${error.message}`, true);
        }
    }

    /**
     * Decode the input based on current mode
     */
    function decode() {
        const input = inputField.value;

        if (!input.trim()) {
            showOutput('No input data provided.', true);
            return;
        }

        try {
            let result;
            switch (currentMode) {
                case 'binary':
                    result = binaryToText(input);
                    break;
                case 'hex':
                    result = hexToText(input);
                    break;
                case 'base64':
                    result = base64ToText(input);
                    break;
                case 'ascii85':
                    result = ascii85ToText(input);
                    break;
                default:
                    result = binaryToText(input);
            }
            showOutput(result);
            animateOutput();
        } catch (error) {
            showOutput(`Error: ${error.message}`, true);
        }
    }

    /**
     * Clear input and output fields
     */
    function clearFields() {
        inputField.value = '';
        outputField.innerHTML = '<span class="output-placeholder">Awaiting input...</span>';
        copyBtn.classList.add('hidden');
    }

    /**
     * Display output result
     * @param {string} text - Output text
     * @param {boolean} isError - Whether this is an error message
     */
    function showOutput(text, isError = false) {
        if (isError) {
            outputField.innerHTML = `<span class="text-red">${escapeHtml(text)}</span>`;
            copyBtn.classList.add('hidden');
        } else {
            outputField.innerHTML = `<span class="text-cyan">${escapeHtml(text)}</span>`;
            copyBtn.classList.remove('hidden');
        }
    }

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
     * Animate the output display
     */
    function animateOutput() {
        outputField.style.animation = 'none';
        outputField.offsetHeight; // Trigger reflow
        outputField.style.animation = 'glitch 0.3s ease';
    }

    /**
     * Copy output to clipboard
     */
    async function copyToClipboard() {
        const outputText = outputField.textContent;

        if (!outputText || outputText === 'Awaiting input...') {
            return;
        }

        const ok = await Utils.copyText(outputText);
        if (!ok) return;

        // Visual feedback
        const originalText = copyBtn.querySelector('.copy-text').textContent;
        copyBtn.querySelector('.copy-text').textContent = 'COPIED!';
        copyBtn.classList.add('copied');

        setTimeout(() => {
            copyBtn.querySelector('.copy-text').textContent = originalText;
            copyBtn.classList.remove('copied');
        }, 2000);
    }

    /**
     * Set the encoding mode
     * @param {string} mode - 'binary', 'hex', 'base64', or 'ascii85'
     */
    function setMode(mode) {
        currentMode = mode;

        // Update button states
        modeButtons.forEach(btn => {
            if (btn.dataset.mode === mode) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    /**
     * Handle mode button click
     * @param {Event} event - Click event
     */
    function handleModeClick(event) {
        const mode = event.currentTarget.dataset.mode;
        setMode(mode);
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        // Mode buttons
        modeButtons.forEach(btn => {
            btn.addEventListener('click', handleModeClick);
        });

        // Action buttons
        encodeBtn.addEventListener('click', encode);
        decodeBtn.addEventListener('click', decode);
        clearBtn.addEventListener('click', clearFields);
        copyBtn.addEventListener('click', copyToClipboard);

        // Keyboard shortcuts
        inputField.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    encode();
                }
            }
        });
    }

    /**
     * Initialize the encoder module
     */
    function init() {
        initEventListeners();
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose encoder functions globally
    window.Encoder = {
        encode,
        decode,
        setMode,
        clear: clearFields
    };

})();
