
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./


RUN npm install

ENV ACCESS_KEY=$SDK_ACCESS_KEY
ENV SECRET_ACCESS_KEY=$SDK_SECRET_ACCESS_KEY

COPY . .


EXPOSE 3600


CMD ["npm", "run", "start"]
