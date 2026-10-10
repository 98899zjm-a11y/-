import { api, getQuote } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { return api(async () => getQuote((await context.params).id)); }
