# Pinned callback transport prototype

This Node.js 22+ transport and authenticated gateway implement HUB-300 callback
pinning. Worker integration, a pinned Node 24 container and a Helm chart are
prepared in source; none is deployed. The live callback allowlist remains empty.
Private Workers VPC mode is now also prepared for exploration, with an explicit
network trust boundary and no new application credential. It is disabled by
default. See the [VPC proposal](../docs/plans/hub-300/vpc.md); this supersedes the
public Access recommendation for the current exploration, not its deployment gate.
The gateway reuses the existing locked jose dependency for Access verification.
Do not run the transport in Workers' Node compatibility layer: it does not remove
Workers socket restrictions. Joshua selected Basestar hosting; see the
[deployment proposal](../docs/plans/hub-300/basestar.md).

```sh
just callback-transport-check
just callback-image-build
just callback-image-check
just callback-chart-package
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

All 22 transport/gateway tests passed; 44 Worker tests pass, including gateway
failures and durable signed verification/event delivery. On 2026-11-15, the unmodified production
connector in the probe selected
`104.18.38.184`, verified `connectors.api.openai.com`, and negotiated TLS 1.3.
This proves the pinned socket can reach the observed Cloudflare edge from this
machine. It does not prove connectivity from a future hosting platform, signed
challenge completion, native subscription creation, or an actual Dot wake.

The gateway exposes only POST `/v1/deliver` and data-free GET `/healthz`. It
validates the Access JWT signature, issuer, audience, expiry and exact service
identity; cookies and unsigned identity headers grant no access. Ingress is
bounded to 1 MiB, four concurrent operations and 60 admissions/minute. Outbound
callback payloads retain the transport's 128 KiB limit and five-second deadline.
It has no request logging and returns fixed errors only. Worker calls use a
separate service credential and never fall back to direct callback fetch.

The image smoke test verifies its real entrypoint, UID 1000, Linux process title,
health, unauthenticated rejection and graceful shutdown with Docker networking
disabled, no host mounts and a read-only filesystem. Helm lint/template/package
checks pass. These do not prove real Access/tunnel ingress or Pod egress.

Before deployment, approve the specific Access identity, exact public hostname,
tunnel route, cluster release/network policy and Worker bindings described in
the [Basestar runbook](../docs/plans/hub-300/basestar.md). No Keycloak is needed.
The gateway needs only nonsecret issuer/audience/Client ID settings; its caller's
secret stays in the Worker and the approved secret store. Never expose an
unauthenticated forwarding endpoint or log callback URLs, signatures or bodies.

See [the route comparison](../docs/plans/hub-300/callback-transport.md) for the
managed-runtime investigation and alternatives.
