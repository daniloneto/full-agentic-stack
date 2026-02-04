/**
 * Domain Command Interface
 * Padrão para todos os comandos no sistema
 */
export interface DomainCommand<T = Record<string, unknown>> {
  id: string;
  type: string;
  entity: string;
  timestamp: string;
  data: T;
  metadata: {
    correlationId: string;
    source: string;
    userId?: string;
    tenantId?: string;
    version: number;
  };
}

/**
 * Command Publisher Interface
 */
export interface ICommandPublisher {
  publish<T>(command: DomainCommand<T>): Promise<void>;
  publishBatch<T>(commands: DomainCommand<T>[]): Promise<void>;
}

/**
 * Command Handler Interface
 */
export interface ICommandHandler<T = Record<string, unknown>> {
  handle(command: DomainCommand<T>): Promise<void>;
  commandType(): string;
  entityType(): string;
}

/**
 * Command Bus Interface
 */
export interface ICommandBus extends ICommandPublisher {
  subscribe<T>(
    handler: ICommandHandler<T>,
    commandType: string
  ): Promise<void>;
  unsubscribe(handler: ICommandHandler, commandType: string): Promise<void>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
