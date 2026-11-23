FROM node:20-alpine AS base

# Create a non-root user to run the app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Install dependencies first (cached layer)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy application source
COPY . .

# Ensure uploads directory exists and is owned by appuser
RUN mkdir -p /app/../uploads/signatures && \
    chown -R appuser:appgroup /app /app/../uploads

USER appuser

EXPOSE 3000

# Healthcheck — ping the CSRF endpoint (requires a running DB)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/csrf-token || exit 1

CMD ["node", "server.js"]
