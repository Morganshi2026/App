import {isScrollIndexReachable, isScrollOffsetReachable} from '@components/ScrollOffsetContextProvider';

describe('isScrollOffsetReachable', () => {
    it('accepts any position when there is no restore target', () => {
        expect(isScrollOffsetReachable(undefined, 0)).toBe(true);
        expect(isScrollOffsetReachable(undefined, 2803)).toBe(true);
    });

    it('rejects a position that is above the target', () => {
        // The list is still on an earlier page and clamped the scroll to its own maximum.
        expect(isScrollOffsetReachable(6049, 2803)).toBe(false);
    });

    it('accepts a position that reaches the target', () => {
        expect(isScrollOffsetReachable(6049, 6049)).toBe(true);
        expect(isScrollOffsetReachable(6049, 7000)).toBe(true);
    });
});

describe('isScrollIndexReachable', () => {
    it('accepts any row when there is no restore target', () => {
        expect(isScrollIndexReachable(undefined, 3)).toBe(true);
    });

    it('rejects a row that is not the target row', () => {
        expect(isScrollIndexReachable(57, 28)).toBe(false);
        expect(isScrollIndexReachable(57, 58)).toBe(false);
    });

    it('accepts the target row', () => {
        expect(isScrollIndexReachable(57, 57)).toBe(true);
    });
});
