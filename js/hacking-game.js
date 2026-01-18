/**
 * NETRUNNER TERMINAL - Breach Protocol Minigame
 * Cyberpunk 2077 style hacking minigame
 */

(function() {
    'use strict';

    // Game Configuration
    const CONFIG = {
        GRID_SIZE: 5,
        BUFFER_SIZE: 6,
        HEX_CODES: ['1C', '7A', 'BD', 'E9', '55', 'FF'],
        DAEMON_COUNT: 3,
        SEQUENCE_LENGTHS: [2, 2, 3]
    };

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
        initialized: false
    };

    // DOM Elements
    let elements = {};

    /**
     * Initialize DOM element references
     */
    function cacheElements() {
        elements = {
            matrix: document.getElementById('code-matrix'),
            buffer: document.getElementById('buffer-display'),
            daemons: document.getElementById('daemon-list'),
            indicator: document.getElementById('selection-indicator'),
            indicatorText: document.querySelector('.indicator-text'),
            result: document.getElementById('game-result'),
            resultIcon: document.getElementById('result-icon'),
            resultTitle: document.getElementById('result-title'),
            resultMessage: document.getElementById('result-message'),
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
        return CONFIG.HEX_CODES[Math.floor(Math.random() * CONFIG.HEX_CODES.length)];
    }

    /**
     * Generate the code matrix
     * @returns {string[][]} 2D array of hex codes
     */
    function generateMatrix() {
        const matrix = [];
        for (let i = 0; i < CONFIG.GRID_SIZE; i++) {
            const row = [];
            for (let j = 0; j < CONFIG.GRID_SIZE; j++) {
                row.push(getRandomHex());
            }
            matrix.push(row);
        }
        return matrix;
    }

    /**
     * Generate daemon sequences that are solvable within the matrix
     * @returns {Object[]} Array of daemon objects with sequences
     */
    function generateDaemons() {
        const daemons = [];
        const names = ['DATAMINE_V1', 'DATAMINE_V2', 'DATAMINE_V3'];

        for (let i = 0; i < CONFIG.DAEMON_COUNT; i++) {
            const length = CONFIG.SEQUENCE_LENGTHS[i];
            const sequence = [];

            for (let j = 0; j < length; j++) {
                sequence.push(getRandomHex());
            }

            daemons.push({
                name: names[i],
                sequence: sequence,
                matched: 0,
                completed: false,
                failed: false
            });
        }

        return daemons;
    }

    /**
     * Render the code matrix to DOM
     */
    function renderMatrix() {
        elements.matrix.innerHTML = '';

        for (let row = 0; row < CONFIG.GRID_SIZE; row++) {
            for (let col = 0; col < CONFIG.GRID_SIZE; col++) {
                const cell = document.createElement('div');
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
                } else if (isSelectable(row, col)) {
                    cell.classList.add('selectable');
                    cell.addEventListener('click', () => handleCellClick(row, col));
                } else {
                    cell.classList.add('disabled');
                }

                elements.matrix.appendChild(cell);
            }
        }
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

        for (let i = 0; i < CONFIG.BUFFER_SIZE; i++) {
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

        gameState.daemons.forEach((daemon, index) => {
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
     * Handle cell click
     * @param {number} row - Row index
     * @param {number} col - Column index
     */
    function handleCellClick(row, col) {
        if (gameState.isGameOver) return;
        if (!isSelectable(row, col)) return;

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
        updateDaemonProgress(code);

        // Re-render
        renderMatrix();
        renderBuffer();
        renderDaemons();
        updateIndicator();

        // Check win/lose conditions
        checkGameEnd();
    }

    /**
     * Update daemon sequence matching progress
     * @param {string} code - The selected code
     */
    function updateDaemonProgress(code) {
        gameState.daemons.forEach(daemon => {
            if (daemon.completed || daemon.failed) return;

            const expectedCode = daemon.sequence[daemon.matched];

            if (code === expectedCode) {
                daemon.matched++;
                if (daemon.matched === daemon.sequence.length) {
                    daemon.completed = true;
                }
            } else {
                // Check if sequence can still be completed
                // Reset matching if wrong code selected
                if (daemon.matched > 0 && code !== daemon.sequence[0]) {
                    // Check remaining buffer space
                    const remainingBuffer = CONFIG.BUFFER_SIZE - gameState.buffer.length;
                    const remainingSequence = daemon.sequence.length;

                    if (remainingBuffer < remainingSequence) {
                        daemon.failed = true;
                    } else {
                        // Reset and start fresh if this code matches first
                        if (code === daemon.sequence[0]) {
                            daemon.matched = 1;
                        } else {
                            daemon.matched = 0;
                        }
                    }
                } else if (code === daemon.sequence[0]) {
                    daemon.matched = 1;
                }
            }

            // Check if daemon can still be completed
            const remainingBuffer = CONFIG.BUFFER_SIZE - gameState.buffer.length;
            const remainingSequence = daemon.sequence.length - daemon.matched;

            if (remainingBuffer < remainingSequence && !daemon.completed) {
                daemon.failed = true;
            }
        });
    }

    /**
     * Check if game has ended (win or lose)
     */
    function checkGameEnd() {
        const allCompleted = gameState.daemons.every(d => d.completed);
        const anyCompleted = gameState.daemons.some(d => d.completed);
        const bufferFull = gameState.buffer.length >= CONFIG.BUFFER_SIZE;
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
        for (let row = 0; row < CONFIG.GRID_SIZE; row++) {
            for (let col = 0; col < CONFIG.GRID_SIZE; col++) {
                if (isSelectable(row, col)) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * End the game and show result
     * @param {boolean} isWin - Whether player won
     * @param {string} message - Result message
     */
    function endGame(isWin, message) {
        gameState.isGameOver = true;

        elements.resultIcon.className = 'result-icon ' + (isWin ? 'success' : 'failure');
        elements.resultTitle.className = 'result-title ' + (isWin ? 'success' : 'failure');
        elements.resultTitle.textContent = isWin ? 'BREACH SUCCESSFUL' : 'BREACH FAILED';
        elements.resultMessage.textContent = message;

        elements.result.classList.remove('hidden');
    }

    /**
     * Reset the current game to initial state
     */
    function resetGame() {
        gameState.buffer = [];
        gameState.isRowSelection = true;
        gameState.currentRow = 0;
        gameState.currentCol = 0;
        gameState.selectedCells = [];
        gameState.isGameOver = false;

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
    }

    /**
     * Start a new game with fresh matrix and daemons
     */
    function newGame() {
        gameState.matrix = generateMatrix();
        gameState.daemons = generateDaemons();
        resetGame();
    }

    /**
     * Initialize event listeners
     */
    function initEventListeners() {
        elements.newGameBtn.addEventListener('click', newGame);
        elements.resetBtn.addEventListener('click', resetGame);
        elements.resultBtn.addEventListener('click', newGame);
    }

    /**
     * Initialize the hacking game
     */
    function init() {
        if (gameState.initialized) {
            // Already initialized, just reset
            return;
        }

        cacheElements();
        initEventListeners();
        newGame();
        gameState.initialized = true;
    }

    // Expose game functions globally
    window.HackingGame = {
        init,
        newGame,
        resetGame
    };

})();
