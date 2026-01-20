FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY event-bus ./event-bus
COPY api-gateway ./api-gateway

RUN npm ci --workspace=shared --workspace=event-bus --workspace=api-gateway

RUN npm run build --workspace=shared && npm run build --workspace=event-bus && npm run build --workspace=api-gateway

EXPOSE 3000

CMD ["npm", "start", "--workspace=api-gateway"]
