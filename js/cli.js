/**
 * NETRUNNER TERMINAL - NETLINK CLI Module
 * Command line interface over a GM-authored virtual filesystem
 */

(function() {
    'use strict';

    const UNLOCKED_KEY = 'ct_cli_unlocked';

    let outputEl = null;
    let inputEl = null;
    let promptEl = null;

    let fsData = null;
    let host = null;
    let cwd = [];
    let unlocked = new Set(JSON.parse(localStorage.getItem(UNLOCKED_KEY) || '[]'));
    let pendingPassword = null;
    let history = [];
    let historyIndex = -1;
    let booted = false;

    const BANNER = [
        ' _   _ _____ _____ _     ___ _   _ _  __',
        '| \\ | | ____|_   _| |   |_ _| \\ | | |/ /',
        '|  \\| |  _|   | | | |    | ||  \\| | \' / ',
        '| |\\  | |___  | | | |___ | || |\\  | . \\ ',
        '|_| \\_|_____| |_| |_____|___|_| \\_|_|\\_\\',
        ''
    ].join('\n');

    /**
     * Persist unlocked node keys
     */
    function saveUnlocked() {
        localStorage.setItem(UNLOCKED_KEY, JSON.stringify([...unlocked]));
    }

    /**
     * Print a block of text to the CLI output
     * @param {string} text - Text to print
     * @param {string} cls - Extra CSS class
     * @returns {HTMLElement} The created line element
     */
    function print(text, cls = '') {
        const line = document.createElement('div');
        line.className = 'cli-line' + (cls ? ' ' + cls : '');
        line.textContent = text;
        outputEl.appendChild(line);
        outputEl.scrollTop = outputEl.scrollHeight;
        return line;
    }

    /**
     * Print with typewriter effect
     * @param {string} text - Text to type
     * @param {string} cls - Extra CSS class
     */
    async function printTyped(text, cls = '') {
        const line = print('', cls);
        await Utils.typeText(line, text, { speed: 6, tick: true });
        outputEl.scrollTop = outputEl.scrollHeight;
    }

    /**
     * Get the current host definition
     * @returns {Object|null}
     */
    function getHost() {
        return fsData && fsData.hosts ? fsData.hosts[host] : null;
    }

    /**
     * Resolve a node by path parts from the current host root
     * @param {string[]} parts - Path segments
     * @returns {Object|null}
     */
    function getNode(parts) {
        const hostDef = getHost();
        if (!hostDef) return null;

        let node = hostDef.root;
        for (const part of parts) {
            if (!node || node.type !== 'dir' || !node.children || !node.children[part]) {
                return null;
            }
            node = node.children[part];
        }
        return node;
    }

    /**
     * Build the persistent lock key for a node or host
     * @param {string[]} parts - Path segments (empty for host locks)
     * @param {string} targetHost - Host name
     * @returns {string}
     */
    function lockKey(parts, targetHost = host) {
        return targetHost + ':/' + parts.join('/');
    }

    /**
     * Whether a locked node has been opened
     */
    function isUnlocked(node, key) {
        return !node.locked || unlocked.has(key);
    }

    /**
     * Update the prompt label
     */
    function updatePrompt() {
        const handle = Terminal.getHandle() || 'guest';
        const path = '/' + cwd.join('/');

        if (pendingPassword) {
            promptEl.textContent = 'PASSWORD:';
            inputEl.type = 'password';
        } else {
            promptEl.textContent = handle + '@' + (host || 'offline') + ':' + path + '$';
            inputEl.type = 'text';
        }
    }

    /**
     * Print the host message of the day
     */
    function printMotd() {
        const hostDef = getHost();
        if (hostDef && hostDef.motd) {
            print(hostDef.motd, 'cli-motd');
        }
    }

    const COMMANDS = {
        help() {
            print([
                'AVAILABLE COMMANDS:',
                '  ls              list directory contents',
                '  cd <dir>        change directory (.. to go up)',
                '  cat <file>      read a file',
                '  unlock <name>   unlock a protected file or directory',
                '  scan            list reachable hosts on the subnet',
                '  connect <host>  jack into a remote host',
                '  disconnect      return to the local node',
                '  motd            show host banner',
                '  whoami          operator identity',
                '  history         command history',
                '  clear           clear the screen',
                '  exit            return to the quickhack menu',
                '  logout          drop operator identity'
            ].join('\n'));
        },

        ls() {
            const node = getNode(cwd);
            if (!node || node.type !== 'dir') {
                print('ERROR: current directory unavailable', 'cli-error');
                return;
            }

            const names = Object.keys(node.children || {});
            if (!names.length) {
                print('(empty)');
                return;
            }

            names.forEach(name => {
                const child = node.children[name];
                const key = lockKey([...cwd, name]);
                if (child.type === 'dir') {
                    const tag = isUnlocked(child, key) ? '' : '  [LOCKED]';
                    print('  ' + name + '/' + tag, tag ? 'cli-locked' : 'cli-dir');
                } else {
                    const tag = isUnlocked(child, key) ? '' : '  [ENCRYPTED]';
                    print('  ' + name + tag, tag ? 'cli-locked' : '');
                }
            });
        },

        cd(args) {
            const target = args[0];
            if (!target) {
                print('usage: cd <dir>', 'cli-error');
                return;
            }

            if (target === '..') {
                cwd.pop();
                return;
            }

            const node = getNode([...cwd, target]);
            if (!node) {
                print('ERROR: no such directory: ' + target, 'cli-error');
                return;
            }
            if (node.type !== 'dir') {
                print('ERROR: not a directory: ' + target, 'cli-error');
                return;
            }

            const key = lockKey([...cwd, target]);
            if (!isUnlocked(node, key)) {
                print('ACCESS DENIED // ICE detected. Try: unlock ' + target, 'cli-error');
                if (window.Sound) Sound.error();
                return;
            }

            cwd.push(target);
        },

        async cat(args) {
            const target = args[0];
            if (!target) {
                print('usage: cat <file>', 'cli-error');
                return;
            }

            const node = getNode([...cwd, target]);
            if (!node || node.type !== 'file') {
                print('ERROR: no such file: ' + target, 'cli-error');
                return;
            }

            const key = lockKey([...cwd, target]);
            if (!isUnlocked(node, key)) {
                print('ACCESS DENIED // File is encrypted. Try: unlock ' + target, 'cli-error');
                if (window.Sound) Sound.error();
                return;
            }

            const content = Array.isArray(node.content) ? node.content.join('\n') : (node.content || '');
            await printTyped(content, 'cli-file');
        },

        unlock(args) {
            const target = args[0];
            if (!target) {
                print('usage: unlock <name>', 'cli-error');
                return;
            }

            const node = getNode([...cwd, target]);
            if (!node) {
                print('ERROR: no such entry: ' + target, 'cli-error');
                return;
            }

            const key = lockKey([...cwd, target]);
            if (isUnlocked(node, key)) {
                print('Entry is not locked.');
                return;
            }

            pendingPassword = { kind: 'node', key: key, node: node, name: target };
        },

        scan() {
            if (!fsData || !fsData.hosts) return;
            print('SCANNING SUBNET...');
            Object.keys(fsData.hosts).forEach(name => {
                const hostDef = fsData.hosts[name];
                const key = lockKey([], name);
                const locked = hostDef.locked && !unlocked.has(key);
                const status = name === host ? '  [CONNECTED]' : (locked ? '  [ICE PROTECTED]' : '  [OPEN]');
                print('  ' + name + status, locked ? 'cli-locked' : 'cli-dir');
            });
        },

        connect(args) {
            const target = args[0];
            if (!target) {
                print('usage: connect <host>', 'cli-error');
                return;
            }
            if (!fsData.hosts[target]) {
                print('ERROR: host unreachable: ' + target, 'cli-error');
                return;
            }
            if (target === host) {
                print('Already connected to ' + target);
                return;
            }

            const hostDef = fsData.hosts[target];
            const key = lockKey([], target);
            if (hostDef.locked && !unlocked.has(key)) {
                pendingPassword = { kind: 'host', key: key, host: target, node: hostDef, name: target };
                return;
            }

            host = target;
            cwd = [];
            print('CONNECTION ESTABLISHED // ' + target, 'cli-success');
            if (window.Sound) Sound.confirm();
            printMotd();
        },

        disconnect() {
            const defaultHost = fsData.defaultHost || Object.keys(fsData.hosts)[0];
            if (host === defaultHost) {
                print('Already on the local node.');
                return;
            }
            host = defaultHost;
            cwd = [];
            print('LINK TERMINATED // back on ' + defaultHost);
        },

        motd() {
            printMotd();
        },

        whoami() {
            const handle = Terminal.getHandle() || 'guest';
            print(handle + ' // registered edgerunner // trace level: minimal');
        },

        history() {
            history.forEach((cmd, i) => print('  ' + (i + 1) + '  ' + cmd));
        },

        clear() {
            outputEl.innerHTML = '';
        },

        decrypt() {
            print('Standalone decryption is not available on this uplink.', 'cli-error');
            print('Route the payload through the CIPHER DECODER or DATA DECODER quickhacks.');
        },

        sudo() {
            print('PERMISSION DENIED // nice try, choom.', 'cli-error');
            if (window.Sound) Sound.error();
        },

        samurai() {
            print('WAKE UP, SAMURAI. WE HAVE A CITY TO BURN.', 'cli-motd');
        },

        exit() {
            Terminal.navigateToMenu();
        },

        quit() {
            Terminal.navigateToMenu();
        },

        logout() {
            Terminal.logout();
        }
    };

    /**
     * Handle a password entry for a pending unlock or connect
     * @param {string} value - Entered password
     */
    function handlePassword(value) {
        const pending = pendingPassword;
        pendingPassword = null;

        const expected = (pending.node.password || '').toLowerCase();
        if (value.trim().toLowerCase() === expected && expected !== '') {
            unlocked.add(pending.key);
            saveUnlocked();
            print('ACCESS GRANTED', 'cli-success');
            if (window.Sound) Sound.confirm();

            if (pending.kind === 'host') {
                host = pending.host;
                cwd = [];
                print('CONNECTION ESTABLISHED // ' + pending.host, 'cli-success');
                printMotd();
            }
        } else {
            print('ACCESS DENIED // intrusion attempt logged', 'cli-error');
            if (window.Sound) Sound.error();
        }
    }

    /**
     * Parse and execute a command line
     * @param {string} line - Raw input line
     */
    async function execute(line) {
        if (pendingPassword) {
            print(promptEl.textContent + ' ' + '*'.repeat(line.length), 'cli-echo');
            handlePassword(line);
            updatePrompt();
            return;
        }

        print(promptEl.textContent + ' ' + line, 'cli-echo');

        const trimmed = line.trim();
        if (!trimmed) return;

        history.push(trimmed);
        historyIndex = history.length;

        const parts = trimmed.split(/\s+/);
        const cmd = parts[0].toLowerCase();
        const args = parts.slice(1);

        if (COMMANDS[cmd]) {
            await COMMANDS[cmd](args);
        } else {
            print('UNKNOWN COMMAND: ' + cmd + " // type 'help'", 'cli-error');
        }

        updatePrompt();
    }

    /**
     * Handle input field keys: enter, history navigation
     * @param {KeyboardEvent} event
     */
    function handleKey(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            const value = inputEl.value;
            inputEl.value = '';
            execute(value);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                inputEl.value = history[historyIndex];
            }
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (historyIndex < history.length - 1) {
                historyIndex++;
                inputEl.value = history[historyIndex];
            } else {
                historyIndex = history.length;
                inputEl.value = '';
            }
        }
    }

    /**
     * Called when the CLI section is opened
     */
    async function onEnter() {
        if (!booted) {
            fsData = await DataLoader.load('filesystem');

            if (!fsData || !fsData.hosts || !Object.keys(fsData.hosts).length) {
                print('UPLINK ERROR // data/filesystem.json missing or invalid', 'cli-error');
                booted = true;
                return;
            }

            host = fsData.defaultHost || Object.keys(fsData.hosts)[0];
            print(BANNER, 'cli-banner');
            print("NETLINK UPLINK v2.077 // type 'help' for commands");
            printMotd();
            booted = true;
            updatePrompt();
        }
        inputEl.focus();
    }

    /**
     * Initialize the module
     */
    function init() {
        outputEl = document.getElementById('cli-output');
        inputEl = document.getElementById('cli-input');
        promptEl = document.getElementById('cli-prompt');
        if (!outputEl) return;

        inputEl.addEventListener('keydown', handleKey);

        // Clicking anywhere in the terminal focuses the input
        document.getElementById('cli-terminal').addEventListener('click', () => {
            if (!window.getSelection().toString()) inputEl.focus();
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.CLI = {
        onEnter
    };

})();
