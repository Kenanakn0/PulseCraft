# deploy/secrets

Bu klasör, `demo` profilindeki örnek agent'a (`docker compose --profile demo ...`) **salt okunur** olarak
`/run/secrets` altında bağlanır. İçine koyduğunuz dosyalar **git'e girmez** (yalnızca bu README izlenir).

Örnek agent'ın API anahtarı: `demo-agent.key`. Anahtarı komuta yazmadan, panodan kaydedin
(PowerShell, `deploy` klasöründe; önce arayüzde "Sunucu ekle" → "Kopyala"):

```powershell
Get-Clipboard | Set-Content -NoNewline secrets\demo-agent.key
```

Neden tek dosya değil de klasör bağlanıyor: Docker Desktop, bağlanacak dosya yoksa host'ta onun yerine
sessizce boş bir KLASÖR oluşturuyor (ve `create_host_path: false` bu ortamda dikkate alınmıyor). Klasör
zaten var olduğu için burada bu tuzak oluşmaz; dosya yoksa agent açık bir hatayla durur.
