import {ScrollOffsetContext} from '@components/ScrollOffsetContextProvider';

import type {FlashListRef} from '@shopify/flash-list';
import type {RefObject} from 'react';

import {useFocusEffect, useRoute} from '@react-navigation/native';
import {useCallback, useContext, useRef} from 'react';

/** How long we keep waiting for the target row before we apply the saved pixel offset. */
const MAX_RESTORE_WAIT_MS = 2000;

/** How long we keep trying the row index after the pixel offset was applied, while the next page loads. */
const MAX_FALLBACK_WAIT_MS = 5000;

/** How often we retry while the target row is still missing. */
const RESTORE_RETRY_INTERVAL_MS = 50;

/** How often we retry once the saved pixel offset was applied. */
const FALLBACK_RETRY_INTERVAL_MS = 250;

type PendingRestore = {
    /** The row we want to land on. */
    index?: number;

    /** The pixel offset saved for the same route, used when the row cannot be restored. */
    offset?: number;

    /** Timestamp after which the saved pixel offset is applied. */
    fallbackAt: number;

    /** Timestamp after which we stop trying. */
    deadline: number;

    /** Whether the saved pixel offset has been applied already. */
    usedFallback: boolean;
};

/**
 * Restores the Search list's vertical scroll position when the screen regains focus.
 *
 * The offset is saved per route in ScrollOffsetContext by the page wrappers; on focus we read it back
 * and apply it to the FlashList on the next frame, so a back-navigation lands at the prior position
 * instead of the top. Extracted from SearchList so ExpenseFlatSearchView can reuse it.
 *
 * A pixel offset alone is not enough on a server-paginated list. When the screen regains focus the search
 * is re-issued from offset 0, so on the frame the restore runs the list usually holds only the first page.
 * Applying the saved pixel offset to that shorter list lands on the wrong row - the reported symptom was
 * "scrolls back to the first 50th reports". We therefore restore by the index of the row that was
 * visible, wait for that row to be part of the list, and keep the pixel offset as a fallback.
 */
function useScrollRestoration<TItem>(listRef: RefObject<FlashListRef<TItem> | null>) {
    const route = useRoute();
    const {getScrollOffset, getScrollIndex, beginScrollRestore, endScrollRestore, isScrollRestoreReached} = useContext(ScrollOffsetContext);

    const pendingRestoreRef = useRef<PendingRestore | undefined>(undefined);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    useFocusEffect(
        useCallback(() => {
            const index = getScrollIndex(route);
            const offset = getScrollOffset(route);

            // Nothing was saved for this route yet.
            if (index === undefined && !offset) {
                return;
            }

            const now = Date.now();
            pendingRestoreRef.current = {index, offset, fallbackAt: now + MAX_RESTORE_WAIT_MS, deadline: now + MAX_RESTORE_WAIT_MS + MAX_FALLBACK_WAIT_MS, usedFallback: false};

            // While the restore runs, the list must not be allowed to replace the saved position with the position
            // it was clamped to while it was still on an earlier page.
            beginScrollRestore(route, index, offset);

            const finishRestore = () => {
                pendingRestoreRef.current = undefined;
                endScrollRestore(route);
            };

            const tryRestore = () => {
                const pending = pendingRestoreRef.current;

                if (!pending || !listRef.current) {
                    return;
                }

                if (pending.index === undefined) {
                    // There is no row index to restore: apply the saved pixel offset.
                    if (pending.offset) {
                        listRef.current.scrollToOffset({offset: pending.offset, animated: false});
                    }

                    finishRestore();
                    return;
                }

                try {
                    listRef.current.scrollToIndex({index: pending.index, animated: false, viewPosition: 0});
                } catch {
                    // The row is not in the list yet - the list is still on an earlier page. The restore stays
                    // pending and is tried again.
                }

                // The list reports the row it ended up on, so the restore is done once it reports the target row.
                if (isScrollRestoreReached(route)) {
                    finishRestore();
                    return;
                }

                const currentTime = Date.now();

                if (currentTime < pending.fallbackAt) {
                    retryTimerRef.current = setTimeout(tryRestore, RESTORE_RETRY_INTERVAL_MS);
                    return;
                }

                if (!pending.usedFallback) {
                    // The row still is not in the list, so the saved pixel offset is applied. The list clamps it to
                    // the end of the page it holds, which is what makes the next page load, and the row the user
                    // left the screen on arrives with it. The restore stays pending so it can still land on that
                    // row instead of leaving the user at the end of the first page.
                    pending.usedFallback = true;

                    if (pending.offset) {
                        listRef.current.scrollToOffset({offset: pending.offset, animated: false});
                    }
                }

                if (currentTime < pending.deadline) {
                    retryTimerRef.current = setTimeout(tryRestore, FALLBACK_RETRY_INTERVAL_MS);
                    return;
                }

                finishRestore();
            };

            tryRestore();

            return () => {
                if (retryTimerRef.current) {
                    clearTimeout(retryTimerRef.current);
                    retryTimerRef.current = undefined;
                }

                finishRestore();
            };
        }, [getScrollOffset, getScrollIndex, beginScrollRestore, endScrollRestore, isScrollRestoreReached, route, listRef]),
    );
}

export default useScrollRestoration;
