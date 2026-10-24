#!/usr/bin/env python3
"""
CYBERTERMINAL GM CONTROL - gmctl
Live control of the cyberterminal campaign data (data/*.json) from the
command line, built for Claude Code skills used mid-session.

Every write is atomic (temp file + rename, safe with the Docker bind mount)
and the previous version is kept in .claude/gm-state/history, so `undo`
always works. Python 3.9+ standard library only (Pillow is used if present).

Run `gmctl.py -h` or `gmctl.py <group> -h` for the full command list.
"""

import argparse
import base64
import datetime as dt
import hashlib
import json
import math
import os
import random
import re
import shutil
import socket
import struct
import sys
import time
import unicodedata
import urllib.request
import wave
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
DATA = Path(os.environ.get('CT_DATA', ROOT / 'data')).resolve()
STATE = Path(os.environ.get('CT_STATE', ROOT / '.claude' / 'gm-state')).resolve()
HISTORY = STATE / 'history'
SNAPSHOTS = STATE / 'snapshots'
HISTORY_LIMIT = 200

DATA_FILES = ['config', 'messages', 'filesystem', 'netarch', 'databank', 'signals', 'gates']
EMPTY = {
    'config': {'motd': '', 'instability': 0, 'pollIntervalSeconds': 10},
    'messages': {'messages': []},
    'filesystem': {'defaultHost': '', 'hosts': {}},
    'netarch': {'architectures': []},
    'databank': {'records': []},
    'signals': {'band': {'min': 88.0, 'max': 108.0, 'step': 0.1, 'unit': 'MHz'}, 'signals': []},
    'gates': {'targets': []},
}

HANDLE_RE = re.compile(r'^[A-Za-z0-9_-]{2,16}$')
REDACT_RE = re.compile(r'\{\{redacted:([A-Za-z0-9_-]+)\}\}')
DIFFICULTIES = ('easy', 'standard', 'hard')
FLOOR_TYPES = ('password', 'file', 'control', 'ice')
SIGNAL_TYPES = ('morse', 'tone', 'audio')
# Client clocks can lag the GM machine, a "now" message is backdated a bit
CLOCK_SKEW_SECONDS = 30
MESSAGES_POLL_DEFAULT = 10
CONFIG_POLL_SECONDS = 15


class GMError(Exception):
    pass


# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------

def out(text=''):
    print(text)


def warn(text):
    print('  ! ' + text)


def clip(text, width=60):
    text = str(text).replace('\n', ' / ')
    return text if len(text) <= width else text[:width - 3] + '...'


def text_arg(value):
    """Read '-' from stdin and turn literal \\n sequences into newlines"""
    if value is None:
        return None
    if value == '-':
        value = sys.stdin.read().rstrip('\n')
    return value.replace('\\n', '\n')


# ---------------------------------------------------------------------------
# Storage: atomic writes, history, undo, snapshots
# ---------------------------------------------------------------------------

def data_path(name):
    return DATA / (name + '.json')


def load(name):
    path = data_path(name)
    if not path.exists():
        return json.loads(json.dumps(EMPTY[name]))
    try:
        with open(path, encoding='utf-8') as fh:
            return json.load(fh)
    except json.JSONDecodeError as error:
        raise GMError('data/%s.json is not valid JSON (%s). Fix it or run `undo`.' % (name, error))


def checkpoint(name, note):
    """Copy the current file into history before it changes"""
    path = data_path(name)
    if not path.exists():
        return
    HISTORY.mkdir(parents=True, exist_ok=True)
    stamp = dt.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    shutil.copy2(path, HISTORY / ('%s__%s.json' % (stamp, name)))
    with open(HISTORY / 'log.jsonl', 'a', encoding='utf-8') as fh:
        fh.write(json.dumps({'stamp': stamp, 'file': name, 'note': note}, ensure_ascii=False) + '\n')
    prune_history()


def prune_history():
    entries = sorted(HISTORY.glob('*__*.json'))
    for old in entries[:-HISTORY_LIMIT]:
        old.unlink()


def write_raw(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name('.' + path.name + '.tmp')
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(text)
    # Keep the file world readable for nginx inside the container
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)


def save(name, data, note):
    try:
        before = set(validate_file(name, load(name)))
    except GMError:
        before = set()
    checkpoint(name, note)
    write_raw(data_path(name), json.dumps(data, indent=4, ensure_ascii=False) + '\n')
    # Only report problems this change introduced
    for level, _, msg in validate_file(name, data):
        if (level, name, msg) not in before:
            warn('%s: %s' % (level, msg))


def state_load(name, default):
    path = STATE / (name + '.json')
    if not path.exists():
        return default
    with open(path, encoding='utf-8') as fh:
        return json.load(fh)


def state_save(name, data):
    STATE.mkdir(parents=True, exist_ok=True)
    write_raw(STATE / (name + '.json'), json.dumps(data, indent=4, ensure_ascii=False) + '\n')


def cmd_undo(args):
    log = HISTORY / 'log.jsonl'
    entries = []
    if log.exists():
        with open(log, encoding='utf-8') as fh:
            entries = [json.loads(line) for line in fh if line.strip()]
    entries = [e for e in entries if (HISTORY / ('%s__%s.json' % (e['stamp'], e['file']))).exists()]

    if args.list:
        if not entries:
            out('No history.')
        for e in entries[-15:]:
            out('%s  %-10s  %s' % (e['stamp'][:15], e['file'], e['note']))
        return

    if not entries:
        raise GMError('Nothing to undo.')

    steps = max(1, args.steps)
    for _ in range(steps):
        if not entries:
            break
        entry = entries.pop()
        backup = HISTORY / ('%s__%s.json' % (entry['stamp'], entry['file']))
        shutil.copy2(backup, data_path(entry['file']))
        os.chmod(data_path(entry['file']), 0o644)
        backup.unlink()
        out('UNDONE: %s (%s)' % (entry['note'], entry['file']))

    with open(log, 'w', encoding='utf-8') as fh:
        for e in entries:
            fh.write(json.dumps(e, ensure_ascii=False) + '\n')


def cmd_checkpoint(args):
    files = args.files or DATA_FILES
    for name in files:
        if name not in DATA_FILES:
            raise GMError('Unknown data file: %s' % name)
        checkpoint(name, args.note or 'manual checkpoint before hand edit')
    out('CHECKPOINT saved for: ' + ', '.join(files) + '. `undo` restores it.')


def cmd_snapshot(args):
    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    if args.action == 'list':
        snaps = sorted(p for p in SNAPSHOTS.iterdir() if p.is_dir())
        if not snaps:
            out('No snapshots.')
        for snap in snaps:
            files = sorted(p.stem for p in snap.glob('*.json'))
            stamp = dt.datetime.fromtimestamp(snap.stat().st_mtime).strftime('%Y-%m-%d %H:%M')
            out('%-24s %s  [%s]' % (snap.name, stamp, ', '.join(files)))
        return

    if not args.name or not re.match(r'^[A-Za-z0-9_.-]+$', args.name):
        raise GMError('Snapshot name required (letters, digits, _ . -).')
    target = SNAPSHOTS / args.name

    if args.action == 'save':
        if target.exists() and not args.force:
            raise GMError('Snapshot %s exists. Use --force to overwrite.' % args.name)
        target.mkdir(parents=True, exist_ok=True)
        for name in DATA_FILES:
            if data_path(name).exists():
                shutil.copy2(data_path(name), target / (name + '.json'))
        out('SNAPSHOT saved: %s' % args.name)
    elif args.action == 'restore':
        if not target.exists():
            raise GMError('No snapshot named %s.' % args.name)
        files = args.only or [p.stem for p in target.glob('*.json')]
        for name in files:
            src = target / (name + '.json')
            if name not in DATA_FILES or not src.exists():
                warn('skipped %s (not in snapshot)' % name)
                continue
            checkpoint(name, 'before restoring snapshot ' + args.name)
            write_raw(data_path(name), src.read_text(encoding='utf-8'))
        out('SNAPSHOT restored: %s (%s). Players see it on next poll / tool reopen.'
            % (args.name, ', '.join(files)))
    elif args.action == 'delete':
        if not target.exists():
            raise GMError('No snapshot named %s.' % args.name)
        shutil.rmtree(target)
        out('SNAPSHOT deleted: %s' % args.name)


# ---------------------------------------------------------------------------
# Time parsing
# ---------------------------------------------------------------------------

