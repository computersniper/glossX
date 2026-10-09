import assert from "node:assert/strict";
import test from "node:test";

import { detectFormulas, preflightPluginRequirements } from "../src/formulaDetection.mjs";

const page = (text) => [{ blocks: [{ text }] }];

test("detectFormulas detects LaTeX and extracted mathematical expressions", () => {
  assert.deepEqual(detectFormulas(page("The loss is $L(θ) = -\\log p(y|x)$.")), {
    detected: true,
    count: 1,
  });
  assert.equal(detectFormulas(page("∑ᵢ xᵢ = 1")).detected, true);
});

test("detectFormulas is conservative for prose without mathematics", () => {
  assert.deepEqual(detectFormulas(page("This paper describes a user study and its results.")), {
    detected: false,
    count: 0,
  });
});

test("manifest requirements create a local unavailable state without running a plugin", () => {
  const preflight = preflightPluginRequirements(["formulas"], page("A qualitative user study."));
  assert.equal(preflight.status, "unavailable");
  assert.deepEqual(preflight.reason, { code: "no_formulas", requirement: "formulas" });
});
