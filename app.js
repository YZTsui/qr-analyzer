import { parsePayload, analyzeTimestamp, compareSamples, formatDelta } from './core.mjs';

const state = { samples: [] };
const el = id => document.getElementById(id);
const imageInput = el('imageInput');
const statusArea = el('statusArea');
const sampleList = el('sampleList');
const samplesSection = el('samplesSection');
const comparisonSection = el('comparisonSection');
const comparisonTable = el('comparisonTable');
const regenSection = el('regenSection');
const sampleSelect = el('sampleSelect');
const qrOutput = el('qrOutput');
const fullscreenOverlay = el('fullscreenOverlay');
const fullscreenQr = el('fullscreenQr');
const canvas = el('workCanvas');

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function updateClock() {
  el('liveClock').textContent = new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date());
}
updateClock();
setInterval(updateClock, 1000);

function addStatus(message, kind = 'success') {
  const div = document.createElement('div');
  div.className = `notice ${kind}`;
  div.textContent = message;
  statusArea.appendChild(div);
}

function checkDependencies() {
  const warnings = [];
  if (!('BarcodeDetector' in window) && typeof window.jsQR !== 'function') {
    warnings.push('二维码识别库未加载。请确认网络连接，或在 Safari 中重新打开页面。');
  }
  if (typeof window.qrcode !== 'function') {
    warnings.push('二维码重建库未加载。解析仍可能可用，但“原样重建”功能暂不可用。');
  }
  if (warnings.length) {
    const box = el('dependencyWarning');
    box.textContent = warnings.join(' ');
    box.classList.remove('hidden');
  }
}
window.addEventListener('load', checkDependencies);

async function imageToCanvas(file) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('无法读取这张图片。可尝试先在相册中截图后再上传。'));
      image.src = objectUrl;
    });
    const maxSide = 2200;
    const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return ctx;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function decodeWithBarcodeDetector() {
  if (!('BarcodeDetector' in window)) return null;
  try {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const results = await detector.detect(canvas);
    return results?.[0]?.rawValue || null;
  } catch {
    return null;
  }
}

function decodeWithJsQr(ctx) {
  if (typeof window.jsQR !== 'function') return null;
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result = window.jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth'
  });
  return result?.data || null;
}

async function decodeFile(file) {
  const ctx = await imageToCanvas(file);
  let raw = await decodeWithBarcodeDetector();
  if (!raw) raw = decodeWithJsQr(ctx);
  if (!raw) throw new Error('没有识别到二维码。请尽量选择清晰、完整且二维码占画面较大的截图。');
  const parsed = parsePayload(raw);
  return {
    name: file.name || `样本 ${state.samples.length + 1}`,
    raw,
    fields: parsed.fields,
    kind: parsed.kind,
    addedAt: Date.now()
  };
}

function detectTimestampFields(sample) {
  const results = [];
  for (const [key, value] of Object.entries(sample.fields || {})) {
    const info = analyzeTimestamp(value, Date.now());
    if (info.detected) results.push({ key, value, ...info });
  }
  return results;
}

