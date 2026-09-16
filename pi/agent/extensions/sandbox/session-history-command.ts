const SESSION_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const RECORD_ID = /^[a-f0-9]{8}$/;
const FIELD = /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/;
const MAX_PAGE_CHARACTERS = 2_000;

export function parseSessionHistoryExtraction(args: string[]) {
  if (args.length !== 10 || args.some((arg) => /\s/.test(arg))) return;
  const [sessionFlag, session = "", recordFlag, record = "", fieldFlag, field = "", offsetFlag, rawOffset, limitFlag, rawLimit] = args;
  if (sessionFlag !== "--session" || !SESSION_ID.test(session)
    || recordFlag !== "--record" || !RECORD_ID.test(record)
    || fieldFlag !== "--field" || field.length > 256 || !FIELD.test(field)
    || offsetFlag !== "--offset" || limitFlag !== "--limit") return;
  const offset = Number(rawOffset);
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(offset) || offset < 0 || String(offset) !== rawOffset
    || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_CHARACTERS || String(limit) !== rawLimit) return;
  return { session, record, field, offset, limit };
}
