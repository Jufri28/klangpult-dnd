FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8095 \
    AUDIO_DIR=/audio \
    DATA_DIR=/data \
    BACKGROUNDS_DIR=/backgrounds \
    PUBLIC_DIR=/app/public

COPY local-server.mjs ./local-server.mjs
COPY dist/client/ ./public/

EXPOSE 8095
USER 99:100
CMD ["node", "local-server.mjs"]