function renderSamples() {
  sampleList.innerHTML = '';
  state.samples.forEach((sample, index) => {
    const fields = Object.entries(sample.fields || {});
    const timestamps = detectTimestampFields(sample);
    const card = document.createElement('article');
    card.className = 'sample-card';
    card.innerHTML = `
      <div class="sample-top">
        <div>
          <div class="sample-name">${escapeHtml(sample.name)}</div>
          <div class="hint">样本 ${index + 1}</div>
        </div>
        <span class="badge">识别成功</span>
      </div>
      <div class="raw-block">${escapeHtml(sample.raw)}</div>
      ${fields.length ? `<dl class="field-grid">${fields.map(([k,v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` : '<p class="hint">未检测到 key=value 形式的字段，已保留完整原文。</p>'}
      ${timestamps.map(t => `
        <div class="time-box">
          <div><strong>${escapeHtml(t.key)}</strong> 被识别为 Unix ${t.unit === 'seconds' ? '秒' : '毫秒'}时间戳</div>
          <div>北京时间：<strong>${escapeHtml(t.beijing)}</strong></div>
          <div>与当前设备时间相差：<strong>${escapeHtml(formatDelta(t.deltaMs))}</strong></div>
        </div>`).join('')}
    `;
    sampleList.appendChild(card);
  });
  samplesSection.classList.toggle('hidden', state.samples.length === 0);
}

function renderComparison() {
  if (state.samples.length < 2) {
    comparisonSection.classList.add('hidden');
    return;
  }
  const rows = compareSamples(state.samples);
  comparisonTable.querySelector('thead').innerHTML = `
    <tr><th>字段</th>${state.samples.map((_,i) => `<th>样本 ${i+1}</th>`).join('')}<th>判断</th></tr>`;
  comparisonTable.querySelector('tbody').innerHTML = rows.map(row => {
    const delta = row.numericDeltas.length && row.status === 'changing'
      ? `<span class="delta-note">相邻差值：${row.numericDeltas.map(v => escapeHtml(v)).join(' / ')}</span>` : '';
    return `<tr>
      <td><strong>${escapeHtml(row.key)}</strong></td>
      ${row.values.map(v => `<td>${escapeHtml(v)}</td>`).join('')}
      <td class="${row.status === 'fixed' ? 'status-fixed' : 'status-changing'}">${row.status === 'fixed' ? '固定' : '变化'}${delta}</td>
    </tr>`;
  }).join('');
  comparisonSection.classList.remove('hidden');
}

function qrSvg(payload) {
  if (typeof window.qrcode !== 'function') return '';
  const qr = window.qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 8, margin: 4, scalable: true });
}

function renderRegenerated() {
  if (!state.samples.length) {
    regenSection.classList.add('hidden');
    return;
  }
  regenSection.classList.remove('hidden');
  sampleSelect.innerHTML = state.samples.map((s,i) => `<option value="${i}">样本 ${i+1} · ${escapeHtml(s.name)}</option>`).join('');
  const idx = Math.min(Number(sampleSelect.value || 0), state.samples.length - 1);
  sampleSelect.value = String(idx);
  const svg = qrSvg(state.samples[idx].raw);
  qrOutput.innerHTML = svg || '<div class="notice warning">二维码重建库尚未加载，请联网刷新页面。</div>';
}

function renderAll() {
  renderSamples();
  renderComparison();
  renderRegenerated();
}

imageInput.addEventListener('change', async event => {
  const files = [...event.target.files];
  if (!files.length) return;
  statusArea.innerHTML = '';
  addStatus(`正在分析 ${files.length} 张图片…`, 'success');
  let successCount = 0;
  for (const file of files) {
    try {
      const sample = await decodeFile(file);
      state.samples.push(sample);
      successCount++;
    } catch (err) {
      addStatus(`${file.name || '图片'}：${err.message}`, 'error');
    }
  }
  statusArea.innerHTML = '';
  if (successCount) addStatus(`成功识别 ${successCount} 张二维码。`, 'success');
  if (successCount < files.length) addStatus(`${files.length - successCount} 张图片未能识别。`, 'warning');
  renderAll();
  imageInput.value = '';
});

el('clearButton').addEventListener('click', () => {
  state.samples = [];
  statusArea.innerHTML = '';
  renderAll();
});

sampleSelect.addEventListener('change', () => {
  const idx = Number(sampleSelect.value);
  const sample = state.samples[idx];
  qrOutput.innerHTML = sample ? qrSvg(sample.raw) : '';
});

async function copyCurrentPayload() {
  const sample = state.samples[Number(sampleSelect.value) || 0];
  if (!sample) return;
  try {
    await navigator.clipboard.writeText(sample.raw);
    addStatus('已复制原始二维码内容。', 'success');
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = sample.raw;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    addStatus('已复制原始二维码内容。', 'success');
  }
}
el('copyButton').addEventListener('click', copyCurrentPayload);

el('fullscreenButton').addEventListener('click', () => {
  const sample = state.samples[Number(sampleSelect.value) || 0];
  if (!sample) return;
  fullscreenQr.innerHTML = qrSvg(sample.raw);
  fullscreenOverlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
});

function closeFullscreen() {
  fullscreenOverlay.classList.add('hidden');
  fullscreenQr.innerHTML = '';
  document.body.style.overflow = '';
}
el('closeFullscreen').addEventListener('click', closeFullscreen);
fullscreenOverlay.addEventListener('click', event => {
  if (event.target === fullscreenOverlay) closeFullscreen();
});

renderAll();
