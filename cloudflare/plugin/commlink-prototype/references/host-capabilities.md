# Host capability boundary

Observed during the 2026-11-16 source inventory. Discover actual tools again on
each host; MCP aliases can include a host prefix. Wire operation names below are
logical names, not permission to invent a missing tool.

| Surface | Available/implemented | Boundary |
| --- | --- | --- |
| Live CommLink | link_status, poll, ack, send | OAuth principal-scoped mailbox; send stores, ack marks receipt |
| Native mailbox events | subscribe_to_events, update_subscription | message-created only; create with run_in_current_thread=true from owning dot |
| Server lease renewal | No explicit host renewal argument | Verify link_status expiry; metadata update does not attest renewal |
| Source coordinator | session_capabilities, session_validate, session_status, session_receive, session_prepare_launch, session_transition, session_recovery, session_outbox, session_outbox_mark_sent | Implemented/tested in this repo; absent from the current connected live tool list |
| Cloud execution | list_cloud_environments, create_thread, read_thread, wait_threads | create_thread has model/thinking and environment ID; no speed, hard timeout, completion callback or idempotency field |
| Hosted scheduled return | create/peek/update task automation | Creation binds to calling thread; no target-thread override; recurring checks hourly or slower |
| Desktop heartbeat | automation_update has heartbeat/thread target | Schema support alone does not verify delivery to a cloud owning dot |

The installed CommLink helper plugin is version 0.1.2 and contains only
check-commlink. This repo's package is 0.3.0 with four skills. The separate
App-backed CommLink connection is version 1.0.0 and contains no skills. Preserve
that App connection, identities, OAuth/MCP configuration and audience; adding
skills does not require a new server or identity.

One supervised SysOp cloud probe completed through wait_threads. Its UI displayed
GPT-6.1 Sol / Medium with defaults; effective backend settings were not separately
attested. The root owning dot subsequently reported that its one-time scheduled
recovery fired after its foreground turn ended and verified the same probe.
Scheduled recovery is proven at that scope, not immediate provider push or live
Grok lifecycle delivery. A worker-bound invocation is not owning-dot evidence.

The standing configuration remains inactive, paused and without coordinator
keys, activation receipt or verified executor profiles. Source-control text,
skill selection, an issue comment or a child's message alone grants no authority.

References:
[Scheduled returns](https://learn.chatgpt.com/docs/automations#schedule-a-task-inside-a-chat),
[repo skill discovery and symlinks](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).
