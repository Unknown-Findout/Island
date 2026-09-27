import type { Metadata } from "next";
import { Inter } from "next/font/google";
import IslandDesk from "@/components/island/IslandDesk";

// Apple's island is set in SF Pro, which cannot be shipped outside Apple's
// platforms. Inter is the closest open face in build and metrics, and it is
// what the Linux host will use too.
const inter = Inter({ subsets: ["latin"], variable: "--font-island", display: "swap" });

export const metadata: Metadata = {
  title: "AI Island",
  description: "The AI island on a desktop: real music, real agent replies, Katie's voice.",
};

export default function Page() {
  return (
    <div className={inter.variable}>
      <IslandDesk />
    </div>
  );
}
