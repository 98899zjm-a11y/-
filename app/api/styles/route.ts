import { api, getBootstrap, createStyle, updateStyle } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(async () => ({ styles: (await getBootstrap()).styles })); }
export async function POST(request: Request) { return api(() => createStyle(request), 201); }
export async function PATCH(request: Request) { return api(() => updateStyle(request)); }
