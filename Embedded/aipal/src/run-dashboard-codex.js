require('dotenv').config();
const { getAgent } = require('./agents');
const { createAgentRunner } = require('./services/agent-runner');
const { execLocal, execLocalWithPty, wrapCommandWithPty, shellQuote } = require('./services/process');
const { getLocalCodexSessionMeta, getLocalCodexSessionTurnState, listLocalCodexSessions, listLocalCodexSessionsSince, listSqliteCodexThreads, findNewestSessionDiff } = require('./services/codex-sessions');

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

async function main() {
  const cwd = process.argv[2] || process.cwd();
  const prompt = process.argv.slice(3).join(' ');
  if (!prompt) {
    console.error("Usage: node run-dashboard-codex.js <repo-path> <prompt...>");
    process.exit(1);
  }

  const agentMaxBuffer = parsePositiveInt(process.env.AIPAL_AGENT_MAX_BUFFER, 10 * 1024 * 1024);
  const agentTimeoutMs = parsePositiveInt(process.env.AIPAL_AGENT_TIMEOUT_MS, 10 * 60 * 1000);
  const codexApprovalMode = String(process.env.AIPAL_CODEX_APPROVAL_MODE || 'never').trim() || 'never';
  const codexSandboxMode = String(process.env.AIPAL_CODEX_SANDBOX_MODE || 'workspace-write').trim() || 'workspace-write';

  const agentRunner = createAgentRunner({
    agentMaxBuffer,
    agentTimeoutMs,
    codexApprovalMode,
    codexSandboxMode,
    execLocal,
    execLocalWithPty,
    wrapCommandWithPty,
    getLocalCodexSessionMeta,
    getLocalCodexSessionTurnState,
    listLocalCodexSessions,
    listLocalCodexSessionsSince,
    listSqliteCodexThreads,
    findNewestSessionDiff,
    getThreads: () => new Map(),
    persistThreads: async () => {},
    persistProjectOverrides: async () => {},
    persistActiveTurns: async () => {},
    setProjectForAgent: () => {},
    setActiveTurn: () => null,
    clearActiveTurn: () => false,
    getActiveTurn: () => null,
    resolveThreadId: () => {},
    shellQuote,
  });

  const agent = getAgent('codex');
  console.log(`Starting visible session in ${cwd}...`);
  console.log(`Codex settings: approval=${codexApprovalMode} sandbox=${codexSandboxMode} timeoutMs=${agentTimeoutMs}`);
  try {
    const result = await agentRunner.runCodexNewSessionInteractive({
      agent,
      chatId: 'dashboard',
      topicId: 'dashboard',
      effectiveAgentId: 'codex',
      executionCwd: cwd,
      finalPrompt: prompt,
      threadKey: 'cmd',
      threads: new Map(),
      waitForInteractiveCompletion: false,
      backgroundInteractiveCleanup: false,
    });
    console.log(`\n✅ Session established: ${result.threadId}`);
    if (result.text) {
      console.log(`Summary: ${result.text.split('\n')[0]}`);
    }
  } catch (err) {
    console.error("Failed to execute codex:", err.message);
    process.exit(1);
  }
}

main();
