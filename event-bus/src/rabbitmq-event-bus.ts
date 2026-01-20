import * as amqp from 'amqplib';
import { DomainEvent, IEventBus, IEventHandler, Logger } from '@agentic/shared';

interface RabbitMQConfig {
  url: string;
  prefetch?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * RabbitMQ Implementation of Event Bus
 * Features:
 * - Connection pooling
 * - Auto-reconnect with exponential backoff
 * - Dead Letter Queue for failed messages
 * - Message persistence
 */
export class RabbitMQEventBus implements IEventBus {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private readonly logger: Logger;
  private readonly config: Required<RabbitMQConfig>;
  private readonly handlers: Map<string, IEventHandler<any>[]> = new Map();
  private isConnected = false;

  // Exchanges and Queues
  private readonly MAIN_EXCHANGE = 'agentic.events';
  private readonly DLX_EXCHANGE = 'agentic.dlx';
  private readonly DLQ_QUEUE = 'agentic.dlq';

  constructor(config: RabbitMQConfig) {
    this.logger = new Logger('RabbitMQEventBus');
    this.config = {
      url: config.url,
      prefetch: config.prefetch || 10,
      maxRetries: config.maxRetries || 3,
      retryDelayMs: config.retryDelayMs || 5000,
    };
  }

  /**
   * Connect to RabbitMQ with exponential backoff retry
   */
  async connect(): Promise<void> {
    if (this.isConnected && this.connection) {
      this.logger.info('Already connected to RabbitMQ');
      return;
    }

    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {      try {
        this.logger.info('Connecting to RabbitMQ...', { attempt: retries + 1 });
        
        this.connection = await amqp.connect(this.config.url) as any;
        this.channel = await (this.connection as any).createChannel();

        // Set prefetch
        await this.channel!.prefetch(this.config.prefetch);

        // Setup exchanges
        await this.setupExchanges();
        
        // Setup DLQ
        await this.setupDLQ();

        // Handle connection errors
        (this.connection as any).on('error', (err: Error) => {
          this.logger.error('RabbitMQ connection error', { error: String(err) });
          this.isConnected = false;
        });

        (this.connection as any).on('close', () => {
          this.logger.warn('RabbitMQ connection closed');
          this.isConnected = false;
        });

        this.isConnected = true;
        this.logger.info('✓ Connected to RabbitMQ');
        return;
      } catch (error) {
        retries++;
        const delayMs = Math.min(1000 * Math.pow(2, retries), 30000);
        this.logger.warn(
          `RabbitMQ connection failed, retrying in ${delayMs}ms...`,
          { error: error instanceof Error ? error.message : String(error), attempt: retries }
        );

        if (retries >= maxRetries) {
          throw new Error(`Failed to connect to RabbitMQ after ${maxRetries} attempts`);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Setup RabbitMQ exchanges
   */
  private async setupExchanges(): Promise<void> {    if (!this.channel) throw new Error('Channel not initialized');

    // Main topic exchange for domain events
    await this.channel.assertExchange(this.MAIN_EXCHANGE, 'topic', {
      durable: true,
    });

    // Dead Letter Exchange
    await this.channel.assertExchange(this.DLX_EXCHANGE, 'topic', {
      durable: true,
    });

    this.logger.debug('✓ Exchanges configured');
  }

  /**
   * Setup Dead Letter Queue
   */
  private async setupDLQ(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    await this.channel.assertQueue(this.DLQ_QUEUE, {
      durable: true,
    });

    await this.channel.bindQueue(this.DLQ_QUEUE, this.DLX_EXCHANGE, '');
    this.logger.debug('✓ Dead Letter Queue configured');
  }
  /**
   * Publish a domain event
   */
  async publish<T>(
    event: DomainEvent<T>
  ): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    try {
      const message = Buffer.from(JSON.stringify(event));
      const routingKey = `${event.entity}.${event.type}`;

      const ok = this.channel.publish(
        this.MAIN_EXCHANGE,
        routingKey,
        message,
        {
          persistent: true,
          contentType: 'application/json',
          contentEncoding: 'utf-8',
          headers: {
            'x-event-id': event.id,
            'x-correlation-id': event.metadata.correlationId,
          },
        }
      );

      if (!ok) {
        this.logger.warn('Publisher backpressure detected', {
          eventId: event.id,
          eventType: event.type,
        });
      }

      this.logger.debug('Event published', {
        eventId: event.id,
        eventType: event.type,
        routingKey,
      });
    } catch (error) {
      this.logger.error('Failed to publish event', error, {
        eventId: event.id,
        eventType: event.type,
      });
      throw error;
    }
  }
  /**
   * Publish multiple events
   */
  async publishBatch<T>(
    events: DomainEvent<T>[]
  ): Promise<void> {
    const results = await Promise.allSettled(events.map((e) => this.publish(e)));

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      this.logger.warn(`${failed.length}/${events.length} events failed to publish`);
    }
  }
  /**
   * Subscribe a handler to events
   */
  async subscribe<T>(
    handler: IEventHandler<T>,
    eventType: string
  ): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    try {
      const queueName = `agentic.${handler.entityType()}.${eventType}`;
      const routingKey = `${handler.entityType()}.${eventType}`;

      // Assert queue with DLX
      await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.DLX_EXCHANGE,
          'x-message-ttl': 24 * 60 * 60 * 1000, // 24 hours
        },
      });

