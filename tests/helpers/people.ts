import { vi } from "vitest";
import type { Role } from "@/lib/roles";

// Stands in for Clerk. tests/setup.ts puts clerkServer in place of "@clerk/nextjs/server".

export type ClerkUser = {
  id: string;
  fullName: string | null;
  username: string | null;
  primaryEmailAddress: { emailAddress: string } | null;
  publicMetadata: Record<string, unknown>;
};

type PersonOptions = {
  id?: string;
  fullName?: string | null;
  username?: string | null;
  email?: string | null;
  // Replaces the metadata that comes from the role, to try missing or unknown roles.
  metadata?: Record<string, unknown>;
  // True when the login token carries the metadata, so no call to Clerk is needed.
  roleInToken?: boolean;
};

export const SOMEONE_ELSE = "user_someone_else";

let current: { user: ClerkUser; roleInToken: boolean } | null = null;
const directory = new Map<string, ClerkUser>();

function makeUser(role: Role, options: PersonOptions): ClerkUser {
  const id = options.id ?? `user_${role}`;
  const email = options.email === undefined ? `${id}@example.com` : options.email;
  return {
    id,
    fullName: options.fullName === undefined ? `Name of ${id}` : options.fullName,
    username: options.username ?? null,
    primaryEmailAddress: email ? { emailAddress: email } : null,
    publicMetadata: options.metadata ?? (role === "attendant" ? {} : { role }),
  };
}

// Adds someone to the Team page's list of people, without signing them in.
export function addPerson(role: Role, options: PersonOptions = {}) {
  const user = makeUser(role, options);
  directory.set(user.id, user);
  return user;
}

export function signInAs(role: Role, options: PersonOptions = {}) {
  const user = addPerson(role, options);
  current = { user, roleInToken: options.roleInToken ?? false };
  return user;
}

export function signOut() {
  current = null;
}

export function getPerson(id: string) {
  return directory.get(id);
}

export const clerkUsers = {
  getUserList: vi.fn(async (_params: { limit: number; orderBy: string; query?: string }) => ({
    data: [...directory.values()],
  })),
  getUser: vi.fn(async (id: string) => {
    const user = directory.get(id);
    if (!user) throw new Error("Not found");
    return user;
  }),
  updateUserMetadata: vi.fn(async (id: string, { publicMetadata }: { publicMetadata: Record<string, unknown> }) => {
    const user = directory.get(id);
    if (!user) throw new Error("Not found");
    user.publicMetadata = { ...user.publicMetadata, ...publicMetadata };
    return user;
  }),
};

export const clerkServer = {
  auth: vi.fn(async () =>
    current
      ? {
          userId: current.user.id,
          sessionClaims: current.roleInToken ? { metadata: current.user.publicMetadata } : {},
        }
      : { userId: null, sessionClaims: null },
  ),
  currentUser: vi.fn(async (): Promise<ClerkUser | null> => current?.user ?? null),
  clerkClient: vi.fn(async () => ({ users: clerkUsers })),
};

export function resetPeople() {
  current = null;
  directory.clear();
  for (const mock of [...Object.values(clerkServer), ...Object.values(clerkUsers)]) mock.mockReset();
}
