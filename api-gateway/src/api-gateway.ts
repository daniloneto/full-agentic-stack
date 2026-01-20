import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import { Pool } from 'pg';
import { Logger, criarClienteCriadoEvent, criarProdutoCriadoEvent, criarPedidoCriadoEvent } from '@agentic/shared';
import { RabbitMQEventBus } from '@agentic/event-bus';

interface AppConfig {
  port: number;
  rabbitmqUrl: string;
  databaseUrl: string;
}

interface PaginationParams {
  page: number;
  limit: number;
  offset: number;
}

interface QueryResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

/**
 * API Gateway - HTTP Entry Point */
export class ApiGateway {
  private readonly app: Express;
  private readonly logger: Logger;
  private readonly eventBus: RabbitMQEventBus;
  private readonly dbPool: Pool;
  private readonly config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
    this.logger = new Logger('ApiGateway');
    this.app = express();
    this.eventBus = new RabbitMQEventBus({      url: config.rabbitmqUrl,
      prefetch: 10,
    });
    this.dbPool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    this.app.use(cors());
    this.app.use(express.json());

    // Request logging
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      this.logger.info(`${req.method} ${req.path}`, {
        ip: req.ip,
        userAgent: req.get('user-agent'),
      });
      next();
    });

    // Add correlation ID to all requests
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const correlationId = req.headers['x-correlation-id'] || uuidv4();
      (req as any).correlationId = correlationId;
      res.setHeader('x-correlation-id', correlationId);
      next();
    });
  }
  /**
   * Setup routes
   */
  private setupRoutes(): void {
    // Health check
    this.app.get('/health', this.handleHealth.bind(this));

    // Clientes routes
    this.app.post('/api/clientes', this.handleCreateCliente.bind(this));
    this.app.get('/api/clientes', this.handleListClientes.bind(this));
    this.app.get('/api/clientes/:id', this.handleGetCliente.bind(this));
    this.app.put('/api/clientes/:id', this.handleUpdateCliente.bind(this));
    this.app.delete('/api/clientes/:id', this.handleDeleteCliente.bind(this));

    // Produtos routes
    this.app.post('/api/produtos', this.handleCreateProduto.bind(this));
    this.app.get('/api/produtos', this.handleListProdutos.bind(this));
    this.app.get('/api/produtos/:id', this.handleGetProduto.bind(this));
    this.app.put('/api/produtos/:id', this.handleUpdateProduto.bind(this));
    this.app.delete('/api/produtos/:id', this.handleDeleteProduto.bind(this));

    // Pedidos routes
    this.app.post('/api/pedidos', this.handleCreatePedido.bind(this));
    this.app.get('/api/pedidos', this.handleListPedidos.bind(this));
    this.app.get('/api/pedidos/:id', this.handleGetPedido.bind(this));
    this.app.put('/api/pedidos/:id', this.handleUpdatePedido.bind(this));
    this.app.delete('/api/pedidos/:id', this.handleDeletePedido.bind(this));

    // 404
    this.app.use((_req: Request, res: Response) => {
      res.status(404).json({
        error: 'Not found',
        timestamp: new Date().toISOString(),
      });
    });
  }
  /**
   * Health check handler
   */
  private async handleHealth(_req: Request, res: Response): Promise<void> {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      eventBus: this.eventBus.getStatus(),
    });
  }

  /**
   * Extract and validate pagination params
   */
  private getPaginationParams(req: Request): PaginationParams {
    const page = Math.max(1, Number.parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit as string) || 20));
    const offset = (page - 1) * limit;
    return { page, limit, offset };
  }

  /**
   * Handle create cliente
   */
  private async handleCreateCliente(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { nome, email, telefone, endereco } = req.body;
      const correlationId = (req as any).correlationId as string;

      // Validation
      if (!nome || !email || !telefone || !endereco) {
        res.status(400).json({
          error: 'Missing required fields: nome, email, telefone, endereco',
        });
        return;
      }

      const clienteId = uuidv4();

      // Create event (we create event before DB so we can store its id)
      const event = criarClienteCriadoEvent(
        {
          clienteId,
          nome,
          email,
          telefone,
          endereco,
        },
        correlationId,
        'api-gateway'
      );

      // Persist to domain database
      const now = new Date().toISOString();
      try {
        const insertResult = await this.dbPool.query(
          `INSERT INTO domain.clientes (id, nome, email, telefone, endereco, ativo, created_at, updated_at, created_by_event_id)
           VALUES ($1, $2, $3, $4, $5, true, $6, $6, $7)
           RETURNING id`,
          [clienteId, nome, email, telefone, JSON.stringify(endereco), now, event.id]
        );
        if (insertResult.rows.length === 0) {
          this.logger.warn('Cliente insert returned no rows', { clienteId });
          res.status(500).json({ error: 'Failed to persist cliente' });
          return;
        }
        this.logger.info('Inserted cliente into domain', { clienteId });
      } catch (err: any) {
        // Unique constraint (email) or other DB errors
        if (err && err.code === '23505') {
          res.status(409).json({ error: 'Cliente already exists', detail: err.detail });
          return;
        }
        throw err;
      }

      // Publish event
      await this.eventBus.publish(event);

      this.logger.info('Cliente created', {
        clienteId,
        correlationId,
      });

      res.status(201).json({
        clienteId,
        message: 'Cliente criado com sucesso',
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle create produto
   */
  private async handleCreateProduto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { nome, descricao, preco, estoque, sku } = req.body;
      const correlationId = (req as any).correlationId as string;

      // Validation
      if (!nome || preco === undefined || !sku) {
        res.status(400).json({
          error: 'Missing required fields: nome, preco, sku',
        });
        return;
      }

      const produtoId = uuidv4();

      // Create event
      const event = criarProdutoCriadoEvent(
        {
          produtoId,
          nome,
          descricao,
          preco,
          estoque: estoque || 0,
          sku,
        },
        correlationId,
        'api-gateway'
      );

      // Persist to domain database
      const now = new Date().toISOString();
      try {
        const insertResult = await this.dbPool.query(
          `INSERT INTO domain.produtos (id, sku, nome, descricao, preco, estoque, ativo, created_at, updated_at, created_by_event_id)
           VALUES ($1, $2, $3, $4, $5, $6, true, $7, $7, $8)
           RETURNING id`,
          [produtoId, sku, nome, descricao, preco, estoque || 0, now, event.id]
        );
        if (insertResult.rows.length === 0) {
          this.logger.warn('Produto insert returned no rows', { produtoId });
          res.status(500).json({ error: 'Failed to persist produto' });
          return;
        }
        this.logger.info('Inserted produto into domain', { produtoId });
      } catch (err: any) {
        if (err && err.code === '23505') {
          res.status(409).json({ error: 'Produto already exists (sku conflict)', detail: err.detail });
          return;
        }
        throw err;
      }

      // Publish event
      await this.eventBus.publish(event);

      this.logger.info('Produto created', {
        produtoId,
        correlationId,
      });

      res.status(201).json({
        produtoId,
        message: 'Produto criado com sucesso',
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }
  /**
   * Handle create pedido
   */
  private async handleCreatePedido(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { clienteId, itens, observacoes } = req.body;
      const correlationId = (req as any).correlationId as string;

      // Validation
      if (!clienteId || !Array.isArray(itens) || itens.length === 0) {
        res.status(400).json({
          error: 'Missing required fields: clienteId, itens (non-empty array)',
        });
        return;
      }

      // Validate cliente exists
      const clienteCheck = await this.dbPool.query('SELECT id FROM domain.clientes WHERE id = $1 AND ativo = true', [clienteId]);
      if (clienteCheck.rows.length === 0) {
        res.status(400).json({ error: 'Cliente not found' });
        return;
      }

      // Validate produtos exist
      for (const item of itens) {
        const prodCheck = await this.dbPool.query('SELECT id FROM domain.produtos WHERE id = $1 AND ativo = true', [item.produtoId]);
        if (prodCheck.rows.length === 0) {
          res.status(400).json({ error: `Produto not found: ${item.produtoId}` });
          return;
        }
      }

      // Calculate total
      const total = itens.reduce((sum: number, item: any) => sum + item.quantidade * item.precoUnitario, 0);
      const pedidoId = uuidv4();
      const now = new Date().toISOString();

      // Create event (we'll publish after DB transaction)
      const event = criarPedidoCriadoEvent(
        {
          pedidoId,
          clienteId,
          itens,
          total,
          status: 'PENDENTE',
          dataCriacao: now,
        },
        correlationId,
        'api-gateway'
      );

      // Persist to domain database in a transaction
      const client = await this.dbPool.connect();
      try {
        await client.query('BEGIN');

        const insertPedidoResult = await client.query(
          `INSERT INTO domain.pedidos (id, cliente_id, status, total, observacoes, created_at, updated_at, created_by_event_id)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7)
           RETURNING id`,
          [pedidoId, clienteId, 'PENDENTE', total, observacoes || null, now, event.id]
        );

        if (insertPedidoResult.rows.length === 0) {
          await client.query('ROLLBACK');
          this.logger.warn('Pedido insert returned no rows', { pedidoId });
          res.status(500).json({ error: 'Failed to persist pedido' });
          return;
        }

        for (const item of itens) {
          const itemId = uuidv4();
          const subtotal = item.quantidade * item.precoUnitario;
          await client.query(
            `INSERT INTO domain.pedido_itens (id, pedido_id, produto_id, quantidade, preco_unitario, subtotal, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [itemId, pedidoId, item.produtoId, item.quantidade, item.precoUnitario, subtotal, now]
          );
        }

        await client.query('COMMIT');
        this.logger.info('Inserted pedido into domain', { pedidoId });
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      // Publish event after commit
      await this.eventBus.publish(event);

      this.logger.info('Pedido created', {
        pedidoId,
        clienteId,
        correlationId,
      });

      res.status(201).json({
        pedidoId,
        message: 'Pedido criado com sucesso',
        total,
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle list clientes
   */
  private async handleListClientes(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pagination = this.getPaginationParams(req);
      const nome = req.query.nome as string;
      const email = req.query.email as string;

      let query = 'SELECT id, nome, email, telefone, endereco, ativo, created_at, updated_at FROM domain.clientes WHERE ativo = true';
      const params: any[] = [];
      let paramIndex = 1;

      if (nome) {
        query += ` AND nome ILIKE $${paramIndex}`;
        params.push(`%${nome}%`);
        paramIndex++;
      }

      if (email) {
        query += ` AND email ILIKE $${paramIndex}`;
        params.push(`%${email}%`);
        paramIndex++;
      }

      // Get total count
      const countResult = await this.dbPool.query(
        query.replace('SELECT id, nome, email, telefone, endereco, ativo, created_at, updated_at', 'SELECT COUNT(*) as total'),
        params
      );
      const total = Number.parseInt(countResult.rows[0].total);

      // Get paginated results
      const result = await this.dbPool.query(
        `${query} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pagination.limit, pagination.offset]
      );

      const response: QueryResponse<any> = {
        data: result.rows,
        total,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: pagination.offset + pagination.limit < total,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle get single cliente
   */
  private async handleGetCliente(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const result = await this.dbPool.query(
        'SELECT id, nome, email, telefone, endereco, ativo, created_at, updated_at FROM domain.clientes WHERE id = $1 AND ativo = true',
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Cliente not found' });
        return;
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle update cliente
   */
  private async handleUpdateCliente(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { nome, email, telefone, endereco } = req.body;
      const correlationId = (req as any).correlationId as string;

      // Check if cliente exists
      const existing = await this.dbPool.query(
        'SELECT id FROM domain.clientes WHERE id = $1 AND ativo = true',
        [id]
      );

      if (existing.rows.length === 0) {
        res.status(404).json({ error: 'Cliente not found' });
        return;
      }

      // Build update query
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (nome) {
        updates.push(`nome = $${paramIndex}`);
        params.push(nome);
        paramIndex++;
      }

      if (email) {
        updates.push(`email = $${paramIndex}`);
        params.push(email);
        paramIndex++;
      }

      if (telefone) {
        updates.push(`telefone = $${paramIndex}`);
        params.push(telefone);
        paramIndex++;
      }

      if (endereco) {
        updates.push(`endereco = $${paramIndex}`);
        params.push(JSON.stringify(endereco));
        paramIndex++;
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      params.push(id);

      const result = await this.dbPool.query(
        `UPDATE domain.clientes SET ${updates.join(', ')} WHERE id = $${paramIndex} AND ativo = true RETURNING *`,
        params
      );

      this.logger.info('Cliente updated', { id, correlationId });

      res.json({
        message: 'Cliente updated successfully',
        data: result.rows[0],
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle delete cliente (soft delete)
   */
  private async handleDeleteCliente(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const correlationId = (req as any).correlationId as string;

      const result = await this.dbPool.query(
        'UPDATE domain.clientes SET ativo = false WHERE id = $1 AND ativo = true RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Cliente not found' });
        return;
      }

      this.logger.info('Cliente deleted', { id, correlationId });

      res.json({
        message: 'Cliente deleted successfully',
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle list produtos
   */
  private async handleListProdutos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pagination = this.getPaginationParams(req);
      const nome = req.query.nome as string;
      const sku = req.query.sku as string;

      let query = 'SELECT id, sku, nome, descricao, preco, estoque, ativo, created_at, updated_at FROM domain.produtos WHERE ativo = true';
      const params: any[] = [];
      let paramIndex = 1;

      if (nome) {
        query += ` AND nome ILIKE $${paramIndex}`;
        params.push(`%${nome}%`);
        paramIndex++;
      }

      if (sku) {
        query += ` AND sku ILIKE $${paramIndex}`;
        params.push(`%${sku}%`);
        paramIndex++;
      }

      // Get total count
      const countResult = await this.dbPool.query(
        query.replace('SELECT id, sku, nome, descricao, preco, estoque, ativo, created_at, updated_at', 'SELECT COUNT(*) as total'),
        params
      );
      const total = Number.parseInt(countResult.rows[0].total);

      // Get paginated results
      const result = await this.dbPool.query(
        `${query} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pagination.limit, pagination.offset]
      );

      const response: QueryResponse<any> = {
        data: result.rows,
        total,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: pagination.offset + pagination.limit < total,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle get single produto
   */
  private async handleGetProduto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const result = await this.dbPool.query(
        'SELECT id, sku, nome, descricao, preco, estoque, ativo, created_at, updated_at FROM domain.produtos WHERE id = $1 AND ativo = true',
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Produto not found' });
        return;
      }

      res.json(result.rows[0]);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle update produto
   */
  private async handleUpdateProduto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { nome, descricao, preco, estoque } = req.body;
      const correlationId = (req as any).correlationId as string;

      // Check if produto exists
      const existing = await this.dbPool.query(
        'SELECT id FROM domain.produtos WHERE id = $1 AND ativo = true',
        [id]
      );

      if (existing.rows.length === 0) {
        res.status(404).json({ error: 'Produto not found' });
        return;
      }

      // Build update query
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (nome) {
        updates.push(`nome = $${paramIndex}`);
        params.push(nome);
        paramIndex++;
      }

      if (descricao) {
        updates.push(`descricao = $${paramIndex}`);
        params.push(descricao);
        paramIndex++;
      }

      if (preco !== undefined) {
        updates.push(`preco = $${paramIndex}`);
        params.push(preco);
        paramIndex++;
      }

      if (estoque !== undefined) {
        updates.push(`estoque = $${paramIndex}`);
        params.push(estoque);
        paramIndex++;
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      params.push(id);

      const result = await this.dbPool.query(
        `UPDATE domain.produtos SET ${updates.join(', ')} WHERE id = $${paramIndex} AND ativo = true RETURNING *`,
        params
      );

      this.logger.info('Produto updated', { id, correlationId });

      res.json({
        message: 'Produto updated successfully',
        data: result.rows[0],
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle delete produto (soft delete)
   */
  private async handleDeleteProduto(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const correlationId = (req as any).correlationId as string;

      const result = await this.dbPool.query(
        'UPDATE domain.produtos SET ativo = false WHERE id = $1 AND ativo = true RETURNING id',
        [id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Produto not found' });
        return;
      }

      this.logger.info('Produto deleted', { id, correlationId });

      res.json({
        message: 'Produto deleted successfully',
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle list pedidos
   */
  private async handleListPedidos(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const pagination = this.getPaginationParams(req);
      const clienteId = req.query.clienteId as string;
      const status = req.query.status as string;

      let query = 'SELECT id, cliente_id, status, total, observacoes, created_at, updated_at FROM domain.pedidos';
      const params: any[] = [];
      let paramIndex = 1;

      if (clienteId) {
        query += ` WHERE cliente_id = $${paramIndex}`;
        params.push(clienteId);
        paramIndex++;
      }

      if (status) {
        if (clienteId) {
          query += ` AND status = $${paramIndex}`;
        } else {
          query += ` WHERE status = $${paramIndex}`;
        }
        params.push(status);
        paramIndex++;
      }

      // Get total count
      const countResult = await this.dbPool.query(
        query.replace('SELECT id, cliente_id, status, total, observacoes, created_at, updated_at', 'SELECT COUNT(*) as total'),
        params
      );
      const total = Number.parseInt(countResult.rows[0].total);

      // Get paginated results
      const result = await this.dbPool.query(
        `${query} ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
        [...params, pagination.limit, pagination.offset]
      );

      const response: QueryResponse<any> = {
        data: result.rows,
        total,
        page: pagination.page,
        limit: pagination.limit,
        hasMore: pagination.offset + pagination.limit < total,
      };

      res.json(response);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle get single pedido with items
   */
  private async handleGetPedido(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // Get pedido
      const pedidoResult = await this.dbPool.query(
        'SELECT id, cliente_id, status, total, observacoes, created_at, updated_at FROM domain.pedidos WHERE id = $1',
        [id]
      );

      if (pedidoResult.rows.length === 0) {
        res.status(404).json({ error: 'Pedido not found' });
        return;
      }

      const pedido = pedidoResult.rows[0];

      // Get itens
      const itensResult = await this.dbPool.query(
        'SELECT id, pedido_id, produto_id, quantidade, preco_unitario, subtotal, created_at FROM domain.pedido_itens WHERE pedido_id = $1',
        [id]
      );

      res.json({
        ...pedido,
        itens: itensResult.rows,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle update pedido status
   */
  private async handleUpdatePedido(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { status, observacoes } = req.body;
      const correlationId = (req as any).correlationId as string;

      // Check if pedido exists
      const existing = await this.dbPool.query(
        'SELECT id FROM domain.pedidos WHERE id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        res.status(404).json({ error: 'Pedido not found' });
        return;
      }

      // Build update query
      const updates: string[] = [];
      const params: any[] = [];
      let paramIndex = 1;

      if (status) {
        updates.push(`status = $${paramIndex}`);
        params.push(status);
        paramIndex++;
      }

      if (observacoes) {
        updates.push(`observacoes = $${paramIndex}`);
        params.push(observacoes);
        paramIndex++;
      }

      if (updates.length === 0) {
        res.status(400).json({ error: 'No fields to update' });
        return;
      }

      params.push(id);

      const result = await this.dbPool.query(
        `UPDATE domain.pedidos SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        params
      );

      this.logger.info('Pedido updated', { id, correlationId });

      res.json({
        message: 'Pedido updated successfully',
        data: result.rows[0],
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Handle delete pedido (soft delete by status)
   */
  private async handleDeletePedido(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const correlationId = (req as any).correlationId as string;

      const result = await this.dbPool.query(
        'UPDATE domain.pedidos SET status = $1 WHERE id = $2 RETURNING id',
        ['CANCELADO', id]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ error: 'Pedido not found' });
        return;
      }

      this.logger.info('Pedido cancelled', { id, correlationId });

      res.json({
        message: 'Pedido cancelled successfully',
        correlationId,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Setup error handling
   */
  private setupErrorHandling(): void {
    this.app.use(
      (
        error: Error,
        _req: Request,
        res: Response,
        _next: NextFunction
      ) => {
        this.logger.error('Request error', error);

        res.status(500).json({
          error: 'Internal server error',
          message: process.env.NODE_ENV === 'development' ? error.message : undefined,
          timestamp: new Date().toISOString(),
        });
      }
    );
  }
  /**
   * Start server
   */
  async start(): Promise<void> {
    try {
      // Test database connection
      this.logger.info('Testing database connection...');
      const client = await this.dbPool.connect();
      await client.query('SELECT 1');
      client.release();
      this.logger.info('✓ Database connected');

      // Connect to event bus
      await this.eventBus.connect();

      // Start HTTP server
      this.app.listen(this.config.port, () => {
        this.logger.info(`✓ API Gateway listening on port ${this.config.port}`);
        this.logger.info(`  Health check: http://localhost:${this.config.port}/health`);
      });
    } catch (error) {
      this.logger.error('Failed to start API Gateway', error);
      throw error;
    }
  }
  /**
   * Stop server
   */
  async stop(): Promise<void> {
    await this.eventBus.disconnect();
    await this.dbPool.end();
    this.logger.info('✓ API Gateway stopped');
  }
}

// Export factory function
export async function createApiGateway(): Promise<ApiGateway> {
  const config: AppConfig = {
    port: Number.parseInt(process.env.PORT || '3000', 10),
    rabbitmqUrl: process.env.RABBITMQ_URL || 'amqp://localhost',
    databaseUrl: process.env.POSTGRES_URL || process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/agentic',
  };

  const gateway = new ApiGateway(config);
  return gateway;
}
