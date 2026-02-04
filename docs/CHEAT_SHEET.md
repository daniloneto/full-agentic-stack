# ⚡ CHEAT SHEET - Comandos Rápidos

## 🚀 Iniciar Projeto

```powershell
# 1. Navegar para projeto
cd c:\Projetos\agentic\full-agentic-stack

# 2. Instalar dependências
npm run install:all

# 3. Levantar Docker
npm run docker:up

# 4. Verificar saúde
npm run docker:logs
```

## 🧪 Testar

```powershell
# Teste rápido (recomendado)
.\quick-test.ps1

# Teste completo do sistema
.\full-system-test.ps1

# Teste manual - Health check
Invoke-RestMethod -Uri "http://localhost:3000/health" | ConvertTo-Json

# Teste manual - Criar Cliente
$body = @{
    nome = "João"
    email = "joao@test.com"
    telefone = "(11) 99999"
    endereco = @{rua="A"; numero="1"; cidade="SP"; estado="SP"; cep="01234-567"}
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/clientes" `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json

# Teste manual - Criar Produto
$body = @{
    nome = "Laptop"
    descricao = "Teste"
    preco = 3500
    estoque = 10
    sku = "LAPTOP-001"
} | ConvertTo-Json

Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/produtos" `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json

# Teste manual - Criar Pedido (usar IDs acima)
$body = @{
    clienteId = "UUID-AQUI"
    itens = @(@{produtoId = "UUID-AQUI"; quantidade = 2; precoUnitario = 3500})
} | ConvertTo-Json -Depth 3

Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/pedidos" `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json

# Teste de busca (OpenSearch)
$body = @{ query = "laptop" } | ConvertTo-Json
Invoke-RestMethod -Method POST -Uri "http://localhost:3000/api/search/produtos" `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json
```

## 📊 Acessar Interfaces

```
RabbitMQ Management UI
  URL: http://localhost:15672
  User: admin
  Pass: admin123

MinIO Console
  URL: http://localhost:9001
  User: minioadmin
  Pass: minioadmin123

OpenSearch (via curl/Invoke-RestMethod)
  Invoke-RestMethod -Uri "https://localhost:9200" -SkipCertificateCheck `
    -Credential (New-Object PSCredential("admin", (ConvertTo-SecureString "admin" -AsPlainText -Force)))
```

## 🔍 Verificar Logs

```powershell
# Todos os logs em tempo real
npm run docker:logs

# Logs de um serviço específico
docker logs agentic-api-gateway -f
docker logs agentic-rabbitmq -f
docker logs agentic-postgres -f
docker logs agentic-cdc -f
docker logs agentic-redis -f
docker logs agentic-mongo -f
docker logs agentic-opensearch -f

# Logs dos Agentes
docker logs agentic-pedido-agent -f
docker logs agentic-cliente-agent -f
docker logs agentic-produto-agent -f
docker logs agentic-search-agent -f
docker logs agentic-cache-agent -f
docker logs agentic-audit-agent -f

# Últimas 50 linhas
docker logs agentic-api-gateway --tail 50

# Buscar erro específico
docker logs agentic-api-gateway 2>&1 | Select-String "error" -CaseSensitive:$false
```

## 🗄️ PostgreSQL

```powershell
# Conectar ao banco
docker exec -it agentic-postgres psql -U postgres -d agentic

# Dentro do psql:
# Ver tabelas
\dt domain.*
\dt audit.*

# Ver dados
SELECT * FROM domain.clientes LIMIT 5;
SELECT * FROM domain.produtos LIMIT 5;
SELECT * FROM domain.pedidos LIMIT 5;
SELECT * FROM audit.event_log LIMIT 10;

# Ver posição CDC
SELECT * FROM audit.cdc_position;

# Ver estatísticas
SELECT COUNT(*) as total_events FROM audit.event_log;
SELECT COUNT(*) as total_clientes FROM domain.clientes;

# Sair
\q
```

## 🐰 MongoDB

```powershell
# Conectar ao MongoDB
docker exec -it agentic-mongo mongosh -u admin -p admin123

# Dentro do mongosh:
# Ver collections
db.getCollectionNames()

# Ver dados (quando agentes criarem)
db.pedidos.find().limit(5)
db.clientes.find().limit(5)
db.audit_log.find().limit(5)

# Sair
exit
```

## 📨 RabbitMQ

```powershell
# Verificar status
docker exec agentic-rabbitmq rabbitmq-diagnostics -q ping

# Via Management UI
# 1. Acessar http://localhost:15672
# 2. Login: admin/admin123
# 3. Menu "Exchanges" → agentic.events
# 4. Menu "Queues" → ver filas
# 5. Clicar em fila → "Get Messages" para ver conteúdo
```

## 📦 NPM Workspaces

```powershell
# Instalar dependencies para workspace específico
npm install --workspace=shared
npm install --workspace=event-bus
npm install --workspace=api-gateway

