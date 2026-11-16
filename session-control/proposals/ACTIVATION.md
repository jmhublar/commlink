# Minimal live activation proposal — not approved

This directory is a review artifact. Nothing imports its policy into the Worker.
`standing.pilot.v1.json` shows the exact **prospective active policy**, so its
approval digest can be stable. Its `state: active` does not activate anything.
The shipped `policies/standing.v1.json` and compiled configuration remain inactive,
paused, without coordinator keys, executor profiles or activation receipt.

Implementation base: `bcde6bc97dbaddcfa3d25a338bfa3be31a49750f`.
Read-only observations: `cloud-evidence.v1.json`. Catalog and tool availability
can change; recheck before any separately approved action.

Candidate policy digest (`commlink.policy.v1`):
`adfddc70f6ed8955b7bd220a5ebaa49162e5937c575ddaed432df416053580a3`.
Menu digest (`commlink.menu.v1`):
`3f8b72b01a7c440d710a9696252b7b095916fa3f0433ad22b777307029d291e9`.
Both use the canonicalization in `session-policy.ts`. The final control digest,
coordinator key, environment revision, owner receipt and release do not yet
exist as an approved activation packet; they must not be invented.

## Smallest useful scope

Start with one repository-free `utility/light` job: model `gpt-6-luna`, reasoning
`low`, speed `default`, null workdir, no context references, issue `HUB-300`,
environment alias `cloud_pilot`, at most five minutes **soft** budget. An initial
test can transform the public literal `commlink pilot` to uppercase and return
the result in its final response. No repository, secrets, plugins, connected
accounts, network destinations or external artifacts are needed by that job.

The policy permits one concurrent session and one launch attempt per rolling
hour. A proposed owner receipt should expire **no later than one hour after
approval**, with admission beginning after that approval. Together these limits
allow at most one launch attempt within that grant. The policy alone is not a
one-job-total or daily budget; a longer-lived or renewed grant changes the scope.
Do not renew automatically. Invalid, held or unlaunched requests get no authority.

This is a category grant, not an exact-message grant: the current schema cannot
pin a message ID, job digest, input classification or output length. A role label
does not enforce the meaning of arbitrary job text. The runtime must enforce the
`transform.bounded` boundary: disposable scratch writes only, no repository or
private data, no account/MCP capabilities and no outbound actions. If those
restrictions cannot be evidenced, hold the job. Any broader job category requires
a separately reviewed policy and verified executor profile.

`pilot-request.v1.json` is the proposed request body for that literal test, not
a live message. It has no envelope/message ID and must not be sent before the
applicable separate approval and gate checks.

## What is verified, and what is not

Connected tools expose `create_thread` with a `codexCloud` target plus `model`
and `thinking`. The complete environment catalog lists one unique runnable
configuration, `asenvcfg_base` (Default environment), with no repositories. Two
duplicate catalog rows identify that same configuration. SysOp and feed_forge
are not runnable. Empty repositories do not establish absence of credentials,
network access, personal connections or inherited tools. No current tool exposes
the complete saved security configuration or its immutable revision.

