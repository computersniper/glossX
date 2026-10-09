export const MIND_NODE_WIDTH = 250;
export const MIND_COLUMN_GAP = 100;
export const MIND_X_STEP = MIND_NODE_WIDTH + MIND_COLUMN_GAP;

const EDGE_RADIUS = 10;

/**
 * Route a left-to-right tree edge through the reserved channel between columns.
 * Keeping the vertical segment in that channel prevents edges from crossing cards.
 */
export function getMindEdgeGeometry(sourceX, sourceY, targetX, targetY) {
  const laneX = sourceX + (targetX - sourceX) / 2;
  const deltaY = targetY - sourceY;

  if (Math.abs(deltaY) < 0.5) {
    return {
      laneX,
      path: `M ${sourceX} ${sourceY} H ${targetX}`,
    };
  }

  const directionX = targetX >= sourceX ? 1 : -1;
  const directionY = deltaY > 0 ? 1 : -1;
  const radius = Math.min(
    EDGE_RADIUS,
    Math.abs(targetX - sourceX) / 4,
    Math.abs(deltaY) / 2,
  );
  const beforeLane = laneX - directionX * radius;
  const afterLane = laneX + directionX * radius;

  return {
    laneX,
    path: [
      `M ${sourceX} ${sourceY}`,
      `H ${beforeLane}`,
      `Q ${laneX} ${sourceY} ${laneX} ${sourceY + directionY * radius}`,
      `V ${targetY - directionY * radius}`,
      `Q ${laneX} ${targetY} ${afterLane} ${targetY}`,
      `H ${targetX}`,
    ].join(" "),
  };
}
