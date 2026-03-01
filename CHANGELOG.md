# Changelog

All notable changes to NimbusAgent will be documented in this file.

The format is based on Keep a Changelog.

## [Unreleased]

## [1.2.1] - 2026-03-01

### Added
- Official Codex SDK integration inside the embedded AIPAL runtime for structured resumed turns
- Telegram progress updates for Codex execution states instead of relying only on typing indicators
- Codex integration settings for approval mode, sandbox mode, and progress visibility in the macOS app

### Changed
- Codex now uses a hybrid transport:
  - new visible sessions are created through the interactive CLI flow
  - existing sessions are resumed through the official Codex SDK
- New session creation from Telegram now opens the visible Codex session immediately for the selected project and then continues later turns through the SDK
- The technical seed turn used to create visible Codex sessions is now minimized so the Telegram flow stays faster while Codex App still shows a clean, reusable session

### Fixed
- Local Codex session reconciliation after interactive creation is more robust for project-bound sessions
- Creating a new Codex session no longer silently reattaches the previous project session without warning when Nimbus cannot confirm the new one
- Interactive Codex session startup now stops as soon as the first assistant turn is persisted locally, reducing the long wait that previously happened before Telegram reported the session as ready
- The initial visible Codex session created from Telegram no longer tends to leave a hanging `Pensando` entry in Codex App
- Progress messages no longer stay stuck in `Codex: iniciando sesion...` when creation fails
- New Codex sessions are resolved back to the correct topic and project more consistently
- Embedded runtime notarization now strips bundled `biome`, re-signs embedded `rg`/`codex`, and signs the bundled `node` binary with the Hardened Runtime JIT entitlement so the agent can start correctly

## [1.1.0] - 2026-02-27

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

## [1.0.1] - 2026-02-26

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
