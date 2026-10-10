import { api, getBootstrap } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(getBootstrap); }
