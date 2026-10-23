// Compatibility identity export for the V1.6 company-host business target.
// Read the trusted request context on every invocation, never at module import.
export type DesktopIdentity = {
  userId: string | null;
  email: string;
  displayName: string;
};

export async function getChatGPTUser(): Promise<DesktopIdentity | null> {
  return (globalThis as typeof globalThis & {
    __xjyDesktopContext: () => { identity: DesktopIdentity | null };
  }).__xjyDesktopContext().identity;
}
