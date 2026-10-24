FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY . .
ENV PORT=8080 DATA_DIR=/data
EXPOSE 8080
CMD ["node", "server/index.js"]
