import localFont from 'next/font/local';

// Google Fonts families, self-hosted from the @fontsource-variable packages through
// next/font/local, so builds never depend on fonts.googleapis.com being reachable.

/** Display face: headings, numbers, the wordmark. Variable weight + optical size. */
export const bricolage = localFont({
  src: '../node_modules/@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-opsz-normal.woff2',
  weight: '200 800',
  style: 'normal',
  display: 'swap',
  variable: '--font-bricolage',
});

/** UI and body face. */
export const figtree = localFont({
  src: [
    {
      path: '../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2',
      weight: '300 900',
      style: 'normal',
    },
    {
      path: '../node_modules/@fontsource-variable/figtree/files/figtree-latin-wght-italic.woff2',
      weight: '300 900',
      style: 'italic',
    },
  ],
  display: 'swap',
  variable: '--font-figtree',
});