The connected creation schema has no speed, cwd, commit-pinning, network,
permission-profile, tool-allowlist, hard-timeout, idempotency or completion-callback
field. A default model must not replace requested Luna; unsupported low effort
must not silently select another effort. The [official Luna model page](https://developers.openai.com/api/docs/models/gpt-6-luna)
documents low effort for the API, but does not prove this account's cloud-task
entitlement. No cloud execution was launched in this investigation.

The [current cloud environment guide](https://learn.chatgpt.com/docs/environments/cloud-environments)
documents separate task workspaces, environment security configuration and
repository-free tasks. It also allows repositories to be added later and account
connections to supply service access. Therefore a repo-free catalog row is not
a verified least-privilege profile. Inspect the actual environment configuration,
including personal values, internet policy, VPN, cloud identities and available
connections, before assigning `permissions_verified: true`. No settings were
changed, and the environment setup tools are not read-only audit tools.

`read_thread` and a zero-timeout `wait_threads` lookup resolved the existing
owning-thread reference and returned idle status. That proves read/snapshot
availability only. A bounded wait is not a durable completion subscription.
No connected tool exposes a general Codex task-completion event subscription.
Do not mark `completion_wake_verified` from this observation.

CommLink's existing authenticated mailbox has one subscription, observed expiry
`2026-11-16T01:46:43.504Z`, and reachable VPC transport. Past callback acceptance
and the previously observed nonce exchange remain distinct from cloud completion.
The owning dot must verify renewal in its own thread before the current expiry;
this proposal creates or renews no subscription.

## Required activation sequence

1. **Review source while inactive.** Preserve base tests/review, review this
   candidate and the eventual control-plane changes. No push, merge, deployment,
   plugin update or policy activation is authorized by this document.
2. **Audit a cloud environment read-only.** Prefer the existing default only if
   its actual configuration can be verified against the above boundary. Otherwise
   prepare a concrete dedicated private configuration for separate approval;
   do not modify the general default merely to fit this pilot. Bind the alias to
   a real runnable ID and a trustworthy configuration revision. Drift must hold
   launches; hashing local profile assertions does not attest remote settings.
3. **Get separate approval for one supervised acceptance launch.** Keep standing
   policy inactive. The owning dot uses the approved exact model/environment and
   observes the real returned ID, effective settings where available, result and
   errors with read/wait tools. Check that ambiguous creation never causes retry.
   A supervised test supplies runtime evidence without pretending it proves
   unattended completion wake. Lack of an auditable environment blocks even this
   test's readiness; do not ask approval for an unexamined security boundary.
4. **Verify a durable completion/recheck path to the same dot.** It must survive
   the dot ending its turn and must deliver result/attention signals without
   manual prompting. Test known-ID reconciliation and subscription renewal. A
   child's self-reported completion message alone is not authoritative terminal
   evidence; the dot retrieves the provider state. No watcher, SMS, alternate dot
   or new schedule is implicitly authorized. If no existing supported mechanism
   can meet this gate, keep the policy inactive.
5. **Implement the trusted approval/release boundary.** Present Joshua the exact
   active policy digest, menu digest, finalized control digest, owning coordinator
   identity, receipt epoch/expiry, source/release digest and environment evidence.
   Record his actual direct approval in a trusted owner-controlled receipt, bound
   to all of them. Verify that provenance before building the runtime snapshot;
   never copy `owner_receipt_verified: true` from test fixtures. Keep the approval
   record/control root outside job-writable storage, and deny jobs deployment or
   policy credentials. No activation or policy-write MCP tool is needed.
6. **Obtain action-time release approval and deploy the exact artifact.** The
   inactive implementation has no production activation provider; this is still
   required source work. A reviewed immutable operator snapshot plus a trusted
   owner-gated deployment is a possible small implementation, but the current
   Boolean configuration interface is not itself that verifier. Confirm installed
   tools and owning-thread access with the parent. Admission and launch must check
   the approved policy/menu/control digests, original epoch and receipt expiry.
7. **Admit one fresh Robut request under the short grant.** Do not reuse a held
   request or replay the old hello-world request. Observe accepted, actual launch,
   running/terminal evidence, outbox acceptance and Robut ack separately. Never
   echo an ack or completion. Retain unknown-launch reservations; expiry does not
   clear them. The grant expires rather than widening automatically.

## Ownership and revocation

The current repository contains no CODEOWNERS file. A read of main-branch
protection returned GitHub HTTP403 with a plan/visibility restriction. Enforced
owner review was not verified. Do not make the repo public, purchase a plan or
assume branch protection exists. Source control can hold the proposal and audit
references, but cannot be the sole authority. A minimal alternative is an
owner-controlled immutable release/approval boundary outside job write access;
its implementation and operational ownership require review.

Coordinator keys bind an authenticated principal, not cryptographic conversation
affinity. The existing owning dot is the sole coordinator operationally; no
current session field proves a request came from that particular thread. An
accepted release must state and enforce the host-side thread-affinity boundary
or treat its absence as a blocker.

Prepare is durable and fenced; the provider call is a separate action. Recheck
receipt expiry, pause, digests, epoch and actual profile just before creation.
Revocation can still occur between that check and provider acceptance. Receipt
expiry/pause stops subsequent admissions and intents, but does not cancel a
created task. A deploy-based pause also has propagation latency. No current
connected tool guarantees cancellation, atomic revocation or a hard five-minute
deadline. The owner must explicitly accept this residual race and soft-budget
overrun, or require an executor broker with enforceable controls before activation.
Uncertain results retain the slot and require reconciliation; never retry creation.

## If the app cannot supply the missing controls

The [Agents API architecture](https://developers.openai.com/api/docs/guides/agents-api/architecture)
documents managed cloud sessions with events. It is a different executor adapter,
not an undocumented option on the connected desktop task tool. The
[hosted-sandbox guide](https://developers.openai.com/api/docs/guides/agents-api/environments/openai-hosted)
supports explicit disabled egress and separate workspaces; egress defaults to
enabled unless inherited, so it must be set deliberately.
[Session webhooks](https://developers.openai.com/api/docs/guides/agents-api/sessions/webhooks)
can signal idle, failed and action-required states. Idle does not prove success;
retrieve the last turn and inspect its outcome. A verified receiver could enqueue
a completion notice through CommLink's existing wake path, scoped to known jobs.

This documented route could close several gaps but is **not the smallest
already-authorized change**: it needs account entitlement verification, API
credentials, API/container billing consent, a signed webhook receiver, a new
executor adapter and exact deployment/security approvals. No API key was read or
created, no billing changed and no event subscription configured here. Do not
silently substitute this route for a subscription-funded cloud task.

## Precise approval packets (templates, not requests made now)

**Supervised test, after environment audit:**
“Approve exactly one supervised Codex Cloud task from the existing owning dot,
using environment [audited exact ID/revision], model gpt-6-luna, thinking low,
default speed, no repo/connections/secrets/outbound access. Transform the public
literal `commlink pilot` to uppercase and return the result. Five minutes is a
soft target, not a hard stop or spend cap. No substitutions or creation retries.
Standing permissions remain inactive.”

**Activation, after all gates and source work:**
“Approve activating policy [exact digest] with menu [exact digest], control
[final exact digest], coordinator [verified principal and existing thread],
release [exact artifact], receipt [epoch and absolute expiry at most one hour
from approval], under the verified cloud_pilot profile. Scope is only the
utility/light HUB-300 repo-free bounded transform category, explicitly using
gpt-6-luna with thinking low for each eligible new task: one active session,
one attempt per rolling hour, five-minute soft target, default speed. I accept
the stated launch/revocation race and possible soft-budget overrun. No automatic
renewal, credentials/access changes, deployments by jobs, merges, purchases,
network/security or policy/control changes. Unknown work holds.”

Use a separate concrete approval for the actual Worker/plugin deployment or any
environment, credential, network or billing changes. Placeholders are blockers,
not values an agent may invent. Approval of this design alone activates nothing.
