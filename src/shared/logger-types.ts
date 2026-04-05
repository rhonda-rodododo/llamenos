/**
 * Type-level gate preventing PII/ciphertext from being passed to logger helpers.
 *
 * Branded types in `crypto-types.ts` and `types.ts` (Ciphertext, PhoneNumber, etc.)
 * are marked with `Unloggable` so the compiler rejects `log.info('msg', { nsec })`.
 *
 * Plain string/number/boolean/null/undefined are always Loggable.
 * Records and arrays are Loggable if all leaves are Loggable.
 */

/** Marker brand for types that must never appear in logs. */
export type Unloggable = { readonly __unloggable: true }

/**
 * Recursively checks that T contains no `Unloggable`-branded values.
 * If any property's type extends `Unloggable`, the whole type fails.
 */
export type Loggable<T> = T extends Unloggable
  ? never
  : T extends string | number | boolean | null | undefined | Date | Error
    ? T
    : T extends ReadonlyArray<infer U>
      ? ReadonlyArray<Loggable<U>>
      : T extends object
        ? { [K in keyof T]: Loggable<T[K]> }
        : T

/** Typed `extra` argument accepted by every logger method. */
export type LogExtra = Loggable<Record<string, unknown>>
