import { MongoClient, Db, Collection } from 'mongodb';
import { IEventBus, DomainEvent, IEventHandler, Logger } from '@agentic/shared';
import amqp from 'amqplib';

interface AuditAgentConfig {
  eventBus: IEventBus;
  mongodbUrl: string;
  rabbitmqUrl: string;
}

interface AuditLog {
  _id?: string;
  eventId: string;
  eventType: string;
  entityType: string;
  entityId: string;
  correlationId: string;
  timestamp: string;
  source: string;
  data: any;
  createdAt: Date;
}

/**
 * Audit Agent
 * 
 * Responsibilities:
 * - Subscribe to all domain events
 * - Log all events to MongoDB for audit trail
 * - Maintain immutable audit history
 * - Enable compliance and forensic analysis
 * - Publish AuditLogged events
 * 
 * Event Flow:
 * API Gateway → Domain Events → AuditAgent → MongoDB
 *                          ↓
 *              Immutable Audit Trail
 *                          ↓
 *                    AuditLogged → Complete
 */
export class AuditAgent implements IEventHandler<Record<string, unknown>> {
  private readonly eventBus: IEventBus;
  private readonly mongoClient: MongoClient;
  private db: Db | null = null;
  private auditCollection: Collection<AuditLog> | null = null;
  private readonly logger: Logger;
  private readonly config: AuditAgentConfig;
  private rabbitmqConnection: amqp.Connection | null = null;
  private rabbitmqChannel: amqp.Channel | null = null;

  constructor(config: AuditAgentConfig) {
    this.config = config;
    this.eventBus = config.eventBus;
    this.logger = new Logger('AuditAgent');

    // Initialize MongoDB client
    this.mongoClient = new MongoClient(config.mongodbUrl, {
      maxPoolSize: 10,
      minPoolSize: 2,
      serverSelectionTimeoutMS: 5000,
    });
  }

  /**
   * Returns the event type this handler is interested in
   */
  eventType(): string {
    return '*'; // Subscribe to all events
  }

  /**
   * Returns the entity type this handler is interested in
   */
  entityType(): string {
    return '*'; // Subscribe to all entity types
  }

  async initialize(): Promise<void> {
    try {
      // Connect to MongoDB
      await this.mongoClient.connect();
      this.db = this.mongoClient.db('agentic-audit');
      this.logger.info('✓ Connected to MongoDB');      // Setup database and indexes
      await this.setupDatabase();
      this.logger.info('✓ Database and indexes ready');

      // Setup RabbitMQ for publishing events
      await this.setupRabbitMQ();
      this.logger.info('✓ Connected to RabbitMQ');

      // Subscribe to all domain events
      await this.subscribeToEvents();
      this.logger.info('✓ Subscribed to domain events');

      this.logger.info('✓ Audit Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Audit Agent', error);
      throw error;
    }
  }  /**
   * Setup RabbitMQ connection for publishing events
   */
  private async setupRabbitMQ(): Promise<void> {
    this.rabbitmqConnection = await amqp.connect(this.config.rabbitmqUrl) as any;
    this.rabbitmqChannel = await (this.rabbitmqConnection as any).createChannel();

    // Assert exchanges
    await this.rabbitmqChannel!.assertExchange('agentic.events', 'topic', { durable: true });
  }

  /**
   * Setup MongoDB database and collections
   */
  private async setupDatabase(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    // Create audit collection
    try {
      this.auditCollection = this.db.collection<AuditLog>('audit_logs');

      // Create indexes for efficient querying
      await this.auditCollection.createIndex({ eventId: 1 }, { unique: true });
      await this.auditCollection.createIndex({ eventType: 1 });
      await this.auditCollection.createIndex({ entityType: 1 });
      await this.auditCollection.createIndex({ entityId: 1 });
      await this.auditCollection.createIndex({ correlationId: 1 });
      await this.auditCollection.createIndex({ timestamp: -1 });
      await this.auditCollection.createIndex({ createdAt: -1 });

      // Create TTL index (keep logs for 1 year)
      await this.auditCollection.createIndex(
        { createdAt: 1 },
        { expireAfterSeconds: 365 * 24 * 60 * 60 }
      );      this.logger.info('✓ Audit collection created with indexes');
    } catch (error) {
      this.logger.warn('Collection creation warning (may already exist)', { error: String(error) });
    }
  }
  /**
   * Subscribe to all domain events
   */
  private async subscribeToEvents(): Promise<void> {
    await this.eventBus.subscribe(this, 'ClienteCriado');
    await this.eventBus.subscribe(this, 'ProdutoCriado');
    await this.eventBus.subscribe(this, 'PedidoCriado');
    await this.eventBus.subscribe(this, 'PedidoStatusAtualizado');
    this.logger.info('✓ Subscribed to all domain events');
  }

  /**
   * Handle domain events (implements IEventHandler)
   */
  async handle(event: DomainEvent<any>): Promise<void> {
    try {
      await this.logEvent(event);
    } catch (error) {
      this.logger.error('Error handling event', error, { eventId: event.id, eventType: event.type });
      throw error;
    }
  }

