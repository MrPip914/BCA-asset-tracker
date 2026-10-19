// Task types, work types and their custom fields (the app's WORK MODEL, stored
// in the Config blob `workModel`) as the connector's tools use them. The RULES
// (which fields a type has, which are required, which built-ins are switched
// off, how a record with no type resolves) are the app's own, generated into
// app-rules.js; this file only turns what a person typed into a record the app
// would have written, and reports the model back.
//
// Pure: handed the inventory and arguments, it touches nothing. The error class
// is passed in because tools.js owns ToolError and imports this file.

import {
  adoptWorkModel, customFieldsFor, requiredCustomFieldsFor, validateCustomValues, resolveWorkTypeId,
  workBuiltinShown, defaultWorkTypeId, taskTypeNameOf, WORK_BUILTIN_FIELDS, DEFAULT_WORK_TYPE_ID, DEFAULT_WORK_TYPE_NAME,
} from "./app-rules.js";

const norm = (s) => String(s ?? "").trim().toLowerCase();

export const modelOf = (inv) => adoptWorkModel(inv.cfg.workModel);

export function makeWorkModelTools(ToolError) {
  // The id of the task type a person named (its name or id), "" for the
  // built-in Default (or no type at all). A task keeps `taskType: ""` when it
  // takes the default, exactly as the app's form does.
  function resolveTaskType(model, text) {
    const t = String(text ?? "").trim();
    if (!t || norm(t) === norm(DEFAULT_WORK_TYPE_NAME) || t === DEFAULT_WORK_TYPE_ID) return "";
    const hit = model.taskTypes.find((x) => x.id === t) || model.taskTypes.find((x) => norm(x.name) === norm(t));
    if (hit) return hit.id;
    throw new ToolError(`"${t}" is not one of this site's task types: ${["Default", ...model.taskTypes.map((x) => x.name)].join(", ")}.`);
  }

  // The custom values a record ends up with: what it already had, with the
  // given ones laid over (a field by its key or its label). A value for a
  // field the type does not carry is refused rather than dropped, so a typo
  // cannot report success while the value never lands.
  function mergeCustom(model, kind, typeId, existing, given, typeLabel) {
    const out = { ...(existing && typeof existing === "object" && !Array.isArray(existing) ? existing : {}) };
    if (given === undefined || given === null) return out;
    if (typeof given !== "object" || Array.isArray(given)) throw new ToolError("`custom` is an object of field name: value, e.g. { \"Part number\": \"X-12\" }.");
    const fields = customFieldsFor(model, kind, typeId);
    for (const [name, raw] of Object.entries(given)) {
      const f = fields.find((x) => x.key === name) || fields.find((x) => norm(x.label) === norm(name));
      if (!f) {
        throw new ToolError(`${typeLabel} has no custom field "${name}". Its fields: ${fields.map((x) => x.label).join(", ") || "(none)"}. get_schema lists them.`);
      }
      out[f.key] = raw === null || raw === undefined ? "" : String(raw).trim();
    }
    return out;
  }

  const typeLabel = (model, kind, typeId, workTypeName) => {
    if (kind === "work") return `The work type "${workTypeName || DEFAULT_WORK_TYPE_NAME}"`;
    return `The task type "${taskTypeNameOf(model, resolveWorkTypeId(model, "task", typeId)) || DEFAULT_WORK_TYPE_NAME}"`;
  };

  // The app switches a built-in field off per type: it is not offered, so a
  // value for it is refused. `values` is { builtinKey: value }.
  function checkBuiltins(model, kind, typeId, values, label) {
    const names = Object.fromEntries(WORK_BUILTIN_FIELDS[kind].map((f) => [f.key, f.label]));
    for (const [key, v] of Object.entries(values)) {
      if (String(v ?? "").trim() === "") continue;
      if (!workBuiltinShown(model, kind, typeId, key)) {
        throw new ToolError(`${label} has "${names[key]}" switched off, so it cannot take one. Leave it out, or change the type.`);
      }
    }
  }

  // A record's custom values as the person reads them: field label -> value,
  // only for fields its type carries and that have a value.
  function labelled(model, kind, typeId, custom) {
    const v = custom && typeof custom === "object" ? custom : {};
    const out = {};
    for (const f of customFieldsFor(model, kind, typeId)) {
      const val = v[f.key];
      if (val !== undefined && val !== null && String(val).trim() !== "") out[f.label] = String(val);
    }
    return Object.keys(out).length ? out : undefined;
  }

  // The first problem with a record's custom values, thrown as a refusal.
  function validateOrThrow(model, kind, typeId, custom, label) {
    const err = validateCustomValues(model, kind, typeId, custom);
    if (err) throw new ToolError(`${label}: ${err}`);
  }

  const describeFields = (model, kind, typeId) => {
    const required = new Set(requiredCustomFieldsFor(model, kind, typeId));
    return customFieldsFor(model, kind, typeId).map((f) => ({
      key: f.key, label: f.label, dataType: f.dataType,
      choices: f.dataType === "select" ? f.options : undefined,
      required: required.has(f.key) || undefined,
    }));
  };
  const hiddenOf = (model, kind, typeId) =>
    WORK_BUILTIN_FIELDS[kind].filter((f) => !workBuiltinShown(model, kind, typeId, f.key)).map((f) => f.label);

  // What get_schema reports: the managed types and what each carries.
  function schemaFor(model, workTypeNames) {
    const entry = (kind, id, name) => ({
      id: id === DEFAULT_WORK_TYPE_ID ? undefined : id, name,
      customFields: describeFields(model, kind, id),
      switchedOff: hiddenOf(model, kind, id),
    });
    const taskDefault = defaultWorkTypeId(model, "task");
    const workDefault = defaultWorkTypeId(model, "work");
    return {
      tasks: {
        defaultType: taskDefault === DEFAULT_WORK_TYPE_ID ? DEFAULT_WORK_TYPE_NAME : taskTypeNameOf(model, taskDefault),
        types: [entry("task", DEFAULT_WORK_TYPE_ID, DEFAULT_WORK_TYPE_NAME), ...model.taskTypes.map((t) => entry("task", t.id, t.name))],
        note: "A task with no type is the default type. Give `task_type` (a name from here) and `custom` ({ field name: value }) when adding or editing a task.",
      },
      work: {
        defaultType: workDefault === DEFAULT_WORK_TYPE_ID ? DEFAULT_WORK_TYPE_NAME : workDefault,
        types: [entry("work", DEFAULT_WORK_TYPE_ID, DEFAULT_WORK_TYPE_NAME), ...workTypeNames.map((n) => entry("work", n, n))],
        note: "The work type is the existing `work_type`; give `custom` ({ field name: value }) for its custom fields.",
      },
    };
  }

  return { resolveTaskType, mergeCustom, typeLabel, checkBuiltins, labelled, validateOrThrow, schemaFor };
}
