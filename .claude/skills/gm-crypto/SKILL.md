---
name: gm-crypto
description: Forge puzzle payloads that the players' cyberterminal tools can decode exactly - Binary/Hex/Base64/ASCII85 encodings (DATA DECODER), Caesar/Vigenere/Atbash/Substitution ciphertext (CIPHER DECODER), morse (MORSE TRANSCEIVER / SIGNAL TUNER), SHA-256 digests (HASH VALIDATOR), PNG images with hidden LSB text (STEGANOGRAPHY) and WAV audio that shows text or an image in the SPECTROGRAM ANALYZER - and plant them in the game. Use when the GM asks to encrypt, encode, hide or obfuscate a clue, or wants a new decode challenge for the encoder/decoder, cipher, morse, hash, stego or spectrogram tools. Triggers on "cifra esto", "pásalo a base64/hex/binario", "vigenère con clave", "morse", "hash", "esconde un mensaje en una imagen", "audio con imagen en el espectrograma", "un reto para el decoder".
argument-hint: [clue to hide and how]
allowed-tools: Bash(python3 .claude/skills/gm/scripts/gmctl.py *), Bash(python .claude/skills/gm/scripts/gmctl.py *)
---

# GM payload forge

The decoding tools (DATA DECODER, CIPHER, MORSE, HASH, STEGANOGRAPHY, SPECTROGRAM) run entirely in the player's browser and have no GM data of their own. "Updating them live" means **producing a new payload they can crack and delivering it** through a channel the GM controls: a transmission, a CLI file, a radio signal, a databank entry, a gate reward, or a downloadable file.

`gmctl` reimplements each tool's algorithm byte for byte (verified against the app's JavaScript), so whatever it produces decodes exactly in the player's tool.

```bash
python3 .claude/skills/gm/scripts/gmctl.py <command> ...   # written below as `gmctl`
```

## Encodings and ciphers

```bash
gmctl enc base64 "Dock 4, midnight"          # binary | hex | base64 | ascii85  (UTF-8, like DATA DECODER)
gmctl dec hex "44 6f 63 6b"
gmctl cipher vigenere encrypt "SHIPMENT ARRIVES DOCK FOUR MIDNIGHT" --key TRAUMA
gmctl cipher caesar encrypt "meet at the afterlife" --key 13      # shift 1-25 only (app limit)
gmctl cipher atbash encrypt "text"
gmctl cipher sub encrypt "text" --key random    # prints the generated alphabet on stderr: keep it for the GM
gmctl cipher vigenere decrypt "..." --key TRAUMA   # sanity check
gmctl morse encode "BLACKWALL"                  # same output as the MORSE TRANSCEIVER
gmctl morse decode ".-- .- -.-. ...."
gmctl sha256 "silvia"                           # same digest as the HASH VALIDATOR
```

Ciphers keep case, spaces and punctuation, and only touch A-Z (accented letters pass through unchanged, so prefer unaccented plaintext for ciphers). Caesar ciphertext of normal sentences can be brute-forced in the CIPHER tool (it ranks shifts by English/Spanish letter frequency); use Vigenere or substitution when it should take real effort. Layering works: e.g. Vigenere, then base64.

## Hidden in an image (STEGANOGRAPHY tool)

```bash
gmctl stego embed "Access code NC-441" --generate 640x400 --out /tmp/intercept.png    # synthetic carrier
gmctl stego embed "Access code NC-441" --carrier ~/photo.png --out /tmp/photo_x.png    # GM's own PNG
gmctl stego extract /tmp/photo_x.png             # verify
gmctl file add /tmp/photo_x.png --name surveillance_07.png                             # publish + LAN URL
```

PNG carriers work out of the box (JPEG/WebP need Pillow installed; otherwise use `--generate` or convert to PNG first). The output must stay PNG and must not be resized or recompressed (chat apps often do this: share via the printed URL instead).

## Hidden in audio (SPECTROGRAM ANALYZER)

```bash
gmctl spectro text "NC-441" --out data/audio/burst_441.wav           # draws the text in the frequency domain
gmctl spectro image ~/logo.png --out /tmp/ghost.wav [--rows 40]      # draws a picture (high contrast works best)
```

Defaults are tuned for the analyzer at FFT 2048 (the default): text at 6-11 kHz, images at 2-16 kHz, duration chosen so proportions look right. Keep text short (codes, names: about 12 characters or fewer). Generation takes a few seconds.

Players need the file itself to analyze it, so publish it with `gmctl file add <wav>` and give them the URL. You can also make it a radio broadcast so they hear the strange noise first: `gmctl sig add --freq 93.3 --type audio --src data/audio/burst_441.wav --label "DIGITAL BURST"` (the tuner only plays it; the analyzer needs the download).

## Delivering the payload

| Channel | Command |
|---|---|
| Transmission | `gmctl msg send --to all --from "UNKNOWN//NO-TRACE" --subject "intercept" --body "<payload>"` |
| CLI file | `gmctl fs write militech-relay:/orders.enc --content "<payload>"` |
| Radio (morse) | `gmctl sig add --freq 91.3 --type morse --text "<plaintext>" --wpm 10` (the tuner encodes it) |
| Databank | `gmctl db set <id> --append "Intercepted: <payload>"` |
| Gate / breach reward | `gmctl gate set <id> --reward "..."` or `gmctl breach daemon 2 --reward "..."` |
| File download | `gmctl file add <path>` and send the URL in a message |

Hash puzzles: the HASH VALIDATOR compares the digest of what a player types against a digest they paste. Publish the SHA-256 of the answer ("the passphrase hashes to 3f2a...") so players can confirm a guess without the answer appearing anywhere in plain text.

## Workflow

1. Produce the payload and, for anything reversible, decode it back once to verify.
2. Plant it with the right command (it is live as soon as players reopen that tool or the message poll arrives).
3. Tell the GM in one or two lines: the ciphertext (shortened if long), the key or code, which tool cracks it, and where it was planted. Mention where the key comes from, or suggest a place to plant it (another CLI file, a morse signal, a databank field).
