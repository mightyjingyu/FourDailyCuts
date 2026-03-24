import type { Metadata } from "next";
import { Jua, Noto_Sans_KR } from "next/font/google";
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
      <body className={`${jua.variable} ${brandSans.variable}`}>{children}</body>
    </html>
  );
}
