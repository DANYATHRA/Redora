FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
# Mount a persistent volume at /data — it holds the SQLite database.
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "server.js"]
