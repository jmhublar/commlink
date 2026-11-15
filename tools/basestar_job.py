#!/usr/bin/env python3
"""Operate only the HUB-300 launchd job for the supplied staged release."""
import argparse
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys

sys.dont_write_bytecode = True
from prepare_basestar import LABEL, NAME


def launch(*args, check=True):
    return subprocess.run(["/bin/launchctl", *args], check=check, text=True, capture_output=True)


def control(action, release):
    release = release.resolve(strict=True)
    plist = release / (LABEL + ".plist")
    config = plistlib.loads(plist.read_bytes())
    expected = str(release / "bin" / NAME)
    if config.get("Label") != LABEL or config["ProgramArguments"][0] != expected:
        raise ValueError("release plist does not identify its own HUB-300 program")
    domain = "gui/" + str(os.getuid())
    target = domain + "/" + LABEL
    installed = Path.home() / "Library" / "LaunchAgents" / plist.name
    if os.path.lexists(installed) and (not installed.is_symlink() or installed.resolve() != plist):
        raise ValueError("existing LaunchAgent belongs to a different release")
    info = launch("print", target, check=False)
    if info.returncode == 0:
        program = re.search(r"^\s*program = (.+)$", info.stdout, re.MULTILINE)
        if not program or program.group(1) != expected:
            raise ValueError("loaded job program differs from this release")
    elif "Could not find service" not in info.stderr:
        raise RuntimeError(info.stderr.strip() or "cannot inspect GUI launchd domain")

    if action == "status":
        print("loaded" if info.returncode == 0 else "unloaded", target)
        for line in info.stdout.splitlines():
            if line.strip().startswith(("state =", "pid =", "program =", "last exit code =")):
                print(line.strip())
        return
    if action == "stop":
        if info.returncode == 0:
            launch("bootout", target)
        if installed.is_symlink() and installed.resolve() == plist:
            installed.unlink()
        print("stopped", target)
        return

    env = {**os.environ, **config["EnvironmentVariables"]}
    subprocess.run([expected, "-B", str(release / "relay/basestar_relay.py"), "--check"],
                   check=True, env=env, timeout=10)
    installed.parent.mkdir(parents=True, exist_ok=True)
    created = not installed.is_symlink()
    if created:
        installed.symlink_to(plist)
    if info.returncode:
        try:
            launch("bootstrap", domain, str(installed))
        except BaseException:
            if created and installed.is_symlink() and installed.resolve() == plist:
                installed.unlink()
            raise
    print("registered", target)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["start", "stop", "status"])
    parser.add_argument("release", type=Path)
    args = parser.parse_args()
    try:
        control(args.action, args.release)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, f"job operation failed: {error}\n")
