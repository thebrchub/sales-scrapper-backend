# ================================
# Build stage
# ================================
FROM node:22-slim AS builder

WORKDIR /app

# Install dependencies (cached layer)
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

# Copy source and build
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

# ================================
# Runtime stage
# ================================
FROM node:22-slim

WORKDIR /app

# Puppeteer system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-khmeros fonts-freefont-ttf \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Production dependencies only
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --ignore-scripts

# Copy compiled JS from builder
COPY --from=builder /app/dist dist/

# Non-root user for security
RUN groupadd -r scraper && useradd -r -g scraper scraper
USER scraper

CMD ["node", "dist/index.js"]
