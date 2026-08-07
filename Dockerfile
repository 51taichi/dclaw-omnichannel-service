FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src
COPY public ./public
COPY scripts/backfill-outbound-webhooks.js ./scripts/backfill-outbound-webhooks.js

EXPOSE 8765

CMD ["npm", "start"]
