// Upload signatures for Cloudinary: handlePhotoSign_ and handleFloorPlanSign_.
//
// The browser uploads DIRECTLY to Cloudinary; this only hands out a short-lived
// signature, and writes nothing. Everything that makes that safe is the .gs's
// and is kept exactly:
//   - the folder and the object name are chosen HERE, never taken from the
//     request, so a signature authorizes exactly one server-named object;
//   - a batch is N independent signatures, never one covering a prefix;
//   - a photo's allowed formats are SIGNED, so the host enforces them;
//   - a floor plan signs NO allowed_formats (v51; see the .gs for why).
//
// The credentials are one Cloudinary account shared by every tenant, so they
// are Edge Function secrets (Supabase > Edge Functions > Secrets), never in
// this public repo. The folder is per tenant: `tenants.cloudinary_folder`,
// falling back to "assets" as CLOUDINARY_FOLDER does.
//
// sign_test.ts runs the .gs's own handlers with the same clock, ids and
// credentials and requires identical answers.

export const PHOTO_ALLOWED_FORMATS = "jpg,png,pdf";
export const PHOTO_SIGN_MAX_BATCH = 25;
export const DEFAULT_FOLDER = "assets";

export type CloudinaryCreds = { cloudName: string; apiKey: string; apiSecret: string };

export const NOT_SET_UP =
  "File uploads aren't set up on this backend. Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY " +
  "and CLOUDINARY_API_SECRET under Supabase > Edge Functions > Secrets.";

export function credsFromEnv(get: (k: string) => string | undefined): CloudinaryCreds | null {
  const cloudName = get("CLOUDINARY_CLOUD_NAME") || "";
  const apiKey = get("CLOUDINARY_API_KEY") || "";
  const apiSecret = get("CLOUDINARY_API_SECRET") || "";
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

async function sha1Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

// cloudinarySignature_: every signed parameter sorted by name, k=v joined by &,
// the secret appended with no separator, SHA-1'd. Blank values are not signed.
export function cloudinarySignature(params: Record<string, unknown>, secret: string) {
  const toSign = Object.keys(params)
    .filter((k) => params[k] !== "" && params[k] !== null && params[k] !== undefined)
    .sort()
    .map((k) => k + "=" + params[k])
    .join("&");
  return sha1Hex(toSign + secret);
}

type SignInput = { creds: CloudinaryCreds; folder: string | null; now: number; uuid: () => string };

export async function signPhotos(count: unknown, { creds, folder, now, uuid }: SignInput) {
  const dir = folder || DEFAULT_FOLDER;
  const timestamp = Math.floor(now / 1000);
  const requested = Math.floor(Number(count) || 1);
  const n = Math.max(1, Math.min(requested, PHOTO_SIGN_MAX_BATCH));
  const signatures = [];
  for (let i = 0; i < n; i++) {
    const publicId = uuid();
    const params = { folder: dir, public_id: publicId, timestamp, allowed_formats: PHOTO_ALLOWED_FORMATS };
    signatures.push({
      cloudName: creds.cloudName,
      apiKey: creds.apiKey,
      folder: dir,
      publicId,
      timestamp,
      allowed_formats: PHOTO_ALLOWED_FORMATS,
      signature: await cloudinarySignature(params, creds.apiSecret),
      signedParams: Object.keys(params).sort(),
    });
  }
  // The first is also spread at the top level, for a pre-v37 client.
  return { ok: true, signatures, ...signatures[0] };
}

export async function signFloorPlan({ creds, folder, now, uuid }: SignInput) {
  const dir = folder || DEFAULT_FOLDER;
  const timestamp = Math.floor(now / 1000);
  const publicId = uuid();
  const params = { folder: dir, public_id: publicId, timestamp };
  return {
    ok: true,
    cloudName: creds.cloudName,
    apiKey: creds.apiKey,
    folder: dir,
    publicId,
    timestamp,
    resourceType: "raw",
    signature: await cloudinarySignature(params, creds.apiSecret),
    signedParams: Object.keys(params).sort(),
  };
}
