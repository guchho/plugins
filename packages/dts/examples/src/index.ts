import { add } from "./math";
import type { Vector } from "./math";

export { add };
export type { Vector };

export interface Point {
  x: number;
  y: number;
}

export type Direction = "up" | "down" | "left" | "right";

export class Shape {
  constructor(readonly name: string) {}

  area(): number {
    return 0;
  }
}

export function translate(point: Point, offset: Vector): Point {
  return add(point, offset);
}

export function step(point: Point, direction: Direction): Point {
  switch (direction) {
    case "up":
      return { x: point.x, y: point.y + 1 };
    case "down":
      return { x: point.x, y: point.y - 1 };
    case "left":
      return { x: point.x - 1, y: point.y };
    case "right":
      return { x: point.x + 1, y: point.y };
  }
}
