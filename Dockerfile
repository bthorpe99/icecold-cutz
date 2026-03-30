FROM node:20-alpine

# Install build tools for better-sqlite3
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --production

COPY . .

# Data dir for SQLite (will be overridden by Fly volume mount)
RUN mkdir -p /data

EXPOSE 8080

CMD ["node", "server.js"]
