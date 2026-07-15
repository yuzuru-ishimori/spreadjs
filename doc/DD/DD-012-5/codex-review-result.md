The main behavior is implemented, but the patch contains a potentially severe wrapped-text redraw regression and several correctness issues around resize cancellation, structural cleanup, the 20-column boundary, and the mandated LRU policy.

Full review comments:

- [P1] Cull wrapped lines outside the pane clip — C:\repo\spreadjs\packages\render\src\base-layer.ts:161-164
  When a wrapped value makes its row taller than the viewport, this loop calls `fillText` for every line even though the pane clip discards nearly all of them. Because cell values have no length limit and remote SetCells can supply them, one very large pasted value can make every redraw or scroll O(total wrapped lines) and freeze collaborating clients; iterate only over lines intersecting the pane clip.

- [P2] Preserve auto-height status when cancelling row resize — C:\repo\spreadjs\packages\grid\src\document-view.ts:196-198
  When `pointercancel` or `lostpointercapture` cancels resizing a row whose current size comes only from `rowAutoHeights`, `finishResize(..., false)` restores that effective size through `setRowHeight`. Since the automatic size differs from the default, these lines record it as a manual override, so later shortening or deleting the wrapped value no longer auto-shrinks the row; cancellation must restore the previous override presence/value, not only its effective pixel size.

- [P2] Prune auto heights for removed rows — C:\repo\spreadjs\packages\grid\src\document-view.ts:354-359
  After DeleteRows or a bootstrap snapshot removes rows, this full pass visits only IDs still in the current axis, so old entries are never deleted from `rowAutoHeights`. Repeated insert-long-text-delete cycles or snapshot replacements therefore retain stale derived state indefinitely; prune keys absent from the rebuilt axis during structural/full recomputation.

- [P2] Anchor the inflow limit to the visible start — C:\repo\spreadjs\packages\render\src\base-layer.ts:240-242
  `pane.cols.start` includes horizontal overscan, so scanning another 20 columns left from it permits sources more than 20 columns outside the actual visible edge. With the mount controller's three-column overscan the effective limit is 23 columns, and render callers with larger overscan exceed it further, violating D3's explicit boundary; calculate the limit from the non-overscanned visible start.

- [P2] Refresh recency on wrap-cache hits — C:\repo\spreadjs\packages\render\src\text-cache.ts:100-103
  A wrap-cache hit returns without moving the key to the newest position, while `cappedSet` evicts the oldest insertion, making this FIFO rather than the required LRU. Frequently redrawn values can consequently be evicted by later unique cells and require repeated line measurement; refresh the Map insertion order on each hit.