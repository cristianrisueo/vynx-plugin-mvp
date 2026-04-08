# ──────────────────────────────────────────────────────────────────────────────
# VynX Agent — TypeScript/Node.js 24 Container
#
# TypeScript is compiled via `tsc -p tsconfig.scripts.json` at image build time.
# This is required because emitDecoratorMetadata (needed by the AgentKit
# @CreateAction decorator registry) is a TypeScript compiler feature and is not
# supported by esbuild-based runtimes such as tsx.
# The compiled output is placed in .sim-dist/ and executed with `node` directly.
# ──────────────────────────────────────────────────────────────────────────────
FROM node:24-alpine

# Install OS-level dependencies for native Node modules if required.
RUN apk add --no-cache ca-certificates

WORKDIR /app

# Cache dependency installation as a separate layer.
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy the full source tree.
COPY . .

# Run as a non-root user for security hardening.
RUN adduser -D -u 1001 agent && chown -R agent:agent /app
USER agent

# Compile TypeScript with full emitDecoratorMetadata support (tsx/esbuild does not
# implement this TS compiler flag — the decorator registry requires it for AgentKit).
RUN npx tsc -p tsconfig.scripts.json

CMD ["node", ".sim-dist/scripts/simulate_agent.js"]
