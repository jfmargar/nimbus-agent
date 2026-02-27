# Embedded Runtime Refresh

Use this only when you want to refresh the vendored runtime in `Embedded/`.

Normal app builds do not require this step if the repo already contains:

- `Embedded/aipal`
- `Embedded/runtime/node`

Typical cases where this script makes sense:

- `Embedded/` is missing or corrupted
- you want to sync `Embedded/aipal` from another AIPAL checkout
- you want to replace the embedded Node binary

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
- `prepare_embedded_runtime.sh` is a maintenance helper; it is not the standard startup path for this repo.
- It prepares the embedded runtime only; it does not install `codex`.
- If the transcription command is missing, Nimbus can still run, but audio transcription may fail.

Optional environment variables:
- `AIPAL_SRC`: absolute path to aipal source (default: `../../aipal`)
- `NIMBUS_NODE_BIN`: absolute path to Node binary to embed
