# Embedded Runtime Prep

Run this before building Nimbus when `Embedded/` is empty or stale:

```bash
./scripts/prepare_embedded_runtime.sh
```

What it does:
- Copies `aipal` runtime files into `Embedded/aipal`
- Installs production npm dependencies if needed
- Copies your local Node binary into `Embedded/runtime/node`

Machine prerequisites:
- `node` available in `PATH`, or `NIMBUS_NODE_BIN` pointing to a local Node binary
- A local AIPAL source checkout, or `AIPAL_SRC` pointing to it

External tools used by Nimbus at runtime but not installed by this script:
- `codex` in `PATH`
- a transcription command for Telegram audio if you plan to use audio
  - default in Nimbus/AIPAL: `parakeet-mlx`
  - configurable via `AIPAL_WHISPER_CMD`

Quick checks:

```bash
command -v node
command -v codex
command -v parakeet-mlx
```

Notes:
- `prepare_embedded_runtime.sh` prepares the embedded runtime only; it does not install `codex`.
- If the transcription command is missing, Nimbus can still run, but audio transcription may fail.

Optional environment variables:
- `AIPAL_SRC`: absolute path to aipal source (default: `../../aipal`)
- `NIMBUS_NODE_BIN`: absolute path to Node binary to embed
