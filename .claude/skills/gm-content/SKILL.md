---
name: gm-content
description: Create or change the cyberterminal's puzzle content live - NETLINK CLI hosts, folders and files (with passwords), DATABANK dossiers and [REDACTED] sections with unlock codes, ICEBREAKER password gates, Cyberpunk RED NET architectures and floors, SIGNAL TUNER radio broadcasts (morse, tone, audio), GM audio clips and downloadable files for players. Use when the GM wants to add, edit, lock, unlock, reveal, move or delete any of these, re-arm a puzzle, or load new files into the game. Triggers on "añade un archivo al CLI", "crea un host", "bloquea con contraseña", "nuevo dossier", "censura/redacta", "revela", "nueva puerta del icebreaker", "arquitectura", "añade un piso de ICE", "pon una señal en 95.5", "sube este audio", "carga este archivo", "resetea el puzzle".
argument-hint: [content change, in natural language]
allowed-tools: Bash(python3 .claude/skills/gm/scripts/gmctl.py *), Bash(python .claude/skills/gm/scripts/gmctl.py *)
---

# GM content editor

Live edits to the campaign content in `data/`. Same tool and rules as the `gm` skill: run one `gmctl` call per change from the repo root, act without asking (everything is undoable with `gmctl undo`), and answer the GM in their language in one or two lines, including any password/code you set and **when players will see it**.

```bash
python3 .claude/skills/gm/scripts/gmctl.py <group> <action> ...   # written below as `gmctl`
```

Visibility rule: CLI, Databank, Icebreaker, NET architectures and the Signal Tuner re-fetch their file **every time a player opens the tool**. Tell the GM players must leave and re-enter the tool (no page reload needed).

Field formats and the sample puzzle chain are documented in `data/README.md`; read it only when you need a field `gmctl` does not cover.

## NETLINK CLI (`filesystem.json`)

Paths are `host:/dir/file`. Missing directories are created.

```bash
gmctl fs tree [host]                      # hosts, dirs, files, locks with their passwords
gmctl fs cat street-node:/readme.txt
gmctl fs write street-node:/jobs/new_gig.txt --content "line 1\nline 2"
gmctl fs write militech-relay:/orders2.enc --content "<ciphertext>" --lock blackwall
gmctl fs mkdir street-node:/vault2 --lock wetwork
gmctl fs lock street-node:/vault2 newpass     # host or path
gmctl fs open street-node:/vault2             # remove the lock for everyone
gmctl fs mv street-node:/a.txt militech-relay:/b.txt
gmctl fs rm street-node:/jobs/old.txt
gmctl fs host-add arasaka-node --motd "ARASAKA SUBNET 3 // AUTHORIZED ONLY" [--lock pass]
gmctl fs host-rm arasaka-node             # confirm with the GM first
gmctl fs default street-node              # first host for new players
gmctl fs motd arasaka-node "banner text"
```

Notes: players discover hosts with `scan` and enter with `connect`. Passwords are case-insensitive. An unlock is remembered per browser by `host:/path`, so changing a password does not re-lock players who already got in; moving/renaming a locked node re-locks it. Removing the folder a player is standing in sends them back to the default host with "LINK RESET". Ciphertext for files comes from the `gm-crypto` skill.

## DATABANK (`databank.json`)

```bash
gmctl db list [search]
gmctl db show npc-vasquez
gmctl db add npc-rogue --name "Rogue Amendiares" --type NPC --alias "Queen of Fixers" \
    --tag afterlife --tag fixer --field "AFFILIATION=Afterlife" --field "THREAT=High" --body "Text..."
gmctl db set npc-rogue [--name ..] [--field K=V] [--rm-field K] [--add-tag t] [--body ..] [--append "new paragraph"]
gmctl db redact npc-rogue safehouse --code NC-441 --content "Charter Hill, apt 2207" --label "Safehouse: "
gmctl db unredact npc-rogue safehouse     # reveal to everyone (inlines the text)
gmctl db rm npc-rogue
```

`redact` appends `{{redacted:key}}` to the body if it isn't there yet (use `--label` for the text before it), or place the token yourself with `db set --body`. Codes are case-insensitive. Unlocks are remembered per browser by `record-id:key`. Always tell the GM where players can obtain the code; if nowhere yet, suggest a place (gate reward, CLI file, radio morse, breach daemon reward).

## ICEBREAKER (`gates.json`)

