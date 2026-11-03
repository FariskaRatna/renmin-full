FROM node:24.22.0-alpine3.24
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
EXPOSE 5173
CMD ["npm", "run", "dev"]
