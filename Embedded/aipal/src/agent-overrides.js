const { buildTopicKey } = require('./thread-store');

function getAgentOverrideKey(chatId, topicId) {
  return buildTopicKey(chatId, topicId);
}

function getAgentOverride(overrides, chatId, topicId) {
  return overrides.get(getAgentOverrideKey(chatId, topicId));
}

function setAgentOverride(overrides, chatId, topicId, agentId) {
  const key = getAgentOverrideKey(chatId, topicId);
  overrides.set(key, agentId);
  return key;
}

function clearAgentOverride(overrides, chatId, topicId) {
  return overrides.delete(getAgentOverrideKey(chatId, topicId));
}

module.exports = {
  clearAgentOverride,
  getAgentOverride,
  getAgentOverrideKey,
  setAgentOverride,
};