```bash
gmctl gate list
gmctl gate add arasaka-vault --name "ARASAKA VAULT" --password saburo --hint "The old man's first name." \
    --attempts 3 --lockout 120 --reward "Vault open. Code: AR-77"
gmctl gate set arasaka-vault [--password ..] [--hint ..] [--attempts N] [--lockout S] [--reward ..]
gmctl gate reset arasaka-vault            # re-arm for everyone (new id: attempts, lockouts, breaches cleared)
gmctl gate rm arasaka-vault
```

## NET architectures (`netarch.json`)

```bash
gmctl arch list
gmctl arch show warehouse77
gmctl arch add arasaka-tower --name "ARASAKA TOWER NODE" --difficulty HARD --desc "Corporate core, 7 floors"
gmctl arch floor arasaka-tower --type password --name "LOGIN GATE" --dv 8 --desc "..."
gmctl arch floor arasaka-tower --type ice --ice HELLHOUND --name "ATTACK DAEMON" --dv 8 --desc "PER 6 / SPD 6 / ATK 6 / DEF 2 / REZ 20"
gmctl arch floor arasaka-tower --type file --name "BLACK BOX" --dv 10 --desc "..." --content "revealed text" [--at 3]
gmctl arch floor arasaka-tower --type control --name "TURRETS" --dv 10
gmctl arch floor-set arasaka-tower 2 [--dv 10] [--content ..]     # 1-based floor index
gmctl arch floor-rm arasaka-tower 2
gmctl arch set arasaka-tower [--name ..] [--difficulty ..] [--desc ..]
gmctl arch reset arasaka-tower            # everyone starts at floor 1 again (new id)
gmctl arch rm arasaka-tower
```

Floors reveal top-down when a player presses BREACH FLOOR; the GM adjudicates the roll. When the GM describes a whole architecture in prose, build it floor by floor with these commands (use real Cyberpunk RED ICE stats when they name a program: Wisp, Hellhound, Killer, Kraken, Raven, Asp, Skunk, Scorpion, Liche, Giant, Sabertooth, Dragon...).

## SIGNAL TUNER (`signals.json`)

```bash
gmctl sig list
gmctl sig add --freq 95.5 --type morse --label "NUMBERS STATION" --text "NC 441" --wpm 10
gmctl sig add --freq 99.9 --type tone --tone-hz 440 --label "CARRIER"
gmctl sig add --freq 104.5 --type audio --src ~/Downloads/broadcast.mp3 --label "PIRATE BROADCAST"   # file copied into data/audio
gmctl sig set --freq 95.5 [--new-freq 96.1] [--text ..] [--wpm ..] [--label ..] [--tolerance 0.3] [--type ..]
gmctl sig rm --freq 95.5
gmctl sig band --min 88 --max 108 --step 0.1 [--unit MHz]
```

Morse handles letters, digits, common punctuation, accents and Ñ (other characters are dropped; gmctl warns). Overlapping or unreachable frequencies trigger a warning. Signals loop while the player stays locked on; audio plays through the browser (muted if the player has SND:OFF).

## Audio clips and files for players

```bash
gmctl audio list                   # data/audio, shows which clips a signal uses
gmctl audio add ~/clip.mp3 [--name broadcast.mp3]
gmctl audio rm broadcast.mp3
gmctl file add ~/evidence.png [--name dossier.png]   # publishes data/files/<name>, prints the LAN URL
gmctl file list
gmctl file rm dossier.png
```

`file add` is the way to hand players anything the browser tools load from disk: stego images for STEGANOGRAPHY, audio for the SPECTROGRAM ANALYZER, or plain documents. Players download it from the printed URL; deliver the URL in-world with `gmctl msg send` or a CLI file.

## Bulk or unusual edits

For changes gmctl has no flag for (reordering records, rewriting many files at once, importing a prepared JSON):

1. `gmctl checkpoint <file...>` (makes the edit undoable)
2. Edit `data/<file>.json` directly with the Edit tool, keeping the format from `data/README.md`
3. `gmctl validate` and fix any ERROR before telling the GM it is done

To swap a whole prepared scene in, prefer `gmctl snapshot restore` (see the `gm` skill).

## Consistency checks to keep in mind

- Every lock, code and password must be obtainable somewhere in the game. When you create one, say where players can find it, or propose where to plant it.
- `gmctl validate` flags: redaction tokens without codes, locks without passwords, missing audio files, duplicate ids, signals outside the band or overlapping.
- Players can read raw `data/*.json` if they go looking. Keep answers out of plain sight when the GM cares: the passwords must be in the JSON for the app to check them, so for high-stakes puzzles favor answers that require solving (ciphertext, hashes) over plain-text rewards.
