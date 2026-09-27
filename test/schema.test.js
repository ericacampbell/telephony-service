import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBrief, fallbackBrief, briefSchema } from '../src/brief/schema.js';

const golden = {
  caller: { name: 'Priya Raman', phone: null, account_ref: '4192' },
  reason: 'Double charged £240 on her September bill; promised refund never arrived.',
  already_tried: ['Called last Tuesday', 'Agent re-raised the failed refund'],
  promises: [{ what: 'Refund to land before her direct debit', by_when: 'the 15th' }],
  sentiment: { label: 'frustrated', confidence: 0.82 },
  risk_flags: ['churn', 'payment_dispute'],
  first_line: "Hi Priya — I've got the duplicate charge in front of me and I know the refund failed.",
  confidence: 0.78,
  unknowns: ['Whether the direct debit can be paused as a backstop'],
};

test('golden brief validates', () => {
  assert.deepEqual(validateBrief(golden), { valid: true, errors: [] });
});

test('the fallback brief validates', () => {
  assert.equal(validateBrief(fallbackBrief()).valid, true);
});

test('every required key is actually required', () => {
  for (const key of briefSchema.required) {
    const { [key]: _omitted, ...missing } = golden;
    const { valid } = validateBrief(missing);
    assert.equal(valid, false, `${key} should be required`);
  }
});

test('rejects invented extra fields and bad enums', () => {
  assert.equal(validateBrief({ ...golden, surprise: true }).valid, false);
  assert.equal(
    validateBrief({ ...golden, sentiment: { label: 'furious', confidence: 1 } }).valid,
    false,
  );
  assert.equal(validateBrief({ ...golden, risk_flags: ['vibes'] }).valid, false);
});

test('unknowns are expressed as null, not omitted', () => {
  const nulled = { ...golden, caller: { name: null, phone: null, account_ref: null } };
  assert.equal(validateBrief(nulled).valid, true);
  assert.equal(validateBrief({ ...golden, caller: { name: 'x' } }).valid, false);
});
