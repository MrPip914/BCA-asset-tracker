// Guards the type-icon CATALOG and the per-device FAVORITES row (2026-09-20).
//
// Six ways this regresses without anything throwing, logging, or looking wrong in
// whichever state you happen to be testing:
//
//   1. A LEGACY ALIAS KEY IS RENAMED OR DROPPED. Six catalog keys do not match
//      their component (`Computer` is HardDrive, `TV` is Tv, `Door` is DoorOpen,
//      `Building` is Building2, `Campus` is MapPin, `Unknown` is HelpCircle) and
//      they are STORED DATA — typeSettings[id].iconName holds them for every type
//      anyone has edited. Drop one and that type falls silently back to its
//      shipped icon, which looks like a type that was never customised.
//   2. A CATALOG ENTRY NAMES A COMPONENT THAT ISN'T IMPORTED. React renders an
//      undefined component as an error, so this is a broken PICKER, not a missing
//      icon — and the tile that breaks it may be two hundred rows down.
//   3. THE SAME KEY LANDS IN TWO GROUPS. TYPE_ICON_CHOICES is flattened from the
//      groups, so the earlier one is silently lost and the icon renders in the
//      wrong section.
//   4. THE SELECTED ICON STOPS BEING APPENDED to the editor's row when it is not
//      a favorite. The row then shows nothing selected for a type whose icon came
//      from the catalog, so the choice reads as unset and the next tap replaces
//      it.
//   5. sanitizeIconFavorites RE-SEEDS AN EMPTY LIST. Clearing the row would then
//      undo itself on the next load — the same shape of bug an explicitly-empty
//      tag and an explicitly-empty label list each had to be taught to survive.
//   6. A FAVORITE NAMES AN ICON THE CATALOG NO LONGER HAS. It comes out of
//      localStorage, so it outlives the build that wrote it, and an unknown key
//      is case 2 again by another door.
//
// Run: node test-frontend-icons.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

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
function grabBlock(startsWith, endsWith) {
  const i = src.indexOf(startsWith);
  if (i === -1) throw new Error(`${startsWith} not found`);
  const j = src.indexOf(endsWith, i);
  if (j === -1) throw new Error(`end of ${startsWith} not found`);
  return src.slice(i, j + endsWith.length);
}

const groupsSrc = grabBlock('const ICON_GROUPS = [', '\n];');
const favsSrc = grabBlock('const DEFAULT_ICON_FAVORITES = [', '\n];');
// The browser's section list, lifted out of the component as a plain function of
// its two inputs. RUN rather than read: "the favorites section is first" and "the
// search matches the group name" are claims about behaviour, and a source regex
// for either keeps passing when the code around it is gutted.
const memoBody = (() => {
  const i = src.indexOf('const iconSections = useMemo(() => {');
  if (i === -1) throw new Error('iconSections memo not found');
  const open = src.indexOf('{', src.indexOf('() =>', i));
  const end = src.indexOf('}, [iconQuery, iconFavorites]);', i);
  if (end === -1) throw new Error('iconSections memo dependencies changed — check them, then update this slice');
  return src.slice(open + 1, src.lastIndexOf('}', end));
})();

// ---- what the module actually imports from lucide ----
const importMatch = src.match(/import \{([\s\S]*?)\} from "lucide-react";/);
check('the lucide import block is present', !!importMatch);
const imported = new Set(
  importMatch[1]
    .split('\n').map(l => l.replace(/\/\/.*$/, ''))      // strip the per-group comments
    .join(' ').split(',').map(s => s.trim()).filter(Boolean)
);

