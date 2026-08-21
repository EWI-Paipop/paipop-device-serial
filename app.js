import {
  deriveDeviceSerial,
  findFormalSnInCsv,
} from './serial_core.js';

const byId = (id) => document.getElementById(id);
const keyInput = byId('product-key');
const formalSnInput = byId('formal-sn');
const generatedSerial = byId('generated-serial');
const generateStatus = byId('generate-status');
const csvFile = byId('csv-file');
const fileName = byId('file-name');
const lookupSerial = byId('lookup-serial');
const matchedSn = byId('matched-sn');
const lookupStatus = byId('lookup-status');

function setStatus(element, message = '', kind = '') {
  element.textContent = message;
  element.className = `status${kind ? ` ${kind}` : ''}`;
}

function setBusy(button, busy, idleLabel, busyLabel) {
  button.disabled = busy;
  button.textContent = busy ? busyLabel : idleLabel;
}

async function copyValue(value, statusElement) {
  try {
    await navigator.clipboard.writeText(value);
    setStatus(statusElement, '已复制到剪贴板。', 'success');
  } catch {
    setStatus(statusElement, '复制失败，请手动选择复制。', 'error');
  }
}

byId('toggle-key').addEventListener('click', (event) => {
  const button = event.currentTarget;
  const reveal = keyInput.type === 'password';
  keyInput.type = reveal ? 'text' : 'password';
  button.textContent = reveal ? '隐藏' : '显示';
  button.setAttribute('aria-pressed', String(reveal));
});

byId('generate').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  setBusy(button, true, '生成序列号', '正在计算…');
  setStatus(generateStatus);
  byId('copy-serial').hidden = true;
  try {
    const value = await deriveDeviceSerial(formalSnInput.value, keyInput.value);
    generatedSerial.value = value;
    generatedSerial.textContent = value;
    byId('copy-serial').hidden = false;
    setStatus(generateStatus, '已在本地生成。', 'success');
  } catch (error) {
    generatedSerial.value = '';
    generatedSerial.textContent = '—';
    setStatus(generateStatus, error.message, 'error');
  } finally {
    setBusy(button, false, '生成序列号', '正在计算…');
  }
});

byId('copy-serial').addEventListener('click', () =>
  copyValue(generatedSerial.value, generateStatus));

csvFile.addEventListener('change', () => {
  fileName.textContent = csvFile.files[0]?.name ?? '尚未选择文件';
  setStatus(lookupStatus);
});

byId('lookup').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  const file = csvFile.files[0];
  byId('copy-sn').hidden = true;
  if (!file) {
    setStatus(lookupStatus, '请先选择 CSV 文件。', 'error');
    return;
  }

  setBusy(button, true, '开始查询', '正在本地查询…');
  setStatus(lookupStatus);
  try {
    const match = await findFormalSnInCsv(
      await file.text(), lookupSerial.value, keyInput.value);
    if (!match) {
      matchedSn.value = '';
      matchedSn.textContent = '未找到';
      setStatus(lookupStatus, 'CSV 中没有匹配记录。', 'error');
    } else {
      matchedSn.value = match.sn;
      matchedSn.textContent = match.sn;
      byId('copy-sn').hidden = false;
      setStatus(lookupStatus, `匹配 CSV 第 ${match.rowNumber} 行。`, 'success');
    }
  } catch (error) {
    matchedSn.value = '';
    matchedSn.textContent = '—';
    setStatus(lookupStatus, error.message, 'error');
  } finally {
    setBusy(button, false, '开始查询', '正在本地查询…');
  }
});

byId('copy-sn').addEventListener('click', () =>
  copyValue(matchedSn.value, lookupStatus));
