# Approved callback-only pilot

Joshua approved the deployment, existing test-job binding and owning-dot watch
proposed in `Sentinel_ff3aaed9b61481918085bc71be19fe45`, directly in the CommLink
worker conversation ("do it go", "I approve.", "Go.", "Implement this.").
This grant enables one completion hint until **2026-11-16 06:30 UTC**; standing
admission, coordinator authority and executor profiles remain disabled.

The exact source snapshot is `cloudflare/src/callback-pilot.ts`. It binds job
`90b3d235-6566-4f10-bbe9-e453b47aad9b` and correlation
`2cd92c9b-e50b-4572-a050-8380bfd50776` to existing owning dot
`01a1a687-6ecc-75ab-a47f-692abf9d200e`. The provider task is
`6afa7af9-b4b0-8191-85ff-e4c046e1d01e`, verified completed audit turn
`01a1e274-da6d-7438-9755-8f1da6397171`. The upcoming child follow-up reports
that **already completed turn**, so this is a callback transport test, not proof
of a new autonomous job lifecycle. It has no Robut request mapping.

The owner/reporter is the existing email Access principal. A contemporaneous
connector status showed the root's known inbox watch; the separate GPT machine
principal showed zero watches, and the identity map contained only those two
OpenAI principals. This identifies the root by exclusion without decoding or
printing its credential. The child has proved `self=openai`, but its exact key
was not independently recovered; a different child principal will fail closed.
Sharing this OAuth principal is not individual-job isolation.

Deployment must retain existing Access/identity settings, secret bindings,
Durable Object namespace and VPC gateway. The migration is additive. No new
credential, network route or account change is required. The production snapshot
grants no launch or reporting-to-Robut authority. It expires without renewal.

After live code and the existing App's catalog are verified, the **owning dot**
must create the `commlink.job.status_reported` watch filtered to its exact ID,
verify the saved thread and preserve its inbox watch. The worker must not create
a worker-bound watch as a substitute. Only then ask the existing child to call
`job_report_status` once with the registered job ID and `status:"finished"`.
If the tool is unavailable, stop; do not use shell, arbitrary HTTP, administrative
Apps or a mailbox self-message to bypass it. A lost result retains the same ID.

Record native callback acceptance, actual root wake and independent provider
verification separately. A reported status is only a hint. On wake, verify the
above task/turn and report the transport-test result under Joshua's actual
reporting instructions. Do not invent a Grok session request or label this as a
server-generated terminal lifecycle receipt. No additional echo is needed.
