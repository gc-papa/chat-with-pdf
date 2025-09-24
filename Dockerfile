## Multi-stage Dockerfile for Nuxt 3 (Node 18+)
# - Build stage installs dependencies and builds the Nuxt app
# - Runtime stage runs the compiled Nitro server

FROM node:22-alpine AS build
WORKDIR /app

# Install build deps
COPY package.json pnpm-lock.yaml ./
RUN npm install -g pnpm@7 || true
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY . .
RUN pnpm build

## Runtime image
FROM node:18-alpine AS runtime
WORKDIR /app

# Only copy the built output and production deps
COPY --from=build /app/.output /app/.output
COPY --from=build /app/package.json /app/package.json

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
