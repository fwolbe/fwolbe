// Keeps buses on the street network. A reported position is matched to a street, preferring
// streets that line up with the bus's heading and the street it was already on; between reports
// a bus drives on along that street, and through a junction only onto the street that carries
// the same name. Where the name stops, it waits for the next report instead of guessing a turn.

export const BUS_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
const MATCH_M = 15;

export function makeBusNet(graph) {
  const edges = graph.edges.filter(e => BUS_ROADS.has(e.k));
  for (const e of edges) {
    const cum = [0];
    for (let k = 1; k < e.pts.length; k++) cum.push(cum[k - 1] + Math.hypot(e.pts[k][0] - e.pts[k - 1][0], e.pts[k][1] - e.pts[k - 1][1]));
    e.cum = cum; e.len = cum[cum.length - 1];
  }

  // hx, hz: heading (any length, 0 if unknown); prev: the bus's last match, if any
  function match(x, z, hx, hz, prev) {
    const hl = Math.hypot(hx, hz);
    let best = null, bc = Infinity;
    for (const e of edges) for (let k = 1; k < e.pts.length; k++) {
      const a = e.pts[k - 1], b = e.pts[k], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1, l = Math.sqrt(l2);
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2));
      const dist = Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z);
      if (dist > MATCH_M) continue;
      // a street at right angles to the bus's heading costs up to 8 m extra; leaving the street
      // it was on costs 5 m: positions near a junction then stay on the street the bus follows
      const align = hl ? Math.abs(hx * dx + hz * dz) / (hl * l) : 1;
      const stay = prev && prev.e.name && e.name !== prev.e.name ? 5 : 0;
      const cost = dist + (1 - align) * 8 + stay;
      if (cost < bc) {
        bc = cost;
        const along = hx * dx + hz * dz;
        best = { e, d: e.cum[k - 1] + t * l, dir: hl ? Math.sign(along) || 1 : 0, dist };
      }
    }
    return best;
  }

  function pointAt(e, d) {
    d = Math.max(0, Math.min(e.len, d));
    let k = 1; while (k < e.pts.length - 1 && e.cum[k] < d) k++;
    const a = e.pts[k - 1], b = e.pts[k], seg = e.cum[k] - e.cum[k - 1] || 1, t = (d - e.cum[k - 1]) / seg;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])];
  }

  // drive dist metres on from pos = { e, d, dir }
  function advance(pos, dist) {
    let { e, d, dir } = pos;
    if (!dir) return pos;
    let left = dist;
    for (let hop = 0; hop < 12; hop++) {
      const room = dir > 0 ? e.len - d : d;
      if (left <= room) return { e, d: d + dir * left, dir };
      left -= room;
      const node = dir > 0 ? e.b : e.a;
      const next = node.out.filter(o => o.e !== e && o.e.cum && (e.name ? o.e.name === e.name : true));
      // continue only where the street unambiguously goes on
      if (next.length !== 1) return { e, d: dir > 0 ? e.len : 0, dir, waiting: true };
      e = next[0].e; dir = next[0].dir; d = dir > 0 ? 0 : e.len;
    }
    return { e, d, dir };
  }

  return { edges, match, pointAt, advance };
}
