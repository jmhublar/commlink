default:
    @just --list

prototype-install:
    cd cloudflare && npm ci --cache /tmp/commlink-npm-cache

prototype-check:
    cd cloudflare && npm run check

prototype-build:
    cd cloudflare && npm run build

callback-transport-check:
    node --test callback-transport/transport.test.mjs
