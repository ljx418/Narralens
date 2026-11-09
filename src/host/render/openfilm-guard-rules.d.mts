/**
 * The types of the offline guard's rules.
 *
 * The rules are plain JavaScript, because the worker that installs them is a plain
 * JavaScript program with no build step. This declaration is what lets the tests read
 * them as typed values.
 */

export declare const BLOCKING_FLAGS: readonly string[];

export declare function guardedPageOptions(options?: Record<string, unknown>): Record<string, unknown>;

export declare function guardedContextOptions(options?: Record<string, unknown>): Record<string, unknown>;

export declare function guardedLaunchArgs(args?: readonly string[]): string[];

/** A browser that can make contexts. */
export interface GuardableBrowser {
  newContext(options?: Record<string, unknown>): Promise<Record<string, unknown> | null | undefined>;
  [key: string]: unknown;
}

export declare function guardBrowser<T extends GuardableBrowser>(browser: T): T;
