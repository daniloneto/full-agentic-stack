import { Logger } from '@agentic/shared';
import { PedidoAgent } from './pedido-agent.js';
import { RabbitMQEventBus } from '@agentic/event-bus';
import { RabbitMQCommandBus } from '@agentic/command-bus';

const logger = new Logger('PedidoAgentMain');

const rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://localhost';

const eventBus = new RabbitMQEventBus({
  url: rabbitmqUrl,
  prefetch: 10,
});

const commandBus = new RabbitMQCommandBus({
  url: rabbitmqUrl,
  prefetch: 10,
});

const agent = new PedidoAgent({
  eventBus,
  commandBus,
  databaseUrl: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/agentic',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  rabbitmqUrl: rabbitmqUrl,
});

try {
  await agent.initialize();
  logger.info('✓ Pedido Agent started successfully');

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully...');
    await agent.stop();
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('SIGINT received, shutting down gracefully...');
    await agent.stop();
    process.exit(0);
  });
} catch (error) {
  logger.error('Failed to start Pedido Agent', error);
  process.exit(1);
}
