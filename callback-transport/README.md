# Pinned callback transport prototype

This is a standalone Node.js 22+ library and read-only probe for HUB-300. It is
not wired into the Worker, listening on a port, or deployed. The live callback
allowlist remains empty. It adds no package dependencies. Do not run this code
inside Workers' Node compatibility layer: that does not remove the Workers
socket restrictions. Use an ordinary Node process on a reviewed host/container.

```sh
node --test callback-transport/transport.test.mjs
node callback-transport/probe.mjs
```

The test needs OpenSSL and loopback listening permission. Temporary test
certificates/keys are generated and deleted; only synthetic signed messages are
used. The optional probe resolves the fixed OpenAI hostname, validates all DNS
addresses, opens one pinned TLS connection, and closes it. It sends **no HTTP**,
callback path/query, signing secret or mailbox data. It accepts no arguments.

## Transport boundary

`createCallbackTransport().post({url, headers, body})` accepts only the exact
HTTPS origin `https://connectors.api.openai.com`. Headers must be the five
lowercase signed webhook headers shown in the tests. It returns `{status, body}`.
The mailbox must still generate/validate the verification challenge, sign each
request, maintain subscriptions, and decide retries. No signing key crosses this
transport boundary; only its existing signed body/headers do.

For every probe/POST, the library performs one fresh DNS lookup, rejects the whole
answer set if any address fails policy, selects one address, and passes that IP
literal directly to `tls.connect`. It retains the original server name for SNI
and certificate hostname verification, requires trusted TLS, checks the connected
peer against the selected address, then hands that socket to a fresh one-use
HTTPS agent. No environment proxy, second DNS lookup, connection pooling, TLS
session reuse, redirect following, or implicit address fallback is used. DNS,
TLS and response processing share a five-second deadline. Request bodies are
limited to 128 KiB, response bodies to 4 KiB, response headers to 8 KiB. Errors
contain fixed categories only and have no native-error cause attached.

Address policy conservatively excludes the IANA special-purpose ranges, multicast,
reserved addresses, mapped IPv4, translation/tunneling ranges and scoped IPv6.
IPv6 must be within native global unicast `2000::/3`. Some globally reachable
special-purpose exceptions are intentionally denied: this service only needs
OpenAI's ordinary public callback edge. Review the policy against the
[IPv4 registry](https://www.iana.org/assignments/iana-ipv4-special-registry/) and
[IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/)
before production and when those registries change. The snapshot was checked on
2026-11-15; it is not a live registry feed.

Dependency injection is only an in-process testing seam, never a setting derived
from an HTTP request or environment variable. Tests use actual TLS and HTTPS on
loopback, with a network shim mapping the validated public target to the local
fixture. They preserve TLS hostname/trust checks and assert that no HTTP reaches
the server on validation failure. That shim is absent from the real probe.

## Verified and remaining

All 13 targeted transport tests passed. On 2026-11-15, the unmodified production
connector in the probe selected
`104.18.38.184`, verified `connectors.api.openai.com`, and negotiated TLS 1.3.
This proves the pinned socket can reach the observed Cloudflare edge from this
machine. It does not prove connectivity from a future hosting platform, signed
challenge completion, native subscription creation, or an actual Dot wake.

Before deployment, choose and approve the hosting/authentication boundary. A
Cloudflare Container can be accessed through a private Worker/DO binding without
a public forwarding route; it must retain direct outbound TLS, not an HTTPS
intercept which hands the request back to ordinary Worker fetch. Alternatively,
Basestar can host an authenticated narrow egress service, with its availability
becoming a wake dependency. Neither service/auth configuration exists yet.
Never expose this library as an unauthenticated forwarding endpoint. Bound
ingress size/concurrency and redact callback capability URLs, signatures and
bodies at that future service boundary. Do not log raw exceptions.

See [the route comparison](../docs/plans/hub-300/callback-transport.md) for
evidence, costs and the remaining approval/testing gates.
