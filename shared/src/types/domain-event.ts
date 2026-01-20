/**
 * Domain Event Interface
 * Padrão padrão para todos os eventos no sistema
 */
export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  entity: string;
  timestamp: string;
  data: T;
  metadata: {
    source: string;
    correlationId: string;
    userId?: string;
    tenantId?: string;
    version: number;
  };
}

/**
 * Event Publisher Interface
 */
export interface IEventPublisher {
  publish<T>(event: DomainEvent<T>): Promise<void>;
  publishBatch<T>(events: DomainEvent<T>[]): Promise<void>;
}

/**
 * Event Handler Interface
 */
export interface IEventHandler<T = Record<string, unknown>> {
  handle(event: DomainEvent<T>): Promise<void>;
  eventType(): string;
  entityType(): string;
}

/**
 * Event Bus Interface
 */
export interface IEventBus extends IEventPublisher {
  subscribe<T>(
    handler: IEventHandler<T>,
    eventType: string
  ): Promise<void>;
  unsubscribe(handler: IEventHandler, eventType: string): Promise<void>;
}
