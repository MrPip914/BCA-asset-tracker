// Task due-date rules and the breaker slot label, COPIED VERBATIM from
// index.html so the connector reports exactly what the app shows. Do not
// edit them here: change index.html and re-copy. test-mcp-connector.mjs
// fails if any piece below stops matching its original.
//
// The server runs in UTC, so "overdue" can flip a few hours earlier or later
// than it does in a browser in California. Accepted: the app is the authority.

const TASK_KIND_SCHEDULED = "scheduled";

const TASK_KIND_ONEOFF = "oneoff";

const RECURRENCE_UNITS = [
  { key: "day", one: "day", many: "days", days: 1 },
  { key: "week", one: "week", many: "weeks", days: 7 },
  { key: "month", one: "month", many: "months", days: 30 },
  { key: "year", one: "year", many: "years", days: 365 },
];

const RECURRENCE_ORDINALS = [
  { key: "1", label: "First" },
  { key: "2", label: "Second" },
  { key: "3", label: "Third" },
  { key: "4", label: "Fourth" },
  { key: "-1", label: "Last" },
];

const RECURRENCE_MAX_EVERY = 999;

function recurrenceCount(v) {
  const n = Number(String(v == null ? "" : v).trim());
  return Number.isInteger(n) && n >= 1 && n <= RECURRENCE_MAX_EVERY ? n : null;
}

function parseRecurrence(str) {
  const parts = String(str || "").trim().split(":");
  if (parts[0] === "interval" && parts.length === 3) {
    const every = recurrenceCount(parts[1]);
    if (!every || !RECURRENCE_UNITS.some(u => u.key === parts[2])) return null;
    return { type: "interval", every, unit: parts[2] };
  }
  if (parts[0] === "weekday" && parts.length === 4) {
    const ordinal = Number(parts[1]);
    const weekday = Number(parts[2]);
    const every = recurrenceCount(parts[3]);
    if (!RECURRENCE_ORDINALS.some(o => Number(o.key) === ordinal)) return null;
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6 || !every) return null;
    return { type: "weekday", ordinal, weekday, every };
  }
  return null;
}

function addCalendarMonths(date, n) {
  const y = date.getFullYear();
  const m = date.getMonth() + n;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(date.getDate(), lastDay));
}

function nthWeekdayOfMonth(year, month, ordinal, weekday) {
  if (ordinal === -1) {
    const last = new Date(year, month + 1, 0);
    return new Date(last.getFullYear(), last.getMonth(), last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  return new Date(first.getFullYear(), first.getMonth(), 1 + offset + (ordinal - 1) * 7);
}

function nextRecurrenceDate(rule, last) {
  if (!rule || !last || isNaN(last.getTime())) return null;
  if (rule.type === "weekday") {
    let best = null;
    for (let dm = -1; dm <= 1; dm++) {
      const occ = nthWeekdayOfMonth(last.getFullYear(), last.getMonth() + dm, rule.ordinal, rule.weekday);
      if (!best || Math.abs(occ - last) < Math.abs(best - last)) best = occ;
    }
    return nthWeekdayOfMonth(best.getFullYear(), best.getMonth() + rule.every, rule.ordinal, rule.weekday);
  }
  if (rule.unit === "day" || rule.unit === "week") {
    const days = rule.unit === "week" ? rule.every * 7 : rule.every;
    return new Date(last.getFullYear(), last.getMonth(), last.getDate() + days);
  }
  return addCalendarMonths(last, rule.unit === "year" ? rule.every * 12 : rule.every);
}

function dateOnly(s) {
  return s ? String(s).slice(0, 10) : "";
}

function taskKindOf(item) {
  return (item && item.kind === TASK_KIND_ONEOFF) ? TASK_KIND_ONEOFF : TASK_KIND_SCHEDULED;
}

function isOneOffTask(item) { return taskKindOf(item) === TASK_KIND_ONEOFF; }

function taskIsDone(item) {
  return isOneOffTask(item) && !!dateOnly(item && item.lastPerformed);
}

function taskDueDate(item) {
  if (!item) return null;
  if (isOneOffTask(item)) {
    const d = dateOnly(item.dueDate);
    if (!d) return null;
    const due = new Date(d + "T00:00:00");
    return isNaN(due.getTime()) ? null : due;
  }
  // A custom rule (v52) wins over the day count; a blank or unreadable one
  // leaves the pre-v52 arithmetic exactly as it was.
  const rule = parseRecurrence(item.recurrence);
  if (!item.lastPerformed || (!rule && !item.frequencyDays)) return null;
  const last = new Date(dateOnly(item.lastPerformed) + "T00:00:00");
  if (isNaN(last.getTime())) return null;
  if (rule) return nextRecurrenceDate(rule, last);
  return new Date(last.getTime() + item.frequencyDays * 86400000);
}

function maintenanceStatusOf(item) {
  const oneOff = isOneOffTask(item);
  if (oneOff && taskIsDone(item)) return "done";
  const due = taskDueDate(item);
  if (!due) return oneOff ? "undated" : "never";
  const daysUntil = Math.floor((due.getTime() - Date.now()) / 86400000);
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= 14) return "due-soon";
  return "ok";
}

function cellsLabel_(breaker) {
  const cells = breaker.cells || [];
  const halvesBySlot = new Map();
  const order = [];
  cells.forEach(c => {
    const slot = c.slice(0, -1);
    const half = c.slice(-1);
    if (!halvesBySlot.has(slot)) { halvesBySlot.set(slot, new Set()); order.push(slot); }
    halvesBySlot.get(slot).add(half);
  });
  return order.map(slot => {
    const halves = halvesBySlot.get(slot);
    return halves.has("a") && halves.has("b") ? slot : `${slot}${[...halves][0]}`;
  }).join("/") || "—";
}

// Frequencies and repeat-rule wording, for the write tools (add_task).

const MAINTENANCE_FREQUENCIES = [
  { label: "Weekly", days: 7 },
  { label: "Monthly", days: 30 },
  { label: "Quarterly", days: 90 },
  { label: "Semi-Annually", days: 182 },
  { label: "Annually", days: 365 },
];

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function formatRecurrence(rule) {
  if (!rule) return "";
  return rule.type === "weekday"
    ? `weekday:${rule.ordinal}:${rule.weekday}:${rule.every}`
    : `interval:${rule.every}:${rule.unit}`;
}

function describeRecurrence(rule) {
  if (!rule) return "";
  if (rule.type === "weekday") {
    const ord = (RECURRENCE_ORDINALS.find(o => Number(o.key) === rule.ordinal) || {}).label || "";
    const day = WEEKDAY_NAMES[rule.weekday] || "";
    return rule.every === 1 ? `${ord} ${day} of every month` : `${ord} ${day}, every ${rule.every} months`;
  }
  const unit = RECURRENCE_UNITS.find(u => u.key === rule.unit);
  return rule.every === 1 ? `Every ${unit.one}` : `Every ${rule.every} ${unit.many}`;
}

function recurrenceApproxDays(rule) {
  if (!rule) return "";
  if (rule.type === "weekday") return 30 * rule.every;
  return RECURRENCE_UNITS.find(u => u.key === rule.unit).days * rule.every;
}

export {
  MAINTENANCE_FREQUENCIES, WEEKDAY_NAMES, formatRecurrence, describeRecurrence, recurrenceApproxDays,
  TASK_KIND_SCHEDULED, TASK_KIND_ONEOFF, parseRecurrence, dateOnly,
  taskKindOf, isOneOffTask, taskIsDone, taskDueDate, maintenanceStatusOf, cellsLabel_,
};
