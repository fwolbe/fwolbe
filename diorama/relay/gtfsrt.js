// Minimal GTFS-Realtime decoder: just the vehicle positions, read straight from the protobuf
// wire format (no protobuf library, so it runs anywhere, including Cloudflare Workers).
//
// FeedMessage { 1 header, 2 entity* }
// FeedEntity  { 1 id, 4 vehicle }
// VehiclePosition { 1 trip, 2 position, 5 timestamp, 8 vehicle }
// TripDescriptor { 1 trip_id, 5 route_id, 6 direction_id }
// Position { 1 latitude f32, 2 longitude f32, 3 bearing f32, 5 speed f32 }
// VehicleDescriptor { 1 id, 2 label }

function reader(buf, start = 0, end = buf.length) {
  let p = start;
  const varint = () => {
    let v = 0, mul = 1, b;
    do { b = buf[p++]; v += (b & 0x7f) * mul; mul *= 128; } while (b & 0x80);
    return v;
  };
  return {
    more: () => p < end,
    tag() { const t = varint(); return [Math.floor(t / 8), t & 7]; },
    varint,
    bytes() { const n = varint(); const s = p; p += n; return [s, p]; },
    f32() { const v = new DataView(buf.buffer, buf.byteOffset + p, 4).getFloat32(0, true); p += 4; return v; },
    skip(w) { if (w === 0) varint(); else if (w === 1) p += 8; else if (w === 2) { const n = varint(); p += n; } else if (w === 5) p += 4; else throw new Error('wire ' + w); },
  };
}
const text = (buf, [s, e]) => new TextDecoder().decode(buf.subarray(s, e));

const WIRE = { varint: 0, f32: 5, str: 2, msg: 2 };
function message(buf, range, fields) {
  const r = reader(buf, range[0], range[1]), out = {};
  while (r.more()) {
    const [f, w] = r.tag(), spec = fields[f];
    if (!spec || w !== WIRE[spec.t]) { r.skip(w); continue; }
    if (spec.t === 'varint') out[spec.name] = r.varint();
    else if (spec.t === 'f32') out[spec.name] = r.f32();
    else if (spec.t === 'str') out[spec.name] = text(buf, r.bytes());
    else { const v = message(buf, r.bytes(), spec.fields); if (spec.many) (out[spec.name] ||= []).push(v); else out[spec.name] = v; }
  }
  return out;
}

const F32 = (name) => ({ t: 'f32', name });
const POSITION = { 1: F32('lat'), 2: F32('lon'), 3: F32('bearing'), 5: F32('speed') };
const TRIP = { 1: { t: 'str', name: 'tripId' }, 5: { t: 'str', name: 'routeId' }, 6: { t: 'varint', name: 'direction' } };
const VEH = { 1: { t: 'str', name: 'id' }, 2: { t: 'str', name: 'label' } };
const VP = { 1: { t: 'msg', name: 'trip', fields: TRIP }, 2: { t: 'msg', name: 'position', fields: POSITION }, 5: { t: 'varint', name: 'timestamp' }, 8: { t: 'msg', name: 'vehicle', fields: VEH } };
const ENTITY = { 1: { t: 'str', name: 'id' }, 4: { t: 'msg', name: 'vehicle', fields: VP } };
const FEED = { 2: { t: 'msg', name: 'entity', many: true, fields: ENTITY } };

export function decodeVehiclePositions(bytes) {
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const feed = message(buf, [0, buf.length], FEED);
  const out = [];
  for (const e of feed.entity || []) {
    const v = e.vehicle, p = v && v.position;
    if (!p || p.lat == null || p.lon == null) continue;
    out.push({
      id: (v.vehicle && v.vehicle.id) || e.id, label: v.vehicle && v.vehicle.label,
      lat: p.lat, lon: p.lon, bearing: p.bearing ?? null, speed: p.speed ?? null,
      route: v.trip && v.trip.routeId, trip: v.trip && v.trip.tripId, direction: v.trip && v.trip.direction, ts: v.timestamp ?? null,
    });
  }
  return out;
}
