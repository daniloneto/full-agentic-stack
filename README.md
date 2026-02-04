# 🤖 Full Agentic Stack

<p align="center">
  <strong>Arquitetura Event-Driven de Múltiplos Agentes com Persistência Poliglota</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-20+-green?logo=node.js" alt="Node.js"/>
  <img src="https://img.shields.io/badge/TypeScript-5.3-blue?logo=typescript" alt="TypeScript"/>
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker" alt="Docker"/>
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License"/>
</p>

---

## 📖 Sobre o Projeto

O **Full Agentic Stack** é um sistema de microsserviços orientado a eventos que implementa uma arquitetura de agentes autônomos. Cada agente é responsável por um domínio específico do negócio (clientes, produtos, pedidos, etc.) e se comunica exclusivamente através de um barramento de eventos (Event Bus).

Este projeto demonstra conceitos avançados de arquitetura de software como:

- 🎯 **Domain-Driven Design (DDD)**
- 📡 **Event-Driven Architecture (EDA)**
- 🔄 **CQRS (Command Query Responsibility Segregation)**
- 🗄️ **Persistência Poliglota**
- 🔍 **Change Data Capture (CDC)**

---

## 🏗️ Arquitetura

### Visão Geral

```
┌─────────────────────────────────────────────────────────────────┐
│                        Clientes HTTP                             │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway (Express)                        │
│                        Porta: 3000                               │
│  • REST API CRUD completo                                        │
│  • Validação de dados                                            │
│  • Correlation ID                                                │
│  • Integração com OpenSearch                                     │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RabbitMQ Event Bus                            │
│  • Exchange: agentic.events (fanout)                             │
│  • Dead Letter Queue para retry                                  │
│  • Mensagens persistentes                                        │
│  • Auto-reconnect com backoff exponencial                        │
└───┬─────────┬─────────┬─────────┬─────────┬─────────┬───────────┘
    │         │         │         │         │         │
    ▼         ▼         ▼         ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│Cliente│ │Produto│ │Pedido │ │ Audit │ │ Cache │ │Search │
│ Agent │ │ Agent │ │ Agent │ │ Agent │ │ Agent │ │ Agent │
└───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘ └───┬───┘
    │         │         │         │         │         │
    └─────────┴────┬────┴─────────┴────┬────┴────┬────┘
                   │                   │         │
                   ▼                   ▼         ▼
           ┌──────────────┐    ┌─────────┐ ┌──────────┐
           │  PostgreSQL  │    │ MongoDB │ │OpenSearch│
           │   (ACID)     │    │ (Audit) │ │ (Search) │
           └──────────────┘    └─────────┘ └──────────┘
                   ▲
                   │ CDC Polling (5s)
           ┌──────────────┐
           │     CDC      │
           │   Service    │
           └──────────────┘
```

### Princípios Fundamentais

| Princípio | Descrição |
|-----------|-----------|
| 📡 **100% Orientada a Eventos** | Todas as comunicações entre serviços via Event Bus |
| 🚫 **Sem Estado Síncrono** | Nenhuma consulta direta de estado entre agentes |
| 🎯 **Um Agente por Entidade** | Cada domínio tem seu próprio agente especializado |
| 💃 **Coreografia** | Fluxos emergem de reações a eventos (não orquestração) |
| 🗄️ **Persistência Poliglota** | Cada banco otimizado para seu caso de uso |
| 🔄 **CDC** | Sincronização automática de mudanças |

### Stack de Tecnologia

#### Infraestrutura
| Tecnologia | Versão | Propósito |
|------------|--------|-----------|
| Node.js | 20+ | Runtime JavaScript |
| TypeScript | 5.3 | Tipagem estática |
| Docker | Latest | Containerização |
| Docker Compose | 3.9 | Orquestração local |

#### Message Broker
| Tecnologia | Propósito |
|------------|-----------|
| RabbitMQ 3.13 | Event Bus com retry e DLQ |

