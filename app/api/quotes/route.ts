import { api, quotePage, createQuote } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return api(() => quotePage(request)); }
export async function POST(request: Request) { return api(() => createQuote(request), 201); }
