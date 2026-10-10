import { api, attachQuoteImages } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { return api(async () => attachQuoteImages(request, (await context.params).id), 201); }
