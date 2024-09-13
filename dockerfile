
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./


RUN npm install

ENV ACCESS_KEY=$ACCESS_KEY
ENV SECRET_ACCESS_KEY=$SECRET_ACCESS_KEY

COPY . .


EXPOSE 3600


CMD ["npm", "run", "start"]
