function shellQuote(value) {
  const escaped = String(value).replace(/'/g, String.raw`'\''`);
  return `'${escaped}'`;
}

function resolvePromptValue(prompt, promptExpression) {
  if (promptExpression) return promptExpression;
  return shellQuote(prompt);
}

module.exports = {
  shellQuote,
  resolvePromptValue,
};
