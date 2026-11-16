# Completion contract v1 — source implementation

Every delegated job needs a path back to the singular owning dot. This source
contract adds persistent coordination and host instructions; it does not install
a callback receiver, create a scheduler or repair the provider's notification
service. The five new session_completion_* tools are not live until separately
released. Standing permissions remain inactive.

## Three distinct triggers

1. **Explicit child callback:** when the child has a supported parent-message
   tool and actual direct-owner permission, it sends one minimal completion hint
   to the verified owning root. This can happen before the child's turn becomes
   terminal. It is not provider completion evidence.
2. **Platform push:** a provider terminal notification may resume the root.
   Creation/parent-child registration or a documented promise is not delivery
   proof. Record an actual delivered event separately from an explicit message.
3. **Scheduled recovery:** a separately authorized, saved and bounded return to
   this owning root reconciles a recorded job if a callback is missing, fails or
   precedes the provider's terminal state. This is polling with scheduler delay.

Never describe any of these as another. No trigger proves success on its own.

## Before launch

The trusted operator snapshot must declare completion_owner_thread_id for the
existing root. It is included in the execution-control digest. Registration
cannot choose a different root or activate that snapshot. Current authentication
binds a principal, not a cryptographic conversation identity; the coordinator
must independently verify its current root context and host metadata. Multiple
chats using the same OAuth principal are not cryptographically distinguished by
this module. Do not claim that source metadata solves that limitation.

Create/reuse the specifically authorized recovery schedule **from the owning
dot**, then inspect its saved destination and stop rule. Do not use a worker's
schedule, an event-only mailbox subscription, an unsaved proposal or an unbounded
recurring task as evidence. The source accepts one-shot/max_checks=1 or recurring
cadence at least 3600 seconds, at most 24 checks within at most one day. The
actual hosted schedule must also have matching COUNT/UNTIL/expiry bounds; the
module's counter bounds reconciliations, not the upstream scheduler's wakeups.

Use session_completion_register after session_receive and before
session_prepare_launch. Exact arguments are described by tools/list:

- request_message_id: actual persisted Robut request UUID.
- plan.owner_thread_id: exact verified existing root thread ID.
- plan.explicit_callback: {mode: thread_message | unavailable, tool_name: exact
  discovered host alias | null}. Use unavailable if support/permission is not
  established; do not invent a tool or grant the child coordinator credentials.
- plan.platform_push: declared | unavailable. Declared means an upstream promise,
  never a claim that notification was observed.
- plan.recovery: automation_id, owner_thread_id, kind (one_shot | recurring),
  due_at and expires_at (Unix milliseconds), max_checks, cadence_seconds (null
  for one-shot). Persist only nonsecret IDs and timing, not raw scheduler data.

The saved plan is immutable and idempotent. Expired/due-before-launch plans fail
closed; registration cannot renew them. A different root/schedule or stale plan
requires explicit operator reconciliation, not another launch or automatic reset.
Registration is a coordinator attestation of inspected host readback, not an
independently signed host receipt or a verifier of human permission.

Launch preparation refuses a missing/root-mismatched/stale contract without
consuming a launch attempt. Its launch.completion contains the root, correlation,
explicit callback mode, recovery reference and minimal hint fields. Preserve
those exact bindings in the child brief and durable ledger.

## Child instruction and permission boundary

For a tool-capable child with direct-owner authorization, include this narrow
exception to general no-tools instructions:

> Use no tools for the task's data or computation. The only permitted tool action
> is one completion hint to the verified owning thread [exact root ID], using
> [the actual supported parent-message tool]. Use the fixed contract hint with
> kind commlink_completion_hint, schema_version 1, request_message_id,
> correlation_id and owner_thread_id supplied by the owning dot. Do not include
> raw results, logs, credentials, paths or other private data. Do not contact any
> other thread, change models, request follow-up work or retry an uncertain send.
> Then provide the requested final result and finish. If the callback tool or
> permission is unavailable or denied, do not invent an API or broaden access;
> finish the task and let the recorded root recovery handle notification failure.