// Every component the catalog names, as a stub, DERIVED FROM THE SOURCE so adding
// an icon never means editing this file — the same trick test-frontend-tag.js uses
// on the registry.
const named = [...new Set(
  [...groupsSrc.matchAll(/(?:^|[\s{,])([A-Za-z_]\w*)\s*(?:,|$)/gm)].map(m => m[1])
    .concat([...groupsSrc.matchAll(/:\s*([A-Z]\w*)/g)].map(m => m[1]))
)].filter(n => n !== 'name' && n !== 'icons');

const notImported = named.filter(n => !imported.has(n));
check('every component the catalog names is imported from lucide-react',
      notImported.length === 0,
      'React renders an undefined component as an error, so this breaks the whole picker: ' + notImported.join(', '));

// ---- evaluate the real catalog, with each component stubbed as itself ----
const stubs = named.map(n => `const ${n} = "${n}";`).join('\n');
const code = [
  stubs,
  groupsSrc,
  'const TYPE_ICON_CHOICES = Object.assign({}, ...ICON_GROUPS.map(g => g.icons));',
  favsSrc,
  grabFn('sanitizeIconFavorites'),
  'function iconSectionsFor(iconQuery, iconFavorites) {' + memoBody + '}',
  'module.exports = { ICON_GROUPS, TYPE_ICON_CHOICES, DEFAULT_ICON_FAVORITES, sanitizeIconFavorites, iconSectionsFor };',
].join('\n');

const mod = { exports: {} };
try {
  new Function('module', code)(mod);
} catch (e) {
  console.error('Could not evaluate the extracted catalog:\n  ' + e.message);
  process.exit(1);
}
const { ICON_GROUPS, TYPE_ICON_CHOICES, DEFAULT_ICON_FAVORITES, sanitizeIconFavorites, iconSectionsFor } = mod.exports;
const keysIn = sections => sections.flatMap(s => s.entries.map(([k]) => k));

// ---- 1. the six stored alias keys ----
// Spelled out rather than derived: derived from the catalog they would agree with
// whatever the catalog said, which is exactly the regression being guarded.
const ALIASES = {
  Computer: 'HardDrive', TV: 'Tv', Door: 'DoorOpen',
  Building: 'Building2', Campus: 'MapPin', Unknown: 'HelpCircle',
};
for (const [key, comp] of Object.entries(ALIASES)) {
  check(`the stored key "${key}" still resolves to ${comp}`,
        TYPE_ICON_CHOICES[key] === comp,
        `typeSettings[id].iconName holds "${key}" on the live sheets; got ${TYPE_ICON_CHOICES[key]}`);
}
// The other half of that rule: lucide's own Computer/Building glyphs must stay out
// of the catalog, or one word means two icons depending on which group won.
check('lucide\'s own Computer and Building glyphs stay out of the catalog',
      TYPE_ICON_CHOICES.Computer !== 'Computer' && TYPE_ICON_CHOICES.Building !== 'Building',
      'those keys are taken by the aliases above, so a second meaning for the same word is a trap');

// ---- 2/3. structure ----
check('every group has a name and at least one icon',
      ICON_GROUPS.length > 0 && ICON_GROUPS.every(g => typeof g.name === 'string' && g.name && Object.keys(g.icons || {}).length > 0),
      'a nameless group has nothing for the search to match on, which is how synonyms work here');

const seen = new Map();
const dupes = [];
for (const g of ICON_GROUPS) {
  for (const key of Object.keys(g.icons)) {
    if (seen.has(key)) dupes.push(`${key} (${seen.get(key)} and ${g.name})`);
    else seen.set(key, g.name);
  }
}
check('no key appears in two groups',
      dupes.length === 0,
      'the flattened lookup silently keeps the LAST one: ' + dupes.join(', '));
check('the flattened lookup holds every catalog key',
      Object.keys(TYPE_ICON_CHOICES).length === seen.size,
      `${seen.size} keys across the groups but ${Object.keys(TYPE_ICON_CHOICES).length} in TYPE_ICON_CHOICES`);
check('no catalog entry resolves to nothing',
      Object.entries(TYPE_ICON_CHOICES).every(([, v]) => !!v),
      'an entry with no component renders as a React error, not a blank tile');

// The catalog is the point of this change — a shrunken one means the browser was
// quietly reverted to the fifteen-icon row.
check('the catalog is substantially bigger than the row it replaced',
      seen.size > 100,
      `only ${seen.size} icons — the browser exists because a flat row could not hold this many`);

// The three areas Eric named. Asserted by GROUP rather than by icon so the test is
// about coverage rather than about one glyph's name.
for (const want of ['hvac', 'people', 'printing']) {
  check(`the catalog carries a "${want}" group`,
        ICON_GROUPS.some(g => g.name.toLowerCase().includes(want)),
        'the search leans on group names for synonyms, so a missing group is a missing vocabulary');
}

// ---- favorites ----
check('every shipped favorite exists in the catalog',
      DEFAULT_ICON_FAVORITES.every(k => !!TYPE_ICON_CHOICES[k]),
      'a favorite the catalog does not have renders as an undefined component: '
        + DEFAULT_ICON_FAVORITES.filter(k => !TYPE_ICON_CHOICES[k]).join(', '));
check('the shipped row still carries the fifteen keys the picker launched with',
      ['Computer','Monitor','Phone','TV','Camera','Printer','Package','Zap','Door','Building','Campus','Wrench','Lock','Archive','Unknown']
        .every(k => DEFAULT_ICON_FAVORITES.includes(k)),
      'dropping one changes the row every existing device sees for no stated reason');
check('the shipped row fills the two gaps it had: an HVAC icon and a person',
      DEFAULT_ICON_FAVORITES.includes('AirVent') && DEFAULT_ICON_FAVORITES.includes('UserCircle'),
      'Mini Split and Condenser rendered as question marks, and People had no icon at all');

// ---- 5/6. sanitizeIconFavorites ----
check('an unknown key is dropped from a stored list',
      JSON.stringify(sanitizeIconFavorites(['Printer', 'NoSuchIcon', 'Wrench'])) === JSON.stringify(['Printer', 'Wrench']),
      'an unknown key is an undefined component in the editor row');
check('a stored EMPTY list is respected, not re-seeded',
      Array.isArray(sanitizeIconFavorites([])) && sanitizeIconFavorites([]).length === 0,
      're-seeding makes "remove from favorites" undo itself on the next load');
check('a non-empty list that resolves to nothing falls back to the shipped row',
      sanitizeIconFavorites(['GoneIcon', 'AlsoGone']) === DEFAULT_ICON_FAVORITES,
      'a row holding only the More button reads as a broken feature');
check('a non-array falls back to the shipped row',
      sanitizeIconFavorites(null) === DEFAULT_ICON_FAVORITES
        && sanitizeIconFavorites('Printer') === DEFAULT_ICON_FAVORITES,
      'corrupt or absent storage must leave the row as shipped');
check('duplicates are collapsed',
      JSON.stringify(sanitizeIconFavorites(['Printer', 'Printer'])) === JSON.stringify(['Printer']),
      'the row keys on the icon name, so a repeat is a duplicate React key');
check('the stored ORDER is kept',
      JSON.stringify(sanitizeIconFavorites(['Wrench', 'Printer'])) === JSON.stringify(['Wrench', 'Printer']),
      'a row someone arranged should stay arranged');

// ---- 4. the editor row appends the selection ----
// Read out of the source: the row is one expression, and the failure is that a
// catalog-chosen icon reads as unset.
const rowStart = src.indexOf('THE SHORTCUT ROW, not the catalog');
check('the editor row block is present and commented', rowStart !== -1,
      'the row moved, or the comment saying why the selection is appended was dropped');
const rowBlock = src.slice(rowStart, rowStart + 2200);
check('the editor row appends the selected icon when it is not a favorite',
      /draft\.iconName && !\(iconFavorites \|\| \[\]\)\.includes\(draft\.iconName\)/.test(rowBlock),
      'without this a type whose icon came from the catalog shows a row with nothing selected');
check('the editor row filters out keys the catalog does not have',
      /\.filter\(key => TYPE_ICON_CHOICES\[key\]\)/.test(rowBlock),
      'a stale favorite from another build would render as an undefined component');
check('the editor row offers the way into the browser',
      /setBrowsingIcons\(true\)/.test(rowBlock),
      'the catalog is unreachable without it, which is most of this feature');
check('the row is built from favorites, not from the whole catalog',
      /\[\.\.\.\(iconFavorites \|\| \[\]\)/.test(rowBlock)
        && !/Object\.(keys|entries|values)\(TYPE_ICON_CHOICES\)/.test(rowBlock),
      'enumerating the catalog here is the flat two-hundred-button wall this change exists to remove');

// ---- the browser is a VIEW of the modal, not a nested overlay ----
check('the icon browser is a view of the type-manager modal',
      /\{browsingIcons && draft \? \(/.test(src),
      'an overlay opened from the type editor, which is opened from a picker, would be four layers deep');
// The chain is browsingIcons -> editingLabels -> draft -> list, and the browser
// has to open it: placed after editingLabels or draft it would never render, since
// both are true on the way in.
const chainAt = src.indexOf('{browsingIcons && draft ? (');
check('the browser opens the view chain, so it is reachable',
      chainAt !== -1 && src.indexOf(') : editingLabels ? (', chainAt) > chainAt,
      'placed behind editingLabels or draft in the chain it would never render');
check('the header names the browser and its close returns to the editor',
      /browsingIcons \? "Choose an icon"/.test(src) && /browsingIcons \? \(\) => setBrowsingIcons\(false\)/.test(src),
      'closing the whole modal from the browser would discard the type edit behind it');
check('opening the editor reseeds both browser states',
      /setBrowsingIcons\(false\);\s*\n\s*setIconQuery\(""\);/.test(src),
      'a query left from the last type edited hides the catalog behind a search nobody typed');

// ---- search matches the group name, which is what makes synonyms work ----
// ---- the sections memo, RUN against the real catalog ----
const allSections = iconSectionsFor('', DEFAULT_ICON_FAVORITES);
check('with no query, every group is offered',
      allSections.filter(s => s.name !== 'Favorites').length === ICON_GROUPS.length,
      'a group missing from the browser is a group of icons nobody can reach');
check('with no query, every catalog icon is reachable',
      new Set(keysIn(allSections)).size === Object.keys(TYPE_ICON_CHOICES).length,
      'the browser is the only way to the catalog, so anything it drops is unreachable');

// The three groups Eric named, found by the words he would type rather than by
// the icon names — which is the whole reason the group name is searchable.
for (const [q, want] of [['hvac', 'AirVent'], ['people', 'GraduationCap'], ['printer', 'Printer'],
                         ['water', 'Bath'], ['snowflake', 'ThermometerSnowflake']]) {
  check(`searching "${q}" finds ${want}`,
        keysIn(iconSectionsFor(q, DEFAULT_ICON_FAVORITES)).includes(want),
        'the search leans on the group name and a camelCase split; one of the two has gone');
}
check('a two-word query NARROWS rather than widens',
      (() => {
        // "people" matches the whole People group by its group name; "round"
        // matches three icons inside it. ANDed that is the intersection; ORed it
        // is the group plus every Round in the catalog, i.e. a second word
        // making the list longer.
        const two = keysIn(iconSectionsFor('people round', DEFAULT_ICON_FAVORITES));
        return two.includes('UserRound') && two.includes('UsersRound')
          && !two.includes('GraduationCap') && !two.includes('KeyRound');
      })(),
      'ORed tokens make a second word match more, not less');
check('a query that matches nothing returns no sections at all',
      iconSectionsFor('zzzznothing', DEFAULT_ICON_FAVORITES).length === 0,
      'the browser keys its "nothing matches" message off an empty list');

check('the favorites section is FIRST and holds the current row',
      (() => {
        const s = iconSectionsFor('', ['Wrench', 'Printer']);
        return s[0] && s[0].name === 'Favorites'
          && JSON.stringify(s[0].entries.map(([k]) => k)) === JSON.stringify(['Wrench', 'Printer']);
      })(),
      'un-starring needs one place holding every favorite, in the row\'s own order, whatever group it came from');
check('a favorite also stays in its real group, so the duplication is deliberate',
      (() => {
        const s = iconSectionsFor('', ['Printer']);
        return s.some(x => x.name !== 'Favorites' && x.entries.some(([k]) => k === 'Printer'));
      })(),
      'removing it from its group would make the catalog lie about what is in it');
check('an empty row says so, but only when nothing is being searched',
      (() => {
        const idle = iconSectionsFor('', []);
        const searching = iconSectionsFor('printer', []);
        return idle[0] && idle[0].name === 'Favorites' && idle[0].empty === true
          && !searching.some(s => s.name === 'Favorites');
      })(),
      '"no favorites yet" under a query answers a question nobody asked');
check('a stale favorite is not offered as a section entry',
      !keysIn(iconSectionsFor('', ['Printer', 'GoneIcon'])).includes('GoneIcon'),
      'an unknown key would render as an undefined component in the Favorites row');


// ---- the fixture exercises both halves of the row ----
const mockStart = src.indexOf('  typeSettings: {');
const mock = src.slice(mockStart, mockStart + 1400);
const mockIcons = [...mock.matchAll(/iconName: "(\w+)"/g)].map(m => m[1]);
check('the sandbox fixture names at least two icons',
      mockIcons.length >= 2,
      'a fixture with no iconName at all exercises only the shipped-icon path');
check('the fixture mixes a favorite with a non-favorite',
      mockIcons.some(k => DEFAULT_ICON_FAVORITES.includes(k)) && mockIcons.some(k => !DEFAULT_ICON_FAVORITES.includes(k)),
      'the appended-selection tile is only reachable in Sandbox if a fixture type names an icon outside the row');
check('every icon the fixture names is in the catalog',
      mockIcons.every(k => !!TYPE_ICON_CHOICES[k]),
      'Sandbox would render an undefined component: ' + mockIcons.filter(k => !TYPE_ICON_CHOICES[k]).join(', '));

// ---- the preference is per-device, like column visibility ----
check('favorites are stored per device and namespaced by tenant',
      /const ICON_FAVORITES_STORAGE_KEY = CLIENT\.storageKey\("asset-tracker-icon-favorites"\);/.test(src),
      'one origin serves every school, so an un-namespaced key leaks the row between tenants');
check('the favorites write never calls persist()',
      !/function toggleIconFavorite\([\s\S]{0,700}persist\(/.test(src),
      'a shortcut row is not shared data, and a Config key of its own would be a backend release');
const readEffect = src.slice(src.indexOf('localStorage.getItem(ICON_FAVORITES_STORAGE_KEY)') - 120,
                             src.indexOf('localStorage.getItem(ICON_FAVORITES_STORAGE_KEY)') + 400);
check('the stored row is read through sanitizeIconFavorites',
      /sanitizeIconFavorites\(JSON\.parse\(stored\)\)/.test(readEffect),
      'reading it raw puts an unknown key straight into the row');
check('the read is wrapped in try/catch',
      /try \{/.test(readEffect) && /catch \(e\)/.test(readEffect),
      'blocked or private storage must cost a preference, never the app');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
