FROM node:24-bookworm

# This Dockerfile expects the repository root as the build context.
# The runner imports shared contracts from packages/, so the image needs both
# apps/runner and packages/ available at build time.

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    npm_config_update_notifier=false

WORKDIR /app

COPY apps/runner/package.json apps/runner/package-lock.json ./apps/runner/

WORKDIR /app/apps/runner
RUN npm ci
RUN npx playwright install --with-deps chromium

WORKDIR /app
COPY packages ./packages
COPY apps/runner ./apps/runner

WORKDIR /app/apps/runner
RUN mkdir -p .runner-artifacts

CMD ["npm", "run", "start", "--", "--message-file", "examples/run-execute.request.json"]
