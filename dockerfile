
FROM node:18-alpine

WORKDIR /app

COPY package.json package-lock.json ./


RUN npm install

ENV ACCESS_KEY="444fa7bf97155b55c512"
ENV SECRET_ACCESS_KEY="ed3ee024501425e801008baa05a1d14ff2f728c3"

COPY . .


EXPOSE 3600


CMD ["npm", "run", "start"]
