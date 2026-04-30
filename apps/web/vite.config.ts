import { existsSync, readFileSync } from 'node:fs';
import { createLogger, defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function isWslRuntime() {
  if (process.env.WSL_DISTRO_NAME) {
    return true;
  }

  if (!existsSync('/proc/version')) {
    return false;
  }

  return readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft');
}

const runsInWsl = isWslRuntime();
const defaultApiProxyTarget = runsInWsl ? 'http://host.docker.internal:8080' : 'http://localhost:8080';
const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? defaultApiProxyTarget;

const logger = createLogger();
const loggerInfo = logger.info.bind(logger);

logger.info = (message, options) => {
  const visibleMessage = message
    .split('\n')
    .filter((line) => !line.includes('Network:'))
    .join('\n');

  if (visibleMessage.trim()) {
    loggerInfo(visibleMessage, options);
  }
};

export default defineConfig({
  plugins: [react()],
  server: {
    host: runsInWsl ? '0.0.0.0' : 'localhost',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
  customLogger: logger,
});
