
const http = require("http");

const token = process.env.MCP_AUTH_TOKEN;

if (!token) {
  throw new Error("MCP_AUTH_TOKEN is missing");
}

const server = http.createServer((req, res) => {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: 3000,
    path: "/api/mcp",
    method: req.method,
    headers: {
      ...req.headers,
      host: "127.0.0.1:3000",
      authorization: `Bearer ${token}`
    }
  }, (response) => {
    res.writeHead(response.statusCode, response.headers);
    response.pipe(res);
  });

  upstream.on("error", (error) => {
    console.error("Upstream error:", error.message);
    if (!res.headersSent) res.writeHead(502);
    res.end("MCP upstream unavailable");
  });

  req.pipe(upstream);
});

server.listen(3007, "127.0.0.1", () => {
  console.log("MCP authentication bridge running on port 3007");
});
