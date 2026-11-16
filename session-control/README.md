# Roles and tiers: source prototype

This is an isolated implementation of the HUB-300 session-control proposal. It
does not launch Codex or activate standing permissions. One dot, Joshua's
existing owning thread, is the only intended coordinator. Grok maps pstack onto
the roles/tier wire contract; this package does not install a pstack harness.

## Shipped safety state

`policies/standing.v1.json` is **inactive**, with no rules. The compiled
`inactiveSessionConfiguration` is paused, has no activation receipt, coordinator
identity keys or verified executor profiles. There is no activation/revocation
MCP tool, request field, environment override or database setter. Replacing a
policy file, a commit or a third-party comment is not owner approval.

The `SessionConfiguration` interface is a trusted operator snapshot boundary,
not a verifier of human approval. Its active examples occur only in isolated
test fixtures. A future release must establish actual direct-Joshua approval
provenance for the exact policy hash, immutable source/release ownership,
coordinator identity, executor profile, receipt expiry and activation scope.
Do not turn a fixture's `owner_receipt_verified` flag into a production approval
mechanism. That approval/control-plane path requires review before activation.

There is no cloud credentials handler, `fetch`, provider launcher, polling loop,
watcher, cancellation, retry-reset or privilege-changing action in the control
module. Plugin version 0.3.0 and the original coordinator tools were released;
the next 0.4.0 completion-contract source is not installed or deployed here.

## Menu and wire contract

The canonical source is `roles-tiers.v1.json`. Coder/reviewer/investigator use
Sol6.1; architect uses Astra; writer uses Terra6.1; utility uses Luna. Defaults
and operation profiles are explicit in the file. Light/standard/deep/extra map
to low/medium/high/xhigh. Max/Ultra and free-form model overrides are not v1
choices. Speed is `default`, with unknown effective speed; fast is rejected.

Four Draft2020-12 schemas are in `schemas/`. The runtime validator additionally
rejects duplicate JSON keys, invalid Unicode, oversized/deep input and unsupported
controls. Objects are closed. The documented role default and nullable repository
are the only normalizations. The optional repository is `{name, revision}` with
an exact 40-hex commit, not a branch or arbitrary fetch URL. Context references
must match that repository revision or the request's Linear issue.

Use protocol1.0 MSG, robut→openai, payload content_type `application/json`,
issue_id matching body.linear_issue, and body JSON encoded once. A request must
carry the current menu version/hash and expected policy hash. Validation never
executes a prompt. Unknown values do not select a different model, speed,
environment, workdir or deadline mode. See `fixtures/request.v1.json` for an
inactive-policy golden example; never send fixture IDs to the live mailbox.

Session digests are `SHA256(domain + LF + canonicalJSON)`:

- menu: `commlink.menu.v1`
- policy: `commlink.policy.v1`
- execution controls (menu, coordinator keys and profiles): `commlink.control.v1`

Canonical JSON uses UTF-16 property sorting and ECMAScript JSON serialization,
with well-formed Unicode and safe integers only. It is the bounded RFC8785 JCS
domain used by these schemas, not the old mailbox localeCompare serializer.
The original mailbox envelope uses `commlink.session.envelope.v1` with the
mailbox's existing canonical serializer, since accepted envelope metadata may
contain fractional numbers outside the bounded request/JCS domain. Domain
changes, menu/default changes and wire changes require explicit version
or digest updates and interop review.

## Tools and durable state

`session_capabilities` and `session_validate` are read-only. They report schema
support separately from runtime evidence. `session_status` is scoped to the
authenticated requester; the configured owning coordinator may also inspect it.
Authentication still uses the existing signed Access assertion and explicit
identity mapping. An openai peer label alone is not coordinator authorization.

Coordinator-only tools:

1. `session_receive(request_message_id)` loads an actual persisted Robut MSG,
   validates sender/type/issue/expiry and records a durable decision plus status
   outbox. The caller cannot inject an envelope, activation or policy. It does
   not ack or execute. A repeated ID returns the same state; a changed envelope
   under that ID is an idempotency conflict.
2. Eligible admission reserves one global session slot synchronously. A paused,
   inactive, unapproved, stale or unverified policy/profile returns no launch.
   Busy and rate-limited work is held, with no automatic release/re-admission.
3. `session_prepare_launch(request_message_id, expected_version)` rechecks the
   trusted snapshot, policy/menu/control hashes, original activation epoch and
   receipt/rule references, profile, expiry and rolling
   launch limit. It atomically consumes one attempt and writes `launch_pending`
   with a fence before returning launch data **once**.
4. The dot may then use its separate supported cloud task tool only within the
   genuine standing grant. The prepared target/model/thinking are explicit;
   the server never calls the provider. Recheck capabilities immediately before
   the external call. There is no provider-side atomic policy/cancellation or
   idempotency enforcement here: the prepare→provider revocation window is an
   outstanding activation/acceptance concern, not a solved exactly-once claim.
5. `session_transition` records coordinator-observed created/running/terminal
   provider evidence using expected version and fence. Creation is not running.
   A definitive not-created response may fail and release a slot; timeouts and
   generic errors are uncertain and retain it. These are coordinator attestations,
   not cryptographically authenticated provider receipts.
6. `session_recovery` returns an active phase, fence and known ID after restart,
   never another launch permit. Unknown launches cannot be automatically reset.
7. `session_outbox` returns stable lifecycle MSG envelopes. The dot sends them
   unchanged through existing `send`, then calls `session_outbox_mark_sent`.
   Marking requires the exact accepted mailbox copy. Robut's later `ack` remains
   recipient receipt, distinct from outbox acceptance. No ACK/completion echo.

