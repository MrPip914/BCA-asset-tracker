/**
 * TENANT REGISTRY
 * ===============
 * One entry per organisation the app is deployed for. Everything that differs
 * between clients lives here; nothing else in the app should hardcode a school's
 * name, its Apps Script URL, or its asset-ID prefix.
 *
 * WHY ONE FILE FOR EVERY TENANT rather than one file per tenant: a per-tenant
 * JSON file would have to be FETCHED before the app knows which backend to talk
 * to — a network round trip and a loading state in front of every page load, and
 * an async step in a codebase with no build to absorb it. A plain <script src>
 * is already resolved by the time the app starts, so the config is simply there.
 * Nothing in here is secret, so splitting the file would hide nothing either:
 * the /exec URLs have been public for as long as the repo has, and are protected
 * by sign-in rather than by being hard to find.
 *
 * Load it BEFORE the app, in <head>:  <script src="clients.js"></script>
 * It sets window.ASSET_TRACKER_CLIENT to the resolved tenant.
 *
 * ADDING A CLIENT is an entry below plus a Sheet and a deployment. See
 * MULTI_CLIENT_DEPLOYMENT.md for the onboarding steps.
 *
 * NOT here, deliberately: GOOGLE_CLIENT_ID / OAUTH_CLIENT_ID. One OAuth client
 * serves every tenant, because Google only answers "is this really them?" — the
 * per-Sheet authUsers allowlist is what answers "may they in". Holding a client
 * id authorizes nothing, so sharing one leaks nothing between clients, and it
 * keeps the authorized-JavaScript-origins list to one entry instead of one per
 * client. The backend's OAUTH_CLIENT_ID stays a constant to match.
 */
(function () {
  "use strict";

  var CLIENTS = {
    bca: {
      appName: "BCA Asset Tracker",
      orgName: "Brookside Christian Academy",
      // Prefix for generated Asset IDs (BCA0082). Rooms and Buildings carry
      // BCR/BCB labels on the live sheet, but those predate the counter and are
      // never issued by it — there is no per-type prefix scheme.
      labelPrefix: "BCA",
      apiUrl: "https://script.google.com/macros/s/AKfycbzXaKRuCrTesxobxP-b2me1TSn0YoGogoYhNPTWU4qWWjXANXGlPuDzJSKGClOTsfOXRQ/exec",
    },
  };

  // A bare https://assets.stama.tech is Brookside. That is what keeps every
  // existing bookmark and link working without a ?client= on it, and it is why
  // this app needed no data migration to become multi-tenant.
  //
  // Note the asymmetry it creates: storageKey() below namespaces by id for EVERY
  // tenant including this one, so changing this default does not silently hand a
  // new tenant the old one's stored session.
  var DEFAULT_CLIENT_ID = "bca";

  var params = new URLSearchParams(window.location.search);

  // Two spellings for the same thing. "client" is the readable one used in links
  // people type or paste; "c" is for QR stickers, where the URL is encoded as
  // bars and every character costs physical resolution on a label small enough
  // to fit inside a panel door.
  var requested = (params.get("client") || params.get("c") || "").trim().toLowerCase();

  var id = Object.prototype.hasOwnProperty.call(CLIENTS, requested) ? requested : DEFAULT_CLIENT_ID;

  // An unrecognised id falls back to the default rather than refusing. A typo'd
  // link then shows the default tenant's sign-in screen, which is the same thing
  // a bare URL shows and gives nothing away — access is decided by that tenant's
  // own allowlist, not by which config the browser loaded. `unknownRequest` is
  // kept so the About panel can say so, since "why am I looking at the wrong
  // school" is otherwise a hard question to answer from inside the app.
  var config = CLIENTS[id];

  window.ASSET_TRACKER_CLIENT = {
    id: id,
    appName: config.appName,
    orgName: config.orgName,
    labelPrefix: config.labelPrefix,
    apiUrl: config.apiUrl,
    isDefault: id === DEFAULT_CLIENT_ID,
    unknownRequest: requested && requested !== id ? requested : null,

    /**
     * Namespace a localStorage key to this tenant.
     *
     * Every tenant is served from ONE origin (assets.stama.tech/?client=...), so
     * localStorage is shared between them. Without this, opening client B after
     * client A hands B's backend A's session id. B rejects it correctly — so
     * this is not a security hole — but it presents as a mysteriously broken
     * sign-in, which is far worse to diagnose than to prevent. Column
     * visibility, the sandbox fixture and the sandbox name tag collide the same
     * way, less dangerously and just as confusingly.
     *
     * Namespaced for EVERY tenant, the default included. Letting the default
     * keep the bare keys would have avoided a one-time migration, at the price
     * of the stored state silently transferring if DEFAULT_CLIENT_ID ever
     * changed. index.html adopts the pre-namespace values once instead — see
     * adoptLegacyStorageKeys() there.
     */
    storageKey: function (base) {
      return base + ":" + id;
    },

    /**
     * Add this tenant to a URL built by the app — a copied deep link, a printed
     * QR sticker. Omitted for the default tenant so its links stay exactly as
     * they are today, which is the whole point of having a default.
     */
    urlParam: function () {
      return id === DEFAULT_CLIENT_ID ? "" : "c=" + encodeURIComponent(id);
    },
  };

  // The whole registry, for things that need every tenant rather than this one.
  // deploy.mjs evaluates this file to find which /exec to verify against — a
  // regex over the source would work with one tenant and quietly pick the wrong
  // one the moment there are two.
  window.ASSET_TRACKER_CLIENTS = CLIENTS;
  window.ASSET_TRACKER_DEFAULT_CLIENT_ID = DEFAULT_CLIENT_ID;
})();
