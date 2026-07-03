# Stage 1: Build
FROM node:24.18.0-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json for caching dependencies
COPY package.json package-lock.json ./

# Install production and development dependencies
RUN npm ci

# Copy the rest of the project files
COPY . .

# Compile TypeScript files
RUN npm run build
RUN test -f /app/dist/src/main.js

# Remove unnecessary files after build
RUN npm prune --production
RUN rm -rf ./src \
           ./package-lock.json \
           ./.npmrc \
           ./tsconfig.json \
           ./tsconfig.prod.json

# Stage 2: Production
FROM node:24.18.0-alpine

WORKDIR /app

# Copy only necessary files from the build stage
COPY --from=build /app /app

# Install packages
RUN apk add --no-cache git

ENTRYPOINT ["node", "/app/dist/src/main.js"]
