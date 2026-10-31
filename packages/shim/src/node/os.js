export function platform() {
  return "linux";
}

export function arch() {
  return "x64";
}

export function homedir() {
  return "/";
}

// Inside the vault, so a temp file a plugin writes here is visible to its commands.
export function tmpdir() {
  const vaultPath = window.__vaultConfig?.path;

  return vaultPath && vaultPath !== "/" ? `${vaultPath}/.ignis-tmp` : "/tmp";
}

export function hostname() {
  return "localhost";
}

export function type() {
  return "Linux";
}

export function release() {
  return "0.0.0";
}

export function cpus() {
  return [{ model: "browser", speed: 0 }];
}

export function totalmem() {
  return 0;
}

export function freemem() {
  return 0;
}

export function networkInterfaces() {
  return {};
}

export function endianness() {
  return "LE";
}

export function version() {
  return "v20.0.0";
}

export const EOL = "\n";

export const constants = {
  errno: { ENOENT: 2, EBADF: 9, EACCES: 13, EEXIST: 17, ENOTDIR: 20, EISDIR: 21 },
  signals: { SIGINT: 2, SIGKILL: 9, SIGTERM: 15 },
};
