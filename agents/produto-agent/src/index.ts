import { IEventBus, DomainEvent, IEventHandler } from '@agentic/shared';
import { Logger } from '@agentic/shared';
import { ProdutoAgent } from './produto-agent.js';
import amqp from 'amqplib';

const logger = new Logger('ProdutoAgentMain');

// Simple EventBus implementation for Produto Agent
class SimpleEventBus implements IEventBus {
  private connection: any;
  private channel: any;
  private readonly handlers: Map<string, IEventHandler<any>[]> = new Map();
  private readonly agentName: string;

  constructor(agentName: string) {
    this.agentName = agentName;
  }

  async connect(url: string): Promise<void> {
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange('agentic.events', 'topic', { durable: true });
  }

  async subscribe<T>(handler: IEventHandler<T>, eventType: string): Promise<void> {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType)!.push(handler);

    const queueName = `${this.agentName}.${eventType}`;
    await this.channel.assertQueue(queueName, { durable: true });
    await this.channel.bindQueue(queueName, 'agentic.events', `*.${eventType.toLowerCase()}`);

    await this.channel.consume(queueName, async (msg: any) => {
      if (msg) {
        try {
          const event = JSON.parse(msg.content.toString());
          await handler.handle(event);
          this.channel.ack(msg);
        } catch (error) {
          logger.error('Error handling message', { error: String(error) });
          this.channel.nack(msg, false, false);
        }
      }
    });
  }

  async unsubscribe<T>(handler: IEventHandler<T>, eventType: string): Promise<void> {
    const handlers = this.handlers.get(eventType);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  async publish<T>(event: DomainEvent<T>): Promise<void> {
    const message = Buffer.from(JSON.stringify(event));
    const routingKey = `${event.entity.toLowerCase()}.${event.type.toLowerCase()}`;
    this.channel.publish('agentic.events', routingKey, message, {
      persistent: true,
      contentType: 'application/json',
    });
  }

  async publishBatch<T>(events: DomainEvent<T>[]): Promise<void> {
    for (const event of events) {
      await this.publish(event);
    }
  }

  async close(): Promise<void> {
    if (this.channel) await this.channel.close();
    if (this.connection) await this.connection.close();
  }
}

async function createEventBus(config: { url: string }): Promise<IEventBus> {
  const eventBus = new SimpleEventBus('produto-agent');
  await eventBus.connect(config.url);
  return eventBus;
}

async function main() {
  try {
    const eventBus = await createEventBus({
      url: process.env.RABBITMQ_URL || 'amqp://localhost',
    });    const agent = new ProdutoAgent({
      eventBus,
      databaseUrl: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/agentic',
      redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
      rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
    });

    await agent.initialize();
    logger.info('✓ Produto Agent started successfully');

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
    logger.error('Failed to start Produto Agent', error);
    process.exit(1);
  }
}

main();
