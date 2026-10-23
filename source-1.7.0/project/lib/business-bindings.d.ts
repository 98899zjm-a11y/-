// Type-only binding names used by the existing shared server contract.
// The desktop release compiler supplies LocalD1/LocalBucket through its
// request-scoped runtime context. Optional fields retain the existing missing-
// binding guards; this declaration creates no bindings or Cloudflare deployment.
// It does not certify that local adapters implement every cloud-provider API.
declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
