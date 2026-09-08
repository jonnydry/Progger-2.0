'use client';

/** Move past navigation without changing the hash-based workspace route. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="skip-link"
      onClick={(event) => {
        event.preventDefault();
        const main = document.getElementById('main-content');
        main?.focus({ preventScroll: true });
        main?.scrollIntoView({ block: 'start', behavior: 'instant' });
      }}
    >
      Skip to main content
    </a>
  );
}
