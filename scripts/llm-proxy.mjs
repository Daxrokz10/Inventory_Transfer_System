/* Auth gate in front of LM Studio.
 *
 * Runs on the PC hosting the model, NOT on Vercel. LM Studio has no
 * authentication of its own, so exposing port 1234 through a tunnel would let
 * anyone who learns the hostname use the GPU and send it whatever they like.
 * This sits in between: requests must carry the same X-Llm-Secret header the
 * app already sends (see src/lib/llm/client.ts), or they get a 401 and never
 * reach the model.
 *
 * The tunnel should point HERE (port 1235), not at LM Studio directly.
 *
 *   set LLM_TUNNEL_SECRET=<the same value as in Vercel>
 *   node scripts/llm-proxy.mjs
 *
 * Plain Node, no dependencies, so it can run from a bare checkout or a
 * Windows service wrapper.
 */

import http from "node:http";
import { timingSafeEqual } from "node:crypto";

const SECRET = process.env.LLM_TUNNEL_SECRET;
const LISTEN_PORT = Number(process.env.LLM_PROXY_PORT || 1235);
/* Loopback by default: the tunnel client runs on this same machine, so
   nothing else needs to reach this port. Set LLM_PROXY_HOST=0.0.0.0 only to
   expose it on the local network (e.g. another machine on a LAN or VPN) —
   the secret check applies either way, but a smaller listening surface is
   the better default. */
const LISTEN_HOST = process.env.LLM_PROXY_HOST || "127.0.0.1";
const UPSTREAM_HOST = process.env.LLM_UPSTREAM_HOST || "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.LLM_UPSTREAM_PORT || 1234);

if (!SECRET) {
  console.error(
    "LLM_TUNNEL_SECRET is not set. Refusing to start — without it this would " +
      "forward every request straight to the model unchecked.",
  );
  process.exit(1);
}
if (SECRET.length < 16) {
  console.error(
    "LLM_TUNNEL_SECRET is too short. Use at least 16 characters — this is the " +
      "only thing standing between the public internet and your GPU.",
  );
  process.exit(1);
}

const secretBuf = Buffer.from(SECRET);

/** Constant-time comparison, so the secret can't be recovered by timing how
    long a wrong guess takes to be rejected. */
function secretMatches(given) {
  if (typeof given !== "string") return false;
  const givenBuf = Buffer.from(given);
  if (givenBuf.length !== secretBuf.length) return false;
  return timingSafeEqual(givenBuf, secretBuf);
}

const stamp = () => new Date().toISOString().slice(11, 19);

const server = http.createServer((req, res) => {
  if (!secretMatches(req.headers["x-llm-secret"])) {
    console.warn(`${stamp()} 401 ${req.method} ${req.url} — bad or missing secret`);
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unauthorized" }));
    // Drain the body so the socket closes cleanly rather than hanging.
    req.resume();
    return;
  }

  const started = Date.now();

  const forwarded = { ...req.headers };
  // LM Studio should see a plain local request. The secret stops here — it has
  // done its job, and there's no reason to hand it on. Note the header must be
  // DELETED, not set to undefined: http.request throws on an undefined value
  // rather than omitting the header.
  forwarded.host = `${UPSTREAM_HOST}:${UPSTREAM_PORT}`;
  delete forwarded["x-llm-secret"];

  const upstream = http.request(
    {
      host: UPSTREAM_HOST,
      port: UPSTREAM_PORT,
      path: req.url,
      method: req.method,
      headers: forwarded,
    },
    (up) => {
      console.log(
        `${stamp()} ${up.statusCode} ${req.method} ${req.url} (${Date.now() - started}ms)`,
      );
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );

  // LM Studio not running, or still loading a model.
  upstream.on("error", (err) => {
    console.error(`${stamp()} 502 ${req.method} ${req.url} — ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "Model not reachable on this machine" }));
  });

  // A client that hangs up mid-request shouldn't leave the upstream socket open.
  req.on("aborted", () => upstream.destroy());

  req.pipe(upstream);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(
    `LLM auth proxy listening on ${LISTEN_HOST}:${LISTEN_PORT} → ${UPSTREAM_HOST}:${UPSTREAM_PORT}\n` +
      `Point the tunnel at port ${LISTEN_PORT}. Requests without the correct ` +
      `X-Llm-Secret header are rejected here.`,
  );
});
