import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { IEventBus, DomainEvent, IEventHandler, Logger } from '@agentic/shared';
import amqp from 'amqplib';

interface ProdutoAgentConfig {
  eventBus: IEventBus;
  databaseUrl: string;
  redisUrl: string;
  rabbitmqUrl: string;
}

interface Produto {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  estoque: number;
  sku: string;
  ativo: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Produto Agent
 * 
 * Responsibilities:
 * - Subscribe to ProdutoCriado events from API Gateway
 * - Persist products to PostgreSQL (replica)
 * - Maintain inventory cache in Redis
 * - Track stock levels and availability
 * - Publish ProdutoProcessado events
 * 
 * Event Flow:
 * API Gateway → ProdutoCriado → ProdutoAgent → PostgreSQL
 *                          ↓
 *                     Inventory (Redis)
 *                          ↓
 *                    ProdutoProcessado → Next Agents
 */
export class ProdutoAgent implements IEventHandler<Record<string, unknown>> {
  private readonly eventBus: IEventBus;
  private readonly dbPool: Pool;
  private readonly redisClient: RedisClientType;
  private readonly logger: Logger;
  private readonly config: ProdutoAgentConfig;
  private rabbitmqConnection: amqp.Connection | null = null;
  private rabbitmqChannel: amqp.Channel | null = null;

  eventType(): string {
    return '*';
  }

  entityType(): string {
    return '*';
  }

