# CommLink callback chart

This chart packages the authenticated HUB-300 callback gateway for a Kubernetes
host. It creates one Deployment, one ClusterIP Service and one NetworkPolicy.
It does not create a namespace, public ingress, credentials, RBAC, storage or
Cloudflare resources. Nothing is installed by the check/package/plan targets.

Chart 0.2.0 also prepares explicit `authMode: vpc-network` for private VPC
exploration. This mode relies on the platform binding, tunnel and NetworkPolicy;
it does not authenticate an individual Worker through a JWT. Default `access`
mode still requires issuer/audience/service Client ID. See the
[VPC proposal and trusted callers](../../docs/plans/hub-300/vpc.md) before choosing
private mode. Never expose private mode through a public ingress or port forward.

Run from the CommLink repository root:

```sh
just prototype-install
just callback-transport-check
just callback-image-build
just callback-image-check
just callback-chart-package
# After replacing the example's placeholders with reviewed nonsecret values:
just basestar-install-plan deploy/basestar.values.example.yaml
```

Checks need Node 22+, OpenSSL, Helm 3+ and just; image checks use the existing
OrbStack Docker context. The image check is temporary, runs without networking
or host mounts, and does not publish a port. The image reuses the existing locked
`jose`/esbuild dependencies; no package download occurs inside the Docker build.

Access mode required values: immutable image repository/digest, Access issuer, this gateway's
app audience, and the dedicated service token's **Client ID** (`common_name` in
its signed JWT). Client Secret is never a chart value. Namespace is supplied by
the installer; proposed Basestar release and namespace are `commlink-callback`
and `commlink`. Placeholder digests are rejected by the schema.

Defaults run UID/GID 1000 with a read-only filesystem, dropped capabilities,
seccomp RuntimeDefault and no service-account token. Requests are 100m CPU,
128 MiB RAM and 32 MiB ephemeral storage; limits are 1 CPU, 256 MiB and 128 MiB.
Ingress is TCP 8080 from matching cloudflared Pods in its namespace. Egress is
cluster DNS and public TCP 443; the application further fixes callback origin,
validates every resolved address and pins the verified TLS connection. Health
checks report only process readiness, not Access or OpenAI connectivity.

Use SysOp's Flux ownership for Basestar deployment after the exact release,
network and access changes are approved. Do not run an independent Helm upgrade
over a Flux-owned release. See the [Basestar runbook](../../docs/plans/hub-300/basestar.md)
for the public route, lifecycle record, validation and rollback proposal.
