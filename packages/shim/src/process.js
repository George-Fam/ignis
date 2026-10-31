export const processShim = {
  platform: "linux",
  version: "v24.21.0",
  versions: {
    electron: "43.7.5",
    node: "24.21.0",
    chrome: "150.0.7871.250",
  },
  // The runner's PATH, for plugins that look up a command before running it.
  env: { PATH: "/opt/py/bin:/usr/local/bin:/usr/bin:/bin", HOME: "/tmp/home" },
  cwd: () => "/",
  nextTick: (fn, ...args) => setTimeout(() => fn(...args), 0),
  argv: [],
  type: "renderer",
  resourcesPath: "/",
  stdout: { write: (s) => console.log(s) },
  stderr: { write: (s) => console.error(s) },
  on: () => {},
  addListener: () => {},
  emit: () => false,
  emitWarning: () => {},
  once: () => {},
  removeListener: () => {},
};
