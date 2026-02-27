# Changelog

All notable changes to NimbusAgent will be documented in this file.

The format is based on Keep a Changelog.

## [1.1.0] - Planned

### Added
- Bidirectional Codex conversation continuity:
  - continue a conversation started in Codex app from the Telegram bot
  - start a conversation in the Telegram bot and continue it later in Codex app
- Codex project and session state persisted per `chat/topic/agent` instead of using only a global working directory
- Project selection flow in Telegram with explicit actions:
  - `Continuar última sesión`
  - `Crear nueva sesión`
- Visible Codex session creation from Telegram for new conversations
- Shared local Codex session discovery through `CODEX_HOME` / `~/.codex`
- Project/session navigation from the Telegram keyboard based on local Codex sessions

### Changed
- Codex shared sessions now use a clean prompt mode so the visible conversation in Codex app remains readable
- Bootstrap memory, retrieval context, and long Telegram-specific prompt boilerplate are no longer injected into shared Codex sessions
- Audio messages continue to work, but their transcription is now forwarded to Codex as plain text for cleaner shared history
- Topic/project/session resolution was tightened so changing project no longer reuses an incompatible session accidentally

### Fixed
- New sessions created from Telegram are now associated back to the correct topic and project
- Interactive Codex session creation no longer fails when the session was created successfully but the TUI process later times out
- Codex sessions are resolved from the same local home used by Codex app, improving visibility and continuity between both clients

### Documentation
- Added project documentation for:
  - local machine requirements
  - external dependencies such as `codex` and audio transcription tooling
  - Codex shared-session behavior
  - embedded runtime preparation requirements

## [1.0.1]

### Added
- macOS menu bar app shell for NimbusAgent
- Embedded AIPAL runtime execution from the app
- Settings UI and diagnostics UI
- Preflight validation before starting the agent
- Keychain storage for `TELEGRAM_BOT_TOKEN`
- JSON-based local settings storage for non-secret configuration

### Configuration
- Support for:
  - `ALLOWED_USERS`
  - `AIPAL_DROP_PENDING_UPDATES`
  - `AIPAL_AGENT_CWD`
  - `AIPAL_WHISPER_CMD`
  - `AIPAL_SCRIPT_TIMEOUT_MS`
  - `AIPAL_AGENT_TIMEOUT_MS`
  - `AIPAL_AGENT_MAX_BUFFER`
  - `AIPAL_MEMORY_CURATE_EVERY`
  - `AIPAL_MEMORY_RETRIEVAL_LIMIT`
  - `AIPAL_SHUTDOWN_DRAIN_TIMEOUT_MS`

### Tooling
- Embedded runtime preparation script via `./scripts/prepare_embedded_runtime.sh`
