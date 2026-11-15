#!/usr/bin/env python3
"""Doorbell listener (tcp:8443). Responds 204 immediately; body is NOT a message, only a hint to poll.
Writes a timestamp to $HUB_RELAY_HOME/doorbell.<mailbox> so the local poller wakes. Body capped at 1 KB."""
import os, json, time, sys
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
HOME = os.environ.get("HUB_RELAY_HOME", os.path.expanduser("~/.hub-relay"))
BIND = os.environ.get("DOORBELL_BIND", "127.0.0.1"); PORT = int(os.environ.get("DOORBELL_PORT", "8443"))
ALLOW = set(os.environ.get("DOORBELL_ALLOW_SRC", "127.0.0.1").split(","))  # relay's address(es) only
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        if self.path != "/doorbell" or self.client_address[0] not in ALLOW:
            self.send_response(403); self.end_headers(); return
        n = int(self.headers.get("Content-Length", "0"))
        if n > 1024: self.send_response(413); self.end_headers(); return
        try: mb = json.loads(self.rfile.read(n)).get("mailbox", "")
        except Exception: mb = ""
        self.send_response(204); self.end_headers()
        if mb in ("robut", "openai"):
            open(os.path.join(HOME, "doorbell." + mb), "w").write(str(time.time()))
            print(time.strftime("%FT%TZ", time.gmtime()), "doorbell", mb, flush=True)
if __name__ == "__main__":
    ThreadingHTTPServer((BIND, PORT), H).serve_forever()
