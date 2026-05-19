"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

let singleton: Socket | null = null;

export function getSocket(): Socket {
  if (typeof window === "undefined") {
    throw new Error("getSocket called on server");
  }
  if (!singleton) {
    singleton = io({
      transports: ["websocket", "polling"],
      reconnection: true,
    });
  }
  return singleton;
}

export function useSocket(): Socket | null {
  const [s, setS] = useState<Socket | null>(null);
  useEffect(() => {
    setS(getSocket());
  }, []);
  return s;
}
