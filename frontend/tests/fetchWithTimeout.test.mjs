import assert from "node:assert/strict";
import test from "node:test";

import { fetchWithTimeout } from "../src/api/fetchWithTimeout.mjs";

test("fetchWithTimeout aborts a request that never settles", async () => {
  const originalFetch = globalThis.fetch;
  let aborted = false;
  globalThis.fetch = (_input, init) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(init.signal.reason);
        },
        { once: true },
      );
    });

  try {
    await assert.rejects(
      fetchWithTimeout("/api/papers/import", {}, 10),
      /timed out/i,
    );
    assert.equal(aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchWithTimeout keeps its deadline active while consuming the body", async () => {
  const originalFetch = globalThis.fetch;
  let bodyAborted = false;
  globalThis.fetch = async (_input, init) => ({
    json: () =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener(
          "abort",
          () => {
            bodyAborted = true;
            reject(init.signal.reason);
          },
          { once: true },
        );
      }),
  });

  try {
    await assert.rejects(
      fetchWithTimeout(
        "/api/papers/import",
        {},
        10,
        (response) => response.json(),
      ),
      /timed out/i,
    );
    assert.equal(bodyAborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
