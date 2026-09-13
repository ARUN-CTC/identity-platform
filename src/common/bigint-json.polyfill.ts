// Phase 1 extracted source — copied from TravelOS, classified REUSABLE.
// Node's `bigint` has no native JSON representation — JSON.stringify throws
// "Do not know how to serialize a BigInt" otherwise. The `version` column on
// every audited table maps to bigint, so this needs to be a global fix
// rather than a per-entity one. Serializing as a string (not Number) avoids
// silent precision loss for values beyond Number.MAX_SAFE_INTEGER. Must be
// imported before anything serializes a response — see main.ts.
(BigInt.prototype as unknown as { toJSON(): string }).toJSON = function (this: bigint) {
  return this.toString();
};

export {};