      // Bind queue to exchange
      await this.channel.bindQueue(queueName, this.MAIN_EXCHANGE, routingKey);

      // Store handler
      if (!this.handlers.has(eventType)) {
        this.handlers.set(eventType, []);
      }
      this.handlers.get(eventType)!.push(handler);

      // Consume messages
      await this.channel.consume(
        queueName,
        async (msg) => {
          if (!msg) return;

          try {
            const content = msg.content.toString();
            const event = JSON.parse(content) as DomainEvent<T>;

            this.logger.debug('Processing event', {
              eventId: event.id,
              eventType: event.type,
              handler: handler.entityType(),
            });

            // Handle with retry logic
            await this.handleWithRetry(handler, event);

            // Acknowledge message
            this.channel!.ack(msg);

            this.logger.debug('Event processed successfully', {
              eventId: event.id,
            });
          } catch (error) {
            this.logger.error('Error processing event', error, {
              queueName,
              eventType,
            });

            // Negative acknowledgement (send to DLQ)
            this.channel!.nack(msg, false, false);
          }
        },
        { noAck: false }
      );

      this.logger.info('✓ Handler subscribed', {
        handler: handler.entityType(),
        eventType,
        queue: queueName,
      });
    } catch (error) {
      this.logger.error('Failed to subscribe handler', error, {
        handler: handler.entityType(),
        eventType,
      });
      throw error;
    }
  }
  /**
   * Handle event with retry logic
   */
  private async handleWithRetry<T>(
    handler: IEventHandler<T>,
    event: DomainEvent<T>,
    attempt = 1
  ): Promise<void> {
    try {      await handler.handle(event);
    } catch (error) {
      if (attempt < this.config.maxRetries) {
        const delayMs = this.config.retryDelayMs * Math.pow(2, attempt - 1);
        this.logger.warn(
          `Handler failed, retrying in ${delayMs}ms...`,
          {
            error: String(error),
            handler: handler.entityType(),
            eventId: event.id,
            attempt,
          }
        );

        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.handleWithRetry(handler, event, attempt + 1);
      }

      // Final attempt failed
      this.logger.error(
        'Handler failed after all retries',
        {
          error: String(error),
          handler: handler.entityType(),
          eventId: event.id,
          attempts: this.config.maxRetries,
        }
      );
      throw error;
    }
  }

  /**
   * Unsubscribe a handler
   */
  async unsubscribe(handler: IEventHandler, eventType: string): Promise<void> {
    const handlers = this.handlers.get(eventType) || [];
    const index = handlers.indexOf(handler);

    if (index > -1) {
      handlers.splice(index, 1);
      this.logger.info('✓ Handler unsubscribed', {
        handler: handler.entityType(),
        eventType,
      });
    }
  }

  /**
   * Get DLQ messages (for monitoring/debugging)
   */
  async getDLQMessages(limit = 10): Promise<DomainEvent[]> {
    if (!this.channel) throw new Error('Channel not initialized');

    const messages: DomainEvent[] = [];

    for (let i = 0; i < limit; i++) {
      const msg = await this.channel.get(this.DLQ_QUEUE, { noAck: false });      if (!msg) break;

      try {
        const event = JSON.parse(msg.content.toString()) as DomainEvent;
        messages.push(event);
      } catch (error) {
        // Invalid message format - log and skip
        this.logger.warn('Invalid message format in DLQ', { error });
      }
    }

    // Nack all messages back to DLQ
    messages.forEach(() => {
      if (this.channel) {
        this.channel.nack(messages[0] as unknown as amqp.Message, false, true);
      }
    });

    return messages;
  }

  /**
   * Disconnect from RabbitMQ
   */  async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await (this.connection as any).close();
      }
      this.isConnected = false;
      this.logger.info('✓ Disconnected from RabbitMQ');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ', { error: String(error) });
      throw error;
    }
  }

  /**
   * Health check
   */
  isHealthy(): boolean {
    return this.isConnected && !!this.channel;
  }

  /**
   * Get connection status
   */
  getStatus(): {
    connected: boolean;
    handlersCount: number;
    queues: string[];
  } {
    const queues = Array.from(this.handlers.entries()).map(
      ([eventType, handlers]) =>
        `${handlers[0]?.entityType()}.${eventType} (${handlers.length} handlers)`
    );

    return {
      connected: this.isConnected,
      handlersCount: Array.from(this.handlers.values()).reduce(
        (sum, arr) => sum + arr.length,
        0
      ),
      queues,
    };
  }
}
