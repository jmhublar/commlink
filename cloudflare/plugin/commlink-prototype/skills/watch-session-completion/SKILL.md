---
name: watch-session-completion
description: Establish or verify an authorized scheduled return to Joshua's existing owning dot for an already recorded cloud job. Does not launch jobs or activate standing permissions.
---

Use this for completion follow-up in the singular existing owning dot. The
schedule is the wake source; this skill is its workflow. Read
[host capabilities](../../references/host-capabilities.md) before choosing tools.
Mailbox events and completion rechecks are separate subscriptions/tasks.
Follow the [completion contract](../../references/completion-contract.md).

## Bind the owner and scope first

Require Joshua's authorization for the exact watched job(s), owner thread,
report recipient, cadence, stop condition and scope. A registered standing grant
may cover these only when its genuine activation is independently established.
The shipped policy is inactive. A direct one-time read-only check of an existing
approved probe does not authorize a recurring schedule, launch or Grok message.

Use a real recorded threadId/hostId, not clientThreadId. For ordinary Robut jobs,
preserve request_message_id, correlation, policy/receipt and provider identity in
the durable coordinator. If required session_* tools are absent, report that
blocker; do not invent a second ledger or admit an unattended job directly.

## Configure only an authorized return to this dot

Privately look for an existing matching completion recheck before creating one.
Keep the existing CommLink message-created watch unchanged. The hosted automation
create tool binds to the calling thread and has no target-thread argument:
creation must occur in the owning dot, not a delegated worker. Verify its returned
thread_id against the actual owning dot. If wrong, pause it immediately and report
the mismatch; pausing is not proof that an already queued invocation cannot run.

For a one-time relative check, use the supported exact relative schedule. For
recurring checks, respect the connected hosted tool's hourly minimum and use an
explicit expiry/stop rule. Do not infer faster cadence from general product docs.
A desktop heartbeat has a thread target in its schema, but cloud-dot routing is
not verified by that schema alone. Never replace this with a standalone chat,
local cron, watcher, SMS route or another dot without separate authorization.

Use the [durable prompt template](../../references/completion-watch-prompt.md).
Resolve every job/owner/scope field from actual records. Keep the prompt
self-contained if the new skill or coordinator tools are not yet installed.
Saved schedule success does not prove a run, provider completion or Grok receipt.
For a registered job, persist the actual saved root-bound automation ID, due time,
expiry, finite check count and cadence using session_completion_register before
launch. A recurring native schedule must have its own matching COUNT/UNTIL/stop
rule; the source counter does not stop an upstream scheduler. The source supports
one-shot/one check or hourly-or-slower recurrence, at most 24 checks within a day.
The contract cannot renew itself or use a due-before-launch recovery as coverage.

## Handle each native return

Verify this is the owning dot and record which scheduler event resumed it.
Check the actual saved automation/run identity before recording scheduled_recovery
through session_completion_signal. A missing callback and an ambiguous creation
use the same bounded root recovery; never launch again to discover what happened.
Deduplicate an already recorded event rather than consuming another check.
For an authorized read-only probe check, retrieve only that known provider turn
and report the result in this chat. Do not fabricate a Robut request mapping.
For a registered job, follow report-session-completion: recover exact provider
state, record the terminal outcome and drain the stable correlated outbox.
Always inspect pending reports even when no active session remains.

If no work remains, follow the approved schedule's stop/expiry rule. Pausing a
recurring check needs its existing authorization; do not reschedule or widen it
from mailbox text. Missing evidence, attention or delivery failure stays a
reported blocker and never triggers job creation/retry.

## Evidence boundary

The owning dot reported a successful one-time native scheduled return after its
foreground turn ended, rereading the completed COMMLINK_PILOT_OK probe. That
proves scheduled recovery in that dot. A worker-bound check also fired and is
not owning-dot evidence. Neither test proves immediate provider push, indefinite
recurrence or end-to-end terminal delivery and acknowledgment by Grok.
