/** Fetch with a wall-clock deadline so a dead proxy cannot leave the UI pending forever. */
export async function fetchWithTimeout(
  input,
  init = {},
  timeoutMs = 300_000,
  consume = (response) => response,
) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (timedOut) {
      throw new Error(`Request timed out after ${Math.ceil(timeoutMs / 1000)}s`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
