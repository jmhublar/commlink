# HUB-300 private Workers VPC exploration — 2026-11-15

Joshua requested exploration after pausing the public Access service-token setup.
This document supersedes the public-route recommendation in `basestar.md` for
this exploration only. No VPC service, binding, private-mode gateway, network
policy or live Worker change is authorized by exploration alone. No service
token or new Access app has been created. The existing human Dot OAuth remains
appropriate for Dot→mailbox; autonomous Worker→gateway uses a different boundary.

## Specific route

```text
authenticated mailbox + Durable Object alarm
  -> CALLBACK_GATEWAY (one vpc_service binding)
  -> VPC service commlink-callback-hub300 (fixed HTTP host + 8080)
  -> existing Kenning QUIC tunnel
  -> commlink-callback.commlink.svc.cluster.local:8080/v1/deliver
  -> DNS-validated, IP-pinned TLS to connectors.api.openai.com:443
```

Register one **VPC Service**, never a whole VPC Network. The service fixes the
destination independent of the URL supplied to fetch; the Worker still supplies
one constant URL, manual redirects, a ten-second timeout and a strict envelope.
The callback URL travels only inside that envelope, never controls VPC routing,
and the gateway validates it against the fixed OpenAI origin before opening TLS.
The private hop does not replace final callback IP validation.
[Binding API](https://developers.cloudflare.com/workers-vpc/api/),
[service scope](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/).

Prepared service body: `deploy/vpc-service.example.json`. Proposed registration:
`POST /accounts/32b597c6685caac8796fc167932759d2/connectivity/directory/services`.
Host is `commlink-callback.commlink.svc.cluster.local`; HTTP port 8080 only,
HTTPS port null; resolver tunnel ID is
`80435c51-39b9-4d55-96fa-2936ff1345ad`. Use cloudflared's existing cluster resolver,
not a new public DNS record or a broad private subnet route. Verify disabled HTTPS
semantics on service readback and hostname resolution from the running connector.

Worker metadata after a service ID exists:

```json
{
  "type": "vpc_service",
  "name": "CALLBACK_GATEWAY",
  "service_id": "REPLACE_WITH_APPROVED_SERVICE_ID"
}
```

Set `CALLBACK_TRANSPORT_MODE=vpc`. No `CALLBACK_TRANSPORT_URL` or Access client
credentials may coexist; mixed settings fail closed. Missing/failed binding
never falls back to global fetch. The service ID is not a password. Removing the
binding revokes that Worker's route; deleting the service revokes all bindings
to it. Review other consumers first; permissions can attach more consumers.

## Actual prerequisites checked

Basestar is the current executor at 192.168.1.68, with local OrbStack/k3d-pet.
Node `k3d-pet-server-0` is Ready. Kenning is healthy; cloudflared 2026.9.3 and recent
logs show `protocol=quic`. The minimum documented cloudflared is 2025.7.0. Locally
managed tunnels can serve Workers VPC alongside existing public routes, without
adding an ingress rule. [Tunnel requirements](https://developers.cloudflare.com/workers-vpc/configuration/tunnel/).

Cloudflared is an ordinary Pod, not hostNetwork, in namespace `cloudflared`, with
label `app: cloudflared`, ClusterFirst DNS and observed Pod IP 10.42.0.121.
CoreDNS is 10.42.0.99, label `k8s-app: kube-dns`. Those IPs are observations, not
new fixed pins. There is no cloudflared namespace NetworkPolicy; the proposed
gateway ingress policy supplies its own namespace-and-Pod selector. Current
policies in other namespaces do not prove enforcement for this new workload.

The account's service-list API succeeds and reports zero registered VPC services.
Read access does not establish permission to create services/bind Workers.
Cloudflare documents Connectivity Directory Admin for creation and Bind for
binding existing services. Verify effective members/API scopes before apply;
do not grant new roles as an incidental deployment fix.

The feature is **beta**, currently free on Free and Paid plans. Its future price
and API stability are not guaranteed. Current Worker limits still apply.
[Limits](https://developers.cloudflare.com/workers-vpc/platform/limits/).
No upgrade, billing or permission change is proposed.

## Authentication and isolation model

This route grants a platform capability to the deployed Worker; it does not mint
a cryptographic per-Worker assertion for the gateway. No OAuth exchange or new
application secret exists on this hop. Existing tunnel credentials remain under
their existing lifecycle; this does not eliminate all infrastructure credentials.

The gateway's explicit `vpc-network` mode is a **different authentication boundary**.
It accepts requests reaching the private listener, subject to NetworkPolicy,
request bounds and fixed internal Host. Host checking reduces accidental public
route mistakes; it is spoofable and is not authentication. Mode defaults to
`access`, still requiring JWTs; missing/unknown mode or mixed configurations fail.
The private mode cannot be selected through a request header or callback URL.

| Actor/path | What prevents or permits gateway access |
| --- | --- |
| CommLink Worker with the binding | Intended capability; mailbox authorization and validation still run first. Alarms use the same capability without a user session. |
| Internet client | No public gateway DNS, ingress, NodePort or host port. Public MCP does not proxy arbitrary gateway requests. |
| Unrelated Worker without binding | No service capability. Must verify actual rejection in deployment. |
| Account member with Bind + Worker deployment privileges | Can attach this service to another Worker; treat as trusted authorization administrator. |
| Connectivity Directory Admin / broad tunnel Network-binding owner | May create a second route to the same service; review those privileges, not just service ID secrecy. |
| Ordinary Pod in another namespace | Expected blocked by gateway's namespace+Pod ingress selector; actual enforcement must be proved. |
| Pod labeled app=cloudflared in cloudflared namespace | Allowed. Anyone able to create/exec/modify those Pods belongs to the trusted set. Labels alone do not authenticate a workload. |
| Existing cloudflared process or compromised tunnel Pod | Can originate local calls and observe private-hop bytes; trusted in this design. |
| Cluster/node administrator, host process, permitted exec/port-forward | Privileged bypass remains possible. Kubernetes NetworkPolicy does not isolate the service from its node/admins. |

Use namespace `commlink`, one nonroot read-only Deployment, no service-account token,
ClusterIP only, ingress TCP8080 from **both** namespace cloudflared and Pod label
app=cloudflared. Egress is CoreDNS53 and public443; application pins callback TLS.
The chart requires nonempty namespace and label selectors. Access mode and private
mode values cannot mix. Helm creates no broad RBAC, PVC, host access or credentials.
The restricted namespace policy remains in SysOp's suspended proposal.

Cloudflare-to-connector QUIC encrypts the tunnel. HTTP from connector Pod to
gateway Pod is plaintext inside this single-node cluster. The signed webhook
payload's capability URL and body are visible to that trusted local path. If
confidentiality against node/cluster observers is required, add reviewed origin
TLS with automatic certificate renewal and an approved issuer; do not disable
certificate verification. That is additional scope, not silently configured here.

A dedicated connector/namespace/tunnel could narrow the shared-Pod trust boundary
but adds a separately managed tunnel identity and workload. Per-request signed
assertions could preserve gateway caller authentication but require a root key
and rotation policy. Neither is required merely to call this path VPC, and
neither is implemented in this exploration. If the trust table is unacceptable,
stop before deploying private mode; the default Access path remains available.

## Prepared code and configuration

- Worker `callback.ts`: explicit vpc mode, fixed binding method receiver and URL,
  no credentials forwarded, bounded response, no public/direct-fetch fallback.
- Gateway `gateway.mjs`: explicit private mode plus exact internal Host;
  preserved fixed OpenAI TLS transport, bounds, rate/concurrency limits and redaction.
- Helm chart 0.2.0: explicit authMode, conditional Access settings, strict mixed-mode
  schema and selectors. Default is still Access JWT mode.
- `deploy/basestar-vpc.values.example.yaml`: private-mode proposal with unresolved
  digest, intentionally rejected for deployment until replaced.
- SysOp isolated checkout has a suspended/unreferenced release proposal. No
  tunnel public-route diff is needed for VPC. Nothing has been applied/published.

## Tests and remaining proof

All 44 Worker tests and 22 gateway/transport tests pass, including the new
private-mode cases. Helm lint/render/package and semantic isolation checks pass
for both modes; mixed modes, unknown modes and empty Pod-label values fail schema
validation. The image build and network-disabled default-Access smoke pass.

Local checks cover fixed binding target, correct signed bytes, missing binding,
unknown/mixed configuration, binding errors/redirects, no global fetch fallback,
private-mode Host and browser rejection, default JWT rejection, original-host
TLS, DNS rebinding and bounds. These are synthetic unit/TLS fixtures, not a
live Cloudflare VPC emulation or proof of network isolation.

Before native wake, the approved deployment must pass these gates:

1. Read back only the configured hostname/8080/tunnel, scheme restrictions and
   Worker binding. Verify no public gateway route exists and no broader network
   binding was created. Review effective bind/admin/cluster access.
2. Deploy the new namespace/release with origins still empty. From cloudflared,
   resolve Service DNS and connect; from an ordinary labeled test Pod in another
   namespace, prove denied ingress. Also test same namespace without tunnel label.
   Temporary test Pods need a bounded lifetime, digest-pinned images, no credentials
   and deterministic cleanup; do not leave diagnostic jobs running.
3. Test real Worker binding to data-free health. Then send synthetic invalid
   callback targets and prove no private/internal egress. Probe real OpenAI pinned
   TLS from the gateway Pod without sending callback HTTP data.
4. Verify actual forwarded Host matches the fixed Host check; fail closed if the
   beta API normalizes it differently, investigate before changing policy. Verify
   response timeout/redirect behavior over the deployed binding.
5. With authorized test traffic, simulate unavailable binding/tunnel/gateway and
   confirm durable retry preserves event ID, no fallback and recoverable mailbox.
   Avoid shutting down the shared tunnel for a test; isolate only this service.
6. After separate callback-origin enablement approval, owning Dot creates native
   subscription; record signed challenge, event accepted, actual unprompted Dot
   run and correlated reply/recipient ack separately. VPC health alone proves none.

Failures include service DNS/ClusterIP reachability, incorrect source Pod/SNAT,
missing enforcement, QUIC block, expired existing tunnel identity, host sleep,
gateway overload or egress limits, Worker deadline, beta API changes and deploy
permissions. All fail closed and leave messages recoverable through existing
poll/ack and durable retry; retry budgets are finite, so recovery may need a
fresh subscription/operator reconciliation. Do not promise perpetual retry.

## Exact actions for later approval

Exploration is not deployment approval. Obtain approval on the final reviewed
commit/image/chart digests and this **network capability instead of the earlier
public Access token design**:

1. Publish the reviewed private image/chart to existing registry; add SysOp's new
   restricted namespace, release and network policy, using its Flux ownership.
   Private mode's trust boundary and plaintext cluster hop must be explicit.
2. Create exactly one named HTTP VPC Service using the prepared body; verify only
   intended port/protocol and no extra subnet access. No new account roles,
   tunnel credentials, public hostname/DNS/Access app or ingress rule.
3. Bind that service as CALLBACK_GATEWAY to existing CommLink Worker and deploy
   the reviewed source with CALLBACK_TRANSPORT_MODE=vpc, preserving OAuth/Grok
   and origins empty. Run the bounded real reachability/isolation tests above.
4. Only after passing them, approve the exact OpenAI callback-origin enablement
   and owning Dot subscription/nonce test. Do not manufacture its callback URL.

Rollback: keep origins empty, revert only the CommLink binding/source, remove the
new service after checking consumers, and suspend/scale down the dedicated release
through SysOp. Never stop/delete Kenning or change shared routes. No mailbox data
is migrated/deleted. Basestar remains the availability dependency.
