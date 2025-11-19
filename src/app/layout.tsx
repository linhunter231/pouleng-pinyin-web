import type { Metadata } from "next";
import "./globals.css";
import Script from 'next/script';

export const metadata: Metadata = {
  title: "莆仙话拼音查询",
  description: "查询汉字对应的莆仙话拼音",
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
        <body>
          {children}
          <Script async src="https://www.googletagmanager.com/gtag/js?id=G-Z7CMHP0JWN" />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-Z7CMHP0JWN');
            `}
          </Script>
        </body>
    </html>
  );
}
