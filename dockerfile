FROM node:18-alpine

ARG SDK_ACCESS_KEY
ARG SDK_SECRET_ACCESS_KEY

ENV ACCESS_KEY=$SDK_ACCESS_KEY
ENV SECRET_ACCESS_KEY=$SDK_SECRET_ACCESS_KEY

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install

COPY . .

EXPOSE 3600

CMD ["npm", "run", "start"]
