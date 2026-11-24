export const randomToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
    (n) => n.toString(16).padStart(2, "0"),
  ).join("");
}
export async function passwordHash(password: string, salt = randomToken()) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: new TextEncoder().encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  return (
    salt +
    ":" +
    Array.from(new Uint8Array(bits), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join("")
  );
}
export async function verifyPassword(password: string, stored: string) {
  const candidate = await passwordHash(password, stored.split(":")[0]);
  let difference = candidate.length ^ stored.length;
  for (let i = 0; i < candidate.length; i++)
    difference |= candidate.charCodeAt(i) ^ (stored.charCodeAt(i) || 0);
  return difference === 0;
}
export function ownsTicket(
  ticket: { installation_id: string },
  identity: { kind: string; id: string },
) {
  return identity.kind === "staff" || ticket.installation_id === identity.id;
}
