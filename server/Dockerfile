# Parallax — Server Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

COPY --from=builder /app/package.json ./
COPY --from=builder /app/dist/ ./dist/

RUN npm install --omit=dev

EXPOSE 4000

ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
