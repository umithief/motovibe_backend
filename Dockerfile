FROM node:20-bookworm-slim
ENV NODE_ENV=production PORT=5001
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY . .
RUN mkdir -p uploads && chown node:node uploads
USER node
EXPOSE 5001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:5001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
