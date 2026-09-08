import Image from 'next/image';

/** Shared decorative pond depth for the reference and chord-entry sections. */
export function UnderwaterScene() {
  return (
    <picture>
      <source
        media="(max-width: 600px)"
        srcSet="/progger-underwater-mobile.webp"
      />
      <Image
        className="underwater-scene"
        unoptimized
        src="/progger-underwater.webp"
        width={1870}
        height={841}
        alt=""
        aria-hidden="true"
      />
    </picture>
  );
}
