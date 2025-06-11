#!/bin/bash
# Manual deployment script for samvyo website
# Usage: ./deploy.sh [dev|prod]

ENV=$1

if [ "$ENV" != "dev" ] && [ "$ENV" != "prod" ]; then
  echo "Usage: ./deploy.sh [dev|prod]"
  exit 1
fi

# Source environment variables based on environment
if [ "$ENV" == "dev" ]; then
  echo "Loading development environment variables..."
  source .env.dev
else
  echo "Loading production environment variables..."
  source .env.prod
fi

# Docker login
sudo docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD

echo "Building Docker image with tag: vidDemo-$VERSION"
sudo docker build \
  --build-arg SDK_ACCESS_KEY=$SDK_ACCESS_KEY  \
  --build-arg SDK_SECRET_ACCESS_KEY=$SDK_SECRET_ACCESS_KEY \
  -t $CI_REGISTRY:vidDemo-$VERSION \
  .

echo "Pushing Docker image to Docker Hub..."


sudo docker push $CI_REGISTRY:vidDemo-$VERSION

#echo "Stopping and removing existing containers on port 4100..."
#sudo docker ps -q --filter 'publish=4100' | xargs -r sudo docker stop
#sudo docker ps -q --filter 'publish=4100' | xargs -r sudo docker rm

#echo "Starting new container..."
#if [ "$ENV" == "dev" ]; then
#  sudo docker run -d -p 4100:4100 --network=meetnow-app-server-db_default -v ~/.aws:/root/.aws vidscale0509/meetnow-server-$ENV:$VERSION
#else
 # sudo docker run -d -p 4100:4100 -v ~/.aws:/root/.aws vidscale0509/meetnow-server-$ENV:$VERSION
#fi

#echo "Deployment completed successfully!"


