FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY shared ./shared
COPY event-bus ./event-bus
COPY cdc ./cdc

RUN npm ci --workspace=shared --workspace=event-bus --workspace=cdc

RUN npm run build --workspace=shared && npm run build --workspace=event-bus && npm run build --workspace=cdc

EXPOSE 3000

CMD ["npm", "start", "--workspace=cdc"]
