#!/bin/bash
# ETAPA 1 - Setup Quick Start
# Execute este script para preparar o projeto

set -e

echo "🚀 Full Agentic Stack - ETAPA 1 Setup"
echo "═════════════════════════════════════"
echo ""

# 1. Copy .env
echo "📋 Criando .env..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo "✓ .env criado"
else
    echo "✓ .env já existe"
fi

echo ""
echo "📦 Instalando dependências..."
echo "   (Isso pode levar alguns minutos)"
npm run install:all

echo ""
echo "🐳 Levantando Docker Compose..."
npm run docker:up

echo ""
echo "⏳ Aguardando serviços iniciarem (30 segundos)..."
sleep 30

echo ""
echo "✅ ETAPA 1 Setup Completo!"
echo ""
echo "═════════════════════════════════════"
echo "🎯 Próximos Passos:"
echo ""
echo "1️⃣  Verificar logs dos serviços:"
echo "   npm run docker:logs"
echo ""
echo "2️⃣  Acessar RabbitMQ Management:"
echo "   http://localhost:15672"
echo "   Usuário: admin"
echo "   Senha: admin123"
echo ""
echo "3️⃣  Acessar MinIO Console:"
echo "   http://localhost:9001"
echo "   Usuário: minioadmin"
echo "   Senha: minioadmin123"
echo ""
echo "4️⃣  Começar ETAPA 2 (Event Bus):"
echo "   Implemente: event-bus/src/rabbitmq-event-bus.ts"
echo ""
echo "═════════════════════════════════════"
