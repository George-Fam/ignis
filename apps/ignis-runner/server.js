// Runs plugin commands for Ignis. Listens on a Unix socket only: the container has
// no network, and sees the vaults and nothing else.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const SOCKET = process.env.RUNNER_SOCKET || "/run/ignis/runner.sock";
const VAULTS = process.env.RUNNER_VAULTS || "/vaults";
const PATH_DIRS = ["/opt/py/bin", "/usr/local/bin", "/usr/bin", "/bin"];
const BLOCKED_ENV = new Set(["PATH", "HOME", "TMPDIR", "LD_PRELOAD", "LD_LIBRARY_PATH", "NODE_OPTIONS", "PYTHONPATH"]);
const MAX_PROCS = 8;
const RUN_TIMEOUT_MS = 30000;

const procs = new Map();
let nextId = 1;

function findCommand(cmd) {
  if (cmd.includes("/")) {
    return fs.existsSync(cmd);
  }

  return PATH_DIRS.some((dir) => fs.existsSync(path.join(dir, cmd)));
}

function workingDir(cwd) {
  if (typeof cwd !== "string" || !cwd) {
    return VAULTS;
  }

  try {
    const real = fs.realpathSync(cwd);

    if (real === VAULTS || real.startsWith(VAULTS + path.sep) || real.startsWith("/tmp")) {
      return real;
    }
  } catch {
    // fall through to the vault root
  }

  return VAULTS;
}

function childEnv(extra) {
  const env = { PATH: PATH_DIRS.join(":"), HOME: "/tmp/home", TMPDIR: "/tmp", LANG: "C.UTF-8" };

  for (const [key, value] of Object.entries(extra || {})) {
    if (!BLOCKED_ENV.has(key) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      env[key] = String(value);
    }
  }

  return env;
}

function start({ cmd, args, cwd, env }) {
  fs.mkdirSync("/tmp/home", { recursive: true });

  if (!findCommand(cmd)) {
    throw Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: "ENOENT", path: cmd, syscall: `spawn ${cmd}` });
  }

  return spawn(cmd, (args || []).map(String), { cwd: workingDir(cwd), env: childEnv(env) });
}

function errorInfo(e) {
  return { message: e.message, code: e.code, path: e.path, syscall: e.syscall };
}

function handleSpawn(body, res) {
  res.writeHead(200, { "content-type": "application/x-ndjson" });
  const send = (m) => res.write(JSON.stringify(m) + "\n");
  const fail = (e) => {
    send({ err: errorInfo(e) });
    send({ x: -2, s: null });
    res.end();
  };

  if (procs.size >= MAX_PROCS) {
    return fail(Object.assign(new Error("too many processes"), { code: "EAGAIN" }));
  }

  let child;

  try {
    child = start(body);
  } catch (e) {
    return fail(e);
  }

  const id = nextId++;
  procs.set(id, child);
  send({ id });

  // A slow reader pauses the child, the way a full pipe would.
  const pump = (stream, key) =>
    stream.on("data", (d) => {
      if (!send({ [key]: d.toString("base64") })) {
        stream.pause();
        res.once("drain", () => stream.resume());
      }
    });

  pump(child.stdout, "o");
  pump(child.stderr, "e");
  child.stdin.on("error", () => {});
  child.on("error", (e) => send({ err: errorInfo(e) }));
  child.on("close", (code, signal) => {
    procs.delete(id);
    send({ x: code, s: signal });
    res.end();
  });
  res.on("close", () => {
    if (procs.has(id)) {
      child.kill("SIGKILL");
    }
  });
}

function handleRun(body, res) {
  const reply = (m) => res.end(JSON.stringify(m));
  let child;

  try {
    child = start(body);
  } catch (e) {
    return reply({ error: errorInfo(e) });
  }

  const stdout = [];
  const stderr = [];
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, Math.min(body.timeout || RUN_TIMEOUT_MS, RUN_TIMEOUT_MS));

  child.stdout.on("data", (d) => stdout.push(d));
  child.stderr.on("data", (d) => stderr.push(d));
  child.stdin.on("error", () => {});
  child.stdin.end(body.input ? Buffer.from(body.input, "base64") : undefined);
  child.on("error", (e) => reply({ error: errorInfo(e) }));
  child.on("close", (status, signal) => {
    clearTimeout(timer);
    reply({
      status,
      signal,
      stdout: Buffer.concat(stdout).toString("base64"),
      stderr: Buffer.concat(stderr).toString("base64"),
      ...(timedOut ? { error: { message: "ETIMEDOUT", code: "ETIMEDOUT" } } : {}),
    });
  });
}

function handleControl(op, body, res) {
  const child = procs.get(body.id);

  if (child) {
    if (op === "/kill") {
      child.kill(body.signal || "SIGTERM");
    } else if (body.end) {
      child.stdin.end();
    } else {
      child.stdin.write(Buffer.from(body.data, "base64"));
    }
  }

  res.end("{}");
}

const server = http.createServer((req, res) => {
  const chunks = [];

  req.on("data", (d) => chunks.push(d));
  req.on("end", () => {
    let body;

    try {
      body = JSON.parse(Buffer.concat(chunks));
    } catch {
      res.statusCode = 400;
      return res.end();
    }

    if (req.url === "/spawn") return handleSpawn(body, res);
    if (req.url === "/run") return handleRun(body, res);
    if (req.url === "/stdin" || req.url === "/kill") return handleControl(req.url, body, res);
    res.statusCode = 404;
    res.end();
  });
});

fs.rmSync(SOCKET, { force: true });
server.listen(SOCKET, () => {
  fs.chmodSync(SOCKET, 0o660);
  console.log(`[runner] listening on ${SOCKET}`);
});
