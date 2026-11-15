default:
    @just --list

prototype-install:
    cd cloudflare && npm ci --cache /tmp/commlink-npm-cache

prototype-check:
    cd cloudflare && npm run check

prototype-build:
    cd cloudflare && npm run build

callback-transport-build:
    cd cloudflare && node scripts/build-callback-gateway.mjs

callback-transport-check: callback-transport-build
    node --test callback-transport/*.test.mjs

# Local image build only. Explicit existing OrbStack runtime; no push or deploy.
callback-image-build: callback-transport-build
    docker --context orbstack build --tag commlink-callback:hub300-review callback-transport

# Eight-second synthetic test; no network, published port, host mount or lasting container.
callback-image-check:
    docker --context orbstack run --rm --name commlink-hub300-smoke --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 -i --entrypoint /usr/local/bin/commlink-HUB300 commlink-callback:hub300-review --input-type=module < callback-transport/smoke.mjs

# Synthetic render only; no cluster connection or install.
callback-chart-check:
    helm lint charts/commlink-callback -f charts/commlink-callback/ci/test-values.yaml --strict
    helm template commlink-callback charts/commlink-callback --namespace commlink -f charts/commlink-callback/ci/test-values.yaml > /dev/null

# Builds a local release artifact; does not publish or deploy.
callback-chart-package destination="/tmp/commlink-chart": callback-chart-check
    mkdir -p {{quote(destination)}}
    helm package charts/commlink-callback --destination {{quote(destination)}}

# Install proposal: supply reviewed nonsecret values. SysOp/Flux owns application.
basestar-install-plan values:
    helm template commlink-callback charts/commlink-callback --namespace commlink -f {{quote(values)}}
