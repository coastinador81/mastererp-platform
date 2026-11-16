import test from 'node:test';
import assert from 'node:assert/strict';
import {formatPagoMovilClipboard,formatTransferClipboard,normalizeVenezuelanPhone,parseVenezuelanDocument,VENEZUELAN_BANKS} from './venezuelan-banks.mjs';

test('the Venezuelan bank catalog has unique four-digit codes',()=>{
  assert.ok(VENEZUELAN_BANKS.length>20);
  assert.equal(new Set(VENEZUELAN_BANKS.map(bank=>bank.code)).size,VENEZUELAN_BANKS.length);
  assert.ok(VENEZUELAN_BANKS.every(bank=>/^\d{4}$/.test(bank.code)&&bank.name));
});

test('payment data uses the banking paste format from the previous storefront',()=>{
  assert.equal(formatPagoMovilClipboard({bankCode:'0102',phone:'0412-7041412',document:'J-412510550',amount:123.4}),'0102\nJ412510550\n04127041412\n123.40');
  assert.equal(formatTransferClipboard({accountNumber:'0102 0100 1210 0005 569',document:'J-412510550',amount:123.4}),'0102010012100005569\nJ412510550\n123.40');
});

test('invalid recipient data never produces a banking paste payload',()=>{
  assert.equal(formatPagoMovilClipboard({bankCode:'102',phone:'123',document:'x',amount:10}),null);
  assert.equal(formatTransferClipboard({accountNumber:'12',document:'x',amount:10}),null);
  assert.deepEqual(parseVenezuelanDocument('V12345678'),{type:'V',number:'12345678',display:'V-12345678'});
  assert.equal(normalizeVenezuelanPhone('+58 412 7041412'),'04127041412');
});
