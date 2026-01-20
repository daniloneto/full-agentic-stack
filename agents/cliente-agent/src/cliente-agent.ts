import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { IEventBus, DomainEvent, IEventHandler, Logger } from '@agentic/shared';
import amqp from 'amqplib';

interface ClienteAgentConfig {
  eventBus: IEventBus;
  databaseUrl: string;
  redisUrl: string;
  rabbitmqUrl: string;
}

interface Cliente {
  id: string;
  nome: string;
  email: string;
  telefone: string;
  endereco: {
    rua: string;
    numero: string;
    bairro: string;
    cidade: string;
    estado: string;
    cep: string;
  };
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Cliente Agent
 * 
 * Responsibilities:
 * - Subscribe to ClienteCriado events from API Gateway
 * - Persist clients to PostgreSQL (replica)
 * - Maintain client indexes and analytics
 * - Cache frequently accessed clients in Redis
 * - Publish ClienteProcessado events
 * 
 * Event Flow:
 * API Gateway → ClienteCriado → ClienteAgent → PostgreSQL
 *                          ↓
 *                       Cache (Redis)
 *                          ↓
 *                    ClienteProcessado → Next Agents
 */
export class ClienteAgent implements IEventHandler<Record<string, unknown>> {
  private readonly eventBus: IEventBus;
  private readonly dbPool: Pool;
  private readonly redisClient: RedisClientType;
  private readonly logger: Logger;
  private readonly config: ClienteAgentConfig;
  private rabbitmqConnection: amqp.Connection | null = null;
  private rabbitmqChannel: amqp.Channel | null = null;

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

  constructor(config: ClienteAgentConfig) {
    this.config = config;
    this.eventBus = config.eventBus;
    this.logger = new Logger('ClienteAgent');

    // Initialize database pool
    this.dbPool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Initialize Redis client
    this.redisClient = createClient({
      url: config.redisUrl,
      socket: {
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
      },
    });
  }

  async initialize(): Promise<void> {
    try {      // Connect to Redis
      await this.redisClient.connect();
      this.logger.info('✓ Connected to Redis');

      // Test database connection
      const result = await this.dbPool.query('SELECT NOW()');
      this.logger.info('✓ Connected to PostgreSQL', { time: result.rows[0] });

      // Setup RabbitMQ for publishing events
      await this.setupRabbitMQ();
      this.logger.info('✓ Connected to RabbitMQ');

      // Create database tables if they don't exist
      await this.setupDatabase();
      this.logger.info('✓ Database tables ready');

      // Subscribe to ClienteCriado events
      await this.subscribeToEvents();
      this.logger.info('✓ Subscribed to ClienteCriado events');

      this.logger.info('✓ Cliente Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Cliente Agent', error);
      throw error;
    }
  }
  /**
   * Setup RabbitMQ connection for publishing events
   */
  private async setupRabbitMQ(): Promise<void> {
    this.rabbitmqConnection = await amqp.connect(this.config.rabbitmqUrl) as any;
    this.rabbitmqChannel = await (this.rabbitmqConnection as any).createChannel();

    // Assert exchanges
    await this.rabbitmqChannel!.assertExchange('agentic.events', 'topic', { durable: true });
  }

