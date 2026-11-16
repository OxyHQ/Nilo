import type { ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';

/** Read rendered text without serializing opaque component props or React contexts. */
export function renderedText(renderer: Pick<ReactTestRenderer, 'toJSON'>): string {
  const visit = (node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node)) return node.map(visit).join(' ');
    return node?.children?.map(visit).join(' ') ?? '';
  };
  return visit(renderer.toJSON());
}
