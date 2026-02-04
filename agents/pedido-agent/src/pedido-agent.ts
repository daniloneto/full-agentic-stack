import { Pool } from 'pg';
import { createClient, RedisClientType } from 'redis';
import { IEventBus, DomainEvent, IEventHandler, Logger, ICommandBus, ICommandHandler, CriarPedidoCommand, CriarPedidoCommandData, criarPedidoCriadoEvent, AtualizarPedidoCommand, AtualizarPedidoCommandData, CancelarPedidoCommand, CancelarPedidoCommandData } from '@agentic/shared';
import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

interface PedidoAgentConfig {
  eventBus: IEventBus;
  commandBus: ICommandBus;
  databaseUrl: string;
  redisUrl: string;
  rabbitmqUrl: string;
}

interface Pedido {
  id: string;
  cliente_id: string;
  status: string;
  total: number;
  observacoes?: string;
  created_at: string;
  updated_at: string;
  ativo: boolean;
}

interface PedidoItem {
  id: string;
  pedido_id: string;
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  subtotal: number;
  created_at: string;
}

/**
 * Pedido Agent
 * 
 * Responsibilities:
 * - Subscribe to PedidoCriado events from API Gateway
 * - Persist pedidos and items to PostgreSQL (replica)
 * - Cache frequently accessed pedidos in Redis
 * - Publish PedidoProcessado events for downstream agents
 * - Handle status transitions and validations
 * 
 * Event Flow:
 * API Gateway → PedidoCriado → PedidoAgent → PostgreSQL
 *                          ↓
 *                       Cache (Redis)
 *                          ↓
 *                    PedidoProcessado → Next Agents
 */
export class PedidoAgent implements IEventHandler<Record<string, unknown>> {
  private readonly eventBus: IEventBus;
  private readonly commandBus: ICommandBus;
  private readonly dbPool: Pool;
  private readonly redisClient: RedisClientType;
  private readonly logger: Logger;
  private readonly config: PedidoAgentConfig;
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

