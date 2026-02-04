import { DomainCommand } from '../types/domain-command.js';

/**
 * Criar Pedido Command Data
 */
export interface CriarPedidoCommandData {
  clienteId: string;
  itens: Array<{
    produtoId: string;
    quantidade: number;
  }>;
}

/**
 * Criar Pedido Command
 */
export interface CriarPedidoCommand extends DomainCommand<CriarPedidoCommandData> {
  type: 'CriarPedidoCommand';
  entity: 'Pedido';
}

export function criarCriarPedidoCommand(data: CriarPedidoCommandData, correlationId: string, source: string): CriarPedidoCommand {
  return {
    id: crypto.randomUUID(),
    type: 'CriarPedidoCommand',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      correlationId,
      source,
      version: 1,
    },
  };
}

/**
 * Atualizar Pedido Command Data
 */
export interface AtualizarPedidoCommandData {
  pedidoId: string;
  itens?: Array<{
    produtoId: string;
    quantidade: number;
  }>;
  status?: string;
}

/**
 * Atualizar Pedido Command
 */
export interface AtualizarPedidoCommand extends DomainCommand<AtualizarPedidoCommandData> {
  type: 'AtualizarPedidoCommand';
  entity: 'Pedido';
}

export function criarAtualizarPedidoCommand(data: AtualizarPedidoCommandData, correlationId: string, source: string): AtualizarPedidoCommand {
  return {
    id: crypto.randomUUID(),
    type: 'AtualizarPedidoCommand',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      correlationId,
      source,
      version: 1,
    },
  };
}

/**
 * Cancelar Pedido Command Data
 */
export interface CancelarPedidoCommandData {
  pedidoId: string;
}

/**
 * Cancelar Pedido Command
 */
export interface CancelarPedidoCommand extends DomainCommand<CancelarPedidoCommandData> {
  type: 'CancelarPedidoCommand';
  entity: 'Pedido';
}

export function criarCancelarPedidoCommand(data: CancelarPedidoCommandData, correlationId: string, source: string): CancelarPedidoCommand {
  return {
    id: crypto.randomUUID(),
    type: 'CancelarPedidoCommand',
    entity: 'Pedido',
    timestamp: new Date().toISOString(),
    data,
    metadata: {
      correlationId,
      source,
      version: 1,
    },
  };
}
