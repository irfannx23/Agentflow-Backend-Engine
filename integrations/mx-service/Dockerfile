FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY actions ./actions
COPY builders ./builders
COPY core ./core
COPY engines ./engines
COPY integrations ./integrations
COPY registry ./registry
COPY runtime ./runtime
COPY testing ./testing
COPY triggers ./triggers
COPY validators ./validators
RUN pnpm build

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist/integrations/mx-service ./dist/integrations/mx-service

CMD ["node", "dist/integrations/mx-service/mx-service.js"]
