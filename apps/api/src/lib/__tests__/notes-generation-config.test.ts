import { describe, expect, it } from 'vitest';
import { notesGenerationConfig, parseNotesGenerationConfig } from '../notes-generation.js';

describe('notes generation configuration', () => {
  it('defaults off and is frozen for the process', () => {
    const saved = process.env.NILO_NOTES_GENERATION_ENABLED;
    process.env.NILO_NOTES_GENERATION_ENABLED = '1';
    try {
      expect(notesGenerationConfig).toEqual({ enabled: false });
      expect(Object.isFrozen(notesGenerationConfig)).toBe(true);
    } finally {
      if (saved === undefined) delete process.env.NILO_NOTES_GENERATION_ENABLED;
      else process.env.NILO_NOTES_GENERATION_ENABLED = saved;
    }
  });
  it('requires a well-formed explicit deployment epoch when enabled', () => {
    expect(parseNotesGenerationConfig({})).toEqual({ enabled: false });
    expect(() => parseNotesGenerationConfig({ NILO_NOTES_GENERATION_ENABLED: '1' })).toThrow(
      'EPOCH',
    );
    expect(() =>
      parseNotesGenerationConfig({
        NILO_NOTES_GENERATION_ENABLED: '1',
        NILO_NOTES_GENERATION_EPOCH: 'short',
      }),
    ).toThrow('EPOCH');
    expect(
      parseNotesGenerationConfig({
        NILO_NOTES_GENERATION_ENABLED: '1',
        NILO_NOTES_GENERATION_EPOCH: 'deployment_epoch_20261101',
      }),
    ).toEqual({ enabled: true, epoch: 'deployment_epoch_20261101' });
  });
});
