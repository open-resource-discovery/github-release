# Stage 1: Build
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build

WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm install --global --ignore-scripts npm@11.20.0 && npm ci

COPY . .
RUN npm run build
RUN test -f /app/dist/src/main.js

RUN npm prune --production
RUN rm -rf ./src \
           ./package-lock.json \
           ./.npmrc \
           ./tsconfig.json \
           ./tsconfig.prod.json

# Stage 2: Production
FROM node:26.13.1-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5

WORKDIR /app

COPY --from=build /app /app
RUN apk add --no-cache git

ENTRYPOINT ["node", "/app/dist/src/main.js"]
