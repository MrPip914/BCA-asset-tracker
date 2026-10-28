// Task templates: the rule maths, stamping, adoption and shifting run for real;
// the wiring is read as source.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log('PASS ' + n); } else { fail++; console.log('FAIL ' + n); } };
const eq = (n, a, b) => check(n, JSON.stringify(a) === JSON.stringify(b) || (console.log('  got', JSON.stringify(a), 'want', JSON.stringify(b)), false));

function slice(startRe, endRe) {
  const a = src.search(startRe); const rest = src.slice(a); const b = rest.search(endRe);
  if (a < 0 || b < 0) throw new Error('slice ' + startRe);
  return rest.slice(0, b);
}
const code = slice(/const TEMPLATE_RULE_MODES/, /\/\/ A field's value as comparable text/);
const H = new Function('calendarDayAdd', 'dateOnly', 'WEEKDAY_NAMES', code + '; return { adoptTaskTemplates, adoptTemplateRule, resolveTemplateRule, stampTemplate, daysBetween, shiftTaskDates, templateRuleMode, templateRuleFrom, describeTemplateRule };')(
  (d, n) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); },
  v => (typeof v === 'string' ? v.slice(0, 10) : ''),
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);

// 2026-11-01 is a Sunday.
const sun = '2026-11-01';
eq('days before', H.resolveTemplateRule({ kind: 'days', n: 1, dir: 'before' }, sun), '2026-10-31');
eq('days after', H.resolveTemplateRule({ kind: 'days', n: 2, dir: 'after' }, sun), '2026-11-03');
eq('preceding Friday', H.resolveTemplateRule({ kind: 'weekday', weekday: 5, which: 'preceding' }, sun), '2026-10-30');
eq('the Sunday before a Sunday is a week earlier', H.resolveTemplateRule({ kind: 'weekday', weekday: 0, which: 'preceding' }, sun), '2026-10-25');
eq('the Sunday after a Sunday is a week later', H.resolveTemplateRule({ kind: 'weekday', weekday: 0, which: 'following' }, sun), '2026-11-08');
eq('following Monday', H.resolveTemplateRule({ kind: 'weekday', weekday: 1, which: 'following' }, sun), '2026-11-02');
eq('no rule, no date', H.resolveTemplateRule(null, sun), '');
eq('junk rule reads as none', [H.adoptTemplateRule({ kind: 'days', n: -1, dir: 'before' }), H.adoptTemplateRule({ kind: 'weekday', weekday: 9, which: 'preceding' }), H.adoptTemplateRule('x')], [null, null, null]);

const raw = { list: [{ id: 't', name: '', items: [
  { id: 'a', task: 'A' }, { id: 'b', task: 'B', parentItemId: 'a' }, { id: 'c', task: 'C', parentItemId: 'b' }, { id: 'd', parentItemId: 'zzz' }, { id: '' }, null] }, { name: 'no id' }] };
const ad = H.adoptTaskTemplates(raw).list;
eq('a template needs an id and is named', [ad.length, ad[0].name], [1, 'Untitled template']);
eq('rows without an id are dropped', ad[0].items.map(i => i.id), ['a', 'b', 'c', 'd']);
eq('nesting is one level: grandchild and dangling parent go top-level', ad[0].items.map(i => i.parentItemId), ['', 'a', '', '']);
eq('an item defaults to the event asset', ad[0].items[0].asset, 'event');
eq('adoption of nothing', H.adoptTaskTemplates(undefined), { list: [] });

let n = 0;
const stamp = { at: 'T', by: 'Eric', newId: () => 'id' + (++n) };
const tpl = { id: 'tp', name: 'Service', parent: { task: '', notes: 'p' }, items: [
  { id: 'i1', task: 'Set up', asset: 'event', doOn: { kind: 'days', n: 1, dir: 'before' } },
  { id: 'i2', task: 'Mics', parentItemId: 'i1', asset: 'other', due: { kind: 'days', n: 0, dir: 'before' } },
  { id: 'i3', task: 'Gone', asset: 'deleted' }] };
const out = H.stampTemplate(tpl, sun, 'EV', new Set(['EV', 'other']), stamp);
eq('parent first, then items, children after parents', out.map(o => o.item.task), ['Service', 'Set up', 'Gone', 'Mics']);
eq('the event parent sits on the event day with an origin', [out[0].assetId, out[0].item.doOn, out[0].item.origin], ['EV', sun, { templateId: 'tp', itemId: '', runDate: sun }]);
eq('items link to the parent / item they sit under', out.map(o => o.item.parentTaskId), [undefined, out[0].item.id, out[0].item.id, out[1].item.id]);
eq('rules resolve against the event day', [out[1].item.doOn, out[3].item.dueDate], ['2026-10-31', sun]);
eq('an asset that is gone falls back to the event asset', out.map(o => o.assetId), ['EV', 'EV', 'EV', 'other']);
eq('stamped tasks are one-offs, stamped at/by', [out[1].item.kind, out[1].item.at, out[1].item.by], ['oneoff', 'T', 'Eric']);
eq('ids are all distinct', new Set(out.map(o => o.item.id)).size, 4);
eq('no event day stamps nothing', H.stampTemplate(tpl, '', 'EV', new Set(), stamp), []);

eq('daysBetween', H.daysBetween('2026-11-01', '2026-11-08'), 7);
eq('daysBetween negative', H.daysBetween('2026-11-08', '2026-11-01'), -7);
eq('shift moves only the dates that are set', H.shiftTaskDates({ startDate: '', doOn: '2026-11-01', dueDate: '2026-11-03' }, 7), { doOn: '2026-11-08', dueDate: '2026-11-10' });

// Wiring
check('templates load through the adopter', /setTaskTemplates\(adoptTaskTemplates\(data\.taskTemplates\)\)/.test(src));
check('persist posts taskTemplates', /taskTemplates: nextTemplates/.test(src));
check('Edge Function keeps taskTemplates', ['save.ts', 'inventory.ts'].every(f => /OPTIONAL_CONFIG_KEYS = \["workModel", "views", "taskTemplates"\]/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api', f), 'utf8'))));
check('Edge Function keeps origin on a task', /TASK_EXTRA_KEYS = \[[^\]]*"origin"/.test(fs.readFileSync(path.join(__dirname, 'supabase/functions/asset-api/save-shape.ts'), 'utf8')));
check('Settings has a Templates section for editors', /key: "templates", label: "Templates"[^}]*editor: true/.test(src));
check('Sandbox carries a template', /taskTemplates: \{ list: \[/.test(src));
check('rescheduling an event offers the shift', /setShiftAsk\(/.test(src));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
