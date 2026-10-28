// The done circle, the repeating icon and Status as an ordinary field in views. Wiring is read as source;
// the behaviour was driven in Chromium against Sandbox. Run: node test-frontend-done-circle.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let pass = 0, fail = 0;
const check = (name, ok) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name); ok ? pass++ : fail++; };
const block = (from, to) => { const a = src.indexOf(from); return src.slice(a, src.indexOf(to, a)); };

const circle = block('function TaskDoneCircle', '// A view\'s task list');
check('the circle stops pointer and click events so it never opens the task or starts a drag', /onPointerDown=\{stop\}/.test(circle) && /e\.stopPropagation\(\); if \(onToggle\)/.test(circle));
check('the circle is checked only for a finished one-off', /isOneOffTask\(row\.item\) && taskIsDone\(row\.item\)/.test(circle));
check('without a handler the circle is disabled (view-only)', /disabled=\{!onToggle\}/.test(circle));

const list = block('function ViewTaskList', 'function KanbanBoard');
check('the list puts the circle in the task cell, before the title', /f\.key === "task" && showDone && <TaskDoneCircle/.test(list));
check('the circle is not a list column of its own', /k !== VIEW_DONE_COLUMN/.test(list));
const kb = block('function KanbanBoard', 'function ViewLiveFilterPanel');
check('a card shows the circle right before the title', /showDone && <TaskDoneCircle row=\{r\}[^>]*\/>\}\s*<div data-card-title/.test(kb));
check('the circle is not a card field row', /k !== "task" && k !== VIEW_DONE_COLUMN/.test(kb));

check('the circle is offered in the column pickers only, never as a query field', /columnFields = viewColumnFields\(fields\)/.test(src) && !/\{ key: "done"/.test(block('const VIEW_BUILTIN_FIELDS', '];')));
check('the Views tab passes the toggle to editors only', /onToggleDone=\{canEdit \? toggleTaskDone : undefined\}/.test(src));

const toggle = block('function toggleTaskDone', 'async function deleteMaintenanceItem');
check('a finished one-off is reopened', /taskIsDone\(item\)\) \{ reopenTask\(/.test(toggle));
check('completing goes through the open-subtasks / blocker guard', /guardComplete\(item\.id/.test(toggle));
check('a type that requires a work entry opens the Log work form', /=== "required"\) openMaintenanceComplete/.test(toggle));
check('other types complete in one tap and leave the dialog open', /completeTaskQuick\(item\.id, assetId, true\)/.test(toggle));
const reopen = block('async function reopenTask', '// The done circle.');
check('reopening clears the completed date and audits it', /lastPerformed: ""/.test(reopen) && /— Completed/.test(reopen) && /action: "maintenance_edited"/.test(reopen));

const dlg = block('{maintenanceModal && (() => {', 'const tIndex = taskIndexOf(assets);');
check('the dialog circle only appears when the view asked for it', /dialogView && vShow\("done"\)/.test(dlg));
check('the Mark done / Log work buttons give way to the circle', /!viewReadOnly \|\| canEdit\) && !doneRow/.test(src));
check('the header no longer says One-off or Scheduled', !/"One-off task"|"Scheduled task"|"Add one-off task"|"Add scheduled task"/.test(src));
check('a repeating task gets an icon after its name, a one-off nothing', /<span>\{maintenanceDraft\.task\}<\/span>\s*\{maintenanceDraft\.kind !== TASK_KIND_ONEOFF && <Repeat/.test(src));
check('status is no longer in the dialog header', !/\{taskStatusMeta && \(\s*<span/.test(src));
check('status is a dialog field like the others', /key: "status", label: "Status" \}/.test(block('const VIEW_DIALOG_FIELDS', '];')) && /vShow\("status"\) && taskStatusMeta\) addRow\("Status"/.test(src));
check('the read view reads the completed date from the stored task', /taskItem \? taskItem\.lastPerformed : maintenanceDraft\.lastPerformed/.test(src));
check('the pencil reseeds the draft from the stored task', /openMaintenanceEdit\(maintenanceModal\.itemId, workDialogAssetId, maintenanceModal\.viewId\); setMaintenanceModal\(m => \(\{ \.\.\.m, editView: true \}\)\)/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
