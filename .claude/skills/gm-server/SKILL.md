---
name: gm-server
description: Run and troubleshoot the cyberterminal Docker Compose server during a session - start, stop, restart or rebuild the container, read logs, get the LAN URL players should open, and verify that the container serves the current data/ files. Use when the GM says the server is down, players can't connect, players don't see changes, a message doesn't arrive, audio doesn't play, or asks to start/stop/rebuild the terminal. Triggers on "arranca el servidor", "levanta el docker", "para el contenedor", "reconstruye", "qué URL les doy", "no les llega el mensaje", "no ven los cambios", "logs".
argument-hint: [server task or symptom]
allowed-tools: Bash(python3 .claude/skills/gm/scripts/gmctl.py *), Bash(python .claude/skills/gm/scripts/gmctl.py *), Bash(docker compose ps*), Bash(docker compose logs*), Bash(docker ps*)
---

# GM server ops

The terminal is a static nginx container (`docker-compose.yaml`, service `netrunner-terminal`, container `cyberterminal`, port `8083:80`). `./data` is bind-mounted read-only, so **content edits never need a rebuild or restart**. Only changes to the app itself (`index.html`, `js/`, `css/`, `nginx/`) need `--build`.

## Commands

```bash
docker compose up -d --build          # start (or rebuild after app code changes)
docker compose ps                     # running? healthy?
docker compose logs --tail 50         # nginx access/error log: shows which devices are polling
docker compose restart                # rarely needed
docker compose down                   # stop: confirm with the GM first, it cuts every player off

python3 .claude/skills/gm/scripts/gmctl.py net url      # LAN URL(s) to give the players
python3 .claude/skills/gm/scripts/gmctl.py net check    # every data file: LIVE / STALE / UNREACHABLE
python3 .claude/skills/gm/scripts/gmctl.py validate     # broken JSON or inconsistent content
```

Use `docker-compose` (hyphen) if the GM's Docker only has the old v1 binary. `net check --url http://host:port` checks a server on another machine or port.

## Troubleshooting

Work through these in order and report the cause in one line:

1. **Nothing loads / players can't connect**: `docker compose ps`. Not running: `docker compose up -d`. Running but phones fail: they must be on the same Wi-Fi and use the `net url` address (not `localhost`); the GM's firewall must allow TCP 8083.
2. **Changes don't show**: `gmctl net check`. STALE means the container isn't serving this folder (wrong directory, or volume missing from the compose file). LIVE means the data is fine: players must leave and re-enter the tool (CLI, Databank, Icebreaker, NET Arch, Tuner), wait for the message poll (~10 s), or the config poll (~15 s).
3. **Broken tool / empty state**: `gmctl validate`. Invalid JSON makes that tool show an empty state; `gmctl undo` restores the version saved before the last gmctl change (hand edits are only covered if `gmctl checkpoint` ran first).
4. **A message doesn't arrive**: `gmctl msg list`. Check that it is LIVE (not SCHEDULED: player clocks earlier than the scheduled time keep it hidden), that `to` matches the handle the player actually logged in with (`gmctl players list`; the terminal header shows it as `OPR://HANDLE`), and that the player is logged in. A message that was already read never pops again: `gmctl msg resend <id>`.
5. **No sound**: the player has SND:OFF (header toggle), or the browser blocked audio before the first tap. Tuner audio clips must exist in `data/audio` (`gmctl validate` reports missing ones).
6. **Poll interval change has no effect**: `pollIntervalSeconds` is read at page load; players must reload.

## Before a session

`docker compose up -d --build`, `gmctl net check`, `gmctl validate`, `gmctl snapshot save pre-sesion`, then share the `gmctl net url` address with the players.
