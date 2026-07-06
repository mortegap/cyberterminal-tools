# GM Content Guide

Everything in this directory is campaign content you can edit live during a session. The directory is mounted as a Docker volume, so changes on the host are visible to players without rebuilding the container. Clients poll `messages.json` and `config.json` automatically (default every 10 seconds); other files are loaded when a player opens the matching tool, so a page refresh picks up edits.

All files must be valid JSON. If a file is missing or broken, the matching tool shows an empty state instead of crashing.

## config.json

Global terminal settings.

```json
{
    "motd": "Text shown in the main menu footer",
    "instability": 0,
    "pollIntervalSeconds": 10
}
```

`instability` ranges 0 to 3. Level 1 increases scanline flicker, level 2 adds random glitch bursts and an UNSTABLE status, level 3 adds static sound bursts and a CRITICAL status. Use it when players are somewhere they should not be.

## messages.json

Transmissions pushed to player terminals.

```json
{
    "messages": [
        {
            "id": "msg-001",
            "from": "FIXER//WILDSIDE",
            "to": "all",
            "subject": "Subject line",
            "body": "Multi line body.\nUse \\n for line breaks.",
            "time": "2026-01-01T20:30:00Z",
            "priority": "normal"
        }
    ]
}
```

- `id` must be unique and stable. Players' read state is tracked by id.
- `to` is `all` or a specific player handle (case-insensitive).
- `time` is optional. Messages with a future time stay hidden until then, so you can schedule reveals before the session.
- `priority: "urgent"` takes over the whole screen with an alarm. `normal` shows a corner toast and the unread badge.

## filesystem.json

Virtual filesystem for the NETLINK CLI tool.

```json
{
    "defaultHost": "street-node",
    "hosts": {
        "host-name": {
            "locked": true,
            "password": "secret",
            "motd": "Banner shown on connect",
            "root": {
                "type": "dir",
                "children": {
                    "file.txt": { "type": "file", "content": "text or array of lines" },
                    "subdir": { "type": "dir", "locked": true, "password": "secret", "children": {} }
                }
            }
        }
    }
}
```

- Players discover hosts with `scan` and enter them with `connect <host>`.
- Any dir or file can carry `locked: true` plus `password`. Players open them with `unlock <name>`.
- Passwords are case-insensitive. Unlocks persist in the player's browser.
- Put ciphertext in file contents and let players decrypt it with the terminal tools.

## netarch.json

Cyberpunk RED NET architectures for the navigator.

```json
{
    "architectures": [
        {
            "id": "unique-id",
            "name": "DISPLAY NAME",
            "difficulty": "STANDARD",
            "description": "Optional subtitle",
            "floors": [
                { "type": "password", "name": "LOGIN GATE", "dv": 6, "description": "..." },
                { "type": "ice", "ice": "WISP", "name": "PATROL", "dv": 6, "description": "stats here" },
                { "type": "file", "name": "RECORDS", "dv": 8, "description": "...", "content": "revealed text" },
                { "type": "control", "name": "CAMERAS", "dv": 8, "description": "..." }
            ]
        }
    ]
}
```

Floor types: `password`, `file`, `control`, `ice`. Floors reveal top to bottom when a player presses BREACH FLOOR (you adjudicate the roll at the table). `content` on file floors is shown after the breach. Progress persists per browser; there is a reset button.

## databank.json

Dossier records for the DATABANK tool.

```json
{
    "records": [
        {
            "id": "unique-id",
            "type": "NPC",
            "name": "Display Name",
            "alias": "Optional alias",
            "tags": ["searchable", "tags"],
            "fields": { "LABEL": "value" },
            "body": "Long text. Hide secrets like this: {{redacted:keyname}}",
            "redacted": {
                "keyname": { "code": "NC-441", "content": "Revealed text" }
            }
        }
    ]
}
```

`{{redacted:key}}` tokens render as clickable [REDACTED] blocks. Entering the matching `code` (case-insensitive) reveals the content permanently on that browser. Distribute codes through other tools: icebreaker rewards, CLI files, morse signals.

## signals.json

Hidden broadcasts for the SIGNAL TUNER.

```json
{
    "band": { "min": 88.0, "max": 108.0, "step": 0.1, "unit": "MHz" },
    "signals": [
        { "freq": 91.3, "tolerance": 0.2, "label": "NAME", "type": "morse", "text": "SECRET", "wpm": 10 },
        { "freq": 99.9, "tolerance": 0.2, "label": "NAME", "type": "tone", "toneHz": 440 },
        { "freq": 104.5, "tolerance": 0.3, "label": "NAME", "type": "audio", "src": "data/audio/file.mp3" }
    ]
}
```

Signal types: `morse` plays the text as repeating morse audio, `tone` plays a steady tone, `audio` loops a file you place in `data/audio/`. The scanner shows a spike when the tuned frequency gets close, and locks within `tolerance`.

## gates.json

Targets for the ICEBREAKER password puzzle.

```json
{
    "targets": [
        {
            "id": "unique-id",
            "name": "TARGET SYSTEM NAME",
            "hint": "Shown to players",
            "password": "answer",
            "maxAttempts": 5,
            "lockoutSeconds": 120,
            "reward": "Text revealed on success. Put codes or intel here."
        }
    ]
}
```

Failing `maxAttempts` times triggers a lockout timer. Breached state persists per browser.

## Chaining puzzles

The sample content shows the intended pattern:

1. An urgent transmission points players at the 91.3 MHz band.
2. The morse signal there spells the password for the `militech-relay` CLI host.
3. A file on that host is Vigenere ciphertext; the keyword hint sits in another CLI file.
4. The databank names Vasquez's daughter, which cracks the Biotechnica gate in ICEBREAKER.
5. That gate's reward is the access code for the redacted safehouse in the databank.

Replace all sample content with your own campaign before giving players the URL.
