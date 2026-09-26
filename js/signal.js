/**
 * NETRUNNER TERMINAL - Signal Tuner Module
 * Sweep a radio band for GM-hidden broadcasts: audio clips,
 * morse transmissions or carrier tones defined in data/signals.json
 */

(function() {
    'use strict';

    const DEFAULT_BAND = { min: 88.0, max: 108.0, step: 0.1, unit: 'MHz' };
    const METER_SEGMENTS = 8;
    const DISCOVERY_FACTOR = 6;

    let sectionEl = null;
    let powerBtn = null;
    let sliderEl = null;
    let freqDisplay = null;
    let meterEl = null;
    let labelEl = null;
    let canvas = null;
    let canvasCtx = null;
    let bandInfoEl = null;

    let band = DEFAULT_BAND;
    let signals = [];
    let loaded = false;

    let powered = false;
    let freq = DEFAULT_BAND.min;
    let noiseSource = null;
    let noiseGain = null;
    let content = null;
    let animFrame = null;

    /**
     * Find the nearest signal and tuning strength
     * @returns {Object} {signal, strength, locked}
     */
    function tuneState() {
        let best = null;
        let bestDist = Infinity;

        signals.forEach(signal => {
            const dist = Math.abs(freq - signal.freq);
            if (dist < bestDist) {
                bestDist = dist;
                best = signal;
            }
        });

        if (!best) return { signal: null, strength: 0, locked: false };

        const tolerance = best.tolerance || 0.2;
        const strength = Math.max(0, 1 - bestDist / (tolerance * DISCOVERY_FACTOR));
        return {
            signal: best,
            strength: strength,
            locked: bestDist <= tolerance
        };
    }

    /**
     * Start the background static noise
     */
    function startNoise() {
        const ctx = Sound.getContext();
        const output = Sound.getOutput();
        const buffer = Sound.getNoiseBuffer();
        if (!ctx || !output || !buffer) return;

        noiseSource = ctx.createBufferSource();
        noiseGain = ctx.createGain();
        noiseSource.buffer = buffer;
        noiseSource.loop = true;
        noiseGain.gain.value = 0.1;
        noiseSource.connect(noiseGain);
        noiseGain.connect(output);
        noiseSource.start();
    }

    /**
     * Stop the background static noise
     */
    function stopNoise() {
        if (noiseSource) {
            try { noiseSource.stop(); } catch (error) { /* already stopped */ }
            noiseSource = null;
            noiseGain = null;
        }
    }

    /**
     * Start playing a locked signal's content
     * @param {Object} signal - Signal definition
     */
    function startContent(signal) {
        stopContent();
        content = { signal: signal, stop: null, timer: null, audio: null };

        if (signal.type === 'audio' && signal.src) {
            const audio = new Audio(signal.src);
            audio.loop = true;
            audio.volume = 0.9;
            audio.muted = Sound.isMuted();
            audio.play().catch(() => { /* missing file or blocked autoplay */ });
            content.audio = audio;
        } else if (signal.type === 'morse' && signal.text) {
            const loop = () => {
                const playback = Morse.play(Morse.encode(signal.text), signal.wpm || 12, 0.09);
                if (!playback) return;
                content.stop = playback.stop;
                content.timer = setTimeout(loop, (playback.duration + 1.5) * 1000);
            };
            loop();
        } else if (signal.type === 'tone') {
            const ctx = Sound.getContext();
            const output = Sound.getOutput();
            if (!ctx || !output) return;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.value = signal.toneHz || 440;
            gain.gain.value = 0.06;
            osc.connect(gain);
            gain.connect(output);
            osc.start();
            content.stop = () => { try { osc.stop(); } catch (error) { /* stopped */ } };
        }
    }

    /**
     * Stop the current signal content
     */
    function stopContent() {
        if (!content) return;
        if (content.timer) clearTimeout(content.timer);
        if (content.stop) content.stop();
        if (content.audio) {
            content.audio.pause();
            content.audio.src = '';
        }
        content = null;
    }

    /**
     * Update meter, label and audio mix for the current frequency
     */
    function updateTuning() {
        freqDisplay.textContent = freq.toFixed(stepDecimals()) + ' ' + band.unit;
        const state = tuneState();

        // Meter segments
        // A powered-off receiver must not reveal where signals are
        let lit = 0;
        if (powered) {
            lit = state.locked ? METER_SEGMENTS : Math.round(state.strength * (METER_SEGMENTS - 1));
        }
        [...meterEl.children].forEach((segment, i) => {
            segment.className = 'meter-segment' +
                (i < lit ? (state.locked ? ' locked' : ' lit') : '');
        });

        if (!powered) {
            labelEl.textContent = '// RECEIVER OFFLINE';
            return;
        }

        if (state.locked && state.signal) {
            labelEl.textContent = '>> SIGNAL LOCK: ' + (state.signal.label || 'UNIDENTIFIED BROADCAST');
            labelEl.classList.add('locked');
            if (!content || content.signal !== state.signal) {
                startContent(state.signal);
            }
            if (noiseGain) noiseGain.gain.value = 0.012;
        } else {
            labelEl.textContent = state.strength > 0.35 ? '// CARRIER DETECTED... KEEP TUNING' : '// SCANNING BAND';
            labelEl.classList.remove('locked');
            stopContent();
            if (noiseGain) noiseGain.gain.value = 0.1 * (1 - state.strength * 0.8) + 0.01;
        }
    }

    /**
     * Draw the spectrum scanner window around the tuned frequency
     */
    function drawScanner() {
        if (!powered) return;

        // Auto power off if the section was left
        if (sectionEl.classList.contains('hidden')) {
            setPowered(false);
            return;
        }

        const w = canvas.width;
        const h = canvas.height;
        const windowSpan = 2.0;

        canvasCtx.fillStyle = '#0a0a0a';
        canvasCtx.fillRect(0, 0, w, h);

        for (let x = 0; x < w; x += 2) {
            const fx = freq - windowSpan + (x / w) * windowSpan * 2;
            let amplitude = Math.random() * 0.15;

            signals.forEach(signal => {
                const tolerance = signal.tolerance || 0.2;
                const d = (fx - signal.freq) / tolerance;
                amplitude += Math.exp(-d * d) * (0.65 + Math.random() * 0.2);
            });

            amplitude = Math.min(1, amplitude);
            const barHeight = amplitude * (h - 10);
            canvasCtx.fillStyle = amplitude > 0.5 ? '#00f0ff' : 'rgba(0, 240, 255, 0.35)';
            canvasCtx.fillRect(x, h - barHeight, 2, barHeight);
        }

        // Center tuning marker
        canvasCtx.strokeStyle = '#ff3a3a';
        canvasCtx.beginPath();
        canvasCtx.moveTo(w / 2, 0);
        canvasCtx.lineTo(w / 2, h);
        canvasCtx.stroke();

        animFrame = requestAnimationFrame(drawScanner);
    }

    /**
     * Toggle receiver power
     * @param {boolean} on - Target state
     */
    function setPowered(on) {
        powered = on;
        powerBtn.classList.toggle('active', on);
        powerBtn.querySelector('.btn-text').textContent = on ? 'POWER: ON' : 'POWER: OFF';

        if (on) {
            startNoise();
            drawScanner();
        } else {
            stopNoise();
            stopContent();
            if (animFrame) cancelAnimationFrame(animFrame);
            canvasCtx.fillStyle = '#0a0a0a';
            canvasCtx.fillRect(0, 0, canvas.width, canvas.height);
        }
        updateTuning();
    }

    /**
     * Decimal places needed to display the band step (0.1 -> 1, 0.05 -> 2)
     * @returns {number}
     */
    function stepDecimals() {
        const text = String(band.step);
        return text.includes('.') ? text.split('.')[1].length : 0;
    }

    /**
     * Set the tuned frequency, clamped to the band
     * @param {number} value - Frequency
     */
    function setFreq(value) {
        const snapped = Math.round(value / band.step) * band.step;
        // Strip floating point noise (88.1 instead of 88.10000000000001)
        freq = Math.min(band.max, Math.max(band.min, parseFloat(snapped.toFixed(stepDecimals()))));
        sliderEl.value = freq;
        updateTuning();
    }

    /**
     * Band readout, flagging that broadcasts are inaudible while muted
     */
    function updateBandInfo() {
        bandInfoEl.textContent = 'BAND: ' + band.min + ' - ' + band.max + ' ' + band.unit +
            (Sound.isMuted() ? '  //  SND:OFF' : '');
        bandInfoEl.classList.toggle('muted', Sound.isMuted());
    }

    /**
     * Called when the section is opened
     */
    async function onEnter() {
        // Always refetch so GM edits made mid-session show up
        const data = await DataLoader.load('signals', true);
        const newBand = Object.assign({}, DEFAULT_BAND, (data && data.band) || {});
        signals = ((data && data.signals) || []).filter(signal => signal && typeof signal.freq === 'number');

        const bandChanged = !loaded || newBand.min !== band.min ||
            newBand.max !== band.max || newBand.step !== band.step;
        band = newBand;

        if (bandChanged) {
            sliderEl.min = band.min;
            sliderEl.max = band.max;
            sliderEl.step = band.step;
            freq = band.min;
            sliderEl.value = freq;
            updateBandInfo();
        }
        loaded = true;
        updateTuning();
    }

    /**
     * Initialize the module
     */
    function init() {
        sectionEl = document.getElementById('signal-section');
        powerBtn = document.getElementById('signal-power');
        sliderEl = document.getElementById('signal-slider');
        freqDisplay = document.getElementById('signal-freq-display');
        meterEl = document.getElementById('signal-meter');
        labelEl = document.getElementById('signal-label');
        canvas = document.getElementById('signal-canvas');
        bandInfoEl = document.getElementById('signal-band-info');
        if (!powerBtn) return;

        canvasCtx = canvas.getContext('2d');

        for (let i = 0; i < METER_SEGMENTS; i++) {
            const segment = document.createElement('span');
            segment.className = 'meter-segment';
            meterEl.appendChild(segment);
        }

        powerBtn.addEventListener('click', () => setPowered(!powered));

        // Audio clips play through an <audio> element, outside the Web Audio mute
        Sound.onMuteChange(muted => {
            if (content && content.audio) content.audio.muted = muted;
            if (loaded) updateBandInfo();
        });
        sliderEl.addEventListener('input', () => setFreq(parseFloat(sliderEl.value)));
        document.getElementById('signal-fine-down').addEventListener('click', () => setFreq(freq - band.step));
        document.getElementById('signal-fine-up').addEventListener('click', () => setFreq(freq + band.step));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.SignalTuner = {
        onEnter
    };

})();
