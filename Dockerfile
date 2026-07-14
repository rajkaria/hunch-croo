# Hunch Oracle Desk — runtime image for the CROO agent worker + signal-buyer.
#
# One image, two entrypoints: the compose `worker` and `buyer` services run
# this same image with different commands. It runs the TypeScript directly via
# tsx (the desk is run this way in dev too) so there is no build step and no
# compiled-vs-source drift. Node is pinned to 22 to match the repo's toolchain.
FROM node:22-slim

# Pin pnpm to the repo's packageManager version via corepack.
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app

# Copy the whole workspace (minus what .dockerignore strips) so the frozen
# lockfile validates against every workspace manifest, then scope the actual
# install to just the oracle package and its deps. NODE_ENV is deliberately
# NOT "production" here — the worker runs on tsx, which is a devDependency.
COPY . .
RUN pnpm install --frozen-lockfile --filter @hunch/oracle...

# Track-record ledger lives here; the compose file mounts a named volume so it
# survives restarts. Owned by the unprivileged `node` user we drop to below.
RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV NODE_ENV=production
# Ops server: JSON /healthz + /status and the Prometheus /metrics exposition.
ENV ORACLE_HEALTH_PORT=8080
EXPOSE 8080

# Default to the provider desk (shows the agent ONLINE on CROO); the compose
# `buyer` service overrides this with the signal-buyer-loop command.
CMD ["pnpm", "--filter", "@hunch/oracle", "worker"]
