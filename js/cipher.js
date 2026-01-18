/**
 * NETRUNNER TERMINAL - Cipher Decoder Module
 * Classic cryptography toolkit: Caesar, Vigenère, Atbash, and Substitution ciphers
 */

(function() {
    'use strict';

    // DOM Elements
    const cipherModeButtons = document.querySelectorAll('[data-cipher]');
    const keyInput = document.getElementById('cipher-key');
    const keyLabel = document.getElementById('cipher-key-label');
    const inputField = document.getElementById('cipher-input');
    const outputField = document.getElementById('cipher-output');
    const encryptBtn = document.getElementById('encrypt-btn');
    const decryptBtn = document.getElementById('decrypt-btn');
    const clearBtn = document.getElementById('cipher-clear-btn');
    const copyBtn = document.getElementById('cipher-copy-btn');

    // Current cipher method
    let currentCipher = 'caesar';

    // Key configuration for each cipher
    const cipherConfig = {
        caesar: {
            label: '// SHIFT KEY (1-25)',
            placeholder: 'Enter shift number...',
            showKey: true
        },
        vigenere: {
            label: '// KEYWORD',
            placeholder: 'Enter keyword (letters only)...',
            showKey: true
        },
        atbash: {
            label: '// NO KEY REQUIRED',
            placeholder: 'Atbash uses no key',
            showKey: false
        },
        substitution: {
            label: '// SUBSTITUTION ALPHABET (26 letters)',
            placeholder: 'Enter 26-letter alphabet (e.g., ZYXWVUTSRQPONMLKJIHGFEDCBA)...',
            showKey: true
        }
    };

    /**
     * Caesar cipher - shift letters by N positions
     * @param {string} text - Input text
     * @param {number} shift - Number of positions to shift (1-25)
     * @param {boolean} decrypt - True to decrypt, false to encrypt
     * @returns {string} Encrypted/decrypted text
     */
    function caesarCipher(text, shift, decrypt = false) {
        // Parse and validate shift
        const shiftNum = parseInt(shift, 10);
        if (isNaN(shiftNum) || shiftNum < 1 || shiftNum > 25) {
            throw new Error('Invalid shift value. Use a number between 1 and 25.');
        }

        // If decrypting, reverse the shift
        const actualShift = decrypt ? (26 - shiftNum) : shiftNum;

        return text.split('').map(char => {
            // Handle uppercase letters
            if (char >= 'A' && char <= 'Z') {
                return String.fromCharCode(((char.charCodeAt(0) - 65 + actualShift) % 26) + 65);
            }
            // Handle lowercase letters
            if (char >= 'a' && char <= 'z') {
                return String.fromCharCode(((char.charCodeAt(0) - 97 + actualShift) % 26) + 97);
            }
            // Non-alphabetic characters remain unchanged
            return char;
        }).join('');
    }

    /**
     * Vigenère cipher - polyalphabetic cipher with keyword
     * @param {string} text - Input text
     * @param {string} key - Keyword (letters only)
     * @param {boolean} decrypt - True to decrypt, false to encrypt
     * @returns {string} Encrypted/decrypted text
     */
    function vigenereCipher(text, key, decrypt = false) {
        // Validate key
        const cleanKey = key.toUpperCase().replace(/[^A-Z]/g, '');
        if (cleanKey.length === 0) {
            throw new Error('Invalid key. Use letters only.');
        }

        let keyIndex = 0;

        return text.split('').map(char => {
            const isUpper = char >= 'A' && char <= 'Z';
            const isLower = char >= 'a' && char <= 'z';

            if (!isUpper && !isLower) {
                return char;
            }

            const charCode = char.toUpperCase().charCodeAt(0) - 65;
            const keyShift = cleanKey.charCodeAt(keyIndex % cleanKey.length) - 65;
            keyIndex++;

            let newCharCode;
            if (decrypt) {
                newCharCode = (charCode - keyShift + 26) % 26;
            } else {
                newCharCode = (charCode + keyShift) % 26;
            }

            const newChar = String.fromCharCode(newCharCode + 65);
            return isLower ? newChar.toLowerCase() : newChar;
        }).join('');
    }

    /**
     * Atbash cipher - reversed alphabet (A↔Z, B↔Y, etc.)
     * @param {string} text - Input text
     * @returns {string} Encrypted/decrypted text (same operation for both)
     */
    function atbashCipher(text) {
        return text.split('').map(char => {
            // Handle uppercase letters
            if (char >= 'A' && char <= 'Z') {
                return String.fromCharCode(90 - (char.charCodeAt(0) - 65));
            }
            // Handle lowercase letters
            if (char >= 'a' && char <= 'z') {
                return String.fromCharCode(122 - (char.charCodeAt(0) - 97));
            }
            // Non-alphabetic characters remain unchanged
            return char;
        }).join('');
    }

    /**
     * Substitution cipher - custom alphabet replacement
     * @param {string} text - Input text
     * @param {string} alphabet - 26-letter substitution alphabet
     * @param {boolean} decrypt - True to decrypt, false to encrypt
     * @returns {string} Encrypted/decrypted text
     */
    function substitutionCipher(text, alphabet, decrypt = false) {
        // Validate alphabet
        const cleanAlphabet = alphabet.toUpperCase().replace(/[^A-Z]/g, '');
        if (cleanAlphabet.length !== 26) {
            throw new Error('Invalid alphabet. Must contain exactly 26 unique letters.');
        }

        // Check for duplicate letters
        const uniqueLetters = new Set(cleanAlphabet.split(''));
        if (uniqueLetters.size !== 26) {
            throw new Error('Invalid alphabet. Each letter must appear exactly once.');
        }

        const standardAlphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

        return text.split('').map(char => {
            const isUpper = char >= 'A' && char <= 'Z';
            const isLower = char >= 'a' && char <= 'z';

            if (!isUpper && !isLower) {
                return char;
            }

            const upperChar = char.toUpperCase();
            let newChar;

            if (decrypt) {
                // Find position in substitution alphabet, get corresponding standard letter
                const pos = cleanAlphabet.indexOf(upperChar);
                newChar = standardAlphabet[pos];
            } else {
                // Find position in standard alphabet, get corresponding substitution letter
                const pos = standardAlphabet.indexOf(upperChar);
                newChar = cleanAlphabet[pos];
            }

            return isLower ? newChar.toLowerCase() : newChar;
        }).join('');
    }

    /**
     * Encrypt the input based on current cipher method
     */
    function encrypt() {
        const input = inputField.value;
        const key = keyInput.value;

        if (!input.trim()) {
            showOutput('No input message provided.', true);
            return;
        }

        try {
            let result;
            switch (currentCipher) {
                case 'caesar':
                    result = caesarCipher(input, key, false);
                    break;
                case 'vigenere':
                    result = vigenereCipher(input, key, false);
                    break;
                case 'atbash':
                    result = atbashCipher(input);
                    break;
                case 'substitution':
                    result = substitutionCipher(input, key, false);
                    break;
                default:
                    result = caesarCipher(input, key, false);
            }
            showOutput(result);
            animateOutput();
        } catch (error) {
            showOutput(`Error: ${error.message}`, true);
        }
    }

    /**
     * Decrypt the input based on current cipher method
     */
    function decrypt() {
        const input = inputField.value;
        const key = keyInput.value;

        if (!input.trim()) {
            showOutput('No input message provided.', true);
            return;
        }

        try {
            let result;
            switch (currentCipher) {
                case 'caesar':
                    result = caesarCipher(input, key, true);
                    break;
                case 'vigenere':
                    result = vigenereCipher(input, key, true);
                    break;
                case 'atbash':
                    // Atbash is its own inverse
                    result = atbashCipher(input);
                    break;
                case 'substitution':
                    result = substitutionCipher(input, key, true);
                    break;
                default:
                    result = caesarCipher(input, key, true);
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
        keyInput.value = '';
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

        try {
            await navigator.clipboard.writeText(outputText);

            // Visual feedback
            const originalText = copyBtn.querySelector('.copy-text').textContent;
            copyBtn.querySelector('.copy-text').textContent = 'COPIED!';
            copyBtn.classList.add('copied');

            setTimeout(() => {
                copyBtn.querySelector('.copy-text').textContent = originalText;
                copyBtn.classList.remove('copied');
            }, 2000);
        } catch (error) {
            console.error('Failed to copy:', error);
        }
    }

    /**
     * Set the cipher method
     * @param {string} cipher - 'caesar', 'vigenere', 'atbash', or 'substitution'
     */
    function setCipher(cipher) {
        currentCipher = cipher;

        // Update button states
        cipherModeButtons.forEach(btn => {
            if (btn.dataset.cipher === cipher) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update key input based on cipher
        const config = cipherConfig[cipher];
        keyLabel.textContent = config.label;
        keyInput.placeholder = config.placeholder;

        if (config.showKey) {
            keyInput.disabled = false;
            keyInput.style.opacity = '1';
        } else {
            keyInput.disabled = true;
            keyInput.value = '';
            keyInput.style.opacity = '0.5';
        }
    }

    /**
     * Handle cipher mode button click
     * @param {Event} event - Click event
     */
    function handleCipherClick(event) {
        const cipher = event.currentTarget.dataset.cipher;
        setCipher(cipher);
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        // Cipher mode buttons
        cipherModeButtons.forEach(btn => {
            btn.addEventListener('click', handleCipherClick);
        });

        // Action buttons
        encryptBtn.addEventListener('click', encrypt);
        decryptBtn.addEventListener('click', decrypt);
        clearBtn.addEventListener('click', clearFields);
        copyBtn.addEventListener('click', copyToClipboard);

        // Keyboard shortcuts
        inputField.addEventListener('keydown', (event) => {
            if (event.ctrlKey || event.metaKey) {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    encrypt();
                }
            }
        });
    }

    /**
     * Initialize the cipher module
     */
    function init() {
        initEventListeners();
        // Set default cipher (Caesar)
        setCipher('caesar');
    }

    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose cipher functions globally
    window.Cipher = {
        encrypt,
        decrypt,
        setCipher,
        clear: clearFields,
        // Expose individual cipher functions for testing
        caesarCipher,
        vigenereCipher,
        atbashCipher,
        substitutionCipher
    };

})();
