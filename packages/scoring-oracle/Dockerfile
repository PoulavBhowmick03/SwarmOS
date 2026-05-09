FROM node:20-slim

WORKDIR /app

COPY packages/scoring-oracle/package*.json ./
RUN npm install

COPY packages/scoring-oracle ./
RUN npm run build

CMD ["npm", "run", "start"]
