#!/usr/bin/env python3
"""Exercise the staged launchd program in the foreground using fixture state."""
import ctypes
import json
import os
from pathlib import Path
import plistlib
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.request

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "relay"))
import relay
import basestar_job
from prepare_basestar import LABEL, NAME, prepare


class NativeRelayTest(unittest.TestCase):
    def test_refuses_foreign_job_and_recovers_failed_bootstrap(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            release = root / "release"
            prepare(release, root / "state")
            missing = subprocess.CompletedProcess([], 113, "", "Could not find service")
            foreign = subprocess.CompletedProcess([], 0, " program = /some/other/program\n", "")
            link = root / "Library/LaunchAgents" / (LABEL + ".plist")
            with patch.object(Path, "home", return_value=root), patch.object(basestar_job, "launch") as invoke:
                invoke.return_value = foreign
                with self.assertRaises(ValueError):
                    basestar_job.control("stop", release)
                self.assertEqual(invoke.call_count, 1)
                invoke.reset_mock()
                invoke.side_effect = [missing, subprocess.CalledProcessError(5, "launchctl")]
                # The preflight invocation is exercised separately with the actual native entrypoint.
                with patch("basestar_job.subprocess.run"), self.assertRaises(subprocess.CalledProcessError):
                    basestar_job.control("start", release)
                self.assertFalse(link.is_symlink())

    def test_launch_identity_health_and_missing_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / "state"
            plist = plistlib.loads(prepare(root / "release", runtime).read_bytes())
            self.assertEqual(plist["Label"], LABEL)
            env = {**os.environ, **plist["EnvironmentVariables"]}
            args = plist["ProgramArguments"]
            missing = subprocess.run(args, env=env, capture_output=True, timeout=8)
            self.assertNotEqual(missing.returncode, 0)
            self.assertFalse(runtime.exists())
            runtime.mkdir(mode=0o700)
            (runtime / "tokens").mkdir(mode=0o700)
            for name in ("robut", "openai"):
                path = runtime / "tokens" / name
                path.touch(mode=0o600)
                path.write_text("fixture-" + name)
            relay.HOME, relay.DB = str(runtime), str(runtime / "relay.db")
            relay.init_db()
            with socket.socket() as free:
                free.bind(("127.0.0.1", 0))
                port = free.getsockname()[1]
            env["HUB_RELAY_PORT"] = str(port)
            url = f"http://127.0.0.1:{port}"
            with subprocess.Popen(args, cwd=plist["WorkingDirectory"], env=env,
                                  stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True) as proc:
                try:
                    deadline = time.monotonic() + 7
                    while time.monotonic() < deadline and proc.poll() is None:
                        try:
                            with urllib.request.urlopen(url + "/healthz", timeout=1) as response:
                                self.assertEqual(json.load(response), {"ok": True})
                            break
                        except (ConnectionError, urllib.error.URLError):
                            time.sleep(0.05)
                    else:
                        self.fail("staged relay failed to become healthy")
                    libproc = ctypes.CDLL("/usr/lib/libproc.dylib")
                    observed = ctypes.create_string_buffer(256)
                    self.assertGreater(libproc.proc_name(proc.pid, observed, len(observed)), 0)
                    self.assertEqual(observed.value.decode(), NAME)
                    path_buffer = ctypes.create_string_buffer(4096)
                    self.assertGreater(libproc.proc_pidpath(proc.pid, path_buffer, len(path_buffer)), 0)
                    self.assertEqual(Path(os.fsdecode(path_buffer.value)).resolve(), Path(args[0]).resolve())
                    request = urllib.request.Request(
                        url + "/mcp", method="POST", data=json.dumps({"jsonrpc":"2.0","id":1,"method":"tools/call",
                        "params":{"name":"link_status","arguments":{}}}).encode(),
                        headers={"Authorization":"Bearer fixture-openai","Content-Type":"application/json"})
                    with urllib.request.urlopen(request, timeout=2) as response:
                        self.assertEqual(json.load(response)["result"]["structuredContent"]["self"], "openai")
                    print(f"Verified process {NAME}, PID {proc.pid}, native executable, loopback health and MCP identity")
                finally:
                    proc.terminate()
                    try:
                        proc.wait(timeout=3)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.wait(timeout=3)


if __name__ == "__main__":
    unittest.main()
