# Cyberterminal Tools

Cyberpunk 2077 style netrunning terminal with encoding tools and a hacking minigame.

![Vanilla JS](https://img.shields.io/badge/Vanilla-JavaScript-yellow)
![Docker](https://img.shields.io/badge/Docker-Ready-blue)

## Quick Start

```bash
docker-compose up --build
```

Open `http://localhost:8080`

## Features

### Data Encoder/Decoder
Convert text between different formats:
- **Binary** - 8-bit octets
- **Hexadecimal** - Hex bytes
- **Base64** - Standard Base64
- **ASCII85** - Adobe ASCII85

### Breach Protocol
Hacking minigame inspired by Cyberpunk 2077:
- 5x5 code matrix
- 6-slot buffer
- 3 daemon sequences to complete
- Alternating row/column selection

## Project Structure

```
├── index.html          # Main terminal interface
├── css/styles.css      # Cyberpunk styling
├── js/
│   ├── main.js         # Navigation
│   ├── encoder.js      # Encoder/decoder logic
│   └── hacking-game.js # Breach Protocol game
├── Dockerfile
└── docker-compose.yaml
```

## Tech Stack

- Vanilla JavaScript
- CSS3 (animations, custom properties)
- nginx:alpine

## License

MIT
