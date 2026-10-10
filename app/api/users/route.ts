import { api, authenticated, assertAdmin, getBootstrap, inviteUser, updateUser } from "@/lib/server";
export const dynamic = "force-dynamic";
export async function GET() { return api(async () => { const { user } = await authenticated(); assertAdmin(user); return { users: (await getBootstrap()).users }; }); }
export async function POST(request: Request) { return api(() => inviteUser(request), 201); }
export async function PATCH(request: Request) { return api(() => updateUser(request)); }
