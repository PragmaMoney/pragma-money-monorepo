"use client";

import { useEffect, useMemo, useRef, useState } from "react";
type AgentKey = "A" | "B";
type Facing = "down" | "left" | "right" | "up";
type LogEntry = { ts: string; text: string };
type SheetMeta = {
  frames: string[][];
  frameW: number;
  frameH: number;
  rows: number;
  cols: number;
};
type Sprite = {
  tx: number;
  ty: number;
  walking: boolean;
  motionMs: number;
  facing: Facing;
  state: string;
  speech?: string;
};

const DEFAULT_SERVICE_ID =
  "0x0f03bb4150e3ecc7282c9b267aebb306c541e54e7ed8274defa5afaa1a397275";
const DEFAULT_SERVICE_URL = "https://sim.example.com/api";

const GRID_COLS = 24;
const GRID_ROWS = 16;
const TILE_SIZE = 28;
const GRID_MIN_TX = 1;
const GRID_MAX_TX = GRID_COLS - 2;
const GRID_MIN_TY = 2;
const GRID_MAX_TY = GRID_ROWS - 2;
const nowIso = () => new Date().toISOString();
const formatLogTs = (ts: string) => new Date(ts).toLocaleTimeString();

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const buildSheetMeta = async (src: string): Promise<SheetMeta> =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const file = src.split("/").at(-1) ?? src;
      const layoutConfig: Record<
        string,
        { rows: number; cols: number; trimX: number; trimY: number; shiftX: number; shiftY: number }
      > = {
        "agent.png": { rows: 4, cols: 3, trimX: 10, trimY: 5, shiftX: 0, shiftY: 0 },
        "pipo-nekonin032.png": { rows: 4, cols: 3, trimX: 0, trimY: 0, shiftX: 0, shiftY: 0 },
        "pipo-nekonin014.png": { rows: 4, cols: 3, trimX: 0, trimY: 0, shiftX: 0, shiftY: 0 },
      };
      const cfg = layoutConfig[file] ?? { rows: 4, cols: 3, trimX: 0, trimY: 0, shiftX: 0, shiftY: 0 };
      const cols = cfg.cols;
      const rows = cfg.rows;
      const cellW = Math.floor(img.naturalWidth / cols);
      const cellH = Math.floor(img.naturalHeight / rows);
      const frames: string[][] = [];
      for (let row = 0; row < rows; row += 1) {
        const rowFrames: string[] = [];
        for (let col = 0; col < cols; col += 1) {
          const srcW = cellW - cfg.trimX * 2;
          const srcH = cellH - cfg.trimY * 2;
          const canvas = document.createElement("canvas");
          canvas.width = srcW;
          canvas.height = srcH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            rowFrames.push(src);
            continue;
          }
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, srcW, srcH);
          const srcX = col * cellW + cfg.trimX + cfg.shiftX;
          const srcY = row * cellH + cfg.trimY + cfg.shiftY;
          ctx.drawImage(
            img,
            srcX,
            srcY,
            srcW,
            srcH,
            0,
            0,
            srcW,
            srcH
          );
          rowFrames.push(canvas.toDataURL("image/png"));
        }
        frames.push(rowFrames);
      }
      resolve({ frames, frameW: cellW, frameH: cellH, rows, cols });
    };
    img.onerror = () =>
      resolve({
        frames: [[src]],
        frameW: 32,
        frameH: 48,
        rows: 1,
        cols: 1,
      });
    img.src = src;
  });

