// The palette is per tenant, and it lives in exactly one file.
//
// Before 2026-09-15 the same hex strings were written down three times: `C` in
// index.html, a :root block in panel.html, and a smaller one in
// panel-qr-sheet.html. Nothing checked them against each other, and the comment
// in panel.html said "same values as C in index.html" -- the kind of claim that
// is true until someone edits one of them.
//
// Each check below is a failure that produces NO error: a colour is simply wrong
// somewhere, on a page nobody looks at in both tenants at once.
//
// Run: node test-frontend-theme.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

const read = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const CLIENTS_SRC = read('clients.js');

// clients.js is browser code, so it is evaluated in a stub the way deploy.mjs
// evaluates it -- deliberately WITHOUT a `document`, which is also the check
// that applyTheme() stays guarded. A theme that could only resolve inside a
// browser would take deploy.mjs down with it.
function resolve(src, { search = '', pathname = '/' } = {}) {
  const warnings = [];
  const ctx = {
    window: {
      location: { search, pathname },
      console: { warn: m => warnings.push(String(m)) },
    },
    URLSearchParams,
  };
  vm.createContext(ctx);
  new vm.Script(src, { filename: 'clients.js' }).runInContext(ctx);
  return {
    client: ctx.window.ASSET_TRACKER_CLIENT,
    registry: ctx.window.ASSET_TRACKER_CLIENTS,
    warnings,
  };
}

const { client: base } = resolve(CLIENTS_SRC);
const THEME = base.theme;

// A tenant of the test's own, so these checks do not depend on whether a real
// one happens to carry a theme. They used to inject into `bca`; once bca gained
// its own theme that injection was silently overridden by the real key and the
// merge test would have passed without testing anything.
const FAKE_ID = 'themetest';
const FAKE_SEARCH = { search: `?client=${FAKE_ID}` };
const withTenant = theme => CLIENTS_SRC.replace(
  'var CLIENTS = {',
  `var CLIENTS = {\n    ${FAKE_ID}: { theme: ${theme}, appName: "T", orgName: "T", labelPrefix: "T", apiUrl: "x" },`
);

check('clients.js resolves a theme with no DOM present', !!THEME && Object.keys(THEME).length > 0,
      'ASSET_TRACKER_CLIENT.theme was empty -- applyTheme() probably touched document unguarded');

// --- the merge ---------------------------------------------------------------
// A tenant naming ONE colour must keep every other one. The obvious wrong
// implementation (assign the override object wholesale) passes a smoke test in
// the browser and leaves the rest of the palette undefined.
{
  const { theme } = resolve(withTenant('{ brand: "#123456" }'), FAKE_SEARCH).client;
  check('a tenant theme overrides only the keys it names',
        theme.brand === '#123456' && theme.bg === THEME.bg && theme.accent === THEME.accent,
        `brand=${theme.brand} bg=${theme.bg} accent=${theme.accent}`);
  check('every default key survives a partial override',
        Object.keys(theme).length === Object.keys(THEME).length,
        `${Object.keys(theme).length} keys vs ${Object.keys(THEME).length} defaults`);
}

// An unknown key is the typo case. It must not land in the theme, and it must
// not be silent -- "theming doesn't work" with nothing in the console is the bad
// hour this warning exists to prevent.
{
  const { client, warnings } = resolve(withTenant('{ accnt: "#123456" }'), FAKE_SEARCH);
  check('an unknown theme key is dropped, not stored',
        client.theme.accnt === undefined && client.theme.accent === THEME.accent);
  check('an unknown theme key is named in a console warning',
        warnings.some(w => w.includes('accnt')),
        `warnings: ${JSON.stringify(warnings)}`);
}

// Every theme key the SHIPPED tenants name must be a real one. An unknown key is
// only a console warning at runtime, and nobody is watching a console -- so a
// typo in a school's palette would land as "that colour did nothing".
{
  const ids = Object.keys(resolve(CLIENTS_SRC).registry || {});
  const complaints = [];
  ids.forEach(id => {
    const { warnings } = resolve(CLIENTS_SRC, { search: `?client=${id}` });
    warnings.forEach(w => complaints.push(`${id}: ${w}`));
  });
  check(`every shipped tenant's theme names only real keys (${ids.length} tenants)`,
        complaints.length === 0, complaints.join('\n        '));
}

// --- one source --------------------------------------------------------------
// No palette value may appear anywhere else. This is the check that would have
// caught the three copies, and the one that stops a fourth.
//
// #FFFFFF is exempt: the Dev badge sets white text on C.danger, which is a
// contrast choice rather than a palette entry -- a themed tenant whose `surface`
// went dark would still want that text white.
{
  const EXEMPT = new Set(['#FFFFFF']);
  const offenders = [];
  for (const file of ['index.html', 'panel.html', 'panel-qr-sheet.html']) {
    const src = read(file);
    for (const [key, value] of Object.entries(THEME)) {
      if (EXEMPT.has(value.toUpperCase())) continue;
      if (src.includes(value)) offenders.push(`${file} hardcodes ${value} (${key})`);
    }
  }
  check('no page carries a copy of a palette colour', offenders.length === 0, offenders.join('\n        '));
}

// --- the CSS contract --------------------------------------------------------
// The two public pages style themselves entirely from custom properties that
// clients.js sets. A var nothing sets is not an error in CSS -- the declaration
// is simply dropped and the element renders with an inherited or initial colour,
// which on this app's pages reads as "slightly wrong", not as broken.
{
  const known = new Set(Object.keys(THEME).map(
    k => '--' + k.replace(/[A-Z]/g, ch => '-' + ch.toLowerCase())
  ));
  const unset = [];
  for (const file of ['panel.html', 'panel-qr-sheet.html']) {
    const used = new Set((read(file).match(/var\(--[a-z-]+\)/g) || []).map(m => m.slice(4, -1)));
    used.forEach(v => { if (!known.has(v)) unset.push(`${file} uses ${v}, which no theme key produces`); });
  }
  check('every CSS var the public pages use is one the theme sets',
        unset.length === 0, unset.join('\n        '));
}

// --- declaration order in index.html -----------------------------------------
// `const C = CLIENT.theme` reads through CLIENT, and index.html is one module
// body evaluated top to bottom, so C declared first is a temporal-dead-zone
// ReferenceError that takes the whole app down at load.
{
  const src = read('index.html');
  const iClient = src.indexOf('const CLIENT = window.ASSET_TRACKER_CLIENT;');
  const iC = src.indexOf('const C = CLIENT.theme;');
  check('index.html declares CLIENT before the palette that reads it',
        iClient !== -1 && iC !== -1 && iClient < iC,
        `CLIENT at ${iClient}, C at ${iC}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
