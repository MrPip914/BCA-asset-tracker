// Guards the deploy DOCUMENTATION against the drift that has already cost real deploys.
//
// Every deploy defect found on 2026-09-10 was prose restating something deploy.mjs
// already prints, left behind when the tool or the tenant list moved:
//
//   * /deploy told Eric to watch for "Live backend is now vNN." — a string the tool has
//     never printed — so a failed deploy and a good one read identically.
//   * DEPLOY.md said a bare `node deploy.mjs` refuses, then handed out three bare ones.
//   * DEPLOY.md's branch procedure predated the dev tenant and sent branches at a school.
//
// None of those are catchable by reading, because the doc and the tool are never open at
// the same time. So this asserts the three things a doc can get wrong about the tool: the
// command shape, the output it tells you to look for, and which tenants exist — plus the
// structural rule that stops a fifth copy of the procedure appearing.
//
// It deliberately does NOT check prose for correctness. Only claims that can be
// mechanically checked against deploy.mjs and clients.js are in scope.
//
// Run: node test-deploy-docs.js   (exits non-zero on failure)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = __dirname;
const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');

// Every file that tells anyone how to deploy. Adding a fifth is exactly the thing that
// caused this, so a new one belongs in this list on the day it is written.
const DOCS = [
  'CLAUDE.md',
  'DEPLOY.md',
  'cloudshell-deploy.md',
  '.claude/commands/deploy.md',
  // The workflow runs the procedure rather than describing it to a person, but it
  // is still a file that says how to deploy — and the one that will be copied from
  // if a second automated path is ever added. Same list, same rules.
  '.github/workflows/deploy-backend.yml',
];

// The workflow is also checked on its own terms further down; named here so those
// checks and the DOCS entry cannot drift apart.
const WORKFLOW = '.github/workflows/deploy-backend.yml';

const DEPLOY_SRC = read('deploy.mjs');

let pass = 0, fail = 0;
const check = (name, problems) => {
  const ok = problems.length === 0;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  for (const p of problems) console.log('        ' + p);
  ok ? pass++ : fail++;
};

// ---------------------------------------------------------------- tenant registry

// Read clients.js the way deploy.mjs does — evaluated, not regexed — so the test and the
// tool can never disagree about which tenants exist.
const TENANTS = (() => {
  const ctx = { window: { location: { search: '', pathname: '/' } }, URLSearchParams };
  vm.createContext(ctx);
  new vm.Script(read('clients.js'), { filename: 'clients.js' }).runInContext(ctx);
  return Object.keys(ctx.window.ASSET_TRACKER_CLIENTS);
})();

// Placeholders a doc may legitimately write instead of a real tenant id.
// `"$TENANT"` is the workflow's placeholder: the value is a validated choice
// input, and deploy.mjs refuses anything clients.js does not define, so it cannot
// resolve to the bare invocation this check exists to catch.
const PLACEHOLDERS = ['<tenant>', '<TENANT>', '<id>', '"$TENANT"'];
const FLAGS = ['--all', '--status', '--dry-run'];

const TICK = '✓';
const CROSS = '✗';
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

// ------------------------------------------------- 1. every invocation names a tenant

