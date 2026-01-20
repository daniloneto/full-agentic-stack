-- Create schemas
CREATE SCHEMA IF NOT EXISTS domain;
CREATE SCHEMA IF NOT EXISTS audit;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Clientes table
CREATE TABLE domain.clientes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  telefone VARCHAR(20),
  endereco JSONB NOT NULL,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_event_id UUID,
  CONSTRAINT email_valid CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

CREATE INDEX idx_clientes_email ON domain.clientes(email);
CREATE INDEX idx_clientes_ativo ON domain.clientes(ativo);

-- Produtos table
CREATE TABLE domain.produtos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku VARCHAR(100) UNIQUE NOT NULL,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  preco DECIMAL(10, 2) NOT NULL,
  estoque INTEGER NOT NULL DEFAULT 0,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_event_id UUID,
  CONSTRAINT preco_positivo CHECK (preco > 0),
  CONSTRAINT estoque_nao_negativo CHECK (estoque >= 0)
);

CREATE INDEX idx_produtos_sku ON domain.produtos(sku);
CREATE INDEX idx_produtos_ativo ON domain.produtos(ativo);

-- Pedidos table
CREATE TABLE domain.pedidos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cliente_id UUID NOT NULL REFERENCES domain.clientes(id) ON DELETE RESTRICT,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
  total DECIMAL(10, 2) NOT NULL,
  observacoes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_by_event_id UUID,
  CONSTRAINT total_positivo CHECK (total >= 0),
  CONSTRAINT status_valido CHECK (status IN ('PENDENTE', 'CONFIRMADO', 'PROCESSANDO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'))
);

CREATE INDEX idx_pedidos_cliente ON domain.pedidos(cliente_id);
CREATE INDEX idx_pedidos_status ON domain.pedidos(status);
CREATE INDEX idx_pedidos_created_at ON domain.pedidos(created_at DESC);

-- Itens do Pedido
CREATE TABLE domain.pedido_itens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID NOT NULL REFERENCES domain.pedidos(id) ON DELETE CASCADE,
  produto_id UUID NOT NULL REFERENCES domain.produtos(id) ON DELETE RESTRICT,
  quantidade INTEGER NOT NULL,
  preco_unitario DECIMAL(10, 2) NOT NULL,
  subtotal DECIMAL(10, 2) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT quantidade_positiva CHECK (quantidade > 0),
  CONSTRAINT preco_positivo CHECK (preco_unitario > 0)
);

CREATE INDEX idx_pedido_itens_pedido ON domain.pedido_itens(pedido_id);
CREATE INDEX idx_pedido_itens_produto ON domain.pedido_itens(produto_id);

-- Audit table
CREATE TABLE audit.event_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL,
  event_type VARCHAR(255) NOT NULL,
  entity_type VARCHAR(255) NOT NULL,
  entity_id UUID,
  source VARCHAR(255) NOT NULL,
  correlation_id UUID NOT NULL,
  data JSONB NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  processed_by TEXT
);

CREATE INDEX idx_event_log_event_id ON audit.event_log(event_id);
CREATE INDEX idx_event_log_correlation_id ON audit.event_log(correlation_id);
CREATE INDEX idx_event_log_entity ON audit.event_log(entity_type, entity_id);
CREATE INDEX idx_event_log_created_at ON audit.event_log(created_at DESC);

-- Change Data Capture tracking table
CREATE TABLE audit.cdc_position (
  id SERIAL PRIMARY KEY,
  table_name VARCHAR(255) NOT NULL UNIQUE,
  last_lsn TEXT,
  last_sync TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Triggers para atualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_clientes_updated_at
  BEFORE UPDATE ON domain.clientes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_produtos_updated_at
  BEFORE UPDATE ON domain.produtos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trigger_pedidos_updated_at
  BEFORE UPDATE ON domain.pedidos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Grant permissions
GRANT ALL PRIVILEGES ON SCHEMA domain TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA domain TO postgres;
GRANT ALL PRIVILEGES ON SCHEMA audit TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA audit TO postgres;