SQLite tables are created additively in the existing Mailbox Durable Object.
No schema migration is deployed by a local build. State, reservations, consumed
launch budget and outbox survive restart. There is one active slot, including
pending/uncertain launches; lease expiry does not release it. Default policy
proposes two attempts per rolling hour, with a hard implementation maximum ten.
Total ledger/backlog caps fail closed. Compact tombstones are retained; no
automatic purge permits replay. Explicit maintenance/reconciliation is required
at capacity. Status envelope TTL is one day; expired unsent reporting is a
blocker, not permission to redo a job.

Public result schemas are bounded and closed, with an additional total 16KiB
UTF-8 limit so a completed result cannot overflow its mailbox status envelope.
Artifacts require canonical HTTPS
URLs under approved path prefixes ending in `/`, no query, fragment, userinfo
or traversal. Credential markers are rejected as a defense in depth; this is
not a general-purpose secret detector. The dot must curate summaries rather than
copy raw logs, credentials, signed URLs or hidden reasoning into results.

## Activation gates and operational limits

Fresh direct user approval remains required where applicable for credentials,
access, deployments, merges, purchases, network/security and policy/control
changes. A standing job category cannot override this floor. Jobs receive only
enforced operation profiles and no privileged credentials; prompt instructions
alone do not establish read-only or repository isolation.

Before enabling any routine job, verify the selected model/effort and runnable
environment, exact repository/ref boundary, permissions, artifact prefixes and a
completion/recheck wake back to the same dot. Current cloud creation has no
speed, cwd or hard-timeout parameter. Hard budgets are held without verified
hard timeout support. Soft budgets require explicit policy consent and are not
spend caps; this module does not terminate a provider task at their expiry.
The coordinator must report an overrun while retaining the active slot.

Native subscription renewal, cloud completion wake, unknown-launch reconciliation
and the owner-approval control plane have separate acceptance scopes. A root-bound
one-time scheduled recovery has now been reported working after the owning dot's
foreground turn ended; immediate provider push and full Grok lifecycle delivery
remain unverified. Basestar
remains in the existing callback ingress path. No new dot, watcher, connection,
account, service identity or network route is created here.

## Completion wake and reporting

The [completion contract](../cloudflare/plugin/commlink-prototype/references/completion-contract.md)
now requires a persisted verified owning-root destination and bounded saved
recovery plan before preparing any launch. The trusted snapshot's optional
completion_owner_thread_id is included in the control digest; absence fails
closed. Existing approvals must not be reused across the changed control digest.
New session_completion_register/bind/signal/observe/recovery tools distinguish
explicit child callbacks, declared platform push and actual scheduled recovery.
Task, turn, request and correlation bindings survive restart. Signals are hints;
only a provider observation of the bound task/turn can make a terminal transition.
The source neither creates a scheduler nor independently attests host readback.
It makes no task, network, scheduling or callback calls on its own.

The source plugin's `report-session-completion` skill reconciles an existing job
and drains the durable status outbox to Robut. It does not create an event or
keep running after the dot ends its turn. Always inspect the outbox even when
`session_recovery` has no active jobs: terminal work can still have an unsent
report. Delivery preserves the original request/correlation and status-envelope
ID across crashes. Mailbox acceptance is separate from Robut acknowledgment.

The supervised SysOp probe on 2026-11-16 completed through `wait_threads` with
no recorded tool calls. It did not prove unattended owning-dot wake, and it had
no originating Robut request to which a lifecycle receipt could be attached.
The existing CommLink native event is mailbox-message-created, not Codex-completed.

The [scheduled-task guide](https://learn.chatgpt.com/docs/automations#schedule-a-task-inside-a-chat)
documents a return to an existing chat. Connected heartbeat tooling also exposes
a thread destination. A separately approved same-chat scheduled recheck is a
concrete completion-recovery option, with polling delay rather than immediate
delivery. The connected hosted automation tool limits recurring checks to hourly
or slower; do not promise minute polling from documentation alone. Verify the
actual saved target is the existing owning dot, and inspect its run evidence.
Do not modify the existing event-only CommLink watch or silently install a schedule.

A bounded native recheck attempt from the delegated CommLink worker demonstrated
that hosted creation binds to the calling chat. It was paused after its incorrect
target was detected; a worker-bound invocation subsequently fired and is not
owning-dot proof. The parent independently created a root-bound one-time recheck
that fired after the owning dot's foreground turn ended and verified the completed
COMMLINK_PILOT_OK probe. A source/parent thread link alone is not that proof.
See [the maintained skill inventory](../docs/skills.md) for source/install status.

Immediate provider-originated completion wake remains a separate integration
gate. A skill, app notification, read_thread lookup or foreground wait is not
proof of that event. A bounded native scheduled return can be tested against the
already completed probe without launching another worker or sending live mail.

## Validation and review

`just prototype-check` runs type checking/build and all Worker tests. The session
tests independently validate the JSON Schemas with development-only Ajv, test
parsing/hash vectors and scope controls, exercise real SQLite restart/races,
and use workerd for both the shipped default-deny surface and a separately
appended synthetic coordinator fixture. Fixture assertions prevent external
network requests. That fixture is absent from `dist/worker.js` and has no deploy
selector. It never starts a cloud job.

Before live release, obtain independent review of the exact source head and
coordinate actual owning-dot tool/permission checks in the original thread.
Source tests do not claim installed plugin tools, activated permission, cloud
entitlement, actual execution or production wake behavior.
