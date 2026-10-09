// Writes app-rules.js: the app's own asset rules (types and their fields,
// names, the parent chain, data types, and the Assets import's planner),
// sliced out of index.html, so the connector's asset writes check exactly what
// the app's import checks and audit exactly what it audits.
//
//   node supabase/functions/mcp/gen-app-rules.mjs
//
// Generated rather than hand-copied: this is ~1,500 lines across ~70
// declarations, and test-mcp-connector.mjs fails when app-rules.js no longer
// matches what this script would write, so editing index.html without
// re-running it fails the build instead of drifting. The declaration list is
// the one test-frontend-import.js already evaluates the import with, plus the
// load-time adoptions the app runs before anything reads an asset.
//
// Also bakes in each tenant's asset-ID prefix from clients.js, for the
// nextAssetNumber counter the app advances when a tag is used.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
export const OUT = path.join(HERE, "app-rules.js");

// Each entry: a function name, or [declaration start, the text that ends it].
const PIECES = [
  ["const DEFAULT_PARENT_TYPES", ";"],
  ["const TYPE_REGISTRY = {", "\n};"],
  ["const TYPE_OPTIONS =", ";"],
  ["const DEFAULT_TYPES =", ";"],
  "adoptLegacyTypesList",
  ["let TYPE_SETTINGS =", ";"],
  ["let DERIVED_TYPE_SETS =", ";"],
  ["let TYPE_FIELD_COLUMNS =", ";"],
  "recomputeDerivedTypeSets",
  "applyTypeSettings",
  "typeEntryFor",
  "isLockedType",
  "ensureLockedTypes",
  "typeNameOf",
  "typeTakesParent",
  "parentTypesFor",
  "canBeParentOf",
  "isPlaceType",
  "restrictedFields",
  "fieldAppliesTo",
  ["const PERSON_NAME_ORDERS = {", 'lastFirst" };'],
  ["let PERSON_NAME_ORDER =", ";"],
  "isPersonType",
  "splitPersonName",
  "personNamePartsOf",
  "composePersonName",
  "personMatchKey",
  "nameOf",
  "personLabelsOf",
  "personNamesOf",
  ["const UNASSIGNED_LABEL", ";"],
  ["const MAX_PARENT_DEPTH", ";"],
  "parentOf",
  "ancestorsOf",
  "nearestAncestorOfType",
  "nearestPlaceNameOf",
  ["const FIXED_IN_PLACE_TYPES", ");"],
  "suggestedNameFor",
  ["const NAME_FROM_FIELD", ";"],
  "nameFromFieldOf",
  "adoptPersonNames",
  "adoptLegacyNames",
  ["const PATH_SEPARATOR", ";"],
  "pathOf",
  "parentNameFor",
  "wouldCreateCycle",
  "validateParentChoice",
  "relate",
  "dateOnly",
  "localDateString",
  ["const COLUMN_DATA_TYPES = [", "];"],
  ["const COLUMN_DATA_TYPE_VALUES", ";"],
  ["const DEFAULT_COLUMN_DATA_TYPES = {", "\n};"],
  "columnDataType",
  "columnOptions",
  "validateColumnValue",
  ["const DEFAULT_COLUMNS = [", "custom: false }));"],
  ["const RENAMED_COLUMN_KEYS", ";"],
  ["const RETIRED_COLUMN_KEYS", ";"],
  ["const IMPORT_KEY_HEADER", ";"],
  ["const IMPORT_HEADER_OVERRIDES", ";"],
  ["const IMPORT_LEGACY_HEADERS", ";"],
  "fullPathOf",
  "importHeadersFor",
  "importCellFor",
  "assetToImportRow",
  "addImportRef",
  "buildImportRefIndex",
  "indexImportRow",
  "resolveImportRef",
  "resolveImportType",
  "buildImportPeopleIndex",
  "splitImportList",
  "splitImportPeople",
  "describeImportAsset",
  "planAssetImport",
];

const EXPORTS = [
  "TYPE_REGISTRY", "DEFAULT_TYPES", "applyTypeSettings", "adoptLegacyTypesList", "ensureLockedTypes",
  "typeNameOf", "typeTakesParent", "parentTypesFor", "isPlaceType", "fieldAppliesTo", "isPersonType",
  "personMatchKey", "nameOf", "personLabelsOf", "personNamesOf", "UNASSIGNED_LABEL", "pathOf",
  "fullPathOf", "parentNameFor", "relate", "dateOnly", "adoptPersonNames", "adoptLegacyNames",
  "columnDataType", "columnOptions", "validateColumnValue", "DEFAULT_COLUMNS", "RENAMED_COLUMN_KEYS",
  "RETIRED_COLUMN_KEYS", "IMPORT_KEY_HEADER", "importHeadersFor", "planAssetImport", "PATH_SEPARATOR",
  "assetToImportRow", "resolveImportType", "isLockedType", "nearestAncestorOfType",
];

function grabber(src) {
  const fn = (name) => {
    const i = src.indexOf(`\nfunction ${name}(`);
    if (i === -1) throw new Error(`function ${name} not found in index.html`);
    let depth = 0;
    for (let k = src.indexOf("{", i); k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}" && --depth === 0) return src.slice(i + 1, k + 1);
    }
    throw new Error(`function ${name} is not closed`);
  };
  const decl = (start, end) => {
    const i = src.indexOf(start);
    if (i === -1) throw new Error(`"${start}" not found in index.html`);
    const j = src.indexOf(end, i);
    if (j === -1) throw new Error(`end of "${start}" not found`);
    return src.slice(i, j + end.length);
  };
  return { fn, decl };
}

// Each tenant's asset-ID prefix, read by evaluating clients.js the way
// deploy.mjs does: in a stub with a fake window and no DOM.
function tenantPrefixes(clientsSrc) {
  const sandbox = { window: { location: { search: "", pathname: "/" } }, URLSearchParams, console };
  vm.createContext(sandbox);
  vm.runInContext(clientsSrc, sandbox);
  const clients = sandbox.window.ASSET_TRACKER_CLIENTS;
  if (!clients) throw new Error("clients.js did not publish window.ASSET_TRACKER_CLIENTS");
  const out = {};
  for (const id of Object.keys(clients).sort()) out[id] = clients[id].labelPrefix || "";
  return out;
}

export function generate() {
  const src = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const { fn, decl } = grabber(src);
  const registry = decl("const TYPE_REGISTRY = {", "\n};");
  const icons = [...new Set([...registry.matchAll(/\bicon:\s*([A-Z]\w*)/g)].map((m) => m[1]))].sort();
  const body = PIECES.map((p) => (typeof p === "string" ? fn(p) : decl(p[0], p[1]))).join("\n\n");
  const prefixes = tenantPrefixes(fs.readFileSync(path.join(ROOT, "clients.js"), "utf8"));
  return [
    "// GENERATED from index.html by gen-app-rules.mjs. DO NOT EDIT: change",
    "// index.html and run `node supabase/functions/mcp/gen-app-rules.mjs`.",
    "// test-mcp-connector.mjs fails when this file is out of date.",
    "/* eslint-disable */",
    "// deno-lint-ignore-file",
    "",
    "// The registry names icon components; the connector draws none.",
    ...icons.map((n) => `const ${n} = null;`),
    "",
    body,
    "",
    "// Each tenant's asset-ID prefix, from clients.js.",
    `export const TENANT_LABEL_PREFIX = ${JSON.stringify(prefixes)};`,
    "",
    `export { ${EXPORTS.join(", ")} };`,
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(OUT, generate());
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}
