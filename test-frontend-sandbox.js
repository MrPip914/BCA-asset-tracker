// Guards where the Sandbox controls LIVE (2026-09-20).
//
// The rule is "exactly one control at a time": in production the account menu
// offers the way IN, and in Sandbox the header pill is the way OUT. Both of the
// ways this can break are silent — nothing throws, nothing logs, and the app
// looks fine in whichever mode you happen to be testing:
//
//   * an unconditional pill puts "start editing fake data" back one stray tap
//     from a teacher's thumb, on every screen, forever;
//   * an ungated menu row offers "Enter sandbox" while already in Sandbox,
//     where it does the opposite of what it says.
//
// And the third one is worse than either: the sign-in screen's own link is the
// ONLY way into Sandbox from a signed-out browser, because every other entry
// point is behind the gate. Remove it and local iteration is unreachable for
// anyone whose sandbox was off — which is everyone, by default.
//
// Run: node test-frontend-sandbox.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (ok || !detail ? '' : `\n        ${detail}`));
  ok ? pass++ : fail++;
};

// Every call site that flips the mode, so the counts below are about placement
// rather than about the toggle existing.
const toggles = (src.match(/onClick=\{[^}]*toggleSandboxMode[^}]*\}/g) || []);
check('there are exactly three ways to flip the mode',
      toggles.length === 3,
      'expected the sign-in link, the account-menu row and the header pill; found ' + toggles.length);

// ---- the pill is conditional ----
// Sliced from the header's own block: the pill and its Reset button sit inside
// one `sandboxMode && (...)`, so neither can come back unconditionally without
// this changing shape.
const headerStart = src.indexOf('{/* THE PILL ONLY EXISTS WHILE SANDBOX IS ON');
check('the header pill block is present and commented',
      headerStart !== -1,
      'the pill moved or the comment explaining why it is conditional was dropped');
const headerBlock = src.slice(headerStart, headerStart + 2600);
check('the pill renders only while sandbox is ON',
      /\{sandboxMode && \(\s*<>/.test(headerBlock),
      'an unconditional pill is the old two-state toggle coming back');
check('the pill no longer carries an OFF state',
      !/sandboxMode \? "SANDBOX" : "Sandbox"/.test(src)
        && !/background: sandboxMode \? C\.accent : "transparent"/.test(src),
      'a label or colour that still branches means the pill expects to render when off');
// Textual order is not enough here: closing the fragment early leaves Reset
// AFTER the gate and outside it, which is exactly the mistake worth catching.
// So this asserts the gate is not closed anywhere between the two.
const gateToReset = headerBlock.slice(
  headerBlock.indexOf('{sandboxMode && ('),
  headerBlock.indexOf('resetSandbox()')
);
check('Reset is inside the same conditional as the pill',
      gateToReset.length > 0 && !/<\/>\s*\)\}/.test(gateToReset),
      'Reset has no meaning outside sandbox and must not outlive the pill');

// ---- the menu row is the mirror image ----
const menuStart = src.indexOf('{!sandboxMode && (');
check('the account menu offers a way in, gated on NOT being in sandbox',
      menuStart !== -1 && /Enter sandbox/.test(src.slice(menuStart, menuStart + 1200)),
      '"Enter sandbox" while already in sandbox does the opposite of what it says');

// The two gates must be opposites. If both ever rendered at once the app would
// show a pill saying SANDBOX beside a menu row offering to enter it.
const pillGate = /\{sandboxMode && \(\s*<>[\s\S]{0,1400}?SANDBOX\n/.test(src);
const menuGate = /\{!sandboxMode && \([\s\S]{0,900}?Enter sandbox/.test(src);
check('the two controls are gated on opposite conditions',
      pillGate && menuGate,
      'exactly one of them may exist at a time');

// ---- the sign-in link ----
// Load-bearing rather than a convenience, and MORE so than before: the account
// menu does not exist until someone is signed in.
check('the sign-in screen still carries its own way into Sandbox',
      /Continue in Sandbox \(local test data\)/.test(src),
      'without it a signed-out browser can never reach Sandbox at all');
const gateIdx = src.indexOf('Continue in Sandbox (local test data)');
check('the sign-in link sits OUTSIDE the account menu',
      gateIdx < src.indexOf('Enter sandbox'),
      'it renders on the gate, which is before the header and the menu in the tree');

// ---- what must NOT have changed ----
// Sandbox grants editor rights locally and makes no network call, so it is not
// an editor-only affordance. Gating it on canEdit would take local iteration
// away from exactly the people most likely to want a safe place to look around.
check('entering sandbox is not gated on canEdit',
      !/canEdit && [\s\S]{0,200}Enter sandbox/.test(src),
      'sandbox makes no network call, so it grants nothing on the real Sheet');
check('the View-only badge is still outside the account menu',
      /!canEdit && \(\s*<span/.test(src),
      'it explains why edit controls are missing; behind a menu it cannot do that');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
