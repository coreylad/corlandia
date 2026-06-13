FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN apk add --no-cache docker-cli docker-cli-compose git \
  && npm install --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["npm", "start"]
