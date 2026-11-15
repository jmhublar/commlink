#!/usr/bin/env python3
"""Run the upstream test on two ephemeral loopback ports with fixture-only state."""
import contextlib
import json
import os
from pathlib import Path
import runpy
import secrets
import sys
import tempfile
import threading
from http.server import ThreadingHTTPServer
from unittest.mock import patch


sys.dont_write_bytecode = True
source = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(source / "relay"))
import doorbell_listener
import relay

@contextlib.contextmanager
def listening(handler):
    with ThreadingHTTPServer(("127.0.0.1", 0), handler) as server:
        thread = threading.Thread(target=server.serve_forever)
        thread.start()
        try:
            yield f"http://127.0.0.1:{server.server_port}"
        finally:
            server.shutdown()
            thread.join()

with tempfile.TemporaryDirectory(prefix="hub300-fixture-") as temporary:
    fixture = Path(temporary)
    (fixture / "tokens").mkdir(mode=0o700)
    for name in ("robut", "openai"):
        token = fixture / "tokens" / name
        token.touch(mode=0o600)
        token.write_text(secrets.token_hex(32))
    relay.HOME = doorbell_listener.HOME = str(fixture)
    relay.DB = str(fixture / "relay.db")
    relay.init_db()
    with listening(doorbell_listener.H) as bell, listening(relay.H) as endpoint:
        (fixture / "doorbells.json").write_text(json.dumps({"robut": bell + "/doorbell"}))
        expand = os.path.expanduser
        def fixture_path(path):
            return str(fixture) if path == "~/.hub-relay" else expand(path)
        with patch.object(os.path, "expanduser", side_effect=fixture_path), patch.object(sys, "argv", ["selftest.py", endpoint + "/mcp"]):
            runpy.run_path(str(source / "relay/selftest.py"), run_name="__main__")
