import { api, getBootstrap, createCustomer, updateCustomer } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(async () => ({ customers: (await getBootstrap()).customers })); }
export async function POST(request: Request) { return api(() => createCustomer(request), 201); }
export async function PATCH(request: Request) { return api(() => updateCustomer(request)); }