  constructor(config: ProdutoAgentConfig) {
    this.config = config;
    this.eventBus = config.eventBus;
    this.logger = new Logger('ProdutoAgent');

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
    try {
      // Connect to Redis
      await this.redisClient.connect();
      this.logger.info('✓ Connected to Redis');

      // Test database connection
      const result = await this.dbPool.query('SELECT NOW()');
      this.logger.info('✓ Connected to PostgreSQL', { time: result.rows[0] });      // Setup RabbitMQ for publishing events
      await this.setupRabbitMQ();
      this.logger.info('✓ Connected to RabbitMQ');

      // Create database tables if they don't exist
      await this.setupDatabase();
      this.logger.info('✓ Database tables ready');

      // Subscribe to ProdutoCriado events
      await this.subscribeToEvents();
      this.logger.info('✓ Subscribed to ProdutoCriado events');

      this.logger.info('✓ Produto Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Produto Agent', error);
      throw error;
    }
  }
  /**
   * Setup RabbitMQ connection for publishing events
   */
  private async setupRabbitMQ(): Promise<void> {
    const url = this.config.rabbitmqUrl;
    this.rabbitmqConnection = await amqp.connect(url) as any;
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
      await client.query('CREATE SCHEMA IF NOT EXISTS agent_produtos');

      // Create produtos table in agent schema
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_produtos.produtos (
          id UUID PRIMARY KEY,
          nome VARCHAR(255) NOT NULL,
          descricao TEXT,
          preco DECIMAL(12, 2) NOT NULL,
          estoque INTEGER NOT NULL DEFAULT 0,
          sku VARCHAR(100) NOT NULL UNIQUE,
          ativo BOOLEAN DEFAULT true,
          synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_agent_produtos_sku 
          ON agent_produtos.produtos(sku);
        CREATE INDEX IF NOT EXISTS idx_agent_produtos_nome 
          ON agent_produtos.produtos(nome);
        CREATE INDEX IF NOT EXISTS idx_agent_produtos_ativo 
          ON agent_produtos.produtos(ativo);
        CREATE INDEX IF NOT EXISTS idx_agent_produtos_estoque 
          ON agent_produtos.produtos(estoque);
      `);

      this.logger.info('✓ Agent database schema created');
    } finally {
      client.release();
    }
  }
  /**
   * Subscribe to ProdutoCriado events
   */
  private async subscribeToEvents(): Promise<void> {
    await this.eventBus.subscribe(this, 'ProdutoCriado');
    this.logger.info('✓ Subscribed to ProdutoCriado events');
  }

  /**
   * Handle ProdutoCriado event (implements IEventHandler)
   */
  async handle(event: DomainEvent<any>): Promise<void> {
    try {
      if (event.type === 'ProdutoCriado') {
        await this.handleProdutoCriado(event);
      }    } catch (error) {
      this.logger.error('Error handling event', { error: String(error) }, { eventId: event.id, eventType: event.type });
      throw error;
    }
  }

  /**
   * Process ProdutoCriado event
   */
  private async handleProdutoCriado(event: DomainEvent<any>): Promise<void> {
    const { produtoId, nome, descricao, preco, estoque, sku } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Processing ProdutoCriado event', {
      produtoId,
      sku,
      correlationId,
    });

    try {
      const now = new Date().toISOString();

      // Insert produto
      const insertQuery = `
        INSERT INTO agent_produtos.produtos 
        (id, nome, descricao, preco, estoque, sku, ativo, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7)
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `;

      const result = await this.dbPool.query(insertQuery, [
        produtoId,
        nome,
        descricao,
        preco,
        estoque,
        sku,
        now,
      ]);

      if (result.rows.length > 0) {
        const produto = result.rows[0];
        this.logger.info('Produto inserted into agent database', { produtoId });

        // Cache the produto in Redis (1 hour TTL)
        const cacheKey = `produto:${produtoId}`;
        await this.redisClient.setEx(
          cacheKey,
          3600,
          JSON.stringify(produto)
        );

        // Also cache by SKU for quick lookups
        const skuCacheKey = `produto:sku:${sku}`;
        await this.redisClient.setEx(
          skuCacheKey,
          3600,
          produtoId
        );

        // Cache inventory level
        const inventoryCacheKey = `estoque:${produtoId}`;
        await this.redisClient.set(
          inventoryCacheKey,
          estoque.toString()
        );

        // Publish ProdutoProcessado event
        await this.publishProdutoProcessado(produto, correlationId);      }
    } catch (error) {
      this.logger.error('Error processing produto', { error: String(error) }, { produtoId });
      throw error;
    }
  }

  /**
   * Publish ProdutoProcessado event for downstream agents
   */
  private async publishProdutoProcessado(produto: any, correlationId: string): Promise<void> {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const event = {
      id: crypto.randomUUID ? crypto.randomUUID() : generateUUID(),
      type: 'ProdutoProcessado',
      entity: 'Produto',
      timestamp: new Date().toISOString(),
      data: {
        produtoId: produto.id,
        nome: produto.nome,
        sku: produto.sku,
        estoque: produto.estoque,
        preco: produto.preco,
        processedAt: new Date().toISOString(),
      },
      metadata: {
        source: 'produto-agent',
        correlationId,
        version: 1,
      },
    };

    const message = Buffer.from(JSON.stringify(event));
    const routingKey = 'produto.processado';

    this.rabbitmqChannel.publish(
      'agentic.events',
      routingKey,
      message,
      { persistent: true, contentType: 'application/json' }
    );

    this.logger.info('Published ProdutoProcessado event', {
      produtoId: produto.id,
      routingKey,
    });
  }

  /**
   * Get produto by ID (with cache)
   */
  async getProduto(produtoId: string): Promise<Produto | null> {
    // Try cache first
    const cacheKey = `produto:${produtoId}`;
    const cached = await this.redisClient.get(cacheKey);

    if (cached) {
      this.logger.debug('Cache hit for produto', { produtoId });
      return JSON.parse(cached);
    }

    // Fetch from database
    const result = await this.dbPool.query(
      'SELECT * FROM agent_produtos.produtos WHERE id = $1 AND ativo = true',
      [produtoId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const produto = result.rows[0];

    // Cache it
    await this.redisClient.setEx(
      cacheKey,
      3600,
      JSON.stringify(produto)
    );

    return produto;
  }

  /**
   * Get produto by SKU
   */
  async getProdutoBySku(sku: string): Promise<Produto | null> {
    // Try cache first
    const skuCacheKey = `produto:sku:${sku}`;
    const cachedId = await this.redisClient.get(skuCacheKey);

    if (cachedId) {
      return this.getProduto(cachedId);
    }

    // Fetch from database
    const result = await this.dbPool.query(
      'SELECT * FROM agent_produtos.produtos WHERE sku = $1 AND ativo = true',
      [sku]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const produto = result.rows[0];

    // Cache both by ID and SKU
    await this.redisClient.setEx(
      `produto:${produto.id}`,
      3600,
      JSON.stringify(produto)
    );
    await this.redisClient.setEx(
      skuCacheKey,
      3600,
      produto.id
    );

    return produto;
  }

  /**
   * Check stock availability
   */
  async checkStock(produtoId: string, quantidade: number): Promise<boolean> {
    const inventoryCacheKey = `estoque:${produtoId}`;
    const cached = await this.redisClient.get(inventoryCacheKey);    let estoque: number;
    if (cached) {
      estoque = Number.parseInt(cached, 10);
    } else {
      const result = await this.dbPool.query(
        'SELECT estoque FROM agent_produtos.produtos WHERE id = $1',
        [produtoId]
      );

      if (result.rows.length === 0) {
        return false;
      }

      estoque = result.rows[0].estoque;
    }

    return estoque >= quantidade;
  }

  /**
   * Update product inventory
   */
  async updateInventory(produtoId: string, novoEstoque: number): Promise<void> {
    await this.dbPool.query(
      'UPDATE agent_produtos.produtos SET estoque = $1, updated_at = NOW() WHERE id = $2',
      [novoEstoque, produtoId]
    );

    // Invalidate caches
    const cacheKey = `produto:${produtoId}`;
    const inventoryCacheKey = `estoque:${produtoId}`;

    await this.redisClient.del(cacheKey);
    await this.redisClient.del(inventoryCacheKey);
  }

  /**
   * Cleanup resources
   */
  async stop(): Promise<void> {
    try {
      await this.redisClient.quit();
      this.logger.info('✓ Redis connection closed');

      await this.dbPool.end();
      this.logger.info('✓ Database connection pool closed');      if (this.rabbitmqChannel) {
        await this.rabbitmqChannel.close();
      }

      if (this.rabbitmqConnection) {
        await (this.rabbitmqConnection as any).close();
      }

      this.logger.info('✓ RabbitMQ connection closed');
      this.logger.info('✓ Produto Agent stopped');
    } catch (error) {
      this.logger.error('Error stopping agent', { error: String(error) });
    }
  }
}

// Fallback UUID generator for older Node versions
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replaceAll(/[xy]/g, function (c) {
    const r = Math.trunc(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
