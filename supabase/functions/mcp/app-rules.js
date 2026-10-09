// GENERATED from index.html by gen-app-rules.mjs. DO NOT EDIT: change
// index.html and run `node supabase/functions/mcp/gen-app-rules.mjs`.
// test-mcp-connector.mjs fails when this file is out of date.
/* eslint-disable */
// deno-lint-ignore-file

// The registry names icon components; the connector draws none.
const Building2 = null;
const Camera = null;
const DoorOpen = null;
const Fence = null;
const HardDrive = null;
const Layers = null;
const MapPin = null;
const Monitor = null;
const Package = null;
const Phone = null;
const Tv = null;
const UserCircle = null;
const Zap = null;

const DEFAULT_PARENT_TYPES = ["Room"];

const TYPE_REGISTRY = {
  Computer: { icon: HardDrive, categoryIds: ["Equipment"], parentTypes: ["Room"], onlyFields: ["hostname"] },
  Monitor: { icon: Monitor, categoryIds: ["Equipment"], parentTypes: ["Room"], onlyFields: ["screenSize"] },
  Phone: { icon: Phone, categoryIds: ["Equipment"], parentTypes: ["Room"] },
  TV: { icon: Tv, categoryIds: ["Equipment"], parentTypes: ["Room"], onlyFields: ["screenSize"] },
  DocuCam: { icon: Camera, categoryIds: ["Equipment"], parentTypes: ["Room"] },
  "Stream Deck": { categoryIds: ["Equipment"], parentTypes: ["Room"] },
  "Mini Split": { categoryIds: ["Facilities"], parentTypes: ["Room"] },
  // An outdoor unit doesn't sit inside any one Room, so it sits directly in a
  // Building instead of inheriting one through a Room like every other device.
  Condenser: { categoryIds: ["Facilities"], parentTypes: ["Building"] },
  // A Room is a space, not a device — no brand/model/serial/etc. It sits in the
  // Building it's in, or inside another Room (a closet within a classroom).
  // floorPlan: true ships ON for Room, Building and Campus -- see
  // typeHasFloorPlan -- because those are the levels someone actually has a
  // drawing for: a room diagram, a building floor plan, a campus site plan.
  // It's a per-type SETTING, not fixed to these three: any type, including a
  // custom one, can have it switched on from the type editor, the same way
  // requiredFields already works (typeSettings[id].floorPlan overrides this).
  Room: {
    locked: true, icon: DoorOpen, categoryIds: ["Places"], parentTypes: ["Building", "Floor", "Room"], location: true,
    excludedFields: ["tag", "brand", "model", "serial", "peripherals", "hostname", "screenSize", "purchaseDate", "warrantyUntil"],
    floorPlan: true,
  },
  // A level of a Building, between it and its Rooms. It was a user-made type on
  // tenants that needed it (same shape as Room), promoted to a built-in so it
  // ships with its icon, location and floor-plan settings. Its id IS its name,
  // like every other built-in, so ensureLockedTypes adds it to an existing list
  // -- unless a type already named "Floor" is there, which is left as the
  // school's own (see ensureLockedTypes).
  Floor: {
    locked: true, icon: Layers, categoryIds: ["Places"], parentTypes: ["Building"], location: true,
    excludedFields: ["tag", "brand", "model", "serial", "peripherals", "hostname", "screenSize", "purchaseDate", "warrantyUntil"],
    floorPlan: true,
  },
  // One level up from a Room, with even less in common with a device asset.
  Building: {
    locked: true, icon: Building2, categoryIds: ["Places"], parentTypes: ["Campus"], location: true,
    excludedFields: ["tag", "brand", "model", "serial", "peripherals", "hostname", "screenSize", "purchaseDate", "warrantyUntil"],
    floorPlan: true,
  },
  // A site — a group of Buildings, and the top of the tree. Added once the app
  // had to describe more than one location (the school itself plus a separate
  // residence), which the old fixed Building→Room pair couldn't express at all.
  // That it was a one-entry change here, plus a column and a backend field, is
  // the parent chain paying for itself: nothing else in the app needed telling
  // that the world got a level deeper.
  Campus: {
    locked: true, icon: MapPin, categoryIds: ["Places"], parentTypes: [], location: true,
    excludedFields: ["tag", "brand", "model", "serial", "peripherals", "hostname", "screenSize", "purchaseDate", "warrantyUntil"],
    floorPlan: true,
  },
  // Tables, chairs... not individually tagged or tied to one room — a pooled
  // quantity, distributed across rooms via the Allocations tab instead. That
  // distribution is explicitly not parent/child, hence no parentTypes.
  // `subType` is its sub-type, picked from the managed bulkItemTypes list
  // (e.g. "Folding Chair", "Cafeteria Table"). Stored as `itemName` before v24;
  // see adoptLegacySubType.
  "Bulk Item": {
    locked: true, icon: Package, categoryIds: ["Equipment"], parentTypes: [], onlyFields: ["totalQuantity", "subType"],
    excludedFields: ["hostname", "screenSize", "peripherals", "serial", "person"],
    modules: ["allocations"],
  },
  // Otherwise device-like (real brand/model/serial, purchase date, warranty, room
  // placement) — it just doesn't have peripherals like a computer does.
  "Electrical Panel": {
    locked: true, icon: Zap, categoryIds: ["Facilities"], parentTypes: ["Room"], excludedFields: ["peripherals"],
    modules: ["breakers"], defaultTab: "breakers",
  },
  // A person. Users became records (v28) so an asset can point AT one by id
  // instead of storing a name string -- which is what gives a person a detail
  // page, an audit history, and a rename that costs nothing. Deliberately NOT
  // the sign-in allowlist (`authUsers`): that answers "who may open the app",
  // this answers "whose desk is this on", and the app wants people in the
  // inventory who never sign in -- a student, or someone who has left whose
  // history is still worth keeping. Linking the two is a later question.
  //
  // No parent: a person is not contained by anything this app models. No device
  // fields, and no `person` field of its own -- a user is not assigned to a user.
  // Locked because personIds now reference it structurally.
  User: {
    locked: true, icon: UserCircle, categoryIds: ["People"], parentTypes: [],
    // A PERSON TYPE is named by its own key rather than by a type-name test at
    // the render sites that care, exactly as `locked` and `modules` are. What it
    // buys: nameOf() composes this type's name from its parts, adoptLegacyNames
    // leaves it alone, and the Name column offers a first/last sort. A second
    // person-shaped type (a Student, say) gets all of that by declaring one key.
    personType: true,
    // The two halves of a person's name are the SOURCE OF TRUTH for what this
    // type is called; `name` is composed from them at render and is excluded
    // here so no form offers a third, competing field. See composePersonName.
    onlyFields: ["firstName", "lastName"],
    excludedFields: [
      "tag", "name",
      "brand", "model", "serial", "peripherals", "hostname", "screenSize",
      "purchaseDate", "warrantyUntil", "person", "subType", "totalQuantity",
    ],
  },
  // A wall is an asset in its own right, drawn on a plan as ONE OR MORE segments of
  // a space's outline (see floorPlanExteriorSegments) and selected as a single
  // thing, the way a Room is. Parented to what it bounds. `location: true` makes it
  // a place, so other assets can be filed under it (Contents tab, Location picker)
  // once their own "Can sit inside" names Wall -- Other ships doing so, the rest
  // are the school's to tick in the type editor.
  Wall: {
    locked: true, icon: Fence, categoryIds: ["Places"], parentTypes: ["Campus", "Building", "Floor", "Room"], location: true,
    excludedFields: ["tag", "brand", "model", "serial", "peripherals", "hostname", "screenSize", "purchaseDate", "warrantyUntil"],
  },
  Other: { parentTypes: ["Room", "Wall"] },
};

