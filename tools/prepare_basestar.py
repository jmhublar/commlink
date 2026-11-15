#!/usr/bin/env python3
"""Prepare a private macOS launchd release for the existing CommLink relay."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import sys
from tempfile import TemporaryDirectory

LABEL = "com.sysop.commlink.relay.HUB-300"
NAME = "CommLinkRelay"


def prepare(destination, runtime):
    if sys.platform != "darwin":
        raise ValueError("basestar launchd release requires macOS")
    destination = destination.parent.resolve() / destination.name
    runtime = runtime.resolve()
    if destination.resolve().is_relative_to(runtime) or runtime.is_relative_to(destination.resolve()):
        raise ValueError("release and private runtime must be separate directories")
    if destination.exists() or destination.is_symlink():
        raise ValueError("release destination already exists")
    source = Path(__file__).resolve().parents[1] / "relay"
    interpreter = Path(sys.executable).resolve()
    library = Path(sys.base_prefix) / "lib"
    with TemporaryDirectory(prefix=".commlink-build-", dir=destination.parent) as staging:
        stage = Path(staging) / "release"
        (stage / "bin").mkdir(parents=True, mode=0o700)
        (stage / "logs").mkdir(mode=0o700)
        (stage / "relay").mkdir(mode=0o700)
        for filename in ("relay.py", "grok_routine.py", "basestar_relay.py"):
            shutil.copyfile(source / filename, stage / "relay" / filename)
        # The uv macOS interpreter links libpython relative to its executable.
        # A real executable copy gives libproc the service name; a symlink to Python does not.
        shutil.copy2(interpreter, stage / "bin" / NAME)
        (stage / "lib").symlink_to(library, target_is_directory=True)
        program = str(destination / "bin" / NAME)
        plist = {
            "Label": LABEL,
            "ProgramArguments": [program, "-B", "-u", str(destination / "relay/basestar_relay.py")],
            "WorkingDirectory": str(destination),
            "RunAtLoad": True,
            "KeepAlive": {"SuccessfulExit": False},
            "ThrottleInterval": 30,
            "Umask": 0o077,
            "EnvironmentVariables": {"PYTHONHOME": sys.base_prefix, "HUB_RELAY_HOME": str(runtime),
                                     "HUB_RELAY_BIND": "127.0.0.1", "HUB_RELAY_PORT": "8780"},
            "StandardOutPath": str(destination / "logs/relay.log"),
            "StandardErrorPath": str(destination / "logs/relay.stderr.log"),
        }
        (stage / (LABEL + ".plist")).write_bytes(plistlib.dumps(plist))
        destination.mkdir(mode=0o700)
        try:
            stage.replace(destination)
        except BaseException:
            destination.rmdir()
            raise
    return destination / (LABEL + ".plist")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("release", type=Path)
    parser.add_argument("runtime", type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(prepare(args.release, args.runtime))
    except (OSError, ValueError) as error:
        parser.exit(1, f"release preparation failed: {error}\n")
