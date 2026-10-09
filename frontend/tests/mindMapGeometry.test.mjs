import assert from "node:assert/strict";
import test from "node:test";

import {
  MIND_COLUMN_GAP,
  MIND_NODE_WIDTH,
  MIND_X_STEP,
  getMindEdgeGeometry,
} from "../src/mindMapGeometry.mjs";

test("mind-map columns reserve a usable edge-routing channel", () => {
  assert.equal(MIND_X_STEP - MIND_NODE_WIDTH, MIND_COLUMN_GAP);
  assert.ok(MIND_COLUMN_GAP >= 80);
});

test("orthogonal edges keep their vertical lane between adjacent cards", () => {
  const sourceX = MIND_NODE_WIDTH;
  const targetX = MIND_X_STEP;
  const { laneX, path } = getMindEdgeGeometry(sourceX, 40, targetX, 220);

  assert.ok(laneX > sourceX);
  assert.ok(laneX < targetX);
  assert.match(path, /^M 250 40 H /);
  assert.match(path, / V /);
  assert.doesNotMatch(path, /NaN|Infinity/);
});

test("horizontal and upward edges produce stable finite paths", () => {
  const horizontal = getMindEdgeGeometry(250, 80, 350, 80);
  const upward = getMindEdgeGeometry(250, 220, 350, 40);

  assert.equal(horizontal.path, "M 250 80 H 350");
  assert.match(upward.path, / V /);
  assert.doesNotMatch(upward.path, /NaN|Infinity/);
});
