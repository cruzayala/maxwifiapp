# Build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration=production

# Production stage
FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js .
COPY --from=build /app/package.json .
RUN npm install express http-proxy-middleware --omit=dev
EXPOSE 7400
CMD ["node", "server.js"]
