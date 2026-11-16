import useOnyx from '@hooks/useOnyx';
import usePrevious from '@hooks/usePrevious';

import {isSidebarScreenName} from '@libs/Navigation/helpers/isNavigatorName';
import type {PlatformStackRouteProp} from '@libs/Navigation/PlatformStackNavigation/types';
import type {NavigationPartialRoute, State} from '@libs/Navigation/types';

import ONYXKEYS from '@src/ONYXKEYS';
import SCREENS from '@src/SCREENS';

import type {ParamListBase} from '@react-navigation/native';

import {findFocusedRoute} from '@react-navigation/native';
import React, {createContext, useEffect, useRef} from 'react';

type ScrollOffsetContextValue = {
    /** Save scroll offset of FlashList on given screen */
    saveScrollOffset: (route: PlatformStackRouteProp<ParamListBase>, scrollOffset: number) => void;

    getScrollOffset: (route: PlatformStackRouteProp<ParamListBase>) => number | undefined;

    /** Save scroll index of FlashList on given screen */
    saveScrollIndex: (route: PlatformStackRouteProp<ParamListBase>, scrollIndex: number) => void;

    getScrollIndex: (route: PlatformStackRouteProp<ParamListBase>) => number | undefined;

    /**
     * Marks a scroll restore as in flight for the given route.
     *
     * While a restore is pending, a position that does not reach the restore target is not stored. The Search
     * list is server-paginated, so on the frame the restore runs it usually holds only the first page and clamps
     * the scroll to its own maximum. Storing that clamped position would replace the position the user left the
     * screen on, and every later return would restore the clamped value instead of the real one.
     */
    beginScrollRestore: (route: PlatformStackRouteProp<ParamListBase>, targetIndex?: number, targetOffset?: number) => void;

    /** Ends the pending scroll restore for the given route. */
    endScrollRestore: (route: PlatformStackRouteProp<ParamListBase>) => void;

    /** Clean scroll offsets of screen that aren't anymore in the state */
    cleanStaleScrollOffsets: (state: State) => void;
};

type ScrollOffsetContextProviderProps = {
    children: React.ReactNode;
};

const defaultValue: ScrollOffsetContextValue = {
    saveScrollOffset: () => {},
    getScrollOffset: () => undefined,
    saveScrollIndex: () => {},
    getScrollIndex: () => undefined,
    beginScrollRestore: () => {},
    endScrollRestore: () => {},
    cleanStaleScrollOffsets: () => {},
};

const ScrollOffsetContext = createContext<ScrollOffsetContextValue>(defaultValue);

/** This function is prepared to work with HOME and SEARCH screens. */
function getKey(route: PlatformStackRouteProp<ParamListBase> | NavigationPartialRoute): string {
    // Handle routes with direct policyID parameter (HOME screens)
    if (route.params && 'policyID' in route.params && typeof route.params.policyID === 'string') {
        return `${route.name}-${route.params.policyID}`;
    }

    // Handle SEARCH screens with query parameters
    if (route.name === SCREENS.SEARCH.ROOT && route.params && 'q' in route.params && typeof route.params.q === 'string') {
        // Encode the query to handle spaces and special characters
        const encodedQuery = encodeURIComponent(route.params.q);
        return `${route.name}-${encodedQuery}`;
    }

    // For other routes, just use route name
    return `${route.name}-global`;
}

/**
 * Returns whether a scroll position reported by the list can be stored while a restore is pending.
 *
 * The Search list is server-paginated, so on the frame the restore runs it usually holds only the first page
 * and clamps the scroll to its own maximum. That clamped position must not replace the position the user left
 * the screen on, so it is dropped while the restore is still in flight.
 */
export function isScrollOffsetReachable(target: number | undefined, offset: number): boolean {
    return target === undefined || offset >= target;
}

/**
 * Returns whether a row reported by the list can be stored while a restore is pending.
 *
 * Only the target row confirms that the list reached the row the restore is waiting for, so any other row is
 * dropped while the restore is still in flight.
 */
export function isScrollIndexReachable(target: number | undefined, index: number): boolean {
    return target === undefined || index === target;
}

