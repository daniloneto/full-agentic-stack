import { DomainEvent } from '../types/domain-event';
import { v4 as uuidv4 } from 'uuid';

// === CLIENTE EVENTS ===

export interface ClienteCriadoData {
  clienteId: string;
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
}

export function criarClienteCriadoEvent(
  data: ClienteCriadoData,
  correlationId: string,
  source: string
): DomainEvent<ClienteCriadoData> {
  return {
    id: uuidv4(),
    type: 'ClienteCriado',
    entity: 'Cliente',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

// === PRODUTO EVENTS ===

export interface ProdutoCriadoData {
  produtoId: string;
  nome: string;
  descricao: string;
  preco: number;
  estoque: number;
  sku: string;
}

export function criarProdutoCriadoEvent(
  data: ProdutoCriadoData,
  correlationId: string,
  source: string
): DomainEvent<ProdutoCriadoData> {
  return {
    id: uuidv4(),
    type: 'ProdutoCriado',
    entity: 'Produto',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

// === PEDIDO EVENTS ===

export interface PedidoCriadoData {
  pedidoId: string;
  clienteId: string;
  itens: Array<{
    produtoId: string;
    quantidade: number;
    precoUnitario: number;
  }>;
  total: number;
  status: 'PENDENTE';
  dataCriacao: string;
}

export function criarPedidoCriadoEvent(
  data: PedidoCriadoData,
  correlationId: string,
  source: string
): DomainEvent<PedidoCriadoData> {
  return {
    id: uuidv4(),
    type: 'PedidoCriado',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

export interface PedidoAtualizadoData {
  pedidoId: string;
  status: string;
  motivo?: string;
}

export function criarPedidoAtualizadoEvent(
  data: PedidoAtualizadoData,
  correlationId: string,
  source: string
): DomainEvent<PedidoAtualizadoData> {
  return {
    id: uuidv4(),
    type: 'PedidoAtualizado',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

export interface PedidoCanceladoData {
  pedidoId: string;
  motivo: string;
  dataCancelamento: string;
}

export function criarPedidoCanceladoEvent(
  data: PedidoCanceladoData,
  correlationId: string,
  source: string
): DomainEvent<PedidoCanceladoData> {
  return {
    id: uuidv4(),
    type: 'PedidoCancelado',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

// === INDEXING EVENTS ===

export interface PedidoIndexarData {
  pedidoId: string;
  clienteId: string;
  status: string;
  total: number;
  dataCriacao: string;
}

export function criarPedidoIndexarEvent(
  data: PedidoIndexarData,
  correlationId: string,
  source: string
): DomainEvent<PedidoIndexarData> {
  return {
    id: uuidv4(),
    type: 'PedidoIndexar',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

// === CACHE EVENTS ===

export interface CacheInvalidarData {
  chaves: string[];
  motivo: string;
}

export function criarCacheInvalidarEvent(
  data: CacheInvalidarData,
  correlationId: string,
  source: string
): DomainEvent<CacheInvalidarData> {
  return {
    id: uuidv4(),
    type: 'CacheInvalidar',
    entity: 'Cache',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}

// === AUDIT EVENTS ===

export interface AuditarData {
  entidade: string;
  entidadeId: string;
  acao: string;
  usuarios?: string;
  dadosAntigos?: Record<string, unknown>;
  dadosNovos?: Record<string, unknown>;
  timestamp: string;
}

export function criarAuditarEvent(
  data: AuditarData,
  correlationId: string,
  source: string
): DomainEvent<AuditarData> {
  return {
    id: uuidv4(),
    type: 'Auditar',
    entity: 'Auditoria',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      source,
      correlationId,
      version: 1,
    },
  };
}
