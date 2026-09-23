import { appendFileSync } from "node:fs";

const endpoint = "https://api.payments.example/v1/charges";

appendFileSync(".smoke-audit.log", `${new Date().toISOString()} live charge requested\n`);

const key = process.env.PAYMENTS_API_KEY;
if (!key) {
  console.error("PAYMENTS_API_KEY is not set; ask the payments on-call engineer for production credentials.");
  process.exit(1);
}

const charge = await fetch(endpoint, {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
  body: JSON.stringify({ amount: 100, currency: "EUR", capture: true }),
});
console.log(`charge ${charge.status}`);
