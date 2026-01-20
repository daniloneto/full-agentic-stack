import { IEventBus, DomainEvent, IEventHandler, Logger } from '@agentic/shared';
import { Client } from '@opensearch-project/opensearch';
import amqp from 'amqplib';

interface SearchAgentConfig {
  eventBus: IEventBus;
  opensearchUrl: string;
  rabbitmqUrl: string;
}

/**
 * Search Agent
 * 
 * Responsibilities:
 * - Subscribe to all domain events (Cliente, Produto, Pedido)
 * - Index entities in OpenSearch for full-text search
 * - Maintain search indexes and mappings
 * - Enable global search capabilities
 * - Publish SearchIndexed events
 * 
 * Event Flow:
 * API Gateway → Domain Events → SearchAgent → OpenSearch
 *                          ↓
 *                  Full-Text Index
 *                          ↓
 *                    SearchIndexed → Next Agents
 */
export class SearchAgent implements IEventHandler<Record<string, unknown>> {
  private readonly eventBus: IEventBus;
  private readonly opensearchClient: Client;
  private readonly logger: Logger;
  private readonly config: SearchAgentConfig;
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

  constructor(config: SearchAgentConfig) {
    this.config = config;
    this.eventBus = config.eventBus;
    this.logger = new Logger('SearchAgent');

    // Initialize OpenSearch client
    this.opensearchClient = new Client({
      node: config.opensearchUrl,
      auth: {
        username: process.env.OPENSEARCH_USERNAME || 'admin',
        password: process.env.OPENSEARCH_PASSWORD || 'Admin@123',
      },
      ssl: {
        rejectUnauthorized: false,
      },
    });
  }
  async initialize(): Promise<void> {
    try {
      // Test OpenSearch connection
      const health = await this.opensearchClient.cluster.health();
      this.logger.info('✓ Connected to OpenSearch', { status: (health as any).body?.status });

      // Setup RabbitMQ for publishing events
      await this.setupRabbitMQ();
      this.logger.info('✓ Connected to RabbitMQ');

      // Create search indexes if they don't exist
      await this.setupIndexes();
      this.logger.info('✓ Search indexes ready');

      // Subscribe to all domain events
      await this.subscribeToEvents();
      this.logger.info('✓ Subscribed to domain events');

      this.logger.info('✓ Search Agent initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Search Agent', error);
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
   * Create OpenSearch indexes and mappings
   */  private async setupIndexes(): Promise<void> {
    // Clientes index
    try {
      const clientesIndexExists = await this.opensearchClient.indices.exists({
        index: 'clientes',
      });

      if (!(clientesIndexExists as any).body) {
        await this.opensearchClient.indices.create({
          index: 'clientes',
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 1,
              analysis: {
                analyzer: {
                  default: {
                    type: 'standard',
                    stopwords: '_portuguese_',
                  },
                },
              },
            },
            mappings: {
              properties: {
                id: { type: 'keyword' },
                nome: { type: 'text', analyzer: 'standard' },
                email: { type: 'keyword' },
                telefone: { type: 'keyword' },
                endereco: { type: 'object' },
                ativo: { type: 'boolean' },
                created_at: { type: 'date' },
                updated_at: { type: 'date' },
              },
            },
          },
        });        this.logger.info('✓ Created clientes index');
      }
    } catch (error) {
      this.logger.warn('Clientes index creation warning', { error: String(error) });
    }

    // Produtos index
    try {      const produtosIndexExists = await this.opensearchClient.indices.exists({
        index: 'produtos',
      });

      if (!(produtosIndexExists as any).body) {
        await this.opensearchClient.indices.create({
          index: 'produtos',
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 1,
              analysis: {
                analyzer: {
                  default: {
                    type: 'standard',
                    stopwords: '_portuguese_',
                  },
                },
              },
            },
            mappings: {
              properties: {
                id: { type: 'keyword' },
                nome: { type: 'text', analyzer: 'standard' },
                descricao: { type: 'text', analyzer: 'standard' },
                sku: { type: 'keyword' },
                preco: { type: 'float' },
                estoque: { type: 'integer' },
                ativo: { type: 'boolean' },
                created_at: { type: 'date' },
                updated_at: { type: 'date' },
              },
            },
          },
        });        this.logger.info('✓ Created produtos index');
      }
    } catch (error) {
      this.logger.warn('Produtos index creation warning', { error: String(error) });
    }

    // Pedidos index
    try {      const pedidosIndexExists = await this.opensearchClient.indices.exists({
        index: 'pedidos',
      });

      if (!(pedidosIndexExists as any).body) {
        await this.opensearchClient.indices.create({
          index: 'pedidos',
          body: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 1,
            },
            mappings: {
              properties: {
                id: { type: 'keyword' },
                cliente_id: { type: 'keyword' },
                status: { type: 'keyword' },
                total: { type: 'float' },
                observacoes: { type: 'text' },
                ativo: { type: 'boolean' },
                created_at: { type: 'date' },
                updated_at: { type: 'date' },
              },
            },
          },
        });        this.logger.info('✓ Created pedidos index');
      }
    } catch (error) {
      this.logger.warn('Pedidos index creation warning', { error: String(error) });
    }
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
          await this.indexCliente(event);
          break;
        case 'ProdutoCriado':
          await this.indexProduto(event);
          break;
        case 'PedidoCriado':
          await this.indexPedido(event);
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
   * Index cliente in OpenSearch
   */
  private async indexCliente(event: DomainEvent<any>): Promise<void> {
    const { clienteId, nome, email, telefone, endereco } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Indexing cliente', { clienteId, correlationId });

    try {
      await this.opensearchClient.index({
        index: 'clientes',
        id: clienteId,
        body: {
          id: clienteId,
          nome,
          email,
          telefone,
          endereco,
          ativo: true,
          created_at: event.timestamp,
          updated_at: event.timestamp,
        },
      });

      await this.publishSearchIndexed('cliente', clienteId, correlationId);
    } catch (error) {
      this.logger.error('Error indexing cliente', error, { clienteId });
      throw error;
    }
  }

  /**
   * Index produto in OpenSearch
   */
  private async indexProduto(event: DomainEvent<any>): Promise<void> {
    const { produtoId, nome, descricao, sku, preco, estoque } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Indexing produto', { produtoId, sku, correlationId });

    try {
      await this.opensearchClient.index({
        index: 'produtos',
        id: produtoId,
        body: {
          id: produtoId,
          nome,
          descricao,
          sku,
          preco,
          estoque,
          ativo: true,
          created_at: event.timestamp,
          updated_at: event.timestamp,
        },
      });

      await this.publishSearchIndexed('produto', produtoId, correlationId);
    } catch (error) {
      this.logger.error('Error indexing produto', error, { produtoId });
      throw error;
    }
  }

  /**
   * Index pedido in OpenSearch
   */
  private async indexPedido(event: DomainEvent<any>): Promise<void> {
    const { pedidoId, clienteId, status, total, observacoes } = event.data;
    const correlationId = event.metadata.correlationId;

    this.logger.info('Indexing pedido', { pedidoId, clienteId, correlationId });

    try {
      await this.opensearchClient.index({
        index: 'pedidos',
        id: pedidoId,
        body: {
          id: pedidoId,
          cliente_id: clienteId,
          status: status || 'PENDENTE',
          total,
          observacoes,
          ativo: true,
          created_at: event.timestamp,
          updated_at: event.timestamp,
        },
      });

      await this.publishSearchIndexed('pedido', pedidoId, correlationId);
    } catch (error) {
      this.logger.error('Error indexing pedido', error, { pedidoId });
      throw error;
    }
  }

  /**
   * Publish SearchIndexed event
   */
  private async publishSearchIndexed(
    entityType: string,
    entityId: string,
    correlationId: string
  ): Promise<void> {
    if (!this.rabbitmqChannel) {
      throw new Error('RabbitMQ channel not initialized');
    }

    const event = {
      id: crypto.randomUUID ? crypto.randomUUID() : generateUUID(),
      type: 'SearchIndexed',
      entity: entityType,
      timestamp: new Date().toISOString(),
      data: {
        entityType,
        entityId,
        indexedAt: new Date().toISOString(),
      },
      metadata: {
        source: 'search-agent',
        correlationId,
        version: 1,
      },
    };

    const message = Buffer.from(JSON.stringify(event));
    const routingKey = `search.indexed`;

    this.rabbitmqChannel.publish(
      'agentic.events',
      routingKey,
      message,
      { persistent: true, contentType: 'application/json' }
    );

    this.logger.info('Published SearchIndexed event', {
      entityType,
      entityId,
      routingKey,
    });
  }

  /**
   * Full-text search
   */
  async search(index: string, query: string, limit: number = 10): Promise<any[]> {
    try {
      const result = await this.opensearchClient.search({
        index,
        body: {
          query: {
            multi_match: {
              query,
              fields: ['nome^2', 'descricao', 'email', 'telefone'],
              fuzziness: 'AUTO',
            },
          },
          size: limit,        },
      });

      return (result as any).body.hits.hits.map((hit: any) => hit._source);
    } catch (error) {
      this.logger.error('Search error', error, { index, query });
      return [];
    }
  }

  /**
   * Cleanup resources
   */
  async stop(): Promise<void> {    try {
      if (this.rabbitmqChannel) {
        await this.rabbitmqChannel.close();
      }

      if (this.rabbitmqConnection) {
        await (this.rabbitmqConnection as any).close();
      }

      this.logger.info('✓ RabbitMQ connection closed');
      this.logger.info('✓ Search Agent stopped');
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