#### Bancos de Dados
| Banco | Propósito | Porta |
|-------|-----------|:-----:|
| **PostgreSQL 16** | Fonte de verdade transacional (ACID) | 5432 |
| **Redis 7** | Cache e projeções rápidas | 6379 |
| **MongoDB 7** | Projeções documentais e auditoria | 27017 |
| **OpenSearch 2.11** | Buscas full-text e agregações | 9200 |
| **MinIO** | Storage de arquivos (S3-compatible) | 9000 |

---

## 📁 Estrutura do Projeto

```
full-agentic-stack/
│
├── 📂 agents/                    # Agentes de domínio
│   ├── 📂 cliente-agent/         # Gestão de clientes
│   ├── 📂 produto-agent/         # Gestão de produtos e inventário
│   ├── 📂 pedido-agent/          # Processamento de pedidos
│   ├── 📂 search-agent/          # Indexação no OpenSearch
│   ├── 📂 cache-agent/           # Caching no Redis
│   └── 📂 audit-agent/           # Logging no MongoDB
│
├── 📂 api-gateway/               # Ponto de entrada HTTP (REST)
│   └── 📂 src/
│       └── api-gateway.ts        # Servidor Express
│
├── 📂 event-bus/                 # Implementação do Event Bus
│   └── 📂 src/
│       └── rabbitmq-event-bus.ts # Cliente RabbitMQ
│
├── 📂 command-bus/               # Implementação do Command Bus
│   └── 📂 src/
│       └── rabbitmq-command-bus.ts
│
├── 📂 cdc/                       # Change Data Capture
│   ├── 📂 src/
│   │   └── cdc.ts                # Serviço de CDC
│   ├── init.sql                  # Schema PostgreSQL
│   └── mongo-init.js             # Schema MongoDB
│
├── 📂 shared/                    # Código compartilhado
│   ├── 📂 src/
│   │   ├── 📂 commands/          # Definições de comandos
│   │   ├── 📂 events/            # Definições de eventos
│   │   ├── 📂 types/             # Interfaces e tipos
│   │   └── 📂 infra/             # Logger e utilitários
│   └── index.ts
│
├── 📄 docker-compose.yml         # Stack de infraestrutura
├── 📄 package.json               # Configuração de workspaces
├── 📄 tsconfig.json              # Configuração TypeScript
└── 📄 README.md                  # Este arquivo
```

---

## 🚀 Início Rápido

### Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- ✅ **Node.js** 20 ou superior
- ✅ **Docker** e **Docker Compose**
- ✅ **npm** 8+ ou **yarn**
- ✅ **Git**

### Instalação

#### 1. Clone o repositório

```bash
git clone <url-do-repositorio>
cd full-agentic-stack
```

#### 2. Instale as dependências

```bash
npm run install:all
```

#### 3. Inicie a infraestrutura (Docker)

```bash
npm run docker:up
```

Aguarde todos os containers ficarem saudáveis (pode levar 1-2 minutos):

```bash
npm run docker:logs
```

#### 4. Inicie os serviços em modo desenvolvimento

```bash
npm run dev
```

### Verificação

Após a inicialização, verifique se tudo está funcionando:

```bash
# Health check do API Gateway
curl http://localhost:3000/health

# Deve retornar:
# {"status":"healthy","services":{"postgres":"connected","rabbitmq":"connected"}}
```

### Parar a Stack

```bash
npm run docker:down
```

---

## 📚 API REST

### Endpoints Disponíveis

#### Clientes

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/clientes` | Criar novo cliente |
| `GET` | `/api/clientes` | Listar clientes (paginado) |
| `GET` | `/api/clientes/:id` | Obter cliente por ID |
| `PUT` | `/api/clientes/:id` | Atualizar cliente |
| `DELETE` | `/api/clientes/:id` | Deletar cliente (soft-delete) |

#### Produtos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/produtos` | Criar novo produto |
| `GET` | `/api/produtos` | Listar produtos (paginado) |
| `GET` | `/api/produtos/:id` | Obter produto por ID |
| `PUT` | `/api/produtos/:id` | Atualizar produto |
| `DELETE` | `/api/produtos/:id` | Deletar produto (soft-delete) |

