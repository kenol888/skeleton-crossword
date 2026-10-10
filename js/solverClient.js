// Runs the layout solver in a Web Worker so the UI never freezes. Falls back to the main thread.
import { solveLayout } from './solver.js';

export function runSolver(opts) {
  return new Promise((resolve) => {
    let worker;
    try {
      worker = new Worker(new URL('./solverWorker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      resolve(solveLayout(opts));
      return;
    }
    const fallback = () => {
      try { worker.terminate(); } catch (e) { /* ignore */ }
      resolve(solveLayout(opts));
    };
    worker.onmessage = (e) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = fallback;
    worker.onmessageerror = fallback;
    worker.postMessage(opts);
  });
}
