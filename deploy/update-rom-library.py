#!/usr/bin/env python3
"""Publish a JSON catalog of valid NES files already uploaded to a directory."""

import argparse
import json
import os
from pathlib import Path
import stat
import tempfile

MAX_ROM_BYTES = 8 * 1024 * 1024
MAX_CATALOG_BYTES = 1024 * 1024


def rom_entry(path):
    name = path.name
    if name.startswith('.') or not name.lower().endswith('.nes'):
        return None
    if not name[:-4].strip() or any(ord(char) < 32 or 127 <= ord(char) <= 159 or char in '/\\' for char in name):
        return None
    try:
        name.encode('utf-8')
        if path.is_symlink():
            return None
        descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0))
        with os.fdopen(descriptor, 'rb') as rom:
            info = os.fstat(rom.fileno())
            if not stat.S_ISREG(info.st_mode) or not 16 <= info.st_size <= MAX_ROM_BYTES:
                return None
            header = rom.read(16)
    except (OSError, UnicodeError):
        return None
    if len(header) != 16 or header[:4] != b'NES\x1a' or not header[4] or header[7] & 0x0c == 0x08:
        return None
    expected = 16 + header[4] * 16384 + header[5] * 8192 + (512 if header[6] & 4 else 0)
    if info.st_size < expected:
        return None
    return {'name': name, 'type': 'file', 'size': info.st_size}


def update_catalog(directory):
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('The ROM directory must be a real directory, not a symlink.')
    entries = []
    for path in sorted(directory.iterdir(), key=lambda item: item.name.casefold()):
        entry = rom_entry(path)
        if entry is not None:
            entries.append(entry)
    payload = (json.dumps(entries, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    if len(payload) > MAX_CATALOG_BYTES:
        raise ValueError('The game catalog exceeds the 1 MiB player limit.')
    descriptor, temporary = tempfile.mkstemp(prefix='.rom-index-', suffix='.tmp', dir=directory)
    try:
        with os.fdopen(descriptor, 'wb') as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, 0o644)
        os.replace(temporary, directory / 'index.json')
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, help='Public ROM directory, such as /var/www/ivy/roms')
    args = parser.parse_args()
    try:
        entries = update_catalog(args.directory)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Cannot update the game catalog: {error}\n')
    print(f'Published {len(entries)} games to {args.directory / "index.json"}')


if __name__ == '__main__':
    main()
