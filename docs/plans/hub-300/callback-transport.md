# Callback transport investigation, 2026-11-15

The observed native callback origin is `https://connectors.api.openai.com`.
OpenAI requires address validation at connection time, connection to the validated
address with original-host TLS verification, rejection of non-public addresses,
and no redirects for both verification and deliveries. A DNS preflight followed
by an unrelated hostname fetch is not sufficient. [OpenAI contract](https://developers.openai.com/plugins/build/mcp-events#verify-the-callback).

## Selected route

Joshua selected Basestar hosting and requested a Helm chart and proper tunnel.
Keep mailbox/OAuth/Grok on the existing Worker. CommLink now prepares an
Access-authenticated gateway, Worker integration, pinned container and Helm chart.
SysOp should own host-specific release/tunnel configuration. These source changes
are tested locally but not deployed. **No Keycloak is needed.** See the
[Basestar evidence, cost comparison and approval plan](basestar.md).

An on-demand Cloudflare Container through a private Worker/DO binding remains an
alternative if independence from Basestar uptime later takes priority. Direct
container egress is documented; HTTPS interception would lose the original-host
TLS boundary. This account's Containers API explicitly requires a Workers Paid
upgrade, and no upgrade occurred. [Container egress](https://developers.cloudflare.com/containers/configuration/outbound-traffic/),
[pricing](https://developers.cloudflare.com/containers/platform/pricing/).

## Alternatives and evidence

| Path | Evidence | Decision / missing proof |
| --- | --- | --- |
| Worker `fetch` plus exact origin and `global_fetch_strictly_public` | Cloudflare documents public-Internet routing and separation of private bindings. | Promising managed enforcement, but not verified equivalent for the full connection-time/all-non-public-address contract. No exception activated. |
| Explicit DNS preflight then Worker fetch | Preflight and fetch can resolve independently. | DNS race remains; reject as the pinning solution. |
| Worker IP fetch / `resolveOverride` | Direct IP fetch is unsupported; override applies only when URL host and override are in the operator's zone. | Cannot use this for the external OpenAI hostname while retaining the required hostname semantics. |
| Worker raw TLS sockets | Current callback A/AAAA addresses are all in published Cloudflare ranges; Workers TCP blocks those ranges. | Not viable for this actual callback destination. |
| Node pinned TLS on Container | Linux runtime/direct egress, private binding possible; local library and real-origin TLS probe pass. | Paid-plan/hosting approval, ingress binding and deployed-network/challenge tests remain. |
| Same Node transport on Basestar | Standard Node can dial the validated IP while verifying the original hostname. | Selected. Existing capacity/tunnel inspected; authenticated gateway/chart prepared. Deployment approval and Pod/challenge proof remain. |

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

1. Approve the concrete new Access identity/application, exact tunnel/DNS route,
   SysOp release and network policy in the [Basestar proposal](basestar.md).
   Hosting selection authorizes preparation; the parent explicitly requires
   action-time confirmation for these security/network changes.
2. Publish/install the reviewed digest and prove real origin authentication,
   tunnel routing, NetworkPolicy enforcement and pinned TLS from the Pod. Source
   implementation and synthetic tests do not establish deployed-network proof.
3. Approve Worker transport settings and exact callback-origin binding only after
   that proof. No wildcard, TLS bypass, DNS-preflight or direct-fetch fallback.
4. Let the owning Dot create its native subscription and prove a fresh
   Robut→Dot→Robut nonce exchange without a manual wake/poll. Record subscription,
   signed challenge, callback acceptance, actual Dot execution and reply separately.

For a Worker-only route, the precise unresolved vendor question is whether
`global_fetch_strictly_public` in the managed Workers fleet validates the final
connected IP after DNS/CNAME resolution, rejects all private/local/non-public
destinations on each connection, and retains original-host TLS validation.
Request documented confirmation and address-classification scope; no vendor
support message was sent as part of this investigation.
