---
name: gm
description: Live Game Master console for the Cyberpunk RED cyberterminal during a session. Use whenever the GM wants to push something to the players' terminals right now - send a transmission to everyone or to one player, schedule or retract messages, trigger glitch/instability effects, change the menu MOTD, tune Breach Protocol difficulty or daemon rewards, manage the player roster, check what is live, undo a change, or save/load a scene snapshot. Triggers on requests like "manda un mensaje a todos", "envíale a Viktor...", "mensaje urgente", "glitch", "inestabilidad", "efecto", "apagón", "cambia el MOTD", "dificultad del breach", "recompensa del daemon", "deshaz", "carga la escena", "estado de la partida".
argument-hint: [what to do, in natural language]
allowed-tools: Bash(python3 .claude/skills/gm/scripts/gmctl.py *), Bash(python .claude/skills/gm/scripts/gmctl.py *)
---

# GM live console

The GM is running a tabletop session right now. Players have the terminal open on their phones/laptops; the app polls `data/*.json` from the Docker container (bind-mounted, so edits are live). Your job: turn the GM's natural-language request into **one `gmctl` call** (or a few), run it, and confirm in **one or two short lines** what players will see and when. Speed beats ceremony.

All commands run from the repo root:

```bash
python3 .claude/skills/gm/scripts/gmctl.py <group> <action> [options]
```

(On Windows use `python` if `python3` is missing.) Every write is atomic, validated, and backed up, so `undo` always works.

## Ground rules

- **Act, don't ask**, for anything reversible (sending, editing, effects, content changes). Only confirm first for bulk-destructive actions: `msg clear`, `fs host-rm`, `snapshot restore`, `snapshot delete`.
- **Don't read the JSON files** to do routine work; `gmctl` already knows the formats. Use `status`, `msg list`, `breach show` etc. when you need state.
- **Reply in the GM's language**, briefly. Echo the message id (e.g. `msg-012`) so the GM can retract or edit it later.
- **Writing the message**: if the GM quotes exact text, use it verbatim. If they give the gist ("dile a Viktor que le están siguiendo"), write a short in-world transmission (cyberpunk tone, 1-4 lines, same language the GM used unless told otherwise) and send it without asking. Pick a fitting sender if the GM doesn't name one (the last sender is remembered and reused).
- Multi-line bodies: `\n` inside the quoted string becomes a newline. For long text pass `--body -` with a heredoc.
- Never put GM-only secrets in data files players don't need: anything in `data/` can be fetched by a curious player. The roster and snapshots live in `.claude/gm-state/`, which is never served.

## Players and targeting

Messages target `all` or one login handle (case-insensitive). The roster maps characters and real names to handles, so the GM can say "envíale a Viktor".

```bash
gmctl players list
gmctl players add V1KT0R --name "Viktor" --player "Ana"   # handle as the player typed it at login
gmctl players rm V1KT0R
```

`--to` accepts `all`, a handle, a character name, a player name, or a comma list (`--to "Viktor,Kira"` creates one message per recipient). If a name is not in the roster and is not a valid handle, gmctl errors: run `players list` and ask the GM which handle they meant. Handles are 2-16 chars `[A-Za-z0-9_-]`.

## Transmissions

```bash
gmctl msg send --to all --from "FIXER//WILDSIDE" --subject "Window open" --body "Move now.\n- W"
gmctl msg send --to Viktor --subject "..." --body "..." --urgent      # full-screen takeover + alarm sound
gmctl msg send --to all --subject "..." --body "..." --in 10m          # scheduled (or --at 21:30 local, or ISO)
gmctl msg list [-n 5]          # id, LIVE/SCHEDULED, priority, recipient, subject
gmctl msg show msg-004
gmctl msg edit msg-004 [--subject ..] [--body ..] [--to ..] [--urgent|--normal] [--at ..|--in ..|--now]
gmctl msg resend msg-004 [--to Kira]   # copy with a new id so it pops up again
gmctl msg rm msg-004 [msg-005 ...]     # retract: disappears from inboxes on next poll
gmctl msg clear --yes [--keep-scheduled]
```

