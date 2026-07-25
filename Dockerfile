ARG VERSION=2026.07.25.7

FROM golang:1.26.4-alpine AS engine
WORKDIR /src/engine
COPY engine/go.mod engine/go.sum ./
RUN go mod download
COPY engine/ ./
RUN GOOS=js GOARCH=wasm go build -o dist/engine.wasm . \
    && cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" dist/wasm_exec.js

FROM node:22-alpine AS frontend
ARG VITE_RELAY_WS_URL
ENV VITE_RELAY_WS_URL=${VITE_RELAY_WS_URL}
# This stage only receives frontend/, so the VERSION file the build would
# otherwise read is not here; pass the release version in for the UI to show.
ARG VERSION
ENV VITE_APP_VERSION=${VERSION}
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
COPY --from=engine /src/engine/dist /src/engine/dist
RUN npm run build

FROM nginx:1.29-alpine
ARG VERSION
LABEL org.opencontainers.image.title="localssh" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.source="https://github.com/bradsec/localssh"
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /src/frontend/dist /usr/share/nginx/html
EXPOSE 80