The known send_message_to_thread tool requires direct human authorization to
message its destination; an orchestrator's assertion alone is insufficient.
Pass genuine owner evidence in a host-supported trusted form, or use unavailable.
Discover the child's actual tool schema. For that supported tool, threadId is
the verified root and prompt is the minimal hint; omit model/thinking overrides.
Other parent-report tools may have different schemas. This reference does not
authorize a live message or make a tool available in the child environment.

## Binding and signals

Record submitted through session_transition with the actual provider task ID;
it is atomically persisted in the completion ledger. Read the provider and bind
the exact launched turn via session_completion_bind(request_message_id,
executor_id, turn_id). Both bindings are immutable; another turn in the same
thread is not the original job. If creation is ambiguous, retain the fenced
launch_pending/launch_uncertain reservation and do not create again.

On actual root resumption, derive sender, recipient, event and automation IDs
from trusted host metadata, not the callback's JSON claims. Verify the child is
the recorded task/direct child of this root. Then session_completion_signal
accepts request_message_id and a closed signal object:

- event_id: stable actual host event/message/run ID.
- source: explicit_child | platform_push | scheduled_recovery.
- owner_thread_id, executor_id, correlation_id: stored bindings.
- sender_thread_id: actual child ID for explicit_child; otherwise null.
- automation_id: actual saved root schedule ID for scheduled_recovery;
  otherwise null.

For an ambiguous creation, scheduled recovery may carry executor_id null and
returns reconcile_launch. It never invents an ID or permits a creation retry.
An explicit/platform hint before the task binding exists is rejected; preserve
the original host event and reconcile it after the create response is recorded.

Signal IDs dedupe durably across restarts. Conflicting IDs/bindings fail closed.
Duplicate events do not consume recovery checks or create lifecycle messages.
Signals never set finished/failed or release the active slot.

## Provider reconciliation and bounded recovery

Read only the recorded task and exact turn. For a nonterminal or unavailable
lookup, use session_completion_observe with observation {executor_id, turn_id,
source: read_thread | wait_threads, state: running | attention | unknown}.
This records that the current hints were reconciled without pretending success.

For actual terminal evidence, use the existing fenced session_transition with
source read_thread/wait_threads, the mapped terminal state **and turn_id** in
evidence. Inspect the result and failed tools before deciding success. Root
observations remain coordinator attestations, not cryptographic provider proofs.
The same transaction persists terminal state, resolves completion tracking and
queues the existing correlated lifecycle outbox. Late hints cannot add another
terminal report. Drain that outbox even if there is no active reservation.

session_completion_recovery returns persisted root/task/turn/correlation, plan,
distinct signal sources, consumed checks and action: await_signal,
await_scheduled_recovery, reconcile_provider, reconcile_launch, attention or none.
Scheduled signals consume at most their finite budget and cannot arrive early.
An exhausted/expired plan or unknown provider lookup requires attention while
the job reservation remains intact. It never means cancellation or permission
to relaunch. A final permitted recheck still reconciles before escalating.

After completion, stop only the matching job-specific recurring recovery task
and verify its stopped state where separately authorized; preserve the inbox
watch. A saved schedule, foreground wait, synthetic test or child-list relation
is not proof that the owning dot woke unattended.

## Acceptance gates

Local SQLite/workerd tests exercise bindings, explicit/push distinction, missing
callbacks, bounded root recovery, provider failure, restart/deduplication and one
terminal outbox. They make no live cloud, callback or scheduling calls.

An authorized live test must end the root's foreground turn, observe the actual
explicit callback or platform event, verify the recorded task/turn, and separately
exercise a missing-callback recovery. Record actual root resumption, provider
terminal evidence, mailbox acceptance and Robut acknowledgment independently.
The previous no-tools hello-world test did not allow an explicit callback, and
the expected platform notification was not observed before a manual prompt.
Its parent-child relationship does not close these acceptance gates.
