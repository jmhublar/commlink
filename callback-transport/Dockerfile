FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
# Purpose-named executable; no package manager or download runs in this build.
RUN mv /usr/local/bin/node /usr/local/bin/commlink-HUB300
WORKDIR /app
COPY --chown=1000:1000 dist/gateway.mjs /app/gateway.mjs
USER 1000:1000
ENV COMMLINK_GATEWAY_HOST=0.0.0.0
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/commlink-HUB300", "/app/gateway.mjs"]
