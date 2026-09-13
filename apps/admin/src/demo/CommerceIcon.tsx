export type CommerceIconName = 'cat' | 'dog' | 'verified' | 'orders' | 'arrow' | 'search';

export function CommerceIcon({ name }: { name: CommerceIconName }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {name === 'verified' && <><path d="m12 3 7 3v5c0 4.7-2.8 8.1-7 10-4.2-1.9-7-5.3-7-10V6l7-3Z"/><path d="m9 12 2 2 4-5"/></>}
    {name === 'orders' && <><path d="M6 3h12v18H6z"/><path d="M9 8h6M9 12h6M9 16h4"/></>}
    {name === 'arrow' && <><path d="M5 12h14M14 7l5 5-5 5"/></>}
    {name === 'search' && <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>}
    {name === 'cat' && <><path d="m5 10-1-6 5 3a10 10 0 0 1 6 0l5-3-1 6v3a7 7 0 0 1-14 0v-3Z"/><path d="M9 13h.01M15 13h.01M10 16h4"/></>}
    {name === 'dog' && <><path d="M7 8a7 7 0 0 1 10 0v7a5 5 0 0 1-10 0V8Z"/><path d="M7 9 3 6v7l4 2m10-6 4-3v7l-4 2M10 13h.01M14 13h.01M10 17h4"/></>}
  </svg>;
}
