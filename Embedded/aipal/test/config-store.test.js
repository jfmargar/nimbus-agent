const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');

function loadConfigStoreWithEnv(overrides) {
  const target = require.resolve('../src/config-store');
  delete require.cache[target];

  const originalStateHome = process.env.AIPAL_STATE_HOME;
  const originalXdgConfig = process.env.XDG_CONFIG_HOME;

  if (Object.prototype.hasOwnProperty.call(overrides, 'AIPAL_STATE_HOME')) {
    const value = overrides.AIPAL_STATE_HOME;
    if (value == null) {
      delete process.env.AIPAL_STATE_HOME;
    } else {
      process.env.AIPAL_STATE_HOME = value;
    }
  }

  if (Object.prototype.hasOwnProperty.call(overrides, 'XDG_CONFIG_HOME')) {
    const value = overrides.XDG_CONFIG_HOME;
    if (value == null) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = value;
    }
  }

  const loaded = require('../src/config-store');

  if (originalStateHome == null) {
    delete process.env.AIPAL_STATE_HOME;
  } else {
    process.env.AIPAL_STATE_HOME = originalStateHome;
  }
  if (originalXdgConfig == null) {
    delete process.env.XDG_CONFIG_HOME;
  } else {
    process.env.XDG_CONFIG_HOME = originalXdgConfig;
  }

  delete require.cache[target];
  return loaded;
}

test('config-store uses AIPAL_STATE_HOME when present', () => {
  const loaded = loadConfigStoreWithEnv({
    AIPAL_STATE_HOME: '/tmp/aipal-state-home',
    XDG_CONFIG_HOME: '/tmp/xdg-config-home',
  });

  assert.equal(loaded.CONFIG_DIR, '/tmp/aipal-state-home');
  assert.equal(loaded.CONFIG_PATH, '/tmp/aipal-state-home/config.json');
  assert.equal(loaded.ACTIVE_TURNS_PATH, '/tmp/aipal-state-home/active_turns.json');
});

test('config-store falls back to XDG_CONFIG_HOME/aipal', () => {
  const loaded = loadConfigStoreWithEnv({
    AIPAL_STATE_HOME: null,
    XDG_CONFIG_HOME: '/tmp/xdg-config-home',
  });

  assert.equal(loaded.CONFIG_DIR, '/tmp/xdg-config-home/aipal');
  assert.equal(loaded.CONFIG_PATH, '/tmp/xdg-config-home/aipal/config.json');
  assert.equal(
    loaded.ACTIVE_TURNS_PATH,
    '/tmp/xdg-config-home/aipal/active_turns.json'
  );
});

test('config-store falls back to ~/.config/aipal when no env override exists', () => {
  const loaded = loadConfigStoreWithEnv({
    AIPAL_STATE_HOME: null,
    XDG_CONFIG_HOME: null,
  });

  assert.equal(loaded.CONFIG_DIR, path.join(os.homedir(), '.config', 'aipal'));
});
