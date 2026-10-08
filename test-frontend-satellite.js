// Tests for the satellite view under a floor plan (floorPlanGeo, backend v53):
// parsing/formatting the stored placement, the Esri image request, and the
// scale/turn-about-a-point math the Align bar uses. The drawing and the drag
// are browser behaviour and were driven in Chromium against Sandbox.
//
// Run: node test-frontend-satellite.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function grabFn(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i === -1) throw new Error(`${name} not found`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  throw new Error(`${name} not closed`);
}
const constLine = n => { const m = src.match(new RegExp(`const ${n} = [^;]+;`)); if (!m) throw new Error(n); return m[0]; };
const code = [constLine('FLOOR_PLAN_SAT_PX'),
  ...['floorPlanGeoParse', 'floorPlanGeoFormat', 'floorPlanParseLatLng', 'floorPlanSatImage', 'floorPlanGeoTransform'].map(grabFn),
  'return { floorPlanGeoParse, floorPlanGeoFormat, floorPlanParseLatLng, floorPlanSatImage, floorPlanGeoTransform };'].join('\n');
const H = new Function(code)();

let fails = 0;
const ok = (name, cond) => { if (!cond) { fails++; console.log('FAIL', name); } else console.log('ok  ', name); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

ok('blank reads as not aligned', H.floorPlanGeoParse('') === null && H.floorPlanGeoParse(undefined) === null);
ok('garbage reads as not aligned', H.floorPlanGeoParse('1,2,x,4,5,6') === null && H.floorPlanGeoParse('1,2,3') === null);
ok('zero scale reads as not aligned', H.floorPlanGeoParse('35,-120,0,0,0,0') === null);
const g = { lat: 35.4921234, lng: -120.668, mpu: 0.25, deg: -10, ax: 550, ay: 425.5 };
const back = H.floorPlanGeoParse(H.floorPlanGeoFormat(g));
ok('format/parse round-trips', back && near(back.lat, g.lat) && near(back.lng, g.lng) && near(back.mpu, g.mpu) && near(back.ax, g.ax) && near(back.ay, g.ay));
ok('north angle is normalised to 0..360', back && near(back.deg, 350));
ok('Google Maps coordinates parse', (() => { const p = H.floorPlanParseLatLng('35.4921, -120.6680'); return p && near(p.lat, 35.4921) && near(p.lng, -120.668); })());
ok('space-separated coordinates parse', !!H.floorPlanParseLatLng('35.4921 -120.6680'));
ok('out-of-range latitude refused', H.floorPlanParseLatLng('95, 10') === null);

const img = H.floorPlanSatImage(g, 1100);
ok('image request is Esri World Imagery export', /server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Imagery\/MapServer\/export\?bbox=/.test(img.href) && /f=image/.test(img.href));
ok('ground size is a power of two covering 3 plan widths', (() => { const ground = img.size * g.mpu; return Math.log2(ground) % 1 === 0 && ground >= 1100 * 0.25 * 3; })());
ok('a 1% nudge reuses the same image', H.floorPlanSatImage({ ...g, mpu: g.mpu * 1.01 }, 1100).href === img.href);
ok('mercator bbox is centred on the location', (() => {
  const b = img.href.match(/bbox=([^&]+)/)[1].split(',').map(Number);
  const mx = 6378137 * g.lng * Math.PI / 180;
  return near((b[0] + b[2]) / 2, mx, 0.02);
})());
ok('no image without a placement', H.floorPlanSatImage(null, 1100) === null);

const s = H.floorPlanGeoTransform(g, 100, 100, 2, 0);
ok('scaling about a point halves metres-per-unit', near(s.mpu, g.mpu / 2));
ok('scaling about a point moves the anchor away from it', near(s.ax, 100 + (550 - 100) * 2) && near(s.ay, 100 + (425.5 - 100) * 2));
const r = H.floorPlanGeoTransform({ ...g, ax: 10, ay: 0 }, 0, 0, 1, 90);
ok('turning 90° clockwise about the origin moves +x to +y (SVG y-down)', near(r.ax, 0) && near(r.ay, 10) && near(r.deg, 80));
const fixed = H.floorPlanGeoTransform(g, g.ax, g.ay, 3, 30);
ok('the pivot point itself stays put', near(fixed.ax, g.ax) && near(fixed.ay, g.ay));

if (fails) { console.log(`\n${fails} failed`); process.exit(1); }
console.log('\nall passed');
