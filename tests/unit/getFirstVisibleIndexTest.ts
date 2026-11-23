import getFirstVisibleIndex from '@components/Search/primitives/getFirstVisibleIndex';

describe('getFirstVisibleIndex', () => {
    it('returns undefined when nothing is viewable', () => {
        expect(getFirstVisibleIndex([{index: null}])).toBeUndefined();
    });

    it('returns the index of the first viewable row', () => {
        expect(getFirstVisibleIndex([{index: 12}, {index: 13}])).toBe(12);
    });

    it('skips rows whose index is null', () => {
        expect(getFirstVisibleIndex([{index: null}, {index: 7}])).toBe(7);
    });

    it('returns undefined when every index is null', () => {
        expect(getFirstVisibleIndex([{index: null}, {index: null}])).toBeUndefined();
    });

    it('returns undefined for an empty list', () => {
        expect(getFirstVisibleIndex([])).toBeUndefined();
    });
});
