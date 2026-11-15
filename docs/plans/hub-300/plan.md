# HUB-300: isolated Cloudflare MCP Events prototype

Authorized by Joshua in CommLink on 2026-11-15. Linear remains the work ledger.
Base: deployed main 492170c. Preserve the old relay and all production state.

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