def iso(moment):
    return moment.astimezone(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def parse_duration(text):
    match = re.fullmatch(r'\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:(\d+)s?)?\s*', text or '')
    if not text or not match or not any(match.groups()):
        raise GMError('Bad duration "%s". Use e.g. 30s, 10m, 1h30m.' % text)
    h, m, s = (int(g or 0) for g in match.groups())
    return h * 3600 + m * 60 + s


def parse_when(at=None, delay=None):
    """Return an aware datetime for --at / --in, or None for now"""
    now = dt.datetime.now().astimezone()
    if delay:
        return now + dt.timedelta(seconds=parse_duration(delay))
    if not at:
        return None
    if re.fullmatch(r'\d{1,2}:\d{2}', at):
        hour, minute = (int(x) for x in at.split(':'))
        moment = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if moment < now:
            warn('%s is already past today, the message shows immediately.' % at)
        return moment
    try:
        moment = dt.datetime.fromisoformat(at.replace('Z', '+00:00'))
    except ValueError:
        raise GMError('Bad time "%s". Use HH:MM (local), ISO 8601, or --in 10m.' % at)
    if moment.tzinfo is None:
        moment = moment.astimezone()
    return moment


def parse_iso(value):
    try:
        return dt.datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None


# ---------------------------------------------------------------------------
# Players roster (GM-side only, maps characters to login handles)
# ---------------------------------------------------------------------------

def roster():
    return state_load('roster', {'players': []})['players']


def resolve_recipients(text):
    """Turn 'all' or a comma list of handles/character names into handles"""
    if not text or text.strip().lower() in ('all', 'todos', '*'):
        return ['all']
    players = roster()
    handles = []
    for token in [t.strip() for t in text.split(',') if t.strip()]:
        if token.lower() in ('all', 'todos', '*'):
            return ['all']
        found = None
        for p in players:
            names = [p.get('handle', ''), p.get('name', ''), p.get('player', '')]
            if token.lower() in [n.lower() for n in names if n]:
                found = p['handle']
                break
        if not found:
            if not HANDLE_RE.match(token):
                raise GMError('"%s" is neither a roster entry nor a valid handle '
                              '(2-16 chars: letters, digits, _ -).' % token)
            if players:
                warn('"%s" is not in the roster, sending to that exact handle.' % token)
            found = token
        if found.lower() not in [h.lower() for h in handles]:
            handles.append(found)
    return handles


def cmd_players(args):
    data = state_load('roster', {'players': []})
    players = data['players']
    if args.action == 'list':
        if not players:
            out('Roster empty. Add with: players add <HANDLE> --name "<character>" --player "<real name>"')
        for p in players:
            out('%-16s  %-20s  %s' % (p['handle'], p.get('name', ''), p.get('player', '')))
        return
    if not args.handle:
        raise GMError('Handle required.')
    existing = [p for p in players if p['handle'].lower() == args.handle.lower()]
    if args.action == 'add':
        if not HANDLE_RE.match(args.handle):
            raise GMError('Invalid handle. Players log in with 2-16 chars: letters, digits, _ -.')
        entry = existing[0] if existing else {'handle': args.handle}
        if not existing:
            players.append(entry)
        entry['handle'] = args.handle
        if args.name:
            entry['name'] = args.name
        if args.player:
            entry['player'] = args.player
        state_save('roster', data)
        out('ROSTER: %s saved.' % args.handle)
    elif args.action == 'rm':
        if not existing:
            raise GMError('Not in roster: %s' % args.handle)
        data['players'] = [p for p in players if p not in existing]
        state_save('roster', data)
        out('ROSTER: %s removed.' % args.handle)


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def poll_seconds():
    config = load('config')
    return max(5, int(config.get('pollIntervalSeconds') or MESSAGES_POLL_DEFAULT))


def next_msg_id(messages, taken=()):
    nums = [0]
    for m in messages:
        match = re.fullmatch(r'msg-(\d+)', str(m.get('id', '')))
        if match:
            nums.append(int(match.group(1)))
    for t in taken:
        match = re.fullmatch(r'msg-(\d+)', t)
        if match:
            nums.append(int(match.group(1)))
    return 'msg-%03d' % (max(nums) + 1)


def message_state(m):
    when = parse_iso(m.get('time')) if m.get('time') else None
    if when and when > dt.datetime.now(dt.timezone.utc):
        return 'SCHEDULED'
    return 'LIVE'


def find_message(messages, mid):
    for m in messages:
        if m.get('id') == mid:
            return m
    raise GMError('No message with id %s. Run `msg list`.' % mid)


def cmd_msg(args):
    data = load('messages')
    messages = data.setdefault('messages', [])

    if args.action == 'list':
        rows = messages[-args.n:] if args.n else messages
        if not rows:
            out('No messages.')
        for m in rows:
            out('%-8s %-9s %-6s to:%-12s %-20s %s' % (
                m.get('id'), message_state(m), m.get('priority', 'normal')[:6],
                m.get('to', 'all'), (m.get('time') or '-')[:16], clip(m.get('subject', ''), 40)))
        return

    if args.action == 'show':
        out(json.dumps(find_message(messages, args.id), indent=2, ensure_ascii=False))
        return

    if args.action == 'send':
        body = text_arg(args.body)
        if not body:
            raise GMError('Message body required (--body "..." or --body - for stdin).')
        prefs = state_load('prefs', {})
        sender = args.sender or prefs.get('lastFrom') or 'UNKNOWN'
        when = parse_when(args.at, args.delay)
        stamp = iso(when) if when else iso(dt.datetime.now().astimezone()
                                          - dt.timedelta(seconds=CLOCK_SKEW_SECONDS))
        recipients = resolve_recipients(args.to)
        sent = []
        for handle in recipients:
            mid = args.id if (args.id and len(recipients) == 1) else next_msg_id(messages, sent)
            if any(m.get('id') == mid for m in messages):
                raise GMError('Message id %s already exists.' % mid)
            messages.append({
                'id': mid,
                'from': sender,
                'to': handle,
                'subject': text_arg(args.subject) or '',
                'body': body,
                'time': stamp,
                'priority': 'urgent' if args.urgent else 'normal',
            })
            sent.append(mid)
        save('messages', data, 'msg send %s -> %s' % (','.join(sent), ','.join(recipients)))
        prefs['lastFrom'] = sender
        state_save('prefs', prefs)
        kind = 'URGENT takeover + alarm' if args.urgent else 'toast + inbox'
        timing = ('scheduled for %s (local %s)' % (stamp, when.astimezone().strftime('%H:%M:%S'))
                  if when else 'live now, players get it within ~%ds' % poll_seconds())
        for mid, handle in zip(sent, recipients):
            out('SENT %s -> %s [%s] from %s, %s' % (mid, handle, kind, sender, timing))
        return

    if args.action == 'resend':
        original = find_message(messages, args.id)
        copy = dict(original)
        copy['id'] = next_msg_id(messages)
        copy['time'] = iso(dt.datetime.now().astimezone() - dt.timedelta(seconds=CLOCK_SKEW_SECONDS))
        if args.to:
            copy['to'] = resolve_recipients(args.to)[0]
        messages.append(copy)
        save('messages', data, 'msg resend %s as %s' % (args.id, copy['id']))
        out('RESENT %s as %s -> %s (new id, so it pops up again)' % (args.id, copy['id'], copy['to']))
        return

    if args.action == 'edit':
        m = find_message(messages, args.id)
        if args.subject is not None:
            m['subject'] = text_arg(args.subject)
        if args.body is not None:
            m['body'] = text_arg(args.body)
        if args.sender:
            m['from'] = args.sender
        if args.to:
            m['to'] = resolve_recipients(args.to)[0]
        if args.urgent:
            m['priority'] = 'urgent'
        if args.normal:
            m['priority'] = 'normal'
        if args.at or args.delay:
            m['time'] = iso(parse_when(args.at, args.delay))
        if args.now:
            m['time'] = iso(dt.datetime.now().astimezone() - dt.timedelta(seconds=CLOCK_SKEW_SECONDS))
        save('messages', data, 'msg edit ' + args.id)
        out('EDITED %s. Players who already saw it keep it read; content updates in the inbox.' % args.id)
        return

    if args.action == 'rm':
        ids = set(args.ids)
        missing = ids - {m.get('id') for m in messages}
        if missing:
            raise GMError('Unknown ids: ' + ', '.join(sorted(missing)))
        data['messages'] = [m for m in messages if m.get('id') not in ids]
        save('messages', data, 'msg rm ' + ','.join(sorted(ids)))
        out('DELETED %s. It vanishes from player inboxes on the next poll.' % ', '.join(sorted(ids)))
        return

    if args.action == 'clear':
        if not args.yes:
            raise GMError('This deletes all %d messages. Re-run with --yes.' % len(messages))
        keep = [m for m in messages if args.keep_scheduled and message_state(m) == 'SCHEDULED']
        data['messages'] = keep
        save('messages', data, 'msg clear')
        out('CLEARED %d messages (%d scheduled kept).' % (len(messages) - len(keep), len(keep)))


# ---------------------------------------------------------------------------
# Config: instability, MOTD, poll, Breach Protocol
# ---------------------------------------------------------------------------

INSTABILITY_TEXT = {
    0: 'stable',
    1: 'heavier scanline flicker',
    2: 'random glitch bursts + UNSTABLE status',
    3: 'glitches + static sound bursts + CRITICAL status',
}


def set_instability(level, note):
    config = load('config')
    previous = int(config.get('instability') or 0)
    config['instability'] = level
    save('config', config, note)
    return previous


def cmd_fx(args):
    if args.action == 'instability':
        level = max(0, min(3, args.level))
        previous = set_instability(level, 'instability %d' % level)
        out('INSTABILITY %d -> %d (%s). Players pick it up within ~%ds.'
            % (previous, level, INSTABILITY_TEXT[level], CONFIG_POLL_SECONDS))
        if args.duration:
            seconds = parse_duration(args.duration)
            restore = args.restore if args.restore is not None else previous
            if seconds < CONFIG_POLL_SECONDS + 5:
                warn('clients poll config every %ds, a pulse under ~20s may be missed.' % CONFIG_POLL_SECONDS)
            out('Holding for %ds, then back to %d...' % (seconds, restore))
            sys.stdout.flush()
            time.sleep(seconds)
            set_instability(restore, 'instability %d (end of pulse)' % restore)
            out('INSTABILITY back to %d.' % restore)
    elif args.action == 'calm':
        previous = set_instability(0, 'instability 0 (calm)')
        out('INSTABILITY %d -> 0 (stable).' % previous)
    elif args.action == 'motd':
        config = load('config')
        text = text_arg(args.text)
        config['motd'] = text
        save('config', config, 'motd')
        if not text.strip():
            warn('an empty MOTD does not clear what players already see until they reload.')
        out('MOTD set: "%s". Players see it within ~%ds.' % (text, CONFIG_POLL_SECONDS))


def cmd_config(args):
    config = load('config')
    if args.action == 'show':
        out(json.dumps(config, indent=2, ensure_ascii=False))
    elif args.action == 'poll':
        config['pollIntervalSeconds'] = max(5, args.seconds)
        save('config', config, 'poll %d' % args.seconds)
        out('MESSAGE POLL set to %ds. Only applies after players reload the page.' % max(5, args.seconds))


def cmd_breach(args):
    config = load('config')
    breach = config.setdefault('breach', {})
    daemons = breach.setdefault('daemons', [])

    if args.action == 'show':
        out('difficulty: %s  locked: %s' % (breach.get('difficulty', '(player choice)'),
                                           bool(breach.get('lockDifficulty'))))
        for i, d in enumerate(daemons, 1):
            out('  daemon %d: %-16s reward: %s' % (i, d.get('name', ''), clip(d.get('reward', ''), 70)))
        return

    if args.action == 'set':
        if args.difficulty:
            breach['difficulty'] = args.difficulty
        if args.lock:
            breach['lockDifficulty'] = True
        if args.unlock:
            breach['lockDifficulty'] = False
        note = 'breach difficulty=%s lock=%s' % (breach.get('difficulty'), breach.get('lockDifficulty'))
    elif args.action == 'daemon':
        index = args.index - 1
        if not 0 <= index <= 2:
            raise GMError('Daemon index must be 1, 2 or 3.')
        while len(daemons) <= index:
            daemons.append({'name': 'DAEMON_%d' % (len(daemons) + 1), 'reward': ''})
        if args.name:
            daemons[index]['name'] = args.name.upper().replace(' ', '_')
        if args.reward is not None:
            daemons[index]['reward'] = text_arg(args.reward)
        note = 'breach daemon %d' % args.index
    elif args.action == 'reset':
        config.pop('breach', None)
        note = 'breach reset'
    save('config', config, note)
    out('BREACH updated (%s). Applies on the next NEW BREACH, within ~%ds.' % (note, CONFIG_POLL_SECONDS))


# ---------------------------------------------------------------------------
# NETLINK CLI filesystem
# ---------------------------------------------------------------------------

def split_fs_path(spec):
    host, _, path = spec.partition(':')
    parts = [p for p in path.strip('/').split('/') if p]
    if not host:
        raise GMError('Path must look like host:/dir/file.txt')
    return host, parts


def get_host(fs, host, create=False):
    hosts = fs.setdefault('hosts', {})
    if host not in hosts:
        if not create:
            raise GMError('No host %s. Hosts: %s' % (host, ', '.join(hosts) or '(none)'))
        hosts[host] = {'root': {'type': 'dir', 'children': {}}}
        if not fs.get('defaultHost'):
            fs['defaultHost'] = host
    hosts[host].setdefault('root', {'type': 'dir', 'children': {}})
    return hosts[host]


def walk(fs, host, parts, create_dirs=False):
    node = get_host(fs, host, create=create_dirs)['root']
    for part in parts:
        children = node.setdefault('children', {})
        if part not in children:
            if not create_dirs:
                raise GMError('No such path: %s:/%s' % (host, '/'.join(parts)))
            children[part] = {'type': 'dir', 'children': {}}
        node = children[part]
        if node.get('type') != 'dir':
            raise GMError('%s is a file, not a directory.' % part)
    return node


def print_tree(node, prefix=''):
    children = node.get('children', {})
    names = sorted(children, key=lambda n: (children[n].get('type') != 'dir', n))
    for i, name in enumerate(names):
        child = children[name]
        last = i == len(names) - 1
        lock = '  [LOCKED pw=%s]' % child.get('password') if child.get('locked') else ''
        if child.get('type') == 'dir':
            out('%s%s %s/%s' % (prefix, '`--' if last else '|--', name, lock))
            print_tree(child, prefix + ('    ' if last else '|   '))
        else:
            content = child.get('content', '')
            if isinstance(content, list):
                content = '\n'.join(content)
            out('%s%s %s%s  "%s"' % (prefix, '`--' if last else '|--', name, lock, clip(content, 40)))


def cmd_fs(args):
    fs = load('filesystem')

    if args.action == 'tree':
        hosts = fs.get('hosts', {})
        targets = [args.host] if args.host else list(hosts)
        for name in targets:
            host = get_host(fs, name)
            flags = []
            if name == fs.get('defaultHost'):
                flags.append('default')
            if host.get('locked'):
                flags.append('LOCKED pw=%s' % host.get('password'))
            out('%s  [%s]  motd: %s' % (name, ', '.join(flags) or 'open', clip(host.get('motd', ''), 50)))
            print_tree(host['root'], '  ')
        return

    if args.action == 'cat':
        host, parts = split_fs_path(args.path)
        parent = walk(fs, host, parts[:-1])
        node = parent.get('children', {}).get(parts[-1]) if parts else None
        if not node or node.get('type') != 'file':
            raise GMError('No such file: %s' % args.path)
        content = node.get('content', '')
        out('\n'.join(content) if isinstance(content, list) else content)
        return

    if args.action == 'write':
        host, parts = split_fs_path(args.path)
        if not parts:
            raise GMError('Give a file path, e.g. %s:/notes.txt' % host)
        parent = walk(fs, host, parts[:-1], create_dirs=True)
        node = parent['children'].get(parts[-1], {'type': 'file'})
        if node.get('type') == 'dir':
            raise GMError('%s is a directory.' % args.path)
        node['type'] = 'file'
        node['content'] = text_arg(args.content) or ''
        if args.lock:
            node['locked'] = True
            node['password'] = args.lock
        parent['children'][parts[-1]] = node
        save('filesystem', fs, 'fs write ' + args.path)
        out('FILE %s written%s. Players see it on next CLI open/ls.'
            % (args.path, ' (locked, pw=%s)' % args.lock if args.lock else ''))
        return

    if args.action == 'mkdir':
        host, parts = split_fs_path(args.path)
        node = walk(fs, host, parts, create_dirs=True)
        if args.lock:
            node['locked'] = True
            node['password'] = args.lock
        save('filesystem', fs, 'fs mkdir ' + args.path)
        out('DIR %s ready%s.' % (args.path, ' (locked, pw=%s)' % args.lock if args.lock else ''))
        return

    if args.action in ('lock', 'open'):
        host, parts = split_fs_path(args.path)
        if parts:
            parent = walk(fs, host, parts[:-1])
            node = parent.get('children', {}).get(parts[-1])
            if not node:
                raise GMError('No such path: %s' % args.path)
        else:
            node = get_host(fs, host)
        if args.action == 'lock':
            if not args.password:
                raise GMError('Password required.')
            node['locked'] = True
            node['password'] = args.password
            out('LOCKED %s with password "%s". Players who already unlocked it stay in.'
                % (args.path, args.password))
        else:
            node.pop('locked', None)
            node.pop('password', None)
            out('OPENED %s for everyone.' % args.path)
        save('filesystem', fs, 'fs %s %s' % (args.action, args.path))
        return

    if args.action == 'rm':
        host, parts = split_fs_path(args.path)
        if not parts:
            raise GMError('Use `fs host-rm %s` to remove a whole host.' % host)
        parent = walk(fs, host, parts[:-1])
        if parts[-1] not in parent.get('children', {}):
            raise GMError('No such path: %s' % args.path)
        del parent['children'][parts[-1]]
        save('filesystem', fs, 'fs rm ' + args.path)
        out('REMOVED %s. Players inside it get "LINK RESET" on next CLI open.' % args.path)
        return

    if args.action == 'mv':
        host, parts = split_fs_path(args.path)
        dhost, dparts = split_fs_path(args.dest)
        parent = walk(fs, host, parts[:-1])
        node = parent.get('children', {}).pop(parts[-1], None) if parts else None
        if node is None:
            raise GMError('No such path: %s' % args.path)
        dparent = walk(fs, dhost, dparts[:-1], create_dirs=True)
        dparent['children'][dparts[-1]] = node
        save('filesystem', fs, 'fs mv %s %s' % (args.path, args.dest))
        out('MOVED %s -> %s (unlock state is per path, so it re-locks if locked).' % (args.path, args.dest))
        return

    if args.action == 'host-add':
        if args.host in fs.get('hosts', {}):
            host = fs['hosts'][args.host]
        else:
            host = get_host(fs, args.host, create=True)
        if args.motd is not None:
            host['motd'] = text_arg(args.motd)
        if args.lock:
            host['locked'] = True
            host['password'] = args.lock
        save('filesystem', fs, 'fs host-add ' + args.host)
        out('HOST %s ready%s. It shows up in `scan` on next CLI open.'
            % (args.host, ' (locked, pw=%s)' % args.lock if args.lock else ''))
        return

    if args.action == 'host-rm':
        get_host(fs, args.host)
        del fs['hosts'][args.host]
        if fs.get('defaultHost') == args.host:
            fs['defaultHost'] = next(iter(fs['hosts']), '')
        save('filesystem', fs, 'fs host-rm ' + args.host)
        out('HOST %s removed.' % args.host)
        return

    if args.action == 'default':
        get_host(fs, args.host)
        fs['defaultHost'] = args.host
        save('filesystem', fs, 'fs default ' + args.host)
        out('DEFAULT HOST is now %s (for players opening the CLI for the first time).' % args.host)
        return

    if args.action == 'motd':
        host = get_host(fs, args.host)
        host['motd'] = text_arg(args.text)
        save('filesystem', fs, 'fs motd ' + args.host)
        out('HOST %s banner updated.' % args.host)


# ---------------------------------------------------------------------------
# Databank
# ---------------------------------------------------------------------------

def find_record(data, rid):
    for r in data.get('records', []):
        if r.get('id') == rid:
            return r
    raise GMError('No record %s. Run `db list`.' % rid)


def parse_fields(pairs):
    fields = {}
    for pair in pairs or []:
        if '=' not in pair:
            raise GMError('Fields look like LABEL=value, got "%s".' % pair)
        key, value = pair.split('=', 1)
        fields[key.strip().upper()] = text_arg(value.strip())
    return fields


def cmd_db(args):
    data = load('databank')
    records = data.setdefault('records', [])

    if args.action == 'list':
        query = (args.query or '').lower()
        for r in records:
            hay = json.dumps(r, ensure_ascii=False).lower()
            if query and query not in hay:
                continue
            keys = ', '.join('%s=%s' % (k, v.get('code')) for k, v in (r.get('redacted') or {}).items())
            out('%-20s %-6s %-24s tags:%s%s' % (r.get('id'), r.get('type', ''), clip(r.get('name', ''), 24),
                                              ','.join(r.get('tags', [])),
                                              '  redacted:' + keys if keys else ''))
        return

    if args.action == 'show':
        out(json.dumps(find_record(data, args.id), indent=2, ensure_ascii=False))
        return

    if args.action == 'add':
        if any(r.get('id') == args.id for r in records):
            raise GMError('Record %s exists, use `db set`.' % args.id)
        record = {'id': args.id, 'type': (args.type or 'NPC').upper(), 'name': args.name or args.id}
        if args.alias:
            record['alias'] = args.alias
        record['tags'] = args.tag or []
        record['fields'] = parse_fields(args.field)
        record['body'] = text_arg(args.body) or ''
        records.append(record)
        save('databank', data, 'db add ' + args.id)
        out('RECORD %s added. Visible next time players open DATABANK.' % args.id)
        return

    if args.action == 'set':
        record = find_record(data, args.id)
        for key in ('name', 'alias'):
            if getattr(args, key) is not None:
                record[key] = getattr(args, key)
        if args.type:
            record['type'] = args.type.upper()
        if args.tag:
            record['tags'] = args.tag
        if args.add_tag:
            record['tags'] = list(dict.fromkeys(record.get('tags', []) + args.add_tag))
        fields = record.setdefault('fields', {})
        fields.update(parse_fields(args.field))
        for key in args.rm_field or []:
            fields.pop(key.upper(), None)
        if args.body is not None:
            record['body'] = text_arg(args.body)
        if args.append:
            record['body'] = (record.get('body', '') + '\n\n' + text_arg(args.append)).strip('\n')
        save('databank', data, 'db set ' + args.id)
        out('RECORD %s updated.' % args.id)
        return

    if args.action == 'redact':
        record = find_record(data, args.id)
        if not re.fullmatch(r'[A-Za-z0-9_-]+', args.key):
            raise GMError('Redaction key: letters, digits, _ and - only.')
        record.setdefault('redacted', {})[args.key] = {'code': args.code, 'content': text_arg(args.content)}
        token = '{{redacted:%s}}' % args.key
        if token not in record.get('body', ''):
            label = text_arg(args.label) if args.label else ''
            record['body'] = (record.get('body', '') + '\n\n' + label + token).strip('\n')
        save('databank', data, 'db redact %s %s' % (args.id, args.key))
        out('REDACTED block %s on %s, unlock code "%s".' % (args.key, args.id, args.code))
        return

    if args.action == 'unredact':
        record = find_record(data, args.id)
        definition = (record.get('redacted') or {}).pop(args.key, None)
        if definition is None:
            raise GMError('No redacted key %s on %s.' % (args.key, args.id))
        token = '{{redacted:%s}}' % args.key
        record['body'] = record.get('body', '').replace(token, definition.get('content', ''))
        save('databank', data, 'db unredact %s %s' % (args.id, args.key))
        out('REVEALED %s on %s for everyone (inlined into body).' % (args.key, args.id))
        return

    if args.action == 'rm':
        find_record(data, args.id)
        data['records'] = [r for r in records if r.get('id') != args.id]
        save('databank', data, 'db rm ' + args.id)
        out('RECORD %s removed.' % args.id)


# ---------------------------------------------------------------------------
# Icebreaker gates
# ---------------------------------------------------------------------------

def rekey(old_id, taken):
    match = re.fullmatch(r'(.*)-r(\d+)', old_id)
    base, n = (match.group(1), int(match.group(2))) if match else (old_id, 1)
    new_id = '%s-r%d' % (base, n + 1)
    while new_id in taken:
        n += 1
        new_id = '%s-r%d' % (base, n + 1)
    return new_id


def find_gate(data, gid):
    for g in data.get('targets', []):
        if g.get('id') == gid:
            return g
    raise GMError('No gate %s. Run `gate list`.' % gid)


def cmd_gate(args):
    data = load('gates')
    targets = data.setdefault('targets', [])

    if args.action == 'list':
        for g in targets:
            out('%-22s %-28s pw:%-14s %d tries / %ds lockout  reward: %s' % (
                g.get('id'), clip(g.get('name', ''), 28), g.get('password'), g.get('maxAttempts', 5),
                g.get('lockoutSeconds', 60), clip(g.get('reward', ''), 40)))
        return

    if args.action == 'add':
        if any(g.get('id') == args.id for g in targets):
            raise GMError('Gate %s exists, use `gate set`.' % args.id)
        if not args.password:
            raise GMError('--password required.')
        targets.append({
            'id': args.id,
            'name': (args.name or args.id).upper(),
            'hint': text_arg(args.hint) or '',
            'password': args.password,
            'maxAttempts': args.attempts or 5,
            'lockoutSeconds': args.lockout or 120,
            'reward': text_arg(args.reward) or '',
        })
        save('gates', data, 'gate add ' + args.id)
        out('GATE %s added (pw "%s"). Visible next time players open ICEBREAKER.' % (args.id, args.password))
        return

    gate = find_gate(data, args.id)
    if args.action == 'set':
        if args.name:
            gate['name'] = args.name.upper()
        if args.hint is not None:
            gate['hint'] = text_arg(args.hint)
        if args.password:
            gate['password'] = args.password
        if args.attempts:
            gate['maxAttempts'] = args.attempts
        if args.lockout:
            gate['lockoutSeconds'] = args.lockout
        if args.reward is not None:
            gate['reward'] = text_arg(args.reward)
        save('gates', data, 'gate set ' + args.id)
        out('GATE %s updated. Players see the change next time they open ICEBREAKER.' % args.id)
    elif args.action == 'reset':
        new_id = rekey(gate['id'], {g.get('id') for g in targets})
        gate['id'] = new_id
        save('gates', data, 'gate reset %s -> %s' % (args.id, new_id))
        out('GATE re-armed for everyone: id %s -> %s (attempts, lockouts and breaches reset).'
            % (args.id, new_id))
    elif args.action == 'rm':
        data['targets'] = [g for g in targets if g is not gate]
        save('gates', data, 'gate rm ' + args.id)
        out('GATE %s removed.' % args.id)


# ---------------------------------------------------------------------------
# NET architectures
# ---------------------------------------------------------------------------

def find_arch(data, aid):
    for a in data.get('architectures', []):
        if a.get('id') == aid:
            return a
    raise GMError('No architecture %s. Run `arch list`.' % aid)


def floor_from_args(args, floor=None):
    floor = floor if floor is not None else {}
    if args.type:
        if args.type not in FLOOR_TYPES:
            raise GMError('Floor type: ' + ', '.join(FLOOR_TYPES))
        floor['type'] = args.type
    if args.name:
        floor['name'] = args.name.upper()
    if args.dv is not None:
        floor['dv'] = args.dv
    if args.ice:
        floor['ice'] = args.ice.upper()
    if args.desc is not None:
        floor['description'] = text_arg(args.desc)
    if args.content is not None:
        floor['content'] = text_arg(args.content)
    return floor


def cmd_arch(args):
    data = load('netarch')
    archs = data.setdefault('architectures', [])

    if args.action == 'list':
        for a in archs:
            out('%-18s %-28s %-9s %d floors' % (a.get('id'), clip(a.get('name', ''), 28),
                                                a.get('difficulty', ''), len(a.get('floors', []))))
        return

    if args.action == 'add':
        if any(a.get('id') == args.id for a in archs):
            raise GMError('Architecture %s exists.' % args.id)
        archs.append({'id': args.id, 'name': (args.name or args.id).upper(),
                      'difficulty': (args.difficulty or 'STANDARD').upper(),
                      'description': text_arg(args.desc) or '', 'floors': []})
        save('netarch', data, 'arch add ' + args.id)
        out('ARCH %s added. Add floors with `arch floor %s --type ... --name ...`.' % (args.id, args.id))
        return

    arch = find_arch(data, args.id)
    floors = arch.setdefault('floors', [])

    if args.action == 'show':
        out('%s  %s  %s' % (arch.get('name'), arch.get('difficulty', ''), arch.get('description', '')))
        for i, f in enumerate(floors, 1):
            out('  %2d. %-8s %-26s DV%-3s %s%s' % (i, f.get('type'), clip(f.get('name', ''), 26), f.get('dv', '-'),
                                                 (f.get('ice') + ' ') if f.get('ice') else '',
                                                 clip(f.get('description', ''), 40)))
            if f.get('content'):
                out('      content: ' + clip(f['content'], 70))
        return

    if args.action == 'floor':
        floor = floor_from_args(args)
        if 'type' not in floor or 'name' not in floor:
            raise GMError('--type and --name required for a new floor.')
        position = len(floors) if args.at is None else max(0, min(len(floors), args.at - 1))
        floors.insert(position, floor)
        save('netarch', data, 'arch floor %s #%d' % (args.id, position + 1))
        out('FLOOR %d added to %s: %s %s.' % (position + 1, args.id, floor['type'], floor['name']))
    elif args.action == 'floor-set':
        index = args.index - 1
        if not 0 <= index < len(floors):
            raise GMError('Floor index out of range (1-%d).' % len(floors))
        floor_from_args(args, floors[index])
        save('netarch', data, 'arch floor-set %s #%d' % (args.id, args.index))
        out('FLOOR %d of %s updated.' % (args.index, args.id))
    elif args.action == 'floor-rm':
        index = args.index - 1
        if not 0 <= index < len(floors):
            raise GMError('Floor index out of range (1-%d).' % len(floors))
        removed = floors.pop(index)
        save('netarch', data, 'arch floor-rm %s #%d' % (args.id, args.index))
        out('FLOOR %d (%s) removed from %s.' % (args.index, removed.get('name'), args.id))
    elif args.action == 'set':
        if args.name:
            arch['name'] = args.name.upper()
        if args.difficulty:
            arch['difficulty'] = args.difficulty.upper()
        if args.desc is not None:
            arch['description'] = text_arg(args.desc)
        save('netarch', data, 'arch set ' + args.id)
        out('ARCH %s updated.' % args.id)
    elif args.action == 'reset':
        new_id = rekey(arch['id'], {a.get('id') for a in archs})
        arch['id'] = new_id
        save('netarch', data, 'arch reset %s -> %s' % (args.id, new_id))
        out('ARCH progress reset for everyone: id %s -> %s.' % (args.id, new_id))
    elif args.action == 'rm':
        data['architectures'] = [a for a in archs if a is not arch]
        save('netarch', data, 'arch rm ' + args.id)
        out('ARCH %s removed.' % args.id)


# ---------------------------------------------------------------------------
# Signals, audio clips and player-downloadable files
# ---------------------------------------------------------------------------

def find_signal(data, freq):
    signals = data.get('signals', [])
    matches = [s for s in signals if abs(float(s.get('freq', -1)) - freq) < 0.051]
    if not matches:
        raise GMError('No signal at %s. Run `sig list`.' % freq)
    return matches[0]


def import_file(src, subdir, name=None):
    src_path = Path(src).expanduser()
    if not src_path.is_file():
        raise GMError('File not found: %s' % src)
    target_name = name or src_path.name
    if not re.fullmatch(r'[A-Za-z0-9_.-]+', target_name):
        target_name = re.sub(r'[^A-Za-z0-9_.-]+', '_', target_name)
    target = DATA / subdir / target_name
    target.parent.mkdir(parents=True, exist_ok=True)
    if src_path.resolve() != target.resolve():
        shutil.copy2(src_path, target)
    os.chmod(target, 0o644)
    return target


def signal_from_args(args, signal):
    if args.label is not None:
        signal['label'] = args.label.upper()
    if args.tolerance is not None:
        signal['tolerance'] = args.tolerance
    if args.type:
        if args.type not in SIGNAL_TYPES:
            raise GMError('Signal type: ' + ', '.join(SIGNAL_TYPES))
        for key in ('text', 'wpm', 'toneHz', 'src'):
            signal.pop(key, None)
        signal['type'] = args.type
    if args.text is not None:
        signal['text'] = text_arg(args.text)
    if args.wpm is not None:
        signal['wpm'] = args.wpm
    if args.tone_hz is not None:
        signal['toneHz'] = args.tone_hz
    if args.src:
        src = args.src
        if not src.startswith('data/'):
            src = 'data/audio/' + import_file(src, 'audio').name
        signal['src'] = src
    kind = signal.get('type')
    if kind == 'morse':
        signal.setdefault('wpm', 10)
        if not signal.get('text'):
            raise GMError('Morse signals need --text.')
    if kind == 'tone':
        signal.setdefault('toneHz', 440)
    if kind == 'audio' and not signal.get('src'):
        raise GMError('Audio signals need --src (a file path or data/audio/...).')
    return signal


def cmd_sig(args):
    data = load('signals')
    signals = data.setdefault('signals', [])
    band = data.setdefault('band', dict(EMPTY['signals']['band']))

    if args.action == 'list':
        out('BAND %s - %s %s step %s' % (band.get('min'), band.get('max'), band.get('unit'), band.get('step')))
        for s in sorted(signals, key=lambda s: s.get('freq', 0)):
            detail = {'morse': '"%s" @%swpm' % (s.get('text'), s.get('wpm', 12)),
                      'tone': '%sHz' % s.get('toneHz', 440),
                      'audio': s.get('src', '')}.get(s.get('type'), '')
            out('  %7s ±%-4s %-6s %-32s %s' % (s.get('freq'), s.get('tolerance', 0.2), s.get('type'),
                                              clip(s.get('label', ''), 32), detail))
        return

    if args.action == 'band':
        for key in ('min', 'max', 'step'):
            if getattr(args, key) is not None:
                band[key] = getattr(args, key)
        if args.unit:
            band['unit'] = args.unit
        save('signals', data, 'sig band')
        out('BAND %s - %s %s. Players re-tuned to band start on next TUNER open.'
            % (band['min'], band['max'], band.get('unit')))
        return

    if args.action == 'add':
        if any(abs(float(s.get('freq', -1)) - args.freq) < 0.051 for s in signals):
            raise GMError('A signal already sits on %s, use `sig set`.' % args.freq)
        if not args.type:
            raise GMError('--type morse|tone|audio required.')
        signal = signal_from_args(args, {'freq': args.freq, 'tolerance': 0.2, 'label': 'UNKNOWN SIGNAL'})
        signals.append(signal)
        save('signals', data, 'sig add %s' % args.freq)
        out('SIGNAL on %s %s (%s). Live next time players open the TUNER.'
            % (args.freq, band.get('unit', ''), signal['type']))
        return

    signal = find_signal(data, args.freq)
    if args.action == 'set':
        if args.new_freq is not None:
            signal['freq'] = args.new_freq
        signal_from_args(args, signal)
        save('signals', data, 'sig set %s' % args.freq)
        out('SIGNAL %s updated.' % args.freq)
    elif args.action == 'rm':
        data['signals'] = [s for s in signals if s is not signal]
        save('signals', data, 'sig rm %s' % args.freq)
        out('SIGNAL %s removed (players still tuned there hear it until they leave the TUNER).' % args.freq)


def cmd_audio(args):
    folder = DATA / 'audio'
    if args.action == 'list':
        used = {s.get('src') for s in load('signals').get('signals', [])}
        for f in sorted(folder.glob('*')) if folder.exists() else []:
            if f.name.startswith('.') or f.suffix == '.txt':
                continue
            tag = 'used by a signal' if 'data/audio/' + f.name in used else 'unused'
            out('  %-30s %8d KB  %s' % (f.name, f.stat().st_size // 1024, tag))
    elif args.action == 'add':
        target = import_file(args.path, 'audio', args.name)
        out('AUDIO stored as data/audio/%s. Use it: sig add --freq X --type audio --src data/audio/%s'
            % (target.name, target.name))
    elif args.action == 'rm':
        target = folder / args.path
        if not target.is_file():
            raise GMError('No such clip: data/audio/%s' % args.path)
        target.unlink()
        out('AUDIO data/audio/%s deleted.' % args.path)


def cmd_file(args):
    folder = DATA / 'files'
    if args.action == 'list':
        for f in sorted(folder.glob('*')) if folder.exists() else []:
            if not f.name.startswith('.'):
                out('  %-30s %8d KB  %s' % (f.name, f.stat().st_size // 1024, player_urls('data/files/' + f.name)[0]))
    elif args.action == 'add':
        target = import_file(args.path, 'files', args.name)
        out('FILE published: data/files/%s' % target.name)
        for url in player_urls('data/files/' + target.name):
            out('  ' + url)
    elif args.action == 'rm':
        target = folder / args.path
        if not target.is_file():
            raise GMError('No such file: data/files/%s' % args.path)
        target.unlink()
        out('FILE data/files/%s unpublished.' % args.path)


# ---------------------------------------------------------------------------
# Network: player URL and live check against the running container
# ---------------------------------------------------------------------------

def compose_port():
    compose = ROOT / 'docker-compose.yaml'
    if compose.exists():
        match = re.search(r'"(\d+):80"', compose.read_text(encoding='utf-8'))
        if match:
            return int(match.group(1))
    return 8083


def lan_ips():
    ips = []
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.connect(('10.255.255.255', 1))
        ips.append(sock.getsockname()[0])
        sock.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in ips and not ip.startswith('127.'):
                ips.append(ip)
    except OSError:
        pass
    return ips


def player_urls(path=''):
    port = compose_port()
    hosts = lan_ips() or ['<GM-IP>']
    return ['http://%s:%d/%s' % (ip, port, path) for ip in hosts]


def cmd_net(args):
    base = args.url or 'http://localhost:%d' % compose_port()
    if args.action == 'url':
        out('Players connect to:')
        for url in player_urls():
            out('  ' + url)
        out('GM machine: http://localhost:%d/' % compose_port())
        return

    ok = True
    for name in DATA_FILES:
        url = '%s/data/%s.json?ts=%d' % (base.rstrip('/'), name, time.time() * 1000)
        try:
            with urllib.request.urlopen(url, timeout=3) as res:
                served = json.loads(res.read().decode('utf-8'))
        except Exception as error:
            out('  %-11s UNREACHABLE (%s)' % (name, error))
            ok = False
            continue
        local = load(name) if data_path(name).exists() else None
        status = 'LIVE' if served == local else 'STALE (container serves a different version)'
        ok = ok and served == local
        out('  %-11s %s' % (name, status))
    out('Server at %s: %s' % (base, 'all data live' if ok else 'PROBLEMS (see above)'))
    if not ok:
        out('  Hint: `docker compose ps`, and check that ./data is mounted (docker-compose.yaml volumes).')


# ---------------------------------------------------------------------------
# Status and validation
# ---------------------------------------------------------------------------

def cmd_status(args):
    config = load('config')
    level = int(config.get('instability') or 0)
    breach = config.get('breach') or {}
    out('MOTD: %s' % config.get('motd', ''))
    out('INSTABILITY: %d (%s)   MSG POLL: %ss' % (level, INSTABILITY_TEXT.get(level, '?'),
                                                 config.get('pollIntervalSeconds', MESSAGES_POLL_DEFAULT)))
    out('BREACH: %s%s, daemons: %s' % (breach.get('difficulty', 'player choice'),
                                      ' (locked)' if breach.get('lockDifficulty') else '',
                                      ', '.join(d.get('name', '?') for d in breach.get('daemons', [])) or 'default'))
    messages = load('messages').get('messages', [])
    scheduled = [m for m in messages if message_state(m) == 'SCHEDULED']
    out('MESSAGES: %d total, %d scheduled' % (len(messages), len(scheduled)))
    for m in messages[-3:]:
        out('  %s %s -> %s: %s' % (m.get('id'), m.get('priority', 'normal'), m.get('to'), clip(m.get('subject', ''), 40)))
    fs = load('filesystem')
    out('CLI HOSTS: %s' % ', '.join('%s%s' % (h, '*' if v.get('locked') else '')
                                     for h, v in fs.get('hosts', {}).items()))
    out('DATABANK: %d records   GATES: %d   ARCHS: %d   SIGNALS: %d' % (
        len(load('databank').get('records', [])), len(load('gates').get('targets', [])),
        len(load('netarch').get('architectures', [])), len(load('signals').get('signals', []))))
    players = roster()
    out('ROSTER: %s' % (', '.join('%s (%s)' % (p['handle'], p.get('name', '?')) for p in players) or 'empty'))
    problems = [p for p in validate_all() if p[0] == 'ERROR']
    if problems:
        out('VALIDATION: %d errors, run `validate`' % len(problems))


def morse_drops(text):
    dropped = set()
    for char in text.upper():
        if char.isspace():
            continue
        if morse_for(char) == '':
            dropped.add(char)
    return dropped


def validate_file(name, data):
    issues = []

    def add(level, msg):
        issues.append((level, name, msg))

    if not isinstance(data, dict):
        add('ERROR', 'top level must be a JSON object')
        return issues

    if name == 'config':
        level = data.get('instability', 0)
        if not isinstance(level, int) or not 0 <= level <= 3:
            add('ERROR', 'instability must be an integer 0-3')
        breach = data.get('breach')
        if breach:
            if breach.get('difficulty') and breach['difficulty'] not in DIFFICULTIES:
                add('ERROR', 'breach.difficulty must be easy, standard or hard')
            if breach.get('lockDifficulty') and not breach.get('difficulty'):
                add('WARN', 'lockDifficulty has no effect without a difficulty')
            if len(breach.get('daemons', [])) > 3:
                add('WARN', 'only the first 3 breach daemons are used')

    elif name == 'messages':
        ids = [m.get('id') for m in data.get('messages', [])]
        for dup in {i for i in ids if ids.count(i) > 1}:
            add('ERROR', 'duplicate message id %s' % dup)
        handles = {p['handle'].lower() for p in roster()}
        for m in data.get('messages', []):
            if not m.get('id'):
                add('ERROR', 'message without id (ignored by clients)')
            to = m.get('to', 'all')
            if to != 'all' and handles and to.lower() not in handles:
                add('WARN', '%s targets "%s", not in roster' % (m.get('id'), to))
            if m.get('priority', 'normal') not in ('normal', 'urgent'):
                add('WARN', '%s priority should be normal or urgent' % m.get('id'))
            if m.get('time') and not parse_iso(m['time']):
                add('ERROR', '%s has an unparseable time' % m.get('id'))

    elif name == 'filesystem':
        hosts = data.get('hosts', {})
        if not hosts:
            add('WARN', 'no hosts, the CLI shows an uplink error')
        if data.get('defaultHost') and data['defaultHost'] not in hosts:
            add('ERROR', 'defaultHost %s does not exist' % data['defaultHost'])

        def check(node, path):
            if node.get('locked') and not node.get('password'):
                add('ERROR', '%s is locked without a password (can never open)' % path)
            if node.get('type') == 'dir':
                for child_name, child in (node.get('children') or {}).items():
                    check(child, path.rstrip('/') + '/' + child_name)
            elif node.get('type') != 'file':
                add('ERROR', '%s has type %s (must be dir or file)' % (path, node.get('type')))

        for host_name, host in hosts.items():
            if host.get('locked') and not host.get('password'):
                add('ERROR', 'host %s is locked without a password' % host_name)
            root = host.get('root')
            if not root or root.get('type') != 'dir':
                add('ERROR', 'host %s needs root: {"type": "dir", ...}' % host_name)
            else:
                check(root, host_name + ':/')

    elif name == 'netarch':
        ids = [a.get('id') for a in data.get('architectures', [])]
        for dup in {i for i in ids if ids.count(i) > 1}:
            add('ERROR', 'duplicate architecture id %s' % dup)
        for a in data.get('architectures', []):
            for i, f in enumerate(a.get('floors', []), 1):
                if f.get('type') not in FLOOR_TYPES:
                    add('WARN', '%s floor %d type %s (shown as file)' % (a.get('id'), i, f.get('type')))

    elif name == 'databank':
        ids = [r.get('id') for r in data.get('records', [])]
        for dup in {i for i in ids if ids.count(i) > 1}:
            add('ERROR', 'duplicate record id %s' % dup)
        for r in data.get('records', []):
            tokens = set(REDACT_RE.findall(r.get('body', '')))
            defs = set((r.get('redacted') or {}).keys())
            for key in tokens - defs:
                add('ERROR', '%s body uses {{redacted:%s}} with no definition ([DATA CORRUPTED])' % (r.get('id'), key))
            for key in defs - tokens:
                add('WARN', '%s defines redacted %s but the body never shows it' % (r.get('id'), key))
            for key, d in (r.get('redacted') or {}).items():
                if not d.get('code'):
                    add('ERROR', '%s redacted %s has no code' % (r.get('id'), key))

    elif name == 'signals':
        band = data.get('band', {})
        lo, hi = band.get('min', 88.0), band.get('max', 108.0)
        step = band.get('step', 0.1)
        signals = [s for s in data.get('signals', []) if isinstance(s.get('freq'), (int, float))]
        if len(signals) != len(data.get('signals', [])):
            add('ERROR', 'every signal needs a numeric freq (non-numeric ones are dropped)')
        for s in signals:
            f, tol = s['freq'], s.get('tolerance', 0.2)
            if not lo <= f <= hi:
                add('ERROR', '%s is outside the band %s-%s' % (f, lo, hi))
            grid = lo + round((f - lo) / step) * step if step else f
            if abs(grid - f) > tol + 1e-9:
                add('WARN', '%s cannot be reached with step %s and tolerance %s' % (f, step, tol))
            if s.get('type') not in SIGNAL_TYPES:
                add('ERROR', '%s type must be morse, tone or audio' % f)
            if s.get('type') == 'morse':
                if not s.get('text'):
                    add('ERROR', '%s morse signal has no text' % f)
                dropped = morse_drops(s.get('text', ''))
                if dropped:
                    add('WARN', '%s morse cannot send: %s' % (f, ' '.join(sorted(dropped))))
            if s.get('type') == 'audio':
                src = s.get('src', '')
                if not src:
                    add('ERROR', '%s audio signal has no src' % f)
                elif src.startswith('data/') and not (DATA.parent / src).exists() and not (DATA / src[5:]).exists():
                    add('ERROR', '%s audio file %s is missing' % (f, src))
        ordered = sorted(signals, key=lambda s: s['freq'])
        for a, b in zip(ordered, ordered[1:]):
            if b['freq'] - a['freq'] < a.get('tolerance', 0.2) + b.get('tolerance', 0.2):
                add('WARN', '%s and %s overlap, the nearest one wins' % (a['freq'], b['freq']))

    elif name == 'gates':
        ids = [g.get('id') for g in data.get('targets', [])]
        for dup in {i for i in ids if ids.count(i) > 1}:
            add('ERROR', 'duplicate gate id %s' % dup)
        for g in data.get('targets', []):
            if not g.get('password'):
                add('ERROR', 'gate %s has no password' % g.get('id'))

    return issues


def validate_all():
    issues = []
    for name in DATA_FILES:
        path = data_path(name)
        if not path.exists():
            issues.append(('WARN', name, 'file missing, the tool shows an empty state'))
            continue
        try:
            with open(path, encoding='utf-8') as fh:
                data = json.load(fh)
        except json.JSONDecodeError as error:
            issues.append(('ERROR', name, 'invalid JSON: %s' % error))
            continue
        issues.extend(validate_file(name, data))
    return issues


def cmd_validate(args):
    issues = validate_all()
    if not issues:
        out('ALL DATA VALID.')
        return
    for level, name, msg in issues:
        out('%-5s %-11s %s' % (level, name, msg))
    if any(level == 'ERROR' for level, _, _ in issues):
        sys.exit(1)


# ---------------------------------------------------------------------------
# Payload prep: same algorithms as js/encoder.js, cipher.js, morse.js, hasher.js
# ---------------------------------------------------------------------------

MORSE_MAP = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..',
    '0': '-----', '1': '.----', '2': '..---', '3': '...--', '4': '....-',
    '5': '.....', '6': '-....', '7': '--...', '8': '---..', '9': '----.',
    '.': '.-.-.-', ',': '--..--', '?': '..--..', '/': '-..-.', '=': '-...-',
    '-': '-....-', ':': '---...', "'": '.----.', '"': '.-..-.', '@': '.--.-.',
    '\u00D1': '--.--', '!': '-.-.--', '(': '-.--.', ')': '-.--.-', '&': '.-...',
    ';': '-.-.-.', '+': '.-.-.', '_': '..--.-', '$': '...-..-',
}
MORSE_REVERSE = {v: k for k, v in MORSE_MAP.items()}


def morse_for(char):
    if char in MORSE_MAP:
        return MORSE_MAP[char]
    base = ''.join(c for c in unicodedata.normalize('NFD', char) if not unicodedata.combining(c))
    return MORSE_MAP.get(base, '')


def morse_encode(text):
    words = []
    for word in text.strip().upper().split():
        letters = [code for code in (morse_for(c) for c in word) if code]
        if letters:
            words.append(' '.join(letters))
    return ' / '.join(words)


def morse_decode(morse):
    if not re.fullmatch(r'[.\-\s/]+', morse.strip()):
        raise GMError('Invalid morse. Use only dots, dashes, spaces and / between words.')
    return ' '.join(''.join(MORSE_REVERSE.get(code, '?') for code in word.split())
                    for word in re.split(r'\s*/\s*', morse.strip()))


def ascii85_encode(data):
    result = '<~'
    for i in range(0, len(data), 4):
        chunk_len = min(4, len(data) - i)
        chunk = 0
        for j in range(4):
            chunk = chunk * 256 + (data[i + j] if j < chunk_len else 0)
        if chunk == 0 and chunk_len == 4:
            result += 'z'
            continue
        encoded = ''
        for _ in range(5):
            encoded = chr(33 + chunk % 85) + encoded
            chunk //= 85
        result += encoded[:chunk_len + 1]
    return result + '~>'


def ascii85_decode(text):
    data = re.sub(r'\s+', '', text)
    if data.startswith('<~'):
        data = data[2:]
    if data.endswith('~>'):
        data = data[:-2]
    result = bytearray()
    i = 0
    while i < len(data):
        if data[i] == 'z':
            result.extend(b'\0\0\0\0')
            i += 1
            continue
        chunk_len = min(5, len(data) - i)
        chunk = 0
        for j in range(chunk_len):
            code = ord(data[i + j]) - 33
            if not 0 <= code <= 84:
                raise GMError('Invalid ASCII85 character.')
            chunk = chunk * 85 + code
        for _ in range(chunk_len, 5):
            chunk = chunk * 85 + 84
        # The app extracts bytes with 32-bit shifts, so overflow wraps
        result.extend((chunk & 0xFFFFFFFF).to_bytes(4, 'big')[:chunk_len - 1])
        i += chunk_len
    return bytes(result)


def token_bytes(text, width, pattern, base):
    tokens = []
    for token in text.strip().split():
        if len(token) > width and len(token) % width == 0:
            tokens.extend(token[i:i + width] for i in range(0, len(token), width))
        else:
            tokens.append(token)
    for token in tokens:
        if not re.fullmatch(pattern, token):
            raise GMError('Invalid input token "%s".' % token)
    return bytes(int(t, base) for t in tokens)


def bytes_to_text(data):
    try:
        return data.decode('utf-8')
    except UnicodeDecodeError:
        return data.decode('latin-1')


def cmd_enc(args):
    text = text_arg(args.text)
    raw = text.encode('utf-8')
    if args.method == 'binary':
        out(' '.join(format(b, '08b') for b in raw))
    elif args.method == 'hex':
        out(' '.join(format(b, '02x') for b in raw))
    elif args.method == 'base64':
        out(base64.b64encode(raw).decode('ascii'))
    elif args.method == 'ascii85':
        out(ascii85_encode(raw))


def cmd_dec(args):
    text = text_arg(args.text)
    if args.method == 'binary':
        out(bytes_to_text(token_bytes(re.sub(r'^0b', '', text, flags=re.I), 8, r'[01]{1,8}', 2)))
    elif args.method == 'hex':
        cleaned = re.sub(r'[,:]', ' ', re.sub(r'0x', ' ', text, flags=re.I))
        out(bytes_to_text(token_bytes(cleaned, 2, r'[0-9a-fA-F]{1,2}', 16)))
    elif args.method == 'base64':
        out(base64.b64decode(re.sub(r'\s+', '', text), validate=True).decode('utf-8'))
    elif args.method == 'ascii85':
        out(ascii85_decode(text).decode('utf-8'))


def shift_letter(char, shift):
    if 'A' <= char <= 'Z':
        return chr((ord(char) - 65 + shift) % 26 + 65)
    if 'a' <= char <= 'z':
        return chr((ord(char) - 97 + shift) % 26 + 97)
    return char


def caesar(text, shift, decrypt):
    if not 1 <= shift <= 25:
        raise GMError('Caesar shift must be 1-25 (the app rejects anything else).')
    return ''.join(shift_letter(c, -shift if decrypt else shift) for c in text)


def vigenere(text, key, decrypt):
    clean = re.sub(r'[^A-Z]', '', key.upper())
    if not clean:
        raise GMError('Vigenere key must contain letters.')
    result, index = [], 0
    for c in text:
        if not ('A' <= c <= 'Z' or 'a' <= c <= 'z'):
            result.append(c)
            continue
        shift = ord(clean[index % len(clean)]) - 65
        index += 1
        result.append(shift_letter(c, -shift if decrypt else shift))
    return ''.join(result)


def atbash(text):
    return ''.join(chr(90 - (ord(c) - 65)) if 'A' <= c <= 'Z' else
                   chr(122 - (ord(c) - 97)) if 'a' <= c <= 'z' else c for c in text)


def substitution(text, alphabet, decrypt):
    clean = re.sub(r'[^A-Z]', '', alphabet.upper())
    if len(clean) != 26 or len(set(clean)) != 26:
        raise GMError('Substitution alphabet must have each of the 26 letters exactly once.')
    std = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    src, dst = (clean, std) if decrypt else (std, clean)
    result = []
    for c in text:
        if 'A' <= c <= 'Z' or 'a' <= c <= 'z':
            mapped = dst[src.index(c.upper())]
            result.append(mapped.lower() if c.islower() else mapped)
        else:
            result.append(c)
    return ''.join(result)


def cmd_cipher(args):
    text = text_arg(args.text)
    decrypt = args.direction == 'decrypt'
    key = args.key
    if args.method == 'caesar':
        if key is None:
            raise GMError('--key <1-25> required.')
        out(caesar(text, int(key), decrypt))
    elif args.method == 'vigenere':
        if not key:
            raise GMError('--key <word> required.')
        out(vigenere(text, key, decrypt))
    elif args.method == 'atbash':
        out(atbash(text))
    elif args.method == 'sub':
        if not key or key == 'random':
            letters = list('ABCDEFGHIJKLMNOPQRSTUVWXYZ')
            random.shuffle(letters)
            key = ''.join(letters)
            print('KEY (give players this alphabet or let them crack it): ' + key, file=sys.stderr)
        out(substitution(text, key, decrypt))


def cmd_morse(args):
    text = text_arg(args.text)
    if args.direction == 'encode':
        dropped = morse_drops(text)
        if dropped:
            print('Not encodable, dropped: ' + ' '.join(sorted(dropped)), file=sys.stderr)
        out(morse_encode(text))
    else:
        out(morse_decode(text))


def cmd_sha256(args):
    out(hashlib.sha256(text_arg(args.text).encode('utf-8')).hexdigest())


# ---------------------------------------------------------------------------
# PNG read/write (8-bit, non-interlaced) for steganography carriers
# ---------------------------------------------------------------------------

def png_read(path):
    """Return (width, height, channels, bytearray) with channels 3 or 4"""
    try:
        from PIL import Image  # optional, handles any format
        img = Image.open(path)
        img = img.convert('RGBA' if 'A' in img.getbands() or img.mode == 'P' else 'RGB')
        return img.width, img.height, len(img.getbands()), bytearray(img.tobytes())
    except ImportError:
        pass

    raw = Path(path).read_bytes()
    if raw[:8] != b'\x89PNG\r\n\x1a\n':
        raise GMError('Carrier must be a PNG (install Pillow for JPEG/WebP, or use --generate).')
    pos, idat, palette, trns = 8, b'', None, None
    while pos < len(raw):
        length, ctype = struct.unpack('>I4s', raw[pos:pos + 8])
        chunk = raw[pos + 8:pos + 8 + length]
        if ctype == b'IHDR':
            width, height, depth, color, _, _, interlace = struct.unpack('>IIBBBBB', chunk)
        elif ctype == b'PLTE':
            palette = chunk
        elif ctype == b'tRNS':
            trns = chunk
        elif ctype == b'IDAT':
            idat += chunk
        pos += 12 + length
    if depth != 8 or interlace:
        raise GMError('Only 8-bit non-interlaced PNGs are supported without Pillow (or use --generate).')
    bpp = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color]
    stride = width * bpp
    data = zlib.decompress(idat)
    pixels = bytearray(height * stride)
    prev = bytearray(stride)
    for y in range(height):
        ftype = data[y * (stride + 1)]
        line = bytearray(data[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if ftype == 1:
                line[x] = (line[x] + a) & 0xFF
            elif ftype == 2:
                line[x] = (line[x] + b) & 0xFF
            elif ftype == 3:
                line[x] = (line[x] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 0xFF
        pixels[y * stride:(y + 1) * stride] = line
        prev = line

    if color == 2:
        return width, height, 3, pixels
    if color == 6:
        return width, height, 4, pixels
    rgba = bytearray()
    for i in range(width * height):
        if color == 0:
            g = pixels[i]
            rgba += bytes((g, g, g, 255))
        elif color == 4:
            g, alpha = pixels[i * 2], pixels[i * 2 + 1]
            rgba += bytes((g, g, g, alpha))
        else:
            idx = pixels[i]
            alpha = trns[idx] if trns and idx < len(trns) else 255
            rgba += palette[idx * 3:idx * 3 + 3] + bytes((alpha,))
    return width, height, 4, rgba


def png_write(path, width, height, channels, pixels):
    stride = width * channels
    rows = b''.join(b'\0' + bytes(pixels[y * stride:(y + 1) * stride]) for y in range(height))

    def chunk(ctype, body):
        return struct.pack('>I', len(body)) + ctype + body + struct.pack('>I', zlib.crc32(ctype + body) & 0xFFFFFFFF)

    color = 6 if channels == 4 else 2
    blob = (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, color, 0, 0, 0)) +
            chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(blob)


def generate_carrier(width, height):
    """Noisy cyberpunk-ish gradient so the carrier looks like a real capture"""
    pixels = bytearray(width * height * 3)
    rng = random.Random(77)
    for y in range(height):
        for x in range(width):
            i = (y * width + x) * 3
            scan = 0.6 if y % 4 == 0 else 1.0
            grid = 1.4 if x % 32 == 0 or y % 32 == 0 else 1.0
            pixels[i] = min(255, int((20 + 180 * x / width + rng.randint(0, 30)) * scan * grid))
            pixels[i + 1] = min(255, int((10 + rng.randint(0, 25)) * scan * grid))
            pixels[i + 2] = min(255, int((60 + 150 * y / height + rng.randint(0, 30)) * scan * grid))
    return pixels


def stego_channels(pixels, channels):
    """Indices of R, G, B bytes in pixel order, like the canvas loop in js/stego.js"""
    for p in range(len(pixels) // channels):
        base = p * channels
        yield base
        yield base + 1
        yield base + 2


def cmd_stego(args):
    MAGIC = b'CT77'
    if args.action == 'embed':
        if args.generate:
            match = re.fullmatch(r'(\d+)x(\d+)', args.generate)
            if not match:
                raise GMError('--generate takes WIDTHxHEIGHT, e.g. 640x400.')
            width, height = int(match.group(1)), int(match.group(2))
            channels, pixels = 3, generate_carrier(width, height)
        else:
            if not args.carrier:
                raise GMError('Give --carrier image.png or --generate 640x400.')
            width, height, channels, pixels = png_read(args.carrier)
        payload = text_arg(args.payload).encode('utf-8')
        full = MAGIC + struct.pack('>I', len(payload)) + payload
        capacity = (width * height * 3) // 8 - 8
        if len(payload) > capacity:
            raise GMError('Payload %d bytes, carrier holds %d.' % (len(payload), capacity))
        bits = [(byte >> b) & 1 for byte in full for b in range(7, -1, -1)]
        used_pixels = math.ceil(len(bits) / 3)
        if channels == 4:
            # Same as js/stego.js: carrier pixels must be opaque to survive canvas premultiply
            for p in range(used_pixels):
                pixels[p * 4 + 3] = 255
        for bit, index in zip(bits, stego_channels(pixels, channels)):
            pixels[index] = (pixels[index] & 0xFE) | bit
        png_write(args.out, width, height, channels, pixels)
        out('STEGO PNG written: %s (%dx%d, %d/%d bytes used). Players extract it in STEGANOGRAPHY.'
            % (args.out, width, height, len(payload), capacity))
        if not Path(args.out).resolve().is_relative_to(DATA):
            out('Publish it for download with: file add %s' % args.out)
    else:
        width, height, channels, pixels = png_read(args.image)
        indices = stego_channels(pixels, channels)

        def read(count):
            data = bytearray()
            for _ in range(count):
                value = 0
                for _ in range(8):
                    value = (value << 1) | (pixels[next(indices)] & 1)
                data.append(value)
            return bytes(data)

        header = read(8)
        if header[:4] != MAGIC:
            raise GMError('No CT77 payload in this image.')
        length = struct.unpack('>I', header[4:])[0]
        out(read(length).decode('utf-8', errors='replace'))


# ---------------------------------------------------------------------------
# Spectrogram audio: draw text or an image into the frequency domain
# ---------------------------------------------------------------------------

FONT_5X7 = {
    'A': '01110100011000111111100011000110001', 'B': '11110100011000111110100011000111110',
    'C': '01110100011000010000100001000101110', 'D': '11110100011000110001100011000111110',
    'E': '11111100001000011110100001000011111', 'F': '11111100001000011110100001000010000',
    'G': '01110100011000010111100011000101111', 'H': '10001100011000111111100011000110001',
    'I': '01110001000010000100001000010001110', 'J': '00111000100001000010000101001001100',
    'K': '10001100101010011000101001001010001', 'L': '10000100001000010000100001000011111',
    'M': '10001110111010110101100011000110001', 'N': '10001100011100110101100111000110001',
    'O': '01110100011000110001100011000101110', 'P': '11110100011000111110100001000010000',
    'Q': '01110100011000110001101011001001101', 'R': '11110100011000111110101001001010001',
    'S': '01111100001000001110000010000111110', 'T': '11111001000010000100001000010000100',
    'U': '10001100011000110001100011000101110', 'V': '10001100011000110001100010101000100',
    'W': '10001100011000110101101011010101010', 'X': '10001100010101000100010101000110001',
    'Y': '10001100010101000100001000010000100', 'Z': '11111000010001000100010001000011111',
    '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
    '2': '01110100010000100010001000100011111', '3': '11111000100010000010000011000101110',
    '4': '00010001100101010010111110001000010', '5': '11111100001111000001000011000101110',
    '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
    '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100',
    '-': '00000000000000011111000000000000000', '.': '00000000000000000000000000110001100',
    ':': '00000011000110000000011000110000000', '/': '00001000010001000100010001000010000',
    '#': '01010010101111101010111110101001010', '_': '00000000000000000000000000000011111',
    '!': '00100001000010000100001000000000100', '?': '01110100010000100010001000000000100',
    ' ': '0' * 35,
}


def text_grid(text):
    chars = [c for c in unicodedata.normalize('NFD', text.upper()) if not unicodedata.combining(c)]
    columns = []
    for char in chars:
        glyph = FONT_5X7.get(char, FONT_5X7['?'])
        for x in range(5):
            columns.append([1.0 if glyph[y * 5 + x] == '1' else 0.0 for y in range(7)])
        columns.append([0.0] * 7)
    blank = [[0.0] * 7] * 2
    return blank + columns + blank, 7


def image_grid(path, rows):
    width, height, channels, pixels = png_read(path)
    cols = max(1, min(240, round(width * rows / height * 1.6)))
    grid = []
    for cx in range(cols):
        column = []
        for ry in range(rows):
            x = min(width - 1, int((cx + 0.5) * width / cols))
            y = min(height - 1, int((ry + 0.5) * height / rows))
            i = (y * width + x) * channels
            lum = (0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]) / 255
            column.append(lum ** 2)
        grid.append(column)
    return grid, rows, width / height


def natural_seconds(aspect, fmin, fmax):
    """Duration that keeps the picture's aspect ratio in the analyzer
    (FFT 2048 at 44.1 kHz: 1024 px for 22.05 kHz, one column per 512 samples)"""
    height_px = (fmax - fmin) * 1024 / 22050
    return aspect * height_px * 512 / 44100


def synthesize(grid, rows, seconds, fmin, fmax, rate=44100):
    """Each grid row is a band of random-phase partials, faded smoothly
    between columns so no clicks smear across the spectrogram"""
    total = int(seconds * rate)
    cols = len(grid)
    col_len = total / cols
    band = (fmax - fmin) / rows
    partials = max(1, int(band * 0.8 / 200))
    fade = max(1, int(rate * 0.015))
    rng = random.Random(2077)
    samples = [0.0] * total
    two_pi = 2 * math.pi
    for r in range(rows):
        levels = [min(1.0, max(0.0, grid[c][r])) for c in range(cols)]
        if max(levels) <= 0.02:
            continue
        # Per sample amplitude: constant inside a column, raised cosine at changes
        amp = [0.0] * total
        for c in range(cols):
            start, end = int(c * col_len), int((c + 1) * col_len)
            prev = levels[c - 1] if c else 0.0
            for n in range(start, end):
                k = n - start
                if k < fade and prev != levels[c]:
                    w = 0.5 - 0.5 * math.cos(math.pi * k / fade)
                    amp[n] = prev + (levels[c] - prev) * w
                else:
                    amp[n] = levels[c]
        top = fmax - band * r
        for p in range(partials):
            freq = top - band * (p + 0.5 + 0.1) / (partials + 0.2)
            step = two_pi * freq / rate
            phase = rng.random() * two_pi
            for n in range(total):
                a = amp[n]
                if a:
                    samples[n] += a * math.sin(step * n + phase)
    peak = max(1e-9, max(abs(x) for x in samples))
    return [x / peak * 0.9 for x in samples], rate


def cmd_spectro(args):
    if args.source == 'text':
        grid, rows = text_grid(text_arg(args.input))
        aspect = len(grid) / rows
        fmin, fmax = args.fmin or 6000, args.fmax or 11000
    else:
        grid, rows, aspect = image_grid(args.input, args.rows)
        fmin, fmax = args.fmin or 2000, args.fmax or 16000
    if not 0 < fmin < fmax <= 21000:
        raise GMError('Need 0 < fmin < fmax <= 21000 Hz.')
    seconds = args.seconds or max(3.0, natural_seconds(aspect, fmin, fmax))
    if seconds > 60:
        warn('%.0fs of audio, consider shorter text or --seconds.' % seconds)
    samples, rate = synthesize(grid, rows, seconds, fmin, fmax)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(args.out), 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(rate)
        wav.writeframes(b''.join(struct.pack('<h', int(x * 32767)) for x in samples))
    out('SPECTRO WAV written: %s (%.1fs, %d-%d Hz). Best viewed in SPECTROGRAM ANALYZER at FFT 2048.'
        % (args.out, seconds, fmin, fmax))
    if not Path(args.out).resolve().is_relative_to(DATA):
        out('Publish it with: file add %s   or as a radio broadcast: audio add %s' % (args.out, args.out))


# ---------------------------------------------------------------------------
# CLI wiring
# ---------------------------------------------------------------------------

def build_parser():
    p = argparse.ArgumentParser(prog='gmctl', description='Cyberterminal live GM control.')
    sub = p.add_subparsers(dest='group', required=True)

    sub.add_parser('status', help='one screen summary of the live campaign').set_defaults(fn=cmd_status)
    v = sub.add_parser('validate', help='check every data file for errors')
    v.set_defaults(fn=cmd_validate)

    u = sub.add_parser('undo', help='revert the last change(s)')
    u.add_argument('steps', nargs='?', type=int, default=1)
    u.add_argument('--list', action='store_true')
    u.set_defaults(fn=cmd_undo)

    c = sub.add_parser('checkpoint', help='save files to history before a hand edit')
    c.add_argument('files', nargs='*')
    c.add_argument('--note')
    c.set_defaults(fn=cmd_checkpoint)

    s = sub.add_parser('snapshot', help='save/restore whole campaign states (scenes)')
    s.add_argument('action', choices=['save', 'restore', 'list', 'delete'])
    s.add_argument('name', nargs='?')
    s.add_argument('--only', nargs='+', help='restore only these files')
    s.add_argument('--force', action='store_true')
    s.set_defaults(fn=cmd_snapshot)

    pl = sub.add_parser('players', help='GM roster: character name -> login handle')
    pl.add_argument('action', choices=['list', 'add', 'rm'])
    pl.add_argument('handle', nargs='?')
    pl.add_argument('--name', help='character name')
    pl.add_argument('--player', help='real player name')
    pl.set_defaults(fn=cmd_players)

    m = sub.add_parser('msg', help='transmissions')
    msub = m.add_subparsers(dest='action', required=True)
    ms = msub.add_parser('send')
    ms.add_argument('--to', default='all', help='all, or handles/character names, comma separated')
    ms.add_argument('--from', dest='sender')
    ms.add_argument('--subject', default='')
    ms.add_argument('--body', help='text, or - to read stdin')
    ms.add_argument('--urgent', action='store_true', help='full screen takeover with alarm')
    ms.add_argument('--at', help='HH:MM local or ISO time')
    ms.add_argument('--in', dest='delay', help='delay like 10m')
    ms.add_argument('--id')
    ml = msub.add_parser('list')
    ml.add_argument('-n', type=int, default=0)
    msh = msub.add_parser('show')
    msh.add_argument('id')
    mr = msub.add_parser('resend')
    mr.add_argument('id')
    mr.add_argument('--to')
    me = msub.add_parser('edit')
    me.add_argument('id')
    me.add_argument('--subject')
    me.add_argument('--body')
    me.add_argument('--from', dest='sender')
    me.add_argument('--to')
    me.add_argument('--urgent', action='store_true')
    me.add_argument('--normal', action='store_true')
    me.add_argument('--at')
    me.add_argument('--in', dest='delay')
    me.add_argument('--now', action='store_true', help='release a scheduled message now')
    mrm = msub.add_parser('rm')
    mrm.add_argument('ids', nargs='+')
    mc = msub.add_parser('clear')
    mc.add_argument('--yes', action='store_true')
    mc.add_argument('--keep-scheduled', action='store_true')
    m.set_defaults(fn=cmd_msg)

    f = sub.add_parser('fx', help='instability and MOTD')
    fsub = f.add_subparsers(dest='action', required=True)
    fi = fsub.add_parser('instability')
    fi.add_argument('level', type=int)
    fi.add_argument('--for', dest='duration', help='hold then revert, e.g. 45s (blocks)')
    fi.add_argument('--restore', type=int, help='level to return to after --for')
    fsub.add_parser('calm')
    fm = fsub.add_parser('motd')
    fm.add_argument('text')
    f.set_defaults(fn=cmd_fx)

    cf = sub.add_parser('config', help='raw config.json')
    cfsub = cf.add_subparsers(dest='action', required=True)
    cfsub.add_parser('show')
    cp = cfsub.add_parser('poll')
    cp.add_argument('seconds', type=int)
    cf.set_defaults(fn=cmd_config)

    b = sub.add_parser('breach', help='Breach Protocol settings')
    bsub = b.add_subparsers(dest='action', required=True)
    bsub.add_parser('show')
    bs = bsub.add_parser('set')
    bs.add_argument('--difficulty', choices=DIFFICULTIES)
    bs.add_argument('--lock', action='store_true')
    bs.add_argument('--unlock', action='store_true')
    bd = bsub.add_parser('daemon')
    bd.add_argument('index', type=int)
    bd.add_argument('--name')
    bd.add_argument('--reward')
    bsub.add_parser('reset')
    b.set_defaults(fn=cmd_breach)

    fs = sub.add_parser('fs', help='NETLINK CLI filesystem')
    fsub = fs.add_subparsers(dest='action', required=True)
    ft = fsub.add_parser('tree')
    ft.add_argument('host', nargs='?')
    fc = fsub.add_parser('cat')
    fc.add_argument('path')
    fw = fsub.add_parser('write')
    fw.add_argument('path', help='host:/dir/file.txt (dirs are created)')
    fw.add_argument('--content', help='text, or - for stdin')
    fw.add_argument('--lock', metavar='PASSWORD')
    fmk = fsub.add_parser('mkdir')
    fmk.add_argument('path')
    fmk.add_argument('--lock', metavar='PASSWORD')
    fl = fsub.add_parser('lock')
    fl.add_argument('path', help='host or host:/path')
    fl.add_argument('password')
    fo = fsub.add_parser('open')
    fo.add_argument('path')
    frm = fsub.add_parser('rm')
    frm.add_argument('path')
    fmv = fsub.add_parser('mv')
    fmv.add_argument('path')
    fmv.add_argument('dest')
    fha = fsub.add_parser('host-add')
    fha.add_argument('host')
    fha.add_argument('--motd')
    fha.add_argument('--lock', metavar='PASSWORD')
    fhr = fsub.add_parser('host-rm')
    fhr.add_argument('host')
    fd = fsub.add_parser('default')
    fd.add_argument('host')
    fmo = fsub.add_parser('motd')
    fmo.add_argument('host')
    fmo.add_argument('text')
    fs.set_defaults(fn=cmd_fs)

    d = sub.add_parser('db', help='DATABANK records')
    dsub = d.add_subparsers(dest='action', required=True)
    dl = dsub.add_parser('list')
    dl.add_argument('query', nargs='?')
    dsh = dsub.add_parser('show')
    dsh.add_argument('id')
    for name in ('add', 'set'):
        dx = dsub.add_parser(name)
        dx.add_argument('id')
        dx.add_argument('--name')
        dx.add_argument('--type', help='NPC, CORP, GIG, LOCATION...')
        dx.add_argument('--alias')
        dx.add_argument('--tag', action='append', help='repeatable; on set replaces all tags')
        dx.add_argument('--field', action='append', help='LABEL=value, repeatable')
        dx.add_argument('--body')
        if name == 'set':
            dx.add_argument('--add-tag', action='append')
            dx.add_argument('--rm-field', action='append')
            dx.add_argument('--append', help='append a paragraph to the body')
    dr = dsub.add_parser('redact')
    dr.add_argument('id')
    dr.add_argument('key')
    dr.add_argument('--code', required=True)
    dr.add_argument('--content', required=True)
    dr.add_argument('--label', help='text placed before the token when it is appended')
    du = dsub.add_parser('unredact')
    du.add_argument('id')
    du.add_argument('key')
    drm = dsub.add_parser('rm')
    drm.add_argument('id')
    d.set_defaults(fn=cmd_db)

    g = sub.add_parser('gate', help='ICEBREAKER targets')
    gsub = g.add_subparsers(dest='action', required=True)
    gsub.add_parser('list')
    for name in ('add', 'set'):
        gx = gsub.add_parser(name)
        gx.add_argument('id')
        gx.add_argument('--name')
        gx.add_argument('--hint')
        gx.add_argument('--password')
        gx.add_argument('--attempts', type=int)
        gx.add_argument('--lockout', type=int, help='seconds')
        gx.add_argument('--reward')
    for name in ('reset', 'rm'):
        gsub.add_parser(name).add_argument('id')
    g.set_defaults(fn=cmd_gate)

    a = sub.add_parser('arch', help='NET architectures')
    asub = a.add_subparsers(dest='action', required=True)
    asub.add_parser('list')
    for name in ('add', 'set'):
        ax = asub.add_parser(name)
        ax.add_argument('id')
        ax.add_argument('--name')
        ax.add_argument('--difficulty')
        ax.add_argument('--desc')
    for name in ('show', 'reset', 'rm'):
        asub.add_parser(name).add_argument('id')
    for name in ('floor', 'floor-set'):
        af = asub.add_parser(name)
        af.add_argument('id')
        if name == 'floor-set':
            af.add_argument('index', type=int)
        else:
            af.add_argument('--at', type=int, help='1-based position, default last')
        af.add_argument('--type', choices=FLOOR_TYPES)
        af.add_argument('--name')
        af.add_argument('--dv', type=int)
        af.add_argument('--ice', help='ICE program name, for ice floors')
        af.add_argument('--desc')
        af.add_argument('--content', help='revealed text, for file floors')
    afr = asub.add_parser('floor-rm')
    afr.add_argument('id')
    afr.add_argument('index', type=int)
    a.set_defaults(fn=cmd_arch)

    sg = sub.add_parser('sig', help='SIGNAL TUNER broadcasts')
    ssub = sg.add_subparsers(dest='action', required=True)
    ssub.add_parser('list')
    sb = ssub.add_parser('band')
    sb.add_argument('--min', type=float)
    sb.add_argument('--max', type=float)
    sb.add_argument('--step', type=float)
    sb.add_argument('--unit')
    for name in ('add', 'set'):
        sx = ssub.add_parser(name)
        sx.add_argument('--freq', type=float, required=True)
        if name == 'set':
            sx.add_argument('--new-freq', type=float)
        sx.add_argument('--type', choices=SIGNAL_TYPES)
        sx.add_argument('--label')
        sx.add_argument('--tolerance', type=float)
        sx.add_argument('--text', help='morse text')
        sx.add_argument('--wpm', type=int)
        sx.add_argument('--tone-hz', type=float)
        sx.add_argument('--src', help='audio file path (copied into data/audio) or data/audio/x')
    ssub.add_parser('rm').add_argument('--freq', type=float, required=True)
    sg.set_defaults(fn=cmd_sig)

    for group, fn, help_text in (('audio', cmd_audio, 'clips in data/audio for signals'),
                                 ('file', cmd_file, 'downloadable files in data/files')):
        x = sub.add_parser(group, help=help_text)
        xsub = x.add_subparsers(dest='action', required=True)
        xsub.add_parser('list')
        xa = xsub.add_parser('add')
        xa.add_argument('path')
        xa.add_argument('--name', help='stored file name')
        xsub.add_parser('rm').add_argument('path', help='file name inside the folder')
        x.set_defaults(fn=fn)

    n = sub.add_parser('net', help='player URL and live server check')
    n.add_argument('action', choices=['url', 'check'])
    n.add_argument('--url', help='server base URL, default http://localhost:<compose port>')
    n.set_defaults(fn=cmd_net)

    e = sub.add_parser('enc', help='encode like the DATA DECODER tool')
    e.add_argument('method', choices=['binary', 'hex', 'base64', 'ascii85'])
    e.add_argument('text')
    e.set_defaults(fn=cmd_enc)
    de = sub.add_parser('dec', help='decode like the DATA DECODER tool')
    de.add_argument('method', choices=['binary', 'hex', 'base64', 'ascii85'])
    de.add_argument('text')
    de.set_defaults(fn=cmd_dec)

    ci = sub.add_parser('cipher', help='encrypt like the CIPHER DECODER tool')
    ci.add_argument('method', choices=['caesar', 'vigenere', 'atbash', 'sub'])
    ci.add_argument('direction', choices=['encrypt', 'decrypt'])
    ci.add_argument('text')
    ci.add_argument('--key', help='caesar 1-25, vigenere word, sub 26-letter alphabet or "random"')
    ci.set_defaults(fn=cmd_cipher)

    mo = sub.add_parser('morse', help='morse like the MORSE TRANSCEIVER')
    mo.add_argument('direction', choices=['encode', 'decode'])
    mo.add_argument('text')
    mo.set_defaults(fn=cmd_morse)

    sh = sub.add_parser('sha256', help='digest like the HASH VALIDATOR')
    sh.add_argument('text')
    sh.set_defaults(fn=cmd_sha256)

    st = sub.add_parser('stego', help='LSB payloads compatible with STEGANOGRAPHY')
    stsub = st.add_subparsers(dest='action', required=True)
    se = stsub.add_parser('embed')
    se.add_argument('payload', help='text, or - for stdin')
    se.add_argument('--carrier', help='PNG image (any format with Pillow)')
    se.add_argument('--generate', metavar='WxH', help='synthesize a carrier instead')
    se.add_argument('--out', required=True)
    sx = stsub.add_parser('extract')
    sx.add_argument('image')
    st.set_defaults(fn=cmd_stego)

    sp = sub.add_parser('spectro', help='audio that shows text/an image in SPECTROGRAM')
    sp.add_argument('source', choices=['text', 'image'])
    sp.add_argument('input', help='text to draw, or a PNG path')
    sp.add_argument('--out', required=True)
    sp.add_argument('--seconds', type=float)
    sp.add_argument('--fmin', type=int, help='lowest Hz (text 6000, image 2000)')
    sp.add_argument('--fmax', type=int, help='highest Hz (text 11000, image 16000)')
    sp.add_argument('--rows', type=int, default=40, help='vertical resolution for images')
    sp.set_defaults(fn=cmd_spectro)

    return p


def main(argv=None):
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    args = build_parser().parse_args(argv)
    try:
        args.fn(args)
    except GMError as error:
        print('ERROR: %s' % error, file=sys.stderr)
        sys.exit(2)
    except KeyboardInterrupt:
        sys.exit(130)
    except BrokenPipeError:
        # Output piped into head or similar, nothing left to print
        sys.stderr.close()


if __name__ == '__main__':
    main()
