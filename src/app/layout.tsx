import type { Metadata } from "next";
import { Gaegu, Jua, Noto_Sans_KR } from "next/font/google";
import "./globals.css";

const jua = Jua({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-jua",
});

const brandSans = Noto_Sans_KR({
  weight: ["600", "700"],
  subsets: ["latin"],
  variable: "--font-brand-sans",
  display: "swap",
});

const speechCute = Gaegu({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-speech-cute",
  display: "swap",
});

export const metadata: Metadata = {
  title: "싶개 SIPGAE",
  description: "당신의 일상을 담고 싶개",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        {/* Google tag (gtag.js) */}
        <script async src="https://www.googletagmanager.com/gtag/js?id=G-5PXRMQ9LMS"></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', 'G-5PXRMQ9LMS');
            `,
          }}
        />
      </head>
      <body className={`${jua.variable} ${brandSans.variable} ${speechCute.variable}`}>{children}</body>
    </html>
  );
}
