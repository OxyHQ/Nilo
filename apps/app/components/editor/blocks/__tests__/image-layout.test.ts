import {
  displayWidth,
  draggedWidth,
  imageAlignment,
  imageWidth,
  MIN_IMAGE_WIDTH,
  storedWidth,
} from '../image-layout';

describe('image layout', () => {
  it('reads what the contract stores, and defaults to centred at full width', () => {
    expect(imageAlignment('right')).toBe('right');
    expect(imageAlignment('middle')).toBe('center');
    expect(imageAlignment(undefined)).toBe('center');
    expect(imageWidth(320)).toBe(320);
    expect(imageWidth(0)).toBeUndefined();
    expect(imageWidth('320')).toBeUndefined();
  });

  it('draws an image at its width, never wider than the page, full when full or unsized', () => {
    expect(displayWidth(320, 'center', 700)).toBe(320);
    expect(displayWidth(900, 'left', 700)).toBe(700);
    expect(displayWidth(undefined, 'center', 700)).toBe(700);
    expect(displayWidth(320, 'full', 700)).toBe(700);
    expect(displayWidth(10, 'right', 700)).toBe(MIN_IMAGE_WIDTH);
    expect(displayWidth(320, 'center', 0)).toBe(0);
  });

  it('widens with an edge dragged outward, a centred image at twice the pace', () => {
    expect(draggedWidth(300, 50, 'right', 'left', 700)).toBe(350);
    expect(draggedWidth(300, -50, 'left', 'right', 700)).toBe(350);
    expect(draggedWidth(300, 50, 'right', 'center', 700)).toBe(400);
    expect(draggedWidth(300, 50, 'left', 'center', 700)).toBe(200);
    expect(draggedWidth(300, 900, 'right', 'left', 700)).toBe(700);
    expect(draggedWidth(300, -900, 'right', 'left', 700)).toBe(MIN_IMAGE_WIDTH);
  });

  it('stores no width for an image that fills the page, so it keeps filling a wider one', () => {
    expect(storedWidth(700, 700)).toBeUndefined();
    expect(storedWidth(699.6, 700)).toBeUndefined();
    expect(storedWidth(350.4, 700)).toBe(350);
  });
});
