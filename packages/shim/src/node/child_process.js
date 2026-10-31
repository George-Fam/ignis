import { EventEmitter } from "./events.js";
import { promisify } from "./util.js";

// Runs commands through the server's runner. Async calls stream over fetch; the sync
// calls block the tab on a synchronous XHR, as they would block a desktop plugin.
const HEADERS = { "Content-Type": "application/json", "X-Ignis-Exec": "1" };
const HIGH_WATER_MARK = 1024 * 1024;

function toBase64(chunk) {
  const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : new Uint8Array(chunk.buffer ?? chunk, chunk.byteOffset ?? 0, chunk.byteLength);
  let binary = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }

  return btoa(binary);
}

function fromBase64(text) {
  return window.Buffer.from(text, "base64");
}

function commandError(info) {
  return Object.assign(new Error(info.message), info);
}

function post(op, body) {
  return fetch(`/api/exec/${op}`, { method: "POST", headers: HEADERS, body: JSON.stringify(body) });
}

function runSync(cmd, args, options) {
  const xhr = new XMLHttpRequest();

  xhr.open("POST", "/api/exec/run", false);

  for (const [key, value] of Object.entries(HEADERS)) {
    xhr.setRequestHeader(key, value);
  }

  xhr.send(
    JSON.stringify({
      cmd,
      args,
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout,
      input: options.input === undefined ? undefined : toBase64(options.input),
    }),
  );

  if (xhr.status >= 400) {
    throw new Error(`child_process is not available: ${xhr.status}`);
  }

  const result = JSON.parse(xhr.responseText);

  if (result.error && result.status === undefined) {
    throw commandError(result.error);
  }

  return result;
}

function decode(buffer, encoding) {
  return encoding && encoding !== "buffer" ? buffer.toString(encoding) : buffer;
}

class Output extends EventEmitter {
  constructor() {
    super();
    this.queue = [];
    this.queued = 0;
    this.encoding = null;
    this.ended = false;
    this.flowing = false;
    this.waiters = [];
  }

  on(event, listener) {
    super.on(event, listener);

    if (event === "data") {
      this.flowing = true;
      queueMicrotask(() => this.flush());
    } else if (event === "end" && this.ended && !this.queue.length) {
      queueMicrotask(() => this.flush());
    }

    return this;
  }

  addListener(event, listener) {
    return this.on(event, listener);
  }

  setEncoding(encoding) {
    this.encoding = encoding;
    return this;
  }

  pipe(destination) {
    this.on("data", (chunk) => destination.write(chunk));
    this.on("end", () => destination.end?.());
    return destination;
  }

  push(chunk) {
    this.queue.push(chunk);
    this.queued += chunk.length;
    this.flush();
    return this.queued < HIGH_WATER_MARK;
  }

  flush() {
    while (this.flowing && this.queue.length) {
      const chunk = this.queue.shift();

      this.queued -= chunk.length;
      this.emit("data", this.encoding ? chunk.toString(this.encoding) : chunk);
    }

    if (this.queued < HIGH_WATER_MARK) {
      this.release();
    }

    if (this.ended && !this.queue.length && !this.finished) {
      this.finished = true;
      this.emit("end");
      this.emit("close");
    }
  }

  room() {
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    this.waiters.splice(0).forEach((resolve) => resolve());
  }

  finish() {
    this.ended = true;
    this.flush();
  }
}

class Input extends EventEmitter {
  constructor(send) {
    super();
    this.send = send;
    this.writable = true;
    this.pending = Promise.resolve();
  }

  write(chunk, encoding, callback) {
    const done = typeof encoding === "function" ? encoding : callback;

    this.pending = this.pending.then(() => this.send({ data: toBase64(chunk) })).then(done);
    return true;
  }

  end(chunk, encoding, callback) {
    if (chunk !== undefined && typeof chunk !== "function") {
      this.write(chunk, encoding);
    }

    this.writable = false;
    this.pending = this.pending.then(() => this.send({ end: true }));
    return this;
  }
}

