# Build from the repo root: `docker build -f services/chat-ui/Dockerfile .`
# pnpm workspace mode keeps the lockfile and root config there. The CDK image
# asset pins the platform to linux/amd64, because the Express Mode
# CloudFormation resource has no CPU architecture property.

FROM public.ecr.aws/docker/library/node:24-slim AS deps
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .pnpmrc ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
COPY services/chat-ui/package.json services/chat-ui/
RUN pnpm install --frozen-lockfile --filter @govuk-chat-v2/chat-ui

FROM public.ecr.aws/docker/library/node:24-slim AS builder
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /repo ./
COPY tsconfig.json ./
COPY services/chat-ui services/chat-ui
RUN npm install -g "$(node -p "require('./package.json').packageManager")"
RUN cd services/chat-ui && pnpm exec next build

FROM public.ecr.aws/docker/library/node:24-slim AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

# With outputFileTracingRoot at the repo root, the standalone output keeps the
# workspace layout, so server.js sits under services/chat-ui rather than at
# the top of the tree.
WORKDIR /app
COPY --from=builder --chown=nextjs:nodejs /repo/services/chat-ui/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/services/chat-ui/.next/static ./services/chat-ui/.next/static

USER nextjs
WORKDIR /app/services/chat-ui
EXPOSE 3000
CMD ["node", "server.js"]
