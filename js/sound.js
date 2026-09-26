/**
 * NETRUNNER TERMINAL - Sound Engine
 * Web Audio synthesized effects, no audio assets required
 */

(function() {
    'use strict';

    let ctx = null;
    let noiseBuffer = null;
    let master = null;
    let muted = localStorage.getItem('ct_muted') === '1';
    const muteListeners = [];

    /**
     * Get or create the shared AudioContext
     * @returns {AudioContext|null}
     */
    function getContext() {
        if (!ctx) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ctx = new AC();
        }
        if (ctx.state === 'suspended') {
            ctx.resume();
        }
        return ctx;
    }

    /**
     * Shared output node honoring the mute toggle. Long running sources
     * (tuner static, morse playback, carrier tones) connect here instead
     * of the destination, so SND:OFF silences them mid-playback too.
     * @returns {GainNode|null}
     */
    function getOutput() {
        const c = getContext();
        if (!c) return null;
        if (!master) {
            master = c.createGain();
            master.gain.value = muted ? 0 : 1;
            master.connect(c.destination);
        }
        return master;
    }

    /**
     * Get a cached one second white noise buffer
     */
    function getNoiseBuffer() {
        const c = getContext();
        if (!c) return null;
        if (!noiseBuffer) {
            noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++) {
                data[i] = Math.random() * 2 - 1;
            }
        }
        return noiseBuffer;
    }

    /**
     * Play a short synthesized tone
     * @param {number} freq - Frequency in Hz
     * @param {number} duration - Duration in seconds
     * @param {Object} options - type, endFreq, volume, delay
     */
    function tone(freq, duration, options = {}) {
        if (muted) return;
        const c = getContext();
        if (!c) return;

        const osc = c.createOscillator();
        const gain = c.createGain();
        const start = c.currentTime + (options.delay || 0);

        osc.type = options.type || 'square';
        osc.frequency.setValueAtTime(freq, start);
        if (options.endFreq) {
            osc.frequency.exponentialRampToValueAtTime(options.endFreq, start + duration);
        }

        const volume = options.volume || 0.05;
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(start);
        osc.stop(start + duration + 0.05);
    }

    /**
     * Play a white noise burst
     * @param {number} duration - Duration in seconds
     * @param {number} volume - Peak volume
     * @param {number} delay - Delay in seconds
     */
    function burst(duration, volume = 0.08, delay = 0) {
        if (muted) return;
        const c = getContext();
        const buffer = getNoiseBuffer();
        if (!c || !buffer) return;

        const source = c.createBufferSource();
        const gain = c.createGain();
        const start = c.currentTime + delay;

        source.buffer = buffer;
        gain.gain.setValueAtTime(volume, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

        source.connect(gain);
        gain.connect(c.destination);
        source.start(start);
        source.stop(start + duration + 0.05);
    }

    function click() {
        tone(900, 0.04, { volume: 0.04 });
    }

    function keyTick() {
        tone(1400, 0.015, { volume: 0.015 });
    }

    function confirm() {
        tone(600, 0.08, { volume: 0.05 });
        tone(950, 0.12, { volume: 0.05, delay: 0.09 });
    }

    function error() {
        tone(220, 0.2, { type: 'sawtooth', endFreq: 90, volume: 0.07 });
    }

    function alarm() {
        for (let i = 0; i < 3; i++) {
            tone(750, 0.12, { volume: 0.06, delay: i * 0.28 });
            tone(950, 0.12, { volume: 0.06, delay: i * 0.28 + 0.14 });
        }
    }

    function staticBurst(duration = 0.3) {
        burst(duration, 0.07);
    }

    function glitch() {
        burst(0.12, 0.06);
        tone(400, 0.15, { type: 'sawtooth', endFreq: 60, volume: 0.04 });
    }

    function isMuted() {
        return muted;
    }

    function setMuted(value) {
        muted = !!value;
        localStorage.setItem('ct_muted', muted ? '1' : '0');
        if (master && ctx) {
            master.gain.setValueAtTime(muted ? 0 : 1, ctx.currentTime);
        }
        muteListeners.forEach(listener => listener(muted));
    }

    /**
     * Register a callback for mute changes
     * @param {function} listener - Called with the new muted state
     */
    function onMuteChange(listener) {
        muteListeners.push(listener);
    }

    function toggleMute() {
        setMuted(!muted);
        return muted;
    }

    // Unlock the audio context on first user gesture
    document.addEventListener('pointerdown', () => getContext(), { once: true });
    document.addEventListener('keydown', () => getContext(), { once: true });

    window.Sound = {
        getContext,
        getOutput,
        getNoiseBuffer,
        click,
        keyTick,
        confirm,
        error,
        alarm,
        staticBurst,
        glitch,
        isMuted,
        setMuted,
        toggleMute,
        onMuteChange
    };

})();
