// The Sandbox fixture, lifted out of index.html on 2026-09-11.
//
// WHY IT IS ITS OWN FILE: at ~600 lines it was the single largest thing in
// index.html that is not code, and it sat in the middle of it. Every search for
// a domain term hit the fixture harder than the app -- 101 of 132 matches for
// `roomsServedIds`, 112 of 186 for `circuits` -- so finding the code that uses a
// field meant reading past the rows that merely contain it. Nothing about the
// fixture changed in the move.
//
// WHY A FACTORY rather than a plain object: the fixture names three things that
// belong to the app, not to it -- FRONTEND_SCRIPT_VERSION (the backend contract,
// which must stay single-sourced in index.html), SEEDED_BREAKER_TYPES, and
// `relate`. Passing them in keeps index.html the one place each is defined. A
// classic script, like clients.js, so it needs no import map and is available
// before Babel has transpiled anything.
//
// DO NOT rename the MOCK_SNAPSHOT or MOCK_PHOTOS declarations below, and do not
// write either declaration out in a comment. test-frontend-assetid.js and
// test-frontend-photos.js slice this fixture out as SOURCE TEXT and evaluate it,
// finding it by its declaration. They anchor that search to the start of a line
// for exactly this reason -- the first version of this header quoted the
// declaration, the tests matched the COMMENT, and the fixture evaluated as prose.
window.MOCK_DATA_FOR = function ({ FRONTEND_SCRIPT_VERSION, SEEDED_BREAKER_TYPES, relate }) {

// Sandbox fixture. Deliberately MIXED, the same way the asset ids and the work
// entry ids are: an asset photo, a breaker photo, a circuit photo, one hidden
// from the public page, and one with NO thumbUrl so photoThumbUrl's derive
// fallback is exercised rather than only its stored-value path. A fixture that
// was all one shape would exercise half the code.
//
// The images are inline data URIs, not links: a fixture that needs the network
// is one that renders as broken the day the network is not there, and Sandbox's
// whole point is making no request at all.
const MOCK_PHOTO_IMG_A = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#4b5d73"/><text x="200" y="160" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">Panel</text></svg>');
const MOCK_PHOTO_IMG_B = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#7a5d3f"/><text x="200" y="160" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle">Breaker</text></svg>');
const MOCK_PHOTO_IMG_C = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#3f6b52"/><text x="200" y="160" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">Circuit</text></svg>');

const MOCK_PHOTOS = [
  {
    id: "photo-1", ownerType: "asset", ownerId: "BCA0082",
    url: MOCK_PHOTO_IMG_A, thumbUrl: MOCK_PHOTO_IMG_A, storageKey: "sandbox/panel-front",
    caption: "Panel front, door closed", width: 400, height: 300, bytes: 4096,
    hiddenFromPublic: false, at: "2026-09-01T17:20:00.000Z", by: "Eric Stamage",
  },
  {
    id: "photo-2", ownerType: "breaker", ownerId: "b82-1",
    url: MOCK_PHOTO_IMG_B, thumbUrl: "", storageKey: "sandbox/breaker-1a",
    caption: "20A double-pole, slot 1", width: 400, height: 300, bytes: 4096,
    hiddenFromPublic: false, at: "2026-09-01T17:24:00.000Z", by: "Eric Stamage",
  },
  {
    id: "photo-3", ownerType: "circuit", ownerId: "c82-1",
    url: MOCK_PHOTO_IMG_C, thumbUrl: MOCK_PHOTO_IMG_C, storageKey: "sandbox/circuit-outlets",
    caption: "North wall outlet run", width: 400, height: 300, bytes: 4096,
    hiddenFromPublic: false, at: "2026-09-01T17:26:00.000Z", by: "Eric Stamage",
  },
  {
    id: "photo-4", ownerType: "asset", ownerId: "BCA0082",
    url: MOCK_PHOTO_IMG_A, thumbUrl: MOCK_PHOTO_IMG_A, storageKey: "sandbox/panel-open",
    caption: "Interior — withheld from the QR page",
    width: 400, height: 300, bytes: 4096,
    hiddenFromPublic: true, at: "2026-09-01T17:28:00.000Z", by: "Eric Stamage",
  },
];

const MOCK_SNAPSHOT = {
  scriptVersion: FRONTEND_SCRIPT_VERSION,
  // The type list in the OLD pre-id shape — a plain array of name strings, which
  // is what the live sheet's Config holds. Present so the sandbox exercises
  // adoptLegacyTypesList rather than falling through to DEFAULT_TYPES, which is
  // already in the new shape and so proves nothing. Same reasoning as the stored
  // column config below.
  typesList: [
    "Computer", "Monitor", "Phone", "TV", "DocuCam", "Stream Deck", "Mini Split",
    "Condenser", "Room", "Building", "Campus", "Bulk Item", "Electrical Panel", "Other",
  ],
  // A STORED category list that is deliberately INCOMPLETE and RE-ORDERED: it
  // omits "People" (a shipped category) and puts Facilities before Equipment.
  // So the sandbox exercises ensureShippedCategories topping a stored list up,
  // and proves the stored order wins over the shipped one — neither of which a
  // fixture with no list at all could show, and the top-up is exactly the path
  // that only runs on a sheet written before a category was added.
  typeCategories: [
    { id: "Facilities", name: "Facilities" },
    { id: "Equipment", name: "Equipment" },
    { id: "Places", name: "Places" },
  ],
  // A column config as an OLDER client would have saved it — carrying the
  // Campus/Building/Room columns that are now retired. Present so the sandbox
  // exercises the removal path in loadData (RETIRED_COLUMN_KEYS) instead of
  // starting from DEFAULT_COLUMNS, which has nothing to remove. The live sheet
  // has a stored config exactly like this, so a fixture without one hides the
  // only case that matters — the same blind spot that let the first version of
  // the name backfill ship broken.
  //
  // DATA TYPES ARE DELIBERATELY MIXED here, for the same reason and by the same
  // rule: `condition` carries an explicit dataType and options (the stored
  // override path), every other column carries none (the read-time fallback in
  // columnDataType — which is what resolves Purchase Date to a date picker
  // without anything being stored). A fixture that was all one shape would
  // exercise half of it, which is exactly how the personIds bug got through.
  columns: [
    { key: "name", label: "Name", width: 200, visible: true, custom: false },
    { key: "type", label: "Type", width: 140, visible: true, custom: false },
    { key: "itemName", label: "Sub-Type", width: 150, visible: true, custom: false },
    { key: "parent", label: "Path", width: 240, visible: true, custom: false },
    { key: "campus", label: "Campus", width: 150, visible: false, custom: false },
    { key: "building", label: "Building", width: 130, visible: false, custom: false },
    { key: "room", label: "Room", width: 130, visible: true, custom: false },
    { key: "person", label: "User", width: 170, visible: true, custom: false },
    { key: "condition", label: "Condition", width: 130, visible: true, custom: true, dataType: "select", options: ["Good", "Fair", "Needs replacing"] },
    { key: "status", label: "Status", width: 100, visible: true, custom: false },
  ],
  assets: [
    // Two campuses, the top of the tree. BCC labels follow the fixture's existing
    // readable-prefix habit (BCB buildings, BCR rooms) — note that's a property of
    // this hand-written fixture only; the app itself issues BCA numbers for
    // everything and has no per-type prefix scheme.
    { label: "BCC0001", type: "Campus", name: "Brookside Christian Academy", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "The school site.", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { label: "BCC0002", type: "Campus", name: "Kramer Campus", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "Separate residential site — sample data behind the Electrical Map panel.", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { label: "BCB0001", type: "Building", name: "Building 100", parentId: "BCC0001", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { label: "BCB0002", type: "Building", name: "Building 200", parentId: "BCC0001", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { label: "BCB0003", type: "Building", name: "Building 300", parentId: "BCC0001", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { label: "BCB0004", type: "Building", name: "Building 400", parentId: "BCC0001", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { id: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80", label: "BCR0006", type: "Room", name: "Room 102", parentId: "BCB0001", person: "Jen Kramer", notes: "", status: "Active" },
    { label: "BCR0008", type: "Room", name: "Room 200", parentId: "BCB0002", person: "Aaron Cantrell", notes: "", status: "Active" },
    { label: "BCR0011", type: "Room", name: "Room 300", parentId: "BCB0003", person: "Denise Sloan", notes: "", status: "Active" },
    { label: "BCR0014", type: "Room", name: "Room 400", parentId: "BCB0004", person: "Kelly Mackinga", notes: "", status: "Active" },
    { label: "BCR0002", type: "Room", name: "Kitchen", parentId: "BCB0001", person: "Multiple teachers", notes: "", status: "Active" },
    { label: "BCR0018", type: "Room", name: "Storage Room", parentId: "BCB0001", person: "", notes: "", status: "Active" },
    { label: "BCR0020", type: "Room", name: "Room 101", parentId: "BCB0001", person: "Dillon Jacobsma", notes: "", status: "Active" },
    // Deliberately PRE-conversion: every assignment is still a legacy `person`
    // name and there are no User records. That is the state a real sheet is in
    // the moment v28 ships, so the sandbox exercises the conversion button
    // rather than starting past it -- the same reasoning as the stored column
    // config carrying retired keys.
    { id: "b81c60de-2f47-4a93-8e15-0d7c39ab6215", label: "BCA0001", type: "Computer", parentId: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80", brand: "Dell", model: "OptiPlex 7010", serial: "MOCK-CMP-001", person: "Jen Kramer", peripherals: "Keyboard, Mouse", notes: "", status: "Active" },
    { label: "BCA0002", type: "Monitor", parentId: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80", brand: "Dell", model: "P2419H", serial: "MOCK-MON-001", person: "Jen Kramer", notes: "", status: "Active" },
    { label: "BCA0003", type: "Phone", parentId: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80", brand: "Cisco", model: "8841", serial: "MOCK-PHN-001", person: "Jen Kramer", notes: "", status: "Active" },
    { label: "BCA0011", type: "Phone", parentId: "BCR0008", brand: "Cisco", model: "8841", serial: "MOCK-PHN-002", person: "Aaron Cantrell", notes: "", status: "Active" },
    { label: "BCA0015", type: "Stream Deck", parentId: "BCR0008", brand: "Elgato", model: "Stream Deck MK.2", serial: "MOCK-SD-001", person: "Aaron Cantrell", notes: "", status: "Active" },
    { label: "BCA0024", type: "TV", parentId: "BCR0011", brand: "Samsung", model: "55\" QLED", serial: "MOCK-TV-001", person: "Denise Sloan", notes: "", status: "Active" },
    { label: "BCA0054", type: "DocuCam", parentId: "BCR0020", brand: "IPEVO", model: "V4K", serial: "MOCK-DC-001", person: "Dillon Jacobsma", notes: "", status: "Active" },
    // No `name` of its own, so it exercises the one naming rule left: a Bulk Item
    // is called by its sub-type. The stale room/roomId/itemName this used to carry
    // went with the columns themselves in v25 — there is no legacy shape left for
    // a fixture to reproduce.
    { label: "BCA0081", type: "Bulk Item", subType: "Chairs", totalQuantity: "40", allocations: [{ roomId: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80", quantity: "20" }, { roomId: "BCR0008", quantity: "20" }], notes: "", status: "Active" },
    // Every panel below follows the same design: mostly single-pole breakers
    // feeding room outlet/lighting circuits, plus exactly one of each other
    // BreakerType (Tandem, Quad, Split Double-Pole) for catalog variety, one
    // double-pole feeding a large appliance, and one double-pole feeding a
    // sub-panel — BCA0082's two sub-panel feeds are real (BCA0084/BCA0085);
    // the small sub-panels' sub-panel feeds point at plausible-but-nonexistent
    // future panel labels (BCA0100+), described as reserved/not yet installed.
    {
      label: "BCA0082", type: "Electrical Panel", parentId: "BCR0018", brand: "Square D", model: "QO142M200PC", serial: "MN-88213-SQD",
      notes: "Main service panel, 200A. Feeds Building 200/300/400 sub-panels.", status: "Active",
      panelSlotCount: 24, panelLayout: "two-column",
      breakers: [
        { id: "b82-1", panelLabel: "BCA0082", cells: ["1a", "1b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-1", breakerId: "b82-1", label: "Outlets", roomsServedIds: ["BCR0020"], feedsPanelLabel: "", notes: "- North wall outlets" },
        ] },
        { id: "b82-2", panelLabel: "BCA0082", cells: ["2a", "2b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-2", breakerId: "b82-2", label: "Outlets", roomsServedIds: ["3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80"], feedsPanelLabel: "", notes: "- North wall outlets" },
        ] },
        { id: "b82-3", panelLabel: "BCA0082", cells: ["3a", "3b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-3", breakerId: "b82-3", label: "Outlets", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Counter outlets, north wall" },
        ] },
        { id: "b82-4", panelLabel: "BCA0082", cells: ["4a", "4b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-4", breakerId: "b82-4", label: "Outlets", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- North wall outlets" },
        ] },
        { id: "b82-5", panelLabel: "BCA0082", cells: ["5a", "5b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-5", breakerId: "b82-5", label: "Lighting", roomsServedIds: ["BCR0020"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b82-6", panelLabel: "BCA0082", cells: ["6a", "6b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-6", breakerId: "b82-6", label: "Lighting", roomsServedIds: ["3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b82-7", panelLabel: "BCA0082", cells: ["7a", "7b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-7", breakerId: "b82-7", label: "Lighting", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b82-8a", panelLabel: "BCA0082", cells: ["8a"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-tandem-8", circuits: [
          { id: "c82-8a", breakerId: "b82-8a", label: "Lighting", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b82-8b", panelLabel: "BCA0082", cells: ["8b"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-tandem-8", circuits: [
          { id: "c82-8b", breakerId: "b82-8b", label: "Exterior lighting", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- Exterior door light" },
        ] },
        { id: "b82-9a", panelLabel: "BCA0082", cells: ["9a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-quad-9", circuits: [
          { id: "c82-9a", breakerId: "b82-9a", label: "Outlets", roomsServedIds: ["BCR0020"], feedsPanelLabel: "", notes: "- South wall outlets" },
        ] },
        { id: "b82-9b", panelLabel: "BCA0082", cells: ["9b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-quad-9", circuits: [
          { id: "c82-9b", breakerId: "b82-9b", label: "Outlets", roomsServedIds: ["3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80"], feedsPanelLabel: "", notes: "- South wall outlets\n- Desk outlets" },
        ] },
        { id: "b82-11a", panelLabel: "BCA0082", cells: ["11a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-quad-9", circuits: [
          { id: "c82-11a", breakerId: "b82-11a", label: "Outlets", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Counter outlets, south wall" },
        ] },
        { id: "b82-11b", panelLabel: "BCA0082", cells: ["11b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-quad-9", circuits: [
          { id: "c82-11b", breakerId: "b82-11b", label: "Outlets", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- South wall outlets" },
        ] },
        { id: "b82-10", panelLabel: "BCA0082", cells: ["10a", "10b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-10", breakerId: "b82-10", label: "Outlets", roomsServedIds: ["BCR0020"], feedsPanelLabel: "", notes: "- East wall outlets" },
        ] },
        { id: "b82-12", panelLabel: "BCA0082", cells: ["12a", "12b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-12", breakerId: "b82-12", label: "Outlets", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Island outlets" },
        ] },
        { id: "b82-13a", panelLabel: "BCA0082", cells: ["13a"], breakerTypeId: "type-split-double", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-split-13", circuits: [
          { id: "c82-13a", breakerId: "b82-13a", label: "Garbage disposal", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Under-sink garbage disposal" },
        ] },
        { id: "b82-13b-15a", panelLabel: "BCA0082", cells: ["13b", "15a"], breakerTypeId: "type-split-double", ampRating: "30", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp82-split-13", circuits: [
          { id: "c82-13b-15a", breakerId: "b82-13b-15a", label: "Microwave", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Countertop microwave" },
        ] },
        { id: "b82-15b", panelLabel: "BCA0082", cells: ["15b"], breakerTypeId: "type-split-double", ampRating: "15", status: "Spare", serial: "", installedDate: "", notes: "", groupId: "grp82-split-13", circuits: [] },
        { id: "b82-14", panelLabel: "BCA0082", cells: ["14a", "14b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-14", breakerId: "b82-14", label: "Lighting", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- Shelving area lights" },
        ] },
        { id: "b82-16-18", panelLabel: "BCA0082", cells: ["16a", "16b", "18a", "18b"], breakerTypeId: "type-double-pole", ampRating: "50", status: "Active", serial: "", installedDate: "", notes: "Electric range/oven", circuits: [
          { id: "c82-16-18", breakerId: "b82-16-18", label: "Range/Oven", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Range/oven" },
        ] },
        { id: "b82-17", panelLabel: "BCA0082", cells: ["17a", "17b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-17", breakerId: "b82-17", label: "Outlets", roomsServedIds: ["3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80"], feedsPanelLabel: "", notes: "- Closet outlets" },
        ] },
        { id: "b82-19-21", panelLabel: "BCA0082", cells: ["19a", "19b", "21a", "21b"], breakerTypeId: "type-double-pole", ampRating: "60", status: "Active", serial: "", installedDate: "", notes: "Feed to Room 300 sub-panel (BCA0084)", circuits: [
          { id: "c82-19-21", breakerId: "b82-19-21", label: "Feed to Room 300 sub-panel", roomsServedIds: [], feedsPanelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", notes: "- Feeds downstream sub-panel; no direct loads" },
        ] },
        { id: "b82-20", panelLabel: "BCA0082", cells: ["20a", "20b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-20", breakerId: "b82-20", label: "Outlets", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- East wall outlets\n- Shelving unit outlet" },
        ] },
        { id: "b82-22-24", panelLabel: "BCA0082", cells: ["22a", "22b", "24a", "24b"], breakerTypeId: "type-double-pole", ampRating: "60", status: "Active", serial: "", installedDate: "", notes: "Feed to Room 400 sub-panel (BCA0085)", circuits: [
          { id: "c82-22-24", breakerId: "b82-22-24", label: "Feed to Room 400 sub-panel", roomsServedIds: [], feedsPanelLabel: "BCA0085", notes: "- Feeds downstream sub-panel; no direct loads" },
        ] },
        { id: "b82-23", panelLabel: "BCA0082", cells: ["23a", "23b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c82-23", breakerId: "b82-23", label: "Outlets", roomsServedIds: ["BCR0020"], feedsPanelLabel: "", notes: "- Closet outlets" },
        ] },
      ],
      // Circuits that belong to this panel but aren't landed on a breaker yet —
      // fixture data for the Layout tab's "Unassigned circuits" section. Note
      // the empty breakerId plus an explicit panelLabel: with no breaker to
      // chain through, panelLabel is the only thing tying these to BCA0082
      // (see CIRCUIT_FIELDS in AssetTrackerSync.gs). The circuits nested under
      // breakers above don't carry one in this fixture — the backend derives it
      // from the panel on every write, so they get one on the next save; only
      // the unassigned ones need it to be findable at all.
      unassignedCircuits: [
        { id: "c82-u1", breakerId: "", panelLabel: "BCA0082", label: "Kitchen island outlets (new)", roomsServedIds: ["BCR0002"], feedsPanelLabel: "", notes: "- Pulled during the counter remodel\n- Landed in the panel, not yet on a breaker" },
        { id: "c82-u2", breakerId: "", panelLabel: "BCA0082", label: "Parking lot sign", roomsServedIds: ["BCR0018"], feedsPanelLabel: "", notes: "- Conduit stubbed out to the sign; capped in the panel" },
      ],
    },
    {
      label: "BCA0083", type: "Electrical Panel", parentId: "BCR0008", brand: "Square D", model: "QO112L125GRB", serial: "B200-SQD-4471",
      notes: "Sub-panel fed from Main Distribution Panel (Storage Room), 125A main lug.", status: "Active",
      panelSlotCount: 20, panelLayout: "two-column",
      breakers: [
        { id: "b83-1", panelLabel: "BCA0083", cells: ["1a", "1b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-1", breakerId: "b83-1", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- North wall outlets" },
        ] },
        { id: "b83-2", panelLabel: "BCA0083", cells: ["2a", "2b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-2", breakerId: "b83-2", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- South wall outlets" },
        ] },
        { id: "b83-3", panelLabel: "BCA0083", cells: ["3a", "3b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-3", breakerId: "b83-3", label: "Lighting", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b83-4a", panelLabel: "BCA0083", cells: ["4a"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-tandem-4", circuits: [
          { id: "c83-4a", breakerId: "b83-4a", label: "Exterior lighting", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Entry door exterior light" },
        ] },
        { id: "b83-4b", panelLabel: "BCA0083", cells: ["4b"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-tandem-4", circuits: [
          { id: "c83-4b", breakerId: "b83-4b", label: "Closet light", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Closet light" },
        ] },
        { id: "b83-5", panelLabel: "BCA0083", cells: ["5a", "5b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-5", breakerId: "b83-5", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- East wall outlets" },
        ] },
        { id: "b83-6a", panelLabel: "BCA0083", cells: ["6a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-quad-6", circuits: [
          { id: "c83-6a", breakerId: "b83-6a", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- West wall outlets" },
        ] },
        { id: "b83-6b", panelLabel: "BCA0083", cells: ["6b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-quad-6", circuits: [
          { id: "c83-6b", breakerId: "b83-6b", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Desk area outlets" },
        ] },
        { id: "b83-8a", panelLabel: "BCA0083", cells: ["8a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-quad-6", circuits: [
          { id: "c83-8a", breakerId: "b83-8a", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Workbench outlets" },
        ] },
        { id: "b83-8b", panelLabel: "BCA0083", cells: ["8b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-quad-6", circuits: [
          { id: "c83-8b", breakerId: "b83-8b", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Under-window outlets" },
        ] },
        { id: "b83-7", panelLabel: "BCA0083", cells: ["7a", "7b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-7", breakerId: "b83-7", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Window wall outlets" },
        ] },
        { id: "b83-9a", panelLabel: "BCA0083", cells: ["9a"], breakerTypeId: "type-split-double", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-split-9", circuits: [
          { id: "c83-9a", breakerId: "b83-9a", label: "Garbage disposal", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Under-sink garbage disposal" },
        ] },
        { id: "b83-9b-11a", panelLabel: "BCA0083", cells: ["9b", "11a"], breakerTypeId: "type-split-double", ampRating: "30", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp83-split-9", circuits: [
          { id: "c83-9b-11a", breakerId: "b83-9b-11a", label: "Microwave", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Countertop microwave" },
        ] },
        { id: "b83-11b", panelLabel: "BCA0083", cells: ["11b"], breakerTypeId: "type-split-double", ampRating: "15", status: "Spare", serial: "", installedDate: "", notes: "", groupId: "grp83-split-9", circuits: [] },
        { id: "b83-10", panelLabel: "BCA0083", cells: ["10a", "10b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-10", breakerId: "b83-10", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- North wall outlets (secondary run)" },
        ] },
        { id: "b83-12-14", panelLabel: "BCA0083", cells: ["12a", "12b", "14a", "14b"], breakerTypeId: "type-double-pole", ampRating: "30", status: "Active", serial: "", installedDate: "", notes: "Electric water heater", circuits: [
          { id: "c83-12-14", breakerId: "b83-12-14", label: "Water Heater", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Electric water heater" },
        ] },
        { id: "b83-13", panelLabel: "BCA0083", cells: ["13a", "13b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-13", breakerId: "b83-13", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Closet outlets" },
        ] },
        { id: "b83-15-17", panelLabel: "BCA0083", cells: ["15a", "15b", "17a", "17b"], breakerTypeId: "type-double-pole", ampRating: "60", status: "Active", serial: "", installedDate: "", notes: "Reserved feed for a future garage sub-panel (not yet installed).", circuits: [
          { id: "c83-15-17", breakerId: "b83-15-17", label: "Feed to garage sub-panel", roomsServedIds: [], feedsPanelLabel: "BCA0100", notes: "- Feeds downstream sub-panel; no direct loads" },
        ] },
        { id: "b83-16", panelLabel: "BCA0083", cells: ["16a", "16b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-16", breakerId: "b83-16", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- South wall outlets (secondary run)" },
        ] },
        { id: "b83-18", panelLabel: "BCA0083", cells: ["18a", "18b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-18", breakerId: "b83-18", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- East wall outlets (secondary run)" },
        ] },
        { id: "b83-19", panelLabel: "BCA0083", cells: ["19a", "19b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c83-19", breakerId: "b83-19", label: "Outlets", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Entry wall outlets" },
        ] },
      ],
      // See BCA0082's unassignedCircuits above — a second panel with one, so
      // moving a circuit onto a breaker can be exercised on more than one panel.
      unassignedCircuits: [
        { id: "c83-u1", breakerId: "", panelLabel: "BCA0083", label: "Spare run to back wall", roomsServedIds: ["BCR0008"], feedsPanelLabel: "", notes: "- Capped in the panel; no breaker assigned yet" },
      ],
    },
    {
      id: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", label: "BCA0084", type: "Electrical Panel", parentId: "BCR0011", brand: "Square D", model: "QO112L125GRB", serial: "B300-SQD-4472",
      notes: "Sub-panel fed from Main Distribution Panel (Storage Room), 125A main lug.", status: "Active",
      panelSlotCount: 20, panelLayout: "two-column",
      breakers: [
        { id: "b84-1", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["1a", "1b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-1", breakerId: "b84-1", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- North wall outlets" },
        ] },
        { id: "b84-2", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["2a", "2b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-2", breakerId: "b84-2", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- South wall outlets" },
        ] },
        { id: "b84-3", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["3a", "3b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-3", breakerId: "b84-3", label: "Lighting", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b84-4a", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["4a"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-tandem-4", circuits: [
          { id: "c84-4a", breakerId: "b84-4a", label: "Exterior lighting", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Entry door exterior light" },
        ] },
        { id: "b84-4b", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["4b"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-tandem-4", circuits: [
          { id: "c84-4b", breakerId: "b84-4b", label: "Closet light", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Closet light" },
        ] },
        { id: "b84-5", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["5a", "5b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-5", breakerId: "b84-5", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- East wall outlets" },
        ] },
        { id: "b84-6a", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["6a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-quad-6", circuits: [
          { id: "c84-6a", breakerId: "b84-6a", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- West wall outlets" },
        ] },
        { id: "b84-6b", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["6b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-quad-6", circuits: [
          { id: "c84-6b", breakerId: "b84-6b", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Desk area outlets" },
        ] },
        { id: "b84-8a", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["8a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-quad-6", circuits: [
          { id: "c84-8a", breakerId: "b84-8a", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Workbench outlets" },
        ] },
        { id: "b84-8b", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["8b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-quad-6", circuits: [
          { id: "c84-8b", breakerId: "b84-8b", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Under-window outlets" },
        ] },
        { id: "b84-7", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["7a", "7b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-7", breakerId: "b84-7", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Window wall outlets" },
        ] },
        { id: "b84-9a", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["9a"], breakerTypeId: "type-split-double", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-split-9", circuits: [
          { id: "c84-9a", breakerId: "b84-9a", label: "Garbage disposal", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Under-sink garbage disposal" },
        ] },
        { id: "b84-9b-11a", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["9b", "11a"], breakerTypeId: "type-split-double", ampRating: "30", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp84-split-9", circuits: [
          { id: "c84-9b-11a", breakerId: "b84-9b-11a", label: "Microwave", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Countertop microwave" },
        ] },
        { id: "b84-11b", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["11b"], breakerTypeId: "type-split-double", ampRating: "15", status: "Spare", serial: "", installedDate: "", notes: "", groupId: "grp84-split-9", circuits: [] },
        { id: "b84-10", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["10a", "10b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-10", breakerId: "b84-10", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- North wall outlets (secondary run)" },
        ] },
        { id: "b84-12-14", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["12a", "12b", "14a", "14b"], breakerTypeId: "type-double-pole", ampRating: "30", status: "Active", serial: "", installedDate: "", notes: "Electric dryer", circuits: [
          { id: "c84-12-14", breakerId: "b84-12-14", label: "Dryer", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Electric dryer" },
        ] },
        { id: "b84-13", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["13a", "13b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-13", breakerId: "b84-13", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Closet outlets" },
        ] },
        { id: "b84-15-17", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["15a", "15b", "17a", "17b"], breakerTypeId: "type-double-pole", ampRating: "60", status: "Active", serial: "", installedDate: "", notes: "Reserved feed for a future shed sub-panel (not yet installed).", circuits: [
          { id: "c84-15-17", breakerId: "b84-15-17", label: "Feed to shed sub-panel", roomsServedIds: [], feedsPanelLabel: "BCA0101", notes: "- Feeds downstream sub-panel; no direct loads" },
        ] },
        { id: "b84-16", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["16a", "16b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-16", breakerId: "b84-16", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- South wall outlets (secondary run)" },
        ] },
        { id: "b84-18", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["18a", "18b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-18", breakerId: "b84-18", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- East wall outlets (secondary run)" },
        ] },
        { id: "b84-19", panelLabel: "5a4e7b12-9c38-41d6-af70-2b8e6d05c9a3", cells: ["19a", "19b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c84-19", breakerId: "b84-19", label: "Outlets", roomsServedIds: ["BCR0011"], feedsPanelLabel: "", notes: "- Entry wall outlets" },
        ] },
      ],
    },
    {
      label: "BCA0085", type: "Electrical Panel", parentId: "BCR0014", brand: "Square D", model: "QO116L125GRB", serial: "B400-SQD-4473",
      notes: "Sub-panel fed from Main Distribution Panel (Storage Room), 125A main lug.", status: "Active",
      panelSlotCount: 20, panelLayout: "two-column",
      breakers: [
        { id: "b85-1", panelLabel: "BCA0085", cells: ["1a", "1b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-1", breakerId: "b85-1", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- North wall outlets" },
        ] },
        { id: "b85-2", panelLabel: "BCA0085", cells: ["2a", "2b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-2", breakerId: "b85-2", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- South wall outlets" },
        ] },
        { id: "b85-3", panelLabel: "BCA0085", cells: ["3a", "3b"], breakerTypeId: "type-single-pole", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-3", breakerId: "b85-3", label: "Lighting", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Ceiling lights" },
        ] },
        { id: "b85-4a", panelLabel: "BCA0085", cells: ["4a"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-tandem-4", circuits: [
          { id: "c85-4a", breakerId: "b85-4a", label: "Exterior lighting", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Entry door exterior light" },
        ] },
        { id: "b85-4b", panelLabel: "BCA0085", cells: ["4b"], breakerTypeId: "type-tandem", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-tandem-4", circuits: [
          { id: "c85-4b", breakerId: "b85-4b", label: "Closet light", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Closet light" },
        ] },
        { id: "b85-5", panelLabel: "BCA0085", cells: ["5a", "5b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-5", breakerId: "b85-5", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- East wall outlets" },
        ] },
        { id: "b85-6a", panelLabel: "BCA0085", cells: ["6a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-quad-6", circuits: [
          { id: "c85-6a", breakerId: "b85-6a", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- West wall outlets" },
        ] },
        { id: "b85-6b", panelLabel: "BCA0085", cells: ["6b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-quad-6", circuits: [
          { id: "c85-6b", breakerId: "b85-6b", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Desk area outlets" },
        ] },
        { id: "b85-8a", panelLabel: "BCA0085", cells: ["8a"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-quad-6", circuits: [
          { id: "c85-8a", breakerId: "b85-8a", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Workbench outlets" },
        ] },
        { id: "b85-8b", panelLabel: "BCA0085", cells: ["8b"], breakerTypeId: "type-quad", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-quad-6", circuits: [
          { id: "c85-8b", breakerId: "b85-8b", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Under-window outlets" },
        ] },
        { id: "b85-7", panelLabel: "BCA0085", cells: ["7a", "7b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-7", breakerId: "b85-7", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Window wall outlets" },
        ] },
        { id: "b85-9a", panelLabel: "BCA0085", cells: ["9a"], breakerTypeId: "type-split-double", ampRating: "15", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-split-9", circuits: [
          { id: "c85-9a", breakerId: "b85-9a", label: "Garbage disposal", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Under-sink garbage disposal" },
        ] },
        { id: "b85-9b-11a", panelLabel: "BCA0085", cells: ["9b", "11a"], breakerTypeId: "type-split-double", ampRating: "30", status: "Active", serial: "", installedDate: "", notes: "", groupId: "grp85-split-9", circuits: [
          { id: "c85-9b-11a", breakerId: "b85-9b-11a", label: "Microwave", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Countertop microwave" },
        ] },
        { id: "b85-11b", panelLabel: "BCA0085", cells: ["11b"], breakerTypeId: "type-split-double", ampRating: "15", status: "Spare", serial: "", installedDate: "", notes: "", groupId: "grp85-split-9", circuits: [] },
        { id: "b85-10", panelLabel: "BCA0085", cells: ["10a", "10b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-10", breakerId: "b85-10", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- North wall outlets (secondary run)" },
        ] },
        { id: "b85-12-14", panelLabel: "BCA0085", cells: ["12a", "12b", "14a", "14b"], breakerTypeId: "type-double-pole", ampRating: "40", status: "Active", serial: "", installedDate: "", notes: "EV charger", circuits: [
          { id: "c85-12-14", breakerId: "b85-12-14", label: "EV Charger", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Garage EV charger" },
        ] },
        { id: "b85-13", panelLabel: "BCA0085", cells: ["13a", "13b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-13", breakerId: "b85-13", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Closet outlets" },
        ] },
        { id: "b85-15-17", panelLabel: "BCA0085", cells: ["15a", "15b", "17a", "17b"], breakerTypeId: "type-double-pole", ampRating: "60", status: "Active", serial: "", installedDate: "", notes: "Reserved feed for a future greenhouse sub-panel (not yet installed).", circuits: [
          { id: "c85-15-17", breakerId: "b85-15-17", label: "Feed to greenhouse sub-panel", roomsServedIds: [], feedsPanelLabel: "BCA0102", notes: "- Feeds downstream sub-panel; no direct loads" },
        ] },
        { id: "b85-16", panelLabel: "BCA0085", cells: ["16a", "16b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-16", breakerId: "b85-16", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- South wall outlets (secondary run)" },
        ] },
        { id: "b85-18", panelLabel: "BCA0085", cells: ["18a", "18b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-18", breakerId: "b85-18", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- East wall outlets (secondary run)" },
        ] },
        { id: "b85-19", panelLabel: "BCA0085", cells: ["19a", "19b"], breakerTypeId: "type-single-pole", ampRating: "20", status: "Active", serial: "", installedDate: "", notes: "", circuits: [
          { id: "c85-19", breakerId: "b85-19", label: "Outlets", roomsServedIds: ["BCR0014"], feedsPanelLabel: "", notes: "- Entry wall outlets" },
        ] },
      ],
    },
    // Mitsubishi mini-split indoor units — one per Room, linked via roomId like any
    // other device. Maintenance items mirror the real-world service schedule: filter
    // cleaning is a monthly DIY task, coil cleaning is an annual pro-service task.
    // The one asset carrying the v34 maintenance<->change link in its stored
    // shape: both items already have an `id`, and `changes` holds entries
    // pointing back at them. Deliberately MIXED with the legacy-shaped rows
    // below (no item ids, no changes at all) -- a fixture that is uniformly one
    // shape exercises half the code, which is exactly how the personIds bug hid
    // in Sandbox and then wiped assignments on the live sheet.
    //
    // The third change is a DANGLING link: it names a schedule that no longer
    // exists on this asset. That is a normal state, not corruption -- a change
    // outlives the schedule that prompted it -- and it is here so the "resolves
    // to nothing, render no badge" path is exercised without anyone staging it.
    { label: "BCA0086", type: "Mini Split", parentId: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { id: "mnt-0086-filter", task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "2026-08-14", owner: "Eric", at: "", by: "" },
      { id: "mnt-0086-coil", task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "2026-03-02", owner: "", at: "", by: "" },
    ], changes: [
      { id: "chg-0086-filter-may", changeType: "Maintenance", vendor: "", cost: "", note: "Filter rinsed and dried. Light dust only.", at: "2026-07-15T16:20:00.000Z", by: "Eric Stamand", maintenanceId: "mnt-0086-filter", performedOn: "2026-05-28" },
      { id: "chg-0086-coil-mar", changeType: "Maintenance", vendor: "Central Coast HVAC", cost: "185.00", note: "Coil cleaned, condensate line flushed. Tech noted slight fin damage on the return side — watch it next visit.", at: "2026-03-02T18:05:00.000Z", by: "Eric Stamand", maintenanceId: "mnt-0086-coil", performedOn: "2026-03-02" },
      { changeType: "Maintenance", vendor: "", cost: "40.00", note: "Logged against a schedule that has since been deleted — should render with no maintenance badge.", at: "2026-01-09T15:00:00.000Z", by: "Eric Stamand", maintenanceId: "mnt-0086-retired", performedOn: "2026-01-08" },
      { changeType: "Repair", vendor: "Central Coast HVAC", cost: "220.00", note: "Replaced remote receiver board.", at: "2026-02-11T19:40:00.000Z", by: "Eric Stamand" },
    ] },
    { label: "BCA0087", type: "Mini Split", parentId: "BCR0008", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "", owner: "", at: "", by: "" },
      { task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0088", type: "Mini Split", parentId: "BCR0011", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "", owner: "", at: "", by: "" },
      { task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0089", type: "Mini Split", parentId: "BCR0014", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "", owner: "", at: "", by: "" },
      { task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0090", type: "Mini Split", parentId: "BCR0002", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "", owner: "", at: "", by: "" },
      { task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0091", type: "Mini Split", parentId: "BCR0018", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "", owner: "", at: "", by: "" },
      { task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0092", type: "Mini Split", parentId: "BCR0020", brand: "Mitsubishi", model: "MSZ-GL15NA", serial: "", notes: "Wall-mounted indoor unit", status: "Active", maintenanceItems: [
      { task: "Filter clean", frequencyLabel: "Monthly", frequencyDays: 30, lastPerformed: "", owner: "", at: "", by: "" },
      { task: "Air handler coil clean", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    // Mitsubishi outdoor condenser/compressor units — one per Building, linked
    // directly via buildingId (TYPE_REGISTRY.Condenser's linkage: "building") since
    // an outdoor unit sits outside any one Room. Building 100 has 4 indoor zones
    // (Room 102, Kitchen, Storage Room, Room 101), so it gets a 4-zone outdoor
    // unit; the others each have a single zone.
    // A second linked asset, with several completions against ONE schedule --
    // which is the shape the service-history section exists to show, and the
    // one a single-completion fixture would not reach.
    { label: "BCA0093", type: "Condenser", name: "Building 100", parentId: "BCB0001", brand: "Mitsubishi", model: "MXZ-4C36NAHZ", serial: "", notes: "Outdoor condenser/compressor, 4-zone multi-split.", status: "Active", maintenanceItems: [
      { id: "mnt-0093-inspect", task: "Inspection / cleaning", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "2026-05-19", owner: "Eric", at: "", by: "" },
    ], changes: [
      { id: "chg-0093-may26", changeType: "Maintenance", vendor: "Central Coast HVAC", cost: "310.00", note: "Annual service. Coils washed, refrigerant charge checked, all four zones tested.", at: "2026-05-19T17:30:00.000Z", by: "Eric Stamand", maintenanceId: "mnt-0093-inspect", performedOn: "2026-05-19" },
      { changeType: "Maintenance", vendor: "Central Coast HVAC", cost: "295.00", note: "Annual service. No faults found.", at: "2025-05-22T16:15:00.000Z", by: "Eric Stamand", maintenanceId: "mnt-0093-inspect" },
    ] },
    { label: "BCA0094", type: "Condenser", parentId: "BCB0002", brand: "Mitsubishi", model: "MUZ-GL15NA", serial: "", notes: "Outdoor condenser/compressor, single-zone.", status: "Active", maintenanceItems: [
      { task: "Inspection / cleaning", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0095", type: "Condenser", parentId: "BCB0003", brand: "Mitsubishi", model: "MUZ-GL15NA", serial: "", notes: "Outdoor condenser/compressor, single-zone.", status: "Active", maintenanceItems: [
      { task: "Inspection / cleaning", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    { label: "BCA0096", type: "Condenser", parentId: "BCB0004", brand: "Mitsubishi", model: "MUZ-GL15NA", serial: "", notes: "Outdoor condenser/compressor, single-zone.", status: "Active", maintenanceItems: [
      { task: "Inspection / cleaning", frequencyLabel: "Annually", frequencyDays: 365, lastPerformed: "", owner: "", at: "", by: "" },
    ] },
    // --- Sample residential panel, transcribed from the "Electrical Map" Logseq
    // page (a hand-written circuit map for a two-storey house). Kept as sample
    // data because it exercises shapes the school panels above don't: a panel
    // that's tandem-filled top to bottom, circuits serving several rooms at once
    // (some spanning both floors), and slots whose load was never written down.
    // The source labels positions "1A/1B" ... "9A/9B", which maps one-to-one onto
    // this app's half-slot cell addressing (cells "1a"/"1b" — see
    // BREAKER_TYPES_ARCHITECTURE.md), so every breaker here reads with the same
    // name it has on the handwritten map. The panel is 12 slots in the usual
    // two-column layout (odd left / even right); the map only documents
    // positions 1-9, so slots 10-12 sit empty and render as spares. The map
    // listing nine positions is NOT evidence the panel has nine slots — that
    // was assumed here once and corrected.
    { label: "BCB0005", type: "Building", name: "Kramer Residence", parentId: "BCC0002", brand: "", model: "", serial: "", person: "", peripherals: "", notes: "Two-storey house — sample data behind the Electrical Map panel.", totalQuantity: "", purchaseDate: "", warrantyUntil: "", status: "Active" },
    { label: "BCR0021", type: "Room", name: "Kitchen (Upstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0022", type: "Room", name: "Dining Room (Upstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0023", type: "Room", name: "Living Room (Upstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0024", type: "Room", name: "Bathroom (Upstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0025", type: "Room", name: "James's Room (Downstairs)", parentId: "BCB0005", person: "James", notes: "", status: "Active" },
    { label: "BCR0026", type: "Room", name: "Living Room (Downstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0027", type: "Room", name: "Office (Downstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0028", type: "Room", name: "Utility Room (Downstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0029", type: "Room", name: "Bathroom (Downstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0030", type: "Room", name: "Hall (Downstairs)", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    { label: "BCR0031", type: "Room", name: "Water Heater Closet", parentId: "BCB0005", person: "", notes: "", status: "Active" },
    {
      label: "BCA0097", type: "Electrical Panel", parentId: "BCR0028", brand: "", model: "", serial: "",
      notes: "Transcribed from the Electrical Map page. Positions 1A-9B on the handwritten map are cells 1a-9b here. Amp ratings are NOT from the source — 15A assumed for lighting-only circuits, 20A for everything else — so verify at the panel before relying on them.",
      status: "Active",
      panelSlotCount: 12, panelLayout: "two-column",
      breakers: [
        // 1A/1B and 3A/3B are listed on the map with nothing under them: the
        // breakers are there, what they feed was never written down. Recorded as
        // breakers carrying no circuit rather than as empty slots, which would
        // claim the position is unused.
        { id: "bH-1a", panelLabel: "BCA0097", cells: ["1a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "Load not documented on the source circuit map.", groupId: "grpH-1", circuits: [] },
        { id: "bH-1b", panelLabel: "BCA0097", cells: ["1b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "Load not documented on the source circuit map.", groupId: "grpH-1", circuits: [] },
        { id: "bH-2a", panelLabel: "BCA0097", cells: ["2a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "Marked '(?)' on the source map, with 'Future garbage disposal?' under it — unconfirmed.", groupId: "grpH-2", circuits: [] },
        { id: "bH-2b", panelLabel: "BCA0097", cells: ["2b"], breakerTypeId: "type-tandem", ampRating: "15", serial: "", installedDate: "", notes: "", groupId: "grpH-2", circuits: [
          { id: "cH-2b", breakerId: "bH-2b", label: "Kitchen & dining lights (upstairs)", roomsServedIds: ["BCR0021", "BCR0022"], feedsPanelLabel: "", notes: "- Kitchen lights\n- Dining lights" },
        ] },
        { id: "bH-3a", panelLabel: "BCA0097", cells: ["3a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "Load not documented on the source circuit map.", groupId: "grpH-3", circuits: [] },
        { id: "bH-3b", panelLabel: "BCA0097", cells: ["3b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "Load not documented on the source circuit map.", groupId: "grpH-3", circuits: [] },
        { id: "bH-4a", panelLabel: "BCA0097", cells: ["4a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-4", circuits: [
          { id: "cH-4a", breakerId: "bH-4a", label: "Refrigerator", roomsServedIds: ["BCR0021"], feedsPanelLabel: "", notes: "- Fridge (upstairs kitchen)" },
        ] },
        { id: "bH-4b", panelLabel: "BCA0097", cells: ["4b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-4", circuits: [
          { id: "cH-4b", breakerId: "bH-4b", label: "Water heater", roomsServedIds: ["BCR0031"], feedsPanelLabel: "", notes: "- Water heater closet" },
        ] },
        { id: "bH-5a", panelLabel: "BCA0097", cells: ["5a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-5", circuits: [
          { id: "cH-5a", breakerId: "bH-5a", label: "Living room outlets (upstairs)", roomsServedIds: ["BCR0023"], feedsPanelLabel: "", notes: "- Living room plugs" },
        ] },
        { id: "bH-5b", panelLabel: "BCA0097", cells: ["5b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-5", circuits: [
          { id: "cH-5b", breakerId: "bH-5b", label: "James's room + adjacent living room outlets", roomsServedIds: ["BCR0025", "BCR0026"], feedsPanelLabel: "", notes: "- James's room\n- Living room plugs outside James's room" },
        ] },
        { id: "bH-6a", panelLabel: "BCA0097", cells: ["6a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-6", circuits: [
          { id: "cH-6a", breakerId: "bH-6a", label: "Freezer / hot tub", roomsServedIds: ["BCR0028"], feedsPanelLabel: "", notes: "- Utility room freezer\n- Hot tub" },
        ] },
        // 6B and 8B each run to both floors — one branch circuit, several rooms,
        // which is exactly why roomsServedIds is a list and not a single room.
        { id: "bH-6b", panelLabel: "BCA0097", cells: ["6b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-6", circuits: [
          { id: "cH-6b", breakerId: "bH-6b", label: "Kitchen outlets + back door / downstairs bath", roomsServedIds: ["BCR0021", "BCR0029"], feedsPanelLabel: "", notes: "- Kitchen plugs, upstairs (not the fridge)\n- Junction above the back door, downstairs\n- Plug outside the back door, downstairs\n- Bathroom under-sink plug, downstairs" },
        ] },
        { id: "bH-7a", panelLabel: "BCA0097", cells: ["7a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-7", circuits: [
          { id: "cH-7a", breakerId: "bH-7a", label: "Living room outlets (downstairs)", roomsServedIds: ["BCR0026"], feedsPanelLabel: "", notes: "- Living room, downstairs" },
        ] },
        { id: "bH-7b", panelLabel: "BCA0097", cells: ["7b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-7", circuits: [
          { id: "cH-7b", breakerId: "bH-7b", label: "Office outlets", roomsServedIds: ["BCR0027"], feedsPanelLabel: "", notes: "- Office plugs, downstairs" },
        ] },
        { id: "bH-8a", panelLabel: "BCA0097", cells: ["8a"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-8", circuits: [
          { id: "cH-8a", breakerId: "bH-8a", label: "Unidentified — inside utility room wall", roomsServedIds: ["BCR0028"], feedsPanelLabel: "", notes: "- Runs into the utility room wall; load not identified on the source map" },
        ] },
        { id: "bH-8b", panelLabel: "BCA0097", cells: ["8b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-8", circuits: [
          { id: "cH-8b", breakerId: "bH-8b", label: "Upstairs bathroom + stove + exterior light", roomsServedIds: ["BCR0024", "BCR0021"], feedsPanelLabel: "", notes: "- Bathroom plugs and lights, upstairs\n- Plug outside the bathroom door, upstairs\n- Kitchen stove, upstairs\n- Outside light, downstairs" },
        ] },
        { id: "bH-9a", panelLabel: "BCA0097", cells: ["9a"], breakerTypeId: "type-tandem", ampRating: "15", serial: "", installedDate: "", notes: "", groupId: "grpH-9", circuits: [
          { id: "cH-9a", breakerId: "bH-9a", label: "Downstairs lighting", roomsServedIds: ["BCR0027", "BCR0030", "BCR0026", "BCR0029", "BCR0028"], feedsPanelLabel: "", notes: "- Office light\n- Hall light\n- Living room lights\n- Bathroom lights and plug\n- Utility room lights" },
        ] },
        { id: "bH-9b", panelLabel: "BCA0097", cells: ["9b"], breakerTypeId: "type-tandem", ampRating: "20", serial: "", installedDate: "", notes: "", groupId: "grpH-9", circuits: [
          { id: "cH-9b", breakerId: "bH-9b", label: "Washer/dryer + utility counter", roomsServedIds: ["BCR0028"], feedsPanelLabel: "", notes: "- Washer/dryer\n- Utility room counter" },
        ] },
        // Not on the Logseq map — added directly in the app by Eric and folded in
        // from here. A 240V double-pole across slots 10 and 12 (same column, per
        // the stacking rule in BREAKER_TYPES_ARCHITECTURE.md s4); what it feeds
        // isn't recorded yet, hence no circuit.
        { id: "bH-10-12", panelLabel: "BCA0097", cells: ["10a", "10b", "12a", "12b"], breakerTypeId: "type-double-pole", ampRating: "30", serial: "", installedDate: "", notes: "", groupId: "grpH-10", circuits: [] },
      ],
      unassignedCircuits: [],
    },
  ],
  breakerTypes: SEEDED_BREAKER_TYPES,
  // Deliberately MIXED, the same way the asset ids and the work-entry ids are:
  // one photo on an asset, one on a breaker, one on a circuit, one hidden from
  // the public page, and one carrying no thumbUrl so the derive-a-thumbnail
  // fallback is exercised. A fixture that was all one shape would exercise half
  // the code -- the personIds lesson, applied deliberately.
  //
  // The urls point at a real, tiny, publicly-fetchable placeholder so the render
  // path actually paints something in Sandbox. Nothing here reaches Cloudinary.
  // NOTE: every constant MOCK_SNAPSHOT names must be stubbed in the tests that
  // evaluate this fixture as source text (test-frontend-assetid.js does, and
  // stubs FRONTEND_SCRIPT_VERSION and SEEDED_BREAKER_TYPES for the same reason).
  // Adding a reference here without adding the stub there fails with a bare
  // ReferenceError that names the constant but not why.
  photos: MOCK_PHOTOS,
  // Enough history to exercise BOTH audit sections without a backend, since the
  // whole point of Sandbox is building this before a redeploy. Deliberately
  // covers the three shapes that behave differently:
  //   - a move, which names two rooms and must read "out" from one and "in" from
  //     the other off this ONE row;
  //   - a create, which names one room with role `at`;
  //   - an edit naming nobody, which must appear only under its own asset and
  //     under its room's "activity on contents".
  auditLog: [
    {
      at: "2026-08-10T16:20:00.000Z", by: "Eric", assetLabel: "b81c60de-2f47-4a93-8e15-0d7c39ab6215", assetType: "Computer",
      action: "created", related: relate({ at: "BCR0008" }),
    },
    {
      at: "2026-08-18T15:05:00.000Z", by: "Eric", assetLabel: "b81c60de-2f47-4a93-8e15-0d7c39ab6215", assetType: "Computer",
      action: "edited", field: "Serial", from: "MOCK-CMP-000", to: "MOCK-CMP-001", related: "",
    },
    {
      at: "2026-08-22T17:40:00.000Z", by: "Eric", assetLabel: "b81c60de-2f47-4a93-8e15-0d7c39ab6215", assetType: "Computer",
      action: "edited", field: "Parent", from: "Room 200", to: "Room 102",
      related: relate({ from: "BCR0008", to: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80" }),
    },
    {
      at: "2026-08-24T18:12:00.000Z", by: "Eric", assetLabel: "BCA0002", assetType: "Monitor",
      action: "edited", field: "Parent", from: "Unassigned", to: "Room 102",
      related: relate({ to: "3f2a91c4-7d55-4e18-9b02-6c1ae5d47f80" }),
    },
  ],
};

return MOCK_SNAPSHOT;
};
