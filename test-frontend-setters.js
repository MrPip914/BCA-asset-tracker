// Every `setFoo(...)` call in index.html must have a `[foo, setFoo] = useState`
// (or a function/prop of that name) somewhere. Babel transpiles in the browser,
// so a setter left behind when its state was removed is not caught by anything
// until the line runs -- and the conflict path is a line that only runs on the
// worst day, and there it aborted the reload that was meant to repair the app.
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

const declared = new Set();
for (const m of src.matchAll(/\[\s*\w+\s*,\s*(set[A-Z]\w*)\s*\]/g)) declared.add(m[1]);
for (const m of src.matchAll(/(?:function|const|let|var)\s+(set[A-Z]\w*)/g)) declared.add(m[1]);
for (const m of src.matchAll(/\b(set[A-Z]\w*)\s*[,}]?\s*(?:=|:)/g)) declared.add(m[1]);

const called = new Set();
for (const m of src.matchAll(/(?<![\w.])(set[A-Z]\w*)\(/g)) called.add(m[1]);

const missing = [...called].filter(n => !declared.has(n) && n !== 'setTimeout');
if (missing.length) {
  console.log('FAIL setters called but never declared: ' + missing.join(', '));
  process.exit(1);
}
console.log(`ok ${called.size} setters called, all declared`);
