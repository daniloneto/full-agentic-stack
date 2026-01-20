FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY agents/cliente-agent ./agents/cliente-agent

RUN npm ci --workspace=shared --workspace=agents/cliente-agent

RUN npm run build --workspace=shared && npm run build --workspace=agents/cliente-agent

EXPOSE 3000

CMD ["npm", "start", "--workspace=agents/cliente-agent"]