#### Pedidos

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/pedidos` | Criar novo pedido |
| `GET` | `/api/pedidos` | Listar pedidos (paginado) |
| `GET` | `/api/pedidos/:id` | Obter pedido com itens |
| `PUT` | `/api/pedidos/:id` | Atualizar status do pedido |
| `DELETE` | `/api/pedidos/:id` | Cancelar pedido |

#### Busca (OpenSearch)

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| `POST` | `/api/search/produtos` | Busca full-text em produtos |
| `POST` | `/api/search/clientes` | Busca full-text em clientes |
| `POST` | `/api/search/pedidos` | Busca full-text em pedidos |

### Exemplos de Uso

#### Criar Cliente

```bash
curl -X POST http://localhost:3000/api/clientes \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "João Silva",
    "email": "joao@example.com",
    "telefone": "(11) 99999-9999",
    "endereco": {
      "rua": "Rua das Flores",
      "numero": "123",
      "bairro": "Centro",
      "cidade": "São Paulo",
      "estado": "SP",
      "cep": "01310-100"
    }
  }'
```

#### Criar Produto

```bash
curl -X POST http://localhost:3000/api/produtos \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Notebook Gamer",
    "descricao": "Notebook de alta performance para jogos",
    "preco": 5499.99,
    "estoque": 15,
    "sku": "NOTE-GAMER-001"
  }'
```

#### Criar Pedido

```bash
curl -X POST http://localhost:3000/api/pedidos \
  -H "Content-Type: application/json" \
  -d '{
    "clienteId": "uuid-do-cliente",
    "itens": [
      {
        "produtoId": "uuid-do-produto",
        "quantidade": 1,
        "precoUnitario": 5499.99
      }
    ],
    "observacoes": "Entregar no período da tarde"
  }'
```

#### Listar com Paginação e Filtros

```bash
# Listar clientes - página 1, 10 por página
curl "http://localhost:3000/api/clientes?page=1&limit=10"

# Filtrar produtos por nome
curl "http://localhost:3000/api/produtos?search=notebook"

# Filtrar pedidos por status
curl "http://localhost:3000/api/pedidos?status=PROCESSANDO"
```

---

## 🔄 Fluxo de Eventos

### Exemplo: Criação de Pedido

```
┌──────────────────────────────────────────────────────────────┐
│                    POST /api/pedidos                          │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     API Gateway                               │
│  1. Valida dados                                              │
│  2. Persiste no PostgreSQL                                    │
│  3. Publica evento "PedidoCriado"                             │
└───────────────────────────┬──────────────────────────────────┘
                            │
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                    RabbitMQ Event Bus                         │
│              Exchange: agentic.events (fanout)                │
└──┬──────────┬──────────┬──────────┬──────────────────────────┘
   │          │          │          │
   ▼          ▼          ▼          ▼
┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐
│Pedido│  │Search│  │Cache │  │Audit │
│Agent │  │Agent │  │Agent │  │Agent │
└──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘
   │         │         │         │
   │         ▼         ▼         ▼
   │    OpenSearch   Redis    MongoDB
   │    (indexa)   (invalida) (registra)
   │
   ▼
