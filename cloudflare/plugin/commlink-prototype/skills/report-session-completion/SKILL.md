---
name: report-session-completion
description: Reconcile an existing CommLink cloud job and deliver its correlated terminal status to Robut when Joshua's owning dot resumes. Does not create a wake source or launch a job.
---

Run in Joshua's existing singular owning dot. A skill supplies instructions; it
does not subscribe to cloud completion or keep a process running after a turn.
Use this after an actual event, an explicitly authorized scheduled return to
this chat, or a supervised wait. State which trigger actually resumed the dot.

## Recover the existing job

Read session_recovery and session_outbox, even if recovery has no active jobs.
A terminal job releases its active slot while its report can still be pending.
No active job is not proof that reporting is complete.

Observe only the recorded executor ID for the authorized job. Use read_thread
or wait_threads and verify the exact ID and relevant turn. An idle thread,
create_thread receipt, child completion notice or requested model is insufficient
terminal evidence. If there are follow-up turns, reconcile which turn belongs to
the job before reporting its outcome. Do not start or retry a job from this skill.

For a nonterminal registered job with a provider terminal result, use
session_transition with the current
version and fence to record finished or failed. Map a completed turn to finished
only after checking its final result; a completed turn can contain failed tools.
Attention, timeout or missing evidence retains the reservation and is a blocker,
not permission to claim failure, clear an uncertain launch or retry creation.

Curate the bounded result: summary, checks, limitations and approved artifact
links. Exclude raw logs, credentials, signed URLs and hidden reasoning. Distinguish
configured model/effort/speed from independently observed effective settings.
The inactive source prototype grants no execution or reporting authority.

## Deliver the result to Grok

Use the job's original Robut request_message_id and correlation_id. Send only
reporting authorized by Joshua's direct instructions or the genuine standing
grant. Do not create a request/correlation mapping for an unrelated supervised
test merely to manufacture a lifecycle receipt.

Drain session_outbox using its envelopes unchanged through send(to: robut).
Preserve message_id, correlation_id, status_seq and bounded result. Then call
session_outbox_mark_sent. If interrupted after mailbox acceptance but before
marking, resend the same envelope ID; never create a replacement ID. A stale
version/terminal transition is reconciled through status/outbox, not repeated.

Mailbox accepted/duplicate proves storage. Robut's ack proves recipient receipt;
they are separate outcomes. An absent ack remains a delivery/receipt blocker,
not permission to repeat the job. Never reply to an ack or completion message.
Expired reports require explicit reconciliation; do not reset TTL or synthesize
a replacement automatically.

## Establish the real wake separately

The existing CommLink native watch wakes this dot for mailbox messages, not for
arbitrary cloud task completion. Preserve that watch and its renewal workflow.
Do not turn its event-only subscription into a polling schedule.

Where directly authorized, a separate scheduled task can return to this same
chat and run this skill against recorded jobs/outbox. Reuse an existing matching
task. Verify the saved target thread, cadence, expiry/stop rule and tool access;
never accept a standalone chat or another coordinator as equivalent. Respect
the connected scheduler's cadence limits. Polling introduces delay and is not
an immediate completion event.

Create a hosted recheck from the owning dot itself. A delegated worker's create
call can bind the schedule to that worker chat; a parent/source link does not
retarget it. If readback shows the wrong thread, pause the schedule before it
runs and have the owning dot create its own check. Do not claim wake from a
successfully saved schedule, or create another dot to accommodate misrouting.

A real acceptance test ends the owning dot's foreground turn before the scheduled
or provider event arrives. That native turn must retrieve the recorded provider
result and drain the authorized outbox without a manual prompt/poll being its
trigger. Record scheduler/provider event, actual dot resumption, terminal evidence,
mailbox acceptance, Robut ack and absence of a reply loop separately. A supervisor's
wait or this skill's installation alone proves none of those wake gates.
