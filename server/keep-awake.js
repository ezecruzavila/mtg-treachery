import { spawn } from 'node:child_process';

/**
 * Keeps the host awake while the server is running, so a game isn't cut off
 * when the machine would otherwise idle-sleep. Each OS has a native tool for
 * this; we spawn it as a child and kill it when the server exits.
 *
 * IMPORTANT: no process can run *during* system sleep — the whole machine is
 * frozen. So the goal isn't "run in the background while asleep"; it's to
 * PREVENT the machine from sleeping while the server is alive. On exit we let
 * the machine sleep normally again.
 */

let child = null;

function startInhibitor() {
  if (process.platform === 'darwin') {
    // caffeinate: -i prevents idle sleep for the lifetime of this child.
    return spawn('caffeinate', ['-i'], { stdio: 'ignore' });
  }
  if (process.platform === 'linux') {
    // systemd-inhibit blocks idle/sleep while the child runs. `sleep infinity`
    // is the child; killing it releases the inhibitor.
    return spawn(
      'systemd-inhibit',
      ['--what=idle:sleep', '--why=MTG Treachery server running', 'sleep', 'infinity'],
      { stdio: 'ignore' }
    );
  }
  if (process.platform === 'win32') {
    // No caffeinate on Windows. SetThreadExecutionState with ES_CONTINUOUS
    // marks the calling thread (this PowerShell process) as keeping the system
    // awake; the flags are cleared automatically when the process exits.
    const ps = [
      '$sig = \'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint esFlags);\';',
      "$t = Add-Type -MemberDefinition $sig -Name Power -Namespace Win32 -PassThru;",
      // ES_CONTINUOUS (0x80000000) | ES_SYSTEM_REQUIRED (0x00000001)
      '$t::SetThreadExecutionState([uint32]"0x80000001") | Out-Null;',
      // Idle here forever; when this process is killed, Windows clears the flag.
      'while ($true) { Start-Sleep -Seconds 3600 }',
    ].join(' ');
    return spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore' });
  }
  return null;
}

/** Starts the OS sleep inhibitor. Safe to call once; no-op on unsupported OSes. */
export function keepAwake() {
  if (child) return;
  try {
    child = startInhibitor();
    if (child) {
      // If the tool is missing or fails, just carry on without it.
      child.on('error', () => { child = null; });
      child.unref?.();
    }
  } catch {
    child = null; // tool not available — degrade gracefully
  }
}

/** Releases the inhibitor so the machine can sleep normally again. */
export function releaseAwake() {
  if (!child) return;
  try { child.kill(); } catch { /* already gone */ }
  child = null;
}
