# HUB-300 Comlink relay — build notes (2026-10-13)

Code: `relay/relay.py` (MCP Streamable HTTP, stdlib only, SQLite WAL 0600), `relay/doorbell_listener.py` (tcp:8443),
`relay/supervisor.sh` (watchdog-style 30 s loop), `relay/selftest.py`.
State: `~/.hub-relay/` (0700): `relay.db`, `tokens/{robut,openai}` (0600, never printed), `doorbells.json` (static, anti-SSRF), logs (headers only).

## Current endpoint (checked 2026-10-17 ~6:57 AM ET)
- **This box:** MagicDNS `robut-1.tailbde0eb.ts.net`, Tailscale IP `100.112.121.84`, tags `tag:commlink`. Relay healthz OK on that IP:8780.
  The box was rebuilt ~4:37 AM ET Oct 17; the root-owned `tailscaled.state` did not survive the file copy, so `tailscale up` registered a NEW node.
  The restore script now restores identity from the box-owned mirror `~/.tailscale/tailscaled.state.mirror` (kept current by the watchdog).
- **Fallback mode (live):** `http://robut-1.tailbde0eb.ts.net:8780/mcp` (bound to current `tailscale ip -4`; the supervisor rebinds automatically if that IP changes; WireGuard-encrypted; spec §2.1 permits, less preferred).
- **Stale peer:** `robut.tailbde0eb.ts.net` (`100.108.105.16`) is the pre-rebuild registration, offline since ~4:09 AM ET Oct 17; its key is gone and it cannot come back. To return to the name `robut`: in the admin console delete that device, then rename `robut-1` to `robut` (and optionally set its IPv4 to `100.108.105.16`). After that, use `robut.tailbde0eb.ts.net` everywhere below.
- **Preferred (BLOCKED):** `https://robut-1.tailbde0eb.ts.net/mcp` (`robut` after the rename) via `tailscale serve` — Serve is not enabled on the tailnet. Enable at the URL `tailscale serve` prints, then restart supervisor with `HUB_RELAY_MODE=serve`.
- Never Funnel.

## Auth
Behind plain tailnet IP / serve, tagged-node identity headers are not reliable (spec §2.2(b)), so **bearer token is required**; token → principal (`robut`/`openai`); envelope `from` must match or `auth_mismatch`.

## Codex config (VM: ~/.codex/config.toml)
```toml
[mcp_servers.comlink]
url = "http://robut-1.tailbde0eb.ts.net:8780/mcp"   # robut.tailbde0eb.ts.net after the rename; https://<name>.tailbde0eb.ts.net/mcp once Serve is enabled
bearer_token_env_var = "COMLINK_RELAY_TOKEN"
startup_timeout_sec = 20
tool_timeout_sec = 10
```
(Older Codex builds also need top-level `experimental_use_rmcp_client = true`.)

## VM runbook
1. `curl -fsSL https://tailscale.com/install.sh | sh`
2. `sudo tailscale up --auth-key="$TAILSCALE_AUTHKEY_COMLINK" --advertise-tags=tag:openai-agent --hostname=openai-agent` (key injected from 1Password, e.g. `op run`; never pasted into files). Then `tailscale status` shows `robut-1` (or `robut` after the rename).
3. Install Codex (`npm i -g @openai/codex`), add the config above.
4. Export the `openai` relay token (handed over out-of-band via 1Password, not chat/email): `export COMLINK_RELAY_TOKEN=...`
5. Reachability: `curl -s http://robut-1.tailbde0eb.ts.net:8780/healthz` → `{"ok": true}`.
6. `codex mcp list` → `comlink` listed; in Codex ask it to call `comlink.link_status`.
7. Optional doorbell: run `doorbell_listener.py` on the VM with `DOORBELL_BIND=<vm tailnet ip> DOORBELL_ALLOW_SRC=100.112.121.84` (the box's current tailnet IP; `100.108.105.16` if it is moved back); then on the box add `"openai":"http://<vm-ip>:8443/doorbell"` to `~/.hub-relay/doorbells.json`.

## Joint cross-device test (do with Joshua)
1. Box: send WAKE to openai (e.g. adapt `selftest.py`, robut side only).
2. VM/Codex: `poll{since:0}` → sees WAKE; `ack`; `send` ACK (`from:"openai"`, `ack_of`=WAKE id, same correlation_id).
3. Box: doorbell file `~/.hub-relay/doorbell.robut` updates; poll → ACK; send ACK2.
4. VM: poll → ACK2. Both ESTABLISHED. `link_status` on both sides shows last_poll_at for each.

## Grant change needed (for Joshua to approve — NOT applied)
Box is `tag:commlink` and also hosts the relay (spec assumed separate `tag:hub-relay`).
```jsonc
"tagOwners": { "tag:openai-agent": ["autogroup:admin"] },
"grants": [
  { "src": ["tag:openai-agent"], "dst": ["tag:commlink"], "ip": ["tcp:443", "tcp:8780"] }, // MCP (serve / fallback)
  { "src": ["tag:commlink"],     "dst": ["tag:openai-agent"], "ip": ["tcp:8443"] }        // doorbell to VM
]
```
Plus: enable Serve/HTTPS in admin console; tagged pre-auth key for `tag:openai-agent` into 1Password; disable key expiry for tagged nodes.
Note: spec proposes doorbell port 8787; this build uses 8443 per Robut's instruction.
