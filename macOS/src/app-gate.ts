/**
 * Who owns the main window right now: the PIN gate, or one `openAppWindow` run.
 *
 * Both halves of this exist because opening the window suspends. Booting the
 * backend takes seconds (uvicorn spawn plus health polling, and a pre-upgrade
 * snapshot when the version moved), and the user can close the window during
 * it. Closing nulls `mainWindow`; a Dock click then starts a SECOND
 * `openAppWindow`, which puts a fresh PIN gate in the new window. When the
 * first run finally resumed it loaded the SPA into that window, straight over
 * the gate, and the whole library was readable without the PIN. The backend
 * binds 127.0.0.1 and has no auth of its own, so the gate is the only thing
 * standing there.
 *
 * Two rules come out of that, and they are what this class is:
 *  1. While the gate is up, nothing navigates the window to app content —
 *     whoever is asking. That also covers the `openmemo://` deep-link handler,
 *     which reached the loader with a warm backend and no idea a gate was
 *     showing.
 *  2. A run that has been superseded does not touch the window at all, even
 *     with the gate down. The newer run owns it.
 *
 * Deliberately free of Electron: the race needs a window closed at exactly the
 * wrong second to reproduce by hand, so the rule lives somewhere it can be
 * tested. See app-gate.test.ts.
 */
export class AppGate {
  private latestRun = 0;
  private resolveGate: ((unlocked: boolean) => void) | null = null;

  /** Claim the window for a new `openAppWindow` run. Every older run goes stale. */
  beginRun(): number {
    return ++this.latestRun;
  }

  /** True while the PIN gate is up and waiting. The shell bridge is dead until it clears. */
  get locked(): boolean {
    return this.resolveGate !== null;
  }

  /**
   * Put the gate up.
   *
   * Resolves true once the PIN is accepted, or false when a later gate replaces
   * this one. That second case is a window closed with the gate still showing:
   * without the hand-off its opener would await a promise nobody can ever
   * resolve, and sit there for the life of the app.
   */
  showGate(): Promise<boolean> {
    this.resolveGate?.(false);
    return new Promise<boolean>((resolve) => {
      this.resolveGate = resolve;
    });
  }

  /** Correct PIN entered. False if no gate was up, i.e. nothing was waiting. */
  unlock(): boolean {
    const resolve = this.resolveGate;
    if (!resolve) return false;
    this.resolveGate = null;
    resolve(true);
    return true;
  }

  /**
   * May the caller load app content into the main window?
   *
   * Pass the token from `beginRun()` when there is one. Callers with no run of
   * their own (a deep link, a backend restart from Settings) omit it and are
   * still refused while the gate is up.
   */
  mayNavigate(run?: number): boolean {
    if (this.locked) return false;
    return run === undefined || run === this.latestRun;
  }
}
