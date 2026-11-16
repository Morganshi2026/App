import {ScrollOffsetContext} from '@components/ScrollOffsetContextProvider';

import type {FlashListRef} from '@shopify/flash-list';
import type {RefObject} from 'react';

import {useFocusEffect, useRoute} from '@react-navigation/native';
import {useCallback, useContext, useRef} from 'react';

/** How long we keep waiting for the target row to arrive before we give up on the row index. */
const MAX_RESTORE_WAIT_MS = 2000;

/** How often we retry while the target row is still missing. */
const RESTORE_RETRY_INTERVAL_MS = 50;

type PendingRestore = {
    /** The row we want to land on. */
    index?: number;

    /** The pixel offset saved for the same route, used when the row cannot be restored. */
    offset?: number;

    /** Timestamp after which we stop waiting for the row. */
    deadline: number;
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
    const {getScrollOffset, getScrollIndex, beginScrollRestore, endScrollRestore} = useContext(ScrollOffsetContext);

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

            pendingRestoreRef.current = {index, offset, deadline: Date.now() + MAX_RESTORE_WAIT_MS};

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

                if (pending.index !== undefined) {
                    try {
                        listRef.current.scrollToIndex({index: pending.index, animated: false, viewPosition: 0});
                        finishRestore();
                        return;
                    } catch {
                        // The row is not in the list yet - the list is still on an earlier page. Keep the
                        // restore pending and try again later. Falling back to the pixel offset here would
                        // land on the short list, which is exactly the bug this change fixes.
                    }

                    if (Date.now() < pending.deadline) {
                        retryTimerRef.current = setTimeout(tryRestore, RESTORE_RETRY_INTERVAL_MS);
                        return;
                    }
                }

                // There is no row index to restore, or the row never arrived: fall back to the saved pixel
                // offset so the outcome is no worse than before this change.
                if (pending.offset) {
                    listRef.current.scrollToOffset({offset: pending.offset, animated: false});
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
        }, [getScrollOffset, getScrollIndex, beginScrollRestore, endScrollRestore, route, listRef]),
    );
}

export default useScrollRestoration;
