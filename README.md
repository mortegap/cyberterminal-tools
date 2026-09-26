# Cyberterminal Tools

Cyberpunk RED netrunning terminal for tabletop sessions. Players open it on their phones or laptops; the GM drives puzzles, messages and glitch effects by editing JSON files live.

![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-yellow)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)
![Offline](https://img.shields.io/badge/LAN-No%20internet%20needed-green)

## Quick Start

### With Docker (recommended)

```bash
docker-compose up --build
```

Open `http://localhost:8083` on the GM machine. Players on the same network open `http://<GM-machine-IP>:8083`.

The `data/` directory is mounted into the container, so editing a JSON file on the host is visible to players without rebuilding.

### Without Docker

Any static web server works. The app must be served over http: opening `index.html` directly (`file://`) does not work, because the browser blocks loading the `data/*.json` files.

```bash
# Python 3 (preinstalled on macOS and most Linux distros)
python3 -m http.server 8083

# Node.js
npx serve -l 8083
```

Then open `http://localhost:8083`. To let players connect, allow the port in your firewall and share your local IP.

### Requirements

- Any modern browser (Chrome, Firefox, Safari, Edge), desktop or mobile.
- No internet connection: fonts and libraries are bundled, everything runs on the local network.
- Plain http is fine. Clipboard and hashing do not need https.

## Tools

| Category | Tool | What it does |
|----------|------|--------------|
| Netrunning | **Breach Protocol** | Cyberpunk 2077 style minigame. Easy/Standard/Hard, breach timer, GM rewards per daemon. Always solvable. |
| | **NET Architecture** | Cyberpunk RED architecture navigator: floors revealed one by one (password, file, control node, Black ICE). |
| | **NETLINK CLI** | Command line over a GM-authored filesystem: `ls`, `cd`, `cat`, `unlock`, `scan`, `connect`... |
| | **Icebreaker** | Password gates with limited attempts, lockout timers and rewards. |
| Decryption | **Data Decoder** | Binary, Hex, Base64 and ASCII85 (UTF-8, accepts unspaced hex/binary). |
| | **Cipher Decoder** | Caesar, Vigenère, Atbash, Substitution. Caesar brute force ranked by likelihood, letter frequency chart (English or Spanish profile). |
| | **Morse Transceiver** | Text to morse and back, with audio playback. Handles accents and Ñ. |
| | **Hash Validator** | SHA-256 digest and verification. |
| Signal analysis | **Spectrogram** | Reveal images hidden in audio files; export PNG. |
| | **Steganography** | Hide or extract text inside image pixels (LSB). |
| | **Signal Tuner** | Sweep a radio band for GM-hidden morse, tones or audio clips. |
| Records | **Databank** | Searchable dossiers with code-locked `[REDACTED]` sections. |
| | **Comms** | Transmission inbox. Urgent GM messages take over the screen. |

Players log in with a handle (stored in the browser), which the GM can use to target messages at one player.

## GM Guide

All campaign content lives in `data/`:

| File | Controls |
|------|----------|
| `config.json` | Menu MOTD, instability level 0-3 (glitch effects), poll interval, Breach Protocol settings |
| `messages.json` | Transmissions: scheduled, targeted, normal or urgent |
| `filesystem.json` | Hosts, folders and files for the NETLINK CLI |
| `netarch.json` | NET architectures and their floors |
| `databank.json` | Dossiers and redacted sections |
| `signals.json` | Radio band and hidden broadcasts |
| `gates.json` | Icebreaker targets |
| `audio/` | Audio clips referenced by `signals.json` |

Formats, examples and a sample puzzle chain are documented in [`data/README.md`](data/README.md). Replace the sample content with your own campaign before sharing the URL.

Heads up: players can open `data/*.json` in the browser, so treat those files as readable by anyone determined enough.

## Project Structure

```
├── index.html            # All tool sections
├── manifest.json         # Web app manifest
├── css/styles.css        # Cyberpunk styling, mobile-first
├── fonts/                # Self-hosted fonts
├── js/                   # One IIFE module per tool (see CLAUDE.md)
├── data/                 # GM campaign content (JSON)
├── nginx/default.conf    # Cache headers and gzip for the container
├── Dockerfile
└── docker-compose.yaml
```

## Tech Stack

- Vanilla JavaScript, no build step, no frameworks
- CSS3 (custom properties, animations), respects reduced-motion settings
- Web Audio API for synthesized sound effects
- nginx:alpine

## License

MIT
