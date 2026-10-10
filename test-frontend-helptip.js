// Guards the help icon (HelpTip, 2026-10-10) and the help text moved behind it.
//
// Three ways this breaks silently:
//   * the popover stops swallowing clicks: React bubbles portal events through
//     the COMPONENT tree, so closing the help would also close the menu or the
//     modal it sits in;
//   * the trigger stops preventDefault-ing, so a help icon inside a <label>
//     toggles the checkbox it explains;
//   * help drifts back into menus as a title= tooltip, which a phone never shows.
//
// Run: node test-frontend-helptip.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const start = src.indexOf('function HelpTip(');
const end = src.indexOf('\nfunction ', start + 10);
const tip = start === -1 ? '' : src.slice(start, end);

check('HelpTip exists', !!tip);
check('the popover is portalled to document.body', /createPortal\([\s\S]*document\.body\s*\)/.test(tip));
check('the popover root stops click propagation', /onClick=\{stop\}/.test(tip) && /const stop = e => e\.stopPropagation\(\)/.test(tip));
check('the trigger prevents default and stops propagation',
  /const toggle = e => \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);/.test(tip));
check('the trigger is type="button"', /type="button"/.test(tip));
check('Escape closes it', /e\.key === "Escape"/.test(tip));

// The moved help: each sentence must now be a HelpTip's text, not a grey line.
const moved = [
  "Local fixture data, safe to experiment on.",
  "in a file you can edit and import back.",
  "Reads an exported sheet back in",
  "Gives each person their own page and history.",
  "Renaming a type updates it everywhere",
  "Labels tag your asset types",
  "Tap an icon to use it for this type.",
  "Labels don't change what a type does",
  "Locations show in the location navigator",
  "Pick one or more locations. Nothing ticked means",
  "Room and Building have this on by default.",
  "Adds a Place on map action to these assets.",
  "A field's kind is set when it is created and can't be changed afterwards.",
  "Hostname and Screen Size only apply to some types",
  "Photos are resized and stripped of location data",
  "Whoever taps it needs access where the file lives",
];
for (const m of moved) {
  const i = src.indexOf(m);
  if (i === -1) { check(`help kept: ${m}`, false, 'sentence is gone'); continue; }
  // Every occurrence: inside a <HelpTip …> opened before it with no element
  // closed in between, or a `hint:` handed to a component that renders HelpTip.
  let ok = true;
  for (let j = i; j !== -1; j = src.indexOf(m, j + 1)) {
    const before = src.slice(Math.max(0, j - 800), j);
    const lastTip = before.lastIndexOf('<HelpTip');
    const lastHint = before.lastIndexOf('hint: ');
    const lastClose = Math.max(before.lastIndexOf('</div>'), before.lastIndexOf('</span>'));
    if (!(Math.max(lastTip, lastHint) > lastClose)) ok = false;
  }
  check(`behind a help icon: ${m}`, ok);
}

check('no menu row carries a title= tooltip for Export/Import/Convert/Sandbox',
  !/title=\{?[`"](Exports the|Reads an exported|Gives each person|Local fixture data)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
