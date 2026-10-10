import { api, getImage } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return api(async () => getImage((await context.params).id)); }
