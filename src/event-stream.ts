import type {
  AssistantMessageEvent,
  AssistantMessageEventStreamLike,
  AssistantMessageLike,
} from "./types.js";

/**
 * Robust, zero-dependency async event stream implementation.
 * Satisfies Pi and OMP AssistantMessageEventStream interface.
 */
export class AssistantMessageEventStream implements AssistantMessageEventStreamLike {
  private queue: AssistantMessageEvent[] = [];
  private queueHead = 0;
  private waiting: Array<{
    resolve: (value: IteratorResult<AssistantMessageEvent>) => void;
    reject: (err: unknown) => void;
  }> = [];
  private done = false;
  private resultSettled = false;

  private resolveFinalResult!: (result: AssistantMessageLike) => void;
  private rejectFinalResult!: (err: unknown) => void;
  readonly finalResultPromise: Promise<AssistantMessageLike>;

  constructor() {
    const { promise, resolve, reject } = Promise.withResolvers<AssistantMessageLike>();
    this.resolveFinalResult = resolve;
    this.rejectFinalResult = reject;
    this.finalResultPromise = promise;
    // Prevent unhandled rejections if no one explicitly awaits result()
    this.finalResultPromise.catch(() => {});
  }

  push(event: AssistantMessageEvent): void {
    if (this.done) return;

    if (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter.resolve({ value: event, done: false });
    } else {
      this.queue.push(event);
    }

    if (event.type === "done" && !this.resultSettled) {
      this.done = true;
      this.resultSettled = true;
      this.resolveFinalResult(event.message);
    } else if (event.type === "error" && !this.resultSettled) {
      this.done = true;
      this.resultSettled = true;
      this.resolveFinalResult(event.error);
    }
  }

  end(result?: AssistantMessageLike): void {
    if (this.done) return;
    this.done = true;

    if (result !== undefined && !this.resultSettled) {
      this.resultSettled = true;
      this.resolveFinalResult(result);
    } else if (!this.resultSettled) {
      this.resultSettled = true;
      this.rejectFinalResult(new Error("Stream ended without a final result"));
    }

    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()!;
      waiter.resolve({ value: undefined as unknown as AssistantMessageEvent, done: true });
    }
  }

  result(): Promise<AssistantMessageLike> {
    return this.finalResultPromise;
  }

  [Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    return {
      next: (): Promise<IteratorResult<AssistantMessageEvent>> => {
        if (this.queueHead < this.queue.length) {
          const value = this.queue[this.queueHead++];
          // Periodically compact queue
          if (this.queueHead > 64 && this.queueHead === this.queue.length) {
            this.queue = [];
            this.queueHead = 0;
          }
          return Promise.resolve({ value, done: false });
        }

        if (this.done) {
          return Promise.resolve({ value: undefined as unknown as AssistantMessageEvent, done: true });
        }

        const { promise, resolve, reject } = Promise.withResolvers<IteratorResult<AssistantMessageEvent>>();
        this.waiting.push({ resolve, reject });
        return promise;
      },
    };
  }
}

export function createAssistantMessageEventStream(): AssistantMessageEventStreamLike {
  return new AssistantMessageEventStream();
}
