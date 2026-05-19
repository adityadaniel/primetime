import { createServer } from "node:http";
import next from "next";
import { Server, Socket } from "socket.io";
import {
  advance,
  attachDisplay,
  attachHost,
  createGame,
  detachSocket,
  getGame,
  joinPlayer,
  kickPlayer,
  personalState,
  publicState,
  startGame,
  submitAnswer,
} from "./lib/game";
import type { Quiz, AnswerIndex } from "./lib/types";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 4321);
const hostname = "localhost";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

void app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
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
      (quiz: Quiz, ack: (res: { pin: string }) => void) => {
        const game = createGame(quiz);
        attachHost(game.pin, socket.id);
        socket.join(`pin:${game.pin}`);
        ack({ pin: game.pin });
        broadcast(game.pin);
      },
    );

    socket.on("host:attach", (pin: string) => {
      const game = attachHost(pin, socket.id);
      if (!game) return;
      socket.join(`pin:${pin}`);
      broadcast(pin);
    });

    socket.on("host:start", (pin: string) => {
      const game = getGame(pin);
      if (!game || game.hostSocketId !== socket.id) return;
      startGame(game);
      broadcast(pin);
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
        ack: (res: { ok: boolean; error?: string }) => void,
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
        ack({ ok: r.ok, error: r.error });
        broadcast(pin);
      },
    );

    socket.on("disconnect", () => {
      const events = detachSocket(socket.id);
      const pins = new Set(events.map((e) => e.pin));
      for (const pin of pins) broadcast(pin);
    });
  });

  const lockTimers = new Map<string, NodeJS.Timeout>();
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
