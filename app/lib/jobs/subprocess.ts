import type { ChildProcess } from "node:child_process";

export function killChildProcessTree(child: ChildProcess, signal: NodeJS.Signals = "SIGKILL"): void {
  const pid = child.pid;
  if (!pid) {
    return;
  }

  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fallback to direct child kill.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Ignore final kill errors.
  }
}

