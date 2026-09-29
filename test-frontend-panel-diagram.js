// Panel diagram at half-slot precision: panelDiagramLayout (2026-09-29).
//
// Runs the REAL layout function sliced out of index.html, and pins the verbatim
// copy panel.html carries to it. The thing being protected is a breaker whose
// cells are NOT contiguous (1a+3b): it must draw as pieces joined by a labelled
// bar on the side of its column facing the panel's centre, with the breakers it
// sandwiches laid out -- and labelled -- in the space that is left.
//
// Run: node test-frontend-panel-diagram.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const panelHtml = fs.readFileSync(path.join(__dirname, 'panel.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const NL = src.includes('\r\n') ? '\r\n' : '\n';
function slice(text, decl, nl, indent) {
  const start = text.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found');
  const close = nl + (indent || '') + '}' + nl;
  const end = text.indexOf(close, start);
  return text.slice(start, end + close.length - nl.length);
}
const fnSrc = slice(src, 'function panelDiagramLayout(breakers, slotCount, columns, rowGapPx) {', NL);
const layout = new Function(fnSrc + '\nreturn panelDiagramLayout;')();

const B = (id, cells, groupId) => ({ id, cells, groupId: groupId || 'g-' + id });
const find = (cells, pred) => cells.find(pred);
const items = (cell, type) => cell.items.filter(i => i.type === type);

// --- ordinary breakers are unchanged -------------------------------------------
{
  const cells = layout([B('s1', ['1a', '1b']), B('d2', ['2a', '2b', '4a', '4b'])], 6, 2);
  const one = find(cells, c => c.slot === 1);
  check('a single-pole is a plain "breaker" cell over its one row', one.kind === 'breaker' && one.row === 1 && one.rowSpan === 1);
  const two = find(cells, c => c.slot === 2);
  check('a double-pole on 2/4 is one breaker spanning two rows in the even column', two.kind === 'breaker' && two.col === 1 && two.rowSpan === 2);
  check('untouched slots are whole-slot spares', [3, 5, 6].every(s => find(cells, c => c.kind === 'spare' && c.slot === s)));
  check('no spare is emitted for a row a breaker occupies', !find(cells, c => c.kind === 'spare' && c.slot === 4));
}

// --- the non-contiguous case, odd column ---------------------------------------
{
  const cells = layout([B('outer', ['1a', '3b'], 'g'), B('in1', ['1b'], 'g'), B('in3', ['3a'], 'g')], 4, 2);
  const cl = find(cells, c => c.slot === 1);
  check('a unit with a non-contiguous breaker is a "cluster"', cl && cl.kind === 'cluster');
  const bar = items(cl, 'bar');
  check('...with exactly one bar, for the non-contiguous breaker', bar.length === 1 && bar[0].breaker.id === 'outer');
  check('on the ODD side the bar is to the RIGHT of the breakers (toward the centre)',
    cl.colTemplate === 'minmax(0, 1fr) 52px' && bar[0].gridColumn === 2 && !cl.barsLeft, cl.colTemplate);
  const pieces = items(cl, 'piece');
  check('the breaker\'s own cells are pieces spanning the main track AND its bar\'s track (no seam)',
    pieces.length === 2 && pieces.every(p => p.gridColumn === '1 / 3' && p.breaker.id === 'outer'));
  check('the bar is drawn AFTER its pieces, so it paints over the overlap',
    cl.items.indexOf(bar[0]) > Math.max(...pieces.map(p => cl.items.indexOf(p))));
  const mains = items(cl, 'main');
  check('the sandwiched breakers are laid out in the main track between the pieces',
    mains.map(m => m.breaker.id).join() === 'in1,in3' && mains.every(m => m.gridColumn === 1));
  check('slot 1 half-rows sit above the 6px gap row, slot 3 half-rows below it',
    cl.rowTemplate === '1fr 1fr 6px 1fr 1fr', cl.rowTemplate);
  check('the bar spans from 1a to the bottom of 3b', bar[0].gridRow === '1 / 6', bar[0].gridRow);
  const in1 = mains.find(m => m.breaker.id === 'in1');
  check('a breaker ending a slot swallows the gap row after it (no divider strip)', in1.gridRow === '2 / 4', in1.gridRow);
  check('the cluster covers both rows and no spare is emitted for them',
    cl.row === 1 && cl.rowSpan === 2 && !find(cells, c => c.kind === 'spare' && (c.slot === 1 || c.slot === 3)));
  check('...and lists every breaker for the table, top to bottom',
    cl.breakers.map(b => b.id).join() === 'outer,in1,in3');
}

// --- even column: bar on the LEFT; a half left empty is a spare -----------------
{
  const cells = layout([B('outer', ['2a', '4b']), B('other', ['2b'])], 4, 2);
  const cl = find(cells, c => c.slot === 2);
  check('two DIFFERENT units sharing rows are merged into one cluster', cl.kind === 'cluster' && cl.breakers.length === 2);
  check('on the EVEN side the bar is to the LEFT', cl.barsLeft && cl.colTemplate === '52px minmax(0, 1fr)' && items(cl, 'bar')[0].gridColumn === 1);
  check('on the even side a piece spans from the bar across the main track',
    items(cl, 'piece').every(p => p.gridColumn === '1 / 3'));
  const spare = items(cl, 'spare');
  check('the empty half (4a) is a spare that adds a breaker at slot 4', spare.length === 1 && spare[0].slot === 4, JSON.stringify(spare));
}

// --- two half-slot units in one slot were never both drawn before ----------------
{
  const cells = layout([B('x', ['5a']), B('y', ['5b'])], 6, 2);
  const cl = find(cells, c => c.slot === 5);
  check('two single-half breakers from different units in one slot are both drawn',
    cl.kind === 'cluster' && items(cl, 'main').length === 2 && items(cl, 'bar').length === 0);
}

// --- single-column layout, and nesting --------------------------------------------
{
  const cells = layout([B('o', ['1a', '4b'], 'g'), B('m', ['1b', '3b'], 'g'), B('i', ['2a', '2b', '3a'], 'g')], 4, 1);
  const cl = find(cells, c => c.slot === 1);
  const bars = items(cl, 'bar');
  check('single-column: slots 1..4 are consecutive rows', cl.row === 1 && cl.rowSpan === 4);
  check('nested non-contiguous breakers get a bar each, shortest nearest the breakers',
    bars.length === 2 && bars.find(b => b.breaker.id === 'm').gridColumn === 2 && bars.find(b => b.breaker.id === 'o').gridColumn === 3);
  check('every bar track is filled where its bar is not', items(cl, 'fill').length >= 1);
}

// --- MOCK_SNAPSHOT exercises it ---------------------------------------------------
check('MOCK_SNAPSHOT carries a non-contiguous breaker so Sandbox draws a bar',
  /cells: \["13a", "15b"\]/.test(src) && /cells: \["14a", "16b"\]/.test(src));

// --- the diagram uses it, and panel.html carries the same copy ----------------------
check('PanelDiagram builds its cells from panelDiagramLayout',
  /const cells = panelDiagramLayout\(breakers, slotCount, columns, 6\);/.test(src));
const pnl = panelHtml.includes('\r\n') ? '\r\n' : '\n';
let copy = '';
try { copy = slice(panelHtml, 'function panelDiagramLayout(breakers, slotCount, columns, rowGapPx) {', pnl, '  '); } catch (e) { /* reported below */ }
const norm = t => t.replace(/\r\n/g, '\n').split('\n').map(l => l.trim()).join('\n');
check('panel.html carries a verbatim copy of panelDiagramLayout', !!copy && norm(copy) === norm(fnSrc));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