function ScrollOffsetContextProvider({children}: ScrollOffsetContextProviderProps) {
    const [priorityMode] = useOnyx(ONYXKEYS.NVP_PRIORITY_MODE);
    const [inboxTab] = useOnyx(ONYXKEYS.NVP_INBOX_TAB);
    const scrollOffsetsRef = useRef<Record<string, number>>({});

    // A row index and a pixel offset are two different positions, so they are kept in two maps. Sharing one map
    // let a scroll position overwrite the saved row index of the same route (and the other way round), so a screen
    // could never keep both - saving an index destroyed the offset and saving an offset destroyed the index.
    const scrollIndexesRef = useRef<Record<string, number>>({});

    // The restore that is currently in flight, per route key.
    const pendingRestoresRef = useRef<Record<string, {targetIndex?: number; targetOffset?: number}>>({});

    const previousPriorityMode = usePrevious(priorityMode);
    const previousInboxTab = usePrevious(inboxTab);

    useEffect(() => {
        const priorityModeChanged = previousPriorityMode !== null && previousPriorityMode !== priorityMode;
        const inboxTabChanged = previousInboxTab !== null && previousInboxTab !== inboxTab;
        if (!priorityModeChanged && !inboxTabChanged) {
            return;
        }

        // If the priority mode or inbox tab changes, we need to clear the scroll offsets for the home and search screens because it affects the size of the elements and scroll positions wouldn't be correct.
        for (const key of Object.keys(scrollOffsetsRef.current)) {
            if (key.includes(SCREENS.INBOX) || key.includes(SCREENS.SEARCH.ROOT)) {
                delete scrollOffsetsRef.current[key];
            }
        }

        for (const key of Object.keys(scrollIndexesRef.current)) {
            if (key.includes(SCREENS.INBOX) || key.includes(SCREENS.SEARCH.ROOT)) {
                delete scrollIndexesRef.current[key];
            }
        }
    }, [priorityMode, previousPriorityMode, inboxTab, previousInboxTab]);

    const saveScrollOffset: ScrollOffsetContextValue['saveScrollOffset'] = (route, scrollOffset) => {
        const key = getKey(route);
        const pendingRestore = pendingRestoresRef.current[key];

        if (!isScrollOffsetReachable(pendingRestore?.targetOffset, scrollOffset)) {
            // The list could not reach the position that is being restored: it is still on an earlier page and
            // clamps the scroll to its own maximum. Keep the position the user left the screen on.
            return;
        }

        scrollOffsetsRef.current[key] = scrollOffset;
    };

    const getScrollOffset: ScrollOffsetContextValue['getScrollOffset'] = (route) => {
        if (!scrollOffsetsRef.current) {
            return;
        }
        return scrollOffsetsRef.current[getKey(route)];
    };

    const saveScrollIndex: ScrollOffsetContextValue['saveScrollIndex'] = (route, scrollIndex) => {
        const key = getKey(route);
        const pendingRestore = pendingRestoresRef.current[key];

        if (!isScrollIndexReachable(pendingRestore?.targetIndex, scrollIndex)) {
            // The list reported a different row than the row that is being restored, so it has not reached the
            // target row yet. Keep the target so the restore can still land on it.
            return;
        }

        scrollIndexesRef.current[key] = scrollIndex;
    };

    const getScrollIndex: ScrollOffsetContextValue['getScrollIndex'] = (route) => {
        if (!scrollIndexesRef.current) {
            return;
        }
        return scrollIndexesRef.current[getKey(route)];
    };

    const beginScrollRestore: ScrollOffsetContextValue['beginScrollRestore'] = (route, targetIndex, targetOffset) => {
        pendingRestoresRef.current[getKey(route)] = {targetIndex, targetOffset};
    };

    const endScrollRestore: ScrollOffsetContextValue['endScrollRestore'] = (route) => {
        delete pendingRestoresRef.current[getKey(route)];
    };

    const cleanScrollPositions = (keys: string[], shouldDelete: (key: string) => boolean) => {
        for (const key of keys) {
            if (!shouldDelete(key)) {
                continue;
            }

            delete scrollOffsetsRef.current[key];
            delete scrollIndexesRef.current[key];
        }
    };

    const cleanStaleScrollOffsets: ScrollOffsetContextValue['cleanStaleScrollOffsets'] = (state) => {
        const sidebarRoutes = state.routes.filter((route) => isSidebarScreenName(route.name));
        const existingScreenKeys = new Set(sidebarRoutes.map(getKey));

        const focusedRoute = findFocusedRoute(state);
        const routeName = focusedRoute?.name;

        const isSearchScreen = routeName === SCREENS.SEARCH.ROOT;
        const isSearchMoneyRequestReport =
            routeName === SCREENS.RIGHT_MODAL.EXPENSE_REPORT || routeName === SCREENS.RIGHT_MODAL.SEARCH_MONEY_REQUEST_REPORT || routeName === SCREENS.RIGHT_MODAL.SEARCH_REPORT;

        // A row index can be stored without a pixel offset and the other way round, so both maps are cleaned.
        const scrollPositionKeys = new Set([...Object.keys(scrollOffsetsRef.current), ...Object.keys(scrollIndexesRef.current)]);

        if (isSearchScreen || isSearchMoneyRequestReport) {
            const currentKey = focusedRoute ? getKey(focusedRoute) : null;
            cleanScrollPositions([...scrollPositionKeys], (key) => key.startsWith(SCREENS.SEARCH.ROOT) && key !== currentKey && !isSearchMoneyRequestReport);
            return;
        }
        cleanScrollPositions([...scrollPositionKeys], (key) => !existingScreenKeys.has(key));
    };

    const contextValue: ScrollOffsetContextValue = {
        saveScrollOffset,
        getScrollOffset,
        cleanStaleScrollOffsets,
        saveScrollIndex,
        getScrollIndex,
        beginScrollRestore,
        endScrollRestore,
    };

    return <ScrollOffsetContext.Provider value={contextValue}>{children}</ScrollOffsetContext.Provider>;
}

export default ScrollOffsetContextProvider;

export {ScrollOffsetContext};
