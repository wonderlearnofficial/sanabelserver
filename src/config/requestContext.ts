import { AsyncLocalStorage } from "async_hooks";

interface RequestContext {
  requestId: string;
}

const requestContext = new AsyncLocalStorage<RequestContext>();

export const runWithRequestContext = <T>(
  requestId: string,
  callback: () => T,
): T => requestContext.run({ requestId }, callback);

export const getRequestId = (): string | undefined =>
  requestContext.getStore()?.requestId;
