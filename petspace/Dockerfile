FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY lib ./lib
COPY public ./public
COPY server.js ./
RUN mkdir -p /data && chown node:node /data
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
USER node
CMD ["node", "server.js"]
