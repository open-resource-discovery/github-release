# Stage 1: Build
FROM node:24.18.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

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
FROM node:24.18.0-alpine

WORKDIR /app

COPY --from=build /app /app
RUN apk add --no-cache git

ENTRYPOINT ["node", "/app/dist/src/main.js"]