What players experience:
- `normal`: corner toast + unread badge + COMMS inbox. `--urgent`: screen takeover with typewriter text, alarm and static burst; queued if several arrive.
- Latency: messages are polled every `pollIntervalSeconds` (default 10 s).
- Read state is per message id in each browser; editing an already-read message does not make it pop again (use `resend`).
- A player who logs in later receives every unread live message, including old urgent ones, one takeover after another. After a dramatic urgent scene, offer to `msg rm` it or `msg edit <id> --normal`.
- Use `--at`/`--in` to pre-load reveals before the session; `msg edit <id> --now` releases one early.

## Effects and global config

```bash
gmctl fx instability 2                 # 0 stable, 1 flicker, 2 glitch bursts + UNSTABLE, 3 + static sound + CRITICAL
gmctl fx instability 3 --for 45s       # pulse, then back to the previous level (blocks: run it in the background)
gmctl fx instability 3 --for 1m --restore 1
gmctl fx calm                          # back to 0
gmctl fx motd "BLACKWALL BREACH DETECTED"
gmctl config show
gmctl config poll 5                    # message poll seconds (min 5), only after players reload
```

Config is polled every ~15 s, so pulses shorter than ~20 s may be missed. **Always run `--for` pulses with the Bash tool's `run_in_background: true`** so the console stays free, and tell the GM when it will revert.

Ready-made combos (run the calls in one go):
- **NET crash / blackout**: `fx instability 3 --for 45s` (background) + urgent message from `SYSTEM//NETWATCH` or similar.
- **ICE detected / they've been spotted**: `fx instability 2` + urgent message; `fx calm` when the scene ends.
- **Ominous ambience**: `fx instability 1` + new MOTD.
- **Clean slate after a scene**: `fx calm`, MOTD back to normal, `msg edit <urgent-id> --normal`.

## Breach Protocol (the minigame)

```bash
gmctl breach show
gmctl breach set --difficulty hard --lock     # easy | standard | hard; --lock hides the selector, --unlock frees it
gmctl breach daemon 1 --name CAMERA_LOOP --reward "East door cameras looped for 10 minutes."
gmctl breach daemon 3 --reward "Shipping manifest copied to your deck."
gmctl breach reset                             # remove GM settings, players pick freely
```

Up to 3 daemons, in order. Rewards show on the result screen per completed daemon. Changes apply on the player's next NEW BREACH.

## State, undo and scenes

```bash
gmctl status                 # one-screen summary: MOTD, instability, breach, messages, hosts, counts, roster, errors
gmctl validate               # full consistency check (exit 1 on errors)
gmctl undo                   # revert the last change (any file); `undo 3` reverts three
gmctl undo --list            # recent changes
gmctl snapshot save escena-2-almacen           # whole data/ JSON state
gmctl snapshot list
gmctl snapshot restore escena-2-almacen [--only signals gates]
```

Use snapshots as prepared scene packs: build the scene's content ahead of time, `snapshot save` it, and restore it at the table. Suggest `snapshot save pre-sesion` before the first change of a session. Restores are themselves undoable.

## Related skills

- Creating or changing puzzle content (CLI hosts/files, databank dossiers and redactions, Icebreaker gates, NET architectures, radio signals, audio clips, downloadable files): use the `gm-content` skill.
- Producing ciphertext, encodings, morse, hashes, stego images or spectrogram audio that the players' tools can decode: use the `gm-crypto` skill.
- Docker server start/stop/logs, the URL players should open, or "players don't see my changes": use the `gm-server` skill.

## Things the app cannot do (don't promise them)

- Force a player's screen to a specific tool, play arbitrary sounds on demand (only the urgent alarm, instability 3 static, and tuner broadcasts make sound), or read what players type. There is no server-side player list: the roster is maintained by the GM.
- Reset one player's progress. Progress lives in each browser; `gmctl gate reset` / `arch reset` re-arm a gate or architecture for everyone by changing its id.
