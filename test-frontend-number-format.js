// Number display format ("Dollars"): runs the REAL helpers sliced out of
// index.html, plus source checks on the wiring that can't run outside the
// component (list cell, detail cell, input, work fields).
//
// Run: node test-frontend-number-format.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};
const NL = src.includes('\r\n') ? '\r\n' : '\n';
function sliceTopLevel(decl) {
  const start = src.indexOf(decl);
  if (start === -1) throw new Error(decl + ' not found');
  const end = src.indexOf(NL + '}' + NL, start);
  return src.slice(start, end + NL.length + 1);
}
const nf = src.slice(src.indexOf('const NUMBER_FORMATS = ['), src.indexOf('function numberFormatLabel'));
const code = [nf, sliceTopLevel('function numberFormatLabel'), sliceTopLevel('function fieldNumberFormat'),
  sliceTopLevel('function formatNumberValue'), sliceTopLevel('function applyNumberFormat')].join('\n');
const H = new Function(code + '\nreturn { fieldNumberFormat, formatNumberValue, applyNumberFormat };')();

check('dollars formats with grouping and cents', H.formatNumberValue('dollars', '1234.5') === '$1,234.50');
check('integers get cents', H.formatNumberValue('dollars', 12) === '$12.00');
check('zero is $0.00, not blank', H.formatNumberValue('dollars', 0) === '$0.00');
check('blank stays blank', H.formatNumberValue('dollars', '') === '' && H.formatNumberValue('dollars', null) === '');
check('a non-number is shown as typed, not $NaN', H.formatNumberValue('dollars', 'MOCK-1') === 'MOCK-1');
check('plain is untouched', H.formatNumberValue('plain', '1234.5') === '1234.5');
check('format applies only to a number kind', H.fieldNumberFormat({ format: 'dollars' }, 'text') === 'plain'
  && H.fieldNumberFormat({ format: 'dollars' }, 'number') === 'dollars');
const col = {}; H.applyNumberFormat(col, 'number', 'dollars');
check('apply stores dollars', col.format === 'dollars');
H.applyNumberFormat(col, 'number', 'plain');
check('plain removes the key (never stored)', !('format' in col));
const t = {}; H.applyNumberFormat(t, 'text', 'dollars');
check('a text field never gets a format', !('format' in t));

check('list cell formats numbers', /columnDataType\(c\) === "number" \? formatNumberValue\(fieldNumberFormat\(c, "number"\), a\[c\.key\]\)/.test(src));
check('detail cell formats numbers', src.includes('formatNumberValue(fieldNumberFormat(c, "number"), selectedAsset[c.key])'));
check('both asset forms pass the format to Field', (src.match(/numberFormat=\{fieldNumberFormat\(c, columnDataType\(c\)\)\}/g) || []).length === 2);
check('custom task/work inputs pass the format', src.includes('numberFormat={fieldNumberFormat(f, f.dataType)}'));
check('task/work values display through the format', /field\.dataType === "number" \? formatNumberValue/.test(src) || src.includes('if (field.dataType === "number") return formatNumberValue'));
check('work model keeps format on load', src.includes('f.format === "dollars" && f.dataType === "number"'));
check('applyFieldKind writes the format', src.includes('col.format = "dollars"'));
check('type editor saves the pending field format', src.includes('(draft.fieldFormats || {})[f.tempId]'));
check('export keeps raw numbers (round trip)', !/exportToExcel[\s\S]{0,4000}formatNumberValue/.test(src.slice(src.indexOf('function exportToExcel'), src.indexOf('function exportToExcel') + 4000)));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
