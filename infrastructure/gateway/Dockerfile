FROM nginx:stable-alpine

RUN apk upgrade --no-cache

ENV API_UPSTREAM=api:3001 \
    WEB_UPSTREAM=web:3000 \
    NGINX_ENVSUBST_FILTER="^(API_UPSTREAM|WEB_UPSTREAM)$"

COPY default.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