class ChildProcess extends EventEmitter {
  constructor(cmd, args, options) {
    super();
    const stdio = options.stdio;
    const ignored = (fd) => stdio === "ignore" || (Array.isArray(stdio) && stdio[fd] === "ignore");

    this.killed = false;
    this.exitCode = null;
    this.signalCode = null;
    this.stdout = new Output();
    this.stderr = new Output();

    let setId;
    const id = new Promise((resolve) => (setId = resolve));
    const control = (op, body) => id.then((pid) => pid && post(op, { id: pid, ...body }));

    this.stdin = new Input((body) => control("stdin", body));
    this.kill = (signal) => {
      this.killed = true;
      this.stdout.release();
      this.stderr.release();
      control("kill", { signal: signal || "SIGTERM" });
      return true;
    };

    const deliver = async (stream, chunk) => {
      if (!stream.push(fromBase64(chunk)) && !this.killed) {
        await stream.room();
      }
    };

    const handle = async (message) => {
      if (message.id) {
        this.pid = message.id;
        setId(message.id);
        this.emit("spawn");
      }

      if (message.o && !ignored(1)) await deliver(this.stdout, message.o);
      if (message.e && !ignored(2)) await deliver(this.stderr, message.e);

      if (message.err) {
        setId(0);
        this.emit("error", commandError(message.err));
      }

      if ("x" in message) {
        this.exitCode = message.x;
        this.signalCode = message.s;
        this.stdout.finish();
        this.stderr.finish();
        this.emit("exit", message.x, message.s);
        this.emit("close", message.x, message.s);
      }
    };

    this.ready = (async () => {
      const response = await post("spawn", { cmd, args, cwd: options.cwd, env: options.env });

      if (!response.ok) {
        throw new Error(`child_process is not available: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = "";

      for (;;) {
        const { done, value } = await reader.read();

        if (done) break;
        buffered += decoder.decode(value, { stream: true });

        let newline;

        while ((newline = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, newline);

          buffered = buffered.slice(newline + 1);
          await handle(JSON.parse(line));
        }
      }
    })().catch((e) => {
      setId(0);
      this.emit("error", e);
    });
  }
}

function normalize(args, options) {
  return Array.isArray(args) ? [args, options || {}] : [[], args || {}];
}

function shellCommand(cmd, args) {
  return ["/bin/sh", ["-c", [cmd, ...args].join(" ")]];
}

export function spawn(cmd, args, options) {
  const [list, opts] = normalize(args, options);
  const [file, argv] = opts.shell ? shellCommand(cmd, list) : [cmd, list];

  return new ChildProcess(file, argv, opts);
}

function collect(child, options, callback) {
  const stdout = [];
  const stderr = [];
  const result = (chunks) => decode(window.Buffer.concat(chunks), options.encoding === undefined ? "utf8" : options.encoding);
  let done = false;
  const finish = (error) => {
    if (!done) {
      done = true;
      callback?.(error, result(stdout), result(stderr));
    }
  };

  child.stdout.on("data", (d) => stdout.push(d));
  child.stderr.on("data", (d) => stderr.push(d));
  child.on("error", finish);
  child.on("close", (code, signal) => {
    if (code === 0) {
      return finish(null);
    }

    finish(Object.assign(new Error(`Command failed with exit code ${code}`), { code, signal, killed: child.killed }));
  });

  return child;
}

function optionsAndCallback(options, callback) {
  return typeof options === "function" ? [{}, options] : [options || {}, callback];
}

export function exec(command, options, callback) {
  const [opts, cb] = optionsAndCallback(options, callback);

  return collect(new ChildProcess("/bin/sh", ["-c", command], opts), opts, cb);
}

export function execFile(file, args, options, callback) {
  const [list, rest] = Array.isArray(args) ? [args, options] : [[], args];
  const [opts, cb] = optionsAndCallback(rest, Array.isArray(args) ? callback : options);

  return collect(new ChildProcess(file, list, opts), opts, cb);
}

function promisified(fn) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn(...args, (error, stdout, stderr) => {
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
      });
    });
}

exec[promisify.custom] = promisified(exec);
execFile[promisify.custom] = promisified(execFile);

export function spawnSync(cmd, args, options) {
  const [list, opts] = normalize(args, options);
  const [file, argv] = opts.shell ? shellCommand(cmd, list) : [cmd, list];
  const result = runSync(file, argv, opts);
  const stdout = decode(fromBase64(result.stdout), opts.encoding);
  const stderr = decode(fromBase64(result.stderr), opts.encoding);

  return {
    pid: 0,
    status: result.status,
    signal: result.signal,
    stdout,
    stderr,
    output: [null, stdout, stderr],
    error: result.error ? commandError(result.error) : undefined,
  };
}

function checked(result) {
  if (result.error) {
    throw result.error;
  }

  if (result.status) {
    throw Object.assign(new Error(`Command failed with exit code ${result.status}`), result);
  }

  return result.stdout;
}

export function execSync(command, options = {}) {
  return checked(spawnSync("/bin/sh", ["-c", command], options));
}

export function execFileSync(file, args, options) {
  const [list, opts] = normalize(args, options);

  return checked(spawnSync(file, list, opts));
}

export function fork() {
  throw new Error("child_process.fork() is not available in the web version.");
}
