<#
.SYNOPSIS
  Teste completo do Full Agentic Stack (API + Infra)
.DESCRIPTION
  Realiza checagens de saúde, cria recursos (produto, cliente, pedido), verifica
  processamento assincrono, atualiza status e limpa os recursos criados.

USO
  .\full-system-test.ps1 [-ApiBaseUrl <url>] [-RabbitMgmtUrl <url>] [-SkipCleanup] [-WaitForProcessingSeconds <n>]
#>

param(
  [string]$ApiBaseUrl = $env:API_BASE_URL,
  [string]$RabbitMgmtUrl = $env:RABBITMQ_MGMT_URL,
  [string]$RabbitUser = $env:RABBITMQ_USER,
  [string]$RabbitPass = $env:RABBITMQ_PASS,
  [switch]$SkipCleanup,
  [int]$WaitForProcessingSeconds = 10
)

# Ensure sensible defaults when environment variables are not set (avoid using -or in param defaults)
if (-not $ApiBaseUrl -or $ApiBaseUrl -eq '') { $ApiBaseUrl = 'http://localhost:3000/api' }
if (-not $RabbitMgmtUrl -or $RabbitMgmtUrl -eq '') { $RabbitMgmtUrl = 'http://localhost:15672' }
if (-not $RabbitUser -or $RabbitUser -eq '') { $RabbitUser = 'admin' }
if (-not $RabbitPass -or $RabbitPass -eq '') { $RabbitPass = 'admin123' }

function LogInfo([string]$m) { Write-Host $m -ForegroundColor Cyan }
function LogOk([string]$m)   { Write-Host $m -ForegroundColor Green }
function LogWarn([string]$m) { Write-Host $m -ForegroundColor Yellow }
function LogErr([string]$m)  { Write-Host $m -ForegroundColor Red }

# Log effective configuration
function ShowConfig {
  LogInfo "Using ApiBaseUrl: $ApiBaseUrl"
  LogInfo "Using RabbitMgmtUrl: $RabbitMgmtUrl"
  LogInfo "Using RabbitMQ credentials: $RabbitUser/(******)"
}

ShowConfig

function DoRequest([string]$method, [string]$uri, $body=$null, $headers=$null) {
  try {
    if ($null -ne $body) {
      $res = Invoke-RestMethod -Method $method -Uri $uri -Body $body -ContentType "application/json" -Headers $headers -ErrorAction Stop
    } else {
      $res = Invoke-RestMethod -Method $method -Uri $uri -Headers $headers -ErrorAction Stop
    }
    return @{ success = $true; result = $res }
  } catch {
    return @{ success = $false; error = $_.Exception.Message; full = $_.Exception }
  }
}

# Helper to wait for an API condition with timeout (useful for eventual consistency)
function WaitForApi([string]$method, [string]$url, [scriptblock]$predicate, [int]$timeoutSeconds = $WaitForProcessingSeconds, [int]$intervalSeconds = 1, $body=$null, $headers=$null) {
  $deadline = (Get-Date).AddSeconds([int]$timeoutSeconds)
  $lastResp = $null
  while ((Get-Date) -lt $deadline) {
    $resp = DoRequest $method $url $body $headers
    $lastResp = $resp
    if ($resp.success) {
      try {
        if (& $predicate $resp.result) { return @{ success = $true; result = $resp.result } }
      } catch {
        # predicate threw; ignore and retry
      }
    }
    Start-Sleep -Seconds $intervalSeconds
  }
  return @{ success = $false; last = $lastResp }
}

function Get-Id($obj, [string[]]$candidates) {
  if (-not $obj) { return $null }
  foreach ($c in $candidates) {
    if ($obj.PSObject.Properties.Name -contains $c -and $obj.$c) { return $obj.$c }
  }
  if ($obj.PSObject.Properties.Name -contains 'data' -and $obj.data) {
    foreach ($c in $candidates) {
      if ($obj.data.PSObject.Properties.Name -contains $c -and $obj.data.$c) { return $obj.data.$c }
    }
  }
  return $null
}

function Get-ListItems($obj) {
  if (-not $obj) { return @() }
  if ($obj.PSObject.Properties.Name -contains 'data' -and $obj.data) { return $obj.data }
  return $obj
}

$results = @()
$created = @{}

# Normalize health url
$healthUrl = $ApiBaseUrl -replace '/api/?$','/health'

LogInfo "\n== Health Check =="
$h = DoRequest 'GET' $healthUrl
if ($h.success) {
  if ($h.result.status -eq 'ok') { LogOk "API Gateway health: OK"; $results += @{ test='health'; ok=$true; info=$h.result } }
  else { LogErr "API Gateway unhealthy: $($h.result | ConvertTo-Json -Depth 4)"; $results += @{ test='health'; ok=$false; info=$h.result } }
} else {
  LogErr "Health check failed: $($h.error)"; $results += @{ test='health'; ok=$false; error=$h.error }
}