export default function SimulationPage() {
  const [agentAReady, setAgentAReady] = useState(false);
  const [agentBReady, setAgentBReady] = useState(false);
  const [agentAPoolVisible, setAgentAPoolVisible] = useState(false);
  const [agentBPoolVisible, setAgentBPoolVisible] = useState(false);
  const [agentASmartVisible, setAgentASmartVisible] = useState(false);
  const [agentBSmartVisible, setAgentBSmartVisible] = useState(false);
  const [servicesRegistered, setServicesRegistered] = useState(false);
  const [agentAPayingServiceB, setAgentAPayingServiceB] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");

  const [agentAEoa, setAgentAEoa] = useState<string | null>(null);
  const [agentBEoa, setAgentBEoa] = useState<string | null>(null);
  const [agentAId, setAgentAId] = useState<string | null>(null);
  const [agentBId, setAgentBId] = useState<string | null>(null);
  const [agentASmartAccount, setAgentASmartAccount] = useState<string | null>(null);
  const [agentBSmartAccount, setAgentBSmartAccount] = useState<string | null>(null);
  const [agentAPool, setAgentAPool] = useState<string | null>(null);
  const [agentBPool, setAgentBPool] = useState<string | null>(null);
  const [agentASmartUsdc, setAgentASmartUsdc] = useState("0.00");
  const [agentBSmartUsdc, setAgentBSmartUsdc] = useState("0.00");
  const [agentATvl, setAgentATvl] = useState("0.00");
  const [agentBTvl, setAgentBTvl] = useState("0.00");
  const [gatewayUsdc, setGatewayUsdc] = useState("0.00");
  const [hoverTile, setHoverTile] = useState<{ tx: number; ty: number } | null>(null);

  const [frameTick, setFrameTick] = useState(0);
  const [sheetMeta, setSheetMeta] = useState<Record<AgentKey, SheetMeta | null>>({
    A: null,
    B: null,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agents, setAgents] = useState<Record<AgentKey, Sprite>>({
    A: { tx: 7, ty: 4, walking: false, motionMs: 180, facing: "right", state: "idle" },
    B: { tx: 16, ty: 4, walking: false, motionMs: 180, facing: "left", state: "idle" },
  });

  const agentsRef = useRef(agents);
  const liveLogRef = useRef<HTMLDivElement | null>(null);
  const timersRef = useRef<number[]>([]);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const [mapWidth, setMapWidth] = useState(0);

  const booths = useMemo(
    () => ({
      wallet: { tx: 3, ty: 2, tw: 4, th: 3, label: "Wallet" },
      factory: { tx: 17, ty: 2, tw: 4, th: 3, label: "Factory" },
      service: { tx: 17, ty: 11, tw: 4, th: 3, label: "Service" },
      trade: { tx: 10, ty: 8, tw: 4, th: 3, label: "Trade" },
      walletQueueA: { tx: 6, ty: 5 },
      walletQueueB: { tx: 4, ty: 5 },
      factoryQueueA: { tx: 18, ty: 5 },
      factoryQueueB: { tx: 20, ty: 5 },
      serviceQueue: { tx: 17, ty: 12 },
      tradeA: { tx: 11, ty: 9 },
      tradeB: { tx: 13, ty: 9 },
    }),
    []
  );

  useEffect(() => {
    agentsRef.current = agents;
  }, [agents]);

  const addLog = (text: string) => {
    setLogs((prev) => [...prev, { ts: nowIso(), text }].slice(-200));
  };

  useEffect(() => {
    if (!liveLogRef.current) return;
    liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight;
  }, [logs]);

  useEffect(() => {
    const id = window.setInterval(() => setFrameTick((prev) => prev + 1), 140);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [aMeta, bMeta] = await Promise.all([
        buildSheetMeta("/Simulation/pipo-nekonin032.png"),
        buildSheetMeta("/Simulation/pipo-nekonin014.png"),
      ]);
      if (cancelled) return;
      setSheetMeta({ A: aMeta, B: bMeta });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
    };
  }, []);

  useEffect(() => {
    const el = mapRef.current;
    if (!el) return;
    const update = () => setMapWidth(el.clientWidth);
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const say = (agent: AgentKey, text: string, ms = 1400) => {
    setAgents((prev) => ({ ...prev, [agent]: { ...prev[agent], speech: text } }));
    const timeoutId = window.setTimeout(() => {
      setAgents((prev) => ({ ...prev, [agent]: { ...prev[agent], speech: undefined } }));
    }, ms);
    timersRef.current.push(timeoutId);
  };

  const isWithinWanderBounds = (tx: number, ty: number) => {
    const insideBounds = tx >= 3 && tx <= 20 && ty >= 4 && ty <= 9;
    const inTradeBlock = tx >= 9 && tx <= 14 && ty >= 6 && ty <= 8;
    return insideBounds && !inTradeBlock;
  };

  const stepAgent = (
    agent: AgentKey,
    dx: number,
    dy: number,
    state: string,
    isAllowed?: (tx: number, ty: number) => boolean
  ) =>
    new Promise<void>((resolve) => {
      setAgents((prev) => {
        const current = prev[agent];
        const nextTx = clamp(current.tx + dx, GRID_MIN_TX, GRID_MAX_TX);
        const nextTy = clamp(current.ty + dy, GRID_MIN_TY, GRID_MAX_TY);
        const facing: Facing = dx < 0 ? "left" : dx > 0 ? "right" : dy < 0 ? "up" : "down";
        if (nextTx === current.tx && nextTy === current.ty) {
          resolve();
          return { ...prev, [agent]: { ...current, facing, moving: false, state: "idle" } };
        }
        if (isAllowed && !isAllowed(nextTx, nextTy)) {
          resolve();
          return { ...prev, [agent]: { ...current, facing, moving: false, state: "idle" } };
        }
        const motionMs = 420;
        const timeoutId = window.setTimeout(() => {
          resolve();
        }, motionMs + 10);
        timersRef.current.push(timeoutId);
        return {
          ...prev,
          [agent]: { ...current, tx: nextTx, ty: nextTy, walking: true, motionMs, facing, state },
        };
      });
    });

  const moveAgentTo = async (agent: AgentKey, target: { tx: number; ty: number }, state: string) => {
    let guard = 0;
    setAgents((prev) => ({ ...prev, [agent]: { ...prev[agent], walking: true, state } }));
    while (guard < 200) {
      guard += 1;
      const current = agentsRef.current[agent];
      if (current.tx === target.tx && current.ty === target.ty) break;
      if (current.tx !== target.tx) {
        await stepAgent(agent, target.tx > current.tx ? 1 : -1, 0, state);
      } else {
        await stepAgent(agent, 0, target.ty > current.ty ? 1 : -1, state);
      }
    }
    setAgents((prev) => ({ ...prev, [agent]: { ...prev[agent], walking: false, state: "idle" } }));
  };

  const resetSimulation = () => {
    setAgentAReady(false);
    setAgentBReady(false);
    setAgentAPoolVisible(false);
    setAgentBPoolVisible(false);
    setAgentASmartVisible(false);
    setAgentBSmartVisible(false);
    setServicesRegistered(false);
    setAgentAPayingServiceB(false);
    setActiveStep(null);
    setApiKey("");
    setAgentAEoa(null);
    setAgentBEoa(null);
    setAgentAId(null);
    setAgentBId(null);
    setAgentASmartAccount(null);
    setAgentBSmartAccount(null);
    setAgentAPool(null);
    setAgentBPool(null);
    setAgentASmartUsdc("0.00");
    setAgentBSmartUsdc("0.00");
    setAgentATvl("0.00");
    setAgentBTvl("0.00");
    setGatewayUsdc("0.00");
    setLogs([{ ts: nowIso(), text: "Demo reset. Agents are free-roaming again." }]);
    setAgents({
      A: { tx: 7, ty: 4, walking: false, motionMs: 180, facing: "right", state: "idle" },
      B: { tx: 16, ty: 4, walking: false, motionMs: 180, facing: "left", state: "idle" },
    });
  };

  const runDemoStep = async (step: string) => {
    if (step === "init") {
      await Promise.all([moveAgentTo("A", booths.walletQueueA, "walking to wallet"), moveAgentTo("B", booths.walletQueueB, "walking to wallet")]);
      setAgentAEoa("0x35ac16EdD84Ec0C1397C41c260BC288593E90B6C");
      setAgentBEoa("0x367CF2175C3Db73Fb4496578773eEE991590b0d3");
      setAgentAReady(true);
      setAgentBReady(true);
      say("A", "Wallet ready");
      say("B", "Wallet ready");
      addLog("Demo: Agent A and Agent B initialized EOAs at wallet booth.");
      return;
    }

    if (step === "register") {
      if (!agentAReady || !agentBReady) {
        addLog("Blocked: initialize both agents first.");
        return;
      }
      await Promise.all([moveAgentTo("A", booths.factoryQueueA, "heading to factory"), moveAgentTo("B", booths.factoryQueueB, "heading to factory")]);
      setAgentAId("172");
      setAgentBId("173");
      setAgentASmartAccount("0x53e7A5d01325d9c2A48FE026D9eEb612c5e80722");
      setAgentBSmartAccount("0xDB3D454B56933ce0ce350A0B01B9E7B3e2805825");
      setAgentAPool("0x9b3a7b531Ee1cDB115D5cd5f5d00a4F9D6fFB0Cb");
      setAgentBPool("0xa5cde960079168A48Cbe2d61A630A370A5393C10");
      setAgentASmartVisible(true);
      setAgentBSmartVisible(true);
      setAgentAPoolVisible(true);
      setAgentBPoolVisible(true);
      say("A", "Registered!");
      say("B", "Registered!");
      addLog("Demo: both agents registered at factory.");
      return;
    }

    if (step === "seed") {
      if (!agentAPoolVisible || !agentBPoolVisible) {
        addLog("Blocked: register both agents before seeding.");
        return;
      }
      await Promise.all([moveAgentTo("A", booths.walletQueueA, "funding pool"), moveAgentTo("B", booths.walletQueueB, "funding pool")]);
      setAgentASmartUsdc("1.20");
      setAgentBSmartUsdc("1.00");
      setAgentATvl("0.70");
      setAgentBTvl("1.50");
      say("A", "Seed done");
      say("B", "Seed done");
      addLog("Demo: pools seeded and balances updated.");
      return;
    }

    if (step === "register-service") {
      if (!agentBReady) {
        addLog("Blocked: initialize Agent B first.");
        return;
      }
      await moveAgentTo("B", booths.serviceQueue, "registering service");
      setServicesRegistered(true);
      say("B", "Service listed");
      addLog("Demo: Agent B registered service.");
      return;
    }

    if (step === "pay") {
      if (!servicesRegistered) {
        addLog("Blocked: Agent B must register service first.");
        return;
      }
      await Promise.all([moveAgentTo("A", { tx: 9, ty: 7 }, "going to trade"), moveAgentTo("B", { tx: 14, ty: 7 }, "going to trade")]);
      setAgentAPayingServiceB(true);
      say("A", "Need your API");
      say("B", "Paid. Access granted");
      setAgentASmartUsdc("0.85");
      setAgentBSmartUsdc("1.35");
      setGatewayUsdc("0.35");
      addLog("Demo: Agent A paid Agent B service at trading plaza.");
      await sleep(1400);
      setAgentAPayingServiceB(false);
      return;
    }

    if (step === "reset") resetSimulation();
  };

  const callSimStep = async (step: string) => {
    if (activeStep) return;
    setActiveStep(step);
    addLog(`Running step: ${step}`);
    try {
      await runDemoStep(step);
    } finally {
      setActiveStep(null);
    }
  };

  useEffect(() => {
    if (activeStep) return;
    const intervalId = window.setInterval(() => {
      (["A", "B"] as AgentKey[]).forEach((key) => {
        const current = agentsRef.current[key];
        if (current.walking) return;
        if (Math.random() < 0.45) return;
        const directions = [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
        ].sort(() => Math.random() - 0.5);
        const steps = 3 + Math.floor(Math.random() * 3); // 3-5 tiles
        void (async () => {
          setAgents((prev) => ({ ...prev, [key]: { ...prev[key], walking: true, state: "wandering" } }));
          for (const dir of directions) {
            let moved = false;
            for (let i = 0; i < steps; i += 1) {
              const before = agentsRef.current[key];
              await stepAgent(key, dir.dx, dir.dy, "wandering", isWithinWanderBounds);
              const after = agentsRef.current[key];
              if (after.tx === before.tx && after.ty === before.ty) break;
              moved = true;
            }
            if (moved) break;
          }
          setAgents((prev) => ({ ...prev, [key]: { ...prev[key], walking: false, state: "idle" } }));
        })();
      });
    }, 1200);
    return () => window.clearInterval(intervalId);
  }, [activeStep]);

  const shortAddress = (v: string | null) => (v ? `${v.slice(0, 6)}...${v.slice(-4)}` : "Not set");
  const isBusy = activeStep !== null;
  const tilePx = mapWidth > 0 ? mapWidth / GRID_COLS : TILE_SIZE;

  const spriteStyle = (key: AgentKey, sprite: Sprite) => {
    const rowByFacing: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 };
    const walkPhase = frameTick % 2;
    const walkFrame = walkPhase === 0 ? 0 : 2; // L, R, L, R
    const frameCol = sprite.walking ? walkFrame : 1;
    const frameRow = rowByFacing[sprite.facing];
    const meta = sheetMeta[key];
    if (!meta) {
      return {
        width: 34,
        height: 42,
        background: key === "A" ? "#f97316" : "#3b82f6",
      };
    }
    const desiredHeightPx = 80;
    const scale = desiredHeightPx / meta.frameH;
    const outW = Math.round(meta.frameW * scale);
    const outH = Math.round(meta.frameH * scale);
    const adjustedRow =
      meta.rows === 5 && frameRow === 3
        ? 4
        : Math.min(frameRow, meta.rows - 1);
    const frameImg = meta.frames[adjustedRow]?.[frameCol] ?? meta.frames[0]?.[0];
    return {
      width: outW,
      height: outH,
      backgroundImage: frameImg ? `url(${frameImg})` : undefined,
      backgroundSize: "100% 100%",
      backgroundPosition: "center",
      imageRendering: "pixelated" as const,
    };
  };

  return (
    <div className="min-h-screen bg-pragma-dark text-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="font-display text-4xl font-bold">Simulation</h1>
        <p className="mt-2 text-white/70">
          Top-down simulation map with animated agents.
        </p>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/50 p-5 lg:col-span-2">
            <div
              ref={mapRef}
              className="relative overflow-hidden rounded-2xl border border-white/15 bg-black/40"
              style={{
                width: "100%",
                aspectRatio: `${GRID_COLS} / ${GRID_ROWS}`,
                backgroundImage: "url(/Simulation/map.png)",
                backgroundSize: "100% 100%",
                backgroundRepeat: "no-repeat",
                backgroundPosition: "center",
              }}
              onMouseLeave={() => setHoverTile(null)}
              onMouseMove={(event) => {
                if (!mapRef.current) return;
                const rect = mapRef.current.getBoundingClientRect();
                const localX = event.clientX - rect.left;
                const localY = event.clientY - rect.top;
                const tx = Math.floor(localX / tilePx);
                const ty = Math.floor(localY / tilePx);
                if (tx < 0 || ty < 0 || tx >= GRID_COLS || ty >= GRID_ROWS) {
                  setHoverTile(null);
                  return;
                }
                setHoverTile({ tx, ty });
              }}
            >
              {hoverTile && (
                <div className="pointer-events-none absolute left-3 top-3 rounded-md border border-white/20 bg-black/70 px-2 py-1 text-[11px] text-white/90">
                  tile ({hoverTile.tx}, {hoverTile.ty})
                </div>
              )}

              {(["A", "B"] as AgentKey[]).map((id) => {
                const sprite = agents[id];
                const style = spriteStyle(id, sprite);
                return (
                  <div
                    key={id}
                    className="absolute"
                    style={{
                      left: sprite.tx * tilePx - Number(style.width) / 2,
                      top: sprite.ty * tilePx - Number(style.height) + 12,
                      transitionProperty: "left, top",
                      transitionDuration: `${sprite.motionMs}ms`,
                      transitionTimingFunction: "linear",
                    }}
                  >
                    {sprite.speech && (
                      <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/20 bg-black/75 px-2 py-1 text-[10px]">
                        {sprite.speech}
                      </div>
                    )}
                    <div style={style} />
                    <div className="mt-2 text-center text-[10px] font-semibold">
                      Agent {id} {isBusy ? `- ${sprite.state}` : ""}
                    </div>
                  </div>
                );
              })}

              {agentAPayingServiceB && (
                <div className="pointer-events-none absolute left-1/2 top-[58%] -translate-x-1/2 rounded-full border border-amber-300/60 bg-amber-200/20 px-3 py-1 text-xs text-amber-100">
                  Trade + x402 payment in progress
                </div>
              )}
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <h2 className="font-display text-lg">Simulation Controls</h2>
              <div className="mt-3 space-y-2">
                <button onClick={() => callSimStep("init")} disabled={isBusy} className="sim-btn">
                  Initialize Agents
                </button>
                <button onClick={() => callSimStep("register")} disabled={isBusy} className="sim-btn">
                  Register at Factory
                </button>
                <button onClick={() => callSimStep("seed")} disabled={isBusy} className="sim-btn">
                  Seed Pools
                </button>
                <button onClick={() => callSimStep("register-service")} disabled={isBusy} className="sim-btn">
                  Register Service (B)
                </button>
                <button onClick={() => callSimStep("pay")} disabled={isBusy} className="sim-btn sim-btn-amber">
                  A Pays for B Service
                </button>
                <button onClick={() => callSimStep("reset")} disabled={isBusy} className="sim-btn">
                  Reset Demo
                </button>
              </div>
              <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-2">
                <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/60">Future script key</label>
                <input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="kept for later wiring"
                  className="w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none"
                />
              </div>
            </div>


            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <h2 className="font-display text-lg">Live Log</h2>
              <div ref={liveLogRef} className="mt-3 max-h-[250px] overflow-auto rounded-lg border border-emerald-400/20 bg-black/70 p-3 font-mono text-xs">
                {logs.length === 0 ? (
                  <div className="text-emerald-300/70">&gt; waiting for activity...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={`${log.ts}-${idx}`} className="whitespace-pre-wrap break-words text-emerald-200">
                      <span className="text-emerald-400/75">[{formatLogTs(log.ts)}]</span> {">"} {log.text}
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <style jsx>{`
        .sim-btn {
          width: 100%;
          border-radius: 0.6rem;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(255, 255, 255, 0.07);
          padding: 0.45rem 0.7rem;
          text-align: left;
          font-size: 0.75rem;
          font-weight: 600;
          transition: background 150ms ease;
        }
        .sim-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.15);
        }
        .sim-btn:disabled {
          cursor: wait;
          opacity: 0.6;
        }
        .sim-btn-amber {
          border-color: rgba(245, 158, 11, 0.35);
          background: rgba(245, 158, 11, 0.18);
          color: #fef3c7;
        }
      `}</style>
    </div>
  );
}
