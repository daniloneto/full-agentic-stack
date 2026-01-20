import { createClient, RedisClientType } from 'redis';
import { IEventBus, DomainEvent, IEventHandler, Logger } from '@agentic/shared';
import amqp from 'amqplib';

interface CacheAgentConfig {
  eventBus: IEventBus;
  redisUrl: string;
  rabbitmqUrl: string;
}

/**
 * Cache Agent
 * 
 * Responsibilities:
 * - Subscribe to all domain events (Cliente, Produto, Pedido)
 * - Maintain comprehensive Redis cache layers
 * - Implement cache invalidation strategies
 * - Provide cache statistics and monitoring
 * - Publish CachingCompleted events
 * 
 * Cache Strategy:
 * - Hot: 1 hour TTL (frequently accessed entities)
 * - Warm: 30 minutes TTL (recent entities)
 * - Indexed: No TTL (full-text search indexes)
 * 
 * Event Flow:
 * API Gateway → Domain Events → CacheAgent → Redis
 *                          ↓
 *                  Multi-Layer Cache
 *                          ↓
 *                 CachingCompleted → Next Agents
 */
export class CacheAgent implements IEventHandler<Record<string, unknown>> {
  private readonly eventBus: IEventBus;
  private readonly redisClient: RedisClientType;
  private readonly logger: Logger;
  private readonly config: CacheAgentConfig;
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

  // Cache configuration
  private readonly HOT_CACHE_TTL = 3600; // 1 hour
  private readonly WARM_CACHE_TTL = 1800; // 30 minutes
  private readonly LIST_CACHE_TTL = 300; // 5 minutes (lists change frequently)

