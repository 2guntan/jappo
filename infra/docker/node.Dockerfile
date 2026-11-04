# Multi-stage build for the API and worker (bundled with tsup).
# Build: docker build -f infra/docker/node.Dockerfile --build-arg APP=api -t jappo-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP=api
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jappo/${APP} build

FROM base AS runtime
ARG APP=api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/apps/${APP}/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/assets ./assets
COPY --from=build /repo/apps/api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund @node-rs/argon2@2 pg@8 pg-boss@10 pino@9 @aws-sdk/client-s3@3 @aws-sdk/s3-request-presigner@3 nodemailer@7 handlebars@4 \
  fastify@5 @fastify/cookie@11 @fastify/cors@11 @fastify/helmet@13 @fastify/multipart@9 @fastify/rate-limit@10 @fastify/swagger@9 @fastify/swagger-ui@5 \
  fastify-plugin@5 fastify-type-provider-zod@6 zod@4 drizzle-orm@0.44 jose@6 otpauth@9 prom-client@15 uuid@11 decimal.js@10 \
  pdf-lib@1 playwright@1.63.0
# Chromium for PDF rendering (dossier, contracts, invoices, statements, reports).
RUN if [ "$APP" = "api" ] || [ "$APP" = "worker" ]; then npx playwright install --with-deps chromium; fi
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
