const { buildThreadKey, normalizeTopicId } = require('./thread-store');

function buildActiveTurnKey(chatId, topicId, agentId) {
  return buildThreadKey(chatId, normalizeTopicId(topicId), agentId);
}

function getActiveTurn(activeTurns, chatId, topicId, agentId) {
  if (!(activeTurns instanceof Map)) return null;
  const key = buildActiveTurnKey(chatId, topicId, agentId);
  const value = activeTurns.get(key);
  if (!value || typeof value !== 'object') return null;
  return { ...value };
}

function setActiveTurn(activeTurns, chatId, topicId, agentId, value) {
  if (!(activeTurns instanceof Map)) return null;
  if (!value || typeof value !== 'object') return null;
  const key = buildActiveTurnKey(chatId, topicId, agentId);
  const normalized = {
    threadId: String(value.threadId || '').trim(),
    startedAt: String(value.startedAt || '').trim(),
    status: String(value.status || '').trim(),
  };
  if (!normalized.threadId || !normalized.startedAt || !normalized.status) {
    return null;
  }
  const sessionFilePath = String(value.sessionFilePath || '').trim();
  const lastObservedTimestamp = String(value.lastObservedTimestamp || '').trim();
  const source = String(value.source || '').trim();
  if (sessionFilePath) normalized.sessionFilePath = sessionFilePath;
  if (lastObservedTimestamp) normalized.lastObservedTimestamp = lastObservedTimestamp;
  if (source) normalized.source = source;
  activeTurns.set(key, normalized);
  return { ...normalized };
}

function clearActiveTurn(activeTurns, chatId, topicId, agentId) {
  if (!(activeTurns instanceof Map)) return false;
  const key = buildActiveTurnKey(chatId, topicId, agentId);
  return activeTurns.delete(key);
}

module.exports = {
  buildActiveTurnKey,
  clearActiveTurn,
  getActiveTurn,
  setActiveTurn,
};
