// Minimal typings for the built-in `bun test` runner, scoped to what our test
// suites use. We intentionally avoid @types/bun because its global fetch/env
// typings conflict with the DOM lib types this app is built against.
declare module "bun:test" {
  export type TestFn = () => void | Promise<void>;

  export function describe(label: string, fn: () => void): void;
  export function test(label: string, fn: TestFn): void;
  export const it: typeof test;
  export function beforeEach(fn: TestFn): void;
  export function afterEach(fn: TestFn): void;

  export interface Matchers {
    not: Matchers;
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeDefined(): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeInstanceOf(expected: abstract new (...args: never[]) => unknown): void;
    toContain(expected: unknown): void;
    toThrow(expected?: string | RegExp | Error): void;
    toBeGreaterThan(expected: number): void;
    toBeLessThan(expected: number): void;
  }

  export function expect(actual: unknown): Matchers;
}
