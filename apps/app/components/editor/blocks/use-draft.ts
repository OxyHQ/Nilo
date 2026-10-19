import * as React from 'react';

/**
 * A block's text field that is committed when it is left, not on each
 * keystroke (one write and one undo step per edit, not per character). While
 * it is not being edited it shows the stored value, so a collaborator's
 * change or an undo is seen instead of being written back over on blur.
 */
export function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = React.useState(value);
  const editing = React.useRef(false);
  React.useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  return {
    value: draft,
    onChangeText: (next: string) => {
      editing.current = true;
      setDraft(next);
    },
    onFocus: () => {
      editing.current = true;
    },
    onBlur: () => {
      editing.current = false;
      if (draft !== value) commit(draft);
      else setDraft(value);
    },
  };
}
