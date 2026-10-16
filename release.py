#!/usr/bin/env python3
"""Sets the version of a Cockpit release.

Usage: python3 release.py <version> [--dry-run]

The cockpit bundle always takes <version>. Every mod that changed since the last release tag
(cockpit-v*) takes it too, so a mod's version is the release where it last changed. A mod left
unchanged keeps its version. Without a release tag, every mod takes <version>.

Claude Code delivers a plugin update only when the version string in its plugin.json changes, so a
mod changed without a new version never reaches people who already installed it. This script is the
step that prevents that. It edits the plugin.json files, copies each plugin's description into the
marketplace manifest so the two never disagree, and prints the git commands to commit and tag; it
commits nothing itself.
"""
import json, os, re, subprocess, sys

SEMVER = re.compile(r'^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$')
HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = 'cockpit'


def git(*args):
    return subprocess.run(['git', '-C', HERE, *args], capture_output=True, text=True)


def mods():
    return sorted(d for d in os.listdir(HERE) if os.path.isfile(os.path.join(HERE, d, '.claude-plugin', 'plugin.json')))


def last_tag():
    r = git('describe', '--tags', '--abbrev=0', '--match', 'cockpit-v*')
    return r.stdout.strip() if r.returncode == 0 else None


def changed(mod, tag):
    if tag is None:
        return True
    # Committed and uncommitted changes since the tag, untracked files included.
    diff = git('diff', '--name-only', tag, '--', mod).stdout.strip()
    new = git('ls-files', '--others', '--exclude-standard', '--', mod).stdout.strip()
    return diff != '' or new != ''


def set_version(mod, version):
    path = os.path.join(HERE, mod, '.claude-plugin', 'plugin.json')
    text = open(path).read()
    old = json.loads(text)['version']
    if old == version:
        return old
    new_text, n = re.subn(r'("version"\s*:\s*")[^"]*(")', lambda m: m.group(1) + version + m.group(2), text, count=1)
    if n != 1:
        sys.exit(f'{path}: no version field')
    open(path, 'w').write(new_text)
    return old


def sync_manifest():
    path = os.path.join(HERE, '.claude-plugin', 'marketplace.json')
    m = json.load(open(path))
    for p in m['plugins']:
        p['description'] = json.load(open(os.path.join(HERE, p['name'], '.claude-plugin', 'plugin.json')))['description']
    with open(path, 'w') as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write('\n')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    dry = '--dry-run' in sys.argv
    if len(args) != 1 or not SEMVER.match(args[0]):
        sys.exit('usage: python3 release.py <version> [--dry-run]   (version like 1.0.0 or 1.1.0-beta.2)')
    version = args[0]
    tag = last_tag()
    print(f'last release: {tag or "none, so every mod takes the new version"}')
    bumped, kept = [], []
    for mod in mods():
        if mod == BUNDLE or changed(mod, tag):
            old = json.load(open(os.path.join(HERE, mod, '.claude-plugin', 'plugin.json')))['version']
            if not dry:
                set_version(mod, version)
            bumped.append(f'{mod} {old} -> {version}')
        else:
            kept.append(mod)
    print('\n'.join(f'  {b}' for b in bumped))
    if kept:
        print(f'unchanged: {", ".join(kept)}')
    if not dry:
        sync_manifest()
        print(f'\nnext:\n  git add -A && git commit -m "Cockpit {version}"\n  git tag cockpit-v{version} && git push && git push --tags')


main()
