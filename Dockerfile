FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY public ./public
COPY server ./server
USER node
EXPOSE 3000
CMD ["npm", "--prefix", "server", "start"]