// A bare `node deploy.mjs` refuses once there is more than one tenant, so a doc that hands
// one out is handing out a command that cannot work. The one legitimate use is discussing
// that very refusal, which reads "a bare `node deploy.mjs`" — so that phrasing is the
// exemption, and it has to be explicit rather than incidental.
check('every `node deploy.mjs` in a doc names a tenant, a flag or a placeholder', (() => {
  const problems = [];
  for (const doc of DOCS) {
    const text = read(doc);
    const re = /node deploy\.mjs/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 30), m.index);
      if (/\bbare\s+`?$/.test(before)) continue;           // "a bare `node deploy.mjs`"
      const after = text.slice(m.index + m[0].length);
      // The argument may sit on the next line: prose wraps, and `node deploy.mjs
      // --status` mid-sentence is a real and correct thing to write.
      const arg = (after.match(/^[ \t\n]*([^\s`\n)]+)/) || [])[1] || '';
      const ok = TENANTS.includes(arg) || FLAGS.includes(arg) || PLACEHOLDERS.includes(arg);
      if (!ok) {
        problems.push(
          `${doc}:${lineOf(text, m.index)} — bare or unknown target ${JSON.stringify(arg)}. ` +
          `Name a tenant (${TENANTS.join(', ')}), a flag, or <tenant>.`
        );
      }
    }
  }
  return problems;
})());

// ------------------------------------------- 2. quoted tool output is real tool output

// Reduce deploy.mjs to the fixed text around its ${...} holes, with proper brace matching
// so a nested template — the ` from branch "${branch}"` ternary — keeps its own text.
const literalRuns = (src) => {
  const runs = [];
  let buf = '';
  for (let i = 0; i < src.length; i++) {
    if (src[i] === '$' && src[i + 1] === '{') {
      runs.push(buf);
      buf = '';
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        i++;
      }
      i--;
    } else {
      buf += src[i];
    }
  }
  runs.push(buf);
  return runs;
};
const SOURCE_TEXT = literalRuns(DEPLOY_SRC).join('\n');

const HOLE = '@@HOLE@@';

// A doc quoting a success or failure line must quote one the tool can actually emit. The
// parts that vary per run — the tenant, the version, any <placeholder> — are blanked out;
// every fixed fragment between them has to appear verbatim in deploy.mjs.
check(`every ${TICK}/${CROSS} line quoted in a doc exists in deploy.mjs`, (() => {
  const problems = [];
  const tenantRe = new RegExp(`\\b(${TENANTS.join('|')})\\b`, 'g');
  for (const doc of DOCS) {
    const text = read(doc);
    const re = new RegExp('`([^`\\n]*[' + TICK + CROSS + '][^`\\n]*)`', 'g');
    let m;
    while ((m = re.exec(text))) {
      const quoted = m[1];
      const shape = quoted
        // A version placeholder is written v<NN>, vNN or v34 — the leading "v" is part of
        // the hole, or the fragment before it keeps a dangling "v" and matches nothing.
        .replace(/v?<[^>]*>/g, HOLE)
        .replace(/\bv(?:NN|\d+)\b/g, HOLE)
        .replace(tenantRe, HOLE)
        .replace(new RegExp('^\\s*[' + TICK + CROSS + ']\\s*'), '');
      const missing = shape
        .split(HOLE)
        .map((s) => s.trim())
        // Only fragments with real words in them are worth asserting; punctuation and
        // single letters would match anywhere and prove nothing.
        .filter((s) => s.replace(/[^A-Za-z]/g, '').length >= 3)
        .filter((s) => !SOURCE_TEXT.includes(s));
      if (missing.length) {
        problems.push(
          `${doc}:${lineOf(text, m.index)} — quotes ${JSON.stringify(quoted)}, but ` +
          `deploy.mjs never prints ${missing.map((s) => JSON.stringify(s)).join(', ')}.`
        );
      }
    }
  }
  return problems;
})());

// -------------------------------------------------- 3. named tenants actually exist

// A doc naming a tenant clients.js does not define sends someone to a command that dies on
// "is not a tenant in clients.js" — and a doc that misses a NEW tenant is how a school gets
// left on an old backend.
check('every tenant named in a deploy command exists in clients.js', (() => {
  const problems = [];
  for (const doc of DOCS) {
    const text = read(doc);
    const re = /node deploy\.mjs[ \t]+([a-z0-9][\w-]*)/g;
    let m;
    while ((m = re.exec(text))) {
      if (!TENANTS.includes(m[1])) {
        problems.push(
          `${doc}:${lineOf(text, m.index)} — "${m[1]}" is not a tenant. Known: ${TENANTS.join(', ')}.`
        );
      }
    }
  }
  return problems;
})());

// ------------------------------------------------------- 4. the procedure has one home

// The whole defect class came from four files each carrying a full copy of the procedure.
// cloudshell-deploy.md is the one that may; CLAUDE.md carries the two blocks Eric is
// handed. The rest must point at the walkthrough rather than grow their own Step 3 again.
check('only cloudshell-deploy.md carries the main-or-branch procedure', (() => {
  const problems = [];
  for (const doc of DOCS) {
    if (doc === 'cloudshell-deploy.md' || doc === 'CLAUDE.md') continue;
    const text = read(doc);
    if (/^#+ *Step 3/mi.test(text)) {
      problems.push(`${doc} — defines its own "Step 3"; the walkthrough owns that.`);
    }
  }
  return problems;
})());

// ------------------------------------------- 5. no doc states what is deployed

// A "vNN is DEPLOYED" line is stale the moment someone deploys, and nothing prompts anyone
// to update it. It went wrong four times in CLAUDE.md, and one of those cost a session real
// work — a scope written around "deploy v26 first" that was pure fiction. `--status` answers
// it per tenant in one command and cannot go stale, so the claim has no reason to exist.
//
// Narrating HISTORY is still fine ("v22 was once pushed over a live v24"), and so is quoting
// the tool ("bca is now v30"). What is banned is the present-tense claim about live state.
// The ban is on the PRESENT-TENSE claim, plus the "confirmed deployed" idiom this file
// used twelve times. Past-tense narration of an incident is history and stays allowed:
// "v22 was deployed over a live v24" is exactly the sort of thing worth keeping.
const STATE_CLAIMS = [
  // "v33 is PENDING A DEPLOY", "v30 is DEPLOYED", "v26 is UNDEPLOYED"
  /\bv\d+\s+is\s+(?:still\s+)?(?:DEPLOYED|UNDEPLOYED|PENDING|deployed|undeployed|pending)\b/,
  // "the live backend is v26"
  /\b(?:live\s+)?backend\s+is\s+v\d+\b/i,
  // "confirmed deployed on 2026-08-25", "confirmed live 2026-09-09"
  /\bconfirmed\s+(?:deployed|live)\b/i,
  // "is PENDING A DEPLOY"
  /\bis\s+PENDING\s+A\s+DEPLOY\b/i,
];

check('no doc claims what version is live (run --status instead)', (() => {
  const problems = [];
  for (const doc of DOCS) {
    const text = read(doc);
    text.split('\n').forEach((line, i) => {
      for (const re of STATE_CLAIMS) {
        const m = line.match(re);
        if (m) {
          problems.push(
            `${doc}:${i + 1} — states live deploy state: ${JSON.stringify(m[0])}. ` +
            `Keep the rule the version taught; get the state from \`node deploy.mjs --status\`.`
          );
          break;
        }
      }
    });
  }
  return problems;
})());

