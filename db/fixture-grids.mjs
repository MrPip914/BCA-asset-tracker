// A tenant's Sheet as the Sheets API returns it, deliberately MIXED: a legacy
// asset keyed by label, a duplicate id, a blank work-entry id, an orphan
// breaker, an unassigned circuit, a non-JSON Config cell, and more audit rows
// than an ordinary read returns. Shared by db/test-import.mjs and the API's
// parity test, so both check the same shapes.

export const AUDIT_ROWS = 2500; // past AUDIT_READ_LIMIT (2000): an import must carry them all
export const grids = {
  // Trailing blank cells omitted on some rows, as the Sheets API returns them.
  Assets: [
    ["id", "label", "tag", "type", "name", "parentId", "personIds", "serial"],
    ["", "BCA0001", "BCA0001", "Building", "Building 100"],                    // legacy: no id, keyed by label
    ["room-uuid", "BCR0002", "", "Room", "Room 101", "BCA0001"],
    ["pc-uuid", "BCA0003", "BCA0003", "Computer", "Front desk PC", "room-uuid", "u1, u2", 12345],
    ["panel-uuid", "BCA0004", "BCA0004", "Electrical Panel", "", "room-uuid"],
    ["pc-uuid", "BCA9999", "", "Computer", "duplicate id"],                   // duplicate: dropped
  ],
  Comments: [["assetLabel", "text", "at", "by"], ["pc-uuid", "Fan noisy", "2026-01-01", "Eric"]],
  Changes: [
    ["assetLabel", "id", "changeType", "vendor", "cost", "note", "at", "by", "maintenanceId", "performedOn"],
    ["pc-uuid", "ch-1", "Repair", "", 40, "fan", "2026-01-02", "Eric", "m-1", "2026-01-02"],
    ["pc-uuid", "", "Upgrade", "", "", "pre-v34 row", "2025-05-01", "Eric"],   // blank id: minted
  ],
  Allocations: [["assetLabel", "room", "quantity"]],
  Maintenance: [
    ["assetLabel", "id", "kind", "task", "notes", "frequencyLabel", "frequencyDays", "dueDate", "lastPerformed", "owner", "at", "by"],
    ["pc-uuid", "m-1", "", "Dust", "", "Monthly", 30, "", "2026-01-02", "Eric", "", ""],
  ],
  Breakers: [
    ["id", "panelLabel", "cells", "ampRating", "status", "serial", "installedDate", "notes", "groupId", "breakerTypeId"],
    ["b-1", "panel-uuid", "1a,1b", 20, "", "", "", "", "g-1", "bt-1"],
    ["b-orphan", "nowhere", "3", 15],                                         // panel missing: doGet drops it
  ],
  Circuits: [
    ["id", "breakerId", "panelLabel", "label", "roomsServed", "feedsPanelLabel", "notes", "tag", "wireColor", "sharedNeutralWith"],
    ["c-1", "b-1", "panel-uuid", "Outlets", "room-uuid", "", "", "1", "Black", "c-2"],
    ["c-2", "", "panel-uuid", "Spare run", "", "", "", "2"],                  // unassigned
  ],
  BreakerTypes: [["id", "name", "slotSpan", "members"], ["bt-1", "Single-Pole", 1, '[{"cells":["1a","1b"],"ampRating":20}]']],
  SpaceLinks: [["assetLabel", "shapeId", "roomId", "at", "by"], ["BCA0001", "s1", "room-uuid", "", ""], ["BCA0001", "s1#e2", "room-uuid", "", ""]],
  SpaceGroups: [["id", "assetLabel", "name", "hideLabel", "memberShapeIds", "at", "by"], ["sg-1", "BCA0001", "Wing", true, "s1,s2", "", ""]],
  Photos: [
    ["id", "ownerType", "ownerId", "url", "thumbUrl", "storageKey", "kind", "fileName", "caption", "width", "height", "bytes", "hiddenFromPublic", "at", "by"],
    ["p-1", "asset", "panel-uuid", "https://x/1.jpg", "", "k1", "", "", "Door", 800, 600, "", true],
    ["p-2", "change", "ch-1", "https://x/2.pdf", "", "k2", "pdf", "quote.pdf"],
  ],
  AuditLog: [
    ["assetLabel", "assetType", "action", "field", "from", "to", "room", "quantity", "previousQuantity", "note", "at", "by", "related"],
    ...Array.from({ length: AUDIT_ROWS }, (_, i) => ["pc-uuid", "Computer", "edited", "serial", String(i), String(i + 1), "", "", "", "", `2026-01-01T00:00:${i}`, "Eric"]),
  ],
  Config: [
    ["key", "value"],
    ["typesList", '[{"id":"Room","name":"Room"}]'],
    ["nextAssetNumber", "5"],
    ["hash_Assets", "ab12cd"],                          // not JSON, and must not come across
    ["rev_assets", 7],
    ["authUsers", '[{"email":"Jane@School.test","name":"Jane","role":"viewer"}]'],
    ["handEdited", "{not json"],                         // kept as a string, with a warning
    ["futureKey", '{"x":1}'],                            // unknown to doGet: still preserved
  ],
};

