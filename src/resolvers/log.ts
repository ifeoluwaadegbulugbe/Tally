// Logging helper. Logs resolver names, IDs and error types only: never quote text,
// titles or customer data (blueprint H9).
/** One line per resolver call: name, outcome code and duration. No payload content. */
export function logCall(name: string, outcome: string, ms: number, extra: Record<string, number> = {}): void {
  console.log(JSON.stringify({ level: 'info', call: name, outcome, ms, ...extra }));
}

export function logError(where: string, err: unknown): void {
  const kind = err instanceof Error ? err.name : typeof err;
  const message = err instanceof Error ? err.message.slice(0, 200) : '';
  console.error(JSON.stringify({ level: 'error', where, kind, message }));
}
