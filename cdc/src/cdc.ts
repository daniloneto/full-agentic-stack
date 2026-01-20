import { Pool, QueryResult } from 'pg';
import { Logger, criarClienteCriadoEvent, criarProdutoCriadoEvent, criarPedidoCriadoEvent } from '@agentic/shared';
import { RabbitMQEventBus } from '@agentic/event-bus';

interface CDCConfig {
  postgresUrl: string;
  rabbitmqUrl: string;
  pollIntervalMs?: number;
}

/**
 * Change Data Capture Service
 * Monitors PostgreSQL changes and publishes domain events
 */
export class ChangeDataCapture {
  private readonly pool: Pool;
  private readonly eventBus: RabbitMQEventBus;
  private readonly logger: Logger;
  private readonly config: Required<CDCConfig>;
  private isRunning = false;

  constructor(config: CDCConfig) {
    this.logger = new Logger('CDC');
    this.config = {
      postgresUrl: config.postgresUrl,
      rabbitmqUrl: config.rabbitmqUrl,
      pollIntervalMs: config.pollIntervalMs || 5000,
    };

    this.pool = new Pool({
      connectionString: this.config.postgresUrl,
    });

    this.eventBus = new RabbitMQEventBus({
      url: this.config.rabbitmqUrl,
      prefetch: 20,
    });
  }

  /**
   * Start CDC service
   */
  async start(): Promise<void> {
    try {
      // Connect to databases
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();

      await this.eventBus.connect();

      this.isRunning = true;
      this.logger.info('✓ CDC Service started');

      // Start polling
      this.poll();
    } catch (error) {
      this.logger.error('Failed to start CDC service', error);
      throw error;
    }
  }

  /**
   * Poll for changes
   */
  private async poll(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.checkForChanges();
      } catch (error) {
        this.logger.error('Error checking for changes', error);
      }

      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs));
    }
  }

  /**
   * Check for changes in each domain table
   */
  private async checkForChanges(): Promise<void> {
    const client = await this.pool.connect();    try {
      // Get last CDC position
      const positionResult = await client.query(
        `SELECT table_name, last_lsn FROM audit.cdc_position`
      );

      const positions = new Map<string, string>();
      for (const row of positionResult.rows) {
        const lsn = row.last_lsn === '0' || !row.last_lsn ? '' : row.last_lsn;
        positions.set(row.table_name, lsn);
      }

      // Check Cliente changes
      await this.processClienteChanges(client, positions);

      // Check Produto changes
      await this.processProdutoChanges(client, positions);

      // Check Pedido changes
      await this.processPedidoChanges(client, positions);
    } finally {
      client.release();
    }
  }
  /**
   * Process Cliente changes
   */
  private async processClienteChanges(
    client: any,
    positions: Map<string, string>
  ): Promise<void> {
    const lastPosition = positions.get('Cliente') || '';

    let query = `SELECT * FROM audit.event_log WHERE entity_type = $1`;
    const params: any[] = ['Cliente'];
    if (lastPosition) {
      query += ` AND id > $2::uuid`;
      params.push(lastPosition);
    }
    query += ` ORDER BY id ASC`;

    const result: QueryResult = await client.query(query, params);

    for (const row of result.rows) {
      if (row.event_type === 'INSERT') {
        const data = JSON.parse(row.data);

        const event = criarClienteCriadoEvent(
          {
            clienteId: data.id,
            nome: data.nome,
            email: data.email,
            telefone: data.telefone,
            endereco: data.endereco,
          },
          row.correlation_id || '',
          'cdc'
        );

        await this.eventBus.publish(event);        // Update CDC position
        await client.query(
          `INSERT INTO audit.cdc_position (table_name, last_lsn)
           VALUES ($1, $2)
           ON CONFLICT (table_name) DO UPDATE SET last_lsn = $2`,
          ['Cliente', row.id]
        );

        this.logger.debug('Cliente event published', {
          clienteId: data.id,
          eventId: event.id,
        });
      }
    }
  }
  /**
   * Process Produto changes
   */
  private async processProdutoChanges(
    client: any,
    positions: Map<string, string>
  ): Promise<void> {
    const lastPosition = positions.get('Produto') || '';

    let query = `SELECT * FROM audit.event_log WHERE entity_type = $1`;
    const params: any[] = ['Produto'];
    if (lastPosition) {
      query += ` AND id > $2::uuid`;
      params.push(lastPosition);
    }
    query += ` ORDER BY id ASC`;

    const result: QueryResult = await client.query(query, params);

    for (const row of result.rows) {
      if (row.event_type === 'INSERT') {
        const data = JSON.parse(row.data);

        const event = criarProdutoCriadoEvent(
          {
            produtoId: data.id,
            nome: data.nome,
            descricao: data.descricao,
            preco: data.preco,
            estoque: data.estoque,
            sku: data.sku,
          },
          row.correlation_id || '',
          'cdc'
        );

        await this.eventBus.publish(event);        // Update CDC position
        await client.query(
          `INSERT INTO audit.cdc_position (table_name, last_lsn)
           VALUES ($1, $2)
           ON CONFLICT (table_name) DO UPDATE SET last_lsn = $2`,
          ['Produto', row.id]
        );

        this.logger.debug('Produto event published', {
          produtoId: data.id,
          eventId: event.id,
        });
      }
    }
  }
  /**
   * Process Pedido changes
   */
  private async processPedidoChanges(
    client: any,
    positions: Map<string, string>
  ): Promise<void> {
    const lastPosition = positions.get('Pedido') || '';

    let query = `SELECT * FROM audit.event_log WHERE entity_type = $1`;
    const params: any[] = ['Pedido'];
    if (lastPosition) {
      query += ` AND id > $2::uuid`;
      params.push(lastPosition);
    }
    query += ` ORDER BY id ASC`;

    const result: QueryResult = await client.query(query, params);

    for (const row of result.rows) {
      if (row.event_type === 'INSERT') {
        const data = JSON.parse(row.data);

        const event = criarPedidoCriadoEvent(
          {
            pedidoId: data.id,
            clienteId: data.cliente_id,
            itens: data.itens || [],
            total: data.total,
            status: data.status,
            dataCriacao: data.created_at,
          },
          row.correlation_id || '',
          'cdc'
        );

        await this.eventBus.publish(event);        // Update CDC position
        await client.query(
          `INSERT INTO audit.cdc_position (table_name, last_lsn)
           VALUES ($1, $2)
           ON CONFLICT (table_name) DO UPDATE SET last_lsn = $2`,
          ['Pedido', row.id]
        );

        this.logger.debug('Pedido event published', {
          pedidoId: data.id,
          eventId: event.id,
        });
      }
    }
  }

  /**
   * Stop CDC service
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    await this.pool.end();
    await this.eventBus.disconnect();
    this.logger.info('✓ CDC Service stopped');
  }

  /**
   * Get status
   */
  getStatus(): {
    running: boolean;
    poolStatus: {
      idleCount: number;
      waitingCount: number;
    };
  } {
    return {
      running: this.isRunning,
      poolStatus: {
        idleCount: this.pool.idleCount,
        waitingCount: this.pool.waitingCount,
      },
    };
  }
}

// Export factory function
export async function createCDC(): Promise<ChangeDataCapture> {  const config: CDCConfig = {
    postgresUrl: process.env.POSTGRES_URL || 'postgresql://localhost/agentic',
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
    pollIntervalMs: Number.parseInt(process.env.CDC_POLL_INTERVAL || '5000', 10),
  };

  return new ChangeDataCapture(config);
}
