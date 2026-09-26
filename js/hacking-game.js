/**
 * NETRUNNER TERMINAL - Breach Protocol Minigame
 * Cyberpunk 2077 style hacking minigame with difficulty levels,
 * an optional breach timer and GM-defined daemon rewards
 */

(function() {
    'use strict';

    const DIFFICULTY_KEY = 'ct_breach_difficulty';
    const HEX_CODES = ['1C', '7A', 'BD', 'E9', '55', 'FF'];
    const DEFAULT_DAEMON_NAMES = ['DATAMINE_V1', 'DATAMINE_V2', 'DATAMINE_V3'];

    // Difficulty presets. Timer is in seconds, 0 disables it.
    const DIFFICULTIES = {
        easy: { label: 'EASY', gridSize: 5, bufferSize: 7, sequenceLengths: [2, 2, 3], timer: 0 },
        standard: { label: 'STANDARD', gridSize: 5, bufferSize: 6, sequenceLengths: [2, 2, 3], timer: 60 },
        hard: { label: 'HARD', gridSize: 6, bufferSize: 7, sequenceLengths: [3, 3, 4], timer: 40 }
    };

    // Active configuration, set from the selected difficulty
    let CONFIG = DIFFICULTIES.standard;
    let difficulty = 'standard';

    // GM settings from config.json "breach" block
    let gmSettings = {};

    // Game State
    let gameState = {
        matrix: [],
        buffer: [],
        daemons: [],
        isRowSelection: true,
        currentRow: 0,
        currentCol: 0,
        selectedCells: [],
        isGameOver: false,
        initialized: false,
        timeLeft: 0,
        timerRunning: false
    };

    let timerInterval = null;
    let lastTick = 0;

    // DOM Elements
    let elements = {};

    /**
     * Initialize DOM element references
     */
    function cacheElements() {
        elements = {
            section: document.getElementById('hacking-game-section'),
            difficultyButtons: document.querySelectorAll('[data-breach-difficulty]'),
            difficultySelector: document.getElementById('breach-difficulty'),
            timer: document.getElementById('breach-timer'),
            timerItem: document.getElementById('breach-timer-item'),
            matrix: document.getElementById('code-matrix'),
            buffer: document.getElementById('buffer-display'),
            daemons: document.getElementById('daemon-list'),
            indicator: document.getElementById('selection-indicator'),
            indicatorText: document.querySelector('.indicator-text'),
            result: document.getElementById('game-result'),
            resultIcon: document.getElementById('result-icon'),
            resultTitle: document.getElementById('result-title'),
            resultMessage: document.getElementById('result-message'),
            resultRewards: document.getElementById('result-rewards'),
            resultBtn: document.getElementById('result-btn'),
            newGameBtn: document.getElementById('new-game-btn'),
            resetBtn: document.getElementById('reset-btn')
        };
    }

    /**
     * Generate random hex code from available codes
     * @returns {string} Random hex code
     */
    function getRandomHex() {
        return HEX_CODES[Math.floor(Math.random() * HEX_CODES.length)];
    }

    /**
     * Generate the code matrix
     * @returns {string[][]} 2D array of hex codes
     */
    function generateMatrix() {
        const matrix = [];
        for (let i = 0; i < CONFIG.gridSize; i++) {
            const row = [];
            for (let j = 0; j < CONFIG.gridSize; j++) {
                row.push(getRandomHex());
            }
            matrix.push(row);
        }
        return matrix;
    }

    /**
     * Walk a random valid path through the matrix following the
     * alternating row/column rule, starting from the top row
     * @param {string[][]} matrix - The code matrix
     * @returns {string[]|null} Codes along the path, null on a dead end
     */
    function walkPath(matrix) {
        const used = new Set();
        const codes = [];
        let isRowSelection = true;
        let row = 0;
        let col = 0;

        for (let i = 0; i < CONFIG.bufferSize; i++) {
            const candidates = [];
            for (let j = 0; j < CONFIG.gridSize; j++) {
                const r = isRowSelection ? row : j;
                const c = isRowSelection ? j : col;
                if (!used.has(`${r},${c}`)) {
                    candidates.push({ r, c });
                }
            }
            if (!candidates.length) return null;

            const pick = candidates[Math.floor(Math.random() * candidates.length)];
            used.add(`${pick.r},${pick.c}`);
            codes.push(matrix[pick.r][pick.c]);
            row = pick.r;
            col = pick.c;
            isRowSelection = !isRowSelection;
        }

        return codes;
    }

    /**
     * Generate a solution path, retrying on the rare dead end
     * @param {string[][]} matrix - The code matrix
     * @returns {string[]} Codes along the path
     */
    function generateSolutionPath(matrix) {
        for (let attempt = 0; attempt < 50; attempt++) {
            const codes = walkPath(matrix);
            if (codes) return codes;
        }
        // Practically unreachable: fall back to the first row
        return matrix[0].slice(0, CONFIG.bufferSize);
    }

    /**
     * Generate daemon sequences sliced from a solution path at random
     * offsets. Every daemon is a run of the same valid path, so following
     * that path breaches all of them within the buffer.
     * @param {string[]} pathCodes - Codes along a valid path
     * @returns {Object[]} Array of daemon objects with sequences
     */
    function generateDaemons(pathCodes) {
        const gmDaemons = Array.isArray(gmSettings.daemons) ? gmSettings.daemons : [];

        return CONFIG.sequenceLengths.map((length, i) => {
            const maxStart = Math.max(0, pathCodes.length - length);
            const start = Math.floor(Math.random() * (maxStart + 1));
            const gm = gmDaemons[i] || {};

            return {
                name: gm.name || DEFAULT_DAEMON_NAMES[i] || 'DATAMINE_V' + (i + 1),
                reward: gm.reward || '',
                sequence: pathCodes.slice(start, start + length),
                matched: 0,
                completed: false,
                failed: false
            };
        });
    }

    /**
     * Render the code matrix to DOM
     */
    function renderMatrix() {
        elements.matrix.innerHTML = '';
        elements.matrix.style.gridTemplateColumns = `repeat(${CONFIG.gridSize}, 1fr)`;

        for (let row = 0; row < CONFIG.gridSize; row++) {
            for (let col = 0; col < CONFIG.gridSize; col++) {
                const cell = document.createElement('button');
                cell.type = 'button';
                cell.className = 'matrix-cell';
                cell.textContent = gameState.matrix[row][col];
                cell.dataset.row = row;
                cell.dataset.col = col;

                // Check if cell is already selected
                const isSelected = gameState.selectedCells.some(
                    c => c.row === row && c.col === col
                );

                if (isSelected) {
                    cell.classList.add('selected');
                    cell.disabled = true;
                } else if (!gameState.isGameOver && isSelectable(row, col)) {
                    cell.classList.add('selectable');
                    cell.addEventListener('click', () => handleCellClick(row, col));
                } else {
                    cell.classList.add('disabled');
                    cell.disabled = true;
                }

                // Highlight the active row or column
                if (isActiveLine(row, col)) {
                    cell.classList.add('active-line');
                }

                elements.matrix.appendChild(cell);
            }
        }
    }

    /**
     * Whether a cell is on the row/column the player must pick from
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {boolean}
     */
    function isActiveLine(row, col) {
        if (gameState.isGameOver) return false;
        if (gameState.selectedCells.length === 0) return row === 0;
        return gameState.isRowSelection ? row === gameState.currentRow : col === gameState.currentCol;
    }

    /**
     * Check if a cell is selectable based on current selection mode
     * @param {number} row - Row index
     * @param {number} col - Column index
     * @returns {boolean} Whether cell can be selected
     */
    function isSelectable(row, col) {
        // Check if already selected
        const isSelected = gameState.selectedCells.some(
            c => c.row === row && c.col === col
        );
        if (isSelected) return false;

        // First selection - must be from first row
        if (gameState.selectedCells.length === 0) {
            return row === 0;
        }

        // Subsequent selections alternate between row and column
        if (gameState.isRowSelection) {
            return row === gameState.currentRow;
        } else {
            return col === gameState.currentCol;
        }
    }

    /**
     * Render the buffer display
     */
    function renderBuffer() {
        elements.buffer.innerHTML = '';

        for (let i = 0; i < CONFIG.bufferSize; i++) {
            const slot = document.createElement('span');
            slot.className = 'buffer-slot';

            if (i < gameState.buffer.length) {
                slot.textContent = gameState.buffer[i];
                slot.classList.add('filled');
            } else {
                slot.classList.add('empty');
            }

            elements.buffer.appendChild(slot);
        }
    }

    /**
     * Render the daemon sequences
     */
    function renderDaemons() {
        elements.daemons.innerHTML = '';

        gameState.daemons.forEach(daemon => {
            const item = document.createElement('div');
            item.className = 'daemon-item';

            if (daemon.completed) {
                item.classList.add('completed');
            } else if (daemon.failed) {
                item.classList.add('failed');
            }

            const name = document.createElement('div');
            name.className = 'daemon-name';
            name.textContent = daemon.name;

            const sequence = document.createElement('div');
            sequence.className = 'daemon-sequence';

            daemon.sequence.forEach((code, codeIndex) => {
                const codeSpan = document.createElement('span');
                codeSpan.className = 'sequence-code';
                codeSpan.textContent = code;

                if (codeIndex < daemon.matched) {
                    codeSpan.classList.add('matched');
                }

                sequence.appendChild(codeSpan);
            });

            item.appendChild(name);
            item.appendChild(sequence);
            elements.daemons.appendChild(item);
        });
    }

    /**
     * Update the selection indicator
     */
    function updateIndicator() {
        if (gameState.selectedCells.length === 0) {
            elements.indicatorText.textContent = 'SELECT FROM TOP ROW';
        } else if (gameState.isRowSelection) {
            elements.indicatorText.textContent = `SELECT FROM ROW ${gameState.currentRow + 1}`;
        } else {
            elements.indicatorText.textContent = `SELECT FROM COLUMN ${gameState.currentCol + 1}`;
        }
    }

    /**
     * Render the breach timer readout
     */
    function renderTimer() {
        if (!CONFIG.timer) {
            elements.timerItem.classList.add('hidden');
            return;
        }

        elements.timerItem.classList.remove('hidden');
        const seconds = Math.max(0, gameState.timeLeft);
        elements.timer.textContent = seconds.toFixed(1) + 's';
        elements.timer.classList.toggle('idle', !gameState.timerRunning && !gameState.isGameOver);
        elements.timer.classList.toggle('critical', seconds <= 10 && gameState.timerRunning);
    }

    /**
     * Start the breach timer. Like the original, it starts on the first pick.
     */
    function startTimer() {
        if (!CONFIG.timer || gameState.timerRunning) return;

        gameState.timerRunning = true;
        lastTick = Date.now();
        timerInterval = setInterval(tickTimer, 100);
    }

    /**
     * Advance the timer, paused while the section is not visible
     */
    function tickTimer() {
        const now = Date.now();
        const delta = (now - lastTick) / 1000;
        lastTick = now;

        if (elements.section.classList.contains('hidden') || document.hidden) return;

        gameState.timeLeft -= delta;
        renderTimer();

        if (gameState.timeLeft <= 0) {
            stopTimer();
            const anyCompleted = gameState.daemons.some(d => d.completed);
            renderMatrix();
            endGame(anyCompleted, anyCompleted ? 'Trace detected. Partial breach uploaded.' : 'Breach window closed. Trace detected.');
        }
    }

    /**
     * Stop the breach timer
     */
    function stopTimer() {
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
        gameState.timerRunning = false;
    }

    /**
     * Handle cell click
     * @param {number} row - Row index
     * @param {number} col - Column index
     */
    function handleCellClick(row, col) {
        if (gameState.isGameOver) return;
        if (!isSelectable(row, col)) return;

        startTimer();

        const code = gameState.matrix[row][col];

        // Add to buffer
        gameState.buffer.push(code);

        // Mark cell as selected
        gameState.selectedCells.push({ row, col });

        // Update current position
        gameState.currentRow = row;
        gameState.currentCol = col;

        // Toggle selection mode
        gameState.isRowSelection = !gameState.isRowSelection;

        // Check daemon progress
        const completedBefore = gameState.daemons.filter(d => d.completed).length;
        updateDaemons();
        const completedAfter = gameState.daemons.filter(d => d.completed).length;
        if (window.Sound && completedAfter > completedBefore) Sound.confirm();

        // Re-render
        renderMatrix();
        renderBuffer();
        renderDaemons();
        updateIndicator();

        // Check win/lose conditions
        checkGameEnd();
    }

    /**
     * Compute exact matching state of a daemon against the buffer
     * @param {string[]} sequence - Daemon sequence
     * @param {string[]} buffer - Current buffer contents
     * @returns {Object} Matching state
     */
    function computeDaemonState(sequence, buffer) {
        // Completed if sequence appears as a contiguous run anywhere
        for (let s = 0; s + sequence.length <= buffer.length; s++) {
            let found = true;
            for (let k = 0; k < sequence.length; k++) {
                if (buffer[s + k] !== sequence[k]) {
                    found = false;
                    break;
                }
            }
            if (found) {
                return { completed: true, matched: sequence.length, failed: false };
            }
        }

        // Progress is the longest sequence prefix that is a buffer suffix
        let matched = 0;
        const maxK = Math.min(sequence.length - 1, buffer.length);
        for (let k = maxK; k > 0; k--) {
            let match = true;
            for (let j = 0; j < k; j++) {
                if (buffer[buffer.length - k + j] !== sequence[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                matched = k;
                break;
            }
        }

        const remaining = CONFIG.bufferSize - buffer.length;
        const failed = matched + remaining < sequence.length;
        return { completed: false, matched: matched, failed: failed };
    }

    /**
     * Recompute matching state for all daemons
     */
    function updateDaemons() {
        gameState.daemons.forEach(daemon => {
            const state = computeDaemonState(daemon.sequence, gameState.buffer);
            daemon.completed = state.completed;
            daemon.matched = state.matched;
            daemon.failed = state.failed;
        });
    }

    /**
     * Check if game has ended (win or lose)
     */
    function checkGameEnd() {
        const allCompleted = gameState.daemons.every(d => d.completed);
        const anyCompleted = gameState.daemons.some(d => d.completed);
        const bufferFull = gameState.buffer.length >= CONFIG.bufferSize;
        const noValidMoves = !hasValidMoves();

        if (allCompleted) {
            endGame(true, 'All daemons successfully breached!');
        } else if (bufferFull) {
            if (anyCompleted) {
                endGame(true, 'Partial breach successful.');
            } else {
                endGame(false, 'Buffer overflow. No daemons breached.');
            }
        } else if (noValidMoves) {
            if (anyCompleted) {
                endGame(true, 'Partial breach successful.');
            } else {
                endGame(false, 'No valid moves remaining.');
            }
        }
    }

    /**
     * Check if there are any valid moves left
     * @returns {boolean} Whether valid moves exist
     */
    function hasValidMoves() {
        for (let row = 0; row < CONFIG.gridSize; row++) {
            for (let col = 0; col < CONFIG.gridSize; col++) {
                if (isSelectable(row, col)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Render the GM rewards unlocked by completed daemons
     */
    function renderRewards() {
        elements.resultRewards.innerHTML = '';
        const unlocked = gameState.daemons.filter(d => d.completed && d.reward);

        if (!unlocked.length) {
            elements.resultRewards.classList.add('hidden');
            return;
        }

        unlocked.forEach(daemon => {
            const item = document.createElement('div');
            item.className = 'result-reward';
            const name = document.createElement('span');
            name.className = 'result-reward-name';
            name.textContent = '>> ' + daemon.name;
            const text = document.createElement('span');
            text.className = 'result-reward-text';
            text.textContent = daemon.reward;
            item.appendChild(name);
            item.appendChild(text);
            elements.resultRewards.appendChild(item);
        });
        elements.resultRewards.classList.remove('hidden');
    }

    /**
     * End the game and show result
     * @param {boolean} isWin - Whether player won
     * @param {string} message - Result message
     */
    function endGame(isWin, message) {
        gameState.isGameOver = true;
        stopTimer();
        renderTimer();

        elements.resultIcon.className = 'result-icon ' + (isWin ? 'success' : 'failure');
        elements.resultTitle.className = 'result-title ' + (isWin ? 'success' : 'failure');
        elements.resultTitle.textContent = isWin ? 'BREACH SUCCESSFUL' : 'BREACH FAILED';
        elements.resultMessage.textContent = message;
        renderRewards();

        elements.result.classList.remove('hidden');
        if (window.Sound) {
            if (isWin) {
                Sound.confirm();
            } else {
                Sound.error();
            }
        }
        elements.resultBtn.focus();
    }

    /**
     * Reset the current game to initial state
     */
    function resetGame() {
        stopTimer();
        gameState.buffer = [];
        gameState.isRowSelection = true;
        gameState.currentRow = 0;
        gameState.currentCol = 0;
        gameState.selectedCells = [];
        gameState.isGameOver = false;
        gameState.timeLeft = CONFIG.timer;

        // Reset daemon progress
        gameState.daemons.forEach(daemon => {
            daemon.matched = 0;
            daemon.completed = false;
            daemon.failed = false;
        });

        elements.result.classList.add('hidden');

        renderMatrix();
        renderBuffer();
        renderDaemons();
        updateIndicator();
        renderTimer();
    }

    /**
     * Start a new game with fresh matrix and daemons
     */
    async function newGame() {
        // config.json is polled by main.js, so the cached copy is current
        const config = window.DataLoader ? await DataLoader.load('config') : null;
        gmSettings = (config && config.breach) || {};
        applyGmDifficulty();

        gameState.matrix = generateMatrix();
        const pathCodes = generateSolutionPath(gameState.matrix);
        gameState.daemons = generateDaemons(pathCodes);
        resetGame();
    }

    /**
     * Apply a difficulty preset and update the selector
     * @param {string} name - Difficulty key
     */
    function setDifficulty(name) {
        if (!DIFFICULTIES[name]) return;
        difficulty = name;
        CONFIG = DIFFICULTIES[name];

        elements.difficultyButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.breachDifficulty === name);
        });
    }

    /**
     * Honor the GM difficulty: a default for new players, or a hard lock
     */
    function applyGmDifficulty() {
        const gmDifficulty = DIFFICULTIES[gmSettings.difficulty] ? gmSettings.difficulty : null;
        const locked = !!(gmSettings.lockDifficulty && gmDifficulty);

        elements.difficultySelector.classList.toggle('hidden', locked);

        if (locked) {
            setDifficulty(gmDifficulty);
        } else if (!readStoredDifficulty() && gmDifficulty) {
            setDifficulty(gmDifficulty);
        }
    }

    /**
     * Read the player's saved difficulty choice
     * @returns {string|null}
     */
    function readStoredDifficulty() {
        try {
            const value = localStorage.getItem(DIFFICULTY_KEY);
            return DIFFICULTIES[value] ? value : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * Handle a difficulty button click
     * @param {Event} event - Click event
     */
    function handleDifficultyClick(event) {
        const name = event.currentTarget.dataset.breachDifficulty;
        if (name === difficulty) return;
        try {
            localStorage.setItem(DIFFICULTY_KEY, name);
        } catch (error) {
            // Storage unavailable, keep the choice for this session only
        }
        setDifficulty(name);
        newGame();
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        elements.newGameBtn.addEventListener('click', newGame);
        elements.resetBtn.addEventListener('click', resetGame);
        elements.resultBtn.addEventListener('click', newGame);
        elements.difficultyButtons.forEach(btn => {
            btn.addEventListener('click', handleDifficultyClick);
        });
    }

    /**
     * Initialize the hacking game
     */
    function init() {
        if (gameState.initialized) {
            // Already initialized, keep the current puzzle
            return;
        }

        cacheElements();
        initEventListeners();
        setDifficulty(readStoredDifficulty() || 'standard');
        gameState.initialized = true;
        newGame();
    }

    // Expose game functions globally
    window.HackingGame = {
        init,
        newGame,
        resetGame
    };

})();
