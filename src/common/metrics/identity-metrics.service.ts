import { Injectable } from '@nestjs/common';

/**
 * Phase 2D.9 (docs/OAUTH_OPERATIONAL_HARDENING.md §Metrics abstraction) — a
 * small, in-process metrics abstraction. Never forces a concrete
 * monitoring vendor (brief §8) — this is the seam a production deployment
 * wires a real exporter (Prometheus, StatsD, CloudWatch, ...) behind;
 * nothing in this codebase depends on any specific one. Counters are kept
 * in-memory here purely so this phase's own tests can assert on them
 * (`snapshot()`) without standing up any external system.
 *
 * Labels are deliberately bounded and low-cardinality (brief §8 — "do not
 * introduce high-cardinality labels such as user_id, email, access_token,
 * authorization_code, nonce, raw IP"): every counter name here is a fixed,
 * enumerable string; no caller may pass a label at all, let alone an
 * unbounded one — this is enforced structurally by `increment()`'s own
 * signature (a single `name: string`, no label map).
 */
@Injectable()
export class IdentityMetrics {
  private readonly counters = new Map<string, number>();
  private readonly durationsMs = new Map<string, number[]>();

  increment(name: string): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
  }

  recordDuration(name: string, durationMs: number): void {
    const list = this.durationsMs.get(name) ?? [];
    list.push(durationMs);
    // Bounded retention — this is an in-process sample buffer for basic
    // observability, not a durable time series; never grows unbounded.
    if (list.length > 1000) {
      list.shift();
    }
    this.durationsMs.set(name, list);
  }

  /** Test/diagnostic use only — an immutable snapshot of every counter recorded so far. */
  snapshotCounters(): Readonly<Record<string, number>> {
    return Object.fromEntries(this.counters);
  }

  /** Test/diagnostic use only — the recorded duration samples (milliseconds) for one named measurement. */
  snapshotDurations(name: string): readonly number[] {
    return this.durationsMs.get(name) ?? [];
  }
}
