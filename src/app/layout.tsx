/**
 * Root layout — intentionally a passthrough.
 *
 * <html> and <body> belong to `app/[locale]/layout.tsx`, which is the only
 * place that knows the language and the writing direction (§10.1). Next.js
 * still requires this file to exist as the root of the App Router tree, so it
 * renders its children and nothing else.
 *
 * Nothing else may be exported from here — metadata, viewport or fonts declared
 * at this level would apply to every locale at once and silently override the
 * per-locale values.
 */

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
