$API_BASE_URL = "http://localhost:3000/api"

Write-Host "Testing API Gateway..." -ForegroundColor Yellow

Write-Host "`nTest 1: Health Check" -ForegroundColor Blue
try {
    $health = Invoke-RestMethod -Method Get -Uri "http://localhost:3000/health"
    Write-Host "Status: $($health.status)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`nTest 2: List Clientes" -ForegroundColor Blue
try {
    $clientes = Invoke-RestMethod -Method Get -Uri "$API_BASE_URL/clientes"
    Write-Host "Clientes count: $($clientes.Count)" -ForegroundColor Green
    $clientes | ConvertTo-Json | Write-Host
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}

Write-Host "`nTest 3: Create Cliente" -ForegroundColor Blue
$clienteData = @{
    nome = "Test User"
    email = "test@example.com"
    telefone = "+55 11 99999-9999"
    endereco = @{
        rua = "Rua Test"
        numero = 123
        cidade = "Sao Paulo"
        estado = "SP"
        cep = "01234-567"
    }
} | ConvertTo-Json

try {
    $response = Invoke-RestMethod -Method Post -Uri "$API_BASE_URL/clientes" -ContentType "application/json" -Body $clienteData
    Write-Host "Created: $($response.id)" -ForegroundColor Green
    $response | ConvertTo-Json | Write-Host
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
