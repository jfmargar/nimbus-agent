function normalizeTopicId(topicId) {
  if (topicId === undefined || topicId === null || topicId === '') {
    return 'root';
  }
  return String(topicId);
}

function buildTopicKey(chatId, topicId) {
  return `${String(chatId)}:${normalizeTopicId(topicId)}`;
}

function buildThreadKey(chatId, topicId, agentId) {
  return `${buildTopicKey(chatId, topicId)}:${agentId}`;
}

function getLegacyThreadKey(chatId, agentId) {
  return `${String(chatId)}:${agentId}`;
}

function getLegacyChatKey(chatId) {
  return String(chatId);
}

function resolveThreadId(threads, chatId, topicId, agentId) {
  const normalizedTopic = normalizeTopicId(topicId);
  const threadKey = buildThreadKey(chatId, normalizedTopic, agentId);
  const direct = threads.get(threadKey);
  if (direct) {
    return { threadKey, threadId: direct, migrated: false };
  }

  if (normalizedTopic !== 'root') {
    return { threadKey, threadId: undefined, migrated: false };
  }

  const legacyKey = getLegacyThreadKey(chatId, agentId);
  const legacy = threads.get(legacyKey);
  if (legacy) {
    threads.set(threadKey, legacy);
    threads.delete(legacyKey);
    return { threadKey, threadId: legacy, migrated: true };
  }

  const legacyChatKey = getLegacyChatKey(chatId);
  const legacyChat = threads.get(legacyChatKey);
  if (legacyChat) {
    threads.set(threadKey, legacyChat);
    threads.delete(legacyChatKey);
    return { threadKey, threadId: legacyChat, migrated: true };
  }

  return { threadKey, threadId: undefined, migrated: false };
}

function clearThreadForAgent(threads, chatId, topicId, agentId) {
  const normalizedTopic = normalizeTopicId(topicId);
  const threadKey = buildThreadKey(chatId, normalizedTopic, agentId);
  const removed = threads.delete(threadKey);

  if (normalizedTopic === 'root') {
    const removedLegacy = threads.delete(getLegacyThreadKey(chatId, agentId));
    const removedLegacyChat = threads.delete(getLegacyChatKey(chatId));
    return removed || removedLegacy || removedLegacyChat;
  }

  return removed;
}

module.exports = {
  buildThreadKey,
  buildTopicKey,
  clearThreadForAgent,
  normalizeTopicId,
  resolveThreadId,
};
