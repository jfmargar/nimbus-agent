const { buildThreadKey, normalizeTopicId } = require('./thread-store');

function getProjectOverrideKey(chatId, topicId, agentId) {
  return buildThreadKey(chatId, normalizeTopicId(topicId), agentId);
}

function getProjectOverride(overrides, chatId, topicId, agentId) {
  return overrides.get(getProjectOverrideKey(chatId, topicId, agentId));
}

function setProjectOverride(overrides, chatId, topicId, agentId, cwd) {
  const key = getProjectOverrideKey(chatId, topicId, agentId);
  overrides.set(key, String(cwd || '').trim());
  return key;
}

function clearProjectOverride(overrides, chatId, topicId, agentId) {
  return overrides.delete(getProjectOverrideKey(chatId, topicId, agentId));
}

module.exports = {
  clearProjectOverride,
  getProjectOverride,
  getProjectOverrideKey,
  setProjectOverride,
};
