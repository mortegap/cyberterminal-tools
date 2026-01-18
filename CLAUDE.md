# Cyberterminal Tools

Cyberpunk 2077 style netrunning terminal with encoding/decoding tools and a hacking minigame.

## Project Structure

```
cyberterminal-tools/
├── index.html              # Main page with terminal interface
├── css/
│   └── styles.css          # Cyberpunk 2077 styling
├── js/
│   ├── main.js             # Navigation and boot sequence
│   ├── encoder.js          # Binary/Hex encoder-decoder tool
│   ├── hacking-game.js     # Breach Protocol minigame
│   ├── cipher.js           # Classic cryptography toolkit
│   ├── spectrogram.js      # Audio spectrogram analyzer
│   └── lib/
│       └── fft.js          # FFT library for spectrogram
├── Dockerfile              # nginx-based container
└── docker-compose.yaml     # Container orchestration
```

## Running the Project

```bash
docker-compose up --build
```

Access at `http://localhost:8080`

## Features

### Data Encoder/Decoder
- **Binary Mode**: Convert text to/from binary (8-bit octets)
- **Hexadecimal Mode**: Convert text to/from hex bytes
- Copy output to clipboard

### Breach Protocol Minigame
- 5x5 code matrix with hex codes
- 6-slot buffer for selections
- 3 daemon sequences to complete
- Alternating row/column selection (like Cyberpunk 2077)

### Cipher Decoder
Classic cryptography toolkit for Cyberpunk RED RPG puzzles:
- **Caesar**: Rotate letters by N positions (key: 1-25)
- **Vigenère**: Polyalphabetic cipher with keyword
- **Atbash**: Reversed alphabet (A↔Z, B↔Y...)
- **Substitution**: Custom 26-letter alphabet replacement

### Spectrogram Analyzer
Audio frequency visualization tool for revealing hidden images in sound files:
- Upload audio files (WAV/MP3/OGG)
- Configurable FFT sizes (1024, 2048, 4096, 8192)
- Three color schemes: Cyber, Heat, Grayscale
- Export spectrogram as PNG
- Uses Web Audio API + FFT.js library

## Tech Stack

- Vanilla JavaScript (no frameworks)
- CSS3 with custom properties and animations
- nginx:alpine for serving static files

## Code Guidelines

- All code comments and documentation must be written in English
- Follow existing code patterns and naming conventions
- Maintain mobile-first responsive design
