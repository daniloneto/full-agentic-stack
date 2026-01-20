FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY agents/produto-agent ./agents/produto-agent

RUN npm ci --workspace=shared --workspace=agents/produto-agent

RUN npm run build --workspace=shared && npm run build --workspace=agents/produto-agent

EXPOSE 3000

CMD ["npm", "start", "--workspace=agents/produto-agent"]
