FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY agents/search-agent ./agents/search-agent

RUN npm ci --workspace=shared --workspace=agents/search-agent

RUN npm run build --workspace=shared && npm run build --workspace=agents/search-agent

EXPOSE 3000

CMD ["npm", "start", "--workspace=agents/search-agent"]