  constructor(config: CacheAgentConfig) {
    this.config = config;
    this.eventBus = config.eventBus;
    this.logger = new Logger('CacheAgent');

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
      // Connect to Redis      await this.redisClient.connect();
      this.logger.info('✓ Connected to Redis');

      // Setup RabbitMQ for publishing events
      await this.setupRabbitMQ();
      this.logger.info('✓ Connected to RabbitMQ');

      // Subscribe to all domain events
      await this.subscribeToEvents();
      this.logger.info('✓ Subscribed to domain events');

      this.logger.info('✓ Cache Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Cache Agent', error);
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
   * Subscribe to all domain events
   */
  private async subscribeToEvents(): Promise<void> {
    await this.eventBus.subscribe(this, 'ClienteCriado');
    await this.eventBus.subscribe(this, 'ProdutoCriado');
    await this.eventBus.subscribe(this, 'PedidoCriado');
    this.logger.info('✓ Subscribed to ClienteCriado, ProdutoCriado, PedidoCriado events');
  }

  /**
   * Handle domain events (implements IEventHandler)
   */
  async handle(event: DomainEvent<any>): Promise<void> {
    try {
      switch (event.type) {
        case 'ClienteCriado':
          await this.cacheCliente(event);
          break;
        case 'ProdutoCriado':
          await this.cacheProduto(event);
          break;
        case 'PedidoCriado':
          await this.cachePedido(event);
          break;
        default:
          this.logger.debug('Ignoring event type', { type: event.type });
      }
    } catch (error) {
      this.logger.error('Error handling event', error, { eventId: event.id, eventType: event.type });
      throw error;
    }
  }

  /**
   * Cache cliente in Redis
   */
  private async cacheCliente(event: DomainEvent<any>): Promise<void> {
    const { clienteId, nome, email, endereco } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Caching cliente', { clienteId, email, correlationId });

    try {
      const cacheData = {
        id: clienteId,
        nome,
        email,
        endereco,
        cachedAt: new Date().toISOString(),
      };

      // Cache by ID (hot cache)
      const idKey = `cache:cliente:${clienteId}`;
      await this.redisClient.setEx(
        idKey,
        this.HOT_CACHE_TTL,
        JSON.stringify(cacheData)
      );

      // Cache by email (lookup cache)
      const emailKey = `cache:cliente:email:${email}`;
      await this.redisClient.setEx(
        emailKey,
        this.HOT_CACHE_TTL,
        clienteId
      );

      // Add to clientes set for list operations
      const setKey = 'cache:clientes:list';
      await this.redisClient.sAdd(setKey, clienteId);
      await this.redisClient.expire(setKey, this.LIST_CACHE_TTL);

      // Update cache stats
      await this.updateCacheStats('cliente', 'hit');

      await this.publishCachingCompleted('cliente', clienteId, correlationId);
    } catch (error) {
      this.logger.error('Error caching cliente', error, { clienteId });
      throw error;
    }
  }

  /**
   * Cache produto in Redis
   */
  private async cacheProduto(event: DomainEvent<any>): Promise<void> {
    const { produtoId, nome, sku, preco, estoque } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Caching produto', { produtoId, sku, correlationId });

    try {
      const cacheData = {
        id: produtoId,
        nome,
        sku,
        preco,
        estoque,
        cachedAt: new Date().toISOString(),
      };

      // Cache by ID (hot cache)
      const idKey = `cache:produto:${produtoId}`;
      await this.redisClient.setEx(
        idKey,
        this.HOT_CACHE_TTL,
        JSON.stringify(cacheData)
      );

      // Cache by SKU (lookup cache)
      const skuKey = `cache:produto:sku:${sku}`;
      await this.redisClient.setEx(
        skuKey,
        this.HOT_CACHE_TTL,
        produtoId
      );

      // Cache inventory level separately (may update frequently)
      const inventoryKey = `cache:produto:estoque:${produtoId}`;
      await this.redisClient.set(
        inventoryKey,
        estoque.toString()
      );

      // Add to produtos set for list operations
      const setKey = 'cache:produtos:list';
      await this.redisClient.sAdd(setKey, produtoId);
      await this.redisClient.expire(setKey, this.LIST_CACHE_TTL);

      // Update cache stats
      await this.updateCacheStats('produto', 'hit');

      await this.publishCachingCompleted('produto', produtoId, correlationId);
    } catch (error) {
      this.logger.error('Error caching produto', error, { produtoId });
      throw error;
    }
  }

  /**
   * Cache pedido in Redis
   */
  private async cachePedido(event: DomainEvent<any>): Promise<void> {
    const { pedidoId, clienteId, status, total } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Caching pedido', { pedidoId, clienteId, correlationId });

    try {
      const cacheData = {
        id: pedidoId,
        clienteId,
        status: status || 'PENDENTE',
        total,
        cachedAt: new Date().toISOString(),
      };

      // Cache by ID (hot cache)
      const idKey = `cache:pedido:${pedidoId}`;
      await this.redisClient.setEx(
        idKey,
        this.HOT_CACHE_TTL,
        JSON.stringify(cacheData)
      );

      // Cache by cliente (lookup for client's orders)
      const clienteKey = `cache:pedidos:cliente:${clienteId}`;
      await this.redisClient.sAdd(clienteKey, pedidoId);
      await this.redisClient.expire(clienteKey, this.LIST_CACHE_TTL);

      // Add to pedidos set for list operations
      const setKey = 'cache:pedidos:list';
      await this.redisClient.sAdd(setKey, pedidoId);
      await this.redisClient.expire(setKey, this.LIST_CACHE_TTL);

      // Update cache stats
      await this.updateCacheStats('pedido', 'hit');

      await this.publishCachingCompleted('pedido', pedidoId, correlationId);
    } catch (error) {
      this.logger.error('Error caching pedido', error, { pedidoId });
      throw error;
    }
  }

  /**
   * Publish CachingCompleted event
   */
  private async publishCachingCompleted(
    entityType: string,
    entityId: string,
    correlationId: string
  ): Promise<void> {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const event = {
      id: crypto.randomUUID ? crypto.randomUUID() : generateUUID(),
      type: 'CachingCompleted',
      entity: entityType,
      timestamp: new Date().toISOString(),
      data: {
        entityType,
        entityId,
        cachedAt: new Date().toISOString(),
      },
      metadata: {
        source: 'cache-agent',
        correlationId,
        version: 1,
      },
    };

    const message = Buffer.from(JSON.stringify(event));
    const routingKey = 'cache.completed';

    this.rabbitmqChannel.publish(
      'agentic.events',
      routingKey,
      message,
      { persistent: true, contentType: 'application/json' }
    );

    this.logger.info('Published CachingCompleted event', {
      entityType,
      entityId,
      routingKey,
    });
  }

  /**
   * Update cache statistics
   */
  private async updateCacheStats(entityType: string, operation: string): Promise<void> {
    try {
      const statsKey = `cache:stats:${entityType}`;
      const countKey = `${statsKey}:${operation}`;

      const count = await this.redisClient.incr(countKey);      await this.redisClient.expire(countKey, 3600); // Keep stats for 1 hour

      if (count % 100 === 0) {
        this.logger.info('Cache stats', { entityType, operation, count });
      }
    } catch (error) {
      this.logger.warn('Error updating cache stats', { error: String(error) });
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<Record<string, any>> {
    try {
      const info = await this.redisClient.info('stats');
      const dbSize = await this.redisClient.dbSize();

      return {
        dbSize,
        info: info.split('\r\n').slice(0, 10),
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error getting cache stats', error);
      return {};
    }
  }

  /**
   * Clear all caches (useful for testing or maintenance)
   */
  async clearCache(): Promise<void> {
    try {
      await this.redisClient.flushDb();
      this.logger.info('✓ All caches cleared');
    } catch (error) {
      this.logger.error('Error clearing cache', error);
    }
  }

  /**
   * Cleanup resources
   */
  async stop(): Promise<void> {
    try {
      await this.redisClient.quit();
      this.logger.info('✓ Redis connection closed');

      if (this.rabbitmqChannel) {        await this.rabbitmqChannel.close();
      }

      if (this.rabbitmqConnection) {
        await (this.rabbitmqConnection as any).close();
      }      this.logger.info('✓ RabbitMQ connection closed');
      this.logger.info('✓ Cache Agent stopped');
    } catch (error) {
      this.logger.error('Error stopping agent', { error: String(error) });
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
