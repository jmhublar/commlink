#!/usr/bin/env python3
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "relay"))
import grok_routine


class GrokWakeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / "grok-routine.json"
        self.file.touch(mode=0o600)
        self.file.write_text('{"url":"https://routine.example/007","token":"fixture"}')

    @patch("grok_routine.http.client.HTTPSConnection")
    def test_fixed_signal_and_no_redirect(self, connect):
        connection = connect.return_value
        connection.getresponse.return_value.status = 200
        grok_routine.wake(self.directory.name)
        connect.assert_called_once_with("routine.example", 443, timeout=3)
        connection.request.assert_called_once_with(
            "POST", "/007", body=b'{"event":"commlink.wake"}',
            headers={"Authorization": "Bearer fixture", "Content-Type": "application/json"})
        connection.getresponse.return_value.status = 302
        with self.assertRaises(OSError):
            grok_routine.wake(self.directory.name)
        self.assertEqual(connection.request.call_count, 2)
        self.assertEqual(connection.close.call_count, 2)

    @patch("grok_routine.http.client.HTTPSConnection")
    def test_refuses_readable_or_insecure_configuration(self, connect):
        self.file.chmod(0o644)
        with self.assertRaises(ValueError):
            grok_routine.wake(self.directory.name)
        self.file.chmod(0o600)
        self.file.write_text('{"url":"http://routine.example/007","token":"fixture"}')
        with self.assertRaises(ValueError):
            grok_routine.wake(self.directory.name)
        connect.assert_not_called()


if __name__ == "__main__":
    unittest.main()
