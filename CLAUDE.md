# Cyberterminal Tools

Cyberpunk RED netrunning agent terminal for tabletop players: encoding/decoding tools, puzzle modules and GM-driven live content.

## Project Structure

```
cyberterminal-tools/
├── index.html              # Main page with all tool sections
├── manifest.json           # PWA manifest
├── favicon.svg             # Terminal icon
├── css/
│   └── styles.css          # Cyberpunk 2077 styling
├── fonts/                  # Self-hosted woff2 fonts (works offline/LAN)
├── js/
│   ├── main.js             # Boot, login, navigation, config/instability
│   ├── utils.js            # Escaping, clipboard fallback, typewriter
│   ├── sound.js            # Web Audio synthesized SFX, mute toggle
│   ├── modal.js            # Themed alert/confirm/prompt system
│   ├── data-loader.js      # Fetch/poll GM JSON from data/
│   ├── transmissions.js    # GM messages: interrupts, toasts, inbox
│   ├── encoder.js          # Binary/Hex/Base64/ASCII85 encoder-decoder
│   ├── hacking-game.js     # Breach Protocol minigame
│   ├── cipher.js           # Cryptography toolkit + frequency analysis
│   ├── spectrogram.js      # Audio spectrogram analyzer
│   ├── cli.js              # NETLINK CLI over virtual filesystem
│   ├── netarch.js          # Cyberpunk RED NET architecture navigator
│   ├── databank.js         # Dossier database with redacted unlocks
│   ├── stego.js            # Image LSB steganography embed/extract
│   ├── signal.js           # Radio band tuner with hidden broadcasts
│   ├── morse.js            # Morse transceiver with audio playback
│   ├── hasher.js           # SHA-256 validator (pure JS)
│   ├── icebreaker.js       # Password gate puzzle with lockouts
│   └── lib/
│       └── fft.js          # FFT library for spectrogram
├── data/                   # GM campaign content (JSON), mounted as volume
│   ├── README.md           # GM authoring guide for all data formats
│   ├── config.json         # MOTD, instability level, poll interval
│   ├── messages.json       # Transmissions pushed to players
│   ├── filesystem.json     # CLI virtual filesystem
│   ├── netarch.json        # NET architectures
│   ├── databank.json       # Dossier records
│   ├── signals.json        # Radio band signals
│   ├── gates.json          # Icebreaker targets
│   └── audio/              # GM audio clips for signals
├── nginx/
│   └── default.conf        # Cache headers (no-cache shell/data) and gzip
├── Dockerfile              # nginx-based container
└── docker-compose.yaml     # Container orchestration + data volume
```

## Running the Project

```bash
docker-compose up --build
```

Access at `http://localhost:8083`

The `data/` directory is mounted as a read-only volume, so the GM can edit campaign JSON on the host mid-session without rebuilding. Clients poll `config.json` and `messages.json`; other files are re-fetched every time a tool is opened.

## Features

### Player identity
Boot sequence (skippable, once per browser session), then operator login. The handle persists in localStorage, personalizes the header and CLI prompt, and lets the GM target messages at specific players.

### Tools
- **Data Encoder/Decoder**: Binary, Hex, Base64, ASCII85
- **Breach Protocol**: Cyberpunk 2077 style minigame with easy/standard/hard presets and a breach timer. Daemon sequences are sliced from a valid path through the matrix, so puzzles are always solvable. GM can set default/locked difficulty and per-daemon rewards via `config.json` `breach`
- **Cipher Decoder**: Caesar, Vigenere, Atbash, Substitution, Caesar brute force ranked by letter-frequency log-likelihood, plus a letter frequency analysis chart (English or Spanish reference)
- **Spectrogram Analyzer**: reveal images hidden in audio, FFT result cached so color scheme changes re-render instantly
- **NETLINK CLI**: command line over a GM-authored filesystem (hosts, locked dirs, encrypted files)
- **NET Architecture**: Cyberpunk RED architecture floor navigator with password/file/control/ICE floors
- **Databank**: searchable dossiers with code-locked `[REDACTED]` sections
- **Icebreaker**: password gate puzzle with limited attempts and lockout timers
- **Steganography**: embed/extract text payloads in image LSBs
- **Signal Tuner**: sweep a radio band for GM-hidden morse/tone/audio broadcasts
- **Morse Transceiver**: encode/decode with audio playback
- **Hash Validator**: SHA-256 digest and verification (pure JS, works over LAN http)
- **Comms**: transmission inbox; urgent GM messages take over the screen

### GM controls (via data/ JSON)
MOTD, instability level 0-3 (escalating glitch effects), scheduled and targeted messages, Breach Protocol difficulty and rewards. See `data/README.md` for all formats and the sample puzzle chain.

## Tech Stack

- Vanilla JavaScript (no frameworks), IIFE modules exposing `window.X` APIs
- CSS3 with custom properties and animations
- Web Audio API for synthesized SFX (no audio assets)
- nginx:alpine for serving static files

## Code Guidelines

- All code comments and documentation must be written in English
- Follow existing code patterns and naming conventions
- Maintain mobile-first responsive design
- No external CDN dependencies: fonts are self-hosted, everything must work on a LAN without internet
- Clipboard and crypto must not rely on secure-context-only APIs (players connect over plain http)
- Respect `prefers-reduced-motion` and keep interactive elements keyboard reachable (real buttons, or `role="button"` + `tabindex="0"`, which main.js activates on Enter/Space)
