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
│   └── hacking-game.js     # Breach Protocol minigame
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

## Tech Stack

- Vanilla JavaScript (no frameworks)
- CSS3 with custom properties and animations
- nginx:alpine for serving static files

## Code Guidelines

- All code comments and documentation must be written in English
- Follow existing code patterns and naming conventions
- Maintain mobile-first responsive design
