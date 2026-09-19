FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY process-manager.js ./

ENV NODE_ENV=production \
    GENIEACS_CWMP_ACCESS_LOG_FILE=/dev/stdout \
    GENIEACS_NBI_ACCESS_LOG_FILE=/dev/stdout

EXPOSE 7547 7557
CMD ["node", "process-manager.js"]
