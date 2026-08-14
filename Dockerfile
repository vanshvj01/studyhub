# Railway always builds with a Dockerfile when it finds one, which sidesteps
# builder auto-detection entirely. Every dependency here is pure JavaScript
# (bcryptjs, not bcrypt), so alpine needs no compiler toolchain.
FROM node:20-alpine

WORKDIR /app

# Dependencies first: this layer is cached unless package.json or the lockfile
# changes, so ordinary source edits rebuild in seconds.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

# Documentation only — Railway injects PORT at runtime and the app reads it.
EXPOSE 3000

CMD ["npm", "start"]
