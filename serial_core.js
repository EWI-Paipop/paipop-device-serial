const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const LABEL = 'PAIPOP-CT-SERIAL-V1';
const encoder = new TextEncoder();
const CSV_MAX_ROWS = 50000;
const CSV_MAX_COLUMNS = 64;
const CSV_MAX_CELL_LENGTH = 1024;

export function crc5Usb(bytes) {
  let crc = 0x1f;
  for (const input of bytes) {
    let byte = input;
    for (let bit = 0; bit < 8; bit += 1) {
      const mix = ((crc ^ byte) & 1) !== 0;
      crc >>= 1;
      if (mix) crc ^= 0x14;
      byte >>= 1;
    }
  }
  return (crc ^ 0x1f) & 0x1f;
}

function parseKeyHex(keyHex) {
  const value = keyHex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error('Product key must contain exactly 64 hexadecimal characters.');
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function validateFormalSn(formalSn) {
  if (typeof formalSn !== 'string' ||
      formalSn.length < 1 || formalSn.length > 63 ||
      !/^[\x21-\x7e]+$/.test(formalSn)) {
    throw new Error('Formal SN must be 1-63 printable ASCII characters without spaces.');
  }
  return formalSn;
}

function formatDigest(digest) {
  const bytes = new Uint8Array(digest);
  let body = '';
  for (let index = 0; index < 16; index += 1) {
    const bitOffset = index * 5;
    const byteIndex = Math.floor(bitOffset / 8);
    const bitInByte = bitOffset % 8;
    const window = (bytes[byteIndex] << 8) |
      (byteIndex + 1 < 10 ? bytes[byteIndex + 1] : 0);
    body += ALPHABET[(window >> (11 - bitInByte)) & 0x1f];
  }
  const check = ALPHABET[crc5Usb(encoder.encode(`CT1${body}`))];
  return `CT1-${body.slice(0, 4)}-${body.slice(4, 8)}-` +
    `${body.slice(8, 12)}-${body.slice(12, 16)}-${check}`;
}

async function importHmacKey(keyHex, cryptoApi) {
  if (!cryptoApi?.subtle) {
    throw new Error('Web Crypto is unavailable. Open this page over HTTPS.');
  }
  return cryptoApi.subtle.importKey(
    'raw',
    parseKeyHex(keyHex),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function deriveWithImportedKey(formalSn, cryptoKey, cryptoApi) {
  const sn = validateFormalSn(formalSn);
  const label = encoder.encode(LABEL);
  const snBytes = encoder.encode(sn);
  const message = new Uint8Array(label.length + 1 + snBytes.length);
  message.set(label, 0);
  message[label.length] = 0;
  message.set(snBytes, label.length + 1);
  const digest = await cryptoApi.subtle.sign('HMAC', cryptoKey, message);
  return formatDigest(digest);
}

export async function deriveDeviceSerial(formalSn, keyHex,
                                         cryptoApi = globalThis.crypto) {
  const cryptoKey = await importHmacKey(keyHex, cryptoApi);
  return deriveWithImportedKey(formalSn, cryptoKey, cryptoApi);
}

export function normalizeDeviceSerial(input) {
  const compact = String(input).toUpperCase().replace(/[\s-]+/g, '');
  if (compact.length !== 20 || !compact.startsWith('CT1')) {
    throw new Error('Device serial format is invalid.');
  }
  const body = compact.slice(3, 19);
  const suppliedCheck = compact[19];
  if (![...body, suppliedCheck].every((value) => ALPHABET.includes(value))) {
    throw new Error('Device serial contains invalid characters.');
  }
  const expectedCheck = ALPHABET[crc5Usb(encoder.encode(`CT1${body}`))];
  if (suppliedCheck !== expectedCheck) {
    throw new Error('Device serial check digit is invalid.');
  }
  return `CT1-${body.slice(0, 4)}-${body.slice(4, 8)}-` +
    `${body.slice(8, 12)}-${body.slice(12, 16)}-${suppliedCheck}`;
}

function parseCsv(text) {
  const rows = [];
  let cells = [];
  let cell = '';
  let quoted = false;
  let rowNumber = 1;
  let rowStart = 1;

  const appendCharacter = (character) => {
    if (cell.length >= CSV_MAX_CELL_LENGTH) {
      throw new Error(`CSV cell exceeds ${CSV_MAX_CELL_LENGTH} characters.`);
    }
    cell += character;
  };
  const finishCell = () => {
    if (cells.length >= CSV_MAX_COLUMNS) {
      throw new Error(`CSV row exceeds ${CSV_MAX_COLUMNS} columns.`);
    }
    cells.push(cell);
    cell = '';
  };

  for (let index = 0; index <= text.length; index += 1) {
    const character = index < text.length ? text[index] : '\n';
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        appendCharacter('"');
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        appendCharacter(character);
        if (character === '\n') rowNumber += 1;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      finishCell();
    } else if (character === '\r' && text[index + 1] === '\n') {
      continue;
    } else if (character === '\n') {
      finishCell();
      if (cells.some((value) => value.length > 0)) {
        if (rows.length >= CSV_MAX_ROWS) {
          throw new Error(`CSV exceeds ${CSV_MAX_ROWS} rows.`);
        }
        rows.push({ cells, rowNumber: rowStart });
      }
      cells = [];
      cell = '';
      rowNumber += 1;
      rowStart = rowNumber;
    } else {
      appendCharacter(character);
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  return rows;
}

export async function findFormalSnInCsv(csvText, deviceSerial, keyHex,
                                        cryptoApi = globalThis.crypto) {
  const target = normalizeDeviceSerial(deviceSerial);
  const rows = parseCsv(String(csvText));
  if (rows.length === 0) throw new Error('CSV is empty.');
  const header = rows[0].cells.map((value, index) =>
    (index === 0 ? value.replace(/^\ufeff/, '') : value).trim().toLowerCase());
  const snColumn = header.indexOf('sn');
  if (snColumn < 0) throw new Error('CSV must contain an sn column.');

  const cryptoKey = await importHmacKey(keyHex, cryptoApi);
  const matches = [];
  for (const row of rows.slice(1)) {
    const sn = (row.cells[snColumn] ?? '').trim();
    if (!sn) continue;
    try {
      if (await deriveWithImportedKey(sn, cryptoKey, cryptoApi) === target) {
        matches.push({ sn, rowNumber: row.rowNumber });
      }
    } catch (error) {
      if (!/Formal SN/.test(error.message)) throw error;
    }
  }
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error('CSV contains more than one matching SN.');
  }
  return matches[0];
}
