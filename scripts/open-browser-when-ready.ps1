# Polls the server port and only opens the browser once it's actually
# accepting connections, instead of guessing with a fixed delay (which opens
# the browser on a dead port if the server failed to start or is slow).
param(
    [int]$Port = 4390,
    [int]$TimeoutSeconds = 30
)

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
while ((Get-Date) -lt $deadline) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $client.Connect("127.0.0.1", $Port)
        if ($client.Connected) {
            $client.Close()
            Start-Process "http://localhost:$Port"
            exit 0
        }
    } catch {
        Start-Sleep -Milliseconds 400
    }
}
# Timed out: the server never came up. Say nothing here — the main console
# window already shows whatever error caused that, which is more useful than
# a browser tab with a generic connection error.
