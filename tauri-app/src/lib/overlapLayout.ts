/**
 * Port of calendar_view.py's _layout_day_entries: overlapping blocks are
 * never rejected -- they're grouped into transitively-overlapping
 * clusters (sorted by start then end minute), then greedily packed into
 * the fewest side-by-side columns needed (an entry reuses the first
 * column whose prior occupant has already ended). Every entry in a
 * cluster shares that cluster's column count, so they render as
 * equal-width side-by-side slots.
 */

export interface LayoutInput {
  id: number;
  startMin: number;
  endMin: number;
}

export interface LayoutSlot {
  colIndex: number;
  colCount: number;
}

export function layoutDayEntries(entries: LayoutInput[]): Map<number, LayoutSlot> {
  const sorted = [...entries].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const result = new Map<number, LayoutSlot>();

  let i = 0;
  while (i < sorted.length) {
    let clusterEnd = sorted[i].endMin;
    let j = i + 1;
    while (j < sorted.length && sorted[j].startMin < clusterEnd) {
      clusterEnd = Math.max(clusterEnd, sorted[j].endMin);
      j++;
    }
    const cluster = sorted.slice(i, j);

    const columnEnds: number[] = [];
    const colIndexById = new Map<number, number>();
    for (const entry of cluster) {
      let placedCol = -1;
      for (let c = 0; c < columnEnds.length; c++) {
        if (columnEnds[c] <= entry.startMin) {
          columnEnds[c] = entry.endMin;
          placedCol = c;
          break;
        }
      }
      if (placedCol === -1) {
        columnEnds.push(entry.endMin);
        placedCol = columnEnds.length - 1;
      }
      colIndexById.set(entry.id, placedCol);
    }

    const colCount = columnEnds.length;
    for (const entry of cluster) {
      result.set(entry.id, { colIndex: colIndexById.get(entry.id)!, colCount });
    }

    i = j;
  }

  return result;
}
