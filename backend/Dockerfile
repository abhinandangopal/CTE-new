# --- Stage 1: Build ---
FROM node:18-alpine as builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# Compile TypeScript to JavaScript
RUN npm run build

# --- Stage 2: Run ---
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --production

# Copy built JS files from Stage 1
COPY --from=builder /app/dist ./dist
# Copy .env file (We will actually handle env vars via Docker, but this is a backup)
COPY .env ./

EXPOSE 8081

# Start the compiled javascript
CMD ["node", "dist/server.js"]