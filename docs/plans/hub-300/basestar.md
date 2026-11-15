# HUB-300 Basestar deployment proposal — 2026-11-15

Joshua selected Basestar and requested a Helm chart plus a proper public tunnel.
The service, Worker integration, image and chart are prepared locally. No new
Access application/identity, DNS record, tunnel route, cluster workload or
NetworkPolicy has been created. Live Worker revision remains `92edc3b`, version
`0b1e31c4-6a0b-4f11-a127-12e0163cedb2`, with callback origins `[]`.

## Identity and route

**No Keycloak is required.** Keep the already connected ChatGPT OAuth application.
Use a separate Cloudflare Access Service Auth application and dedicated service
token for Worker-to-gateway calls. The gateway verifies RS256 signature, issuer,
its own audience, expiry, service-token shape and exact Client ID. This is
machine authentication, with no additional human login flow.
[Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
[signed claims](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/),
[origin JWT verification](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

```text
CommLink Worker
  -> https://commlink-egress.cogignition.cloud/v1/deliver
  -> Access: dedicated Service Auth policy
  -> existing kenning tunnel / cloudflared
  -> commlink-callback.commlink.svc.cluster.local:8080
  -> gateway verifies signed Access assertion
  -> fixed OpenAI origin over DNS-validated, IP-pinned TLS
```

The proposed hostname is exact, not a wildcard. Read-only Cloudflare checks found
the `cogignition.cloud` zone active and no exact DNS record or Access app for this
hostname. Recheck overlapping/wildcard applications and DNS before creation.
Gateway credentials are new and purpose-specific; do not reuse Robut, GPT, Grok
or tunnel credentials. The Worker retains `whsec` and signs requests. The gateway
receives only the already signed headers/body and necessary callback URL.
Never log capability paths/queries, signatures, JWTs, credentials or message bodies.

## Repository and host evidence

CommLink owns code, tests, image, Helm chart and install-plan targets. SysOp owns
Basestar-specific values, release references, secret references and tunnel config.
This fits the observed SysOp control-plane structure and its existing separate
product deployment references. No code migration or SysOp modification occurred.

Observed on Basestar, 2026-11-15:

- OrbStack Docker and `k3d-pet`: one Ready K3s v1.31.5 node, 28 CPUs and about
  30.4 GiB assigned to OrbStack. Snapshot usage was 324m CPU / 5.6 GiB RAM.
  Available host disk was about 169 GiB. These are snapshots, not capacity/SLO tests.
- AC system sleep is already disabled and automatic restart enabled. No system
  settings, administrator privileges or firewall changes were used.
- SysOp main `2c7865663ff0135bc341f7e11000146ffcf8fdd8`; Flux `apps` watches
  `./clusters/pet/apps` in the existing private SysOp repository.
- Tunnel `kenning` (`80435c51-39b9-4d55-96fa-2936ff1345ad`) is locally managed
  and reported healthy. Deployment `cloudflared/cloudflared` has one replica,
  Pod label `app: cloudflared`, and existing credentials mounted by Secret ref.
  Credentials were not read. CoreDNS uses `k8s-app: kube-dns` as the chart expects.
- Tunnel source is `clusters/pet/apps/cloudflared/configmap-cloudflared-config.yaml`.
  Add the new exact route before its existing catch-all; preserve all other routes
  and its pinned image. Its rollout may briefly affect existing tunnel traffic.
- Existing registry `k3d-cogignition-registry` publishes on host port 5111.
  Existing manifests use that registry with digest pins. Chart publication and
  Flux source format still require a reviewed SysOp change; no artifact was pushed.

Direct pinned TLS from the Basestar host succeeded against the actual OpenAI
origin, selecting `104.18.38.184` with hostname verification and TLS 1.3. It sent
no HTTP request. Pod-level connectivity and enforcement have not been tested.
Do not route this gateway through the existing Hermes TLS-interception proxy:
that would lose the original end-to-end TLS property. Its configuration stays intact.

Single host, node and tunnel replica make wake dependent on Basestar, OrbStack,
power, router and Internet uptime. There is no demonstrated high availability.

## Concrete changes requiring action-time approval

The parent delegation explicitly requires confirmation immediately before network,
access, credential and security-sensitive deployment changes. The host selection
and chart preparation do not waive that requirement. Prepare exact SysOp diffs and
resolve artifact digests before asking to apply them. Sequence the actions so
authentication exists before a public route can reach the gateway:

1. Create Access app `CommLink Callback Gateway` for the exact hostname, with a
   dedicated `commlink-worker-to-basestar` service token (proposed 30-day prototype
   lifetime) and a Service Auth policy including only that token. No Allow/Bypass
   policy, tags, wildcard or changes to the existing ChatGPT OAuth app. Save the
   secret through the approved secret store and Worker bindings without printing it.
   Record app audience and Client ID as nonsecret chart values. Verify policy and
   token scope, and record expiry/rotation ownership before enabling traffic.
2. Publish the reviewed image/chart to the chosen existing private artifact store,
   pin their content digests, and prepare/apply the SysOp Flux release in a new
   `commlink` namespace. Chart resources: one Deployment (one replica), ClusterIP
   Service on 8080 and NetworkPolicy. No host ports/mounts, PVC, RBAC, service-account
   token or host-network access. Review the chart's tunnel-only ingress and public
   443/DNS egress; verify enforcement in the actual K3s network.
3. Add exactly `commlink-egress.cogignition.cloud` to `kenning`, routing to
   `http://commlink-callback.commlink.svc.cluster.local:8080`. Add a proxied CNAME
   in zone `0a23c29adc1bddff86432ea551f0da7f` to
   `80435c51-39b9-4d55-96fa-2936ff1345ad.cfargotunnel.com`. Keep the catch-all and
   all existing routes. Validate the tunnel config before a controlled rollout;
   check existing application routes after it. Access guards the whole hostname;
   the origin independently rejects missing/wrong-service assertions.
4. Provision Worker `CALLBACK_ACCESS_CLIENT_ID` / `CALLBACK_ACCESS_CLIENT_SECRET`
   secrets and `CALLBACK_TRANSPORT_URL=https://commlink-egress.cogignition.cloud/v1/deliver`.
   Deploy the reviewed source while callback origins remain empty. Preserve every
   unrelated binding and existing OAuth/Grok identity. Verify no direct-fetch fallback.
5. After deployed-network/authentication proof, approve the exact callback origin
   `https://connectors.api.openai.com`. The owning Dot then creates its native
   subscription; record signed challenge, callback acceptance, actual unprompted
   Dot execution and correlated Robut reply separately. No wake claim until all pass.

No administrator prompt is expected for these application operations. If one
appears, stop: explain the exact app/command, why elevated access is needed, scope,
expected result and verification, then obtain Joshua's approval before proceeding.

## Service lifecycle record (proposed, not started)

Owner: Joshua / CommLink, issue HUB-300. Purpose: narrow authenticated OpenAI
callback egress. Supervisor: K3s Deployment, reconciled by SysOp Flux. Expected
lifetime: continuous while enabled; one replica, Recreate upgrades, 10-second
termination grace. Working directory `/app`; actual executable
`/usr/local/bin/commlink-HUB300 /app/gateway.mjs`, OS title `commlink-HUB300`.
Logs: container stdout/stderr, fixed startup/error categories only, no request logs.

Status after approval/deployment:

```sh
kubectl --context k3d-pet -n commlink get deployment,pods,service,networkpolicy
kubectl --context k3d-pet -n commlink rollout status deployment/commlink-callback --timeout=90s
kubectl --context k3d-pet -n commlink logs deployment/commlink-callback --tail=30
```

Planned emergency stop, requiring the same change authority: first clear only the
Worker callback-origin binding, then suspend the dedicated Flux HelmRelease and
scale only this Deployment to zero. The release name must be verified against
the actual SysOp manifest before using these proposed commands:

```sh
flux --context k3d-pet suspend helmrelease commlink-callback -n commlink
kubectl --context k3d-pet -n commlink scale deployment/commlink-callback --replicas=0
```

For rollback, remove only the new hostname route/DNS and revoke its dedicated
service token; keep mailbox state and existing OAuth/Grok services. Reconcile the
approved SysOp revert rather than deleting the shared tunnel. Recovery restores
the reviewed digest/config, resumes the dedicated release, rechecks auth and
pinned TLS, and only then re-enables the callback origin and Dot subscription.

## Cost comparison

Basestar uses existing capacity and tunnel; no new hosting subscription is proposed.
Electricity and operations are still costs. Cloudflare Containers require Workers
Paid, confirmed by the account's read-only API rejection; billing details were not
accessible with this OAuth scope. No paid upgrade occurred.

For a hypothetical `lite` container (256 MiB, 1/16 CPU, 2 GB disk), current pricing
starts at $5/month. 100 active hours consume 25 GiB-hours / 200 GB-hours and at most
375 CPU-minutes, matching the included compute allowances if not shared elsewhere.
At 720 active hours, base plus memory/disk overage is about $6.71; full CPU utilization
adds about $2.79. Worker/DO/network use and other account usage can add charges.
Idle running memory/disk are billed; stopped containers avoid container compute
charges, while cold starts and DO lifetime still matter. These are scenarios,
not a price cap. [Pricing](https://developers.cloudflare.com/containers/platform/pricing/),
[lifecycle](https://developers.cloudflare.com/containers/api/durable-object-container/),
[architecture](https://developers.cloudflare.com/containers/concepts/architecture/).
