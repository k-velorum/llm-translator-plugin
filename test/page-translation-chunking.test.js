import { describe, expect, it } from 'vitest';

import {
  chunkByEstimatedOutputAndItems,
  splitTextByNaturalBoundaries
} from '../src/background/page-translation/chunking.js';

describe('splitTextByNaturalBoundaries', () => {
  it('splits long text at natural sentence boundaries when possible', () => {
    expect(splitTextByNaturalBoundaries('first sentence. second sentence. third', 24)).toEqual([
      'first sentence. ',
      'second sentence. third'
    ]);
  });

  it('falls back to hard slicing when no boundary is available', () => {
    expect(splitTextByNaturalBoundaries('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij']);
  });
});

describe('chunkByEstimatedOutputAndItems', () => {
  it('limits chunks by item count', () => {
    expect(chunkByEstimatedOutputAndItems(['a', 'b', 'c'], 1000, 2, '|||')).toEqual([
      ['a', 'b'],
      ['c']
    ]);
  });

  it('keeps a single oversized item intact for later per-text splitting', () => {
    expect(chunkByEstimatedOutputAndItems(['abcdefghij'], 4, 10, '|||')).toEqual([
      ['abcdefghij']
    ]);
  });

  it('allows more items when structured output is enabled', () => {
    expect(chunkByEstimatedOutputAndItems(['a', 'b', 'c'], 1000, 1, '|||', true)).toEqual([
      ['a', 'b', 'c']
    ]);
  });
});
