/**
 * Process entry point: validate config → migrate → wire services → listen.
 * Handles graceful shutdown so WhatsApp/Chromium and the DB close cleanly.
 */
import http from 'node:http';
import { config, ConfigError } from './config';
import { logger, childLogger } from './utils/logger';
import { closeDb, db, runMigrations, runSeeds } from './database';
import { buildContainer, startRuntime, stopRuntime, wireEventHandlers } from './container';
import { createApp } from './app';
import { ensureDir } from './config/env';

const log = childLogger('server');

async function bootstrap(): Promise<void> {
  ensureDir(config.paths.data);
  ensureDir(config.paths.backups);

  log.info('Starting WhatsApp Group Assistant', {
    env: config.env,
    timezone: config.locale.timezone,
    db: config.db.client,
    dryRun: config.whatsapp.dryRun,
  });

  if (config.db.autoMigrate) {
    await runMigrations();
    // Seeds are idempotent, so it is safe to run them on every boot.
    await runSeeds();
  }

  const container = buildContainer();
  // Apply persisted timezone/locale overrides before the scheduler reads them.
  await container.setup.hydrate();
  if (!(await container.setup.isComplete())) {
    log.warn('First-boot setup is not complete — the dashboard will open the setup wizard');
  }
  const unwire = wireEventHandlers(container);
  const app = createApp(container);
  const server = http.createServer(app);

  await new Promise<void>((resolve) => server.listen(config.server.port, config.server.host, resolve));
  log.info(`Dashboard ready at http://${config.server.host}:${config.server.port}`);

  // WhatsApp initialisation is intentionally not awaited — the dashboard must
  // be reachable so the operator can see the QR code and connection errors.
  void startRuntime(container).catch((err) => log.error('Runtime start failed', { error: err.message }));

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal} — shutting down gracefully`);

    const forceExit = setTimeout(() => {
      log.error('Graceful shutdown timed out — forcing exit');
      process.exit(1);
    }, 20_000);
    forceExit.unref();

    server.close();
    unwire();
    await stopRuntime(container);
    await closeDb();
    clearTimeout(forceExit);
    log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    log.error('Uncaught exception', { error: err.message, stack: err.stack });
    void shutdown('uncaughtException');
  });
}

bootstrap().catch((err) => {
  if (err instanceof ConfigError) {
    // eslint-disable-next-line no-console
    console.error(`\n${err.message}\n`);
    process.exit(78); // EX_CONFIG
  }
  logger.error('Fatal startup error', { error: (err as Error).message, stack: (err as Error).stack });
  void db()
    .destroy()
    .catch(() => undefined);
  process.exit(1);
});
