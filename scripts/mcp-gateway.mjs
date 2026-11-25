import http from "node:http";

const GATEWAY_HOST = "127.0.0.1";
const GATEWAY_PORT = 8787;

const MCP_ORIGIN = "http://127.0.0.1:3000";
const MCP_PATH = "/api/mcp";

const ALLOWED_METHODS = new Set(["POST", "GET", "DELETE"]);

const FORWARDED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "accept",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "mcp-session-id",
  "mcp-protocol-version",
  "last-event-id",
];

function sendError(res, status, message) {
  const body = JSON.stringify({ error: message });

  res.writeHead(status, {
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
  // Only accept the exact MCP endpoint.
  if (req.url !== MCP_PATH) {
    sendError(res, 404, "Not Found");
    return;
  }

  // Only allow MCP-supported HTTP methods.
  if (!ALLOWED_METHODS.has(req.method)) {
    res.setHeader("Allow", "POST, GET, DELETE");
    sendError(res, 405, "Method Not Allowed");
    return;
  }

  // Require the MCP protocol's expected Accept header.
  const accept = req.headers.accept ?? "";

  if (
    !accept.includes("application/json") ||
    !accept.includes("text/event-stream")
  ) {
    sendError(res, 406, "MCP clients must accept JSON and event streams");
    return;
  }

  const controller = new AbortController();

  // Cancel upstream work if the client disconnects.
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

    const responseHeaders = getResponseHeaders(response);

    res.writeHead(response.status, responseHeaders);

    if (!response.body) {
      res.end();
      return;
    }

    // Stream the response without buffering it.
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
      sendError(res, 502, "MCP upstream unavailable");
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
  console.log("Allowed methods: POST, GET, DELETE");
  console.log(`Upstream: ${MCP_ORIGIN}${MCP_PATH}`);
  console.log("-------------------------------------");
});

server.on("error", (error) => {
  console.error("[MCP Gateway Startup Error]", error);
  process.exitCode = 1;
});
