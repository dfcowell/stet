# Full image: bundles Chromium so the fetcher can render gated / JS-rendered
# chapters. Both stages share the Playwright base so the better-sqlite3 native
# binary stays ABI-compatible and the bundled browser matches the npm package.
ARG PLAYWRIGHT_IMAGE=mcr.microsoft.com/playwright:v1.60.0-noble

FROM ${PLAYWRIGHT_IMAGE} AS builder
WORKDIR /app
# node-gyp toolchain for better-sqlite3 (in case no prebuilt binary is available).
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
# Browsers are already in the base image; don't re-download during npm install.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY test ./test
RUN npm run build

FROM ${PLAYWRIGHT_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8787 \
    STET_WEB_DIR=/app/web \
    STET_CONFIG_DIR=/config \
    STET_DB_PATH=/data/stet.sqlite \
    STET_STATE_DIR=/data/state
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=builder /app/dist ./dist
COPY web ./web
COPY config /config
RUN mkdir -p /data && chown -R pwuser:pwuser /app /data /config
USER pwuser
EXPOSE 8787
CMD ["node", "dist/src/index.js"]
