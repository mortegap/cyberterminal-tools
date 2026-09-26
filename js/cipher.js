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
    const freqBtn = document.getElementById('freq-analyze-btn');
    const freqChart = document.getElementById('freq-chart');
    const bruteBtn = document.getElementById('brute-force-btn');
    const langSelect = document.getElementById('freq-lang');

    const LANG_KEY = 'ct_cipher_lang';
    const BRUTE_PREVIEW_CHARS = 120;

    // Expected letter frequencies in percent per reference language
    const LANGUAGES = {
        en: {
            label: 'ENGLISH',
            freq: {
                A: 8.2, B: 1.5, C: 2.8, D: 4.3, E: 12.7, F: 2.2, G: 2.0, H: 6.1,
                I: 7.0, J: 0.15, K: 0.77, L: 4.0, M: 2.4, N: 6.7, O: 7.5, P: 1.9,
                Q: 0.095, R: 6.0, S: 6.3, T: 9.1, U: 2.8, V: 0.98, W: 2.4, X: 0.15,
                Y: 2.0, Z: 0.074
            }
        },
        es: {
            label: 'SPANISH',
            freq: {
                A: 12.53, B: 1.42, C: 4.68, D: 5.86, E: 13.68, F: 0.69, G: 1.01, H: 0.70,
                I: 6.25, J: 0.44, K: 0.02, L: 4.97, M: 3.15, N: 6.71, O: 8.68, P: 2.51,
                Q: 0.88, R: 6.87, S: 7.98, T: 4.63, U: 3.93, V: 0.90, W: 0.01, X: 0.22,
                Y: 0.90, Z: 0.52
            }
        }
    };

    /**
     * Currently selected reference language
     * @returns {Object} Language definition
     */
    function currentLanguage() {
        return LANGUAGES[langSelect.value] || LANGUAGES.en;
    }

    /**
     * Uppercase A-Z letters only, with accents folded (Á -> A)
     * @param {string} text - Input text
     * @returns {string}
     */
    function lettersOnly(text) {
        return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toUpperCase().replace(/[^A-Z]/g, '');
    }

    /**
     * Negative log-likelihood of the text under a language letter
     * profile. Lower means more plausible plaintext. Rare letters are
     * floored so a single typo cannot outweigh the rest of the message.
     * @param {string} text - Candidate plaintext
     * @param {Object} freq - Expected frequencies in percent
     * @returns {number}
     */
    function languageScore(text, freq) {
        const letters = lettersOnly(text);
        if (!letters.length) return Infinity;

        let score = 0;
        for (const char of letters) {
            score -= Math.log(Math.max(freq[char], 0.1) / 100);
        }
        return score / letters.length;
    }

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
        freqChart.classList.add('hidden');
        freqChart.innerHTML = '';
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
     * Analyze letter frequency of the input message and render
     * a comparison chart against expected English frequencies
     */
    function analyzeFrequency() {
        const letters = lettersOnly(inputField.value);
        const language = currentLanguage();
        const referenceFreq = language.freq;

        if (!letters.length) {
            showOutput('No letters to analyze.', true);
            return;
        }

        const counts = {};
        for (const char of letters) {
            counts[char] = (counts[char] || 0) + 1;
        }

        const maxPct = Math.max(
            ...Object.values(referenceFreq),
            ...Object.values(counts).map(c => (c / letters.length) * 100)
        );

        freqChart.innerHTML = '';
        freqChart.classList.remove('hidden');

        const legend = document.createElement('div');
        legend.className = 'freq-legend';
        legend.innerHTML =
            '<span class="freq-legend-item input">&#9608; INPUT</span>' +
            '<span class="freq-legend-item english">&#9608; ' + language.label + '</span>' +
            '<span class="freq-legend-count">' + letters.length + ' letters analyzed</span>';
        freqChart.appendChild(legend);

        const bars = document.createElement('div');
        bars.className = 'freq-bars';

        for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
            const pct = ((counts[letter] || 0) / letters.length) * 100;
            const expected = referenceFreq[letter];

            const col = document.createElement('div');
            col.className = 'freq-col';
            col.innerHTML =
                '<div class="freq-col-bars">' +
                '    <div class="freq-bar input" style="height: ' + (pct / maxPct) * 100 + '%"></div>' +
                '    <div class="freq-bar english" style="height: ' + (expected / maxPct) * 100 + '%"></div>' +
                '</div>' +
                '<span class="freq-letter">' + letter + '</span>' +
                '<span class="freq-count">' + (counts[letter] || 0) + '</span>';
            bars.appendChild(col);
        }

        freqChart.appendChild(bars);
    }

    /**
     * Try all 25 Caesar shifts and rank them by how closely each
     * candidate matches the reference language letter profile
     */
    function bruteForce() {
        const input = inputField.value;
        if (!lettersOnly(input).length) {
            showOutput('No letters to brute force.', true);
            return;
        }

        const language = currentLanguage();
        const candidates = [];
        for (let shift = 1; shift <= 25; shift++) {
            const text = caesarCipher(input, shift, true);
            candidates.push({ shift, text, score: languageScore(text, language.freq) });
        }
        const best = candidates.reduce((a, b) => (b.score < a.score ? b : a));

        outputField.innerHTML = '';
        const hint = document.createElement('div');
        hint.className = 'brute-hint';
        hint.textContent = '// 25 SHIFTS TESTED vs ' + language.label + ' PROFILE. BEST MATCH HIGHLIGHTED. TAP A ROW TO APPLY IT.';
        outputField.appendChild(hint);

        candidates.forEach(candidate => {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'brute-row' + (candidate === best ? ' best' : '');

            const shiftEl = document.createElement('span');
            shiftEl.className = 'brute-shift';
            shiftEl.textContent = 'ROT-' + String(candidate.shift).padStart(2, '0');

            const textEl = document.createElement('span');
            textEl.className = 'brute-text';
            const flat = candidate.text.replace(/\s+/g, ' ');
            textEl.textContent = flat.length > BRUTE_PREVIEW_CHARS ? flat.slice(0, BRUTE_PREVIEW_CHARS) + '...' : flat;

            row.appendChild(shiftEl);
            row.appendChild(textEl);
            row.addEventListener('click', () => {
                setCipher('caesar');
                keyInput.value = String(candidate.shift);
                decrypt();
            });
            outputField.appendChild(row);
        });

        copyBtn.classList.add('hidden');
        animateOutput();
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
        bruteBtn.classList.toggle('hidden', cipher !== 'caesar');
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
        freqBtn.addEventListener('click', analyzeFrequency);
        bruteBtn.addEventListener('click', bruteForce);

        // Remember the reference language and refresh an open chart
        langSelect.addEventListener('change', () => {
            try {
                localStorage.setItem(LANG_KEY, langSelect.value);
            } catch (error) {
                // Storage unavailable, keep the choice for this session only
            }
            if (!freqChart.classList.contains('hidden')) analyzeFrequency();
        });

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
        try {
            const savedLang = localStorage.getItem(LANG_KEY);
            if (LANGUAGES[savedLang]) langSelect.value = savedLang;
        } catch (error) {
            // Storage unavailable, use the default language
        }
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
        bruteForce,
        // Expose individual cipher functions for testing
        caesarCipher,
        vigenereCipher,
        atbashCipher,
        substitutionCipher
    };

})();
