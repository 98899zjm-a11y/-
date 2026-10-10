import { api, getMedia, createMedia, updateMedia } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(getMedia); }
export async function POST(request: Request) { return api(() => createMedia(request), 201); }
export async function PATCH(request: Request) { return api(() => updateMedia(request)); }
