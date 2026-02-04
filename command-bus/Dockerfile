FROM node:20-alpine

WORKDIR /app

# Copy workspace dependencies
COPY package.json package-lock.json ./
COPY shared ./shared
COPY command-bus ./command-bus

# Install dependencies
RUN npm install --workspaces

# Build
RUN npm run build --workspace=@agentic/command-bus

# This is a library module, not a service that runs directly
# It will be imported by other services

CMD ["echo", "CommandBus library loaded successfully"]
