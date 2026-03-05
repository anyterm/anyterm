"use client";

import { useEffect, useState } from "react";

const words = [
  "An AI agent",
  "A dev server",
  "A long build",
  "A test suite",
  "A migration",
];

export function RotatingWords() {
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"in" | "out">("in");

  useEffect(() => {
    const interval = setInterval(() => {
      setPhase("out");
      setTimeout(() => {
        setIndex((i) => (i + 1) % words.length);
        setPhase("in");
      }, 280);
    }, 2600);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="relative inline-grid overflow-hidden">
      {/* invisible longest word to reserve width */}
      <span className="invisible col-start-1 row-start-1">
        A dev server
      </span>
      <span
        className={`col-start-1 row-start-1 bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent transition-all duration-280 ease-out ${
          phase === "in"
            ? "translate-y-0 opacity-100"
            : "-translate-y-3 opacity-0"
        }`}
      >
        {words[index]}
      </span>
    </span>
  );
}