PostgreSQL (processa e atualiza status)
```

### Padrão de Eventos

Todos os eventos seguem este contrato:

```typescript
interface DomainEvent<T> {
  id: string;                    // UUID único
  type: string;                  // "PedidoCriado", "ClienteAtualizado", etc
  entity: string;                // "Pedido", "Cliente", "Produto"
  timestamp: string;             // ISO 8601
  data: T;                       // Payload específico do evento
  metadata: {
    source: string;              // Serviço que publicou
    correlationId: string;       // Rastreamento de fluxos
    userId?: string;             // Usuário que causou a ação
    version: number;             // Versionamento de schema
  };
}
```

---

## 🗄️ Estratégia de Dados (Persistência Poliglota)

### PostgreSQL - Fonte de Verdade

**Propósito**: Transações ACID, integridade referencial

```sql
-- Exemplo de schema
CREATE TABLE domain.pedidos (
  id UUID PRIMARY KEY,
  cliente_id UUID NOT NULL REFERENCES domain.clientes(id),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDENTE',
  total DECIMAL(10,2) NOT NULL,
  observacoes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  ativo BOOLEAN DEFAULT TRUE
);
```

### Redis - Cache

**Propósito**: Projeções rápidas, invalidação via eventos

```
# Estrutura de chaves
pedido:{id}              → JSON do pedido
cliente:{id}:pedidos     → Lista de IDs de pedidos
produto:{id}:estoque     → Quantidade em estoque
```

### MongoDB - Auditoria e Projeções

**Propósito**: Histórico de eventos, visões desnormalizadas

```javascript
// Exemplo de documento de auditoria
{
  _id: ObjectId,
  timestamp: ISODate(),
  eventType: "PedidoCriado",
  entityType: "Pedido",
  entityId: "uuid",
  data: { /* payload completo */ },
  metadata: {
    source: "api-gateway",
    correlationId: "uuid"
  }
}
```

### OpenSearch - Busca Full-Text

**Propósito**: Busca avançada, agregações, analytics

```json
{
  "index": "pedidos",
  "body": {
    "query": {
      "multi_match": {
        "query": "notebook",
        "fields": ["itens.nome", "cliente.nome"]
      }
    }
  }
}
```

---

## 🔧 Configuração

### Portas dos Serviços

| Serviço | Porta | UI/Management |
|---------|:-----:|:-------------:|
| API Gateway | 3000 | - |
| RabbitMQ | 5672 | 15672 |
| PostgreSQL | 5432 | - |
| Redis | 6379 | - |
| MongoDB | 27017 | - |
| OpenSearch | 9200 | 5601 (Dashboard) |
| MinIO | 9000 | 9001 |

### Credenciais de Desenvolvimento

| Serviço | Usuário | Senha |
|---------|---------|-------|
| RabbitMQ | `admin` | `admin123` |
| PostgreSQL | `postgres` | `postgres123` |
| MongoDB | `admin` | `admin123` |
| OpenSearch | `admin` | `admin` |
| MinIO | `minioadmin` | `minioadmin123` |

---

## 📋 Scripts Disponíveis

```bash
# Instalar todas as dependências
npm run install:all

# Iniciar infraestrutura Docker
npm run docker:up

# Parar infraestrutura Docker
npm run docker:down

# Ver logs dos containers
npm run docker:logs

# Iniciar em modo desenvolvimento
npm run dev

# Build de todos os workspaces
npm run build

# Verificar tipos TypeScript
npm run type-check

# Executar linter
npm run lint
```

---

## 🧪 Testes

### Teste Rápido

```powershell
# PowerShell - Windows
.\quick-test.ps1

# Ou teste completo
.\full-system-test.ps1
```

### Teste Manual com cURL

```bash
# 1. Criar cliente
curl -X POST http://localhost:3000/api/clientes \
  -H "Content-Type: application/json" \
  -d '{"nome":"Teste","email":"teste@test.com"}'

# 2. Verificar cliente criado
curl http://localhost:3000/api/clientes

# 3. Health check
curl http://localhost:3000/health
```

---

## 📖 Documentação Adicional

| Documento | Descrição |
|-----------|-----------|
| [ARQUITETURA_VISUAL.md](./docs/ARQUITETURA_VISUAL.md) | Diagramas da arquitetura |
| [CHEAT_SHEET.md](./docs/CHEAT_SHEET.md) | Referência rápida |

---

## 🤝 Contribuindo

1. Faça um Fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/MinhaFeature`)
3. Commit suas mudanças (`git commit -m 'Adiciona MinhaFeature'`)
4. Push para a branch (`git push origin feature/MinhaFeature`)
5. Abra um Pull Request

---

## 📝 Licença

Este projeto está sob a licença MIT. Veja o arquivo [LICENSE](./LICENSE) para mais detalhes.

---

## 👥 Autores

Desenvolvido com ❤️ como demonstração de arquitetura event-driven com múltiplos agentes.

---

<p align="center">
  <strong>Full Agentic Stack</strong> - Arquitetura Event-Driven de Múltiplos Agentes
</p>
