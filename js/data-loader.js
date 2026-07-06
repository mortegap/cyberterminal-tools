/**
 * NETRUNNER TERMINAL - Data Loader
 * Fetches GM-authored JSON content from the data/ directory.
 * Files can be edited on the host mid-session, clients poll for changes.
 */

(function() {
    'use strict';

    const cache = {};

    /**
     * Load a JSON file from data/
     * @param {string} name - File name without extension
     * @param {boolean} fresh - Bypass the in-memory cache
     * @returns {Promise<Object|null>} Parsed JSON or null on failure
     */
    async function load(name, fresh = false) {
        if (!fresh && cache[name] !== undefined) {
            return cache[name];
        }

        try {
            const res = await fetch(`data/${name}.json?ts=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) {
                cache[name] = null;
                return null;
            }
            cache[name] = await res.json();
            return cache[name];
        } catch (error) {
            // Keep last known good data on transient failures
            return cache[name] !== undefined ? cache[name] : null;
        }
    }

    /**
     * Poll a JSON file on an interval
     * @param {string} name - File name without extension
     * @param {function} callback - Called with fresh data on every tick
     * @param {number} intervalMs - Poll interval in milliseconds
     * @returns {number} Interval id
     */
    function poll(name, callback, intervalMs) {
        const tick = async () => {
            const data = await load(name, true);
            callback(data);
        };
        tick();
        return setInterval(tick, intervalMs);
    }

    window.DataLoader = {
        load,
        poll
    };

})();
