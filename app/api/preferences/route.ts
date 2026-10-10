import { api, getPreferences, updatePreferences } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(getPreferences); }
export async function PATCH(request: Request) { return api(() => updatePreferences(request)); }
