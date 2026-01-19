# syntax=docker/dockerfile:1

# Blobulator - Static Vite/React app
# Stage 1: Build with Node
# Stage 2: Serve with nginx

ARG NODE_VERSION=20

# === BUILD STAGE ===
FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json package-lock.json ./
RUN npm ci

# Build the app
COPY . ./
RUN npm run build

# === SERVE STAGE ===
FROM nginx:alpine AS app

# Copy custom nginx config for SPA routing
COPY config/nginx.conf /etc/nginx/conf.d/default.conf

# Copy built static files
COPY --from=builder /app/dist /usr/share/nginx/html

# nginx runs on port 80 by default
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
