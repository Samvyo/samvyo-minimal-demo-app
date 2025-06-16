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



