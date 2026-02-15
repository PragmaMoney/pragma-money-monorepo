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
type SimState = {
  logs?: { ts: string; text: string }[];
  walletA?: { address: string };
  walletB?: { address: string };
  regA?: { agentId: string; smartAccount: string; poolAddress: string };
  regB?: { agentId: string; smartAccount: string; poolAddress: string };
  service?: { idHex: string; url: string; ownerAgentId?: string };
  balances?: {
    agentASmartUsdc?: string;
    agentBSmartUsdc?: string;
    poolAUsdc?: string;
    poolBUsdc?: string;
  };
};

const GRID_COLS = 24;
const GRID_ROWS = 16;
const TILE_SIZE = 28;
const GRID_MIN_TX = 1;
const GRID_MAX_TX = GRID_COLS - 2;
const GRID_MIN_TY = 2;
const GRID_MAX_TY = GRID_ROWS - 2;
const DEFAULT_AGENT_A_SERVICE_ID =
  "0x21473c7e9af9e018b3e8e6f4c40eaa76f47b4f147b4f0ce6bc0fcb1a9ac3d124";
const DEFAULT_AGENT_A_SERVICE_URL = "https://moneybot.sim.example.com/api";
const DEFAULT_AGENT_B_SERVICE_ID =
  "0x0f03bb4150e3ecc7282c9b267aebb306c541e54e7ed8274defa5afaa1a397275";
