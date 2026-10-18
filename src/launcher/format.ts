/** How the console writes times. */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const two = (value: number) => String(value).padStart(2, '0');

/**
 * "11 OCT 2026, 21:04", in the time of the place the console stands in. Set
 * the way the games write their own dates ("25 JUL 2241"), wherever that is:
 * the two are shown side by side.
 */
export function stamp(timestamp: number, withTime = true): string {
  const date = new Date(timestamp);
  const day = `${two(date.getDate())} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return withTime ? `${day}, ${two(date.getHours())}:${two(date.getMinutes())}` : day;
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

const EXPORTED_TO = { dropbox: 'TO DROPBOX', drive: 'TO GOOGLE DRIVE', zip: 'TO A ZIP FILE' } as const;

/** When a game's saves were last exported, and where to: "2 DAYS AGO, TO DROPBOX", or "NEVER". */
export function exportedState(mark: { at: number; to: keyof typeof EXPORTED_TO } | null): string {
  return mark ? `${ago(mark.at)}, ${EXPORTED_TO[mark.to]}` : 'NEVER';
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
