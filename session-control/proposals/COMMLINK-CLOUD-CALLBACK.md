# Cloud child to owning dot through CommLink — evaluated proposal

This is a design and test plan, not a deployed tool, credential grant, live
subscription or standing authorization. Runtime source is unchanged by it.

## Direct evidence

Joshua directed “Have it send via the commlink,” suggested another tool, then
specified existing openai authentication plus a job/session ID and status.
The current implementation branch is `codex/hub-300-completion-contract`, based
on callback-contract commit `e425c7588b10e437d9477a9fdc5ba6bcfca6e4b1`.

The existing cloud task **CommLink callback test**, ID
`6afa7af9-b4b0-8191-85ff-e4c046e1d01e`, completed its original turn
`01a1e270-68af-717a-a27c-16146648b292` without an explicit parent callback:
thread_management.send_message was unavailable. The owning dot recovered the
result on a scheduled check; a platform terminal push was not observed before
that check. Parent-child registration is not callback delivery evidence.

Under Joshua's new instruction, a read-only follow-up in the same task
(`01a1e274-da6d-7438-9755-8f1da6397171`) inspected actual tool definitions. It
called mcp__codex_apps__commlink_link_status once successfully and reported
self=openai. No credentials were read, copied, displayed or injected into a
prompt. No messages were sent, polled or acknowledged by the child.

Its available CommLink tools were link_status, poll, ack, send and the native
subscribe/update helpers. It reported no session/completion tools or supported
parent-message tool. It also reported shell tools and Cloudflare API execution
tool availability; those were not exercised. Therefore environment variables,
HTTP secrets or OIDC being unset does **not** prove absence of inherited Apps
capabilities. Tool availability is not approval for arbitrary use, nor proof of
usable write access. Do not mark broad executor isolation verified from this.

The server's prior authenticated tools/list returned 13 operations; the child's
catalog exposed only the four mailbox tools plus two host helpers. This is a
discovery/exposure gap, possibly cache or filtering, not evidence that new
server tools automatically appear in children. The App's catalog must be
rescanned/rechecked after an authorized release, preserving its connection.

The self=openai label alone does not identify the exact signed principal. A
second read-only follow-up (`01a1e27a-18bd-74b3-8e69-8779fccafe50`) requested
only a Boolean comparison against the owning dot's nonsecret, principal-scoped
subscription ID. At preparation time the provider marked the turn completed but
returned no transcript items; the comparison result is unverified. Inspect that
turn before another attempt. Do not infer a match from the peer label.

## Recommended route

    Existing cloud child
      -> existing authenticated CommLink connector
      -> job_report_status({job_id, status})
      -> durable, job-bound hint and delivery outbox
      -> commlink.job.status_reported native MCP event
      -> existing owning dot
      -> provider read for exact task and turn
      -> existing correlated result reporting to Robut

Use the already functioning connector. No raw HTTP client, environment secret,
new service identity, token, OAuth registration, network allowlist or VPN change
is needed for this route. A new tool does not need to borrow Robut's credentials.
Do not use Cloudflare administrative API tools as a child callback transport.

Ordinary send is unsuitable for direct openai-to-dot signaling: deployed
protocol validation rejects from==to. Keep that invariant. Do not impersonate
Robut, fabricate a mailbox message, or emit message.created for a job update.
Add a truthful completion event and a narrowly scoped hint tool instead.

## Proposed tool and server authorization

Logical MCP name: job_report_status. The closed input contract is
[job-report-status.v1.schema.json](job-report-status.v1.schema.json).
Inputs are exactly job_id (registered UUID) and status (finished | failed).
These are untrusted terminal-status claims. V1 does not accept arbitrary text,
results, artifacts, recipient, owner thread, callback URL, credential, policy,
executor selector or launch flag. Progress/attention reporting can be a separate
version rather than silently changing this one-shot contract.

The server must first load a pre-recorded, owner-authorized job and check:

1. Existing Access JWT verification and explicit identity mapping still succeed.
   Sender must be openai and match the job's allowed existing principal key.
   Return generic refusal for absent, expired, unauthorized or foreign jobs.
2. Server-side binding provides owner principal, existing owning thread,
   correlation, originating request if present, provider task ID, immutable turn
   ID, expiry and receipt reference. A job_id supplied by the child cannot create
   or change this record, authorize work or choose its callback destination.
3. Registration comes from a genuine trusted owner/control path. Do not expose a
   registration or activation shortcut to every same-identity child. A Boolean
   copied from fixtures or a job's own repository write is not approval.
4. Record the first hint and its deterministic native event ID atomically. An
   identical repeated report returns duplicate and never rings again. A changed
   status under the same one-shot job is a conflict, not a replacement event.
5. Late reports after provider reconciliation return an already-reconciled
   receipt without another wake. Expiry and revoked bindings fail closed.

For a fast child that reports before task/turn binding is saved, retain a pending
hint, but deliver only after the owning coordinator binds the actual provider
IDs. An ambiguous creation remains reserved and requires reconciliation; never
invent a task ID or launch again. A pending hint is not a successful wake.

