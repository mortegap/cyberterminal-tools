/**
 * NETRUNNER TERMINAL - Steganography Module
 * Hide and extract text payloads in image pixels (LSB encoding)
 */

(function() {
    'use strict';

    const MAGIC = 'CT77';
    const HEADER_BYTES = 8;

    let modeButtons = null;
    let uploadArea = null;
    let fileInput = null;
    let fileInfo = null;
    let fileNameEl = null;
    let clearBtn = null;
    let messageGroup = null;
    let messageInput = null;
    let actionBtn = null;
    let outputEl = null;
    let copyBtn = null;
    let capacityEl = null;

    let mode = 'extract';
    let imageData = null;
    let imageName = null;
    let lastOutput = '';

    /**
     * Bytes of payload the loaded image can hold
     * @returns {number}
     */
    function capacity() {
        if (!imageData) return 0;
        return Math.floor((imageData.width * imageData.height * 3) / 8) - HEADER_BYTES;
    }

    /**
     * Write bytes into the least significant bits of RGB channels
     * @param {Uint8ClampedArray} pixels - Canvas pixel data
     * @param {Uint8Array} bytes - Payload bytes
     */
    function writeBits(pixels, bytes) {
        let bitIndex = 0;
        for (let i = 0; i < bytes.length; i++) {
            for (let b = 7; b >= 0; b--) {
                const bit = (bytes[i] >> b) & 1;
                const pixelIndex = Math.floor(bitIndex / 3) * 4 + (bitIndex % 3);
                pixels[pixelIndex] = (pixels[pixelIndex] & 0xFE) | bit;
                bitIndex++;
            }
        }
    }

    /**
     * Read bytes back from the least significant bits
     * @param {Uint8ClampedArray} pixels - Canvas pixel data
     * @param {number} count - Bytes to read
     * @param {number} startBit - Bit offset to start from
     * @returns {Uint8Array}
     */
    function readBits(pixels, count, startBit = 0) {
        const bytes = new Uint8Array(count);
        let bitIndex = startBit;
        for (let i = 0; i < count; i++) {
            let value = 0;
            for (let b = 0; b < 8; b++) {
                const pixelIndex = Math.floor(bitIndex / 3) * 4 + (bitIndex % 3);
                value = (value << 1) | (pixels[pixelIndex] & 1);
                bitIndex++;
            }
            bytes[i] = value;
        }
        return bytes;
    }

    /**
     * Embed the message and trigger a PNG download
     */
    function embed() {
        const message = messageInput.value;
        if (!message) {
            showOutput('No payload message provided.', true);
            return;
        }

        const payload = new TextEncoder().encode(message);
        if (payload.length > capacity()) {
            showOutput('Payload too large. Capacity: ' + capacity() + ' bytes, payload: ' + payload.length + ' bytes.', true);
            return;
        }

        const full = new Uint8Array(HEADER_BYTES + payload.length);
        full.set(new TextEncoder().encode(MAGIC), 0);
        full[4] = (payload.length >>> 24) & 0xFF;
        full[5] = (payload.length >>> 16) & 0xFF;
        full[6] = (payload.length >>> 8) & 0xFF;
        full[7] = payload.length & 0xFF;
        full.set(payload, HEADER_BYTES);

        const canvas = document.createElement('canvas');
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        const ctx = canvas.getContext('2d');
        const copy = ctx.createImageData(imageData.width, imageData.height);
        copy.data.set(imageData.data);

        // Canvas stores premultiplied alpha, so LSBs of translucent pixels
        // would not survive the round trip. Make carrier pixels opaque.
        const usedPixels = Math.ceil((full.length * 8) / 3);
        for (let p = 0; p < usedPixels; p++) {
            copy.data[p * 4 + 3] = 255;
        }

        writeBits(copy.data, full);
        ctx.putImageData(copy, 0, 0);

        const link = document.createElement('a');
        link.download = 'stego_' + (imageName || 'payload').replace(/\.[^.]+$/, '') + '.png';
        link.href = canvas.toDataURL('image/png');
        link.click();

        showOutput('Payload embedded (' + payload.length + ' bytes). PNG download started. Distribute the carrier image.');
        if (window.Sound) Sound.confirm();
    }

    /**
     * Extract a payload from the loaded image
     */
    function extract() {
        const pixels = imageData.data;
        const totalCapacity = Math.floor((imageData.width * imageData.height * 3) / 8);

        if (totalCapacity < HEADER_BYTES) {
            showOutput('Image too small to carry a payload.', true);
            return;
        }

        const header = readBits(pixels, HEADER_BYTES);
        const magic = new TextDecoder().decode(header.slice(0, 4));

        if (magic !== MAGIC) {
            showOutput('NO PAYLOAD DETECTED // carrier is clean or uses an unknown encoding.', true);
            if (window.Sound) Sound.error();
            return;
        }

        const length = (header[4] << 24) | (header[5] << 16) | (header[6] << 8) | header[7];
        if (length <= 0 || length > totalCapacity - HEADER_BYTES) {
            showOutput('PAYLOAD CORRUPTED // invalid length header.', true);
            return;
        }

        const payload = readBits(pixels, length, HEADER_BYTES * 8);
        const text = new TextDecoder().decode(payload);
        showOutput(text);
        if (window.Sound) Sound.confirm();
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
    }

    /**
     * Load an image file into pixel data
     * @param {File} file - Image file
     */
    function loadImage(file) {
        if (!Utils.isFileKind(file, 'image')) {
            Modal.alert({
                title: 'INVALID FILE',
                message: 'Please select a valid image file (PNG recommended).',
                tone: 'error'
            });
            return;
        }

        const url = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            imageName = file.name;
            URL.revokeObjectURL(url);

            fileNameEl.textContent = file.name + ' (' + canvas.width + 'x' + canvas.height + ')';
            fileInfo.classList.remove('hidden');
            uploadArea.classList.add('hidden');
            capacityEl.textContent = 'CAPACITY: ' + capacity() + ' bytes';
            actionBtn.disabled = false;
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            Modal.alert({
                title: 'DECODE ERROR',
                message: 'Failed to decode image file.',
                tone: 'error'
            });
        };

        img.src = url;
    }

    /**
     * Clear the loaded image
     */
    function clearImage() {
        imageData = null;
        imageName = null;
        fileInfo.classList.add('hidden');
        uploadArea.classList.remove('hidden');
        capacityEl.textContent = '';
        actionBtn.disabled = true;
        outputEl.innerHTML = '<span class="output-placeholder">Awaiting carrier image...</span>';
        copyBtn.classList.add('hidden');
    }

    /**
     * Switch between extract and embed modes
     * @param {string} newMode - 'extract' or 'embed'
     */
    function setMode(newMode) {
        mode = newMode;
        modeButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.stego === newMode);
        });
        messageGroup.classList.toggle('hidden', newMode !== 'embed');
        actionBtn.querySelector('.btn-text').textContent =
            newMode === 'embed' ? 'EMBED & DOWNLOAD' : 'EXTRACT PAYLOAD';
    }

    /**
     * Initialize the module
     */
    function init() {
        modeButtons = document.querySelectorAll('[data-stego]');
        uploadArea = document.getElementById('stego-upload-area');
        fileInput = document.getElementById('stego-file');
        fileInfo = document.getElementById('stego-file-info');
        fileNameEl = document.getElementById('stego-file-name');
        clearBtn = document.getElementById('stego-clear-btn');
        messageGroup = document.getElementById('stego-message-group');
        messageInput = document.getElementById('stego-message');
        actionBtn = document.getElementById('stego-action-btn');
        outputEl = document.getElementById('stego-output');
        copyBtn = document.getElementById('stego-copy-btn');
        capacityEl = document.getElementById('stego-capacity');
        if (!uploadArea) return;

        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => setMode(btn.dataset.stego));
        });

        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files[0]) loadImage(e.target.files[0]);
            // Reset so picking the same file again still fires change
            e.target.value = '';
        });

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
            if (e.dataTransfer.files[0]) loadImage(e.dataTransfer.files[0]);
        });

        clearBtn.addEventListener('click', clearImage);
        actionBtn.addEventListener('click', () => {
            if (!imageData) return;
            if (mode === 'embed') {
                embed();
            } else {
                extract();
            }
        });

        Utils.bindCopyButton(copyBtn, () => lastOutput);
        setMode('extract');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.Stego = {};

})();
