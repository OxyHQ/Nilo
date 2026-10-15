import * as React from 'react';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { cn } from '@/lib/utils';

const TextClassContext = React.createContext<string | undefined>(undefined);

export type TextProps = RNTextProps & {
  className?: string;
  /** Inline runs inherit typography and color from their surrounding Text. */
  inherit?: boolean;
};

const Text = React.forwardRef<RNText, TextProps>(
  ({ className, inherit = false, ...props }, ref) => {
    const textClass = React.useContext(TextClassContext);
    return (
      <RNText
        className={cn(
          !inherit && 'text-base leading-7 text-foreground web:select-text font-sans',
          !inherit && textClass,
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Text.displayName = 'Text';

export { Text, TextClassContext };
