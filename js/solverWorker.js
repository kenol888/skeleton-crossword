import { solveLayout } from './solver.js';

self.onmessage = (e) => {
  self.postMessage(solveLayout(e.data));
};
