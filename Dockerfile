# Multi-stage build - automatically handles schematic-renderer
FROM oven/bun:1 AS deps
WORKDIR /app

# Set Puppeteer environment variables BEFORE installing
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_CACHE_DIR=/tmp/.puppeteer

# Copy package files
COPY package.json ./
COPY frontend/package.json ./frontend/package.json.orig
COPY libs/*.tgz ./libs/

# Remove lock files to avoid conflicts
RUN rm -f bun.lockb frontend/bun.lockb

# Extract the custom library
RUN cd libs && \
    ls *.tgz | head -1 | xargs -I {} tar -xzf {} && \
    mv package schematic-renderer

# Automatically remove the file: reference from frontend package.json
RUN sed '/schematic-renderer.*file:/d' frontend/package.json.orig > frontend/package.json

# Install dependencies WITHOUT running any postinstall scripts
RUN cd frontend && bun install --ignore-scripts
RUN bun install --ignore-scripts

# Copy the library manually after installation
RUN mkdir -p frontend/node_modules node_modules && \
    cp -r libs/schematic-renderer frontend/node_modules/ && \
    cp -r libs/schematic-renderer node_modules/

FROM oven/bun:1 AS frontend-builder
WORKDIR /app
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY frontend/ ./frontend/
RUN cd frontend && bun run build

FROM oven/bun:1 AS backend-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
COPY --from=frontend-builder /app/frontend/dist ./dist-frontend
RUN bunx tsc

FROM node:18-slim AS runtime

RUN apt-get update && apt-get install -y \
    chromium fonts-liberation libasound2 libatk-bridge2.0-0 \
    libdrm2 libgtk-3-0 libgtk-4-1 libu2f-udev libvulkan1 \
    xdg-utils curl && rm -rf /var/lib/apt/lists/*

# Use the existing node user instead of creating new one

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV NODE_ENV=production

WORKDIR /app

COPY --from=backend-builder --chown=node:node /app/dist ./dist
COPY --from=backend-builder --chown=node:node /app/dist-frontend ./dist-frontend
COPY --from=backend-builder --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-builder --chown=node:node /app/package.json ./

# Copy the startup and healthcheck scripts
COPY --chown=node:node start.sh ./start.sh
COPY --chown=node:node healthcheck.sh ./healthcheck.sh
RUN chmod +x start.sh healthcheck.sh

RUN mkdir -p /app/uploads /app/logs && chown -R node:node /app

USER node

# Default port, but can be overridden via PORT environment variable
ENV PORT=3000
EXPOSE 3000

# Healthcheck uses PORT environment variable via script
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD ["./healthcheck.sh"]

CMD ["./start.sh"]