  /**
   * Log event to MongoDB audit trail
   */
  private async logEvent(event: DomainEvent<any>): Promise<void> {
    if (!this.auditCollection) {
      throw new Error('Audit collection not initialized');
    }

    const auditLog: AuditLog = {
      eventId: event.id,
      eventType: event.type,
      entityType: event.entity,
      entityId: event.data?.clienteId || event.data?.produtoId || event.data?.pedidoId || 'unknown',
      correlationId: event.metadata.correlationId,
      timestamp: event.timestamp,
      source: event.metadata.source,
      data: event.data,
      createdAt: new Date(),
    };

    try {
      const result = await this.auditCollection.insertOne(auditLog);

      this.logger.info('Event logged to audit trail', {
        eventId: event.id,
        eventType: event.type,
        documentId: result.insertedId,
      });

      await this.publishAuditLogged(event, result.insertedId.toString());
    } catch (error) {
      this.logger.error('Error logging event to audit trail', error, { eventId: event.id });
      throw error;
    }
  }

  /**
   * Publish AuditLogged event
   */
  private async publishAuditLogged(event: DomainEvent<any>, documentId: string): Promise<void> {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const auditEvent = {
      id: crypto.randomUUID ? crypto.randomUUID() : generateUUID(),
      type: 'AuditLogged',
      entity: 'AuditLog',
      timestamp: new Date().toISOString(),
      data: {
        originalEventId: event.id,
        originalEventType: event.type,
        documentId,
        loggedAt: new Date().toISOString(),
      },
      metadata: {
        source: 'audit-agent',
        correlationId: event.metadata.correlationId,
        version: 1,
      },
    };

    const message = Buffer.from(JSON.stringify(auditEvent));
    const routingKey = 'audit.logged';

    this.rabbitmqChannel.publish(
      'agentic.events',
      routingKey,
      message,
      { persistent: true, contentType: 'application/json' }
    );

    this.logger.debug('Published AuditLogged event', {
      originalEventId: event.id,
      documentId,
    });
  }

  /**
   * Query audit logs by entity
   */
  async getAuditsByEntity(entityType: string, entityId: string): Promise<AuditLog[]> {
    if (!this.auditCollection) {
      throw new Error('Audit collection not initialized');
    }

    try {
      const logs = await this.auditCollection
        .find({
          entityType,
          entityId,
        })
        .sort({ timestamp: -1 })
        .limit(100)
        .toArray();

      return logs;
    } catch (error) {
      this.logger.error('Error querying audit logs', error, { entityType, entityId });
      return [];
    }
  }

  /**
   * Query audit logs by correlation ID
   */
  async getAuditsByCorrelation(correlationId: string): Promise<AuditLog[]> {
    if (!this.auditCollection) {
      throw new Error('Audit collection not initialized');
    }

    try {
      const logs = await this.auditCollection
        .find({
          correlationId,
        })
        .sort({ timestamp: 1 })
        .toArray();

      return logs;
    } catch (error) {
      this.logger.error('Error querying audit logs', error, { correlationId });
      return [];
    }
  }

  /**
   * Query audit logs by event type
   */
  async getAuditsByEventType(eventType: string, limit: number = 50): Promise<AuditLog[]> {
    if (!this.auditCollection) {
      throw new Error('Audit collection not initialized');
    }

    try {
      const logs = await this.auditCollection
        .find({
          eventType,
        })
        .sort({ timestamp: -1 })
        .limit(limit)
        .toArray();

      return logs;
    } catch (error) {
      this.logger.error('Error querying audit logs', error, { eventType });
      return [];
    }
  }

  /**
   * Get audit statistics
   */
  async getAuditStats(): Promise<Record<string, any>> {
    if (!this.auditCollection) {
      throw new Error('Audit collection not initialized');
    }

    try {
      const totalLogs = await this.auditCollection.countDocuments();

      const eventTypeCounts = await this.auditCollection
        .aggregate([
          {
            $group: {
              _id: '$eventType',
              count: { $sum: 1 },
            },
          },
          {
            $sort: { count: -1 },
          },
        ])
        .toArray();

      const oldestLog = await this.auditCollection
        .findOne({}, { sort: { timestamp: 1 } });

      const newestLog = await this.auditCollection
        .findOne({}, { sort: { timestamp: -1 } });

      return {
        totalLogs,
        eventTypeCounts,
        oldestLog: oldestLog?.timestamp,
        newestLog: newestLog?.timestamp,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error getting audit stats', error);
      return {};
    }
  }
  /**
   * Cleanup resources
   */
  async stop(): Promise<void> {
    try {
      await this.mongoClient.close();
      this.logger.info('✓ MongoDB connection closed');

      if (this.rabbitmqChannel) {
        await this.rabbitmqChannel.close();
      }

      if (this.rabbitmqConnection) {
        // Using .close() method available in amqplib Connection
        await (this.rabbitmqConnection as any).close();
      }

      this.logger.info('✓ RabbitMQ connection closed');
      this.logger.info('✓ Audit Agent stopped');
    } catch (error) {
      this.logger.error('Error stopping agent', error);
    }
  }
}

// Fallback UUID generator for older Node versions
function generateUUID(): string {
  // eslint-disable-next-line unicorn/prefer-string-replace-all
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.trunc(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
