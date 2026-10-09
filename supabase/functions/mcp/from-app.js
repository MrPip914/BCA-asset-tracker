// Task due-date rules, the breaker slot label, the floor plan link carry-over and the
// floor plan geometry that decides which edges are exterior walls, COPIED VERBATIM from
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

// A floor plan replace carries links and groups onto the new plan's shapes
// by the app's own rule (replace_floor_plan).

function floorPlanPathToPoints(d) {
  const tokens = (d || "").match(/[MLAZ][^MLAZ]*/gi) || [];
  const pts = [];
  for (const tok of tokens) {
    const cmd = tok[0];
    const nums = (tok.slice(1).match(/-?\d*\.?\d+(?:[eE]-?\d+)?/g) || []).map(Number);
    if (cmd === "M" || cmd === "L") {
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
    } else if (cmd === "A") {
      for (let i = 0; i + 6 < nums.length; i += 7) pts.push([nums[i + 5], nums[i + 6]]);
    }
  }
  return pts;
}

function floorPlanRemapShapeIds(oldSpaces, newSpaces) {
  const newGids = new Set((newSpaces || []).map(s => s.gid));
  const newTitleToGid = new Map();
  (newSpaces || []).forEach(s => { if (!newTitleToGid.has(s.title)) newTitleToGid.set(s.title, s.gid); });
  const oldGidToTitle = new Map((oldSpaces || []).map(s => [s.gid, s.title]));
  return oldGid => {
    if (newGids.has(oldGid)) return oldGid;
    const title = oldGidToTitle.get(oldGid);
    return title && newTitleToGid.has(title) ? newTitleToGid.get(title) : undefined;
  };
}

function floorPlanRemapLinksAndGroups(links, groups, oldSpaces, newSpaces) {
  const remap = floorPlanRemapShapeIds(oldSpaces, newSpaces);
  // A wall's segment id is its SPACE's id plus a suffix (see floorPlanSegmentId):
  // the space survives the replace by the same rule a room link does, and the
  // suffix rides along. Whether that edge still exists, and still lies on the
  // outside, is geometry and is re-checked when the plan is drawn -- a segment
  // that no longer exists simply is not drawn, rather than the link being guessed at.
  const remapId = id => {
    const seg = floorPlanSegmentParts(id);
    if (!seg) return remap(id);
    const base = remap(seg.gid);
    return base ? floorPlanSegmentId(base, seg.edge, seg.run) : undefined;
  };
  const nextLinks = (links || [])
    .map(l => ({ ...l, shapeId: remapId(l.shapeId) }))
    .filter(l => l.shapeId);
  const nextGroups = (groups || [])
    .map(g => ({ ...g, memberShapeIds: (g.memberShapeIds || []).map(remap).filter(Boolean) }))
    .filter(g => g.memberShapeIds.length >= 2);
  return { links: nextLinks, groups: nextGroups };
}

function floorPlanSegmentId(gid, edge, run) {
  return gid + "#e" + edge + (run ? "." + run : "");
}

function floorPlanSegmentParts(id) {
  const m = /^(.*)#e(\d+)(?:\.(\d+))?$/.exec(String(id || ""));
  return m ? { gid: m[1], edge: Number(m[2]), run: m[3] ? Number(m[3]) : 0 } : null;
}

const floorPlanRound2 = n => Math.round(n * 100) / 100;

