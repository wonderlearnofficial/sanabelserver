import { Worker } from "worker_threads";
import bcrypt from "bcryptjs";
import logger from "../config/logger";

/**
 * bcrypt hashing for bulk imports, off the main thread.
 *
 * bcryptjs is pure JavaScript: one cost-10 hash is ~55 ms of CPU that blocks
 * the event loop. During a bulk import that stalls every other request and
 * prevents a row's hashing from overlapping the previous row's database work.
 * A small worker pool runs the same bcryptjs code (same cost, same output
 * format, so login is unaffected) in parallel with the import loop.
 *
 * Falls back to in-process bcrypt.hash if a worker cannot be started.
 */

const POOL_SIZE = 2;

const WORKER_SOURCE = `
const { parentPort } = require("worker_threads");
const bcrypt = require(${JSON.stringify(require.resolve("bcryptjs"))});
parentPort.on("message", ({ id, password, rounds }) => {
  try {
    parentPort.postMessage({ id, hash: bcrypt.hashSync(password, rounds) });
  } catch (error) {
    parentPort.postMessage({ id, error: String((error && error.message) || error) });
  }
});
`;

type Pending = { resolve: (hash: string) => void; reject: (error: Error) => void };

interface PoolWorker {
  worker: Worker;
  ids: Set<number>;
}

const workers: PoolWorker[] = [];
const pending = new Map<number, Pending>();
let nextId = 1;
let disabled = false;

const startWorker = (): PoolWorker | null => {
  try {
    const worker = new Worker(WORKER_SOURCE, { eval: true });
    const entry: PoolWorker = { worker, ids: new Set() };
    worker.on("message", ({ id, hash, error }) => {
      entry.ids.delete(id);
      // An idle worker never keeps the process alive.
      if (entry.ids.size === 0) worker.unref();
      const job = pending.get(id);
      if (!job) return;
      pending.delete(id);
      if (error) job.reject(new Error(error));
      else job.resolve(hash);
    });
    // A dead worker fails its in-flight jobs (each falls back to in-process
    // hashing) and is never used again.
    const retire = (error: unknown) => {
      disabled = true;
      const index = workers.indexOf(entry);
      if (index >= 0) workers.splice(index, 1);
      for (const id of entry.ids) {
        pending.get(id)?.reject(new Error("hash worker stopped"));
        pending.delete(id);
      }
      entry.ids.clear();
      if (error) logger.warn("Password hash worker failed; using in-process hashing", { error });
    };
    worker.on("error", retire);
    worker.on("exit", (code) => retire(code === 0 ? null : new Error(`exit ${code}`)));
    worker.unref();
    return entry;
  } catch (error) {
    logger.warn("Password hash worker unavailable; using in-process hashing", { error });
    disabled = true;
    return null;
  }
};

const pickWorker = (): PoolWorker | null => {
  if (disabled) return null;
  if (workers.length < POOL_SIZE) {
    const started = startWorker();
    if (started) workers.push(started);
  }
  if (!workers.length) return null;
  return workers.reduce((a, b) => (b.ids.size < a.ids.size ? b : a));
};

export const hashPasswordOffThread = (password: string, rounds = 10): Promise<string> => {
  const entry = pickWorker();
  if (!entry) return bcrypt.hash(password, rounds);
  const id = nextId++;
  entry.ids.add(id);
  entry.worker.ref();
  return new Promise<string>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    entry.worker.postMessage({ id, password, rounds });
  }).catch(() => bcrypt.hash(password, rounds));
};
