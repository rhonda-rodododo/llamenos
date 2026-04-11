import type { Loggable, Unloggable } from './logger-types'

type Assert<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false
type IsNever<T> = [T] extends [never] ? true : false

type PhoneNumber = string & Unloggable
type Ciphertext = string & Unloggable

// These are compile-time checks; they have no runtime effect.
// If any assertion fails, `bun run typecheck` will fail.
type _1 = Assert<IsNever<Loggable<{ phone: PhoneNumber }>['phone']>>
type _2 = Assert<Equal<Loggable<{ hubId: string }>, { hubId: string }>>
type _3 = Assert<IsNever<Loggable<{ user: { ct: Ciphertext } }>['user']['ct']>>
type _4 = Assert<IsNever<Loggable<PhoneNumber[]>[number]>>

// Suppress "unused type alias" diagnostics
export type { _1, _2, _3, _4 }
