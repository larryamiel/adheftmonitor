import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Adheft Monitor',
  description: 'Site QA and vitals monitor',
  robots: { index: false, follow: false },
  icons: { icon: '/icon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
