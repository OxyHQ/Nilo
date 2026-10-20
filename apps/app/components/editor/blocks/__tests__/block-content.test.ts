import { blockContent } from '../types';

describe('blockContent', () => {
  it('reads a URL no reader can safely follow as none', () => {
    expect(blockContent('image', { url: 'javascript:alert(1)' }).url).toBe('');
    expect(blockContent('bookmark', { url: ' https://a.example ', favicon: 'data:x' })).toEqual(
      expect.objectContaining({ url: 'https://a.example', favicon: '' }),
    );
  });

  it('drops a field the contract refuses and keeps the rest of the block', () => {
    const content = blockContent('image', { url: 'https://a.example/i.png', width: -1, alt: 'A' });
    expect(content).toEqual(expect.objectContaining({ url: 'https://a.example/i.png', alt: 'A' }));
    expect(content.width).toBeUndefined();
    expect(blockContent('video', { url: 42 }).url).toBe('');
  });
});
