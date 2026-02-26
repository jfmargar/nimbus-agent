# Embedded Runtime Prep

Run this before building Nimbus when `Embedded/` is empty or stale:

```bash
./scripts/prepare_embedded_runtime.sh
```

What it does:
- Copies `aipal` runtime files into `Embedded/aipal`
- Installs production npm dependencies if needed
- Copies your local Node binary into `Embedded/runtime/node`

Optional environment variables:
- `AIPAL_SRC`: absolute path to aipal source (default: `../../aipal`)
- `NIMBUS_NODE_BIN`: absolute path to Node binary to embed
