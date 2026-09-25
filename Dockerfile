# syntax=docker/dockerfile:1
FROM node:24.9-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
# The lockfile contains the current dependency graph; legacy peer resolution is
# required because the existing Nest Swagger package declares a Nest 12 peer.
RUN npm ci --legacy-peer-deps

FROM dependencies AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

FROM dependencies AS test
COPY . .

FROM node:24.9-bookworm-slim AS production
ENV NODE_ENV=production
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
RUN npm prune --omit=dev
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
