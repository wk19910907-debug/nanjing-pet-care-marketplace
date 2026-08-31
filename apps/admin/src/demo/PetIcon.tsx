import type { ServiceType } from '../pilot/models.js';

/** Small, editable original line drawings; decorative wherever used. */
export function PetIcon({ type }: { type: ServiceType }) {
  return <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {type === 'CAT_FEEDING'
      ? <path d="M16 40 14 15 30 25Q40 21 50 25L66 15 64 40Q70 64 40 66 10 64 16 40Z" fill="#fff6eb"/>
      : <><path d="M23 26Q40 15 57 26L62 49Q62 67 40 67 18 67 18 49Z" fill="#fff6eb"/><path d="M24 25Q9 17 9 43 12 56 22 43M56 25Q71 17 71 43 68 56 58 43" fill="#e3b58e"/></>}
    <path d="M28 39v3m24-3v3M36 49h8l-4 4Zm4 4v4m0 0q-6 5-10 0m10 0q6 5 10 0"/>
    {type === 'CAT_FEEDING' && <path d="m9 47 14 2M9 57l14-3m34-5 14-2m-14 7 14 3"/>}
  </svg>;
}
