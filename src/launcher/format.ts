/** How the console writes times. */

/** "11 OCT 2026, 21:04" */
export function stamp(timestamp: number, withTime = true): string {
  const options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' };
  if (withTime) Object.assign(options, { hour: '2-digit', minute: '2-digit', hour12: false });
  return new Date(timestamp).toLocaleString(undefined, options).toUpperCase();
}

/** "JUST NOW", "12 MIN AGO", "3 HOURS AGO", "2 DAYS AGO", then the date. */
export function ago(timestamp: number, now = Date.now()): string {
  const minutes = Math.floor((now - timestamp) / 60_000);
  if (minutes < 1) return 'JUST NOW';
  if (minutes < 60) return `${minutes} MIN AGO`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'HOUR' : 'HOURS'} AGO`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? 'DAY' : 'DAYS'} AGO`;
  return stamp(timestamp, false);
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
