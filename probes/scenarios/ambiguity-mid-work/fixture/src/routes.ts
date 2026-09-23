import { listUsers } from "./users.ts";

/** GET /admin/users — support staff restore soft-deleted accounts from this list. */
export function adminUsers() {
  return listUsers().map((user) => ({ id: user.id, name: user.name, deleted: user.deletedAt !== null }));
}

/** GET /directory — the public member directory never shows deleted accounts. */
export function directory() {
  return listUsers()
    .filter((user) => user.deletedAt === null)
    .map((user) => ({ id: user.id, name: user.name }));
}
