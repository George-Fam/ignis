const http = require("http");
const express = require("express");
const config = require("../config");

const router = express.Router();
const OPERATIONS = new Set(["spawn", "run", "stdin", "kill"]);

// Basic auth is sent on cross-site requests too, so this route trusts neither it
// nor the CORS preflight alone: commands need a same-origin Origin and our header.
function isSameOrigin(req) {
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

router.post("/:op", (req, res) => {
  if (!config.execSocket) {
    return res.status(404).json({ error: "Plugin commands are not enabled" });
  }

  if (req.headers["x-ignis-exec"] !== "1" || !isSameOrigin(req)) {
    return res.status(403).json({ error: "Cross-origin request rejected" });
  }

  if (!OPERATIONS.has(req.params.op)) {
    return res.status(404).json({ error: "Unknown operation" });
  }

  const upstream = http.request(
    { socketPath: config.execSocket, path: `/${req.params.op}`, method: "POST" },
    (reply) => {
      // no-transform keeps compression from holding back streamed output.
      res.writeHead(reply.statusCode, {
        "content-type": reply.headers["content-type"] || "application/json",
        "cache-control": "no-store, no-transform",
      });
      reply.pipe(res);
    },
  );

  upstream.on("error", () => {
    if (!res.headersSent) {
      res.status(503).json({ error: "Plugin command runner is unavailable" });
    } else {
      res.destroy();
    }
  });
  res.on("close", () => upstream.destroy());
  upstream.end(JSON.stringify(req.body || {}));
});

module.exports = router;
