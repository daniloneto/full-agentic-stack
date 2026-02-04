// Export types
export { DomainEvent, IEventPublisher, IEventHandler, IEventBus } from './types/domain-event.js';
export { DomainCommand, ICommandPublisher, ICommandHandler, ICommandBus } from './types/domain-command.js';

// Export events
export {
  ClienteCriadoData,
  criarClienteCriadoEvent,
  ProdutoCriadoData,
  criarProdutoCriadoEvent,
  PedidoCriadoData,
  criarPedidoCriadoEvent,
  PedidoAtualizadoData,
  criarPedidoAtualizadoEvent,
  PedidoCanceladoData,
  criarPedidoCanceladoEvent,
  PedidoIndexarData,
  criarPedidoIndexarEvent,
  CacheInvalidarData,
  criarCacheInvalidarEvent,
  AuditarData,
  criarAuditarEvent,
} from './events/domain-events.js';
export {
  CriarPedidoCommandData,
  CriarPedidoCommand,
  criarCriarPedidoCommand,
  AtualizarPedidoCommandData,
  AtualizarPedidoCommand,
  criarAtualizarPedidoCommand,
  CancelarPedidoCommandData,
  CancelarPedidoCommand,
  criarCancelarPedidoCommand,
} from './events/domain-commands.js';

// Export infrastructure
export { default, default as Logger } from './infra/logger.js';
