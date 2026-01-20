db = db.getSiblingDB('agentic');

// Create collections with schema validation
db.createCollection('pedidos', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['pedidoId', 'clienteId', 'status', 'total', 'dataCriacao'],
      properties: {
        _id: { bsonType: 'objectId' },
        pedidoId: { bsonType: 'string', description: 'UUID do pedido' },
        clienteId: { bsonType: 'string', description: 'UUID do cliente' },
        clienteNome: { bsonType: 'string' },
        status: {
          enum: ['PENDENTE', 'CONFIRMADO', 'PROCESSANDO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'],
        },
        itens: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              produtoId: { bsonType: 'string' },
              produtoNome: { bsonType: 'string' },
              quantidade: { bsonType: 'int' },
              precoUnitario: { bsonType: 'decimal' },
            },
          },
        },
        total: { bsonType: 'decimal' },
        dataCriacao: { bsonType: 'string' },
        dataAtualizacao: { bsonType: 'string' },
        timeline: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: {
              timestamp: { bsonType: 'string' },
              status: { bsonType: 'string' },
              mensagem: { bsonType: 'string' },
            },
          },
        },
      },
    },
  },
});

db.createCollection('clientes', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['clienteId', 'nome', 'email'],
      properties: {
        _id: { bsonType: 'objectId' },
        clienteId: { bsonType: 'string' },
        nome: { bsonType: 'string' },
        email: { bsonType: 'string' },
        telefone: { bsonType: 'string' },
        endereco: { bsonType: 'object' },
        pedidosTotais: { bsonType: 'int' },
        gastosTotal: { bsonType: 'decimal' },
        dataCriacao: { bsonType: 'string' },
        dataAtualizacao: { bsonType: 'string' },
      },
    },
  },
});

db.createCollection('produtos', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['produtoId', 'sku', 'nome', 'preco'],
      properties: {
        _id: { bsonType: 'objectId' },
        produtoId: { bsonType: 'string' },
        sku: { bsonType: 'string' },
        nome: { bsonType: 'string' },
        descricao: { bsonType: 'string' },
        preco: { bsonType: 'decimal' },
        estoque: { bsonType: 'int' },
        vendidosTotal: { bsonType: 'int' },
        dataCriacao: { bsonType: 'string' },
        dataAtualizacao: { bsonType: 'string' },
      },
    },
  },
});

db.createCollection('audit_log', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['eventId', 'eventType', 'entityType', 'timestamp'],
      properties: {
        _id: { bsonType: 'objectId' },
        eventId: { bsonType: 'string' },
        eventType: { bsonType: 'string' },
        entityType: { bsonType: 'string' },
        entityId: { bsonType: 'string' },
        source: { bsonType: 'string' },
        correlationId: { bsonType: 'string' },
        userId: { bsonType: 'string' },
        data: { bsonType: 'object' },
        timestamp: { bsonType: 'string' },
      },
    },
  },
});

// Create indexes
db.pedidos.createIndex({ pedidoId: 1 }, { unique: true });
db.pedidos.createIndex({ clienteId: 1 });
db.pedidos.createIndex({ status: 1 });
db.pedidos.createIndex({ dataCriacao: -1 });

db.clientes.createIndex({ clienteId: 1 }, { unique: true });
db.clientes.createIndex({ email: 1 }, { unique: true });

db.produtos.createIndex({ produtoId: 1 }, { unique: true });
db.produtos.createIndex({ sku: 1 }, { unique: true });

db.audit_log.createIndex({ eventId: 1 }, { unique: true });
db.audit_log.createIndex({ correlationId: 1 });
db.audit_log.createIndex({ timestamp: -1 });

print('✓ MongoDB inicializado com sucesso!');
