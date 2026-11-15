# Basestar relay service

[HUB-300](https://linear.app/hublar/issue/HUB-300) is owned by the operator. CommLink runs the channel for Robut. SRE owns tailnet routing. This job exists to store and forward authenticated envelopes on basestar. The receiver that wakes a Codex chat is a separate integration.

| Job field | Value |
|---|---|
| Job / platform label | CommLinkRelay / `com.sysop.commlink.relay.HUB-300` |
| Operating-system name | `CommLinkRelay`, verified with macOS libproc in the foreground fixture |
| Executable and arguments | `RELEASE/bin/CommLinkRelay -B -u RELEASE/relay/basestar_relay.py` |
| Working directory | The absolute release directory passed to `basestar-prepare` |
| Runtime state | The private transferred runtime directory passed to `basestar-prepare`, containing relay.db and both principal token files |
| Lifetime | After successful installation, runs in the operator's GUI launchd domain across terminal exits and starts at each login. Requires an available Mac and a logged-in operator. |
| Logs | `RELEASE/logs/relay.log` and `RELEASE/logs/relay.stderr.log` |
| Children | The relay uses in-process threads. No independently persistent runtime child is intended. |
| Network | Loopback port 8780, with the separate approved tailnet service host advertising HTTPS |

Run these from the private CommLink checkout. The first line selects the release directory. The second selects the restored runtime. The parent of the release directory must already exist. Retain the exact uv Python installation from which the release is prepared.

```sh
commlink_release="$HOME/.local/share/commlink-HUB-300"
commlink_runtime="$HOME/.hub-relay"
just basestar-prepare "$commlink_release" "$commlink_runtime"
just basestar-job status "$commlink_release"
```

After verifying the live migration bundle, quiescing the source writer and confirming the tailnet route, install and verify the actual service.

```sh
just basestar-job start "$commlink_release"
just basestar-job status "$commlink_release"
curl --fail --silent --show-error --max-time 3 http://127.0.0.1:8780/healthz
```

Inspect the launchd PID, PPID, executable, macOS process name, both logs, and authenticated MCP identity before reporting the cutover. The fixture verifies the naming mechanism. It cannot attest to a future live process.

For an intentional stop, the command below compares the registered program and login item with the supplied release, boots out the owned label, and removes its login link. Restart with the same start command and repeat the live checks.

```sh
just basestar-job stop "$commlink_release"
```

Recovery after a failed cutover depends on whether basestar accepted new envelopes. If it did, quiesce it first and take a fresh verified snapshot of that mailbox before restoring a source writer. Keep one authoritative writer throughout recovery.
