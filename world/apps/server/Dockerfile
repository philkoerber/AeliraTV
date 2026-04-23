FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared-world/package.json packages/shared-world/package.json

RUN npm install

COPY . .

EXPOSE 2567

CMD ["npm", "run", "dev", "--workspace", "apps/server"]

