#!/usr/bin/env python3
"""Validate/package canonical CommLink skills locally; no host or network actions."""
import argparse
from copy import deepcopy
import hashlib
import io
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit
import zipfile

import yaml

REPO = Path(__file__).resolve().parents[1]
SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/'
NAME = re.compile(r'^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$')
VERSION = re.compile(r'^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def json_bytes(value):
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + '\n').encode()


def skill_metadata(data, path):
    text = data.decode('utf-8')
    require(len(data) <= 1024 * 1024, f'{path}: skill exceeds 1 MiB')
    match = re.match(r'\A---\r?\n(.*?)\r?\n---(?:\r?\n|$)', text, re.S)
    require(match is not None, f'{path}: missing YAML frontmatter')
    meta = yaml.safe_load(match[1])
    require(isinstance(meta, dict), f'{path}: frontmatter must be a mapping')
    for key in ('name', 'description'):
        require(isinstance(meta.get(key), str) and bool(meta[key].strip()), f'{path}: invalid {key}')
    require(NAME.fullmatch(meta['name']) and '--' not in meta['name'] and '..' not in meta['name'], f'{path}: invalid skill name')
    require(meta['name'] == Path(path).parent.name, f'{path}: name must match folder')
    return meta


def validate_links(root, files):
    """Packaged Markdown references must resolve within the plugin, not the repo."""
    for path, data in files.items():
        if not path.endswith('.md'):
            continue
        for target in re.findall(r'\[[^\]]*\]\(([^\s)]+)\)', data.decode('utf-8')):
            target = target.strip('<>')
            parts = urlsplit(target)
            if parts.scheme:
                require(parts.scheme == 'https', f'{path}: unsupported reference scheme')
                continue
            require(not parts.netloc, f'{path}: network-path reference')
            if not parts.path:
                continue
            relative = unquote(parts.path)
            require(not Path(relative).is_absolute(), f'{path}: absolute reference')
            resolved = (root / path).parent.joinpath(relative).resolve()
            require(resolved.is_relative_to(root), f'{path}: reference escapes plugin')
            require(resolved.is_file(), f'{path}: missing reference {target}')
            require(resolved.relative_to(root).as_posix() in files, f'{path}: reference not packaged')


def validate_discovery(repo, inventory):
    root = repo / inventory['canonical_plugin'] / 'skills'
    aliases = repo / '.agents' / 'skills'
    expected = {entry['name'] for entry in inventory['repository_skills']}
    require(aliases.is_dir(), 'Missing repository skill discovery directory')
    require({p.name for p in aliases.iterdir()} == expected, 'Repository discovery inventory mismatch')
    for name in expected:
        link = aliases / name
        require(link.is_symlink(), f'{name}: discovery must link to canonical source')
        require(not Path(link.readlink()).is_absolute(), f'{name}: discovery link must be relative')
        require(link.resolve(strict=True) == (root / name).resolve(strict=True), f'{name}: wrong discovery target')


def collect(plugin, inventory):
    root = plugin.resolve(strict=True)
    files = {}
    for path in sorted(root.rglob('*')):
        require(not path.is_symlink(), 'Canonical plugin must not contain symlinks')
        if path.is_dir():
            continue
        name = path.relative_to(root).as_posix()
        top = Path(name).parts[0]
        require(top in {'plugin.json', 'mcp.json', '.app.json', 'skills', 'references'}, f'Unexpected plugin file: {name}')
        require(path.is_file(), f'Non-file component: {name}')
        files[name] = path.read_bytes()
    require(sum(map(len, files.values())) <= 5 * 1024 * 1024, 'Plugin exceeds local 5 MiB packaging bound')
    manifest = json.loads(files['plugin.json'])
    require(manifest.get('$schema') == SCHEMA + 'plugin.schema.json', 'Wrong plugin schema')
    require(manifest.get('name') == 'commlink-prototype', 'Plugin identity changed')
    require(VERSION.fullmatch(manifest.get('version', '')) is not None, 'Invalid plugin version')
    require(manifest['version'] == inventory['source_version'], 'Inventory version mismatch')
    interface = manifest['extensions']['com.openai']['interface']
    require(manifest['extensions']['com.openai']['apps'] == './.app.json', 'App reference path changed')
    for key in ('displayName', 'shortDescription', 'longDescription', 'developerName'):
        require(isinstance(interface.get(key), str) and bool(interface[key].strip()), f'Invalid interface {key}')
    require(isinstance(interface.get('capabilities'), list) and all(isinstance(x, str) and x.strip() for x in interface['capabilities']), 'Invalid interface capabilities')
    require(interface.get('defaultPrompt') == 'Check my CommLink inbox and report pending messages.', 'Default prompt changed')
    app = json.loads(files['.app.json'])
    mcp = json.loads(files['mcp.json'])
    require(app == inventory['preserved_connection']['app'], 'Existing App identity changed')
    require(mcp == inventory['preserved_connection']['mcp'], 'Existing MCP/OAuth configuration changed')
    require(mcp.get('$schema') == SCHEMA + 'mcp.schema.json', 'Wrong MCP schema')
    names = []
    for path, data in files.items():
        if path.startswith('skills/') and path.endswith('/SKILL.md'):
            require(len(Path(path).parts) == 3, 'Portable skill is nested too deeply')
            names.append(skill_metadata(data, path)['name'])
    expected = {entry['name'] for entry in inventory['repository_skills']}
    require(len(names) == len(set(names)) and set(names) == expected, 'Portable skill inventory mismatch')
    validate_links(root, files)
    # Retained legacy account-plugin components must agree with portable source.
    # Derive them in the artifact rather than maintaining duplicate source files.
    legacy = {key: deepcopy(manifest[key]) for key in ('name', 'version', 'description', 'author', 'keywords') if key in manifest}
    legacy.update(interface=deepcopy(interface), apps='./.app.json', skills='./skills', mcpServers='./.mcp.json')
    legacy['interface'].setdefault('category', 'Other')
    files['.codex-plugin/plugin.json'] = json_bytes(legacy)
    files['.mcp.json'] = json_bytes({'mcpServers': mcp['mcpServers']})
    return files, sorted(names)


def archive_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data)
    result = stream.getvalue()
    with zipfile.ZipFile(io.BytesIO(result)) as archive:
        require(set(archive.namelist()) == set(files), 'Archive component mismatch')
        require(archive.testzip() is None, 'Archive integrity failure')
        for name in archive.namelist():
            require(archive.read(name) == files[name], f'Archive content mismatch: {name}')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, help='Write a new ZIP outside the plugin; existing files are never overwritten')
    args = parser.parse_args()
    inventory = json.loads((REPO / 'docs/skills-inventory.json').read_text())
    validate_discovery(REPO, inventory)
    plugin = REPO / inventory['canonical_plugin']
    files, names = collect(plugin, inventory)
    data = archive_bytes(files)
    if args.output:
        destination = args.output.resolve()
        require(not destination.is_relative_to(plugin.resolve()), 'Archive must be outside the plugin')
        with destination.open('xb') as output:
            output.write(data)
    print(json.dumps({'version': inventory['source_version'], 'skills': names, 'files': len(files),
                      'sha256': hashlib.sha256(data).hexdigest(), 'output': str(args.output) if args.output else None}))


if __name__ == '__main__':
    main()
