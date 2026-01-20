FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY agents/cache-agent ./agents/cache-agent

RUN npm ci --workspace=shared --workspace=agents/cache-agent

RUN npm run build --workspace=shared && npm run build --workspace=agents/cache-agent

EXPOSE 3000

CMD ["npm", "start", "--workspace=agents/cache-agent"]
