/**
 * NETRUNNER TERMINAL - Morse Transceiver Module
 * Text/morse conversion with audio playback
 */

(function() {
    'use strict';

    const MORSE_MAP = {
        'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
        'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
        'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
        'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
        'Y': '-.--', 'Z': '--..',
        '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
        '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
        '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-',
        '-': '-....-', ':': '---...', "'": '.----.', '"': '.-..-.', '@': '.--.-.'
    };

    const REVERSE_MAP = Object.fromEntries(
        Object.entries(MORSE_MAP).map(([k, v]) => [v, k])
    );

    const TONE_FREQ = 700;

    let inputEl = null;
    let outputEl = null;
    let toBtn = null;
    let fromBtn = null;
    let playBtn = null;
    let stopBtn = null;
    let wpmSelect = null;
    let copyBtn = null;

    let lastOutput = '';
    let activeStop = null;

    /**
     * Encode text to morse code
     * @param {string} text - Plain text
     * @returns {string} Morse string, words separated by /
     */
    function encode(text) {
        return text.trim().toUpperCase().split(/\s+/).map(word =>
            word.split('').map(char => MORSE_MAP[char] || '').filter(Boolean).join(' ')
        ).filter(Boolean).join(' / ');
    }

    /**
     * Decode morse code to text
     * @param {string} morse - Morse string (. - separated by spaces, / between words)
     * @returns {string} Decoded text
     */
    function decode(morse) {
        if (!/^[.\-\s/]+$/.test(morse.trim())) {
            throw new Error('Invalid morse. Use only dots, dashes, spaces and / between words.');
        }

        return morse.trim().split(/\s*\/\s*/).map(word =>
            word.trim().split(/\s+/).map(code => REVERSE_MAP[code] || '?').join('')
        ).join(' ');
    }

    /**
     * Build on/off timing segments for a morse string
     * @param {string} morse - Morse string
     * @returns {Object[]} Segments with {on, units}
     */
    function timings(morse) {
        const segments = [];
        const words = morse.trim().split(/\s*\/\s*/);

        words.forEach((word, wi) => {
            const letters = word.trim().split(/\s+/);
            letters.forEach((letter, li) => {
                letter.split('').forEach((symbol, si) => {
                    segments.push({ on: true, units: symbol === '-' ? 3 : 1 });
                    if (si < letter.length - 1) segments.push({ on: false, units: 1 });
                });
                if (li < letters.length - 1) segments.push({ on: false, units: 3 });
            });
            if (wi < words.length - 1) segments.push({ on: false, units: 7 });
        });

        return segments;
    }

    /**
     * Play a morse string through the shared audio context
     * @param {string} morse - Morse string
     * @param {number} wpm - Words per minute
     * @param {number} volume - Playback volume
     * @returns {Object|null} {duration, stop} or null if audio unavailable
     */
    function play(morse, wpm = 12, volume = 0.08) {
        const ctx = Sound.getContext();
        if (!ctx) return null;

        const unit = 1.2 / wpm;
        const segments = timings(morse);
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.value = TONE_FREQ;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        osc.connect(gain);
        gain.connect(ctx.destination);

        let t = ctx.currentTime + 0.1;
        segments.forEach(segment => {
            if (segment.on) {
                gain.gain.setValueAtTime(volume, t);
                gain.gain.setValueAtTime(0, t + segment.units * unit);
            }
            t += segment.units * unit;
        });

        osc.start();
        osc.stop(t + 0.1);

        const duration = t - ctx.currentTime;
        return {
            duration: duration,
            stop: () => {
                try {
                    gain.gain.cancelScheduledValues(ctx.currentTime);
                    gain.gain.setValueAtTime(0, ctx.currentTime);
                    osc.stop();
                } catch (error) {
                    // Already stopped
                }
            }
        };
    }

    /**
     * Display output text
     * @param {string} text - Output text
     * @param {boolean} isError - Whether this is an error
     */
    function showOutput(text, isError = false) {
        lastOutput = isError ? '' : text;
        outputEl.innerHTML = '<span class="' + (isError ? 'text-red' : 'text-cyan') + '">' +
            Utils.escapeHtml(text) + '</span>';
        copyBtn.classList.toggle('hidden', isError);
        playBtn.disabled = isError || !/[.\-]/.test(text);
    }

    /**
     * Stop any active playback
     */
    function stopPlayback() {
        if (activeStop) {
            activeStop();
            activeStop = null;
        }
        stopBtn.disabled = true;
    }

    /**
     * Initialize the module
     */
    function init() {
        inputEl = document.getElementById('morse-input');
        outputEl = document.getElementById('morse-output');
        toBtn = document.getElementById('morse-to-btn');
        fromBtn = document.getElementById('morse-from-btn');
        playBtn = document.getElementById('morse-play-btn');
        stopBtn = document.getElementById('morse-stop-btn');
        wpmSelect = document.getElementById('morse-wpm');
        copyBtn = document.getElementById('morse-copy-btn');
        if (!inputEl) return;

        toBtn.addEventListener('click', () => {
            const input = inputEl.value;
            if (!input.trim()) {
                showOutput('No input message provided.', true);
                return;
            }
            showOutput(encode(input));
        });

        fromBtn.addEventListener('click', () => {
            const input = inputEl.value;
            if (!input.trim()) {
                showOutput('No input message provided.', true);
                return;
            }
            try {
                showOutput(decode(input));
                playBtn.disabled = true;
            } catch (error) {
                showOutput('Error: ' + error.message, true);
            }
        });

        playBtn.addEventListener('click', () => {
            stopPlayback();
            const morse = lastOutput;
            if (!morse) return;

            const playback = play(morse, parseInt(wpmSelect.value, 10));
            if (!playback) return;

            activeStop = playback.stop;
            stopBtn.disabled = false;
            setTimeout(stopPlayback, playback.duration * 1000 + 200);
        });

        stopBtn.addEventListener('click', stopPlayback);
        Utils.bindCopyButton(copyBtn, () => lastOutput);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Shared helpers for the signal tuner
    window.Morse = {
        encode,
        decode,
        timings,
        play
    };

})();
