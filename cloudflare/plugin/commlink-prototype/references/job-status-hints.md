# CommLink job status hints — source 0.5.0

This route uses the child's existing authenticated CommLink connector. A cloud
child successfully called link_status as openai; it did not need to read, copy
or configure credentials. Its parent-message tool was unavailable. The new
tool/event here are source-only until an explicitly authorized deployment and
App catalog refresh; discover actual child tools before assuming availability.

## One narrow child tool

    job_report_status({job_id: <server-recorded UUID>, status: "finished" | "failed"})

Use the exact registered job ID, not the provider task ID, request message ID or
a fresh UUID. Do not pass a result, recipient, owner, task selector, callback URL
or credentials. One report is enough; an identical transport retry returns
duplicate without another event. A different status for the same job conflicts.
Never retry an uncertain report with a different job ID.

The tool records an untrusted status hint. Its provider_verified:false receipt
is deliberate. Receipt/queued delivery, webhook acceptance, actual owning-dot
wake and independently verified provider completion are different facts.
It does not create jobs, grant authority, acknowledge mailbox messages, free a
reservation, or send a lifecycle result to Robut.

For a generally no-tools task, where Joshua genuinely authorizes the callback,
explicitly permit this single tool as the narrow exception. Do not forbid all
tools while claiming to test an explicit callback. Include the fixed job ID
from launch.completion.job_id. Do not pass coordinator credentials or authorize
other Apps. If this exact tool is unavailable, preserve the limitation and use
the approved root recovery; do not impersonate Robut or use Cloudflare admin
tools, arbitrary HTTP or a made-up parent-message API instead.

## Server binding and its limits

The server infers all destination/correlation/provider metadata from a pre-recorded
binding. A regular session gets one only after legitimate admission, a registered
commlink_tool completion plan and launch preparation. The coordinator records
the actual task/turn. An early hint can wait for that binding without waking on
an invented ID. Registration/plan authorization does not come from this tool.

A callback-only supervised pilot may use a specific operator-supplied
SessionConfiguration.callback_jobs record, without enabling standing execution.
That array is empty by default and is not settable through a request, environment
switch or MCP registration tool. The record supplies job_id, owner_key,
reporter_key, owner_thread_id, correlation_id, request_message_id (nullable for
a genuine direct pilot), executor_id, turn_id, expires_at, approval_ref and
reconciled. The trusted snapshot is not a verifier of human approval: bind its
exact source/artifact and record to Joshua's actual approval before release.
Never copy an example or fixture Boolean into an authorization mechanism.

Every report rechecks the existing signed Access identity, exact allowed
reporter principal, job binding and expiry. Revocation/retargeting cancels pending
delivery. Records and event IDs survive restart. Same OAuth identity does not
isolate jobs: another task sharing it could report a known authorized job ID.
The source is the authenticated OpenAI principal, not a cryptographically proven
individual child. A shared principal also does not attest thread affinity.
Current inherited Apps must be audited before any standing execution profile is
marked isolated; a prompt restriction is not capability enforcement.

## Separate native event, same owning dot

Event name: commlink.job.status_reported. Its filter is the server-approved
owner_thread_id. Create this native watch only in the existing owning dot and
verify the actual saved thread independently. One watch covers registered jobs;
preserve the existing commlink.message.created watch. The combined cap is five
subscriptions per principal. A second live callback for the same completion
owner is refused; refresh of the same watch is idempotent.

link_status.job_subscriptions and job_deliveries are principal-scoped operational
readback. They omit callback URLs, signing secrets and credentials. Check the
actual lease rather than claiming metadata edits renew it. Signed event delivery
uses the existing fixed VPC gateway, approved origin/address validation, bounded
retries and stable event IDs. No new credential or network setting is needed.

The event carries only server-bound job, request/correlation, task/turn and owner
IDs plus claimed_status. It creates no mailbox envelope. Do not call ack with
its event ID, fabricate an openai-to-openai message, or spoof Robut. Ordinary
protocol 1.0 self-send remains rejected.

## Root handling

Verify the native event and match its job/root/correlation/task/turn against the
trusted record. Record a distinct commlink_hint signal for a registered session;
use sender_thread_id:null and automation_id:null. The server also checks that
the event belongs to that job's stored hint. Do not label it platform_push or an
authenticated direct-child message. For a directly approved callback-only pilot,
retain its own provenance rather than manufacturing a Robut request mapping.

Read the exact provider task/turn. A finished claim may arrive before the child's
final turn is terminal; preserve bounded root recovery and record nonterminal,
unknown or attention observations honestly. Only actual provider evidence can
make the fenced terminal transition. Then drain the existing correlated result
outbox once, within genuine reporting permission, separating mailbox storage
from Robut receipt. Never echo a status or acknowledgment.
On upgrade, old completion tables gain a nullable authenticated-owner column.
Existing contracts remain readable for provider reconciliation, but unknown
legacy owners cannot register a new callback or prepare a launch. Do not guess
the owner from a thread label or assign it from a new caller; any repair requires
trusted operator reconciliation and applicable approval.

Pending hints without a binding/subscription are not delivered. Expired or
revoked subscriptions stop delivery; a report retry does not replay a canceled
event to a replacement watch. The bounded root recovery is still needed for
those gaps and callback failures. Completion does not authorize a replacement
job, policy change, another dot or a broader recurring schedule.

## Live acceptance still required

After exact code/binding approval and deployment, rescan the existing App's MCP
catalog and verify the child actually sees this tool. Create the authorized job
watch from the existing root, with saved-thread/lease checks. Pre-record one
approved test job and let an authorized child make one hint call after the root
ends its foreground turn. Observe callback delivery, native root resumption and
provider verification separately. Test duplicate/wrong/expired IDs and preserve
recovery without calling it immediate delivery. Local SQLite/workerd tests are
not live wake proof. An existing-task callback-only follow-up tests transport;
a fresh autonomous job-completion test needs its own authorization.