# Build um workspace
npm run build --workspace=shared
npm run build --workspace=event-bus

# Build todos
npm run build --workspaces

# Ver dependências
npm ls @agentic/shared

# Limpar cache
npm cache clean --force
rm -r node_modules
npm install
```

## 🐳 Docker

```powershell
# Status dos containers
docker ps
docker ps -a

# Logs em tempo real
docker logs [container-id] -f

# Logs com timestamp
docker logs [container-id] --timestamps

# Entrar no container
docker exec -it [container-id] /bin/sh
docker exec -it [container-id] bash

# Reiniciar um serviço
docker restart agentic-api-gateway

# Parar tudo
npm run docker:down

# Parar e remover volumes
docker-compose down -v

# Verificar saúde
docker inspect agentic-rabbitmq | grep -A 5 Health

# Logs detalhados
docker inspect [container-id]

# Network analysis
docker network ls
docker network inspect agentic-network
```

## 🛠️ Troubleshooting

```powershell
# "Port already in use"
netstat -ano | findstr :3000
netstat -ano | findstr :5672
netstat -ano | findstr :5432

# Matar processo por PID
taskkill /PID [PID] /F

# Limpar Docker completamente
docker system prune -a -f
docker volume prune -f

# Rebuild images
docker-compose build --no-cache

# Verificar disk usage
docker system df

# Network issues
docker exec agentic-rabbitmq ping postgres
docker exec agentic-api-gateway curl -I http://rabbitmq:5672

# CPU/Memory usage
docker stats
```

## 📝 Arquivo .env

```powershell
# Criar .env a partir do exemplo
cp .env.example .env

# Editar variáveis
$env:NODE_ENV = "development"
$env:PORT = "3000"
$env:LOG_LEVEL = "info"
```

## 🔄 Workflow Desenvolvimento

```powershell
# 1. Modificar código
# 2. Salvar arquivo (Docker volume mapeia automaticamente)
# 3. Ver logs
docker logs agentic-api-gateway -f

# 4. Se precisar rebuild
docker-compose build api-gateway
docker-compose up -d api-gateway

# 5. Testar novamente
node test-etapa2.js
```

## 📚 Documentação

| Arquivo | Para quê? |
|---------|-----------|
| README.md | Visão geral do projeto |
| docs/CHEAT_SHEET.md | Comandos rápidos (este arquivo) |
| docs/ARQUITETURA_VISUAL.md | Diagramas e topologia |
| ETAPA4.md | Documentação da ETAPA 4 |
| RESUMO_FINAL.md | Status e roadmap |

## 🎯 Quick Links

- **API Gateway**: http://localhost:3000
- **Health Check**: http://localhost:3000/health
- **RabbitMQ UI**: http://localhost:15672
- **PostgreSQL**: postgresql://postgres:postgres123@localhost:5432/agentic
- **Redis**: redis://localhost:6379
- **MongoDB**: mongodb://admin:admin123@localhost:27017/agentic
- **OpenSearch**: https://localhost:9200 (user: admin, pass: admin)
- **MinIO Console**: http://localhost:9001

## 🆘 SOS - Algo não funciona?

1. **Verificar saúde:**
   ```powershell
   curl http://localhost:3000/health
   ```

2. **Ver logs:**
   ```powershell
   npm run docker:logs
   ```

3. **Reiniciar tudo:**
   ```powershell
   npm run docker:down
   npm run docker:up
   ```

4. **Resetar completamente:**
   ```powershell
   docker system prune -a
   npm run install:all
   npm run docker:up
   ```

5. **Consultar docs:**
   - docs/CHEAT_SHEET.md (este arquivo)
   - docs/ARQUITETURA_VISUAL.md (diagramas)

## 📞 Debug Avançado

```powershell
# Validar JSON da requisição
$body = @{...} | ConvertTo-Json
Write-Host $body

# Check network connectivity
docker exec agentic-api-gateway curl -v http://rabbitmq:5672

# PostgreSQL logs
docker logs agentic-postgres -f --tail 100

# Monitor connections
docker exec agentic-postgres psql -U postgres -c "SELECT * FROM pg_stat_activity;"

# Kill hanging connections
docker exec agentic-postgres psql -U postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'agentic';"
```

## 🎬 Scenario: Do Zero ao Testado

```powershell
# 1. Clone/navigate
cd c:\Projetos\agentic\full-agentic-stack

# 2. Setup
npm run install:all                    # ~3 minutos
npm run docker:up                      # ~1 minuto

# 3. Wait & Check
Start-Sleep -Seconds 30
curl http://localhost:3000/health      # deve retornar 200

# 4. Test
.\quick-test.ps1                       # ~10 segundos

# 5. Se OK → You're done! 🎉
# Se erro → Consultar logs
npm run docker:logs
```

---

**Version**: 1.1
**Last Updated**: 2026-02-04
**Status**: Fully Operational (all 6 agents running)
