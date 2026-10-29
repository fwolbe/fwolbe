// Clock helpers pinned to Jönköping time, whatever the viewer's own time zone is.
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Stockholm', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
function parts(d) {
  const o = {}; for (const p of fmt.formatToParts(d)) o[p.type] = Number(p.value);
  return o;
}
export function offsetMin(d) {
  const p = parts(d);
  return (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 6e4;
}
export function local(d) { const p = parts(d); return { h: p.hour, m: p.minute, y: p.year, mo: p.month, d: p.day, dow: new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() }; }
export function atLocal(d, h, m) {
  const p = parts(d);
  const guess = new Date(Date.UTC(p.year, p.month - 1, p.day, h, m));
  return new Date(guess.getTime() - offsetMin(guess) * 6e4);
}
export function midnight(d) { return atLocal(d, 0, 0); }
export const hm = (d) => { const l = local(d); return `${String(l.h).padStart(2, '0')}:${String(l.m).padStart(2, '0')}`; };
