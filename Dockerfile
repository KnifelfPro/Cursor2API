FROM node:22-slim

WORKDIR /app

ENV PORT=3000 \
    CURSOR_WORKDIR=/workspace \
    CURSOR_STORE_DIR=/data/sdk-store \
    CURSOR_HOME_DIR=/data/home

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
RUN mkdir -p /workspace /data

EXPOSE 3000

CMD ["node", "src/server.js"]
