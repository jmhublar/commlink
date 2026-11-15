# Callback transport investigation, 2026-11-15

The observed native callback origin is `https://connectors.api.openai.com`.
OpenAI requires address validation at connection time, connection to the validated
address with original-host TLS verification, rejection of non-public addresses,
and no redirects for both verification and deliveries. A DNS preflight followed
by an unrelated hostname fetch is not sufficient. [OpenAI contract](https://developers.openai.com/plugins/build/mcp-events#verify-the-callback).

## Recommendation

Keep the mailbox, OAuth and Grok adapter on the existing Worker. Use the small
explicit Node transport for native callbacks unless Cloudflare provides a
verifiable managed-runtime guarantee that satisfies the complete contract.
The [local prototype](../../../callback-transport/README.md) implements/tests
the address/TLS boundary without changing the live Worker or accepting an
exception. It is deliberately not a hosted forwarding service yet.

For independence from Basestar uptime, the best concrete Cloudflare route is a
small on-demand Container reached only through a private Worker/DO binding.
Containers support direct Internet egress when enabled. Do not install an HTTPS
intercept for the callback: that would terminate TLS and delegate egress back to
Worker fetch, losing the property this transport is intended to establish.
These are documented capabilities, not a completed deployment test.
[Container egress](https://developers.cloudflare.com/containers/configuration/outbound-traffic/).

The current account is Workers Free. Containers require the $5/month Workers Paid
plan plus usage; the smallest `lite` instance is 256 MiB/1⁄16 vCPU/2 GB disk.
Paid includes 25 GiB-hours memory, 375 vCPU-minutes and 200 GB-hours disk monthly.
Scaling to zero can keep a small callback service within those allowances, but
$5 is a base fee, not an all-in cap. Cold start plus transport must fit the host's
subscription timeout, which still needs measurement. No upgrade was made.
[Current pricing](https://developers.cloudflare.com/containers/platform/pricing/).

If avoiding new hosting spend takes precedence, an ordinary Node service on
existing Basestar capacity is feasible. It would need a reviewed authenticated
Worker-to-service route, resource limits and log redaction; it would also make
native Dot wake depend on Basestar and its network being up. Existing capacity
and reachability are assumptions here, not newly verified cluster health. No
Basestar workload, ingress, service identity or tunnel was changed.

## Alternatives and evidence

| Path | Evidence | Decision / missing proof |
| --- | --- | --- |
| Worker `fetch` plus exact origin and `global_fetch_strictly_public` | Cloudflare documents public-Internet routing and separation of private bindings. | Promising managed enforcement, but not verified equivalent for the full connection-time/all-non-public-address contract. No exception activated. |
| Explicit DNS preflight then Worker fetch | Preflight and fetch can resolve independently. | DNS race remains; reject as the pinning solution. |
| Worker IP fetch / `resolveOverride` | Direct IP fetch is unsupported; override applies only when URL host and override are in the operator's zone. | Cannot use this for the external OpenAI hostname while retaining the required hostname semantics. |
| Worker raw TLS sockets | Current callback A/AAAA addresses are all in published Cloudflare ranges; Workers TCP blocks those ranges. | Not viable for this actual callback destination. |
| Node pinned TLS on Container | Linux runtime/direct egress, private binding possible; local library and real-origin TLS probe pass. | Paid-plan/hosting approval, ingress binding and deployed-network/challenge tests remain. |
| Same Node transport on Basestar | Standard Node can dial the validated IP while verifying the original hostname. | Avoids a new hosting bill if capacity exists; adds Basestar availability and authenticated ingress requirements. |

Managed-runtime evidence is stronger than only the flag name:

- [Cloudflare's bindings explanation](https://blog.cloudflare.com/workers-environment-live-object-bindings/)
  says global fetch reaches the public Internet, with a legacy own-zone caveat.
- [The compatibility flag](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public)
  removes that own-zone direct-origin routing behavior. It does not itself
  document the complete address classification/connection implementation.
- [workerd's network configuration](https://github.com/cloudflare/workerd/blob/main/src/workerd/server/workerd.capnp)
  defines public-only default egress and filters DNS answers. Its
  [KJ network contract](https://github.com/capnproto/capnproto/blob/master/c%2B%2B/src/kj/async-io.h)
  explicitly applies restrictions after DNS resolution and at connection.
- This is evidence for the open-source runtime, not an attestation of the deployed
  Cloudflare fleet/configuration. The inspected
  [KJ address lists](https://github.com/capnproto/capnproto/blob/master/c%2B%2B/src/kj/async-io.c%2B%2B)
  also do not establish complete IANA non-public coverage (for example, the
  benchmark range is not in the inspected default lists). Do not infer that
  Cloudflare production is vulnerable, or that the source alone proves equivalence.

Additional restrictions: [Worker TCP](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/#considerations),
[resolveOverride](https://developers.cloudflare.com/workers/runtime-apis/request/#the-cf-property-requestinitcfproperties),
[IP fetch](https://developers.cloudflare.com/workers/platform/known-issues/#fetch-to-ip-addresses).
Node's [TLS](https://nodejs.org/api/tls.html#tlsconnectoptions-callback) and
[HTTPS](https://nodejs.org/api/https.html#httpsrequestoptions-callback) APIs expose
the address, SNI/certificate verification, and single-use connection controls
used in the prototype.

## Exact remaining gates

1. Choose/approve a deployment boundary: Cloudflare paid Container/private binding,
   or Basestar with an authenticated service route. This is a hosting/access
   decision; approval to investigate is not approval to change those settings.
2. Implement bounded authenticated ingress and Worker transport integration for
   both challenge and event delivery. Keep signing keys in the mailbox and retain
   the existing origin policy, challenge comparison, retries and owner isolation.
3. Test the pinned probe from that deployed runtime, then approve the exact
   callback-origin binding and transport wiring at action time. No wildcard,
   DNS-preflight fallback, TLS bypass or fetch fallback is permitted.
4. Let the owning Dot create its native subscription and prove a fresh
   Robut→Dot→Robut nonce exchange without a manual wake/poll. Record subscription,
   signed challenge, callback acceptance, actual Dot execution and reply separately.

For a Worker-only route, the precise unresolved vendor question is whether
`global_fetch_strictly_public` in the managed Workers fleet validates the final
connected IP after DNS/CNAME resolution, rejects all private/local/non-public
destinations on each connection, and retains original-host TLS validation.
Request documented confirmation and address-classification scope; no vendor
support message was sent as part of this investigation.