const TYPE_OPTIONS = Object.keys(TYPE_REGISTRY);

const DEFAULT_TYPES = TYPE_OPTIONS.map(id => ({ id, name: id }));

function adoptLegacyTypesList(list) {
  return (list || []).map(t => (typeof t === "string" ? { id: t, name: t } : t));
}

let TYPE_SETTINGS = {};

let DERIVED_TYPE_SETS = { restrictedFields: new Set(), placeTypes: new Set(), personTypes: new Set() };

let TYPE_FIELD_COLUMNS = [];

function recomputeDerivedTypeSets() {
  const ids = new Set([...Object.keys(TYPE_REGISTRY), ...Object.keys(TYPE_SETTINGS)]);
  const restricted = new Set();
  const places = new Set();
  const people = new Set();
  // A type is a LOCATION when its `location` setting says so. A type with NO
  // setting either way (every type saved before the setting existed) falls back
  // to the old derivation -- it is one if something is allowed to sit inside it --
  // so nothing needs migrating; an explicit false beats that fallback.
  const named = new Set();
  ids.forEach(id => {
    const entry = typeEntryFor(id) || {};
    (entry.onlyFields || []).forEach(k => restricted.add(k));
    (entry.parentTypes || []).forEach(t => named.add(t));
    if (entry.personType) people.add(id);
  });
  new Set([...ids, ...named]).forEach(id => {
    const entry = typeEntryFor(id) || {};
    if (typeof entry.location === "boolean") { if (entry.location) places.add(id); }
    else if (named.has(id)) places.add(id);
  });
  // A per-type field is restricted by a flag on the COLUMN, not by whoever
  // currently claims it in onlyFields. Otherwise unticking it from its last
  // owner would make it an ordinary common field and it would appear on every
  // type at once — the opposite of what "field for this type" means.
  TYPE_FIELD_COLUMNS.forEach(c => { if (c && c.restricted && c.key) restricted.add(c.key); });
  DERIVED_TYPE_SETS = { restrictedFields: restricted, placeTypes: places, personTypes: people };
}

function applyTypeSettings(next, columns) {
  TYPE_SETTINGS = next && typeof next === "object" ? next : {};
  if (Array.isArray(columns)) TYPE_FIELD_COLUMNS = columns;
  recomputeDerivedTypeSets();
}

function typeEntryFor(typeId) {
  const base = TYPE_REGISTRY[typeId];
  const over = TYPE_SETTINGS[typeId];
  if (!base && !over) return null;
  return { ...(base || {}), ...(over || {}) };
}

function isLockedType(typeId) {
  return !!TYPE_REGISTRY[typeId]?.locked;
}

function ensureLockedTypes(list) {
  const have = new Set(list.map(t => t.id));
  // A type the school made itself and named the same (a uuid-id "Floor") stands
  // in for the built-in: adding a second "Floor" would put two identical names
  // in every picker.
  const haveName = new Set(list.map(t => String(t.name || "").trim().toLowerCase()));
  const missing = TYPE_OPTIONS.filter(id => isLockedType(id) && !have.has(id) && !haveName.has(id.toLowerCase()));
  if (missing.length === 0) return list; // reference-stable: persist()'s _dirty check compares by identity
  // Put each one back where the registry says it belongs, rather than appending.
  // Appending is what User did on arrival: it landed below "Other" at the very
  // bottom of the picker, reading as an afterthought instead of a peer of Room
  // and Building — and on a stored list it was the ONE entry below the catch-all,
  // which is where the eye stops looking. Existing entries keep their order; a
  // missing type slots in before the next registry sibling already present, so
  // only the new arrival moves.
  const out = [...list];
  missing.forEach(id => {
    const after = TYPE_OPTIONS.slice(TYPE_OPTIONS.indexOf(id) + 1);
    const at = out.findIndex(t => after.includes(t.id));
    const entry = { id, name: id };
    if (at === -1) out.push(entry); else out.splice(at, 0, entry);
  });
  return out;
}

function typeNameOf(typeId, typesList) {
  const found = (typesList || []).find(t => t.id === typeId);
  return found ? found.name : (typeId || "");
}

function typeTakesParent(type) {
  return parentTypesFor(type).length > 0;
}

function parentTypesFor(type) {
  const entry = typeEntryFor(type);
  return entry ? (entry.parentTypes || []) : DEFAULT_PARENT_TYPES;
}

function canBeParentOf(parentType, childType) {
  return parentTypesFor(childType).includes(parentType);
}

function isPlaceType(type) {
  return DERIVED_TYPE_SETS.placeTypes.has(type);
}

function restrictedFields() {
  return DERIVED_TYPE_SETS.restrictedFields;
}

function fieldAppliesTo(key, type) {
  // The Parent field exists only for a type that can actually sit inside
  // something — a Building (top of the tree) and a Bulk Item (spreads across
  // rooms via allocations) get no Parent picker at all.
  if (key === "parent") return typeTakesParent(type);
  const entry = typeEntryFor(type);
  if (entry?.excludedFields?.includes(key)) return false;
  if (!restrictedFields().has(key)) return true; // common field, applies to every type
  return !!entry?.onlyFields?.includes(key);
}

const PERSON_NAME_ORDERS = { firstLast: "firstLast", lastFirst: "lastFirst" };

let PERSON_NAME_ORDER = PERSON_NAME_ORDERS.firstLast;

