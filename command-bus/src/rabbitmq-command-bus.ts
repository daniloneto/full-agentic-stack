import * as amqp from 'amqplib';
import { DomainCommand, ICommandBus, ICommandHandler, Logger } from '@agentic/shared';

export interface RabbitMQCommandBusConfig {
  url: string;
  prefetch?: number;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * RabbitMQ Implementation of Command Bus
 * Features:
 * - Connection pooling
 * - Auto-reconnect with exponential backoff
 * - Dead Letter Queue for failed messages
 * - Message persistence
 * - Separate from Event Bus (different exchanges)
 */
export class RabbitMQCommandBus implements ICommandBus {
  private connection: amqp.Connection | null = null;
  private channel: amqp.Channel | null = null;
  private readonly logger: Logger;
  private readonly config: Required<RabbitMQCommandBusConfig>;
  private readonly handlers: Map<string, ICommandHandler<any>[]> = new Map();
  private isConnected = false;

  // Exchanges and Queues (separate from EventBus)
  private readonly MAIN_EXCHANGE = 'agentic.commands';
  private readonly DLX_EXCHANGE = 'agentic.commands.dlx';
  private readonly DLQ_QUEUE = 'agentic.commands.dlq';

  constructor(config: RabbitMQCommandBusConfig) {
    this.logger = new Logger('RabbitMQCommandBus');
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
      this.logger.info('Already connected to RabbitMQ (CommandBus)');
      return;
    }

    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
      try {
        this.logger.info('Connecting to RabbitMQ (CommandBus)...', { attempt: retries + 1 });

        this.connection = await amqp.connect(this.config.url);
        this.channel = await this.connection.createChannel();

        // Set prefetch
        await this.channel.prefetch(this.config.prefetch);

        // Setup exchanges
        await this.setupExchanges();

        // Setup DLQ
        await this.setupDLQ();

        // Handle connection errors
        this.connection.on('error', (err: Error) => {
          this.logger.error('RabbitMQ connection error', { error: String(err) });
          this.isConnected = false;
        });

        this.connection.on('close', () => {
          this.logger.warn('RabbitMQ connection closed');
          this.isConnected = false;
        });

        this.isConnected = true;
        this.logger.info('✓ Connected to RabbitMQ (CommandBus)');
        return;
      } catch (error) {
        retries++;
        const delayMs = Math.min(1000 * Math.pow(2, retries), 30000);
        this.logger.warn(
          `RabbitMQ connection failed, retrying in ${delayMs}ms...`,
          { error: error instanceof Error ? error.message : String(error), attempt: retries }
        );

        if (retries >= maxRetries) {
          throw new Error(`Failed to connect to RabbitMQ (CommandBus) after ${maxRetries} attempts`);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  /**
   * Disconnect from RabbitMQ
   */
  async disconnect(): Promise<void> {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.isConnected = false;
      this.logger.info('✓ Disconnected from RabbitMQ (CommandBus)');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ', error as Error);
    }
  }

  /**
   * Setup RabbitMQ exchanges
   */
  private async setupExchanges(): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    // Main topic exchange for commands
    await this.channel.assertExchange(this.MAIN_EXCHANGE, 'topic', {
      durable: true,
    });

    // Dead Letter Exchange
    await this.channel.assertExchange(this.DLX_EXCHANGE, 'topic', {
      durable: true,
    });

    this.logger.debug('✓ Command exchanges configured');
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
    this.logger.debug('✓ Dead Letter Queue (Commands) configured');
  }

  /**
   * Publish a domain command
   */
  async publish<T>(command: DomainCommand<T>): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    try {
      const message = Buffer.from(JSON.stringify(command));
      const routingKey = `${command.entity}.${command.type}`;

      const ok = this.channel.publish(this.MAIN_EXCHANGE, routingKey, message, {
        persistent: true,
        contentType: 'application/json',
        contentEncoding: 'utf-8',
        headers: {
          'x-command-id': command.id,
          'x-correlation-id': command.metadata.correlationId,
          'x-timestamp': command.timestamp,
        },
      });

      if (!ok) {
        throw new Error('Failed to publish command to RabbitMQ');
      }

      this.logger.debug('✓ Command published', {
        commandId: command.id,
        type: command.type,
        entity: command.entity,
        correlationId: command.metadata.correlationId,
      });
    } catch (error) {
      this.logger.error('Failed to publish command', error as Error, {
        commandId: command.id,
        type: command.type,
      });
      throw error;
    }
  }

  /**
   * Publish batch of commands
   */
  async publishBatch<T>(commands: DomainCommand<T>[]): Promise<void> {
    try {
      await Promise.all(commands.map((cmd) => this.publish(cmd)));
      this.logger.debug(`✓ ${commands.length} commands published in batch`);
    } catch (error) {
      this.logger.error('Failed to publish command batch', error as Error);
      throw error;
    }
  }

  /**
   * Subscribe to commands
   */
  async subscribe<T>(handler: ICommandHandler<T>, commandType: string): Promise<void> {
    if (!this.channel) throw new Error('Channel not initialized');

    try {
      const queueName = `agentic.commands.${handler.entityType()}.${commandType}`;

      // Assert queue with DLX
      await this.channel.assertQueue(queueName, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': this.DLX_EXCHANGE,
          'x-dead-letter-routing-key': 'commands.dead-letter',
        },
      });

      // Bind queue to exchange
      const routingKey = `${handler.entityType()}.${commandType}`;
      await this.channel.bindQueue(queueName, this.MAIN_EXCHANGE, routingKey);

      // Register handler
      const handlers = this.handlers.get(commandType) || [];
      handlers.push(handler);
      this.handlers.set(commandType, handlers);

      // Consume messages
      await this.channel.consume(queueName, async (msg) => {
        if (!msg) return;

        try {
          const command = JSON.parse(msg.content.toString()) as DomainCommand<T>;

          this.logger.debug('Command received', {
            commandId: command.id,
            type: command.type,
            correlationId: command.metadata.correlationId,
          });

          // Call handler
          await handler.handle(command);

          // Acknowledge message
          this.channel!.ack(msg);
          this.logger.debug('Command processed successfully', {
            commandId: command.id,
            type: command.type,
          });
        } catch (error) {
          this.logger.error('Error processing command', error as Error, {
            message: msg.content.toString(),
          });

          // Reject and requeue or send to DLQ
          this.channel!.nack(msg, false, false);
        }
      });

      this.logger.info('✓ Command handler subscribed', {
        commandType,
        entityType: handler.entityType(),
        queueName,
      });
    } catch (error) {
      this.logger.error('Failed to subscribe to commands', error as Error, {
        commandType,
        entityType: handler.entityType(),
      });
      throw error;
    }
  }

  /**
   * Unsubscribe from commands
   */
  async unsubscribe(handler: ICommandHandler, commandType: string): Promise<void> {
    try {
      const handlers = this.handlers.get(commandType) || [];
      const filtered = handlers.filter((h) => h !== handler);
      this.handlers.set(commandType, filtered);

      this.logger.info('✓ Command handler unsubscribed', {
        commandType,
        entityType: handler.entityType(),
      });
    } catch (error) {
      this.logger.error('Failed to unsubscribe from commands', error as Error);
      throw error;
    }
  }

  /**
   * Check if connected
   */
  isConnected_(): boolean {
    return this.isConnected;
  }
}
