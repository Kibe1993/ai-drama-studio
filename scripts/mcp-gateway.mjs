import http from "node:http";

const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = 8787;

const MCP_ORIGIN = "http://127.0.0.1:3000";
const MCP_PATH = "/api/mcp";

const ALLOWED_METHODS = new Set(["POST", "GET", "DELETE"]);

const ALLOWED_ORIGINS = new Set([
  "http://localhost:6274",
  "http://127.0.0.1:6274",
]);

const ALLOWED_HEADERS = new Set([
  "authorization",
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
]);

const FORWARDED_REQUEST_HEADERS = [...ALLOWED_HEADERS];

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

function getCorsHeaders(req) {
  const origin = req.headers.origin;
  const headers = {
    Vary: "Origin",
  };

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, GET, DELETE, OPTIONS";
    headers["Access-Control-Expose-Headers"] =
      "MCP-Session-Id, MCP-Protocol-Version, Last-Event-ID";
  }

  return headers;
}

function sendError(req, res, status, message) {
  const body = JSON.stringify({ error: message });

  res.writeHead(status, {
    ...getCorsHeaders(req),
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });

  res.end(body);
}

function getForwardedHeaders(req) {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers[name];

    if (typeof value === "string") {
      headers.set(name, value);
    }
  }

  return headers;
}

function getResponseHeaders(response) {
  const headers = {};

  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = response.headers.get(name);

    if (value !== null) {
      headers[name] = value;
    }
  }

  return headers;
}

const server = http.createServer(async (req, res) => {
  console.log("[MCP Gateway Request]", {
    method: req.method,
    url: req.url,
    origin: req.headers.origin,
    hasAuthorization: Boolean(req.headers.authorization),
    accept: req.headers.accept,
    contentType: req.headers["content-type"],
    sessionId: req.headers["mcp-session-id"] ?? null,
  });

  if (req.url !== MCP_PATH) {
    sendError(req, res, 404, "Not Found");
    return;
  }

  const origin = req.headers.origin;

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    sendError(req, res, 403, "Origin Not Allowed");
    return;
  }

  // Handle browser CORS preflight.
  if (req.method === "OPTIONS") {
    const requestedMethod = req.headers["access-control-request-method"];

    const requestedHeaders = (
      req.headers["access-control-request-headers"] ?? ""
    )
      .split(",")
      .map((header) => header.trim().toLowerCase())
      .filter(Boolean);

    if (
      !origin ||
      !ALLOWED_ORIGINS.has(origin) ||
      !ALLOWED_METHODS.has(requestedMethod)
    ) {
      sendError(req, res, 403, "Invalid CORS preflight");
      return;
    }

    const invalidHeaders = requestedHeaders.filter(
      (header) => !ALLOWED_HEADERS.has(header),
    );

    if (invalidHeaders.length > 0) {
      sendError(req, res, 403, "Requested headers not allowed");
      return;
    }

    res.writeHead(204, {
      ...getCorsHeaders(req),
      "Access-Control-Allow-Headers": requestedHeaders.join(", "),
      "Access-Control-Max-Age": "600",
    });

    res.end();
    return;
  }

  if (!ALLOWED_METHODS.has(req.method)) {
    res.setHeader("Allow", "POST, GET, DELETE, OPTIONS");
    sendError(req, res, 405, "Method Not Allowed");
    return;
  }

  const accept = req.headers.accept ?? "";

  if (
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  ) {
    sendError(req, res, 406, "MCP clients must accept JSON and event streams");
    return;
  }

  const controller = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  try {
    const headers = getForwardedHeaders(req);

    const response = await fetch(`${MCP_ORIGIN}${MCP_PATH}`, {
      method: req.method,
      headers,
      body: req.method === "POST" ? req : undefined,
      duplex: req.method === "POST" ? "half" : undefined,
      signal: controller.signal,
      redirect: "manual",
    });

    // Diagnostic response log. Do not log authorization values or tokens.
    console.log("[MCP Gateway Response]", {
      status: response.status,
      sessionId: response.headers.get("mcp-session-id"),
      protocolVersion: response.headers.get("mcp-protocol-version"),
      contentType: response.headers.get("content-type"),
    });

    const responseHeaders = {
      ...getCorsHeaders(req),
      ...getResponseHeaders(response),
    };

    res.writeHead(response.status, responseHeaders);

    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;
        if (res.destroyed) break;

        if (!res.write(Buffer.from(value))) {
          await new Promise((resolve) => {
            res.once("drain", resolve);
          });
        }
      }

      if (!res.destroyed) {
        res.end();
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (controller.signal.aborted || res.destroyed) {
      return;
    }

    console.error("[MCP Gateway]", error);

    if (!res.headersSent) {
      sendError(req, res, 502, "MCP upstream unavailable");
    } else {
      res.destroy();
    }
  }
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
});

server.listen(GATEWAY_PORT, GATEWAY_HOST, () => {
  console.log("-------------------------------------");
  console.log("AI Drama Studio MCP Gateway");
  console.log("-------------------------------------");
  console.log(`Listening: http://${GATEWAY_HOST}:${GATEWAY_PORT}`);
  console.log(`Allowed path: ${MCP_PATH}`);
  console.log("Allowed methods: POST, GET, DELETE, OPTIONS");
  console.log(`Upstream: ${MCP_ORIGIN}${MCP_PATH}`);
  console.log("-------------------------------------");
});

server.on("error", (error) => {
  console.error("[MCP Gateway Startup Error]", error);
  process.exitCode = 1;
});
