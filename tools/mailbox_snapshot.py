#!/usr/bin/env python3
"""Snapshot or verify a quiesced CommLink mailbox. Never print envelope or token data."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import tempfile
from contextlib import closing


def readonly(path):
    return sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=5)


def checked_file(path, *, private=False):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise ValueError(f"expected a regular file: {path.name}")
    if private and info.st_mode & 0o077:
        raise ValueError(f"expected owner-only permissions: {path.name}")
    return path


def inventory(connection, at):
    if connection.execute("PRAGMA integrity_check").fetchall() != [("ok",)]:
        raise ValueError("mailbox integrity_check failed")
    # Hash every logical row, including acknowledged messages, tombstones and peers.
    # This also verifies that the live schema agrees with the backed-up schema.
    digest = hashlib.sha256()
    for sql in connection.iterdump():
        record = sql.encode("utf-8")
        digest.update(len(record).to_bytes(8, "big"))
        digest.update(record)
    rows = connection.execute(
        "SELECT server_seq, message_id FROM msgs "
        "WHERE acked_at IS NULL AND expires_at > ? ORDER BY server_seq", (at,)
    )
    pending = hashlib.sha256()
    count = 0
    for row in rows:
        pending.update(json.dumps(row, separators=(",", ":")).encode("utf-8") + b"\n")
        count += 1
    return {"database": digest.hexdigest(), "pending_ids": pending.hexdigest(), "pending_count": count}


def read_tokens(root):
    if (root / "tokens").is_symlink():
        raise ValueError("token directory is a symlink")
    values = {
        name: checked_file(root / "tokens" / name, private=True).read_bytes()
        for name in ("robut", "openai")
    }
    if any(not value.strip() for value in values.values()):
        raise ValueError("empty principal token")
    if values["robut"].strip() == values["openai"].strip():
        raise ValueError("principals share a token")
    return values


def manifest(root, at):
    path = checked_file(root / "relay.db", private=True)
    with closing(readonly(path)) as connection:
        connection.execute("BEGIN")
        result = inventory(connection, at)
    result["at"] = at
    result["version"] = 1
    result["tokens"] = {
        name: hashlib.sha256(value).hexdigest() for name, value in read_tokens(root).items()
    }
    return result


def verify(root, against=None):
    doc = json.loads(checked_file(root / "snapshot.json", private=True).read_text())
    observed = manifest(root, doc["at"])
    if doc != observed:
        raise ValueError("mailbox snapshot does not match its manifest")
    if against and doc != manifest(against, doc["at"]):
        raise ValueError("source and snapshot differ; keep the source authoritative")
    return doc["pending_count"]


def snapshot(source, dest):
    import time
    if dest.exists() or dest.is_symlink():
        raise ValueError("destination already exists")
    if dest.resolve().is_relative_to(source.resolve()):
        raise ValueError("destination must be outside the source runtime")
    at = time.time()
    expected = manifest(source, at)
    staging = Path(tempfile.mkdtemp(dir=dest.parent, prefix=".commlink-snapshot-"))
    try:
        with closing(readonly(source / "relay.db")) as src:
            with closing(sqlite3.connect(staging / "relay.db")) as dst:
                src.backup(dst)
        os.chmod(staging / "relay.db", 0o600)
        (staging / "tokens").mkdir(mode=0o700)
        for name, value in read_tokens(source).items():
            (staging / "tokens" / name).write_bytes(value)
        (staging / "snapshot.json").write_text(json.dumps(expected, sort_keys=True) + "\n")
        count = verify(staging, source)
        # Reserve a new empty destination atomically. Concurrent writers cannot replace it.
        dest.mkdir(mode=0o700)
        try:
            staging.replace(dest)
        except BaseException:
            dest.rmdir()
            raise
        return count
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    create = sub.add_parser("create", help="run after quiescing the source writer and supervisor")
    create.add_argument("source", type=Path)
    create.add_argument("destination", type=Path)
    check = sub.add_parser("verify", help="verify a transferred snapshot and optionally compare its source")
    check.add_argument("snapshot", type=Path)
    check.add_argument("--against", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "create":
            count = snapshot(args.source, args.destination)
        else:
            count = verify(args.snapshot, args.against)
    except (OSError, ValueError, KeyError, sqlite3.DatabaseError) as error:
        parser.exit(1, f"snapshot check failed: {error}\n")
    print(f"Verified complete database, both principal credentials and {count} pending envelope(s).")


if __name__ == "__main__":
    main()