// ------------------------------------- 6. the workflow offers every tenant

// The workflow's tenant dropdown is a hand-written copy of the registry, which is
// the one thing about it that can go stale. A tenant missing from the list is a
// school that cannot be deployed to from here at all — and the symptom is an
// absence in a dropdown, which nothing else would ever catch.
check('the deploy workflow offers exactly the tenants in clients.js', (() => {
  const text = read(WORKFLOW);
  // The `options:` block belonging to the tenant input: its `- value` lines, up to
  // the first line that is not one.
  const m = text.match(/\n\s*options:\n((?:\s*-\s*[^\n]+\n)+)/);
  if (!m) return [`${WORKFLOW} — could not find the tenant input's "options:" list.`];
  const offered = m[1]
    .split('\n')
    .map((l) => (l.match(/^\s*-\s*(.+?)\s*$/) || [])[1])
    .filter(Boolean)
    .map((v) => v.replace(/^["']|["']$/g, ''));

  const problems = [];
  for (const t of TENANTS) {
    if (!offered.includes(t)) problems.push(`${WORKFLOW} — tenant "${t}" is in clients.js but not offered.`);
  }
  for (const o of offered) {
    if (!TENANTS.includes(o)) problems.push(`${WORKFLOW} — offers "${o}", which is not a tenant in clients.js.`);
  }
  return problems;
})());

// -------------------------------- 7. the workflow cannot be triggered by a fork

// This repo is PUBLIC and the workflow holds a Google credential. A pull request
// from a fork gets no secrets and cannot dispatch a workflow — but
// `pull_request_target` and `workflow_run` both run THIS file's secrets against
// code from a pull request, which is the single way a stranger could reach the
// token. Adding one would look like an ordinary convenience ("let CI deploy a PR
// to dev") and would be silent until it was abused.
check('the deploy workflow is dispatch-only (no fork-reachable trigger)', (() => {
  const text = read(WORKFLOW);
  const problems = [];
  const body = text.replace(/^\s*#.*$/gm, '');          // comments may name them
  const on = body.match(/\non:\n([\s\S]*?)\n(?=[a-z_]+:)/);
  if (!on) return [`${WORKFLOW} — could not find its "on:" block.`];
  for (const trigger of ['pull_request_target', 'workflow_run', 'pull_request', 'issue_comment']) {
    if (new RegExp(`(^|\\s)${trigger}:`).test(on[1])) {
      problems.push(
        `${WORKFLOW} — triggers on "${trigger}". Only workflow_dispatch may hold the ` +
        `deploy credential; see the threat notes at the top of that file.`
      );
    }
  }
  if (!/(^|\s)workflow_dispatch:/.test(on[1])) {
    problems.push(`${WORKFLOW} — no workflow_dispatch trigger; nothing could start a deploy.`);
  }
  return problems;
})());

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