  constructor(config: PedidoAgentConfig) {
    this.config = config;
    this.eventBus = config.eventBus;
    this.commandBus = config.commandBus;
    this.logger = new Logger('PedidoAgent');

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
      this.logger.info('✓ Connected to PostgreSQL', { time: result.rows[0] });

      // Setup RabbitMQ for publishing events
      await this.setupRabbitMQ();
      this.logger.info('✓ Connected to RabbitMQ');

      // Create database tables if they don't exist
      await this.setupDatabase();
      this.logger.info('✓ Database tables ready');

      // Subscribe to PedidoCriado events
      await this.subscribeToEvents();
      this.logger.info('✓ Subscribed to PedidoCriado events');

      // Connect to RabbitMQ for command bus
      await this.commandBus.connect();
      this.logger.info('✓ Connected to RabbitMQ Command Bus');

      // Subscribe to commands
      const criarPedidoCommandHandler = new CriarPedidoCommandHandler(this.dbPool, this.eventBus, this.logger);
      await this.commandBus.subscribe(criarPedidoCommandHandler, 'CriarPedidoCommand');

      const atualizarPedidoCommandHandler = new AtualizarPedidoCommandHandler(this.dbPool, this.eventBus, this.logger);
      await this.commandBus.subscribe(atualizarPedidoCommandHandler, 'AtualizarPedidoCommand');

      const cancelarPedidoCommandHandler = new CancelarPedidoCommandHandler(this.dbPool, this.eventBus, this.logger);
      await this.commandBus.subscribe(cancelarPedidoCommandHandler, 'CancelarPedidoCommand');

      this.logger.info('✓ Pedido Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Pedido Agent', error);
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
      await client.query('CREATE SCHEMA IF NOT EXISTS agent_pedidos');

      // Create pedidos table in agent schema
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_pedidos.pedidos (
          id UUID PRIMARY KEY,
          cliente_id UUID NOT NULL,
          status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
          total DECIMAL(12, 2) NOT NULL,
          observacoes TEXT,
          ativo BOOLEAN DEFAULT true,
          synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          created_at TIMESTAMP NOT NULL,
          updated_at TIMESTAMP NOT NULL,
          CONSTRAINT fk_cliente FOREIGN KEY (cliente_id) 
            REFERENCES domain.clientes(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_agent_pedidos_cliente_id 
          ON agent_pedidos.pedidos(cliente_id);
        CREATE INDEX IF NOT EXISTS idx_agent_pedidos_status 
          ON agent_pedidos.pedidos(status);
        CREATE INDEX IF NOT EXISTS idx_agent_pedidos_ativo 
          ON agent_pedidos.pedidos(ativo);
      `);

      // Create pedido items table
      await client.query(`
        CREATE TABLE IF NOT EXISTS agent_pedidos.items (
          id UUID PRIMARY KEY,
          pedido_id UUID NOT NULL,
          produto_id UUID NOT NULL,
          quantidade INTEGER NOT NULL,
          preco_unitario DECIMAL(12, 2) NOT NULL,
          subtotal DECIMAL(12, 2) NOT NULL,
          created_at TIMESTAMP NOT NULL,
          CONSTRAINT fk_pedido FOREIGN KEY (pedido_id) 
            REFERENCES agent_pedidos.pedidos(id) ON DELETE CASCADE,
          CONSTRAINT fk_produto FOREIGN KEY (produto_id) 
            REFERENCES domain.produtos(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_agent_items_pedido_id 
          ON agent_pedidos.items(pedido_id);
        CREATE INDEX IF NOT EXISTS idx_agent_items_produto_id 
          ON agent_pedidos.items(produto_id);
      `);

      this.logger.info('✓ Agent database schema created');
    } finally {
      client.release();
    }
  }

  /**
   * Subscribe to PedidoCriado events
   */
  private async subscribeToEvents(): Promise<void> {
    await this.eventBus.subscribe(this, 'PedidoCriado');
    this.logger.info('✓ Subscribed to PedidoCriado events');
  }

  /**
   * Handle PedidoCriado event (implements IEventHandler)
   */
  async handle(event: DomainEvent<any>): Promise<void> {
    try {
      if (event.type === 'PedidoCriado') {
        await this.handlePedidoCriado(event);
      }
    } catch (error) {
      this.logger.error('Error handling event', error, { eventId: event.id, eventType: event.type });
      throw error;
    }
  }

  /**
   * Process PedidoCriado event
   */
  private async handlePedidoCriado(event: DomainEvent<any>): Promise<void> {
    const { pedidoId, clienteId, itens, total, status } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Processing PedidoCriado event', {
      pedidoId,
      clienteId,
      correlationId,
    });

    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      // Insert pedido
      const insertPedidoQuery = `
        INSERT INTO agent_pedidos.pedidos 
        (id, cliente_id, status, total, ativo, created_at, updated_at)
        VALUES ($1, $2, $3, $4, true, $5, $5)
        ON CONFLICT (id) DO NOTHING
        RETURNING *
      `;

      const now = new Date().toISOString();
      const pedidoResult = await client.query(insertPedidoQuery, [
        pedidoId,
        clienteId,
        status || 'PENDENTE',
        total,
        now,
      ]);

      if (pedidoResult.rows.length > 0) {
        const pedido = pedidoResult.rows[0];
        this.logger.info('Pedido inserted into agent database', { pedidoId });

        // Insert items
        for (const item of itens) {
          const insertItemQuery = `
            INSERT INTO agent_pedidos.items 
            (id, pedido_id, produto_id, quantidade, preco_unitario, subtotal, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
          `;

          const itemId = uuidv4();
          const subtotal = item.quantidade * item.precoUnitario;

          await client.query(insertItemQuery, [
            itemId,
            pedidoId,
            item.produtoId,
            item.quantidade,
            item.precoUnitario,
            subtotal,
            now,
          ]);
        }

        await client.query('COMMIT');
        this.logger.info('Transaction committed', { pedidoId });

        // Cache the pedido in Redis (1 hour TTL)
        const cacheKey = `pedido:${pedidoId}`;
        await this.redisClient.setEx(
          cacheKey,
          3600,
          JSON.stringify({
            ...pedido,
            itens,
          })
        );

        // Publish PedidoProcessado event
        await this.publishPedidoProcessado(pedido, correlationId);
      }
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Error processing pedido', error, { pedidoId });
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Publish PedidoProcessado event for downstream agents
   */
  private async publishPedidoProcessado(pedido: Pedido, correlationId: string): Promise<void> {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const event = {
      id: uuidv4(),
      type: 'PedidoProcessado',
      entity: 'Pedido',
      timestamp: new Date().toISOString(),
      data: {
        pedidoId: pedido.id,
        clienteId: pedido.cliente_id,
        status: pedido.status,
        total: pedido.total,
        processedAt: new Date().toISOString(),
      },
      metadata: {
        source: 'pedido-agent',
        correlationId,
        version: 1,
      },
    };

    const message = Buffer.from(JSON.stringify(event));
    const routingKey = 'pedido.processado';

    this.rabbitmqChannel.publish(
      'agentic.events',
      routingKey,
      message,
      { persistent: true, contentType: 'application/json' }
    );

    this.logger.info('Published PedidoProcessado event', {
      pedidoId: pedido.id,
      routingKey,
    });
  }

  /**
   * Get pedido by ID (with cache)
   */
  async getPedido(pedidoId: string): Promise<Pedido | null> {
    // Try cache first
    const cacheKey = `pedido:${pedidoId}`;
    const cached = await this.redisClient.get(cacheKey);

    if (cached) {
      this.logger.debug('Cache hit for pedido', { pedidoId });
      return JSON.parse(cached);
    }

    // Fetch from database
    const result = await this.dbPool.query(
      'SELECT * FROM agent_pedidos.pedidos WHERE id = $1 AND ativo = true',
      [pedidoId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const pedido = result.rows[0];

    // Cache it
    await this.redisClient.setEx(
      cacheKey,
      3600,
      JSON.stringify(pedido)
    );

    return pedido;
  }

  /**
   * Get pedido items
   */
  async getPedidoItems(pedidoId: string): Promise<PedidoItem[]> {
    const result = await this.dbPool.query(
      'SELECT * FROM agent_pedidos.items WHERE pedido_id = $1 ORDER BY created_at',
      [pedidoId]
    );

    return result.rows;
  }

  /**
   * Update pedido status
   */
  async updatePedidoStatus(
    pedidoId: string,
    status: string,
    correlationId: string
  ): Promise<Pedido | null> {
    const result = await this.dbPool.query(
      `UPDATE agent_pedidos.pedidos 
       SET status = $1, updated_at = NOW() 
       WHERE id = $2 AND ativo = true
       RETURNING *`,
      [status, pedidoId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const pedido = result.rows[0];

    // Invalidate cache
    const cacheKey = `pedido:${pedidoId}`;
    await this.redisClient.del(cacheKey);

    // Publish status update event
    if (this.rabbitmqChannel) {
      const event = {
        id: uuidv4(),
        type: 'PedidoStatusAtualizado',
        entity: 'Pedido',
        timestamp: new Date().toISOString(),
        data: {
          pedidoId,
          novoStatus: status,
          atualizadoEm: new Date().toISOString(),
        },
        metadata: {
          source: 'pedido-agent',
          correlationId,
          version: 1,
        },
      };

      const message = Buffer.from(JSON.stringify(event));
      this.rabbitmqChannel.publish(
        'agentic.events',
        'pedido.status-atualizado',
        message,
        { persistent: true, contentType: 'application/json' }
      );
    }

    return pedido;
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

      if (this.rabbitmqChannel) {
        await this.rabbitmqChannel.close();
      }

      if (this.rabbitmqConnection) {
        await (this.rabbitmqConnection as any).close();
      }

      await this.commandBus.disconnect();
      this.logger.info('✓ RabbitMQ Command Bus disconnected');

      this.logger.info('✓ Pedido Agent stopped');
    } catch (error) {
      this.logger.error('Error stopping agent', error);
    }
  }
}

/**
 * Command Handler for CriarPedidoCommand
 */
class CriarPedidoCommandHandler implements ICommandHandler<CriarPedidoCommandData> {
  private readonly dbPool: Pool;
  private readonly eventBus: IEventBus;
  private readonly logger: Logger;

  constructor(dbPool: Pool, eventBus: IEventBus, logger: Logger) {
    this.dbPool = dbPool;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  commandType(): string {
    return 'CriarPedidoCommand';
  }

  entityType(): string {
    return 'Pedido';
  }

  async handle(command: CriarPedidoCommand): Promise<void> {
    const { id, data, metadata } = command;
    const { clienteId, itens } = data;
    const { correlationId } = metadata;

    this.logger.info('Handling CriarPedidoCommand', { commandId: id, correlationId });

    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      // 1. Validar regras de negócio (ex: cliente existe, produtos existem e têm estoque)
      // Por simplicidade, vamos assumir que as validações são bem-sucedidas aqui.
      // Em um cenário real, você faria consultas ao banco de dados ou chamaria outros agentes.
      this.logger.debug('Validating business rules for new pedido', { correlationId });

      // 2. Gravar pedido no PostgreSQL
      const pedidoResult = await client.query(
        `INSERT INTO pedidos (id, cliente_id, status, total, created_at, updated_at, ativo)
         VALUES ($1, $2, $3, $4, NOW(), NOW(), TRUE) RETURNING *`,
        [uuidv4(), clienteId, 'PENDENTE', 0] // Total será atualizado após inserir itens
      );
      const pedido = pedidoResult.rows[0];
      let totalPedido = 0;

      for (const item of itens) {
        // Buscar preço do produto (simulado)
        const produtoPreco = 100; // Simular preço do produto
        const subtotal = item.quantidade * produtoPreco;
        totalPedido += subtotal;

        await client.query(
          `INSERT INTO pedido_items (id, pedido_id, produto_id, quantidade, preco_unitario, subtotal, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          [uuidv4(), pedido.id, item.produtoId, item.quantidade, produtoPreco, subtotal]
        );
      }

      // Atualizar total do pedido
      await client.query(
        `UPDATE pedidos SET total = $1, updated_at = NOW() WHERE id = $2`,
        [totalPedido, pedido.id]
      );

      await client.query('COMMIT');
      this.logger.info('Pedido created and saved to PostgreSQL', { pedidoId: pedido.id, correlationId });

      // 3. Publicar evento PedidoCriado no EventBus existente
      const pedidoCriadoEvent = criarPedidoCriadoEvent(
        {
          pedidoId: pedido.id,
          clienteId: pedido.cliente_id,
          status: pedido.status,
          total: totalPedido,
          dataCriacao: new Date().toISOString(),
          itens: itens.map(item => ({ produtoId: item.produtoId, quantidade: item.quantidade, precoUnitario: 100 })) // Simular preço unitário
        },
        correlationId,
        'PedidoAgent'
      );
      await this.eventBus.publish(pedidoCriadoEvent);
      this.logger.info('PedidoCriado event published', { pedidoId: pedido.id, correlationId });
    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to handle CriarPedidoCommand', error, { commandId: id, correlationId });
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Command Handler for AtualizarPedidoCommand
 */
class AtualizarPedidoCommandHandler implements ICommandHandler<AtualizarPedidoCommandData> {
  private readonly dbPool: Pool;
  private readonly eventBus: IEventBus;
  private readonly logger: Logger;

  constructor(dbPool: Pool, eventBus: IEventBus, logger: Logger) {
    this.dbPool = dbPool;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  commandType(): string {
    return 'AtualizarPedidoCommand';
  }

  entityType(): string {
    return 'Pedido';
  }

  async handle(command: AtualizarPedidoCommand): Promise<void> {
    const { id, data, metadata } = command;
    const { pedidoId, itens, status } = data;
    const { correlationId } = metadata;

    this.logger.info('Handling AtualizarPedidoCommand', { commandId: id, correlationId, pedidoId });

    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verificar se o pedido existe
      const pedidoExistente = await client.query('SELECT * FROM pedidos WHERE id = $1 AND ativo = TRUE', [pedidoId]);
      if (pedidoExistente.rows.length === 0) {
        throw new Error(`Pedido ${pedidoId} não encontrado`);
      }

      // 2. Atualizar itens se fornecidos
      if (itens && itens.length > 0) {
        // Remover itens existentes
        await client.query('DELETE FROM pedido_items WHERE pedido_id = $1', [pedidoId]);

        // Inserir novos itens
        let totalPedido = 0;
        for (const item of itens) {
          const produtoPreco = 100; // Simular preço do produto
          const subtotal = item.quantidade * produtoPreco;
          totalPedido += subtotal;

          await client.query(
            `INSERT INTO pedido_items (id, pedido_id, produto_id, quantidade, preco_unitario, subtotal, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [uuidv4(), pedidoId, item.produtoId, item.quantidade, produtoPreco, subtotal]
          );
        }

        // Atualizar total do pedido
        await client.query(
          `UPDATE pedidos SET total = $1, updated_at = NOW() WHERE id = $2`,
          [totalPedido, pedidoId]
        );
      }

      // 3. Atualizar status se fornecido
      if (status) {
        await client.query(
          `UPDATE pedidos SET status = $1, updated_at = NOW() WHERE id = $2`,
          [status, pedidoId]
        );
      }

      await client.query('COMMIT');
      this.logger.info('Pedido updated in PostgreSQL', { pedidoId, correlationId });

      // 4. Publicar evento PedidoAtualizado no EventBus
      // (Assumindo que existe uma função criarPedidoAtualizadoEvent similar)
      // Por enquanto, vamos logar que o evento seria publicado
      this.logger.info('PedidoAtualizado event would be published', { pedidoId, correlationId });

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to handle AtualizarPedidoCommand', error, { commandId: id, correlationId });
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * Command Handler for CancelarPedidoCommand
 */
class CancelarPedidoCommandHandler implements ICommandHandler<CancelarPedidoCommandData> {
  private readonly dbPool: Pool;
  private readonly eventBus: IEventBus;
  private readonly logger: Logger;

  constructor(dbPool: Pool, eventBus: IEventBus, logger: Logger) {
    this.dbPool = dbPool;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  commandType(): string {
    return 'CancelarPedidoCommand';
  }

  entityType(): string {
    return 'Pedido';
  }

  async handle(command: CancelarPedidoCommand): Promise<void> {
    const { id, data, metadata } = command;
    const { pedidoId } = data;
    const { correlationId } = metadata;

    this.logger.info('Handling CancelarPedidoCommand', { commandId: id, correlationId, pedidoId });

    const client = await this.dbPool.connect();
    try {
      await client.query('BEGIN');

      // 1. Verificar se o pedido existe e pode ser cancelado
      const pedidoExistente = await client.query('SELECT * FROM pedidos WHERE id = $1 AND ativo = TRUE', [pedidoId]);
      if (pedidoExistente.rows.length === 0) {
        throw new Error(`Pedido ${pedidoId} não encontrado`);
      }

      const pedido = pedidoExistente.rows[0];
      if (pedido.status === 'CANCELADO') {
        throw new Error(`Pedido ${pedidoId} já está cancelado`);
      }

      // 2. Atualizar status para CANCELADO
      await client.query(
        `UPDATE pedidos SET status = 'CANCELADO', updated_at = NOW() WHERE id = $1`,
        [pedidoId]
      );

      await client.query('COMMIT');
      this.logger.info('Pedido cancelled in PostgreSQL', { pedidoId, correlationId });

      // 3. Publicar evento PedidoCancelado no EventBus
      // (Assumindo que existe uma função criarPedidoCanceladoEvent similar)
      this.logger.info('PedidoCancelado event would be published', { pedidoId, correlationId });

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to handle CancelarPedidoCommand', error, { commandId: id, correlationId });
      throw error;
    } finally {
      client.release();
    }
  }
}
