// IMG-022: reads the redraw server's settings from the environment and an optional .env file (our
// own tiny reader, no dependency). A variable already set in the environment wins over the file.
// See docs/specifications/IMG-022-RedrawProvider.md D4; every variable is listed in .env.example.

export const REDRAW_ENV_DEFAULTS = Object.freeze({
  OPENAI_IMAGE_MODEL: 'gpt-image-2',
  OPENAI_IMAGE_QUALITY: 'high',
  REDRAW_RATE_LIMIT_PER_HOUR: 20
});

// KEY=value lines; blank lines and # comments skipped; one pair of surrounding quotes removed; no
// variable expansion.
export function parseEnvFile(text = '') {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

export function loadRedrawEnv({ env = process.env, envFileText = '' } = {}) {
  const file = parseEnvFile(envFileText);
  const get = (key) => (env[key] !== undefined ? env[key] : file[key]);
  const str = (key) => (typeof get(key) === 'string' ? get(key).trim() : '');
  const limit = Number(str('REDRAW_RATE_LIMIT_PER_HOUR'));
  return {
    openaiApiKey: str('OPENAI_API_KEY'),
    imageModel: str('OPENAI_IMAGE_MODEL') || REDRAW_ENV_DEFAULTS.OPENAI_IMAGE_MODEL,
    imageQuality: str('OPENAI_IMAGE_QUALITY') || REDRAW_ENV_DEFAULTS.OPENAI_IMAGE_QUALITY,
    accessCode: str('REDRAW_ACCESS_CODE'),
    rateLimitPerHour: Number.isInteger(limit) && limit > 0 ? limit : REDRAW_ENV_DEFAULTS.REDRAW_RATE_LIMIT_PER_HOUR,
    costLabel: str('REDRAW_COST_LABEL'),
    fake: str('REDRAW_FAKE') === '1'
  };
}

// Redraw is on when the access code is set and either a key is set or fake mode is on. `missing`
// names what is absent, never a value.
export function redrawConfigStatus(settings) {
  const missing = [];
  if (!settings.accessCode) missing.push('REDRAW_ACCESS_CODE');
  if (!settings.openaiApiKey && !settings.fake) missing.push('OPENAI_API_KEY (or REDRAW_FAKE=1)');
  return { configured: missing.length === 0, missing };
}
