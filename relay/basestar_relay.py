#!/usr/bin/env python3
"""launchd entrypoint; refuse to initialize an empty production mailbox."""
import os
from pathlib import Path
import runpy
import sqlite3
import stat
import sys
from contextlib import closing


def existing_runtime():
    runtime = Path(os.environ["HUB_RELAY_HOME"])
    for path in (runtime, runtime / "tokens", runtime / "relay.db",
                 runtime / "tokens/robut", runtime / "tokens/openai"):
        info = path.lstat()
        expected = stat.S_ISDIR if path in (runtime, runtime / "tokens") else stat.S_ISREG
        if not expected(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError(f"invalid owner, type or permissions: {path.name}")
    tokens = [(runtime / "tokens" / name).read_bytes().strip() for name in ("robut", "openai")]
    if not all(tokens) or tokens[0] == tokens[1]:
        raise ValueError("invalid principal tokens")
    with closing(sqlite3.connect((runtime / "relay.db").resolve().as_uri() + "?mode=ro", uri=True)) as db:
        for table in ("msgs", "peers", "tomb"):
            if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)).fetchone():
                raise ValueError("incomplete mailbox schema")


if __name__ == "__main__":
    os.umask(0o077)
    existing_runtime()
    if sys.argv[1:] == ["--check"]:
        raise SystemExit(0)
    if sys.argv[1:]:
        raise SystemExit("unknown relay option")
    runpy.run_module("relay", run_name="__main__")
