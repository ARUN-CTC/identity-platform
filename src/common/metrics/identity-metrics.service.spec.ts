import { IdentityMetrics } from './identity-metrics.service';

describe('IdentityMetrics (Phase 2D.9)', () => {
  it('increments a counter from zero', () => {
    const metrics = new IdentityMetrics();
    metrics.increment('some_counter');
    metrics.increment('some_counter');
    metrics.increment('some_counter');
    expect(metrics.snapshotCounters()['some_counter']).toBe(3);
  });

  it('tracks distinct counter names independently', () => {
    const metrics = new IdentityMetrics();
    metrics.increment('counter_a');
    metrics.increment('counter_b');
    metrics.increment('counter_b');
    const snapshot = metrics.snapshotCounters();
    expect(snapshot['counter_a']).toBe(1);
    expect(snapshot['counter_b']).toBe(2);
  });

  it('records duration samples and returns them via snapshotDurations', () => {
    const metrics = new IdentityMetrics();
    metrics.recordDuration('op_latency', 12);
    metrics.recordDuration('op_latency', 34);
    expect(metrics.snapshotDurations('op_latency')).toEqual([12, 34]);
  });

  it('returns an empty array for a duration name with no recorded samples', () => {
    const metrics = new IdentityMetrics();
    expect(metrics.snapshotDurations('never_recorded')).toEqual([]);
  });

  it('bounds the duration sample buffer (never grows unbounded)', () => {
    const metrics = new IdentityMetrics();
    for (let i = 0; i < 1005; i++) {
      metrics.recordDuration('bounded', i);
    }
    expect(metrics.snapshotDurations('bounded').length).toBeLessThanOrEqual(1000);
  });

  it('snapshotCounters returns an immutable-in-spirit plain object, not a live Map reference', () => {
    const metrics = new IdentityMetrics();
    metrics.increment('x');
    const snapshot = metrics.snapshotCounters();
    metrics.increment('x');
    expect(snapshot['x']).toBe(1); // the earlier snapshot is unaffected by a later increment
    expect(metrics.snapshotCounters()['x']).toBe(2);
  });
});
