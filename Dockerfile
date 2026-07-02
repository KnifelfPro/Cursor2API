# syntax=docker/dockerfile:1
FROM node:22-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    CURSOR_WORKDIR=/workspace \
    CURSOR_STORE_DIR=/data/sdk-store \
    CURSOR_HOME_DIR=/data/home

COPY package*.json ./
# Cache mount keeps the npm cache out of the image layer and speeds up rebuilds.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --no-audit --no-fund

COPY src ./src
RUN mkdir -p /workspace /data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||3000)+"/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

CMD ["node", "src/server.js"]
