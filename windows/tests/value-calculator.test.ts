import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateRemaining, extractRenewalHint, formatMoney, parseValue, remainingEstimate} from '../electron/value-calculator';

test('renewal boundaries remain anchored to expiry through month-end and leap year',()=>{
  const result=remainingEstimate('31',1,'2024-01-31','2024-03-31');
  assert.equal(result.fullCycles,1);assert.equal(result.partialCycleDays,29);assert.equal(result.partialDays,29);
  assert.equal(result.days,60);assert.equal(result.amount.toString(),'62');
  const annual=remainingEstimate('366',12,'2023-03-01','2024-02-29');
  assert.equal(annual.partialCycleDays,366);assert.equal(annual.partialDays,365);assert.equal(annual.amount.toString(),'365');
});
test('remaining value uses calendar days, decimal arithmetic and currency rounding',()=>{
  assert.equal(calculateRemaining({amount:'0.1',currency:'USD',periodMonths:1,expiresAt:'2024-03-31',now:'2024-03-01'}).value,'0.10');
  const result=calculateRemaining({amount:'31',currency:'USD',periodMonths:1,expiresAt:'2024-02-29',now:'2024-02-28',targetCurrency:'JPY',exchangeRate:'150.5',askingPrice:'180'});
  assert.equal(result.value,'1.00');assert.equal(result.convertedValue,'151');assert.equal(result.premium,'30');
  assert.equal(formatMoney('1.005','USD'),'1.01');
  assert.equal(calculateRemaining({amount:'31',currency:'EUR',periodMonths:1,expiresAt:'2024-03-31',now:'2024-03-30',targetCurrency:'CNY',exchangeRate:'7.37940123456789'}).convertedValue,'7.38');
  assert.equal(calculateRemaining({amount:'123',currency:'CNY',periodMonths:1,expiresAt:'2024-01-01',now:'2024-01-01'}).value,'0.00');
});
test('amount and dates reject ambiguous or invalid inputs',()=>{
  assert.equal(parseValue('1,234.123456789012').toString(),'1234.123456789012');
  for(const amount of ['-1','1e6','1,23','NaN','0.1234567890123'])assert.throws(()=>parseValue(amount));
  assert.throws(()=>remainingEstimate('1',2,'2024-01-01','2024-02-01'));
  assert.throws(()=>remainingEstimate('1',1,'2024-02-30','2024-03-01'));
});
test('title prefill requires explicit currency and unambiguous renewal cadence',()=>{
  assert.deepEqual(extractRenewalHint('出 VPS USD 12/year'),{amount:'12',currency:'USD',periodMonths:12});
  assert.deepEqual(extractRenewalHint('12 美元 年付'),{amount:'12',currency:'USD',periodMonths:12});
  assert.deepEqual(extractRenewalHint('HK$ 18季付'),{amount:'18',currency:'HKD',periodMonths:3});
  assert.equal(extractRenewalHint('出 VPS 100元，售价 100'),undefined);
  assert.equal(extractRenewalHint('USD 12/year 或 USD 24/year'),undefined);
});
