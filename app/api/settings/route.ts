import { api, getBootstrap, updateSettings } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(async () => ({ settings: (await getBootstrap()).settings })); }
export async function PATCH(request: Request) { return api(() => updateSettings(request)); }
