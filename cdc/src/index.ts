import { createCDC } from './cdc.js';
import { Logger } from '@agentic/shared';

const logger = new Logger('Main');

try {
  const cdc = await createCDC();
  await cdc.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down...');
    await cdc.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down...');
    await cdc.stop();
    process.exit(0);
  });
} catch (error) {
  logger.error('Failed to start application', error);
  process.exit(1);
}
