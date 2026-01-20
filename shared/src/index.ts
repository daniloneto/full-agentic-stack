// Export types
export { DomainEvent, IEventPublisher, IEventHandler, IEventBus } from './types/domain-event.js';

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

// Export infrastructure
export { default, default as Logger } from './infra/logger.js';
