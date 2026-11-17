/** The plan's local date; a zone Intl rejects falls back to UTC instead of failing the request. */
export function todayIn(timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone ?? "UTC" }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}
