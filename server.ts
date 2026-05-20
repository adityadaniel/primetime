import { createServer } from "node:http";
import next from "next";
import { Server, Socket } from "socket.io";
import {
  advance,
  attachDisplay,
  attachHost,
  createGame,
  detachSocket,
  endByHostLeft,
  exportResultsCsv,
  getGame,
  joinPlayer,
  kickPlayer,
  pauseForHostDisconnect,
  personalState,
  publicState,
  resumeFromPause,
  startGame,
  submitAnswer,
} from "./lib/game";
import type { Quiz, AnswerIndex } from "./lib/types";
import type { Tier } from "./lib/game";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 4321);
const hostname = "localhost";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const csv = matchResultsCsv(req.url);
    if (csv) {
      handleResultsCsv(csv, res);
      return;
    }
    handle(req, res).catch((err) => {
      console.error("[next handler]", err);
      res.statusCode = 500;
      res.end("internal error");
    });
  });

  const io = new Server(httpServer, {
    cors: { origin: "*" },
    transports: ["websocket", "polling"],
  });

  const lockTimers = new Map<string, NodeJS.Timeout>();
  const hostGraceTimers = new Map<string, NodeJS.Timeout>();
  const HOST_GRACE_MS = 60_000;

  function broadcast(pin: string) {
    const game = getGame(pin);
    if (!game) return;
    const state = publicState(game);
    io.to(`pin:${pin}`).emit("state", state);
    for (const [socketId, playerId] of game.socketToPlayer.entries()) {
      io.to(socketId).emit("personal", personalState(game, playerId));
    }
  }

  io.on("connection", (socket: Socket) => {
    socket.on(
      "host:create",
      (
        quiz: Quiz,
        tierOrAck: Tier | ((res: { pin: string }) => void),
        maybeAck?: (res: { pin: string }) => void,
      ) => {
        const tier: Tier = typeof tierOrAck === "string" ? tierOrAck : "free";
        const ack = typeof tierOrAck === "function" ? tierOrAck : maybeAck;
        const game = createGame(quiz, tier);
        attachHost(game.pin, socket.id);
        socket.join(`pin:${game.pin}`);
        ack?.({ pin: game.pin });
        broadcast(game.pin);
      },
    );

    socket.on("host:attach", (pin: string) => {
      const game = attachHost(pin, socket.id);
      if (!game) return;
      socket.join(`pin:${pin}`);
      const wasPaused = !!game.pausedAt && game.pauseReason === "host-disconnected";
      const pendingExit = hostGraceTimers.get(pin);
      if (pendingExit) {
        clearTimeout(pendingExit);
        hostGraceTimers.delete(pin);
      }
      if (wasPaused) {
        const wasInQuestion = game.phase === "question";
        resumeFromPause(game);
        if (wasInQuestion) scheduleAutoLock(pin);
      }
      broadcast(pin);
    });

    socket.on("host:start", (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      startGame(game);
      broadcast(pin);
      if (game.phase === "question") {
        scheduleAutoLock(pin);
      }
    });

    socket.on("host:advance", (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      const phase = advance(game);
      broadcast(pin);
      if (phase === "question") {
        scheduleAutoLock(pin);
      }
    });

    socket.on("host:kick", (pin: string, playerId: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      kickPlayer(pin, playerId);
      broadcast(pin);
    });

    socket.on("display:attach", (pin: string) => {
      const game = attachDisplay(pin, socket.id);
      if (!game) return;
      socket.join(`pin:${pin}`);
      broadcast(pin);
    });

    socket.on(
      "player:join",
      (
        pin: string,
        nickname: string,
        ack: (res: {
          ok: boolean;
          error?: string;
          code?: string;
          playerId?: string;
          reconnected?: boolean;
        }) => void,
      ) => {
        const result = joinPlayer(pin, socket.id, nickname);
        if (!result.ok) {
          ack({ ok: false, error: result.error, code: result.code });
          return;
        }
        socket.join(`pin:${pin}`);
        ack({ ok: true, playerId: result.player.id, reconnected: result.reconnected });
        if (result.reconnected) {
          io.to(`pin:${pin}`).emit("event:reconnected", {
            playerId: result.player.id,
            nickname: result.player.nickname,
          });
        }
        broadcast(pin);
      },
    );

    socket.on(
      "player:answer",
      (
        pin: string,
        optionIndex: AnswerIndex,
        ack: (res: {
          ok: boolean;
          error?: string;
          reason?: "paused" | "expired";
        }) => void,
      ) => {
        const game = getGame(pin);
        if (!game) {
          ack({ ok: false, error: "Game not found" });
          return;
        }
        const playerId = game.socketToPlayer.get(socket.id);
        if (!playerId) {
          ack({ ok: false, error: "Not in game" });
          return;
        }
        const r = submitAnswer(game, playerId, optionIndex);
        if (!r.ok) {
          ack({ ok: false, error: r.error, reason: r.reason });
          if (r.reason === "expired") broadcast(pin);
          return;
        }
        ack({ ok: true });
        broadcast(pin);
      },
    );

    socket.on("disconnect", () => {
      const events = detachSocket(socket.id);
      const pins = new Set(events.map((e) => e.pin));
      for (const event of events) {
        if (event.type === "host") {
          const game = getGame(event.pin);
          if (!game) continue;
          if (game.phase === "final") continue;
          const ok = pauseForHostDisconnect(game);
          if (!ok) continue;
          if (lockTimers.has(event.pin)) {
            clearTimeout(lockTimers.get(event.pin)!);
            lockTimers.delete(event.pin);
          }
          const t = setTimeout(() => {
            const g = getGame(event.pin);
            hostGraceTimers.delete(event.pin);
            if (!g) return;
            if (g.hostSocketId) return;
            endByHostLeft(g);
            broadcast(event.pin);
          }, HOST_GRACE_MS + 50);
          hostGraceTimers.set(event.pin, t);
        }
      }
      for (const pin of pins) broadcast(pin);
    });
  });

  function scheduleAutoLock(pin: string) {
    const game = getGame(pin);
    if (!game || !game.questionEndsAt) return;
    const ms = Math.max(0, game.questionEndsAt - Date.now());
    if (lockTimers.has(pin)) clearTimeout(lockTimers.get(pin)!);
    const t = setTimeout(() => {
      const g = getGame(pin);
      if (!g) return;
      if (g.phase === "question") {
        advance(g);
        broadcast(pin);
      }
      lockTimers.delete(pin);
    }, ms + 50);
    lockTimers.set(pin, t);
  }

  httpServer.listen(port, () => {
    console.log(`▶ broadcast ready on http://${hostname}:${port}`);
  });
});

function matchResultsCsv(url: string | undefined): string | null {
  if (!url) return null;
  const path = url.split("?")[0];
  const m = /^\/host\/([^/]+)\/results\.csv$/.exec(path);
  return m ? decodeURIComponent(m[1]) : null;
}

function handleResultsCsv(pin: string, res: import("node:http").ServerResponse) {
  const game = getGame(pin);
  if (!game) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Game not found" }));
    return;
  }
  if (game.phase !== "final") {
    res.statusCode = 409;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Game not finished" }));
    return;
  }
  const body = exportResultsCsv(game);
  const now = new Date();
  const utcDate =
    String(now.getUTCFullYear()) +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="broadcast-${pin}-${utcDate}.csv"`,
  );
  res.setHeader("Cache-Control", "no-store");
  res.end(body);
}
