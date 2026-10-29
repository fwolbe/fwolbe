// The outline of the board: a square or a round plate centred on home.
export function makePlate(shape, r) {
  const round = shape === 'round';
  const inside = round
    ? (x, z, m = 0) => x * x + z * z <= (r - m) * (r - m)
    : (x, z, m = 0) => Math.abs(x) <= r - m && Math.abs(z) <= r - m;
  // counter-clockwise seen from above (x east, z south), so edge normals point outward
  let poly;
  if (round) {
    const n = Math.max(48, Math.round(r * 0.9));
    poly = [];
    for (let i = 0; i < n; i++) { const a = -i / n * Math.PI * 2; poly.push([Math.cos(a) * r, Math.sin(a) * r]); }
  } else {
    poly = [[r, r], [r, -r], [-r, -r], [-r, r]];
  }
  // half-planes nx*x + nz*z <= d, one per edge
  const planes = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    let nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const l = Math.hypot(nx, nz); nx /= l; nz /= l;
    if (nx * (a[0] + b[0]) / 2 + nz * (a[1] + b[1]) / 2 < 0) { nx = -nx; nz = -nz; }
    return [nx, nz, nx * a[0] + nz * a[1]];
  });
  return { shape, r, round, inside, poly, planes, front: r };
}
