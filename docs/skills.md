# CommLink skills and host support

Canonical skill source lives in `cloudflare/plugin/commlink-prototype/skills/`.
The repository's `.agents/skills/` entries are relative symlinks to that source,
so repo discovery and the portable plugin use the same instructions. They are
not user-global installs. See the [official discovery/symlink rules](https://learn.chatgpt.com/docs/build-skills#where-codex-loads-local-skills).

| Skill | Work owned by the existing dot | Released helper 0.3.0 | Source package 0.5.0 |
| --- | --- | --- | --- |
| [check-commlink](../cloudflare/plugin/commlink-prototype/skills/check-commlink/SKILL.md) | Mailbox recovery, native message events, owner/lease checks | Present | Preserved |
| [dispatch-session](../cloudflare/plugin/commlink-prototype/skills/dispatch-session/SKILL.md) | Validate/admit role-tier request, fenced handoff with required completion route | Present | Callback/recovery gate added; policy inactive |
| [report-session-completion](../cloudflare/plugin/commlink-prototype/skills/report-session-completion/SKILL.md) | Bound task/turn provider evidence, correlated terminal outbox to Robut | Present | Distinct signal sources and reconciliation |
| [watch-session-completion](../cloudflare/plugin/commlink-prototype/skills/watch-session-completion/SKILL.md) | Root-owned bounded recovery, ownership and stop rule | Present | Durable plan, finite checks and attention |

The original pre-release inventory is recorded in [skills-inventory.json](skills-inventory.json).
The private USER-scoped helper was subsequently released as 0.3.0 with all four
skills, release `pluginrel_6afa6e9d29c081918fd148831873ef4d`. The 0.5.0 changes
are source-only. Generated legacy compatibility files accompany the portable
manifest. The separate App-backed CommLink connection is version 1.0.0, has no
skills and owns the existing MCP/OAuth connection. It is not a missing duplicate
skill package. Neither live plugin is changed by this source work.

The user-level agent-bus skill and SysOp agent-bus-reply plugin were inspected.
They use a different NATS bridge, identities and at-most-once pull semantics.
They remain SysOp-owned; copying them as active CommLink skills would introduce
a second transport and conflicting wake behavior. Generic Linear, Cloudflare
and skill-authoring tools remain external development dependencies, not CommLink
runtime skills to duplicate.

## Actual capability boundary

[Packaged host guidance](../cloudflare/plugin/commlink-prototype/references/host-capabilities.md)
is shared by all four skills. Live mailbox tools are link_status, poll, ack and
send, with native message-created subscription helpers. The nine session_*
operations were released in Worker version ef66d78d-9cc7-43cd-9101-bb621ecd8947.
The five new completion-contract tools remain source-only. Installing instruction
files cannot deploy server changes. job_report_status and the separate native
commlink.job.status_reported event are also source-only. They reuse existing
authentication and pre-recorded job bindings; status claims are untrusted hints.
See [the job hint contract](../cloudflare/plugin/commlink-prototype/references/job-status-hints.md)
and the packaged
[completion contract](../cloudflare/plugin/commlink-prototype/references/completion-contract.md).
The policy remains inactive/paused with no activation receipt or coordinator keys.

The host subscription-update schema has no explicit lease-renewal argument.
Metadata updates and watch reuse must not be reported as a renewed server lease
without expiry readback. Subscription ownership and OAuth principal are separate.
Use current-thread native subscriptions from the owning dot, not a worker chat.

Hosted scheduled-task creation binds to its caller. A worker-bound test was
paused after its incorrect target was detected, and a worker-bound invocation
later fired; it is not owning-dot evidence. The parent independently created a
root-bound one-time recheck. It **did fire after the owning dot's foreground
turn ended**, reread the completed probe and verified COMMLINK_PILOT_OK. This
proves scheduled recovery at that scope. It does not prove immediate provider
push, ongoing recurrence or terminal delivery/acknowledgment by Grok.

The supervised cloud probe completed in 3.457 seconds without recorded tool calls.
Its UI displayed default GPT-6.1 Sol / Medium; effective backend settings were not
independently exposed. The current SysOp environment contains SysOp and commlink
on main, with package-manager domains allowed. This is broader than the original
repository-free/no-egress proposal and does not silently replace its grant.

## Source discovery and packaging

Run `just plugin-check` to validate skill YAML, canonical discovery links, packaged
references, connection preservation and generated compatibility metadata. Run
`just plugin-package /tmp/commlink-plugin-0.5.0.zip` to produce a review artifact;
the builder performs no install, API request, publication or deployment.
Python 3 and the pinned development dependency in `scripts/requirements-plugin.txt`
are required. Do not install anything automatically from a skill workflow.

The archive contains the four canonical skills, their references, hidden App
reference, portable manifests and derived legacy compatibility files. The latter
are generated from the portable source, not separately maintained copies. The
existing MCP descriptor is preserved alongside the App dependency, matching the
installed helper. No new endpoint, credential, identity or connection is created.

Codex can show a repo skill and an older installed namespaced skill simultaneously;
it does not merge same-name skills. Use the explicit repo source during authoring.
A reviewed plugin update is the future cutover, not another user-global copy.
This task neither removes the installed helper nor changes host configuration.

## Remaining live gates

Publish/install only the separately approved package; deploy and refresh the
session tools separately; establish real owner-approved policy/control provenance;
verify executor scope and exact repository revisions; authorize any continuing
same-dot recheck and its reporting recipient/stop rule. Then prove an actual
registered Robut request reaches terminal status, the dot sends its original
correlated outbox envelope, Robut acknowledges it, and no reply loop follows.
Source and isolated-test success do not establish those live gates.
