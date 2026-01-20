FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY agents/audit-agent ./agents/audit-agent

RUN npm ci --workspace=shared --workspace=agents/audit-agent

RUN npm run build --workspace=shared && npm run build --workspace=agents/audit-agent

EXPOSE 3000

CMD ["npm", "start", "--workspace=agents/audit-agent"]
