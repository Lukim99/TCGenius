FROM node:20-alpine
WORKDIR /
COPY . .
CMD ["node", "new_engine.js"]
