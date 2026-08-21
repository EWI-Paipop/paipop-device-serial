import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import test from 'node:test';

import {
  crc5Usb,
  deriveDeviceSerial,
  findFormalSnInCsv,
  normalizeDeviceSerial,
} from './serial_core.js';

const key =
  '000102030405060708090A0B0C0D0E0F' +
  '101112131415161718191A1B1C1D1E1F';

test('CRC-5/USB check vector', () => {
  assert.equal(crc5Usb(new TextEncoder().encode('123456789')), 0x19);
});

test('fixed firmware-compatible vectors', async () => {
  const vectors = [
    ['Paipop_TEST_DEVICE_0001', 'CT1-ZYN5-5H8B-718S-AAFB-4'],
    ['A'.repeat(63), 'CT1-6E7G-085J-6GM9-EQ01-E'],
    ['Paipop_caseSensitive_aA01', 'CT1-N9E1-1S5Q-9P8T-108A-8'],
    ['Paipop_caseSensitive_AA01', 'CT1-K59G-CSFV-MBWJ-6Z1P-F'],
  ];
  for (const [sn, expected] of vectors) {
    assert.equal(await deriveDeviceSerial(sn, key, webcrypto), expected);
  }
});

test('normalizes and verifies serial check digit', () => {
  assert.equal(
    normalizeDeviceSerial('ct1 zyn5 5h8b 718s aafb 4'),
    'CT1-ZYN5-5H8B-718S-AAFB-4',
  );
  assert.throws(
    () => normalizeDeviceSerial('CT1-ZYN5-5H8B-718S-AAFB-5'),
    /check digit/i,
  );
});

test('finds exactly one formal SN from a CSV sn column', async () => {
  const csv = [
    'name,sn,note',
    'first,Paipop_caseSensitive_AA01,not it',
    'target,Paipop_TEST_DEVICE_0001,"contains, comma"',
  ].join('\n');
  const match = await findFormalSnInCsv(
    csv,
    'CT1-ZYN5-5H8B-718S-AAFB-4',
    key,
    webcrypto,
  );
  assert.equal(match.sn, 'Paipop_TEST_DEVICE_0001');
  assert.equal(match.rowNumber, 3);
});

test('rejects invalid keys and formal SN values', async () => {
  await assert.rejects(
    deriveDeviceSerial('Paipop_TEST_DEVICE_0001', '0011', webcrypto),
    /64 hexadecimal/i,
  );
  await assert.rejects(
    deriveDeviceSerial('contains space', key, webcrypto),
    /printable ASCII/i,
  );
});
