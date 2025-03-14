# Stage 1: Build
FROM node:22.14-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json for caching dependencies
COPY package.json package-lock.json ./

# Install production and development dependencies
RUN npm ci

# Copy the rest of the project files
COPY . .

# Compile TypeScript files
RUN npm run build

# Remove unnecessary files after build
RUN npm prune --production
RUN rm -rf ./src \
           ./package-lock.json \
           ./.npmrc \
           ./tsconfig.json \
           ./tsconfig.prod.json

# Stage 2: Production
FROM node:22.14-alpine

WORKDIR /app

# Copy only necessary files from the build stage
COPY --from=build /app /app

# Install packages
RUN apk add --no-cache \
    git=2.47.2-r0 \
    jq=1.7.1-r0 \
    curl=8.12.0-r0

# Ensure scripts and compiled TypeScript files are executable
RUN chmod +x /app/scripts/*.sh
RUN chmod +x /app/dist/src/release.js

# Set the entrypoint script
ENTRYPOINT ["/bin/sh", "/app/scripts/entrypoint.sh"]