# Docker containers
LogInfo "\n== Docker containers (filtered: agentic-) =="
try {
  $dockerOut = docker ps --format "{{.Names}}|{{.Status}}" 2>&1
  if ($LASTEXITCODE -eq 0) {
    $lines = $dockerOut.Trim() -split "`n" | Where-Object { $_ -match 'agentic-' }
    if ($lines.Length -eq 0) { LogWarn "Nenhum container agentic-* encontrado"; $results += @{ test='docker'; ok=$false; note='no_containers' } }
    else {
      foreach ($l in $lines) {
        $parts = $l -split '\|'
        LogInfo ("{0}: {1}" -f $parts[0], $parts[1])
      }
      $results += @{ test='docker'; ok=$true }
    }
  } else {
    LogErr "Docker command failed: $dockerOut"; $results += @{ test='docker'; ok=$false; error=$dockerOut }
  }
} catch {
  LogErr "Erro checando docker: $_"; $results += @{ test='docker'; ok=$false; error=$_.Exception.Message }
}

# RabbitMQ management
LogInfo "\n== RabbitMQ Management API =="
$basicAuth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$RabbitUser`:$RabbitPass"))
$headers = @{ Authorization = "Basic $basicAuth" }
$r = DoRequest 'GET' "$RabbitMgmtUrl/api/overview" $null $headers
if ($r.success) { LogOk "RabbitMQ management OK (version: $($r.result.rabbitmq_version))"; $results += @{ test='rabbitmq'; ok=$true; info=$r.result } }
else { LogErr "RabbitMQ management failed: $($r.error)"; $results += @{ test='rabbitmq'; ok=$false; error=$r.error } }

# Create produto
LogInfo "\n== Create produto =="
$ts = Get-Date -Format 'yyyyMMddHHmmss'
$sku = "TEST-SKU-$ts"
$produtoPayload = @{ sku=$sku; nome="Produto Teste $ts"; descricao='Criado pelo teste automatizado'; preco=123.45; estoque=10 } | ConvertTo-Json -Depth 6
$pr = DoRequest 'POST' "$ApiBaseUrl/produtos" $produtoPayload
if ($pr.success) {
  $prodId = Get-Id $pr.result @('produtoId','id')
  if ($prodId) {
    LogOk "Produto criado: $prodId"; $created.productId = $prodId; $results += @{ test='create_produto'; ok=$true; id=$prodId }

    # Wait for product to appear by ID (longer timeout for CDC propagation)
    $wp = WaitForApi 'GET' "$ApiBaseUrl/produtos/$prodId" { param($r) return $true } ([int]($WaitForProcessingSeconds * 3)) 1
    if ($wp.success) { LogOk "Produto verificado por ID"; $results += @{ test='verify_produto_by_id'; ok=$true } }
    else {
      # Fallback: check product list for SKU
      LogWarn "Produto nao verificado por ID em tempo, consultando lista (fallback)"
      $pl = DoRequest 'GET' "$ApiBaseUrl/produtos"
      if ($pl.success) {
        $items = Get-ListItems $pl.result
        $match = $items | Where-Object { $_.sku -eq $sku }
        if ($match) { LogOk 'Produto verificado na lista'; $results += @{ test='list_produtos'; ok=$true } }
        else { LogWarn 'Produto nao encontrado na lista'; $results += @{ test='list_produtos'; ok=$false; note='not_found'; resp=$pl.result } }
      } else {
        LogWarn "Erro listar produtos (fallback): $($pl.error)"; $results += @{ test='list_produtos'; ok=$false; error=$pl.error }
      }
    }    # Wait for SearchAgent to index produto (CDC from SearchAgent)
    LogInfo "Aguardando indexacao do produto no OpenSearch..."
    $searchProd = WaitForApi 'POST' "$ApiBaseUrl/search/produtos" { param($r)
      $items = Get-ListItems $r
      return ($items | Where-Object { $_.sku -eq $sku }) -ne $null
    } ([int]($WaitForProcessingSeconds * 3)) 1 (@{ query=$sku } | ConvertTo-Json)
    if ($searchProd.success) { LogOk "Produto indexado no SearchAgent (OpenSearch)"; $results += @{ test='search_produto_index'; ok=$true } }
    else { LogWarn "Produto nao indexado no OpenSearch em tempo (pode estar ainda processando)"; $results += @{ test='search_produto_index'; ok=$false; note='timeout' } }

  } else { LogWarn "Produto criado mas id nao encontrado: $($pr.result | ConvertTo-Json -Depth 4)"; $results += @{ test='create_produto'; ok=$true; id=$null; resp=$pr.result } }
} else { LogErr "Falha criar produto: $($pr.error)"; $results += @{ test='create_produto'; ok=$false; error=$pr.error } }

# Create cliente
LogInfo "\n== Create cliente =="
$clienteEmail = "test+$ts@example.com"
$clientePayload = @{ nome="Test User $ts"; email=$clienteEmail; telefone='+55 11 99999-0000'; endereco=@{ rua='Rua Teste'; numero=100; cidade='Sao Paulo'; estado='SP'; cep='01234-567' } } | ConvertTo-Json -Depth 8
$cr = DoRequest 'POST' "$ApiBaseUrl/clientes" $clientePayload
if ($cr.success) {
  $cliId = Get-Id $cr.result @('clienteId','id')
  if ($cliId) {
    LogOk "Cliente criado: $cliId"; $created.clienteId = $cliId; $results += @{ test='create_cliente'; ok=$true; id=$cliId }

    # Wait for cliente to appear in domain (longer timeout)
    $wc = WaitForApi 'GET' "$ApiBaseUrl/clientes/$cliId" { param($r) return $true } ([int]($WaitForProcessingSeconds * 3)) 1
    if ($wc.success) { LogOk "Cliente verificado por ID"; $results += @{ test='verify_cliente_by_id'; ok=$true } }
    else {
      LogWarn "Cliente nao verificado por ID em tempo, consultando lista (fallback)"
      $cl = DoRequest 'GET' "$ApiBaseUrl/clientes"
      if ($cl.success) {
        $items = Get-ListItems $cl.result
        $match = $items | Where-Object { $_.email -eq $clienteEmail }
        if ($match) { LogOk 'Cliente verificado na lista'; $results += @{ test='list_clientes'; ok=$true } }
        else { LogWarn 'Cliente nao encontrado na lista'; $results += @{ test='list_clientes'; ok=$false; note='not_found'; resp=$cl.result } }
      } else {
        LogWarn "Erro listar clientes (fallback): $($cl.error)"; $results += @{ test='list_clientes'; ok=$false; error=$cl.error }
      }
    }    # Wait for SearchAgent to index cliente
    LogInfo "Aguardando indexacao do cliente no OpenSearch..."
    $searchCli = WaitForApi 'POST' "$ApiBaseUrl/search/clientes" { param($r)
      $items = Get-ListItems $r
      return ($items | Where-Object { $_.email -eq $clienteEmail }) -ne $null
    } ([int]($WaitForProcessingSeconds * 3)) 1 (@{ query=$clienteEmail } | ConvertTo-Json)
    if ($searchCli.success) { LogOk "Cliente indexado no SearchAgent (OpenSearch)"; $results += @{ test='search_cliente_index'; ok=$true } }
    else { LogWarn "Cliente nao indexado no OpenSearch em tempo (pode estar ainda processando)"; $results += @{ test='search_cliente_index'; ok=$false; note='timeout' } }

  } else { LogWarn "Cliente criado mas id nao encontrado: $($cr.result | ConvertTo-Json -Depth 4)"; $results += @{ test='create_cliente'; ok=$true; id=$null } }
} else { LogErr "Falha criar cliente: $($cr.error)"; $results += @{ test='create_cliente'; ok=$false; error=$cr.error } }

# Create pedido
LogInfo "\n== Create pedido =="
if (-not $created.productId -or -not $created.clienteId) { LogErr 'Produto ou Cliente faltando — nao foi possivel criar pedido'; $results += @{ test='create_pedido'; ok=$false; note='missing_product_or_cliente' } }
else {
  $pedidoPayload = @{ clienteId=$created.clienteId; itens=@( @{ produtoId=$created.productId; quantidade=1; precoUnitario=123.45 } ) } | ConvertTo-Json -Depth 8
  $pe = DoRequest 'POST' "$ApiBaseUrl/pedidos" $pedidoPayload
  if ($pe.success) {
    $pedidoId = Get-Id $pe.result @('pedidoId','id')
    if ($pedidoId) { LogOk "Pedido criado: $pedidoId"; $created.pedidoId = $pedidoId; $results += @{ test='create_pedido'; ok=$true; id=$pedidoId } }
    else { LogWarn "Pedido criado mas id nao encontrado: $($pe.result | ConvertTo-Json -Depth 4)"; $results += @{ test='create_pedido'; ok=$true; id=$null } }
  } else { LogErr "Falha criar pedido: $($pe.error)"; $results += @{ test='create_pedido'; ok=$false; error=$pe.error } }
}

# Wait for async processing and get pedido
if ($created.pedidoId) {
  LogInfo "\nAguardando processamento assincrono ($WaitForProcessingSeconds s)..."
  $gpwait = WaitForApi 'GET' "$ApiBaseUrl/pedidos/$($created.pedidoId)" { param($r) return $true } ([int]($WaitForProcessingSeconds * 4)) 1
  if ($gpwait.success) { LogOk "Pedido obtido: $($gpwait.result | ConvertTo-Json -Depth 6)"; $results += @{ test='get_pedido'; ok=$true; resp=$gpwait.result } }
  else { LogErr "Erro obter pedido (após espera): $($gpwait.last.error)"; $results += @{ test='get_pedido'; ok=$false; error=$gpwait.last.error } }

  # Update pedido status (only if we could fetch it)
  if ($gpwait.success) {
    $upd = @{ status='CONFIRMADO' } | ConvertTo-Json
    $ur = DoRequest 'PUT' "$ApiBaseUrl/pedidos/$($created.pedidoId)" $upd
    if ($ur.success) { LogOk "Pedido atualizado"; $results += @{ test='update_pedido'; ok=$true; resp=$ur.result } }
    else { LogErr "Falha atualizar pedido: $($ur.error)"; $results += @{ test='update_pedido'; ok=$false; error=$ur.error } }
  }
  # Wait for SearchAgent to index pedido
  LogInfo "Aguardando indexacao do pedido no OpenSearch..."
  $searchPedido = WaitForApi 'POST' "$ApiBaseUrl/search/pedidos" { param($r)
    $items = Get-ListItems $r
    return ($items | Where-Object { $_.id -eq $pedidoId }) -ne $null
  } ([int]($WaitForProcessingSeconds * 3)) 1 (@{ query=$pedidoId } | ConvertTo-Json)
  if ($searchPedido.success) { LogOk "Pedido indexado no SearchAgent (OpenSearch)"; $results += @{ test='search_pedido_index'; ok=$true } }
  else { LogWarn "Pedido nao indexado no OpenSearch em tempo (pode estar ainda processando)"; $results += @{ test='search_pedido_index'; ok=$false; note='timeout' } }
}

# Cleanup
if (-not $SkipCleanup) {
  LogInfo "\n== Cleanup =="
  if ($created.productId) {
    $delP = DoRequest 'DELETE' "$ApiBaseUrl/produtos/$($created.productId)"
    if ($delP.success) { LogOk "Produto deletado: $($created.productId)"; $results += @{ test='delete_produto'; ok=$true } }
    else {
      if ($delP.error -match '404|Not Found|Não Localizado|Não Encontrado') { LogWarn "Produto nao encontrado ao deletar (considerado limpo)"; $results += @{ test='delete_produto'; ok=$true; note='not_found' } }
      else { LogWarn "Falha deletar produto: $($delP.error)"; $results += @{ test='delete_produto'; ok=$false; error=$delP.error } }
    }
  }
  if ($created.clienteId) {
    $delC = DoRequest 'DELETE' "$ApiBaseUrl/clientes/$($created.clienteId)"
    if ($delC.success) { LogOk "Cliente deletado: $($created.clienteId)"; $results += @{ test='delete_cliente'; ok=$true } }
    else {
      if ($delC.error -match '404|Not Found|Não Localizado|Não Encontrado') { LogWarn "Cliente nao encontrado ao deletar (considerado limpo)"; $results += @{ test='delete_cliente'; ok=$true; note='not_found' } }
      else { LogWarn "Falha deletar cliente: $($delC.error)"; $results += @{ test='delete_cliente'; ok=$false; error=$delC.error } }
    }
  }
} else { LogWarn "Cleanup pulado (SkipCleanup)" }

# Show last lines of API Gateway logs (if docker available)
LogInfo "\n== API Gateway logs (last 30 lines) =="
try {
  $logs = docker logs agentic-api-gateway --tail 30 2>&1
  if ($LASTEXITCODE -eq 0) { $logs -split "`n" | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray } }
  else { LogWarn "Nao foi possivel ler logs: $logs" }
} catch { LogWarn "Docker logs nao disponiveis: $_" }

# Summary
LogInfo "\n== Summary =="
$passed = ($results | Where-Object { $_.ok -eq $true }).Count
$failed = ($results | Where-Object { $_.ok -ne $true }).Count
LogInfo "Total testes: $($results.Count)  |  Passaram: $passed  |  Falharam: $failed"

if ($failed -gt 0) { LogErr "Alguns testes falharam"; exit 1 } else { LogOk "Todos os testes passaram"; exit 0 }