function isPersonType(type) {
  return DERIVED_TYPE_SETS.personTypes.has(type);
}

function splitPersonName(full) {
  const raw = String(full || "").trim();
  // "Smith, John" first, because this app now WRITES that spelling: a name
  // captured while the list was sorted by surname -- a filter value, a picker
  // choice, an audit row -- comes back through here, and splitting it on the
  // last space would make the surname "Smith," and never match the person it
  // names. It is also how someone would type a name into a legacy free-text
  // field, so reading it costs nothing and is right more often than not.
  // The FIRST comma splits: anything after it (a suffix, a middle name) belongs
  // with the given name, which is the same choice the space form makes.
  const comma = raw.indexOf(",");
  if (comma !== -1) {
    const last = raw.slice(0, comma).trim();
    const first = raw.slice(comma + 1).trim().replace(/\s+/g, " ");
    if (last && first) return { firstName: first, lastName: last };
  }
  const parts = raw.split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

function personNamePartsOf(asset) {
  const first = String(asset?.firstName || "").trim();
  const last = String(asset?.lastName || "").trim();
  if (first || last) return { firstName: first, lastName: last };
  return splitPersonName(asset?.name);
}

function composePersonName(firstName, lastName, order) {
  const first = String(firstName || "").trim();
  const last = String(lastName || "").trim();
  if (!first) return last;
  if (!last) return first;
  return (order || PERSON_NAME_ORDER) === PERSON_NAME_ORDERS.lastFirst
    ? `${last}, ${first}`
    : `${first} ${last}`;
}

function personMatchKey(nameOrParts) {
  const { firstName, lastName } = typeof nameOrParts === "string"
    ? splitPersonName(nameOrParts)
    : personNamePartsOf(nameOrParts);
  return `${firstName} ${lastName}`.trim().toLowerCase().replace(/\s+/g, " ");
}

function nameOf(asset, typesList) {
  // A person is called by their parts, composed in whichever order the app is
  // currently reading in. Checked FIRST and never falling back to a stored
  // `name` while a part exists: a User's `name` cell still holds the pre-split
  // string and rides along untouched (the same way `label` rides under `tag`),
  // so preferring it would show the old spelling forever.
  if (isPersonType(asset?.type)) {
    const { firstName, lastName } = personNamePartsOf(asset);
    const composed = composePersonName(firstName, lastName);
    if (composed) return composed;
  }
  const name = (asset?.name || "").trim();
  if (name) return name;
  // The tag second, which is what `label` used to serve as here.
  const tag = (asset?.tag || "").trim();
  if (tag) return tag;
  // Nothing left. Built in the same shape describeAuditFor() uses for an asset
  // that has been deleted -- "<type> <short id>" -- so the one case reads like
  // the other rather than as a bare uuid.
  //
  // This is a genuine last resort: adoptLegacyNames() fills a blank name on every
  // asset it loads, so nothing off the sheet reaches here. What does is an
  // in-session object that never went through that map -- an add-form draft,
  // mostly -- which is exactly when a placeholder is wanted.
  //
  // `typesList` is optional and its absence degrades rather than breaks:
  // typeNameOf falls back to the type ID, and a built-in type's id IS its name,
  // so only a user-created type reads as a uuid at a site that had no list to
  // pass. Worth knowing before threading it somewhere new.
  const type = typeNameOf(asset?.type, typesList);
  const shortId = String(asset?.id || "").slice(0, 8);
  return `${type} ${shortId}`.trim();
}

function personLabelsOf(asset) {
  const ids = asset && asset.personIds;
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

function personNamesOf(asset, assets) {
  const ids = personLabelsOf(asset);
  if (ids.length) {
    return ids.map(id => {
      const u = (assets || []).find(a => a.id === id);
      return u ? nameOf(u) : "(deleted user)";
    });
  }
  return String((asset && asset.person) || "").split("/").map(s => s.trim()).filter(Boolean);
}

const UNASSIGNED_LABEL = "Unassigned";

const MAX_PARENT_DEPTH = 50;

function parentOf(asset, assets) {
  if (!asset || !asset.parentId) return null;
  return (assets || []).find(a => a.id === asset.parentId) || null;
}

function ancestorsOf(asset, assets) {
  const out = [];
  const seen = new Set(asset?.id ? [asset.id] : []);
  let cur = parentOf(asset, assets);
  while (cur && !seen.has(cur.id) && out.length < MAX_PARENT_DEPTH) {
    out.push(cur);
    seen.add(cur.id);
    cur = parentOf(cur, assets);
  }
  return out;
}

function nearestAncestorOfType(asset, assets, type) {
  return ancestorsOf(asset, assets).find(a => a.type === type) || null;
}

function nearestPlaceNameOf(asset, assets) {
  const place = ancestorsOf(asset, assets).find(p => isPlaceType(p.type));
  return place ? nameOf(place) : "";
}

const FIXED_IN_PLACE_TYPES = new Set(["Mini Split", "Condenser", "Electrical Panel"]);

function suggestedNameFor(asset, assets, typesList) {
  const typeId = (asset?.type || "").trim();
  if (!typeId) return "";
  // The type's NAME, never its id. A built-in type's id IS its original name, so
  // this read identically until the first user-created type — whose id is a raw
  // uuid — named its assets "54da0bb7-d2d9-… BCA0090". typeNameOf falls back to
  // the id, which keeps a type missing from the managed list readable.
  const type = typeNameOf(typeId, typesList);
  // Matched against the ID: FIXED_IN_PLACE_TYPES names built-ins, whose ids are
  // their names, and matching on a resolved name would let a renamed type slip
  // out of the set (or an unrelated one collide into it).
  if (FIXED_IN_PLACE_TYPES.has(typeId)) {
    const place = nearestPlaceNameOf(asset, assets);
    if (place) return `${place} ${type}`;
  }
  return `${type} ${asset.tag || String(asset.id || "").slice(0, 8)}`.trim();
}

const NAME_FROM_FIELD = { "Bulk Item": "subType" };

function nameFromFieldOf(a) {
  const key = NAME_FROM_FIELD[a?.type];
  return key ? String(a[key] || "").trim() : "";
}

function adoptPersonNames(list) {
  return list.map(a => {
    if (!isPersonType(a.type)) return a;
    if (String(a.firstName || "").trim() || String(a.lastName || "").trim()) return a;
    const { firstName, lastName } = splitPersonName(a.name);
    if (!firstName && !lastName) return a;
    return { ...a, firstName, lastName };
  });
}

function adoptLegacyNames(list, typesList) {
  // A person type is skipped outright: its name is composed from its parts, and
  // giving it a stored `name` here would write "User BCA0090" into the sheet for
  // every person -- invisible while nameOf prefers the parts, and waiting to
  // surface the day anything reads the column directly.
  const stillBlank = a => !isPersonType(a.type) && !(a.name || "").trim();
  // 1. A Bulk Item with no name of its own takes a copy of its sub-type
  //    ("Chairs"), which is what it was called before Sub-Type went back to
  //    being purely a category.
  const stored = list.map(a => {
    if (!stillBlank(a)) return a;
    const fromField = nameFromFieldOf(a);
    return fromField ? { ...a, name: fromField } : a;
  });
  // 2. Places next, so a nameless room has a name of its own before anything
  //    inside it is named after it.
  const places = stored.map(a => (stillBlank(a) && isPlaceType(a.type)) ? { ...a, name: suggestedNameFor(a, stored, typesList) } : a);
  // 3. Everything else, resolved against a list whose places are all named.
  return places.map(a => stillBlank(a) ? { ...a, name: suggestedNameFor(a, places, typesList) } : a);
}

const PATH_SEPARATOR = " › ";

function pathOf(asset, assets) {
  if (!asset) return "";
  return ancestorsOf(asset, assets).map(a => nameOf(a)).reverse().join(PATH_SEPARATOR);
}

function parentNameFor(parentId, assets) {
  if (!parentId) return "";
  const p = (assets || []).find(a => a.id === parentId);
  return p ? nameOf(p) : "(deleted asset)";
}

function wouldCreateCycle(childId, parentId, assets) {
  if (!parentId || !childId) return false;
  if (parentId === childId) return true;
  const parent = (assets || []).find(a => a.id === parentId);
  if (!parent) return false;
  return ancestorsOf(parent, assets).some(a => a.id === childId);
}

function validateParentChoice(childId, childType, parentId, assets, typesList) {
  if (!parentId) return null;
  const own = typeNameOf(childType, typesList);
  if (!typeTakesParent(childType)) return `A ${own} doesn't sit inside anything.`;
  const parent = (assets || []).find(a => a.id === parentId);
  if (!parent) return "That location no longer exists — pick another.";
  if (!canBeParentOf(parent.type, childType)) {
    const allowed = parentTypesFor(childType).map(t => typeNameOf(t, typesList)).join(" or ");
    return `A ${own} can't sit inside a ${typeNameOf(parent.type, typesList)}. It can go in: ${allowed}.`;
  }
  if (wouldCreateCycle(childId, parentId, assets)) {
    return `That would put ${nameOf(parent)} inside itself — it's already somewhere below this asset.`;
  }
  return null;
}

function relate(pairs) {
  return Object.entries(pairs || {})
    .flatMap(([role, ids]) => (Array.isArray(ids) ? ids : [ids])
      .filter(Boolean)
      .map(id => `${id}:${role}`))
    .join(",");
}

function dateOnly(s) {
  return s ? String(s).slice(0, 10) : "";
}

function localDateString(d) {
  const dt = d || new Date();
  if (isNaN(dt.getTime())) return "";
  return dt.getFullYear() + "-" +
    String(dt.getMonth() + 1).padStart(2, "0") + "-" +
    String(dt.getDate()).padStart(2, "0");
}

const COLUMN_DATA_TYPES = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Choice list" },
  { value: "reference", label: "Reference" },
];

const COLUMN_DATA_TYPE_VALUES = new Set(COLUMN_DATA_TYPES.map(t => t.value));

const DEFAULT_COLUMN_DATA_TYPES = {
  purchaseDate: "date",
  warrantyUntil: "date",
  totalQuantity: "number",
  notes: "textarea",
};

function columnDataType(col) {
  if (!col) return "text";
  if (col.dataType && COLUMN_DATA_TYPE_VALUES.has(col.dataType)) return col.dataType;
  return DEFAULT_COLUMN_DATA_TYPES[col.key] || "text";
}

function columnOptions(col) {
  return Array.isArray(col?.options) ? col.options.filter(o => String(o).trim() !== "") : [];
}

function validateColumnValue(col, raw) {
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value === "" || value === null || value === undefined) return "";
  const kind = columnDataType(col);
  if (kind === "number") {
    // Number(" ") is 0 and Number("") is 0, which is why the blank check above
    // has to come first rather than being folded in here.
    if (!isFinite(Number(value))) return `${col.label} must be a number.`;
    return "";
  }
  if (kind === "date") {
    // dateOnly first: a value that round-tripped through the Sheet before the
    // plain-text fix comes back as a full ISO timestamp, and that is a valid
    // date being displayed oddly, not bad data to refuse.
    const d = dateOnly(String(value));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${col.label} must be a date (YYYY-MM-DD).`;
    // Round-tripped, not just parsed. `new Date("2026-02-31")` is not NaN — it
    // rolls silently over to March 3rd, so a plain isNaN check accepts every
    // impossible date there is and then stores a different day than was typed.
    // UTC throughout, or a browser west of Greenwich shifts the day and every
    // date fails validation on that machine alone.
    const [yy, mm, dd] = d.split("-").map(Number);
    const parsed = new Date(Date.UTC(yy, mm - 1, dd));
    if (parsed.getUTCFullYear() !== yy || parsed.getUTCMonth() !== mm - 1 || parsed.getUTCDate() !== dd) {
      return `${col.label} is not a real date.`;
    }
    return "";
  }
  if (kind === "select") {
    const opts = columnOptions(col);
    // An empty option list means the column is misconfigured, not that every
    // value is wrong — refusing here would make the field unsaveable with no
    // way to fix it from the form.
    if (opts.length && !opts.includes(String(value))) {
      return `${col.label} must be one of: ${opts.join(", ")}.`;
    }
    return "";
  }
  return "";
}

const DEFAULT_COLUMNS = [
  // Every asset's own name, optional and freeform. Sits ahead of Type because
  // it's what you scan for; Type answers "what kind of thing is this", which is
  // a narrower question and no longer doubles as the name (see nameOf).
  { key: "name", label: "Name", width: 200 },
  // The two halves of a person's name, restricted to person types by User's
  // `onlyFields` — so they are the Name field's replacement on that form and
  // appear nowhere else. HIDDEN by default in the list: Name already shows them
  // composed, and a column that is empty on every device, room and building
  // would be two mostly-blank columns bought for nothing. Sorting by surname
  // does NOT need them shown -- set Name format to "Last, First" and sort the
  // Name column -- so switching these on is for reading or exporting the raw
  // parts, not for ordering the list.
  { key: "firstName", label: "First Name", width: 140 },
  { key: "lastName", label: "Last Name", width: 140 },
  { key: "type", label: "Type", width: 140 },
  { key: "subType", label: "Sub-Type", width: 150 },
  { key: "screenSize", label: "Screen Size", width: 110 },
  { key: "totalQuantity", label: "Total Qty", width: 100 },
  // One location column showing the whole chain (see pathOf). Its KEY is
  // "parent" because that's the field it edits — the form renders a picker for
  // the immediate parent here, while the list and detail read it out in full.
  { key: "parent", label: "Path", width: 240 },
  // Campus, Building and Room are NOT columns. Path says the same thing more
  // completely (it never drops the middle of a chain), and the two reasons they
  // were kept when Path replaced them have both expired: each used to be the NAME
  // field of its own type, which `name` took over in v23, and the Room filter used
  // to be what the bulk "Move filtered to room" toolbar hung off, which now reads
  // the HierarchyNav scope instead. They live on in the EXPORT, which builds them
  // itself (see exportToExcel) rather than walking this list — a spreadsheet is
  // where you group by building, and one Path string can't be grouped.
  { key: "person", label: "User", width: 170 },
  { key: "brand", label: "Brand", width: 120 },
  { key: "model", label: "Model", width: 180 },
  { key: "serial", label: "Serial", width: 180 },
  { key: "hostname", label: "Hostname", width: 160 },
  { key: "purchaseDate", label: "Purchase Date", width: 130 },
  { key: "warrantyUntil", label: "Warranty Until", width: 130 },
  { key: "peripherals", label: "Peripherals", width: 240 },
  { key: "notes", label: "Notes", width: 240 },
  // The sticker on the thing. OPTIONAL as of v32, and absent entirely on a type
  // whose registry entry excludes it (Room/Building/Campus/User by default,
  // switchable per type in the type editor). Its key was "label" while it was
  // also the primary key; RENAMED_COLUMN_KEYS migrates a stored config.
  { key: "tag", label: "Asset ID", width: 110 },
  { key: "status", label: "Status", width: 100 },
].map(c => ({ ...c, visible: ["name", "type", "subType", "parent", "person", "status"].includes(c.key), custom: false }));

const RENAMED_COLUMN_KEYS = { itemName: "subType", label: "tag" };

const RETIRED_COLUMN_KEYS = new Set(["campus", "building", "room"]);

const IMPORT_KEY_HEADER = "Asset Key";

const IMPORT_HEADER_OVERRIDES = { parent: "Location Path" };

const IMPORT_LEGACY_HEADERS = { parent: ["Parent Path"] };

function fullPathOf(asset, assets) {
  if (!asset) return "";
  const above = pathOf(asset, assets);
  return above ? above + PATH_SEPARATOR + nameOf(asset) : nameOf(asset);
}

function importHeadersFor(columns) {
  const used = new Set([IMPORT_KEY_HEADER]);
  return (columns || []).map(c => {
    const label = String(IMPORT_HEADER_OVERRIDES[c.key] || c.label || "").trim();
    const header = !label || used.has(label) ? c.key : label;
    used.add(header);
    return { header, key: c.key, col: c };
  });
}

function importCellFor(asset, key, ctx) {
  const { assets, typesList } = ctx;
  // Name is resolved BEFORE the fieldAppliesTo gate, the same exception the
  // full-workbook export makes and for the same reason: a person type has no
  // stored `name` (it is in User's excludedFields), so the gate would blank the
  // one column the sheet is scanned by for every person in the file.
  if (key === "name") return nameOf(asset, typesList);
  if (!fieldAppliesTo(key, asset.type)) return "";
  if (key === "type") return typeNameOf(asset.type, typesList);
  // The PARENT, written as the parent's own full path — which is what
  // pathOf(asset) already is. Readable, unique for a well-formed hierarchy, and
  // the exact string resolveImportRef matches first.
  if (key === "parent") return pathOf(asset, assets);
  // SLASH-JOINED, not the comma-joined display string personTextOf builds, and
  // this is not a style choice. Under the "Last, First" name format a single
  // person IS "Cantrell, Aaron" — so a comma-separated list of people cannot be
  // split back into people at all, and "Aaron" and "Cantrell" both resolve to
  // nobody. Slash is already this app's stored separator for several people
  // (the legacy `person` column), so the export simply writes what is stored.
  if (key === "person") return personNamesOf(asset, assets).join("/");
  const v = asset[key];
  return v === undefined || v === null ? "" : String(v);
}

function assetToImportRow(asset, ctx) {
  const row = { [IMPORT_KEY_HEADER]: asset.id || "" };
  importHeadersFor(ctx.columns).forEach(({ header, key }) => {
    row[header] = importCellFor(asset, key, ctx);
  });
  return row;
}

function addImportRef(m, k, a) {
  const key = String(k || "").trim().toLowerCase();
  if (!key) return;
  if (!m.has(key)) m.set(key, []);
  const list = m.get(key);
  if (!list.some(x => x.id === a.id)) list.push(a);
}

function buildImportRefIndex(assets) {
  const idx = { path: new Map(), name: new Map(), id: new Map(), tag: new Map() };
  (assets || []).forEach(a => {
    addImportRef(idx.path, fullPathOf(a, assets), a);
    addImportRef(idx.name, nameOf(a), a);
    addImportRef(idx.id, a.id, a);
    addImportRef(idx.tag, a.tag, a);
  });
  return idx;
}

function indexImportRow(idx, row, pathText) {
  const own = String(pathText || "").trim();
  const name = nameOf(row);
  addImportRef(idx.path, own ? own + PATH_SEPARATOR + name : name, row);
  addImportRef(idx.name, name, row);
  addImportRef(idx.id, row.id, row);
  addImportRef(idx.tag, row.tag, row);
}

function resolveImportRef(text, idx) {
  const key = String(text || "").trim().toLowerCase();
  if (!key) return { asset: null, status: "empty" };
  for (const tier of [idx.path, idx.name, idx.id, idx.tag]) {
    const hits = tier.get(key);
    if (!hits || !hits.length) continue;
    if (hits.length > 1) return { asset: null, status: "ambiguous" };
    return { asset: hits[0], status: "ok" };
  }
  return { asset: null, status: "missing" };
}

function resolveImportType(text, typesList) {
  const key = String(text || "").trim().toLowerCase();
  if (!key) return "";
  const named = (typesList || []).filter(t => String(t.name || "").trim().toLowerCase() === key);
  if (named.length === 1) return named[0].id;
  if (named.length > 1) return "";
  const byId = (typesList || []).find(t => String(t.id || "").trim().toLowerCase() === key);
  return byId ? byId.id : "";
}

function buildImportPeopleIndex(assets) {
  const idx = new Map();
  (assets || []).filter(a => isPersonType(a.type)).forEach(a => {
    const key = personMatchKey(a);
    if (!key) return;
    if (!idx.has(key)) idx.set(key, []);
    idx.get(key).push(a);
  });
  return idx;
}

function splitImportList(text) {
  return String(text || "").split(/[,/]/).map(s => s.trim()).filter(Boolean);
}

function splitImportPeople(text) {
  return String(text || "").split("/").map(s => s.trim()).filter(Boolean);
}

function describeImportAsset(a, ctx) {
  const name = nameOf(a, ctx.typesList);
  const type = typeNameOf(a.type, ctx.typesList);
  const tag = String(a.tag || "").trim();
  return `${name} (${type}${tag ? `, ${tag}` : ""})${a.status === "Archived" ? ", archived" : ""}`;
}

function planAssetImport(parsed, ctx) {
  const { assets, columns, typesList, peripheralsList, bulkItemTypes, usersAreAssets } = ctx;
  const errors = [], warnings = [];
  const present = (parsed.headers || []).filter(Boolean);
  const plan = {
    errors, warnings, updates: [], creates: [], unchanged: 0,
    newPeripherals: [], newSubTypes: [],
  };

  // Which header in THIS file carries each column. The export writes labels; a
  // file written by hand, or by a build whose labels differed, may carry raw
  // keys, so both are accepted.
  const headerForKey = new Map();
  importHeadersFor(columns).forEach(({ header, key }) => {
    if (present.includes(header)) headerForKey.set(key, header);
  });
  (columns || []).forEach(c => {
    if (!headerForKey.has(c.key) && present.includes(c.key)) headerForKey.set(c.key, c.key);
    // The column's own LABEL, for a file written before a header override
    // existed (or exported by an older build). A file outlives the wording of
    // the header that produced it, the same rule `?tab=changes` follows.
    const label = String(c.label || "").trim();
    if (!headerForKey.has(c.key) && label && present.includes(label)) headerForKey.set(c.key, label);
    (IMPORT_LEGACY_HEADERS[c.key] || []).forEach(h => {
      if (!headerForKey.has(c.key) && present.includes(h)) headerForKey.set(c.key, h);
    });
  });
  const cellOf = (values, key) => {
    const header = headerForKey.get(key);
    return header === undefined ? undefined : (values[header] === undefined ? "" : values[header]);
  };

  // THE FILE HAS TO BE RECOGNISABLE AS AN ASSET SHEET BEFORE ANY OF IT IS READ
  // AS ONE. Without this a wrong file — a bank statement, the workbook's own
  // Changes sheet — parses into rows with no type and refuses with a hundred
  // identical complaints instead of one sentence saying what happened.
  if (!parsed.rows.length) {
    errors.push("That file has no data rows.");
    return plan;
  }
  if (!present.includes(IMPORT_KEY_HEADER) && !headerForKey.has("type")) {
    errors.push(`This doesn't look like an asset export — it has no "${IMPORT_KEY_HEADER}" column and no "Type" column. Use Export on the Assets tab to get a file in the right shape.`);
    return plan;
  }

  const known = new Set([IMPORT_KEY_HEADER, ...headerForKey.values()]);
  const unknown = present.filter(h => !known.has(h));
  if (unknown.length) {
    warnings.push(`${unknown.length} column${unknown.length === 1 ? "" : "s"} in the file ${unknown.length === 1 ? "isn't" : "aren't"} a field here and will be ignored: ${unknown.join(", ")}.`);
  }

  const byId = new Map();
  const byTag = new Map();
  (assets || []).forEach(a => {
    const id = String(a.id || "").trim();
    if (id) byId.set(id, a);
    const tag = String(a.tag || "").trim().toLowerCase();
    if (tag && !byTag.has(tag)) byTag.set(tag, a);
  });
  const refIndex = buildImportRefIndex(assets);
  const peopleIndex = buildImportPeopleIndex(assets);
  const knownPeripherals = new Set((peripheralsList || []).map(p => String(p).trim().toLowerCase()));
  const knownSubTypes = new Set((bulkItemTypes || []).map(p => String(p).trim().toLowerCase()));

  const seenKeys = new Map(), seenTags = new Map();
  let archivedTouched = 0, adoptedKeys = 0;
  // Every row, read but not yet classified — see the second pass below.
  const records = [];

  parsed.rows.forEach(({ row, values }) => {
    const at = msg => `Row ${row}: ${msg}`;
    const keyCell = String(values[IMPORT_KEY_HEADER] || "").trim();
    const tagCell = String(cellOf(values, "tag") || "").trim();

    // Matched by KEY first and by tag only as a fallback, which is the order
    // that makes a retag work: change the Asset ID cell of a row that carries
    // its key and the asset is RETAGGED, where matching on the tag first would
    // have made it a stranger and created a second copy of it.
    let target = keyCell ? byId.get(keyCell) || null : null;
    if (!target && !keyCell && tagCell) target = byTag.get(tagCell.toLowerCase()) || null;

    if (keyCell) {
      if (seenKeys.has(keyCell)) {
        errors.push(at(`${IMPORT_KEY_HEADER} "${keyCell}" is also on row ${seenKeys.get(keyCell)}. Each asset may appear once.`));
      } else seenKeys.set(keyCell, row);
      if (!target) adoptedKeys++;
    }
    if (tagCell) {
      const tk = tagCell.toLowerCase();
      if (seenTags.has(tk)) {
        errors.push(at(`Asset ID "${tagCell}" is also on row ${seenTags.get(tk)}. Asset IDs must be unique.`));
      } else seenTags.set(tk, row);
      // THE WHOLE-INVENTORY CHECK. This collision is invisible from inside the
      // file: the asset already wearing the tag need not be in it at all.
      const holder = byTag.get(tk);
      if (holder && (!target || holder.id !== target.id)) {
        errors.push(at(`Asset ID "${tagCell}" is already on ${describeImportAsset(holder, ctx)}, which this file doesn't cover. Asset IDs must be unique.`));
      }
    }

    // The TYPE decides every field rule below it, so it is resolved before
    // anything else and a row with none is abandoned rather than read under a
    // guess about what it is.
    const typeCell = cellOf(values, "type");
    let typeId = target ? target.type : "";
    if (typeCell !== undefined && String(typeCell).trim()) {
      const resolved = resolveImportType(typeCell, typesList);
      if (!resolved) {
        errors.push(at(`"${String(typeCell).trim()}" isn't a type in this inventory.`));
        return;
      }
      typeId = resolved;
    }
    if (!typeId) {
      errors.push(at("no Type, and this row doesn't match an existing asset — there is nothing to inherit one from."));
      return;
    }

    const next = target
      ? { ...target, type: typeId }
      : {
          id: keyCell || crypto.randomUUID(), type: typeId, status: "Active",
          comments: [], changes: [], allocations: [], personIds: [],
        };
    const changes = [];
    // Values this row would introduce to a managed list, held until it is known
    // whether the row is written at all.
    const rowPeripherals = [], rowSubTypes = [];
    // The Path cell, read in the first pass and resolved in the second.
    // `undefined` means the file carries no parent column for this row at all,
    // which is different from a blank cell (that one means Unassigned).
    let parentCell, pathCell;
    // Records a field move. `from`/`to` are DISPLAY text, because an audit row's
    // wording is written once and kept forever — resolving an id at render time
    // is not an option for a row that outlives the asset it names.
    const setField = (key, value, label, from, to, related) => {
      next[key] = value;
      if (!target) return;
      changes.push({ key, label, from, to, related: related || "" });
    };

    (columns || []).forEach(col => {
      const raw = cellOf(values, col.key);
      if (raw === undefined) return;            // the file doesn't carry this column
      if (col.key === "type") return;           // resolved above
      const text = String(raw).trim();

      if (!fieldAppliesTo(col.key, typeId)) {
        // A field this type doesn't have is NOT an error — one sheet covers
        // every type, so a Room's row necessarily carries a blank Serial. A
        // non-blank one is worth a word, because the value is being dropped.
        // The one silent case is a person's Name: the export writes the
        // composed string for readability while First/Last are the real fields
        // and travel in their own columns, so warning about it would fire on
        // every person in every file.
        if (text && !(col.key === "name" && isPersonType(typeId))) {
          warnings.push(at(`${col.label} isn't a field on a ${typeNameOf(typeId, typesList)} — "${text}" ignored.`));
        }
        return;
      }

      if (col.key === "parent") {
        // DEFERRED to the second pass below, because the parent may be a row
        // further down THIS FILE that has not been read yet. Resolving here is
        // what made a file describing a new Building and its Rooms fail on
        // every child row.
        parentCell = text;
        // Held so the row's own address can be indexed from its cells.
        pathCell = text;
        next.parentId = String(target ? target.parentId || "" : "");
        return;
      }

      if (col.key === "person") {
        // Only in id mode. In legacy name mode nothing writes personIds and
        // `person` is the source of truth, so resolving to ids here would hand
        // the asset an assignment the rest of the app cannot read — the exact
        // shape of the v28 data loss, met from a new direction.
        if (!usersAreAssets) {
          const before = String(target ? target.person || "" : "");
          const after = splitImportPeople(text).join("/");
          if (after !== before) setField("person", after, col.label, before || "—", after || "—");
          else next.person = before;
          return;
        }
        const wanted = splitImportPeople(text);
        const ids = [];
        let bad = false;
        wanted.forEach(nameText => {
          const hits = peopleIndex.get(personMatchKey(nameText)) || [];
          if (hits.length === 1) { if (!ids.includes(hits[0].id)) ids.push(hits[0].id); return; }
          bad = true;
          errors.push(at(hits.length
            ? `"${nameText}" matches ${hits.length} people. Assign this one from the asset's own page instead.`
            : `"${nameText}" isn't a person in this inventory.`));
        });
        if (bad) return;
        const before = personLabelsOf(target || {});
        if (before.join(",") === ids.join(",")) { next.personIds = before; return; }
        const nameFor = id => {
          const u = (assets || []).find(x => x.id === id);
          return u ? nameOf(u, typesList) : "(deleted user)";
        };
        next.personIds = ids;
        // `person` trails `personIds` exactly as it does on the edit path, so
        // the legacy column stays truthful for as long as it is still written.
        next.person = ids.map(nameFor).join("/");
        if (target) {
          changes.push({
            key: "personIds", label: "User",
            from: before.map(nameFor).join(", ") || "—",
            to: ids.map(nameFor).join(", ") || "—",
            related: relate({
              unassigned: before.filter(id => !ids.includes(id)),
              assigned: ids.filter(id => !before.includes(id)),
            }),
          });
        }
        return;
      }

      let value = text;
      if (col.key === "peripherals") {
        value = splitImportList(text).join("/");
        // NOTED, NOT ADOPTED YET. A managed-list addition rides on the row
        // actually being WRITTEN (below) -- a file whose rows all already match
        // writes nothing, so promising to extend the list there would be a
        // warning about a change that can never happen. It reads as a real one:
        // Sandbox ships assets carrying peripherals its empty managed list has
        // never heard of, so an untouched re-import listed four of them.
        splitImportList(text).forEach(p => {
          if (!knownPeripherals.has(p.toLowerCase())) rowPeripherals.push(p);
        });
      } else if (col.key === "subType") {
        if (value && !knownSubTypes.has(value.toLowerCase())) rowSubTypes.push(value);
      } else {
        // The column's own data type, checked exactly as the edit form checks
        // it. This is the path that catches a date typed into a number column
        // or a "N/A" in a date one — neither of which any form would have let
        // through, and both of which a spreadsheet makes easy.
        const message = validateColumnValue(col, value);
        if (message) { errors.push(at(message)); return; }
        if (columnDataType(col) === "date") value = dateOnly(value);
      }

      const before = String((target && target[col.key]) || "");
      if (value === before) { next[col.key] = target ? target[col.key] : value; return; }
      setField(col.key, value, col.label, before, value);
    });

    // NAMED BEFORE THE ROW IS INDEXED, not at classification time, because the
    // name is half of the address other rows find this one by. A row left
    // blank takes the same suggestion the add form shows as its placeholder,
    // rather than relying on nameOf()'s last-resort fallback (a short uuid)
    // forever. A person type has no `name` at all.
    if (!target && fieldAppliesTo("name", typeId) && !String(next.name || "").trim()) {
      next.name = suggestedNameFor(next, assets, typesList);
    }

    // CLASSIFICATION WAITS FOR THE SECOND PASS, since a row whose only change
    // is its parent cannot be told from an unchanged one until that parent has
    // been resolved.
    records.push({ row, at, next, target, typeId, changes, rowPeripherals, rowSubTypes, parentCell, pathCell });
  });

  // ---- SECOND PASS: parents, now that every row in the file is known --------
  // Every row is indexed, not only the creates: a file that renames a Building
  // and fills it with rooms names the NEW name in its children's Path cells,
  // and the existing index only knows the old one. Adding an unchanged row is
  // harmless — addImportRef dedupes on id, so it does not read as ambiguous
  // with its own entry in the existing index.
  records.forEach(r => indexImportRow(refIndex, r.next, r.pathCell));

  records.forEach(r => {
    if (r.parentCell === undefined) return;        // no parent column in the file
    const before = String(r.target ? r.target.parentId || "" : "");
    const text = r.parentCell;
    const setParent = (id, toText, related) => {
      r.next.parentId = id;
      if (r.target && id !== before) {
        r.changes.push({
          key: "parentId", label: "Location",
          from: parentNameFor(before, assets) || UNASSIGNED_LABEL,
          to: toText, related: related || "",
        });
      }
    };
    if (!text || text.toLowerCase() === UNASSIGNED_LABEL.toLowerCase()) {
      setParent("", UNASSIGNED_LABEL, relate({ from: before, to: "" }));
      return;
    }
    const hit = resolveImportRef(text, refIndex);
    if (hit.status === "ambiguous") {
      errors.push(r.at(`"${text}" matches more than one asset. Use the full path (e.g. "Building 100${PATH_SEPARATOR}Room 101") so there is only one answer.`));
      return;
    }
    if (!hit.asset) {
      errors.push(r.at(`"${text}" is not an asset here and no row in this file creates it. Check the spelling, or add a row for it.`));
      return;
    }
    // A row cannot be its own parent. Caught here rather than by the cycle
    // check below, which would report it as a loop and send someone looking
    // for a second row that does not exist.
    if (hit.asset.id === r.next.id) {
      errors.push(r.at(`"${text}" is this row itself — an asset cannot sit inside itself.`));
      return;
    }
    setParent(hit.asset.id, nameOf(hit.asset, typesList), relate({ from: before, to: hit.asset.id }));
  });

  records.forEach(r => {
    // Adopted only for a row that is genuinely being written.
    const adoptManagedValues = () => {
      r.rowPeripherals.forEach(p => {
        if (knownPeripherals.has(p.toLowerCase())) return;
        knownPeripherals.add(p.toLowerCase());
        plan.newPeripherals.push(p);
      });
      r.rowSubTypes.forEach(t => {
        if (knownSubTypes.has(t.toLowerCase())) return;
        knownSubTypes.add(t.toLowerCase());
        plan.newSubTypes.push(t);
      });
    };
    if (r.target) {
      if (r.target.status === "Archived") archivedTouched++;
      if (r.changes.length) { plan.updates.push({ asset: r.target, next: r.next, changes: r.changes }); adoptManagedValues(); }
      else plan.unchanged++;
    } else {
      plan.creates.push({ row: r.row, next: r.next });
      adoptManagedValues();
    }
  });

  // PARENTAGE IS CHECKED AGAINST THE PROJECTED INVENTORY, NOT THE CURRENT ONE,
  // and that is the only way a cycle spanning two ROWS can be seen: a file that
  // puts A inside B and B inside A is legal on each row read alone, and each is
  // legal against the assets as they stand right now. Checked here, once the
  // whole file has been read, against what it would leave behind.
  if (!errors.length) {
    const projected = [
      ...(assets || []).map(a => {
        const u = plan.updates.find(x => x.asset.id === a.id);
        return u ? u.next : a;
      }),
      ...plan.creates.map(c => c.next),
    ];
    const rowOf = new Map();
    plan.creates.forEach(c => rowOf.set(c.next.id, c.row));
    projected.forEach(a => {
      const touched = plan.updates.some(u => u.next.id === a.id) || rowOf.has(a.id);
      if (!touched) return;
      const message = validateParentChoice(a.id, a.type, a.parentId, projected, typesList);
      if (message) {
        const where = rowOf.has(a.id) ? `Row ${rowOf.get(a.id)}` : describeImportAsset(a, ctx);
        errors.push(`${where}: ${message}`);
      }
    });
  }

  if (plan.creates.length) {
    warnings.push(plan.creates.length === 1
      ? "1 row matches nothing here and will be created as a new asset."
      : `${plan.creates.length} rows match nothing here and will be created as new assets.`);
  }
  if (adoptedKeys) {
    warnings.push(`${adoptedKeys} row${adoptedKeys === 1 ? " carries an" : "s carry"} ${IMPORT_KEY_HEADER} that no asset here has. ${adoptedKeys === 1 ? "It" : "They"} will be created keeping that key — check the file is from this inventory.`);
  }
  if (archivedTouched) {
    warnings.push(`${archivedTouched} of the assets this file updates ${archivedTouched === 1 ? "is" : "are"} archived.`);
  }
  if (plan.newPeripherals.length) {
    warnings.push(`New peripherals will be added to the managed list: ${plan.newPeripherals.join(", ")}.`);
  }
  if (plan.newSubTypes.length) {
    warnings.push(`New sub-types will be added to the managed list: ${plan.newSubTypes.join(", ")}.`);
  }

  // ALL OR NOTHING IS MADE STRUCTURAL HERE rather than left as a promise the
  // caller keeps. The caller does refuse to apply a plan carrying errors, but a
  // plan that still held the eleven good rows of a twelve-row file would be one
  // forgotten guard away from importing them -- and a partial import is the
  // thing this design exists to rule out. A refused file describes no write at
  // all, so the plan carries none.
  if (errors.length) {
    plan.updates = [];
    plan.creates = [];
    plan.unchanged = 0;
    plan.newPeripherals = [];
    plan.newSubTypes = [];
  }
  return plan;
}

// Each tenant's asset-ID prefix, from clients.js.
export const TENANT_LABEL_PREFIX = {"3c":"3C","bca":"BCA","dev":"BCA"};

export { TYPE_REGISTRY, DEFAULT_TYPES, applyTypeSettings, adoptLegacyTypesList, ensureLockedTypes, typeNameOf, typeTakesParent, parentTypesFor, isPlaceType, fieldAppliesTo, isPersonType, personMatchKey, nameOf, personLabelsOf, personNamesOf, UNASSIGNED_LABEL, pathOf, fullPathOf, parentNameFor, relate, dateOnly, adoptPersonNames, adoptLegacyNames, columnDataType, columnOptions, validateColumnValue, DEFAULT_COLUMNS, RENAMED_COLUMN_KEYS, RETIRED_COLUMN_KEYS, IMPORT_KEY_HEADER, importHeadersFor, planAssetImport, PATH_SEPARATOR, assetToImportRow, resolveImportType, isLockedType };
