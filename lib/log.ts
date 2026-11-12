type Fields = Record<string, unknown>;

const SECRET_KEY = /key|secret|token|password|authorization|uri|url/i;

function safeValue(key: string, value: unknown): string {
  if (value == null) return "";
  const text = typeof value === "string" ? value : String(value);
  if (SECRET_KEY.test(key)) return "[redacted]";
  return text
    .replace(/mongodb(\+srv)?:\/\/\S+/gi, "[redacted]")
    .replace(/AIza[0-9A-Za-z_-]+/g, "[redacted]")
    .replace(/redis:\/\/\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function line(scope: string, message: string, fields?: Fields): string {
  const time = new Date().toISOString().slice(11, 19);
  const extra = fields
    ? Object.entries(fields)
        .map(([key, value]) => `${key}=${safeValue(key, value)}`)
        .join(" ")
    : "";
  return `[studio] ${time} ${scope} ${message}${extra ? ` ${extra}` : ""}`;
}

function quiet(): boolean {
  return process.env.NODE_ENV === "test";
}

export const log = {
  info(scope: string, message: string, fields?: Fields) {
    if (quiet()) return;
    console.log(line(scope, message, fields));
  },
  error(scope: string, message: string, fields?: Fields) {
    console.error(line(scope, message, fields));
  },
};