const DEFAULT_AGENT_B_SERVICE_URL = "https://sim.example.com/api";
const SIM_API_KEY_STORAGE_KEY = "simulation.apiKey";
const EXPLORER_BASE = "https://monad-testnet.socialscan.io";
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
  const [agentAInitializing, setAgentAInitializing] = useState(false);
  const [agentBInitializing, setAgentBInitializing] = useState(false);
  const [agentARegistering, setAgentARegistering] = useState(false);
  const [agentBRegistering, setAgentBRegistering] = useState(false);
  const [agentASeeding, setAgentASeeding] = useState(false);
  const [agentBSeeding, setAgentBSeeding] = useState(false);
  const [agentAServiceRegistering, setAgentAServiceRegistering] = useState(false);
  const [agentBServiceRegistering, setAgentBServiceRegistering] = useState(false);
  const [agentAPoolVisible, setAgentAPoolVisible] = useState(false);
  const [agentBPoolVisible, setAgentBPoolVisible] = useState(false);
  const [servicesRegistered, setServicesRegistered] = useState(false);
  const [agentAPayingServiceB, setAgentAPayingServiceB] = useState(false);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const simProxyUrl = (process.env.NEXT_PUBLIC_PROXY_URL || "http://localhost:4402").replace(/\/$/, "");
  const [agentAEoa, setAgentAEoa] = useState<string | null>(null);
  const [agentBEoa, setAgentBEoa] = useState<string | null>(null);
  const [agentASmartAccount, setAgentASmartAccount] = useState<string | null>(null);
  const [agentBSmartAccount, setAgentBSmartAccount] = useState<string | null>(null);
  const [agentAId, setAgentAId] = useState<string | null>(null);
  const [agentBId, setAgentBId] = useState<string | null>(null);
  const [agentASmartUsdc, setAgentASmartUsdc] = useState("0.00");
  const [agentBSmartUsdc, setAgentBSmartUsdc] = useState("0.00");
  const [agentAPool, setAgentAPool] = useState<string | null>(null);
  const [agentBPool, setAgentBPool] = useState<string | null>(null);
  const [agentATvl, setAgentATvl] = useState("0.00");
  const [agentBTvl, setAgentBTvl] = useState("0.00");
  const [agentAServiceId, setAgentAServiceId] = useState<string | null>(DEFAULT_AGENT_A_SERVICE_ID);
  const [agentAServiceUrl, setAgentAServiceUrl] = useState<string | null>(DEFAULT_AGENT_A_SERVICE_URL);
  const [agentBServiceId, setAgentBServiceId] = useState<string | null>(DEFAULT_AGENT_B_SERVICE_ID);
  const [agentBServiceUrl, setAgentBServiceUrl] = useState<string | null>(DEFAULT_AGENT_B_SERVICE_URL);

  const [hoverTile, setHoverTile] = useState<{ tx: number; ty: number } | null>(null);

  const [frameTick, setFrameTick] = useState(0);
  const [sheetMeta, setSheetMeta] = useState<Record<AgentKey, SheetMeta | null>>({
    A: null,
    B: null,
  });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [agents, setAgents] = useState<Record<AgentKey, Sprite>>({
    A: { tx: 5, ty: 4, walking: false, motionMs: 180, facing: "up", state: "idle" },
    B: { tx: 7, ty: 4, walking: false, motionMs: 180, facing: "up", state: "idle" },
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

  useEffect(() => {
    const saved = window.sessionStorage.getItem(SIM_API_KEY_STORAGE_KEY);
    if (saved) setApiKey(saved);
  }, []);

  const addLog = (text: string) => {
    setLogs((prev) => [...prev, { ts: nowIso(), text }].slice(-200));
  };

  const saveApiKeyToSession = () => {
    const value = apiKey.trim();
    if (!value) {
      window.sessionStorage.removeItem(SIM_API_KEY_STORAGE_KEY);
      addLog("Cleared API key from session.");
      return;
    }
    window.sessionStorage.setItem(SIM_API_KEY_STORAGE_KEY, value);
    addLog("Saved API key to this browser session.");
  };

  const clearApiKeyFromSession = () => {
    setApiKey("");
    window.sessionStorage.removeItem(SIM_API_KEY_STORAGE_KEY);
    addLog("Cleared API key from session.");
  };

  const applyState = (state: SimState) => {
    if (state.walletA?.address) {
      setAgentAReady(true);
      setAgentAEoa(state.walletA.address);
    }
    if (state.walletB?.address) {
      setAgentBReady(true);
      setAgentBEoa(state.walletB.address);
    }
    if (state.regA) {
      setAgentAPoolVisible(true);
      setAgentAId(state.regA.agentId);
      setAgentASmartAccount(state.regA.smartAccount);
      setAgentAPool(state.regA.poolAddress);
    }
    if (state.regB) {
      setAgentBPoolVisible(true);
      setAgentBId(state.regB.agentId);
      setAgentBSmartAccount(state.regB.smartAccount);
      setAgentBPool(state.regB.poolAddress);
    }
    if (state.service?.idHex) {
      setServicesRegistered(true);
      setAgentBServiceId(state.service.idHex);
      setAgentBServiceUrl(state.service.url ?? null);
    }
    if (state.balances) {
      if (state.balances.agentASmartUsdc) setAgentASmartUsdc(state.balances.agentASmartUsdc);
      if (state.balances.agentBSmartUsdc) setAgentBSmartUsdc(state.balances.agentBSmartUsdc);
      if (state.balances.poolAUsdc) setAgentATvl(state.balances.poolAUsdc);
      if (state.balances.poolBUsdc) setAgentBTvl(state.balances.poolBUsdc);
    }
    if (state.logs && state.logs.length) {
      const mapped = state.logs
        .slice()
        .reverse()
        .map((entry) => ({ ts: entry.ts, text: entry.text }));
      setLogs((prev) => {
        const merged = [...prev, ...mapped];
        const deduped: LogEntry[] = [];
        const seen = new Set<string>();
        for (const item of merged) {
          const key = `${item.ts}|${item.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(item);
        }
        deduped.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
        return deduped.slice(-200);
      });
    }
  };

  const applyResponseLogs = (rawLogs: string[] | undefined) => {
    if (!rawLogs || rawLogs.length === 0) return;
    const parsed = rawLogs
      .map((line) => {
        const match = line.match(/^\[(.+?)\]\s*(.*)$/);
        if (match) return { ts: match[1], text: match[2] };
        return { ts: nowIso(), text: line };
      })
      .reverse();
    setLogs((prev) => {
      const merged = [...prev, ...parsed];
      const deduped: LogEntry[] = [];
      const seen = new Set<string>();
      for (const item of merged) {
        const key = `${item.ts}|${item.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }
      deduped.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
      return deduped.slice(-200);
    });
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
    // Include lower map rows so agents can keep roaming after seed step.
    const insideBounds = tx >= 3 && tx <= 20 && ty >= 4 && ty <= 13;
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

  const setAgentIdleFacing = (agent: AgentKey, facing: Facing) => {
    setAgents((prev) => ({
      ...prev,
      [agent]: {
        ...prev[agent],
        walking: false,
        state: "idle",
        facing,
      },
    }));
  };

  const resetSimulation = () => {
    setAgentAReady(false);
    setAgentBReady(false);
    setAgentAInitializing(false);
    setAgentBInitializing(false);
    setAgentARegistering(false);
    setAgentBRegistering(false);
    setAgentASeeding(false);
    setAgentBSeeding(false);
    setAgentAServiceRegistering(false);
    setAgentBServiceRegistering(false);
    setAgentAPoolVisible(false);
    setAgentBPoolVisible(false);
    setServicesRegistered(false);
    setAgentAPayingServiceB(false);
    setActiveStep(null);
    setAgentAEoa(null);
    setAgentBEoa(null);
    setAgentASmartAccount(null);
    setAgentBSmartAccount(null);
    setAgentAId(null);
    setAgentBId(null);
    setAgentASmartUsdc("0.00");
    setAgentBSmartUsdc("0.00");
    setAgentAPool(null);
    setAgentBPool(null);
    setAgentATvl("0.00");
    setAgentBTvl("0.00");
    setAgentAServiceId(DEFAULT_AGENT_A_SERVICE_ID);
    setAgentAServiceUrl(DEFAULT_AGENT_A_SERVICE_URL);
    setAgentBServiceId(DEFAULT_AGENT_B_SERVICE_ID);
    setAgentBServiceUrl(DEFAULT_AGENT_B_SERVICE_URL);
    setLogs([{ ts: nowIso(), text: "Demo reset. Agents are free-roaming again." }]);
    setAgents({
      A: { tx: 5, ty: 4, walking: false, motionMs: 180, facing: "up", state: "idle" },
      B: { tx: 7, ty: 4, walking: false, motionMs: 180, facing: "up", state: "idle" },
    });
  };

  const runDemoStep = async (step: string) => {
    if (step === "init") {
      await Promise.all([
        moveAgentTo("A", { tx: 5, ty: 4 }, "walking"),
        moveAgentTo("B", { tx: 7, ty: 4 }, "walking"),
      ]);
      setAgentIdleFacing("A", "up");
      setAgentIdleFacing("B", "up");
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
      await Promise.all([
        moveAgentTo("A", { tx: 11, ty: 4 }, "walking"),
        moveAgentTo("B", { tx: 13, ty: 4 }, "walking"),
      ]);
      setAgentIdleFacing("A", "up");
      setAgentIdleFacing("B", "up");
      setAgentASmartAccount("0x53e7A5d01325d9c2A48FE026D9eEb612c5e80722");
      setAgentBSmartAccount("0xDB3D454B56933ce0ce350A0B01B9E7B3e2805825");
      setAgentAId("172");
      setAgentBId("173");
      setAgentAPool("0x9b3a7b531Ee1cDB115D5cd5f5d00a4F9D6fFB0Cb");
      setAgentBPool("0xa5cde960079168A48Cbe2d61A630A370A5393C10");
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
      await Promise.all([
        moveAgentTo("A", { tx: 6, ty: 12 }, "walking"),
        moveAgentTo("B", { tx: 7, ty: 13 }, "walking"),
      ]);
      setAgentIdleFacing("A", "left");
      setAgentIdleFacing("B", "left");
      setAgentASmartUsdc("0.50");
      setAgentBSmartUsdc("0.50");
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
      await moveAgentTo("B", { tx: 17, ty: 4 }, "walking");
      setAgentIdleFacing("B", "up");
      setServicesRegistered(true);
      setAgentBServiceId("0x0f03bb4150e3ecc7282c9b267aebb306c541e54e7ed8274defa5afaa1a397275");
      setAgentBServiceUrl("https://sim.example.com/api");
      say("B", "Service listed");
      addLog("Demo: Agent B registered service.");
      return;
    }

    if (step === "pay") {
      if (!servicesRegistered) {
        addLog("Blocked: Agent B must register service first.");
        return;
      }
      await Promise.all([
        moveAgentTo("A", { tx: 9, ty: 8 }, "walking"),
        moveAgentTo("B", { tx: 15, ty: 8 }, "walking"),
      ]);
      setAgentIdleFacing("A", "right");
      setAgentIdleFacing("B", "left");
      setAgentAPayingServiceB(true);
      say("A", "Need your API");
      say("B", "Paid. Access granted");
      addLog("Demo: Agent A paid Agent B service at trading plaza.");
      await sleep(1400);
      setAgentAPayingServiceB(false);
      return;
    }

    if (step === "reset") resetSimulation();
  };

  const animateStepToBooth = async (step: string) => {
    if (step === "init") {
      await Promise.all([
        moveAgentTo("A", { tx: 5, ty: 4 }, "walking"),
        moveAgentTo("B", { tx: 7, ty: 4 }, "walking"),
      ]);
      setAgentIdleFacing("A", "up");
      setAgentIdleFacing("B", "up");
      return;
    }
    if (step === "register") {
      await Promise.all([
        moveAgentTo("A", { tx: 11, ty: 4 }, "walking"),
        moveAgentTo("B", { tx: 13, ty: 4 }, "walking"),
      ]);
      setAgentIdleFacing("A", "up");
      setAgentIdleFacing("B", "up");
      return;
    }
    if (step === "seed") {
      await Promise.all([
        moveAgentTo("A", { tx: 6, ty: 12 }, "walking"),
        moveAgentTo("B", { tx: 7, ty: 13 }, "walking"),
      ]);
      setAgentIdleFacing("A", "left");
      setAgentIdleFacing("B", "left");
      return;
    }
    if (step === "register-service") {
      await moveAgentTo("B", { tx: 17, ty: 4 }, "walking");
      setAgentIdleFacing("B", "up");
      return;
    }
    if (step === "pay") {
      await Promise.all([
        moveAgentTo("A", { tx: 9, ty: 8 }, "walking"),
        moveAgentTo("B", { tx: 15, ty: 8 }, "walking"),
      ]);
      setAgentIdleFacing("A", "right");
      setAgentIdleFacing("B", "left");
    }
  };

  const callSimStep = async (step: string) => {
    if (activeStep) return;
    setActiveStep(step);
    addLog(`Running step: ${step}`);
    let movementPromise: Promise<void> | null = null;
    try {
      const key = apiKey.trim();
      if (!key) {
        addLog("No API key provided. Running demo flow.");
        await runDemoStep(step);
        return;
      }
      // Keep step loading until both tx response and booth movement finish.
      movementPromise = animateStepToBooth(step);
      const resp = await fetch(`${simProxyUrl}/sim/step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ runId: "sim1", step }),
      });
      const json = await resp.json();
      if (!resp.ok) {
        addLog(`Error: ${json?.error || "Simulation step failed."}`);
        await movementPromise;
        return;
      }
      if (step === "reset") {
        resetSimulation();
        await movementPromise;
        return;
      }
      const lastEvent = Array.isArray(json.events) ? json.events.at(-1) : null;
      if (lastEvent?.state) {
        applyState(lastEvent.state as SimState);
      }
      if (Array.isArray(json.logs)) applyResponseLogs(json.logs);
      await movementPromise;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulation step failed.";
      addLog(`Error: ${message}`);
      if (movementPromise) await movementPromise;
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

  const isActionRunning =
    activeStep !== null ||
    agentAInitializing ||
    agentBInitializing ||
    agentARegistering ||
    agentBRegistering ||
    agentASeeding ||
    agentBSeeding ||
    agentAServiceRegistering ||
    agentBServiceRegistering ||
    agentAPayingServiceB;
  const initializingAgents = agentAInitializing || agentBInitializing;
  const registeringAgents = agentARegistering || agentBRegistering;
  const seedingPools = agentASeeding || agentBSeeding;
  const registeringServices = agentAServiceRegistering || agentBServiceRegistering;
  const isBusy = isActionRunning;
  const tilePx = mapWidth > 0 ? mapWidth / GRID_COLS : TILE_SIZE;
  const shortAddress = (value: string | null) =>
    value && value.length > 10 ? `${value.slice(0, 6)}...${value.slice(-4)}` : "Not set";
  const agentAServiceLabel = agentAServiceId
    ? `${agentAServiceId.slice(0, 10)}...${agentAServiceId.slice(-8)}`
    : "Not set";
  const agentBServiceLabel = agentBServiceId
    ? `${agentBServiceId.slice(0, 10)}...${agentBServiceId.slice(-8)}`
    : "Not set";
  const renderControlSpinner = () => (
    <span className="mr-1 inline-block h-3 w-3 animate-spin rounded-full border border-white/40 border-t-white align-[-1px]" />
  );

  const handleInitializeAgents = async () => {
    if (isActionRunning || (agentAReady && agentBReady)) return;
    setAgentAInitializing(true);
    setAgentBInitializing(true);
    await callSimStep("init");
    setAgentAInitializing(false);
    setAgentBInitializing(false);
  };

  const handleRegisterAgents = async () => {
    if (isActionRunning || !agentAReady || !agentBReady || (agentAPoolVisible && agentBPoolVisible)) return;
    setAgentARegistering(true);
    setAgentBRegistering(true);
    await callSimStep("register");
    setAgentARegistering(false);
    setAgentBRegistering(false);
  };

  const handleSeedPools = async () => {
    if (isActionRunning || !agentAPoolVisible || !agentBPoolVisible) return;
    setAgentASeeding(true);
    setAgentBSeeding(true);
    await callSimStep("seed");
    setAgentASeeding(false);
    setAgentBSeeding(false);
  };

  const handleRegisterServices = async () => {
    if (isActionRunning || !agentAReady || !agentBReady || servicesRegistered) return;
    setAgentAServiceRegistering(true);
    setAgentBServiceRegistering(true);
    await callSimStep("register-service");
    setAgentAServiceRegistering(false);
    setAgentBServiceRegistering(false);
  };

  const handlePayForServiceB = async () => {
    if (isActionRunning || !agentAPoolVisible || !agentBPoolVisible || !servicesRegistered) return;
    setAgentAPayingServiceB(true);
    await callSimStep("pay");
    setAgentAPayingServiceB(false);
  };
  const idleFrame = (key: AgentKey) => {
    const meta = sheetMeta[key];
    if (!meta) return null;
    return meta.frames[0]?.[1] ?? meta.frames[0]?.[0] ?? null;
  };
  const renderSetting = () => (
    <>
      {renderControlSpinner()}
      Setting...
    </>
  );
  const renderAddressLink = (value: string | null) => {
    if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return "Not set";
    return (
      <a
        href={`${EXPLORER_BASE}/address/${value}`}
        target="_blank"
        rel="noreferrer"
        className="underline decoration-white/30 hover:decoration-emerald-300"
      >
        {shortAddress(value)}
      </a>
    );
  };
  const renderTxOrAddressText = (text: string) => {
    const parts: Array<string | { value: string; kind: "tx" | "address" }> = [];
    const pattern = /0x[a-fA-F0-9]{64}|0x[a-fA-F0-9]{40}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index));
      const value = match[0];
      parts.push({ value, kind: value.length === 66 ? "tx" : "address" });
      lastIndex = match.index + value.length;
    }
    if (lastIndex < text.length) parts.push(text.slice(lastIndex));
    return parts.map((part, idx) => {
      if (typeof part === "string") return <span key={idx}>{part}</span>;
      const href =
        part.kind === "tx"
          ? `${EXPLORER_BASE}/tx/${part.value}`
          : `${EXPLORER_BASE}/address/${part.value}`;
      return (
        <a
          key={`${part.value}-${idx}`}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-emerald-300 underline decoration-emerald-400/60 hover:text-emerald-200"
        >
          {part.value}
        </a>
      );
    });
  };

  const spriteStyle = (key: AgentKey, sprite: Sprite) => {
    const rowByFacing: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 };
    const walkPhase = frameTick % 2;
    const walkFrame = walkPhase === 0 ? 0 : 2; // L, R, L, R
    const frameCol = sprite.walking ? walkFrame : 1;
    const frameRow = rowByFacing[sprite.facing];
    const meta = sheetMeta[key];
    if (!meta) {
      const fallbackSize = Math.max(28, Math.min(54, Math.round(tilePx * 1.6)));
      return {
        width: fallbackSize,
        height: Math.round(fallbackSize * 1.24),
        background: key === "A" ? "#f97316" : "#3b82f6",
      };
    }
    const desiredHeightPx = Math.max(54, Math.min(92, Math.round(tilePx * 2.55)));
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="font-display text-4xl font-bold">Simulation</h1>
            <p className="mt-2 text-white/70">
              Top-down simulation map with animated agents.
            </p>
          </div>
          <div className="w-full rounded-xl border border-white/10 bg-black/40 p-3 sm:w-[360px]">
            <label className="mb-1 block text-[11px] uppercase tracking-wide text-white/60">
              API Key
            </label>
            <div className="flex items-center gap-2">
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="admin bearer token"
                autoComplete="off"
                className="w-full rounded-md border border-white/15 bg-black/50 px-2 py-1.5 text-xs text-white placeholder:text-white/35 focus:outline-none"
              />
              <button
                type="button"
                onClick={saveApiKeyToSession}
                className="rounded-md border border-emerald-300/30 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-100 hover:bg-emerald-500/30"
                aria-label="Save API key"
                title="Save API key"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                  <polyline points="17 21 17 13 7 13 7 21" />
                  <polyline points="7 3 7 8 15 8" />
                </svg>
              </button>
              <button
                type="button"
                onClick={clearApiKeyFromSession}
                className="rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white/90 hover:bg-white/20"
                aria-label="Clear API key"
                title="Clear API key"
              >
                <svg
                  aria-hidden="true"
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10" />
                  <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-black/50 p-5 lg:col-span-2 self-start">
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
                      Agent {id}
                    </div>
                  </div>
                );
              })}

              {agentAPayingServiceB && (
                <div className="pointer-events-none absolute left-1/2 top-[58%] -translate-x-1/2 rounded-full border border-amber-300/60 bg-amber-200/20 px-3 py-1 text-xs text-amber-100">
                  Agent-to-Agent Transaction In Progress
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="card-aura card-aura-a rounded-3xl border border-orange-300/30 bg-gradient-to-b from-[#2b1721] to-[#171723] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                <div className="mb-3 flex items-center gap-3">
                  <div className="floaty flex h-20 w-20 items-center justify-center rounded-full bg-black/35 ring-2 ring-orange-300/30">
                    {idleFrame("A") ? (
                      <img
                        src={idleFrame("A") ?? ""}
                        alt="Agent A idle"
                        className="h-16 w-16"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-orange-500/20" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-white">Oren (Agent A)</h3>
                    <div className="mt-1 flex items-center gap-1.5">
                      <img src="/Simulation/skills3.png" alt="Skill 3" className="h-5 w-5 rounded-sm border border-white/15" style={{ imageRendering: "pixelated" }} />
                      <img src="/Simulation/skills4.png" alt="Skill 4" className="h-5 w-5 rounded-sm border border-white/15" style={{ imageRendering: "pixelated" }} />
                      <img src="/Simulation/skills5.png" alt="Skill 5" className="h-5 w-5 rounded-sm border border-white/15" style={{ imageRendering: "pixelated" }} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-white/85">
                  <div>EOA: {agentAInitializing ? renderSetting() : renderAddressLink(agentAEoa)}</div>
                  <div>Smart Account: {agentARegistering ? renderSetting() : renderAddressLink(agentASmartAccount)}</div>
                  <div>Agent Id: {agentARegistering ? renderSetting() : (agentAId ?? "Not set")}</div>
                  <div>Smart USDC: {agentASeeding ? renderSetting() : agentASmartUsdc}</div>
                  <div>Pool Address: {agentARegistering ? renderSetting() : renderAddressLink(agentAPool)}</div>
                  <div>Pool Balance: {agentASeeding ? renderSetting() : `${agentATvl} USDC`}</div>
                  <div>Service Id: {agentAServiceRegistering ? renderSetting() : agentAServiceLabel}</div>
                  <div className="break-all">
                    Service URL: {agentAServiceRegistering ? renderSetting() : (
                      agentAServiceUrl ? (
                        <a href={agentAServiceUrl} target="_blank" rel="noreferrer" className="underline decoration-white/30 hover:decoration-emerald-300">
                          {agentAServiceUrl}
                        </a>
                      ) : "Not set"
                    )}
                  </div>
                </div>
              </div>
              <div className="card-aura card-aura-b rounded-3xl border border-sky-300/30 bg-gradient-to-b from-[#171c34] to-[#121823] p-5 shadow-[0_10px_30px_rgba(0,0,0,0.35)]">
                <div className="mb-3 flex items-center gap-3">
                  <div className="floaty flex h-20 w-20 items-center justify-center rounded-full bg-black/35 ring-2 ring-sky-300/30">
                    {idleFrame("B") ? (
                      <img
                        src={idleFrame("B") ?? ""}
                        alt="Agent B idle"
                        className="h-16 w-16"
                        style={{ imageRendering: "pixelated" }}
                      />
                    ) : (
                      <div className="h-16 w-16 rounded-full bg-sky-500/20" />
                    )}
                  </div>
                  <div>
                    <h3 className="font-display text-lg text-white">Biru (Agent B)</h3>
                    <div className="mt-1 flex items-center gap-1.5">
                      <img src="/Simulation/skills1.png" alt="Skill 1" className="h-5 w-5 rounded-sm border border-white/15" style={{ imageRendering: "pixelated" }} />
                      <img src="/Simulation/skills2.png" alt="Skill 2" className="h-5 w-5 rounded-sm border border-white/15" style={{ imageRendering: "pixelated" }} />
                    </div>
                  </div>
                </div>
                <div className="space-y-1 text-xs text-white/85">
                  <div>EOA: {agentBInitializing ? renderSetting() : renderAddressLink(agentBEoa)}</div>
                  <div>Smart Account: {agentBRegistering ? renderSetting() : renderAddressLink(agentBSmartAccount)}</div>
                  <div>Agent Id: {agentBRegistering ? renderSetting() : (agentBId ?? "Not set")}</div>
                  <div>Smart USDC: {agentBSeeding ? renderSetting() : agentBSmartUsdc}</div>
                  <div>Pool Address: {agentBRegistering ? renderSetting() : renderAddressLink(agentBPool)}</div>
                  <div>Pool Balance: {agentBSeeding ? renderSetting() : `${agentBTvl} USDC`}</div>
                  <div>Service Id: {agentBServiceRegistering ? renderSetting() : agentBServiceLabel}</div>
                  <div className="break-all">
                    Service URL: {agentBServiceRegistering ? renderSetting() : (
                      agentBServiceUrl ? (
                        <a href={agentBServiceUrl} target="_blank" rel="noreferrer" className="underline decoration-white/30 hover:decoration-emerald-300">
                          {agentBServiceUrl}
                        </a>
                      ) : "Not set"
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-6">
            <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
              <h2 className="font-display text-lg">Simulation Controls</h2>
              <div className="mt-3 space-y-2">
                <button onClick={handleInitializeAgents} disabled={isBusy || (agentAReady && agentBReady)} className="sim-btn">
                  {initializingAgents ? (
                    <>
                      {renderControlSpinner()}
                      Initializing Agents...
                    </>
                  ) : agentAReady && agentBReady ? "Agents Initialized" : "Initialize Agents"}
                </button>
                <button
                  onClick={handleRegisterAgents}
                  disabled={isBusy || !agentAReady || !agentBReady || (agentAPoolVisible && agentBPoolVisible)}
                  className="sim-btn"
                >
                  {registeringAgents ? (
                    <>
                      {renderControlSpinner()}
                      Registering Agents...
                    </>
                  ) : agentAPoolVisible && agentBPoolVisible ? "Agents Registered" : "Register at Factory"}
                </button>
                <button onClick={handleSeedPools} disabled={isBusy || !agentAPoolVisible || !agentBPoolVisible} className="sim-btn">
                  {seedingPools ? (
                    <>
                      {renderControlSpinner()}
                      Seeding Pools...
                    </>
                  ) : "Seed Pools"}
                </button>
                <button
                  onClick={handleRegisterServices}
                  disabled={isBusy || !agentAReady || !agentBReady || servicesRegistered}
                  className="sim-btn"
                >
                  {registeringServices ? (
                    <>
                      {renderControlSpinner()}
                      Registering Services...
                    </>
                  ) : servicesRegistered ? "Service Registered" : "Register Service (B)"}
                </button>
                <button
                  onClick={handlePayForServiceB}
                  disabled={isBusy || !agentAPoolVisible || !agentBPoolVisible || !servicesRegistered}
                  className="sim-btn sim-btn-amber"
                >
                  {agentAPayingServiceB ? (
                    <>
                      {renderControlSpinner()}
                      Processing Payment...
                    </>
                  ) : "A Pays for B Service"}
                </button>
                <button onClick={() => callSimStep("reset")} disabled={isBusy} className="sim-btn">
                  Reset Demo
                </button>
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
                      <span className="text-emerald-400/75">[{formatLogTs(log.ts)}]</span> {">"} {renderTxOrAddressText(log.text)}
                    </div>
                  ))
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>

      <style jsx>{`
        .card-aura {
          position: relative;
          overflow: hidden;
        }
        .card-aura::before {
          content: "";
          position: absolute;
          inset: -20%;
          filter: blur(28px);
          opacity: 0.3;
          animation: auraShift 6s ease-in-out infinite;
          pointer-events: none;
        }
        .card-aura-a::before {
          background: radial-gradient(circle at 20% 20%, rgba(251, 146, 60, 0.9), transparent 60%);
        }
        .card-aura-b::before {
          background: radial-gradient(circle at 80% 20%, rgba(56, 189, 248, 0.9), transparent 60%);
        }
        .floaty {
          animation: floaty 3s ease-in-out infinite;
        }
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
        @keyframes auraShift {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(8px, -6px, 0) scale(1.04);
          }
        }
        @keyframes floaty {
          0%,
          100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-5px);
          }
        }
      `}</style>
    </div>
  );
}
