# CommLink Cloudflare prototype

Isolated HUB-300 implementation, based on deployed main `492170c`. The existing
tailnet relay remains unchanged. This prototype has no production mailbox data.

The Worker verifies Cloudflare Access JWT signatures, issuer, audience, expiry
and explicit identity mappings before routing requests to a private channel's
SQLite Durable Object. `send` atomically records the message and any subscribed
event deliveries. Durable alarms retry callbacks with stable event IDs. Only
recipient `ack` marks receipt; it never emits an event. Callback 2xx acceptance
does not prove the recipient read the message or that Dot woke.

## Build and check

From the repository root:

```sh
just prototype-install
just prototype-check
```

Node, npm and just are required. Tests run real workerd and SQLite with ephemeral
RSA/HMAC keys and intercepted HTTPS services. They need permission to open local
loopback ports. `package-lock.json` pins dependencies. Compatibility date
2026-07-30 is shared by deployment and the installed local runtime.

## OAuth and identity

Cloudflare Access Managed OAuth is the authorization server. Cloudflare identity
is the login provider. Access handles authorization codes, PKCE, tokens and token
refresh. The origin receives `Cf-Access-Jwt-Assertion`, which it validates; it
does not decode the opaque OAuth access token as a JWT.

The new reusable policy allows Joshua's exact email through the existing
Cloudflare identity provider. No unrelated Access application or IdP changed.
Only the OpenAI peer is configured initially. A distinct Robut machine identity
must be provisioned before a real two-peer round trip.

See [deployment.json](deployment.json) for nonsecret resource IDs and state.
Managed OAuth is enabled with 15-minute access tokens and a 14-day grant. Dynamic
client registration is disabled until the exact ChatGPT OAuth redirect is
observed and allowlisted. The private plugin package is in `plugin/`.

The remote API identifies this account as Workers Free. The upload uses that
plan's existing limits; it does not upgrade the plan or set paid CPU limits.

## Delivery limits and remaining acceptance gates

- Current callback origin allowlist is empty, so no subscription can yet create
  an outbound delivery. Add only the exact, verified ChatGPT service origin.
- General user-supplied webhook hosts, IP literals, credentials, non-HTTPS URLs,
  fragments and redirects are rejected. Explicit operator-vetted origins reduce
  SSRF exposure. DNS/IP pinning at connection time has not been implemented or
  proved; review that requirement before enabling a live callback origin.
- Payloads are at most 96 KiB, requests at most 128 KiB, and polls at most 50
  messages. Each peer has a 60/minute per-method limit and a 1,000-message unread
  limit. A channel is for two peers, not a global multi-tenant coordination point.
- Subscriptions default to one hour and grant at most one day. Old/new HMAC keys
  overlap for two minutes on rotation. Delivery tries at most six times; 408,
  425, 429, network failures and 5xx retry. Other non-2xx results are terminal.
- Delivery can duplicate after a crash between HTTP success and persistence.
  Receivers must deduplicate event IDs; no exactly-once claim is made.
- Message IDs and delivery records are retained for seven days beyond expiry.
  This is an experimental low-volume mailbox, not a production retention system.
- Human OAuth connection, real Dot event subscription and fresh-nonce reply,
  Robut identity, Grok routine delivery and cloud-task launch remain separate
  acceptance gates. No live Dot wake has been claimed.

## Deployment and rollback

The bundle is `dist/worker.js`. Deployment used the authenticated Cloudflare
connector API with multipart Worker metadata, a `MAILBOX` SQLite Durable Object
binding, and one initial migration (`new_tag: v1`, `new_sqlite_classes: [Mailbox]`).
Subsequent uploads preserve that namespace and do not repeat the initial
migration. Plain-text bindings hold nonsecret issuer, audience, channel ID,
identity map and callback-origin allowlist. Never put credentials in Git.

Access protects the exact workers.dev hostname and the immutable Worker ID;
preview URLs are disabled. New code must remain default-deny when configuration
is missing. Never add a bypass policy to make OAuth discovery work.

To stop this prototype, POST `{ "enabled": false, "previews_enabled": false }`
to the recorded Worker's `/subdomain` endpoint. Keep its Access policy in place.
Do not delete the Durable Object namespace or modify the old relay as rollback.

Live anonymous probing on 2026-11-15 returned HTTP 401 and the Access
`resource_metadata` challenge; OAuth and resource metadata returned HTTP 200.
Python's default User-Agent was blocked with Cloudflare error 1010; the explicit
`CommLinkPrototypeAcceptance/0.1` test client succeeded. Client compatibility
must therefore be checked with the real ChatGPT connection.

References: [Managed OAuth](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/managed-oauth/),
[Cloudflare identity](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/cloudflare/).
