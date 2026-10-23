"""Validate the prepared WSB artifact without launching Sandbox or scripts."""
import base64
import json
from pathlib import Path
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / 'sandbox' / '鑫金源安全边界检查.wsb'

class SandboxConfig(unittest.TestCase):
    def test_sensitive_redirects_and_network_are_explicitly_disabled(self):
        raw = CONFIG.read_bytes()
        self.assertLess(len(raw), 65536)
        self.assertNotIn(b'<!DOCTYPE', raw.upper())
        tree = ET.fromstring(raw)
        self.assertEqual(tree.tag, 'Configuration')
        tags = [node.tag for node in tree]
        self.assertEqual(len(tags), len(set(tags)), 'Duplicate settings must not hide a permissive value')
        for tag in ('vGPU', 'Networking', 'AudioInput', 'VideoInput', 'PrinterRedirection', 'ClipboardRedirection'):
            self.assertEqual(tree.findtext(tag), 'Disable')
        self.assertEqual(tree.findtext('ProtectedClient'), 'Enable')
        self.assertEqual(tree.findtext('MemoryInMB'), '4096')

    def test_only_dedicated_synthetic_input_and_result_folders_are_shared(self):
        tree = ET.parse(CONFIG)
        maps = tree.findall('./MappedFolders/MappedFolder')
        self.assertEqual(len(maps), 2)
        expected = {
            (ROOT / 'sandbox/input').resolve(): ('C:\\xjy-input', 'true'),
            (ROOT / 'sandbox/results').resolve(): ('C:\\xjy-results', 'false'),
        }
        observed = set()
        for item in maps:
            folder = Path(item.findtext('HostFolder'))
            self.assertTrue(folder.resolve(strict=True).is_relative_to(ROOT.resolve(strict=True)))
            for ancestor in (folder, *folder.parents):
                self.assertFalse(ancestor.is_symlink() or ancestor.is_junction())
            real = folder.resolve()
            self.assertIn(real, expected)
            self.assertNotIn(real, observed)
            observed.add(real)
            self.assertEqual((item.findtext('SandboxFolder'), item.findtext('ReadOnly')), expected[real])
        self.assertEqual(observed, set(expected))
        source = ROOT / 'sandbox/input'
        names = {p.name for p in source.iterdir()}
        self.assertTrue({'synthetic-marker.json', 'boundary-probe.ps1'}.issubset(names))
        import re
        self.assertFalse({name for name in names if name not in
                          {'synthetic-marker.json', 'boundary-probe.ps1', 'guest-bootstrap.ps1'}
                          and not re.fullmatch(r'package(?:-v[1-9]\d*)?', name)})
        for p in source.iterdir():
            self.assertFalse(p.is_symlink() or p.is_junction())
            if p.is_file():
                self.assertEqual(p.stat().st_nlink, 1)
        self.assertTrue(json.loads((source / 'synthetic-marker.json').read_text('utf-8-sig'))['synthetic'])

    def test_logon_is_the_prepared_boundary_probe_and_not_a_business_launcher(self):
        command = ET.parse(CONFIG).findtext('./LogonCommand/Command')
        prefix = 'powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand '
        self.assertTrue(command.startswith(prefix))
        decoded = base64.b64decode(command[len(prefix):], validate=True).decode('utf-16-le')
        source = (ROOT / 'sandbox/input/boundary-probe.ps1').read_text('utf-8')
        self.assertEqual(decoded, source)

if __name__ == '__main__':
    unittest.main()
