import importlib.util
import io
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('package_plugin', ROOT / 'scripts/package-plugin.py')
package = importlib.util.module_from_spec(spec)
spec.loader.exec_module(package)


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.plugin = Path(self.tmp.name) / 'plugin'
        self.inventory = json.loads((ROOT / 'docs/skills-inventory.json').read_text())
        shutil.copytree(ROOT / self.inventory['canonical_plugin'], self.plugin)

    def test_canonical_archive_roundtrip_and_compatibility(self):
        package.validate_discovery(ROOT, self.inventory)
        files, names = package.collect(self.plugin, self.inventory)
        data = package.archive_bytes(files)
        self.assertEqual(data, package.archive_bytes(files))
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            self.assertEqual(len(names), 4)
            self.assertIn('.app.json', archive.namelist())
            self.assertNotIn('.agents/skills', archive.namelist())
            portable = json.loads(archive.read('plugin.json'))
            legacy = json.loads(archive.read('.codex-plugin/plugin.json'))
            self.assertEqual(legacy['version'], portable['version'])
            self.assertEqual(legacy['name'], portable['name'])
            self.assertEqual(legacy['author'], portable['author'])
            self.assertEqual(legacy['interface']['defaultPrompt'], portable['extensions']['com.openai']['interface']['defaultPrompt'])
            self.assertEqual(json.loads(archive.read('.mcp.json'))['mcpServers'], json.loads(archive.read('mcp.json'))['mcpServers'])

    def test_connection_changes_are_not_smuggled_into_skill_release(self):
        for file, replacement in [('mcp.json', {'mcpServers': {}}), ('.app.json', {'apps': {}})]:
            with self.subTest(file=file):
                path = self.plugin / file
                original = path.read_text()
                path.write_text(json.dumps(replacement))
                with self.assertRaises(ValueError):
                    package.collect(self.plugin, self.inventory)
                path.write_text(original)

    def test_no_external_references_or_symlink_components(self):
        skill = self.plugin / 'skills/check-commlink/SKILL.md'
        original = skill.read_text()
        skill.write_text(original + '\n[escape](../../../../private.txt)\n')
        with self.assertRaisesRegex(ValueError, 'escapes plugin'):
            package.collect(self.plugin, self.inventory)
        skill.write_text(original)
        (self.plugin / 'references/escaped.md').symlink_to(ROOT / 'README.md')
        with self.assertRaisesRegex(ValueError, 'symlinks'):
            package.collect(self.plugin, self.inventory)

    def test_missing_packaged_reference_is_rejected(self):
        (self.plugin / 'references/host-capabilities.md').unlink()
        with self.assertRaisesRegex(ValueError, 'missing reference'):
            package.collect(self.plugin, self.inventory)

    def test_invalid_yaml_or_duplicate_identity_is_rejected(self):
        path = self.plugin / 'skills/dispatch-session/SKILL.md'
        original = path.read_text()
        for replacement in ['---\nname: [invalid]\ndescription: invalid\n---\n', original.replace('name: dispatch-session', 'name: check-commlink')]:
            path.write_text(replacement)
            with self.assertRaises(ValueError):
                package.collect(self.plugin, self.inventory)

    def test_extra_source_files_do_not_enter_the_archive(self):
        (self.plugin / '.env').write_text('SYNTHETIC=not-a-real-secret\n')
        with self.assertRaisesRegex(ValueError, 'Unexpected plugin file'):
            package.collect(self.plugin, self.inventory)

    def test_discovery_aliases_must_share_canonical_source(self):
        repo = Path(self.tmp.name) / 'repo'
        canonical = repo / self.inventory['canonical_plugin']
        shutil.copytree(self.plugin, canonical)
        aliases = repo / '.agents/skills'
        aliases.mkdir(parents=True)
        for entry in self.inventory['repository_skills']:
            (aliases / entry['name']).symlink_to('../../' + self.inventory['canonical_plugin'] + '/skills/' + entry['name'])
        package.validate_discovery(repo, self.inventory)
        link = aliases / 'check-commlink'
        link.unlink()
        shutil.copytree(canonical / 'skills/check-commlink', link)
        with self.assertRaisesRegex(ValueError, 'link to canonical'):
            package.validate_discovery(repo, self.inventory)


if __name__ == '__main__':
    unittest.main()
