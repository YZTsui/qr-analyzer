function safeDecode(value) {
  try { return decodeURIComponent(value.replace(/\+/g, ' ')); }
  catch { return value; }
}

export function parsePayload(text) {
  const raw = String(text ?? '');
  const candidate = raw.startsWith('?') || raw.startsWith('&') ? raw.slice(1) : raw;
  const fields = {};
  for (const part of candidate.split('&')) {
    if (!part || !part.includes('=')) continue;
    const idx = part.indexOf('=');
    const key = safeDecode(part.slice(0, idx));
    const value = safeDecode(part.slice(idx + 1));
    if (key) fields[key] = value;
  }
  return {
    raw,
    kind: Object.keys(fields).length ? 'params' : 'text',
    fields
  };
}

function formatInTimeZone(epochMs, timeZone) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date(epochMs)).replaceAll('/', '-');
}

export function analyzeTimestamp(value, nowMs = Date.now()) {
  const s = String(value ?? '').trim();
  if (!/^\d{9,16}$/.test(s)) return { detected: false };
  const n = Number(s);
  if (!Number.isFinite(n)) return { detected: false };

  let epochMs;
  let unit;
  if (s.length >= 12) {
    epochMs = n;
    unit = 'milliseconds';
  } else {
    epochMs = n * 1000;
    unit = 'seconds';
  }

  const year = new Date(epochMs).getUTCFullYear();
  if (year < 2000 || year > 2100) return { detected: false };

  return {
    detected: true,
    unit,
    epochMs,
    local: new Date(epochMs).toLocaleString(),
    beijing: formatInTimeZone(epochMs, 'Asia/Shanghai'),
    deltaMs: epochMs - nowMs
  };
}

export function compareSamples(samples) {
  const keys = [...new Set(samples.flatMap(s => Object.keys(s.fields || {})))];
  return keys.map(key => {
    const values = samples.map(s => (s.fields || {})[key] ?? '');
    const unique = new Set(values);
    const numeric = values.every(v => /^-?\d+(?:\.\d+)?$/.test(v));
    const numericDeltas = numeric
      ? values.slice(1).map((v, i) => Number(v) - Number(values[i]))
      : [];
    return {
      key,
      values,
      status: unique.size <= 1 ? 'fixed' : 'changing',
      numericDeltas
    };
  });
}

export function formatDelta(deltaMs) {
  const sign = deltaMs > 0 ? '+' : deltaMs < 0 ? '-' : '±';
  const abs = Math.abs(Math.round(deltaMs / 1000));
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  const parts = [];
  if (h) parts.push(`${h}小时`);
  if (m || h) parts.push(`${m}分`);
  parts.push(`${s}秒`);
  return `${sign}${parts.join('')}`;
}
