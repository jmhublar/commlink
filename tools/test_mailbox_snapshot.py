#!/usr/bin/env python3
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


class MailboxSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        root = Path(self.directory.name)
        self.source, self.dest = root / "source", root / "dest"
        self.source.mkdir(mode=0o700)
        (self.source / "tokens").mkdir(mode=0o700)
        for name in ("robut", "openai"):
            token = self.source / "tokens" / name
            token.touch(mode=0o600)
            token.write_text("fixture-" + name)
        db = self.source / "relay.db"
        db.touch(mode=0o600)
        self.writer = sqlite3.connect(db)
        self.addCleanup(self.writer.close)
        self.writer.execute("PRAGMA journal_mode=WAL")
        self.writer.execute("PRAGMA wal_autocheckpoint=0")
        self.writer.execute("CREATE TABLE msgs(server_seq INTEGER PRIMARY KEY, message_id TEXT, acked_at REAL, expires_at REAL)")
        self.writer.execute("INSERT INTO msgs VALUES (1, 'pending', NULL, ?), (2, 'acked', 1, ?), (3, 'expired', NULL, 1)", (time.time()+600, time.time()+600))
        self.writer.commit()

    def run_tool(self, *args):
        return subprocess.run([sys.executable, str(Path(__file__).with_name("mailbox_snapshot.py")), *map(str, args)], text=True, capture_output=True)

    def test_preserves_wal_and_detects_source_or_transfer_drift(self):
        result = self.run_tool("create", self.source, self.dest)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("1 pending envelope", result.stdout)
        for path in (self.dest / "tokens/robut", self.dest / "tokens/openai", self.dest / "relay.db", self.dest / "snapshot.json"):
            self.assertEqual(path.stat().st_mode & 0o077, 0)
        self.assertEqual(self.run_tool("verify", self.dest, "--against", self.source).returncode, 0)
        self.assertNotEqual(self.run_tool("create", self.source, self.dest).returncode, 0)
        self.writer.execute("UPDATE msgs SET acked_at=5 WHERE message_id='pending'")
        self.writer.commit()
        self.assertNotEqual(self.run_tool("verify", self.dest, "--against", self.source).returncode, 0)
        (self.dest / "tokens/robut").write_text("changed")
        result = self.run_tool("verify", self.dest)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("fixture-robut", result.stdout + result.stderr)

    def test_refuses_missing_or_exposed_credentials(self):
        token = self.source / "tokens/robut"
        token.chmod(0o644)
        self.assertNotEqual(self.run_tool("create", self.source, self.dest).returncode, 0)
        token.unlink()
        self.assertNotEqual(self.run_tool("create", self.source, self.dest).returncode, 0)
        self.assertFalse(self.dest.exists())


if __name__ == "__main__":
    unittest.main()
