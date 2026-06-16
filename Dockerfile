# Timbre — single-container build. node:sqlite is a Node builtin (>=22), no native
# deps to compile. Mount your music read-only and a data volume for the library DB.
FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run gen:wasm && npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
# ffmpeg is optional — only the loudness scan uses it. Comment out to slim the image.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=build /app/build ./build
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
ENV DATABASE_PATH=/data/timbre.db
ENV ART_CACHE_DIR=/data/art
ENV MUSIC_DIR=/music
VOLUME ["/data"]
EXPOSE 3000
CMD ["node", "build"]
