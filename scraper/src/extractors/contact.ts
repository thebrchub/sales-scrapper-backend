/** Extract emails and phones from raw HTML/text. */

const EMAIL_RE =
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

const PHONE_RE =
  /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}/g;

const JUNK_EMAILS = new Set([
  "test@test.com",
  "admin@example.com",
  "noreply@example.com",
  "info@example.com",
  "email@example.com",
  "your@email.com",
  "name@domain.com",
  "user@example.com",
]);

/** Extract unique emails from text, filtering junk. */
export function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  const unique = new Set(
    matches
      .map((e) => e.toLowerCase().trim())
      .filter((e) => !JUNK_EMAILS.has(e))
      .filter((e) => !e.endsWith(".png") && !e.endsWith(".jpg") && !e.endsWith(".gif"))
  );
  return [...unique];
}

/** Extract unique phone numbers from text. */
export function extractPhones(text: string): string[] {
  const matches = text.match(PHONE_RE) ?? [];
  const unique = new Set(
    matches
      .map((p) => p.replace(/[\s\-().]/g, ""))
      .filter((p) => p.length >= 7 && p.length <= 15)
  );
  return [...unique];
}
