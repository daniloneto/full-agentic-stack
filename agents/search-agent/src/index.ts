import { IEventBus, DomainEvent, IEventHandler } from '@agentic/shared';
import { Logger } from '@agentic/shared';
import { SearchAgent } from './search-agent.js';
import amqp from 'amqplib';

const logger = new Logger('SearchAgentMain');

/**
 * Simple EventBus implementation for the Search Agent
 */
class SimpleEventBus implements IEventBus {
  private readonly connection: amqp.Connection;
  private readonly channel: amqp.Channel;
  private readonly handlers: Map<string, IEventHandler[]> = new Map();

  constructor(connection: amqp.Connection, channel: amqp.Channel) {
    this.connection = connection;
    this.channel = channel;
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    const routingKey = `${event.entity}.${event.type}`;
    const message = Buffer.from(JSON.stringify(event));
    this.channel.publish('agentic.events', routingKey, message, { persistent: true });
  }

  async publishBatch<T>(events: DomainEvent<T>[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  async subscribe<T>(handler: IEventHandler<T>, eventType: string): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    handlers.push(handler as IEventHandler);
    this.handlers.set(eventType, handlers);

    const queue = `search.${eventType}`;
    await this.channel.assertQueue(queue, { durable: true });
    await this.channel.bindQueue(queue, 'agentic.events', `*.${eventType}`);

    this.channel.consume(queue, async (msg) => {
      if (msg) {
        try {
          const event = JSON.parse(msg.content.toString()) as DomainEvent<T>;
          await handler.handle(event);
          this.channel.ack(msg);
        } catch (error) {
          logger.error('Error handling message', error);
          this.channel.nack(msg, false, false);
        }
      }
    });
  }

  async unsubscribe(handler: IEventHandler, eventType: string): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    const index = handlers.indexOf(handler);
    if (index > -1) {
      handlers.splice(index, 1);
      this.handlers.set(eventType, handlers);
    }
  }
}

async function createEventBus(config: { url: string }): Promise<IEventBus> {
  const connection = await amqp.connect(config.url) as any;
  const channel = await connection.createChannel();
  await channel.assertExchange('agentic.events', 'topic', { durable: true });
  return new SimpleEventBus(connection, channel);
}

async function main() {
  try {
    const eventBus = await createEventBus({
      url: process.env.RABBITMQ_URL || 'amqp://localhost',
    });

    const agent = new SearchAgent({
      eventBus,
      opensearchUrl: process.env.OPENSEARCH_URL || 'https://localhost:9200',
      rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
    });

    await agent.initialize();
    logger.info('✓ Search Agent started successfully');

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
    logger.error('Failed to start Search Agent', error);
    process.exit(1);
  }
}

main();