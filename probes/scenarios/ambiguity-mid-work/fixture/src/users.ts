export type User = { id: number; name: string; deletedAt: string | null };

const users: User[] = [
  { id: 1, name: "Ada", deletedAt: null },
  { id: 2, name: "Grace", deletedAt: "2026-02-01T00:00:00Z" },
  { id: 3, name: "Linus", deletedAt: null },
  { id: 4, name: "Barbara", deletedAt: null },
  { id: 5, name: "Edsger", deletedAt: "2026-03-15T00:00:00Z" },
];

/** Every account in id order, soft-deleted ones included. */
export function listUsers(): User[] {
  return [...users];
}
