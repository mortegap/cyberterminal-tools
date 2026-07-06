/**
 * NETRUNNER TERMINAL - Spectrogram Analyzer Module
 * Audio frequency visualization tool to reveal hidden images in sound files
 */

(function() {
    'use strict';

    // DOM Elements
    const uploadArea = document.getElementById('upload-area');
    const audioFileInput = document.getElementById('audio-file');
    const fileInfo = document.getElementById('file-info');
    const fileName = document.getElementById('file-name');
    const clearFileBtn = document.getElementById('clear-file-btn');
    const fftSizeSelect = document.getElementById('fft-size');
    const colorSchemeSelect = document.getElementById('color-scheme');
    const analyzeBtn = document.getElementById('analyze-btn');
    const exportBtn = document.getElementById('export-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    const canvas = document.getElementById('spectrogram-canvas');
    const infoDuration = document.getElementById('info-duration');

    // State
    let audioBuffer = null;
    let currentFile = null;
    let lastSpectrogram = null;

    // Audio context (created on first user interaction)
    let audioContext = null;

    /**
     * Initialize Audio Context (must be triggered by user interaction)
     */
    function getAudioContext() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioContext;
    }

    /**
     * Color scheme functions
     * Each returns [r, g, b] for a magnitude value (0-1)
     */
    const colorSchemes = {
        cyber: function(magnitude) {
            // Black -> Dark Blue -> Cyan -> Magenta -> White
            const m = Math.pow(magnitude, 0.7); // Apply gamma for better visibility

            if (m < 0.25) {
                // Black to dark blue
                const t = m / 0.25;
                return [0, 0, Math.floor(50 * t)];
            } else if (m < 0.5) {
                // Dark blue to cyan
                const t = (m - 0.25) / 0.25;
                return [0, Math.floor(240 * t), Math.floor(50 + 205 * t)];
            } else if (m < 0.75) {
                // Cyan to magenta
                const t = (m - 0.5) / 0.25;
                return [Math.floor(255 * t), Math.floor(240 - 40 * t), Math.floor(255 - 55 * t)];
            } else {
                // Magenta to white
                const t = (m - 0.75) / 0.25;
                return [255, Math.floor(200 + 55 * t), Math.floor(200 + 55 * t)];
            }
        },

        heat: function(magnitude) {
            // Black -> Red -> Orange -> Yellow -> White
            const m = Math.pow(magnitude, 0.7);

            if (m < 0.25) {
                // Black to dark red
                const t = m / 0.25;
                return [Math.floor(180 * t), 0, 0];
            } else if (m < 0.5) {
                // Red to orange
                const t = (m - 0.25) / 0.25;
                return [Math.floor(180 + 75 * t), Math.floor(100 * t), 0];
            } else if (m < 0.75) {
                // Orange to yellow
                const t = (m - 0.5) / 0.25;
                return [255, Math.floor(100 + 155 * t), 0];
            } else {
                // Yellow to white
                const t = (m - 0.75) / 0.25;
                return [255, 255, Math.floor(255 * t)];
            }
        },

        grayscale: function(magnitude) {
            // Simple black to white
            const v = Math.floor(Math.pow(magnitude, 0.6) * 255);
            return [v, v, v];
        }
    };

    /**
     * Load and decode audio file
     * @param {File} file - The audio file to load
     * @returns {Promise<AudioBuffer>}
     */
    async function loadAudioFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = async function(e) {
                try {
                    const ctx = getAudioContext();
                    const arrayBuffer = e.target.result;
                    const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
                    resolve(decodedBuffer);
                } catch (error) {
                    reject(new Error('Failed to decode audio file. Ensure it is a valid audio format.'));
                }
            };

            reader.onerror = function() {
                reject(new Error('Failed to read file.'));
            };

            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Compute spectrogram data using FFT
     * @param {AudioBuffer} buffer - The decoded audio buffer
     * @param {number} fftSize - FFT window size (must be power of 2)
     * @param {function} onProgress - Progress callback (0-1)
     * @returns {Object} Spectrogram data with frequencies and magnitudes
     */
    function computeSpectrogram(buffer, fftSize, onProgress) {
        // Get mono channel data (average if stereo)
        let samples;
        if (buffer.numberOfChannels === 1) {
            samples = buffer.getChannelData(0);
        } else {
            // Mix down to mono
            const left = buffer.getChannelData(0);
            const right = buffer.getChannelData(1);
            samples = new Float32Array(left.length);
            for (let i = 0; i < left.length; i++) {
                samples[i] = (left[i] + right[i]) / 2;
            }
        }

        const sampleRate = buffer.sampleRate;
        const hopSize = fftSize / 4; // 75% overlap for better resolution
        const numWindows = Math.floor((samples.length - fftSize) / hopSize) + 1;
        const numBins = fftSize / 2; // Only positive frequencies

        // Initialize FFT
        const fft = new FFT(fftSize);
        const input = fft.createComplexArray();
        const output = fft.createComplexArray();

        // Spectrogram data: array of magnitude arrays (one per time window)
        const spectrogramData = [];

        // Hanning window function for smoothing
        const window = new Float32Array(fftSize);
        for (let i = 0; i < fftSize; i++) {
            window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
        }

        // Process each time window
        for (let w = 0; w < numWindows; w++) {
            const offset = w * hopSize;

            // Apply window and prepare input (real values to complex array)
            for (let i = 0; i < fftSize; i++) {
                const sampleIdx = offset + i;
                const sample = sampleIdx < samples.length ? samples[sampleIdx] : 0;
                input[i * 2] = sample * window[i];     // Real part
                input[i * 2 + 1] = 0;                   // Imaginary part
            }

            // Perform FFT
            fft.transform(output, input);

            // Compute magnitudes for positive frequencies
            const magnitudes = new Float32Array(numBins);
            for (let i = 0; i < numBins; i++) {
                const real = output[i * 2];
                const imag = output[i * 2 + 1];
                magnitudes[i] = Math.sqrt(real * real + imag * imag);
            }

            spectrogramData.push(magnitudes);

            // Report progress
            if (w % 100 === 0 && onProgress) {
                onProgress(w / numWindows);
            }
        }

        return {
            data: spectrogramData,
            numBins: numBins,
            numWindows: numWindows,
            sampleRate: sampleRate,
            duration: buffer.duration,
            maxFreq: sampleRate / 2
        };
    }

    /**
     * Render spectrogram to canvas
     * @param {Object} spectrogram - Spectrogram data from computeSpectrogram
     * @param {HTMLCanvasElement} canvas - Target canvas element
     * @param {string} colorScheme - Color scheme name
     */
    function renderSpectrogram(spectrogram, canvas, colorScheme) {
        const { data, numBins, numWindows } = spectrogram;
        const colorFn = colorSchemes[colorScheme] || colorSchemes.cyber;

        // Set canvas size
        canvas.width = numWindows;
        canvas.height = numBins;

        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(numWindows, numBins);
        const pixels = imageData.data;

        // Find max magnitude for normalization
        let maxMag = 0;
        for (let w = 0; w < numWindows; w++) {
            for (let b = 0; b < numBins; b++) {
                if (data[w][b] > maxMag) {
                    maxMag = data[w][b];
                }
            }
        }

        // Convert to dB scale and normalize
        const minDb = -80;
        const maxDb = 0;

        for (let w = 0; w < numWindows; w++) {
            for (let b = 0; b < numBins; b++) {
                // Flip frequency axis (low frequencies at bottom)
                const y = numBins - 1 - b;
                const pixelIndex = (y * numWindows + w) * 4;

                // Convert to dB
                const magnitude = data[w][b];
                let db = magnitude > 0 ? 20 * Math.log10(magnitude / maxMag) : minDb;
                db = Math.max(minDb, Math.min(maxDb, db));

                // Normalize to 0-1
                const normalized = (db - minDb) / (maxDb - minDb);

                // Get color
                const [r, g, b_] = colorFn(normalized);
                pixels[pixelIndex] = r;
                pixels[pixelIndex + 1] = g;
                pixels[pixelIndex + 2] = b_;
                pixels[pixelIndex + 3] = 255; // Alpha
            }
        }

        ctx.putImageData(imageData, 0, 0);
    }

    /**
     * Export canvas as PNG
     */
    function exportImage() {
        if (!canvas.width || !canvas.height) return;

        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        link.download = `spectrogram_${timestamp}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    /**
     * Format duration in MM:SS format
     * @param {number} seconds
     * @returns {string}
     */
    function formatDuration(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Update progress bar
     * @param {number} percent - Progress percentage (0-100)
     * @param {string} text - Status text
     */
    function updateProgress(percent, text) {
        progressFill.style.width = `${percent}%`;
        progressText.textContent = text || `Processing... ${Math.floor(percent)}%`;
    }

    /**
     * Show/hide progress container
     * @param {boolean} show
     */
    function showProgress(show) {
        if (show) {
            progressContainer.classList.remove('hidden');
            updateProgress(0, 'Initializing...');
        } else {
            progressContainer.classList.add('hidden');
        }
    }

    /**
     * Handle file selection
     * @param {File} file
     */
    async function handleFileSelect(file) {
        if (!file) return;

        // Validate file type
        if (!file.type.startsWith('audio/')) {
            Modal.alert({
                title: 'INVALID FILE',
                message: 'Please select a valid audio file (WAV, MP3, OGG).',
                tone: 'error'
            });
            return;
        }

        currentFile = file;
        fileName.textContent = file.name;
        fileInfo.classList.remove('hidden');
        uploadArea.classList.add('hidden');
        analyzeBtn.disabled = false;

        // Reset canvas
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
        exportBtn.disabled = true;
        infoDuration.textContent = 'Duration: --';
    }

    /**
     * Clear selected file
     */
    function clearFile() {
        currentFile = null;
        audioBuffer = null;
        lastSpectrogram = null;
        fileName.textContent = '';
        fileInfo.classList.add('hidden');
        uploadArea.classList.remove('hidden');
        analyzeBtn.disabled = true;
        exportBtn.disabled = true;

        // Clear canvas
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
        infoDuration.textContent = 'Duration: --';
    }

    /**
     * Main analysis function
     */
    async function analyzeAudio() {
        if (!currentFile) return;

        try {
            analyzeBtn.disabled = true;
            exportBtn.disabled = true;
            showProgress(true);

            // Load audio file
            updateProgress(5, 'Decoding audio...');
            audioBuffer = await loadAudioFile(currentFile);

            // Get FFT size
            const fftSize = parseInt(fftSizeSelect.value, 10);

            // Compute spectrogram
            updateProgress(15, 'Computing FFT...');
            const spectrogram = computeSpectrogram(audioBuffer, fftSize, (p) => {
                updateProgress(15 + p * 70, `Processing... ${Math.floor(p * 100)}%`);
            });
            lastSpectrogram = spectrogram;

            // Render to canvas
            updateProgress(90, 'Rendering...');
            const colorScheme = colorSchemeSelect.value;
            renderSpectrogram(spectrogram, canvas, colorScheme);

            // Update duration info
            infoDuration.textContent = `Duration: ${formatDuration(spectrogram.duration)}`;

            updateProgress(100, 'Complete!');

            // Enable export
            exportBtn.disabled = false;

            // Hide progress after a moment
            setTimeout(() => {
                showProgress(false);
                analyzeBtn.disabled = false;
            }, 500);

        } catch (error) {
            console.error('Analysis error:', error);
            Modal.alert({
                title: 'ANALYZER ERROR',
                message: 'Error analyzing audio: ' + error.message,
                tone: 'error'
            });
            showProgress(false);
            analyzeBtn.disabled = false;
        }
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        // Skip if elements don't exist (section not loaded yet)
        if (!uploadArea) return;

        // File input change
        audioFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                handleFileSelect(file);
            }
        });

        // Upload area click
        uploadArea.addEventListener('click', () => {
            audioFileInput.click();
        });

        // Drag and drop
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });

        uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');

            const file = e.dataTransfer.files[0];
            if (file) {
                handleFileSelect(file);
            }
        });

        // Clear file button
        clearFileBtn.addEventListener('click', clearFile);

        // Analyze button
        analyzeBtn.addEventListener('click', analyzeAudio);

        // Export button
        exportBtn.addEventListener('click', exportImage);

        // Re-render cached data on color scheme change, no FFT recompute
        colorSchemeSelect.addEventListener('change', () => {
            if (lastSpectrogram && canvas.width > 0) {
                renderSpectrogram(lastSpectrogram, canvas, colorSchemeSelect.value);
            }
        });
    }

    /**
     * Initialize the module
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

    // Expose module globally
    window.Spectrogram = {
        analyze: analyzeAudio,
        exportImage: exportImage,
        clearFile: clearFile
    };

})();
