export interface Job {
  name: string;
  intervalMs: number;
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
  const timers = jobs.map((job) => {
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        await job.run();
      } catch (err) {
        onError(job.name, err);
      } finally {
        busy = false;
      }
    }, job.intervalMs);
    timer.unref?.();
    return timer;
  });
  return () => timers.forEach(clearInterval);
}
