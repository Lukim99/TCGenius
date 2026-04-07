FROM node:20-alpine

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /
COPY . .
CMD ["node", "new_engine.js"]
