ARG VERSION=2026.07.25.2

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ARG VERSION
LABEL org.opencontainers.image.title="localssh-relay" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/bradsec/localssh"
ENV NODE_ENV=production
USER node
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/scripts/run-relay.js"]
