import json
import os
from pathlib import Path
import runpy
import tempfile
import unittest
from unittest.mock import patch

catalog = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'deploy' / 'update-rom-library.py'))
update_catalog = catalog['update_catalog']


def synthetic_rom():
    data = bytearray(16 + 16384)
    data[:8] = b'NES\x1a\x01\x00\x00\x00'
    return data


class CatalogTests(unittest.TestCase):
    def test_catalog_only_lists_complete_direct_nes_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            rom = synthetic_rom()
            (directory / '游戏 #1.NES').write_bytes(rom)
            (directory / 'bad.nes').write_bytes(b'not a rom')
            (directory / 'truncated.nes').write_bytes(rom[:-1])
            nes2 = bytearray(rom)
            nes2[7] = 8
            (directory / 'nes2.nes').write_bytes(nes2)
            (directory / '.hidden.nes').write_bytes(rom)
            (directory / 'notes.txt').write_bytes(rom)
            (directory / 'folder.nes').mkdir()
            (directory / 'folder.nes' / 'nested.nes').write_bytes(rom)
            entries = update_catalog(directory)
            self.assertEqual(entries, [{'name': '游戏 #1.NES', 'type': 'file', 'size': len(rom)}])
            self.assertEqual(json.loads((directory / 'index.json').read_text(encoding='utf-8')), entries)
            self.assertEqual(list(directory.glob('.rom-index-*.tmp')), [])
            (directory / '游戏 #1.NES').unlink()
            self.assertEqual(update_catalog(directory), [])

    def test_failed_publish_preserves_the_previous_catalog(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            previous = b'[]\n'
            (directory / 'index.json').write_bytes(previous)
            (directory / 'one.nes').write_bytes(synthetic_rom())
            with patch('os.replace', side_effect=OSError('simulated publication failure')):
                with self.assertRaises(OSError):
                    update_catalog(directory)
            self.assertEqual((directory / 'index.json').read_bytes(), previous)
            self.assertEqual(list(directory.glob('.rom-index-*.tmp')), [])

    @unittest.skipIf(os.name == 'nt', 'Symlink creation may require Windows administrator privileges')
    def test_symlink_roms_and_symlink_directories_are_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            directory = base / 'roms'
            directory.mkdir()
            original = base / 'private.nes'
            original.write_bytes(synthetic_rom())
            (directory / 'linked.nes').symlink_to(original)
            self.assertEqual(update_catalog(directory), [])
            alias = base / 'alias'
            alias.symlink_to(directory, target_is_directory=True)
            with self.assertRaises(ValueError):
                update_catalog(alias)


if __name__ == '__main__':
    unittest.main()
