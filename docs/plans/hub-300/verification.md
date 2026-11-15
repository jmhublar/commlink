# Basestar bridge verification

[HUB-300](https://linear.app/hublar/issue/HUB-300). Observed on 2026-11-15. These are private implementation notes.

## Codex wake

The owner confirmed that the dot created its dedicated CommLink chat. The desktop reported a local working directory on the connected Mac, host ID `durable`, chat ID `6af95640-2960-8191-bd45-e21727a8b019`, and an idle baseline after the completed “CommLink ready” turn.

The desktop chat connector delivered the fixed synthetic notice to this host and chat ID. Turn `01a1ddfa-df7f-707d-a430-2d21b29775a6` started and completed after 104 seconds. It reported an unavailable relay and missing bearer in its session. No live envelope was acknowledged. The dot-owned chat later reported this result via task completion and requested a fresh challenge from its parent. A parent-authored challenge requires separate observation.

The installed Codex CLI 0.164.0 and the desktop-bundled 0.169.0-alpha.11.1 both failed at `thread/queue/add` with no rollout for that UUID. The bundled app server resolved a known local Codex thread in a positive-control read and could not find the dot-owned chat. The desktop connector was available in this interactive implementation chat. No supported stand-alone dispatch to this durable host has been demonstrated.

## Relay and migration

The service health URL, the documented private backend and a trusted-host, noninteractive SSH probe timed out from basestar. Tailscale listed the Grok node as online, and a direct tailnet ping timed out. These observations do not distinguish ACLs from host sleep or a network fault. Basestar had a user identity, no tags and no Serve configuration. The existing service name requires a tagged advertiser and host approval. Keep the existing Mac identity intact until an appropriately scoped service identity is provisioned.

`just relay-selftest` returned ALL PASS using temporary SQLite, synthetic principal tokens and loopback-only ephemeral ports. The upstream test exercised auth, sender and recipient checks, duplicate delivery, WAKE/ACK/ACK2, and a real local doorbell. Its printed port label is hardcoded. This test did not use the production mailbox or a remote Grok client.

`just snapshot-check` covered SQLite WAL, owner-only credentials, pending-message IDs, changed source data, changed copied credentials, and refusing an existing destination. For migration, first identify and quiesce the actual old writer, supervisor and shell bootstrap that can relaunch it. Run `just mailbox-snapshot SOURCE NEW_BUNDLE`, transfer the whole private bundle over a trusted encrypted operator path, and verify it at both ends using `just mailbox-verify BUNDLE` and `just mailbox-verify BUNDLE --against SOURCE` at the source before cutover. Compare the SHA-256 of snapshot.json over an independent trusted channel to establish that the received manifest matches the source. The bundle contains live credentials. Supply them only to their intended consumers.

## Grok routine

The optional server-side doorbell entry `{"robut":"grok-routine"}` selects a native Grok webhook. Provision its current HTTPS URL and bearer in an owner-only `grok-routine.json` in the private relay runtime, using fields `url` and `token`. The HTTPS request body is always `{"event":"commlink.wake"}`. The routine polls the authenticated mailbox as robut after waking. A vendor HTTP 200 confirms wake acceptance. Confirm the actual routine run and its correlated reply separately. Existing URL-based doorbells can still use the tailnet listener.

The local Codex entry `comlink` uses Streamable HTTP and refers to `COMLINK_RELAY_TOKEN`. Supply the openai principal token to the actual client runtime that consumes it. A successful `codex mcp get comlink` verifies local configuration only.

## Outstanding live acceptance

- Establish unattended dispatch to the chosen dot-accessible chat and verify a completed turn after an actual doorbell.
- Quiesce and transfer the live state, verify the private service route and both authenticated principals, then start and verify the purpose-named jobs.
- Run all three peer-originated challenges and the missed-bell, duplicate and receiver-restart cases with the two independent participants. Record the dot's observed response separately.

## Basestar release

Staged the native relay release under `~/.local/share/commlink-HUB-300`. The generated launchd plist passed `plutil -lint`. Its actual GUI job status after staging was unloaded. No login item was enrolled. The foreground `just basestar-check` fixture verified the native process name `CommLinkRelay` with libproc, its resolved executable, a healthy loopback HTTP response and authenticated openai MCP identity. It stopped and reaped the exact fixture process. It also verified failure to start without a migrated mailbox, refusal to stop an unrelated program, and removal of a newly created login link after a failed bootstrap. Job ownership, start, stop and recovery are in [the relay runbook](relay-job.md).
