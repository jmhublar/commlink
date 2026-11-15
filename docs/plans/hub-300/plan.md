# HUB-300: isolated Cloudflare MCP Events prototype

Authorized by Joshua in CommLink on 2026-11-15. Linear remains the work ledger.
Base: deployed main 492170c. Preserve the old relay and all production state.

## Current increment: Basestar callback transport, 2026-11-15

Joshua selected Basestar hosting after the standalone pinned transport passed
13 tests and a real OpenAI TLS probe. Implement the service, origin JWT
verification, bounded ingress, Worker integration and an install proposal target
in CommLink. Keep host-specific manifests/routes under SysOp's existing Flux
ownership, consistent with the inspected control-plane repository. Do not move code merely
because the repository question was asked.

Prepare and test locally using synthetic identities. Do not create credentials,
Access policies, DNS/tunnel routes, NetworkPolicies, cluster permissions or system
settings without the required action-time confirmation. No administrator prompt
is needed for this preparation. Keep callback origins empty until the deployed
transport and its exact access boundary are approved and verified. Do not change
the shared Hermes TLS interception path, existing services, old relay or paid plan.

Proposed boundary: a new narrowly scoped Access service identity authenticates
the existing Worker to a gateway at an exact operator-configured HTTPS endpoint.
The gateway verifies Access signature, issuer, its own audience, expiry and exact
service identity before accepting a signed callback payload. No webhook signing
secret reaches Basestar. Direct callback TLS retains the validated-address policy.

Verification: negative/positive JWT tests, body/concurrency/time limits, no secret
forwarding/logging, integration tests for both verification and event delivery,
and reproducible manifest rendering. Deployment remains a separate gated step:
verify runtime identity/health, rejected anonymous and wrong-principal access,
real pinned TLS from the Pod, then signed challenge and actual unprompted Dot reply.
See the concrete [Basestar chart/tunnel proposal](basestar.md). Source checks:
40 Worker tests, 19 transport/gateway tests, image smoke and Helm lint/render/package.
The dated original sections below are historical context, superseded by this
increment and the current deployment/runbook records.

## State on 2026-11-15

Worker deployed on the existing Workers Free plan with Cloudflare Access Managed
OAuth enabled. A new reusable, owner-only Cloudflare-login policy protects the
Worker and its hostname. Live anonymous MCP requests return the expected OAuth
401 challenge; discovery returns HTTP 200. Type checking, build and all 9 runtime
tests pass. The private CommLink Prototype plugin was created and its one MCP
server and one skill were verified in ChatGPT.

The live human OAuth connection has not been completed. Its exact redirect URI
is needed before enabling DCR. Callback origins remain empty, Robut is not yet
mapped to a separate machine identity, and no live Dot wake or reply is claimed.
See [the runbook](../../../cloudflare/README.md).

## PR review cycle — 2026-11-15

The first review found a race in the subscription cap and a shared rate-limit
bucket across mailbox tools. Both were reproduced by regression tests before
fixing them. Subscription insertion now re-reads current state and enforces the
cap in one synchronous transaction after callback verification. Rate limits use
validated individual tool names; inactive polling-only limit rows are cleaned up.
The manual pass also found that repeated refreshes renewed the cached callback
verification timestamp indefinitely. Refresh now preserves the last actual
verification time; a test-only clock checks refresh at four and six minutes.
The current local suite has 12 passing tests. The deployed revision is still
tracked separately in cloudflare/deployment.json until an explicit redeploy.

Grok's latest recommendation is captured in [the routine wake design](grok-wake.md).
It requires a distinct routine adapter, coalescing and reconciliation, rather
than assuming Grok supports the MCP Events subscription used by Dot. Live
credentials and the exact routine authentication contract remain unverified.

## Deliver

- A Worker and one SQLite Durable Object per private two-peer channel.
- Existing protocol 1.0 send/poll/ack/link_status; per-recipient authorization.
- MCP events/list, subscribe, unsubscribe with callback verification, persistent
  subscriptions, stable event IDs, transactionally stored mailbox/outbox and alarms.
- Cloudflare Access Managed OAuth and existing Cloudflare identity. Validate the
  signed Access assertion, issuer, audience, expiry and explicit peer identity.
- No paid-plan upgrade, Keycloak deployment, unrelated Access changes or migration.

## Verify

Run `just prototype-check`: type checking, build, real workerd/SQLite tests with
ephemeral signing keys and a simulated HTTPS callback. Exercise auth failures,
wrong recipient, protocol handshake, duplicate writes, verification/signatures,
refresh/unsubscribe, retry, restart persistence and acknowledgement without wake.
Then deploy an isolated Access-protected endpoint, connect its private plugin,
and prove a fresh nonce echoed by Joshua's existing dot. A callback 2xx is only
transport receipt. Grok routine delivery and cloud-task launch are separate gates.

## Outstanding integration inputs

Observe the exact ChatGPT OAuth redirect and callback origin before allowlisting.
Connect the human's OAuth session through the supported UI. Provision Robut's
dedicated machine identity and routine credential via 1Password, never chat.
The 1Password CLI currently cannot connect to its desktop app.

## Deployment and rollback

Use the connected Cloudflare API, saving nonsecret resource IDs in the runbook.
Keep a distinct Worker, Durable Object namespace and Access application. Deploy
only after local checks pass; default-deny missing configuration. Disable only
this prototype's route to stop it. The current tailnet relay remains rollback.
