FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY agents/pedido-agent ./agents/pedido-agent

RUN npm ci --workspace=shared --workspace=agents/pedido-agent

RUN npm run build --workspace=shared && npm run build --workspace=agents/pedido-agent

EXPOSE 3000

CMD ["npm", "start", "--workspace=agents/pedido-agent"]
