# deploy/secrets

This folder is mounted **read-only** at `/run/secrets` into the example agent of the `demo` profile
(`docker compose --profile demo ...`). Files you put here are **not tracked by git** (only this README is).

The example agent's API key goes into `demo-agent.key`. Save it from the clipboard without typing it into a
command (PowerShell, in the `deploy` folder, after "Sunucu ekle" → "Kopyala" in the UI):

```powershell
Get-Clipboard | Set-Content -NoNewline secrets\demo-agent.key
```

Why a folder and not a single file: when a bind-mounted file does not exist, Docker Desktop silently creates
an empty directory in its place (and ignores `create_host_path: false`). The folder always exists, so that
trap cannot happen here; without the file the agent stops with a clear error.
