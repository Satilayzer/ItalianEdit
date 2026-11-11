export interface Job {
  name: string;
  intervalMs: number;
  /**
   * Первый запуск через столько после старта (по умолчанию — через intervalMs).
   * Нужен редким задачам: деплой перезапускает процесс, и при интервале в
   * несколько часов задача иначе может не дожить до первого запуска.
   */
  firstRunMs?: number;
  run: () => Promise<void>;
}

/**
 * Простой планировщик: каждая задача по своему интервалу, без наложений
 * (если прошлый запуск ещё идёт — тик пропускается). Ошибка не роняет процесс.
 */
export function startJobs(
  jobs: Job[],
  onError: (jobName: string, err: unknown) => void
): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  for (const job of jobs) {
    let busy = false;
    const tick = async () => {
      if (busy) return;
      busy = true;
      try {
        await job.run();
      } catch (err) {
        onError(job.name, err);
      } finally {
        busy = false;
      }
    };
    const every = () => {
      const timer = setInterval(tick, job.intervalMs);
      timer.unref?.();
      timers.push(timer);
    };
    if (job.firstRunMs === undefined) {
      every();
    } else {
      const first = setTimeout(() => {
        void tick();
        every();
      }, job.firstRunMs);
      first.unref?.();
      timers.push(first);
    }
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
