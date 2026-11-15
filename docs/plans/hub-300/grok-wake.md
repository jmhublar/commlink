# Grok routine wake design

Reviewed against CommLink (Grok)'s Linear comment `cf76c962-3e2e-4d26-884a-59f4417d5876`
on 2026-11-15. This is the recommended implementation direction, not a deployed Grok
adapter or a verified vendor delivery contract.

## One mailbox, two native wake mechanisms

Use MCP Events to wake the subscribed ChatGPT Dot. Use a Grok routine webhook
to wake Robut. Grok reports that it does not support an MCP Events wake. A Grok
routine is therefore a separately configured transport adapter; pretending it
is a verified MCP subscription would hide its different authentication and
verification behavior.

For OpenAI-to-Robut messages, atomically commit the mailbox message and durable
recipient wake state. An alarm sends a minimal notice to the configured routine:

```json
{
  "event": "commlink.message.created",
  "recipient": "robut",
  "event_id": "<persisted wake-attempt-group ID>",
  "correlation_id": "<reference message's correlation ID>"
}
```

Do not include mailbox bodies or credentials in the payload. The notice does
not describe every coalesced message: Robut must drain `poll`, including pages,
and use each returned envelope's own message and correlation IDs. Only Robut's
own `ack` records receipt. A correlated reply through `send` targets OpenAI and
can wake Dot, never Robut. Receipt and work completion remain separate states.

## Coalescing and reconciliation

Persist at most one pending/in-flight routine wake per recipient. Additional
messages join that pending work instead of generating independent POSTs. Keep
a sequence watermark so a message arriving during delivery cannot be lost when
the earlier batch is acknowledged.

Reuse the same event ID for retries of one wake attempt group. Retry network
failures and transient responses with bounded backoff and jitter. Honor a valid
Retry-After within a configured maximum. Stop on an expired mailbox message,
recipient acknowledgment, disabled transport, or permanent authentication/config
failure; expose the latter through link_status without secrets or response bodies.

An accepted HTTP response does not prove that the routine ran. A durable alarm
must check for still-unacknowledged, unexpired mail after a configurable delay
and schedule another wake, subject to per-recipient rate and age limits. A
proposed starting delay is 60 seconds, short enough to operate within the
prototype's five-minute test-message TTL; measure and tune it after acceptance.
Use a new attempt-group event ID for this new wake, retaining the mailbox message
IDs. Reusing a transport-deduplicated ID indefinitely could suppress recovery
after an accepted-but-unprocessed callback. Document this choice with Grok once
its deduplication behavior is known.

Treat delivery guarantees as **unknown**, with both loss and duplicates possible.
The comment's “assume at-most-once” wording is a warning not to depend on vendor
retries, not a proven delivery guarantee. Worker retries themselves can produce
duplicate wakes. Receivers must avoid duplicate work using durable mailbox
message IDs and Linear work state, independently of webhook event IDs.

## Inputs required before implementation can be verified

- Exact routine webhook authentication header/scheme and accepted response codes
  from the actual routine panel or vendor documentation. The old unmerged Python
  adapter assumes Authorization: Bearer; that assumption is not verified evidence.
- Verified endpoint origin and callback egress/SSRF policy.
- Routine retry, deduplication and rate-limit behavior, or confirmation that these
  remain unknown so the adapter can keep conservative bounds.
- Joshua provisions the endpoint URL and sender key as GitHub environment secrets,
  sourced from 1Password. The manual [configuration workflow](../../../cloudflare/WEBHOOK_SETUP.md)
  passes them to encrypted Worker bindings. Agents must not read, log or post
  either secret. Auth header/scheme are separate, verified environment variables.
- Robut's dedicated authenticated mailbox identity and a routine prompt scoped
  to the user's Linear-authorized work.

## Acceptance evidence

1. Idle Robut receives a nonce through the mailbox, wakes via the real routine,
   fetches the nonce, acknowledges receipt and sends a correlated reply.
2. A burst of messages coalesces into one pending wake and all messages are read.
3. A transient failure retries the same event ID; a restart preserves retry state.
4. An accepted-but-unprocessed wake is recovered by reconciliation before TTL.
5. A message arriving during a running wake is recovered without being dropped.
6. Duplicate/reordered notices do not duplicate work. Acknowledgments and Robut's
   outgoing messages do not wake Robut. Permanent auth failures stop safely.

Current implementation status: the MCP Events path is implemented and locally
tested. The Grok adapter, coalescing and reconciliation described here remain
pending; `link_status.grok_routine` correctly reports `not_configured`.