Source session admission currently remains inactive. The minimal callback-only
pilot can pre-record the already existing callback-test task/turn under Joshua's
exact direct approval without activating standing jobs. That registration must
still be a trusted server record, not arbitrary caller arguments. A general
production registration/owner-approval mechanism remains an implementation gate.

Same OAuth identity is **not job isolation**: another task sharing it could
report a known allowed job ID. Treat the authenticated source as the existing
OpenAI principal, not a cryptographically identified individual child. Binding,
expiry, one-shot dedup and provider verification limit this to a wake hint; they
do not solve process isolation. Never mark a job terminal, release a reservation,
launch another job, or forward claimed results based on this tool alone. Strong
per-task identity would need a separately supported host assertion or a separately
approved capability model. Neither is assumed here.

## Native event and delivery

Proposed event: commlink.job.status_reported. Filter by the fixed owning thread;
authorization also binds the subscription to the recorded owner principal.
Event payload contains server-derived job_id, correlation_id, task_id, turn_id,
owner_thread_id and claimed_status only. No raw result or job instructions.

Use the existing signed webhook/VPC gateway path, origin/address validation and
retry rules. Add a dedicated job-hint outbox rather than weakening the current
message outbox's expiry/ack checks. Preserve event IDs across retries. Delivery
must stop on expired/revoked subscriptions and use bounded attempts. Keep the
existing message-created watch unchanged. The additional event watch must be
created in the existing owning dot; never in this worker or another dot.
One owner-filtered completion watch can cover registered jobs; do not create a
new native subscription for each child. This is separate from the inbox watch.

The root records this source distinctly as a CommLink status hint, not platform
push or verified direct-child messaging. It reads the exact provider task/turn,
checks actual outcome, and uses the existing terminal ledger/outbox only where
the genuine job authorization applies. A directly approved pilot must retain its
own provenance; do not fabricate a Robut request to force it through admission.
HTTP receipt, signed callback acceptance, actual root wake, provider completion,
Robut mailbox acceptance and Robut acknowledgment are separate evidence gates.
The source CompletionRecovery prototype currently recognizes explicit_child,
platform_push and scheduled_recovery. Add a distinct commlink_hint source and
commlink_tool callback mode during implementation; do not mislabel this new
transport to force it through the existing three-source contract.

## Implementation and test sequence

1. Recover the principal-comparison result; do not resend an uncertain audit.
2. Implement the closed tool, trusted job registry binding and dedicated native
   event/outbox with default-off registration. Isolated tests cover same/foreign
   identity, unknown job, extra fields, expiry, early hint, restart/duplicate,
   conflicting status, replay after terminal, callback retry and no reply loop.
3. Review the exact code and callback-only pilot record. Obtain action-time
   approval for its deployment and the specifically scoped root-native watch.
   Standing execution remains inactive. No new credential or network setting is
   part of this proposal; do not add one merely to refresh discovery.
4. Rescan the existing App's server catalog and verify the existing child can
   actually discover job_report_status. Recheck authentication and owner binding.
5. Reuse **CommLink callback test** for one authorized callback-only follow-up;
   no new cloud task is necessary. Permit one call with the approved job_id and
   terminal hint, then finish. Keep other tools/actions prohibited.
   Give this transport probe a distinct registered callback-test ID/correlation
   bound to the existing provider task/turn. Do not pretend it is another job
   execution or a replay of an already reconciled lifecycle report. This tests
   the callback route; a fresh end-to-end delegated-job test remains separate.
6. End the owning dot's foreground turn before the hint is delivered. Preserve
   bounded root recovery, but distinguish it from the expected CommLink event.
   Verify the native event, actual root resumption and independent provider read.
7. Separately test an identical retry produces no extra native event, and a
   wrong/expired job produces none. Report any scheduler fallback honestly.
   Only an explicitly authorized correlated result goes to Robut; no ack echo.

No deployment, credential/configuration change, App rescan, new subscription,
cloud task creation or child callback was performed for this evaluation. Two
read-only follow-up turns ran in the existing task; their results are audit
evidence, not wake acceptance.

## Official product evidence and alternatives

- [MCP Events](https://developers.openai.com/plugins/build/mcp-events): supports
  signed webhook events into the subscribed dot, with separate receipt and
  asynchronous processing. Rescan changed tool/event catalogs and verify the
  full subscription/delivery lifecycle.
- [MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli): hosted
  plugins and local client configuration are different surfaces. A desktop tool
  or local config file is not evidence of child availability.
- [Cloud environment service access](https://learn.chatgpt.com/docs/environments/cloud-environments):
  proxy-injected HTTP secrets are an alternative for HTTPS services, but are
  unnecessary here because the authenticated connector already works. Do not add
  them or widen network access for this route.
- [Hooks](https://learn.chatgpt.com/docs/hooks): cloud-managed hooks have a
  narrower Enterprise/workflow scope; personal accounts do not use those global
  enterprise hooks. Do not install a local Stop hook and assume cloud delivery.
- [Agents API session webhooks](https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks):
  a supported API-executor option, separate from the subscription-funded Codex
  Cloud task already tested. It would require distinct integration/credentials
  and cost approval; idle still requires checking the actual turn outcome.