  /**
   * Create necessary database tables
   */
  private async setupDatabase(): Promise<void> {
    const client = await this.dbPool.connect();
    try {
      // Check if schema exists
      await client.query('CREATE SCHEMA IF NOT EXISTS agent_clientes');

      // Create clientes table in agent schema
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_clientes.clientes (
          id UUID PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL,
          telefone VARCHAR(20),
          endereco JSONB,
          ativo BOOLEAN DEFAULT true,
          synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          UNIQUE(email)
        );

        CREATE INDEX IF NOT EXISTS idx_agent_clientes_email 
          ON agent_clientes.clientes(email);
        CREATE INDEX IF NOT EXISTS idx_agent_clientes_nome 
          ON agent_clientes.clientes(nome);
        CREATE INDEX IF NOT EXISTS idx_agent_clientes_ativo 
          ON agent_clientes.clientes(ativo);
        CREATE INDEX IF NOT EXISTS idx_agent_clientes_synced_at 
          ON agent_clientes.clientes(synced_at);
      `);

      this.logger.info('✓ Agent database schema created');
    } finally {
      client.release();
    }
  }
  /**
   * Subscribe to ClienteCriado events
   */
  private async subscribeToEvents(): Promise<void> {
    await this.eventBus.subscribe(this, 'ClienteCriado');
    this.logger.info('✓ Subscribed to ClienteCriado events');
  }

  /**
   * Handle ClienteCriado event (implements IEventHandler)
   */
  async handle(event: DomainEvent<any>): Promise<void> {
    try {
      if (event.type === 'ClienteCriado') {
        await this.handleClienteCriado(event);
      }
    } catch (error) {
      this.logger.error('Error handling event', error, { eventId: event.id, eventType: event.type });
      throw error;
    }
  }

  /**
   * Process ClienteCriado event
   */
  private async handleClienteCriado(event: DomainEvent<any>): Promise<void> {
    const { clienteId, nome, email, telefone, endereco } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Processing ClienteCriado event', {
      clienteId,
      email,
      correlationId,
    });

    try {
      const now = new Date().toISOString();

      // Insert cliente
      const insertQuery = `
        INSERT INTO agent_clientes.clientes 
        (id, nome, email, telefone, endereco, ativo, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, true, $6, $6)
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `;

      const result = await this.dbPool.query(insertQuery, [
        clienteId,
        nome,
        email,
        telefone,
        JSON.stringify(endereco),
        now,
      ]);

      if (result.rows.length > 0) {
        const cliente = result.rows[0];
        this.logger.info('Cliente inserted into agent database', { clienteId });

        // Cache the cliente in Redis (1 hour TTL)
        const cacheKey = `cliente:${clienteId}`;
        await this.redisClient.setEx(
          cacheKey,
          3600,
          JSON.stringify(cliente)
        );

        // Also cache by email for quick lookups
        const emailCacheKey = `cliente:email:${email}`;
        await this.redisClient.setEx(
          emailCacheKey,
          3600,
          clienteId
        );

        // Publish ClienteProcessado event
        await this.publishClienteProcessado(cliente, correlationId);
      }
    } catch (error) {
      this.logger.error('Error processing cliente', error, { clienteId });
      throw error;
    }
  }

  /**
   * Publish ClienteProcessado event for downstream agents
   */
  private async publishClienteProcessado(cliente: any, correlationId: string): Promise<void> {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const event = {
      id: crypto.randomUUID ? crypto.randomUUID() : generateUUID(),
      type: 'ClienteProcessado',
      entity: 'Cliente',
      timestamp: new Date().toISOString(),
      data: {
        clienteId: cliente.id,
        nome: cliente.nome,
        email: cliente.email,
        processedAt: new Date().toISOString(),
      },
      metadata: {
        source: 'cliente-agent',
        correlationId,
        version: 1,
      },
    };

    const message = Buffer.from(JSON.stringify(event));
    const routingKey = 'cliente.processado';

    this.rabbitmqChannel.publish(
      'agentic.events',
      routingKey,
      message,
      { persistent: true, contentType: 'application/json' }
    );

    this.logger.info('Published ClienteProcessado event', {
      clienteId: cliente.id,
      routingKey,
    });
  }

  /**
   * Get cliente by ID (with cache)
   */
  async getCliente(clienteId: string): Promise<Cliente | null> {
    // Try cache first
    const cacheKey = `cliente:${clienteId}`;
    const cached = await this.redisClient.get(cacheKey);

    if (cached) {
      this.logger.debug('Cache hit for cliente', { clienteId });
      return JSON.parse(cached);
    }

    // Fetch from database
    const result = await this.dbPool.query(
      'SELECT * FROM agent_clientes.clientes WHERE id = $1 AND ativo = true',
      [clienteId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const cliente = result.rows[0];

    // Cache it
    await this.redisClient.setEx(
      cacheKey,
      3600,
      JSON.stringify(cliente)
    );

    return cliente;
  }

  /**
   * Get cliente by email
   */
  async getClienteByEmail(email: string): Promise<Cliente | null> {
    // Try cache first
    const emailCacheKey = `cliente:email:${email}`;
    const cachedId = await this.redisClient.get(emailCacheKey);

    if (cachedId) {
      return this.getCliente(cachedId);
    }

    // Fetch from database
    const result = await this.dbPool.query(
      'SELECT * FROM agent_clientes.clientes WHERE email = $1 AND ativo = true',
      [email]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const cliente = result.rows[0];

    // Cache both by ID and email
    await this.redisClient.setEx(
      `cliente:${cliente.id}`,
      3600,
      JSON.stringify(cliente)
    );
    await this.redisClient.setEx(
      emailCacheKey,
      3600,
      cliente.id
    );

    return cliente;
  }

  /**
   * Cleanup resources
   */
  async stop(): Promise<void> {
    try {
      await this.redisClient.quit();
      this.logger.info('✓ Redis connection closed');

      await this.dbPool.end();
      this.logger.info('✓ Database connection pool closed');

      if (this.rabbitmqChannel) {        await this.rabbitmqChannel.close();
      }

      if (this.rabbitmqConnection) {
        await (this.rabbitmqConnection as any).close();
      }

      this.logger.info('✓ RabbitMQ connection closed');
      this.logger.info('✓ Cliente Agent stopped');
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
