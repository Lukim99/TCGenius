FROM node:18-slim
WORKDIR /
COPY . .
CMD ["node", "new_engine.js"]
