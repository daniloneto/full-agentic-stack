// Export types and interfaces from shared
export { DomainCommand, ICommandBus, ICommandPublisher, ICommandHandler } from '@agentic/shared';

// Export implementation
export { RabbitMQCommandBus } from './rabbitmq-command-bus.js';
