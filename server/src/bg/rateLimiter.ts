/**
 * Token bucket: не больше `capacity` запросов за `intervalMs`.
 * Для BrandsGateway лимит 60/мин — берём с запасом 50/мин.
 *
 * Часы инъектируются (`now`) — так модуль детерминированно тестируется без реального времени.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly refillPerMs: number;

  constructor(
    private readonly capacity = 50,
    private readonly intervalMs = 60_000,
    private readonly now: () => number = () => Date.now(),
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms))
  ) {
    this.tokens = capacity;
    this.lastRefill = now();
    this.refillPerMs = capacity / intervalMs;
  }

  private refill(): void {
    const t = this.now();
    const elapsed = t - this.lastRefill;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.lastRefill = t;
    }
  }

  /** Сколько мс ждать до появления одного токена (0 — если можно прямо сейчас). */
  msUntilToken(): number {
    this.refill();
    if (this.tokens >= 1) return 0;
    return Math.ceil((1 - this.tokens) / this.refillPerMs);
  }

  /** Ждёт своей очереди и списывает один токен. */
  async acquire(): Promise<void> {
    const wait = this.msUntilToken();
    if (wait > 0) await this.sleep(wait);
    this.refill();
    this.tokens -= 1;
  }
}
