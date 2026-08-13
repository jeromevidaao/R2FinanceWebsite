/**
 * Node 22+ --experimental-strip-types unit tests for sister pairs +
 * transfer approve-net-zero rule.
 * Run: npm test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  canApproveInboxSelectionWith,
  findSisterPairsWith,
  type SisterTxnAccessors,
} from './sisterPairs.ts';

type FakeTxn = {
  id: string;
  amount: number;
  date: string;
  transferTxnId?: string | null;
  altId?: string | null;
  isTransfer?: boolean;
};

const FAKE_ACC: SisterTxnAccessors<FakeTxn> = {
  id: (t) => t.id,
  altIds: (t) => [t.altId],
  amount: (t) => t.amount,
  date: (t) => t.date,
  transferTransactionId: (t) => t.transferTxnId,
};

function canApprove(items: FakeTxn[]): boolean {
  return canApproveInboxSelectionWith(
    items,
    FAKE_ACC,
    (t) => !!t.isTransfer || !!t.transferTxnId,
  );
}

describe('canApproveInboxSelection', () => {
  it('allows regular spend with any net', () => {
    assert.equal(
      canApprove([
        { id: 'coffee', amount: -4_500, date: '2026-08-01' },
        { id: 'lunch', amount: -18_000, date: '2026-08-01' },
      ]),
      true,
    );
  });

  it('allows a sister pair (CC payment + transfer) that nets to 0', () => {
    assert.equal(
      canApprove([
        { id: 'pay', amount: -239_350, date: '2026-08-01' },
        { id: 'xfer', amount: 239_350, date: '2026-08-01', isTransfer: true },
      ]),
      true,
    );
  });

  it('allows sister pair plus unrelated spend', () => {
    assert.equal(
      canApprove([
        { id: 'pay', amount: -239_350, date: '2026-08-01' },
        { id: 'xfer', amount: 239_350, date: '2026-08-01', isTransfer: true },
        { id: 'coffee', amount: -4_500, date: '2026-08-01' },
      ]),
      true,
    );
  });

  it('blocks a lone non-zero transfer', () => {
    assert.equal(
      canApprove([
        { id: 'xfer', amount: 239_350, date: '2026-08-01', isTransfer: true },
      ]),
      false,
    );
  });

  it('blocks spend plus an unpaired transfer', () => {
    assert.equal(
      canApprove([
        { id: 'coffee', amount: -4_500, date: '2026-08-01' },
        { id: 'xfer', amount: 239_350, date: '2026-08-01', isTransfer: true },
      ]),
      false,
    );
  });

  it('allows two unpaired transfers that themselves net to 0', () => {
    // Far apart so they are not sister-paired, but still cancel.
    assert.equal(
      canApprove([
        { id: 'a', amount: 50_000, date: '2026-01-01', isTransfer: true },
        { id: 'b', amount: -50_000, date: '2026-08-01', isTransfer: true },
      ]),
      true,
    );
    const pairs = findSisterPairsWith(
      [
        { id: 'a', amount: 50_000, date: '2026-01-01', isTransfer: true },
        { id: 'b', amount: -50_000, date: '2026-08-01', isTransfer: true },
      ],
      FAKE_ACC,
    );
    assert.equal(pairs.pairs.length, 0);
  });

  it('allows an empty selection', () => {
    assert.equal(canApprove([]), true);
  });
});
