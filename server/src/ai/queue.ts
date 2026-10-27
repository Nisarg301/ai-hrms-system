import { env } from '../config/env';

interface Waiter {
  start: () => void;
  onQueued?: (ahead: number) => void;
}

/**
 * At most `limit` model calls at once (AI_MAX_CONCURRENT, 1 on a CPU-only machine).
 * Later requests wait in order and hear how many are ahead of them.
 */
export class ModelQueue {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>, onQueued?: (ahead: number) => void, signal?: AbortSignal): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const waiter: Waiter = { start: resolve, onQueued };
        this.waiting.push(waiter);
        onQueued?.(this.waiting.length);
        signal?.addEventListener(
          'abort',
          () => {
            const index = this.waiting.indexOf(waiter);
            if (index >= 0) {
              this.waiting.splice(index, 1);
              this.announce();
              reject(signal.reason ?? new Error('Aborted'));
            }
          },
          { once: true }
        );
      });
    }
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      const next = this.waiting.shift();
      if (next) {
        this.announce();
        next.start();
      }
    }
  }

  private announce(): void {
    this.waiting.forEach((w, i) => w.onQueued?.(i + 1));
  }
}

export const modelQueue = new ModelQueue(env.AI_MAX_CONCURRENT);
