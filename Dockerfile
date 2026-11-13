FROM node:24-bookworm AS build
WORKDIR /app

# The lockfile references public GitHub dependencies over SSH.
RUN git config --global url."https://github.com/".insteadOf ssh://git@github.com/
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG TELEGRAM_API_ID
ARG TELEGRAM_API_HASH
ARG BASE_URL=http://localhost:8080/
RUN test -n "$TELEGRAM_API_ID" && test -n "$TELEGRAM_API_HASH" \
    || (echo 'Set TELEGRAM_API_ID and TELEGRAM_API_HASH before building.' >&2; exit 1)
RUN npm run build:production

FROM nginx:alpine
COPY --from=build /app/dist/ /usr/share/nginx/html/