function floorPlanParseTransform(attrValue) {
  const tr = /translate\(\s*([-\d.eE]+)[ ,]+([-\d.eE]+)\s*\)/.exec(attrValue || "");
  const ro = /rotate\(\s*([-\d.eE]+)/.exec(attrValue || "");
  return { tx: tr ? +tr[1] : 0, ty: tr ? +tr[2] : 0, rot: ro ? +ro[1] : 0 };
}

function floorPlanApplyTransform(t, x, y) {
  const r = (t.rot * Math.PI) / 180;
  return [t.tx + x * Math.cos(r) - y * Math.sin(r), t.ty + x * Math.sin(r) + y * Math.cos(r)];
}

function floorPlanApplyChain(chain, x, y) {
  let px = x, py = y;
  for (const t of chain) { const [nx, ny] = floorPlanApplyTransform(t, px, py); px = nx; py = ny; }
  return [px, py];
}

function floorPlanPointInPoly(p, poly) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

function floorPlanBbox(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

function floorPlanRotatePoint(x, y, turns) {
  const t = ((turns % 4) + 4) % 4;
  return t === 1 ? [-y, x] : t === 2 ? [-x, -y] : t === 3 ? [y, -x] : [x, y];
}

function floorPlanRotateSpaces(spaces, turns) {
  const t = ((turns % 4) + 4) % 4;
  if (!t) return spaces;
  const rot = (x, y) => floorPlanRotatePoint(x, y, t);
  return spaces.map(sp => {
    const pts = sp.pts.map(p => rot(p[0], p[1]));
    const [px, py] = rot(sp.pole.x, sp.pole.y);
    return { ...sp, pts, pole: { ...sp.pole, x: px, y: py }, bbox: floorPlanBbox(pts) };
  });
}

function floorPlanIsSegmentId(id) {
  return !!floorPlanSegmentParts(id);
}

function floorPlanExteriorSegments(spaces) {
  const list = (spaces || []).filter(sp => sp && sp.pts && sp.pts.length >= 3);
  if (!list.length) return [];
  const all = floorPlanBbox(list.flatMap(sp => sp.pts));
  const eps = Math.max(all.w, all.h) * 0.006;
  const inBox = (bb, p) => p[0] >= bb.x && p[0] <= bb.x + bb.w && p[1] >= bb.y && p[1] <= bb.y + bb.h;
  const out = [];
  list.forEach(sp => {
    const pts = sp.pts;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      let nx = -dy / len, ny = dx / len;
      // Outward is whichever side is NOT inside this space itself.
      if (floorPlanPointInPoly([(a[0] + b[0]) / 2 + nx * eps, (a[1] + b[1]) / 2 + ny * eps], pts)) { nx = -nx; ny = -ny; }
      const cells = Math.max(1, Math.min(24, Math.ceil(len / (eps * 4))));
      const exposed = [];
      for (let c = 0; c < cells; c++) {
        const t = (c + 0.5) / cells;
        const probe = [a[0] + dx * t + nx * eps, a[1] + dy * t + ny * eps];
        exposed.push(!list.some(o => o !== sp && inBox(o.bbox || floorPlanBbox(o.pts), probe) && floorPlanPointInPoly(probe, o.pts)));
      }
      const runs = [];
      for (let c = 0; c < cells;) {
        if (!exposed[c]) { c++; continue; }
        const start = c;
        while (c < cells && exposed[c]) c++;
        runs.push([start, c]);
      }
      runs.forEach(([s0, e0], r) => {
        const whole = runs.length === 1 && s0 === 0 && e0 === cells;
        out.push({
          id: floorPlanSegmentId(sp.gid, i, whole ? 0 : r + 1), gid: sp.gid, edge: i,
          a: [a[0] + (dx * s0) / cells, a[1] + (dy * s0) / cells],
          b: [a[0] + (dx * e0) / cells, a[1] + (dy * e0) / cells],
        });
      });
    }
  });
  return out;
}

function floorPlanSetWallSegments(links, wallId, segmentIds, stamp) {
  const wanted = [...new Set(segmentIds || [])];
  const owner = new Map();
  (links || []).forEach(l => { if (floorPlanIsSegmentId(l.shapeId)) owner.set(l.shapeId, l.roomId); });
  const taken = wanted.filter(id => owner.has(id) && owner.get(id) !== wallId);
  const ok = wanted.filter(id => !taken.includes(id));
  const kept = (links || []).filter(l => !(floorPlanIsSegmentId(l.shapeId) && l.roomId === wallId));
  return { links: kept.concat(ok.map(shapeId => ({ shapeId, roomId: wallId, ...(stamp || {}) }))), taken };
}

export {
  MAINTENANCE_FREQUENCIES, WEEKDAY_NAMES, formatRecurrence, describeRecurrence, recurrenceApproxDays,
  TASK_KIND_SCHEDULED, TASK_KIND_ONEOFF, parseRecurrence, dateOnly,
  taskKindOf, isOneOffTask, taskIsDone, taskDueDate, maintenanceStatusOf, cellsLabel_,
  floorPlanRemapLinksAndGroups, floorPlanPathToPoints,
  floorPlanRound2, floorPlanParseTransform, floorPlanApplyChain, floorPlanBbox, floorPlanPointInPoly, floorPlanRotateSpaces,
  floorPlanSegmentId, floorPlanSegmentParts, floorPlanIsSegmentId, floorPlanExteriorSegments, floorPlanSetWallSegments,
};
