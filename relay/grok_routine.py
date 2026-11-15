#!/usr/bin/env python3
"""Send the content-free signal for Robut's configured Grok routine."""
import http.client
import json
import os
import stat
from pathlib import Path
from urllib.parse import urlsplit


def wake(runtime):
    # Provision this whole file as one secret, keeping the vendor URL and its key together.
    path = Path(runtime) / "grok-routine.json"
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), "r") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
            raise ValueError("routine configuration must be an owner-only regular file")
        config = json.load(handle)
    endpoint = urlsplit(config["url"])
    bearer = config["token"]
    if (endpoint.scheme != "https" or not endpoint.hostname or endpoint.username is not None
            or endpoint.password is not None or endpoint.fragment or not isinstance(bearer, str)
            or not bearer or any(ch.isspace() for ch in bearer)):
        raise ValueError("invalid routine configuration")
    target = endpoint.path or "/"
    if endpoint.query:
        target += "?" + endpoint.query
    conn = http.client.HTTPSConnection(endpoint.hostname, endpoint.port or 443, timeout=3)
    try:
        conn.request("POST", target, body=b'{"event":"commlink.wake"}',
                     headers={"Authorization": "Bearer " + bearer, "Content-Type": "application/json"})
        response = conn.getresponse()
        if response.status != 200:
            raise OSError("routine wake returned HTTP " + str(response.status))
    finally:
        conn.close()
