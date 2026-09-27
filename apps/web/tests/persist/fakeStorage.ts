/**
 * An in-memory `localStorage` for the persistence tests, with failure injection (PLAN §14.9):
 * a quota, errors thrown by every call or only by writes, and a storage that "dies" after the
 * k-th successful `setItem` (crash injection).
 */
import type { StorageBackend } from '../../src/persist/storage.ts';

export const quotaError = (): DOMException =>
  new DOMException('The quota has been exceeded.', 'QuotaExceededError');
export const securityError = (): DOMException =>
  new DOMException('The operation is insecure.', 'SecurityError');

export class FakeStorage implements StorageBackend {
  readonly data = new Map<string, string>();
  /** Thrown by every call (e.g. a SecurityError: site data blocked). */
  failAll: Error | null = null;
  /** Thrown by setItem only (e.g. a private mode that allows no writes). */
  failWrites: Error | null = null;
  /** Characters (keys + values) the storage holds; beyond it setItem throws QuotaExceededError. */
  quota = Number.POSITIVE_INFINITY;
  /** After this many successful setItem calls every call throws: the tab "dies" mid-protocol. */
  dieAfterWrites = Number.POSITIVE_INFINITY;
  /** Successful setItem calls so far. */
  writes = 0;
  /** Every setItem call, successful or not, in order. */
  readonly writeLog: string[] = [];

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, value);
  }

  private guard(): void {
    if (this.failAll !== null) throw this.failAll;
    if (this.writes >= this.dieAfterWrites) throw new Error('the storage died');
  }

  /** Characters in use, counting keys and values like browsers do. */
  used(): number {
    let n = 0;
    for (const [key, value] of this.data) n += key.length + value.length;
    return n;
  }

  getItem(key: string): string | null {
    this.guard();
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writeLog.push(key);
    this.guard();
    if (this.failWrites !== null) throw this.failWrites;
    const old = this.data.get(key);
    const after = this.used() - (old === undefined ? 0 : key.length + old.length);
    if (after + key.length + value.length > this.quota) throw quotaError();
    this.data.set(key, value);
    this.writes++;
  }

  removeItem(key: string): void {
    this.guard();
    this.data.delete(key);
  }
}
