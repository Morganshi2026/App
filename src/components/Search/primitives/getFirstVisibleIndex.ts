/**
 * Returns the index of the first row that is currently viewable in the list.
 *
 * The Search list is server-paginated, so a pixel offset taken on page 3 does not identify the row the
 * user was on once the list is re-rendered from page 1 after a back-navigation. The row index does.
 * `ScrollOffsetContextProvider` already exposes saveScrollIndex/getScrollIndex for this purpose; the
 * Search list only used the pixel offset until now.
 */
function getFirstVisibleIndex(viewableItems: Array<{index: number | null}>): number | undefined {
    const firstVisible = viewableItems.find((item) => item.index !== null);

    return firstVisible?.index ?? undefined;
}

export default getFirstVisibleIndex;
