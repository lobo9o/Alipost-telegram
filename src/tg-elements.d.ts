import 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'tg-emoji': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement> & { 'emoji-id'?: string }, HTMLElement>;
    }
  }
}
