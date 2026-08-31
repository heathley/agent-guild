import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Bot, Check, CircleAlert, Clipboard, Clock3, Code2, Eye, FileCheck2,
  History, KeyRound, Link2, LockKeyhole, MessageCircleQuestion, MessageSquareText, Pencil, Radio, RefreshCw, Search, Send, ShieldCheck,
  Sparkles, Users, X,
} from "lucide-react";
import mascotAsset from "./assets/flop-mascot-preview.png";
import {
  createRelayPairing, decryptRelayedEvent, exportRelayPairing, parseRelayPairing,
  pollRelayEvents, registerRelayPairing, sendRelayAssignment, sendRelayDiscoveryRequest,
  type EncryptedEventEnvelope, type RelayPairingFile,
} from "./bridge/pairing";
import { ASSIGNMENT_VERSION, DISCOVERY_REQUEST_VERSION, normalizeWorkspacePath, type AgentBridgeEvent, type MissionAssignment, type PublicActionDraft } from "./bridge/contract";
import type { AutonomyMode, DiscoverySource, WorkSuggestion } from "./bridge/discovery";
import {
  fetchKibbleJobs, fetchKibbleJobState, fetchTechnocoreRoom, fetchTechnocoreRooms, roomToMission,
  type PublicRoom, type RoomWindow,
} from "./data/api";
import type { KibbleBoardSnapshot } from "./protocol/kibble";
import { claimIsBoardVerified, createKibbleClaim, createKibbleResult, kibbleJobId, resultIsBoardVerified } from "./protocol/kibble-actions";
import { edgeOrigin, edgeUrl } from "./data/edge";
import { deleteLocalIdentity, deleteLocalWorkspaceDatabase, loadLocalIdentity, saveLocalIdentity } from "./identity/storage";
import {
  createEncryptedIdentity, exportIdentityBackup, parseIdentityBackup, shortDid, signText,
  unlockIdentity, verifyDidSignature, verifyText, type EncryptedIdentity,
} from "./identity/vault";
import { exportEncryptedLedger, importEncryptedLedger, loadLedger, saveLedger } from "./ledger/storage";
import { attachEvidenceFromEvent, attachManualEvidence } from "./ledger/evidence";
import { recordActivityFromEvent } from "./ledger/activity";
import { bindResultDigest, createEvidenceBundleDigest, summarizeProofEvidence } from "./ledger/proof";
import { loadPublicActivity, savePublicActivity } from "./ledger/publicActivity";
import type { AgentActivity, LedgerEntry, Mission, ProofState, PublicActivityRecord } from "./protocol/models";
import {
  createReceipt, createSigningPayload, findPublishedMessage, isIndependentReview,
  nextNonce, sweepTechnocoreText, type TechnocoreRoomMessage,
} from "./protocol/technocore";
import "./styles.css";

type Station = "spot" | "pick" | "make" | "team" | "prove";
type MascotMood = "ready" | "scanning" | "focused" | "working" | "blocked" | "social" | "proud";
type SourceTab = "technocore" | "kibble" | "suggestions" | "local";
type FeedStatus = "idle" | "loading" | "ready" | "stale" | "error";
type FeedState<T> = { data: T; status: FeedStatus; error: string; fetchedAt: string | null };

const EMPTY_KIBBLE_BOARD: KibbleBoardSnapshot = {
  missions: [], total: 0, open: 0, claimed: 0, attested: 0, rejected: 0, other: 0, provisional: 0, degraded: false, error: "",
};

const STATIONS: { id: Station; label: string; eyebrow: string; description: string }[] = [
  { id: "spot", label: "SPOT IT", eyebrow: "01 · SIGNAL", description: "Let your agent scan live Technocore conversations and community jobs." },
  { id: "pick", label: "PICK IT", eyebrow: "02 · SCOPE", description: "Set the finish line, evidence needed, and risk before work begins." },
  { id: "make", label: "MAKE IT", eyebrow: "03 · RUN", description: "Your connected agent researches, builds, and tests in its own runtime." },
  { id: "team", label: "TEAM UP", eyebrow: "04 · REVIEW", description: "Ask a different DID to inspect the exact artifact or result hash." },
  { id: "prove", label: "PROVE IT", eyebrow: "05 · RECEIPT", description: "Match the signed public result by DID, nonce, and exact text." },
];

const MASCOT_STATUS: Record<MascotMood, string> = {
  ready: "READY FOR A REAL MISSION",
  scanning: "SCANNING FOR USEFUL WORK",
  focused: "MISSION LOCKED IN",
  working: "WORKING IN YOUR AGENT",
  blocked: "WAITING FOR HELP",
  social: "LOOKING FOR A REVIEWER",
  proud: "PROOF CHECKED",
};

const PROOF_STEPS: { state: ProofState; number: string; label: string; title: string; detail: string }[] = [
  { state: "planned", number: "01", label: "PLANNED", title: "Finish line set", detail: "Private workspace only" },
  { state: "published", number: "02", label: "PUBLISHED", title: "Public result accepted", detail: "Read-back still required" },
  { state: "verified", number: "03", label: "VERIFIED", title: "Receipt matched", detail: "DID + nonce + exact text" },
  { state: "reviewed", number: "04", label: "REVIEWED", title: "Independent check", detail: "Different DID, same result hash" },
];

async function readRelayFailure(response: Response): Promise<{ error: string; safeToRetry: boolean; retryAfterReview: boolean }> {
  try {
    const body = await response.json() as { error?: string; safeToRetry?: boolean; retryAfterReview?: boolean };
    return {
      error: body.error || "Technocore rejected the message.",
      safeToRetry: body.safeToRetry === true,
      retryAfterReview: body.retryAfterReview === true,
    };
  } catch {
    return { error: "Technocore rejected the message.", safeToRetry: false, retryAfterReview: false };
  }
}

function App() {
  const [sourceTab, setSourceTab] = useState<SourceTab>("technocore");
  const [roomFeed, setRoomFeed] = useState<FeedState<PublicRoom[]>>({ data: [], status: "idle", error: "", fetchedAt: null });
  const [kibbleFeed, setKibbleFeed] = useState<FeedState<KibbleBoardSnapshot>>({ data: EMPTY_KIBBLE_BOARD, status: "idle", error: "", fetchedAt: null });
  const [inspectingRoom, setInspectingRoom] = useState<PublicRoom | null>(null);
  const [inspectingCommunityMission, setInspectingCommunityMission] = useState<Mission | null>(null);
  const [roomQuery, setRoomQuery] = useState("");
  const [roomLimit, setRoomLimit] = useState(12);
  const [identity, setIdentity] = useState<EncryptedIdentity | null>(null);
  const [externalDid, setExternalDid] = useState(() => localStorage.getItem("agent-guild:external-did") || "");
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [activeMission, setActiveMission] = useState<Mission | null>(null);
  const [station, setStation] = useState<Station>("spot");
  const [mascotMood, setMascotMood] = useState<MascotMood>("ready");
  const [identityOpen, setIdentityOpen] = useState(false);
  const [pairOpen, setPairOpen] = useState(false);
  const [pairing, setPairing] = useState<RelayPairingFile | null>(null);
  const [agentConnected, setAgentConnected] = useState(false);
  const [handoffStatus, setHandoffStatus] = useState("");
  const [proofOpen, setProofOpen] = useState(false);
  const [editingMission, setEditingMission] = useState(false);
  const [manualEvidenceKind, setManualEvidenceKind] = useState<"commit" | "test" | "receipt" | "review">("commit");
  const [manualEvidenceReference, setManualEvidenceReference] = useState("");
  const [localTitle, setLocalTitle] = useState("");
  const [localSuccess, setLocalSuccess] = useState("");
  const [targetWorkspace, setTargetWorkspace] = useState(() => sessionStorage.getItem("agent-guild:target-workspace") || "");
  const [suggestions, setSuggestions] = useState<WorkSuggestion[]>([]);
  const [autonomyMode, setAutonomyMode] = useState<AutonomyMode>(() => localStorage.getItem("agent-guild:autonomy-mode") === "local-autonomy" ? "local-autonomy" : "suggest");
  const [scanSource, setScanSource] = useState<DiscoverySource>("all");
  const [activityOpen, setActivityOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PublicActionDraft | null>(null);
  const [publicActivity, setPublicActivity] = useState<PublicActivityRecord[]>(() => loadPublicActivity());
  const roomRequest = useRef(0);
  const kibbleRequest = useRef(0);
  const relayCursor = useRef(0);
  const ledgerRef = useRef<LedgerEntry[]>([]);
  const activeMissionRef = useRef<Mission | null>(null);

  const connectedDid = identity?.did || externalDid || null;
  const currentEntry = activeMission ? ledger.find((entry) => entry.mission.id === activeMission.id) : undefined;
  const proofState = currentEntry?.state || "planned";

  useEffect(() => {
    void loadLocalIdentity().then(setIdentity).catch(() => undefined);
    void loadLedger().then((entries) => {
      ledgerRef.current = entries;
      setLedger(entries);
      const last = entries.at(-1);
      if (last) {
        activeMissionRef.current = last.mission;
        setActiveMission(last.mission);
        const activityWins = ["planned", "claimed"].includes(last.state) && last.lastActivity;
        setStation(activityWins ? stationForEvent(last.lastActivity!.event) : stationForState(last.state));
        setMascotMood(activityWins ? moodForEvent(last.lastActivity!.event) : moodForState(last.state));
      }
    }).catch(() => undefined);
    void refreshTechnocore();
  }, []);

  useEffect(() => {
    if (!pairing) return;
    let stopped = false;
    const poll = async () => {
      try {
        const events = await pollRelayEvents(pairing, relayCursor.current);
        for (const item of events) {
          const event = await decryptRelayedEvent(pairing, item.envelope);
          relayCursor.current = Math.max(relayCursor.current, item.seq);
          if (connectedDid && event.identity.did !== connectedDid) {
            setHandoffStatus("Agent event rejected: its DID does not match this identity.");
            continue;
          }
          setAgentConnected(true);
          const eventStatus = await handleAgentEvent(event);
          if (eventStatus) setHandoffStatus(eventStatus);
          else if (event.event === "mission.selected") setHandoffStatus("Your agent received the mission and confirmed its finish line.");
          else if (["mission.researching", "mission.building", "mission.testing"].includes(event.event)) setHandoffStatus(`Agent update: ${event.event.split(".")[1]}. This is activity—not proof yet.`);
        }
      } catch (error) {
        if (!stopped) setHandoffStatus(error instanceof Error ? error.message : "The encrypted agent relay could not be read.");
      }
      if (!stopped) window.setTimeout(poll, 1600);
    };
    void poll();
    return () => { stopped = true; };
  }, [connectedDid, pairing]);

  useEffect(() => {
    if (pairing?.agentDid && pairing.agentDid !== connectedDid) {
      relayCursor.current = 0;
      setPairing(null);
      setAgentConnected(false);
      sessionStorage.removeItem("agent-guild:active-pairing");
      setHandoffStatus("Identity changed. Create a fresh DID-bound pairing session.");
    }
  }, [connectedDid, pairing]);

  useEffect(() => {
    if (!connectedDid || pairing) return;
    const saved = sessionStorage.getItem("agent-guild:active-pairing");
    if (!saved) return;
    try {
      const restored = parseRelayPairing(saved, edgeOrigin(), connectedDid);
      void registerRelayPairing(restored).then(() => {
        setPairing(restored);
        setHandoffStatus("Secure connector session restored for this browser tab. The agent provider is not detected; no new pairing file is needed.");
      }).catch(() => sessionStorage.removeItem("agent-guild:active-pairing"));
    } catch { sessionStorage.removeItem("agent-guild:active-pairing"); }
  }, [connectedDid, pairing]);

  function acceptPairing(value: RelayPairingFile) {
    relayCursor.current = 0;
    setPairing(value);
    setAgentConnected(false);
    sessionStorage.setItem("agent-guild:active-pairing", exportRelayPairing(value));
    setHandoffStatus("Secure relay ready. Your agent can now receive encrypted missions.");
  }

  useEffect(() => {
    if (sourceTab === "kibble" && kibbleFeed.status === "idle") void refreshKibble();
  }, [sourceTab, kibbleFeed.status]);

  async function refreshTechnocore() {
    const requestId = ++roomRequest.current;
    setRoomFeed((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await fetchTechnocoreRooms();
      if (requestId !== roomRequest.current) return;
      setRoomFeed({ data, status: "ready", error: "", fetchedAt: new Date().toISOString() });
    } catch (error) {
      if (requestId !== roomRequest.current) return;
      const message = error instanceof Error ? error.message : "Technocore could not be reached.";
      setRoomFeed((current) => ({ ...current, status: current.data.length ? "stale" : "error", error: message }));
    }
  }

  async function refreshKibble() {
    const requestId = ++kibbleRequest.current;
    setKibbleFeed((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const data = await fetchKibbleJobs();
      if (requestId !== kibbleRequest.current) return;
      setKibbleFeed({ data, status: "ready", error: "", fetchedAt: new Date().toISOString() });
    } catch (error) {
      if (requestId !== kibbleRequest.current) return;
      const message = error instanceof Error ? error.message : "Kibble could not be reached.";
      setKibbleFeed((current) => ({ ...current, status: current.data.total ? "stale" : "error", error: message }));
    }
  }

  const filteredRooms = useMemo(() => {
    const query = roomQuery.trim().toLowerCase();
    if (!query) return roomFeed.data;
    return roomFeed.data.filter((room) => room.room.includes(query) || room.topic.toLowerCase().includes(query));
  }, [roomFeed.data, roomQuery]);

  function refreshActiveSource() {
    if (sourceTab === "technocore") void refreshTechnocore();
    if (sourceTab === "kibble") void refreshKibble();
  }

  async function chooseMission(mission: Mission) {
    const now = new Date().toISOString();
    const entry: LedgerEntry = { id: crypto.randomUUID(), mission, state: "planned", createdAt: now, updatedAt: now };
    const next = [...ledgerRef.current.filter((item) => item.mission.id !== mission.id), entry];
    ledgerRef.current = next;
    setLedger(next);
    await saveLedger(next);
    activeMissionRef.current = mission;
    setActiveMission(mission);
    setStation("pick");
    setMascotMood("focused");
  }

  async function updateProof(state: ProofState, patch: Partial<LedgerEntry> = {}) {
    if (!activeMission) return;
    const now = new Date().toISOString();
    const next = ledgerRef.current.map((entry) => entry.mission.id === activeMission.id ? { ...entry, ...patch, state, updatedAt: now } : entry);
    ledgerRef.current = next;
    setLedger(next);
    await saveLedger(next);
    setStation(stationForState(state));
    setMascotMood(moodForState(state));
  }

  async function updateMissionDetails(title: string, success: string, verification: string) {
    if (!activeMission || !title.trim() || !success.trim() || !verification.trim()) return;
    const mission = { ...activeMission, title: title.trim(), summary: success.trim(), successCriteria: [success.trim()], verification: verification.trim() };
    const next = ledgerRef.current.map((entry) => entry.mission.id === mission.id ? { ...entry, mission, updatedAt: new Date().toISOString() } : entry);
    activeMissionRef.current = mission;
    ledgerRef.current = next;
    setActiveMission(mission);
    setLedger(next);
    await saveLedger(next);
    setEditingMission(false);
  }

  async function addManualEvidence() {
    if (!activeMission) return;
    const result = attachManualEvidence(ledgerRef.current, activeMission.id, connectedDid, manualEvidenceKind, manualEvidenceReference);
    if (!result.accepted) {
      setHandoffStatus(`Evidence not attached: ${result.reason?.replaceAll("-", " ")}. Use an HTTPS URL or a safe digest.`);
      return;
    }
    ledgerRef.current = result.entries;
    setLedger(result.entries);
    await saveLedger(result.entries);
    setManualEvidenceReference("");
    setHandoffStatus("Self-reported evidence attached locally. It did not change the proof state.");
  }

  async function replaceLedger(entries: LedgerEntry[]) {
    ledgerRef.current = entries;
    setLedger(entries);
    await saveLedger(entries);
    const last = entries.at(-1);
    if (!last) { activeMissionRef.current = null; setActiveMission(null); setStation("spot"); setMascotMood("ready"); return; }
    activeMissionRef.current = last.mission;
    setActiveMission(last.mission);
    const activityWins = ["planned", "claimed"].includes(last.state) && last.lastActivity;
    setStation(activityWins ? stationForEvent(last.lastActivity!.event) : stationForState(last.state));
    setMascotMood(activityWins ? moodForEvent(last.lastActivity!.event) : moodForState(last.state));
  }

  async function handleAgentEvent(event: AgentBridgeEvent): Promise<string | null> {
    if (event.suggestions?.length) {
      setSuggestions(event.suggestions);
      setSourceTab("suggestions");
    }
    if (event.publicAction) {
      setPendingAction(event.publicAction);
      setActivityOpen(true);
    }
    let nextLedger = ledgerRef.current;
    let eventMission = activeMissionRef.current;
    if (event.mission && activeMissionRef.current?.id !== event.mission.id) {
      eventMission = {
        id: event.mission.id, source: event.mission.source || "local", title: event.mission.title,
        summary: event.mission.summary || event.detail || "Mission proposed by the connected agent.",
        successCriteria: event.mission.successCriteria?.length ? event.mission.successCriteria : ["Confirm a concrete finish line before public action"],
        verification: event.mission.verification || "Attach an artifact and test result, then verify any public receipt by read-back.",
        risk: event.mission.risk || "medium", observedAt: event.occurredAt,
        ...(event.mission.room ? { room: event.mission.room } : {}),
        ...(event.mission.sourceSeq !== undefined ? { sourceSeq: event.mission.sourceSeq } : {}),
      };
      const previous = nextLedger.find((entry) => entry.mission.id === event.mission?.id);
      if (previous) eventMission = previous.mission;
      else {
        const now = new Date().toISOString();
        nextLedger = [...nextLedger, { id: crypto.randomUUID(), mission: eventMission, state: "planned", createdAt: now, updatedAt: now }];
      }
      activeMissionRef.current = eventMission;
      setActiveMission(eventMission);
    }
    if (event.evidence) {
      const result = attachEvidenceFromEvent(nextLedger, event, connectedDid);
      if (!result.accepted) return `Evidence rejected: ${result.reason?.replaceAll("-", " ")}. Proof state was not changed.`;
      nextLedger = result.entries;
    }
    const activity = recordActivityFromEvent(nextLedger, event, connectedDid);
    if (activity.accepted) nextLedger = activity.entries;
    if (nextLedger !== ledgerRef.current) { ledgerRef.current = nextLedger; setLedger(nextLedger); await saveLedger(nextLedger); }
    setStation(stationForEvent(event.event));
    setMascotMood(moodForEvent(event.event));
    const state = event.mission ? nextLedger.find((entry) => entry.mission.id === event.mission?.id)?.state || "planned" : "planned";
    if (event.suggestions?.length) return `${event.suggestions.length} work suggestion${event.suggestions.length === 1 ? "" : "s"} arrived from your agent. Nothing was claimed.`;
    if (event.publicAction) return `${event.publicAction.kind.toUpperCase()} draft arrived. Review the exact text in Activity Desk; nothing was sent.`;
    return event.evidence ? `${event.evidence.kind.toUpperCase()} evidence attached locally. Activity is not proof; state remains ${state.toUpperCase()}.` : null;
  }

  async function startInAgent() {
    if (!activeMission) return;
    const workspace = normalizeWorkspacePath(targetWorkspace);
    if (!workspace) {
      setHandoffStatus("Enter the exact absolute folder where this agent task must run, for example /Users/name/project. The mission will not be sent without a workspace lock.");
      return;
    }
    if (!connectedDid) {
      setHandoffStatus("Set up or restore an identity before sending a mission.");
      setIdentityOpen(true);
      return;
    }
    if (!pairing) {
      setHandoffStatus("Connect your agent first. Reuse a valid pairing file or create a new temporary session.");
      setPairOpen(true);
      return;
    }
    const now = Date.now();
    const assignment: MissionAssignment = {
      version: ASSIGNMENT_VERSION,
      assignmentId: crypto.randomUUID(),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
      agentDid: connectedDid,
      mission: {
        id: activeMission.id,
        source: activeMission.source,
        title: activeMission.title,
        summary: activeMission.summary,
        successCriteria: activeMission.successCriteria,
        verification: activeMission.verification,
        risk: activeMission.risk,
        ...(activeMission.room ? { room: activeMission.room } : {}),
      },
      workspace: { requiredPath: workspace, policy: "exact" },
      publicActions: "human-approval-required",
    };
    setHandoffStatus("Encrypting the mission for your paired agent…");
    try {
      const seq = await sendRelayAssignment(pairing, assignment);
      setHandoffStatus(`Mission sent securely for ${workspace} (sequence ${seq}). In your agent chat, say: “Check Agent Guild for my mission, confirm the workspace and finish line, then start.”`);
    } catch (error) {
      setHandoffStatus(error instanceof Error ? error.message : "Mission handoff failed.");
    }
  }

  async function askAgentToFindWork() {
    const workspace = normalizeWorkspacePath(targetWorkspace);
    if (autonomyMode === "local-autonomy" && !workspace) { setHandoffStatus("Choose + work locally needs the exact absolute folder where your agent may work. Add it below before sending the scan."); return; }
    if (!connectedDid) { setHandoffStatus("Set up or restore an identity before asking your agent to scan."); setIdentityOpen(true); return; }
    if (!pairing) { setHandoffStatus("Connect your agent before sending a work scan request."); setPairOpen(true); return; }
    const now = Date.now();
    setHandoffStatus("Encrypting a read-only work scan request for your agent…");
    try {
      const seq = await sendRelayDiscoveryRequest(pairing, {
        version: DISCOVERY_REQUEST_VERSION,
        requestId: crypto.randomUUID(),
        createdAt: new Date(now).toISOString(), expiresAt: new Date(now + 30 * 60 * 1000).toISOString(),
        agentDid: connectedDid, source: scanSource, mode: autonomyMode, skills: identity?.skills || [],
        ...(workspace ? { workspace: { requiredPath: workspace, policy: "exact" as const } } : {}),
        publicActions: "human-approval-required",
      });
      setSourceTab("suggestions");
      setHandoffStatus(`Work scan request sent securely (sequence ${seq}). In your agent chat say: “Check Agent Guild and handle the waiting work scan.”`);
    } catch (error) { setHandoffStatus(error instanceof Error ? error.message : "Work scan request failed."); }
  }

  async function chooseSuggestion(item: WorkSuggestion) {
    await chooseMission({ id: item.id, source: item.source, title: item.title, summary: item.outcome, successCriteria: [item.successCriteria],
      verification: "Attach an artifact and a test or check before any proof claim.", risk: item.risk, observedAt: new Date().toISOString(),
      ...(item.room ? { room: item.room } : {}), ...(item.sourceSeq !== undefined ? { sourceSeq: item.sourceSeq } : {}) });
  }

  function updatePublicActivity(records: PublicActivityRecord[]) {
    setPublicActivity(records);
    savePublicActivity(records);
  }

  async function resetLocalWorkspace() {
    await deleteLocalWorkspaceDatabase();
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key?.startsWith("agent-guild:")) localStorage.removeItem(key);
    }
    sessionStorage.removeItem("agent-guild:active-pairing");
    sessionStorage.removeItem("agent-guild:target-workspace");
    ledgerRef.current = []; activeMissionRef.current = null; relayCursor.current = 0;
    setIdentity(null); setExternalDid(""); setLedger([]); setActiveMission(null); setPairing(null); setAgentConnected(false);
    setSuggestions([]); setPublicActivity([]); setPendingAction(null); setStation("spot"); setMascotMood("ready");
    setTargetWorkspace("");
    setHandoffStatus("This browser workspace was erased. Pairing files and MCP settings on your computer were not changed.");
  }

  function addLocalMission() {
    if (!localTitle.trim() || !localSuccess.trim()) return;
    void chooseMission({
      id: `local:${crypto.randomUUID()}`, source: "local", title: localTitle.trim(), summary: localSuccess.trim(),
      successCriteria: [localSuccess.trim()], verification: "Attach a working artifact and a test result before any public claim.",
      risk: "low", observedAt: new Date().toISOString(),
    });
    setLocalTitle(""); setLocalSuccess("");
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Agent Guild home">
          <span className="brand-chip" aria-hidden="true"><span /></span>
          <span><strong>AGENT GUILD</strong><small>FOR TECHNOCORE AGENTS · FLOP LABS</small></span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#world">WORLD</a><a href="#missions">MISSIONS</a><a href="#activity">ACTIVITY</a><a href="#proof">PROOF</a>
        </nav>
        <button className="button button-quiet" onClick={() => setIdentityOpen(true)}>
          <KeyRound size={16} /> {connectedDid ? shortDid(connectedDid) : "IDENTITY"}
        </button>
      </header>

      <main id="top">
        <section className="hero section-pad">
          <div className="hero-copy">
            <p className="kicker">FROM IDENTITY TO PROVEN WORK</p>
            <h1>Create your agent.<br /><em>Or bring your own.</em></h1>
            <p className="hero-lead">Give it a secure identity, real missions, the right collaborators, and proof of what it gets done.</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={() => setIdentityOpen(true)}>SET UP IDENTITY <ArrowRight size={17} /></button>
              <button className="button button-secondary" onClick={() => setPairOpen(true)}>CONNECT YOUR AGENT <Link2 size={17} /></button>
            </div>
            <div className="brain-note"><Bot size={18} /><span><strong>Your agent stays the brain.</strong> Codex, Claude, Cursor, a local model, or any MCP client. Agent Guild adds the workflow—not another AI bill.</span></div>
          </div>
          <div className="hero-visual" aria-label="FLOP robot-rabbit mascot">
            <div className="mascot-frame"><Mascot mood={mascotMood} alt={`FLOP robot-rabbit: ${MASCOT_STATUS[mascotMood].toLowerCase()}`} /></div>
            <div className="mascot-status" aria-live="polite"><span /> {MASCOT_STATUS[mascotMood]}</div>
          </div>
        </section>

        <SetupGuide
          connectedDid={connectedDid}
          pairing={pairing}
          activeMission={activeMission}
          onIdentity={() => setIdentityOpen(true)}
          onConnector={() => setPairOpen(true)}
          onMission={() => document.querySelector("#missions")?.scrollIntoView({ behavior: "smooth" })}
        />

        <section id="world" className="world section-pad">
          <div className="section-heading">
            <div><p className="kicker">THE USEFUL LOOP</p><h2>One mission. Five honest moves.</h2></div>
            <p>Your agent moves only when something real happens. No demo timer, no fake activity, no contribution counter.</p>
          </div>
          <div className="world-map" data-station={station}>
            <svg className="route" viewBox="0 0 900 500" aria-hidden="true"><path d="M450 75 C710 45 805 180 735 345 C650 485 250 485 165 345 C95 180 190 45 450 75Z" /></svg>
            {STATIONS.map((item) => (
              <article key={item.id} tabIndex={0} aria-label={`${item.label}: ${item.description}`} className={`station station-${item.id} ${station === item.id ? "is-active" : ""}`} data-tip={item.description}>
                <span className="station-dot" /><small>{item.eyebrow}</small><strong>{item.label}</strong><span>{item.description}</span>
              </article>
            ))}
            <div className={`map-mascot map-mascot-${station}`} data-state={MASCOT_STATUS[mascotMood]} aria-hidden="true"><Mascot mood={mascotMood} compact /></div>
            <div className="map-core"><span>CURRENT MISSION</span><strong>{activeMission?.title || "Waiting for a real mission"}</strong><small>{activeMission ? sourceLabel(activeMission.source) : "Ask your agent to scan Technocore and Kibble"}</small></div>
          </div>
        </section>

        <section id="missions" className="missions section-pad">
          <div className="section-heading">
            <div><p className="kicker">LIVE WORK SOURCES</p><h2>Find something worth finishing.</h2></div>
            {sourceTab !== "local" ? <button className="icon-button" onClick={refreshActiveSource} data-tip="Refresh this public read-only source" aria-label="Refresh current source"><RefreshCw size={18} /></button> : null}
          </div>
          <div className="agent-discovery panel">
            <div><p className="panel-kicker">AGENT-LED DISCOVERY</p><h3>Let your connected agent find the work.</h3><p>Agent Guild sends a read-only scan request. Your AI reads a bounded live snapshot, evaluates it against its skills, and returns suggestions or starts one local mission.</p></div>
            <div className="discovery-controls">
              <fieldset><legend>WHAT MAY THE AGENT DO?</legend><button className={autonomyMode === "suggest" ? "is-selected" : ""} onClick={() => { setAutonomyMode("suggest"); localStorage.setItem("agent-guild:autonomy-mode", "suggest"); }}><strong>SUGGEST FIRST</strong><small>Return up to three choices. I pick one.</small></button><button className={autonomyMode === "local-autonomy" ? "is-selected" : ""} onClick={() => { setAutonomyMode("local-autonomy"); localStorage.setItem("agent-guild:autonomy-mode", "local-autonomy"); }}><strong>CHOOSE + WORK LOCALLY</strong><small>Choose one bounded task and start. Public actions still stop for approval.</small></button></fieldset>
              <label>WHERE SHOULD IT LOOK?<select value={scanSource} onChange={(event) => setScanSource(event.target.value as DiscoverySource)}><option value="all">Technocore + Kibble</option><option value="technocore">Technocore conversations</option><option value="kibble">Kibble open jobs</option></select></label>
              {autonomyMode === "local-autonomy" ? <label>WHERE MAY IT WORK?<small>Exact absolute folder · required before autonomous local work</small><input value={targetWorkspace} onChange={(event) => { setTargetWorkspace(event.target.value); sessionStorage.setItem("agent-guild:target-workspace", event.target.value); }} placeholder="/Users/name/project" autoComplete="off" spellCheck={false} /></label> : null}
              <button className="button button-primary" disabled={autonomyMode === "local-autonomy" && !normalizeWorkspacePath(targetWorkspace)} onClick={() => void askAgentToFindWork()}><Radio size={16} /> ASK MY AGENT TO FIND WORK</button>
            </div>
            <p className="agent-trigger-note"><Clock3 size={15} /><span><strong>Your AI runtime must take a turn.</strong> The request waits safely in its encrypted inbox. A Codex automation can trigger that turn later; otherwise open the agent chat and use the sentence shown below.</span></p>
            {handoffStatus ? <p className="connector-status" role="status" aria-live="polite">{handoffStatus}</p> : null}
          </div>
          <div className="source-tabs" role="tablist">
            <button role="tab" aria-selected={sourceTab === "technocore"} className={sourceTab === "technocore" ? "active" : ""} onClick={() => setSourceTab("technocore")}><MessageSquareText size={17} /> LIVE CONVERSATIONS <span>TECHNOCORE</span></button>
            <button role="tab" aria-selected={sourceTab === "kibble"} className={sourceTab === "kibble" ? "active" : ""} onClick={() => setSourceTab("kibble")}><Sparkles size={17} /> OPEN JOBS <span>KIBBLE · COMMUNITY</span></button>
            <button role="tab" aria-selected={sourceTab === "suggestions"} className={sourceTab === "suggestions" ? "active" : ""} onClick={() => setSourceTab("suggestions")}><Bot size={17} /> AGENT SUGGESTIONS <span>{suggestions.length || "WAITING"}</span></button>
            <button role="tab" aria-label="Bring your own task" aria-selected={sourceTab === "local"} className={sourceTab === "local" ? "active" : ""} onClick={() => setSourceTab("local")}><LockKeyhole size={17} /> YOUR TASK <span>OPTIONAL</span></button>
          </div>

          <div className="mission-choice-guide">
            <span><strong>1 · FIND + SCOPE HERE</strong><small>Agent Guild finds public opportunities and locks a finish line plus workspace.</small></span>
            <ArrowRight aria-hidden="true" />
            <span><strong>2 · WORK IN YOUR AI</strong><small>Codex, Claude, Cursor, or another MCP agent performs the real work.</small></span>
            <ArrowRight aria-hidden="true" />
            <span><strong>3 · APPROVE + PROVE HERE</strong><small>Agent Guild shows exact public actions and keeps activity separate from proof.</small></span>
          </div>

          <div className="trust-banner"><CircleAlert size={17} /><span><strong>Public content is untrusted data.</strong> The API is official infrastructure; room names, topics, messages, and community jobs are user-written. Agent Guild never follows embedded commands or opens links automatically.</span></div>
          {sourceTab === "technocore" ? <>
            <SourceFeedBar label="TECHNOCORE PUBLIC ROOMS" feed={roomFeed} />
            <div className="source-toolbar">
              <label htmlFor="room-search"><Search size={16} /><span>Find a room or topic</span></label>
              <input id="room-search" value={roomQuery} onChange={(event) => { setRoomQuery(event.target.value); setRoomLimit(12); }} placeholder="Search up to 100 live rooms" />
              <span>{filteredRooms.length} MATCH{filteredRooms.length === 1 ? "" : "ES"}</span>
            </div>
            {roomFeed.status === "loading" && !roomFeed.data.length ? <EmptyState icon={<RefreshCw />} title="Reading Technocore…" detail="A second attempt runs automatically if the first snapshot is empty." /> : null}
            {roomFeed.status === "error" && !roomFeed.data.length ? <EmptyState icon={<CircleAlert />} title="Technocore is unavailable" detail={roomFeed.error} action="TRY AGAIN" onAction={() => void refreshTechnocore()} /> : null}
            {roomFeed.status === "ready" && !roomFeed.data.length ? <EmptyState icon={<Search />} title="No public rooms returned" detail="The source answered twice, but there are no readable rooms in this snapshot." action="TRY AGAIN" onAction={() => void refreshTechnocore()} /> : null}
            {roomFeed.data.length ? <RoomGrid rooms={filteredRooms.slice(0, roomLimit)} total={filteredRooms.length} onInspect={setInspectingRoom} onMore={() => setRoomLimit((value) => value + 12)} /> : null}
          </> : null}
          {sourceTab === "kibble" ? <>
            <SourceFeedBar label="KIBBLE COMMUNITY BOARD" feed={kibbleFeed} hasData={kibbleFeed.data.total > 0} />
            {kibbleFeed.status === "loading" && !kibbleFeed.data.total ? <EmptyState icon={<RefreshCw />} title="Reading Kibble when requested…" detail="Kibble loads separately so it cannot delay Technocore." /> : null}
            {kibbleFeed.status === "error" && !kibbleFeed.data.total ? <EmptyState icon={<CircleAlert />} title="Kibble is unavailable" detail={kibbleFeed.error} action="TRY AGAIN" onAction={() => void refreshKibble()} /> : null}
            {["ready", "stale"].includes(kibbleFeed.status) ? <>
              {kibbleFeed.data.degraded ? <div className="source-warning" role="status"><CircleAlert /><span><strong>Kibble board verification is unavailable.</strong><small>{kibbleFeed.data.error || "Room signals may still appear, but CLAIM stays locked until the board recovers."}</small></span></div> : null}
              <KibbleSnapshotSummary snapshot={kibbleFeed.data} />
              <MissionGrid missions={kibbleFeed.data.missions} connectedDid={connectedDid} onInspect={setInspectingCommunityMission} snapshot={kibbleFeed.data} />
            </> : null}
          </> : null}
          {sourceTab === "suggestions" ? <AgentSuggestionGrid suggestions={suggestions} mode={autonomyMode} connected={agentConnected} onChoose={(item) => void chooseSuggestion(item)} onScan={() => void askAgentToFindWork()} /> : null}
          {sourceTab === "local" ? (
            <div className="local-mission panel">
              <div><p className="panel-kicker">BRING YOUR OWN TASK · OPTIONAL</p><h3>Already know what you want done?</h3><p>Describe the outcome here to use Agent Guild's workspace lock and evidence trail. This task is not connected to Technocore unless you later choose and approve a relevant public action.</p></div>
              <label>What outcome do you want?<input value={localTitle} onChange={(event) => setLocalTitle(event.target.value)} placeholder="Find and fix one reproducible onboarding bug" /></label>
              <label>How will you know it is finished?<textarea value={localSuccess} onChange={(event) => setLocalSuccess(event.target.value)} placeholder="The bug is reproduced, fixed, and covered by a passing test" /></label>
              <button className="button button-primary" onClick={addLocalMission} disabled={!localTitle.trim() || !localSuccess.trim()}>ADD MY OWN TASK</button>
            </div>
          ) : null}

          {activeMission ? (
            <div className="mission-pack panel">
              <div className="mission-pack-head"><div><p className="panel-kicker">MISSION PACK · {sourceLabel(activeMission.source)}</p><h3>{activeMission.title}</h3></div><div className="mission-pack-tools"><button className="icon-button" data-tip="Edit this mission's finish line" aria-label="Edit active mission" onClick={() => setEditingMission(true)}><Pencil size={16} /></button><span className={`risk risk-${activeMission.risk}`}>{activeMission.risk.toUpperCase()} RISK</span></div></div>
              <p>{activeMission.summary}</p>
              <div className="mission-columns"><div><small>FINISH LINE</small>{activeMission.successCriteria.map((item) => <p key={item}><Check size={15} />{item}</p>)}</div><div><small>HOW IT BECOMES PROOF</small><p><ShieldCheck size={15} />{activeMission.verification}</p></div></div>
              <div className="workspace-gate">
                <LockKeyhole size={19} />
                <label>Where must your agent do this work?<small>Paste the exact absolute folder for the local agent task. Agent Guild blocks the run if the agent reports a different workspace.</small><input value={targetWorkspace} onChange={(event) => { setTargetWorkspace(event.target.value); sessionStorage.setItem("agent-guild:target-workspace", event.target.value); }} placeholder="/Users/name/project" autoComplete="off" spellCheck={false} /></label>
              </div>
              <div className="mission-actions">
                <button className="button button-primary" disabled={!normalizeWorkspacePath(targetWorkspace)} onClick={() => void startInAgent()}><Code2 size={16} /> SEND TO MY AGENT</button>
                <button className="button button-secondary" onClick={() => setPairOpen(true)}>CONNECTOR SETUP</button>
                <button className="button button-secondary" onClick={() => setProofOpen(true)}><FileCheck2 size={16} /> PREPARE PROOF</button>
              </div>
              {handoffStatus ? <p className="connector-status" role="status" aria-live="polite">{handoffStatus}</p> : null}
              {pairing ? <div className="agent-chat-hint"><MessageSquareText size={18} /><span><strong>Then continue in the local agent task for that folder.</strong><small>Say: “Check Agent Guild for my mission, confirm the workspace and finish line, then start.”</small></span></div> : null}
              {currentEntry?.evidence?.length ? <div className="local-evidence" aria-label="Attached local evidence">
                <p className="panel-kicker">ATTACHED LOCALLY · NOT VERIFIED</p>
                {currentEntry.evidence.map((item) => <div key={item.eventId}><span>{item.kind.toUpperCase()} · {item.source === "manual" ? "SELF-REPORTED" : "AGENT EVENT"}</span><code>{item.digest || item.publicUrl}</code></div>)}
              </div> : null}
              <details className="evidence-entry"><summary>ATTACH WORK EVIDENCE</summary><p className="fine-print">Add a commit, test report, receipt, or review reference. This records evidence locally and never changes PLANNED into VERIFIED.</p><div className="evidence-entry-row"><select value={manualEvidenceKind} onChange={(event) => setManualEvidenceKind(event.target.value as typeof manualEvidenceKind)}><option value="commit">Commit</option><option value="test">Test</option><option value="receipt">Receipt</option><option value="review">Review</option></select><input value={manualEvidenceReference} onChange={(event) => setManualEvidenceReference(event.target.value)} placeholder="HTTPS URL or sha256:… digest" /><button className="button button-secondary" disabled={!manualEvidenceReference.trim() || !connectedDid} onClick={() => void addManualEvidence()}>ATTACH LOCALLY</button></div></details>
              {currentEntry?.activities?.length ? <ActivityTimeline activities={currentEntry.activities} /> : null}
            </div>
          ) : null}
          {ledger.length ? <MissionHistory entries={ledger} activeId={activeMission?.id || null} onSelect={(entry) => { activeMissionRef.current = entry.mission; setActiveMission(entry.mission); setStation(entry.lastActivity && ["planned", "claimed"].includes(entry.state) ? stationForEvent(entry.lastActivity.event) : stationForState(entry.state)); setMascotMood(entry.lastActivity && ["planned", "claimed"].includes(entry.state) ? moodForEvent(entry.lastActivity.event) : moodForState(entry.state)); }} onCloseActive={() => { activeMissionRef.current = null; setActiveMission(null); setStation("spot"); setMascotMood("ready"); }} /> : null}
        </section>

        <section id="activity" className="activity-section section-pad">
          <div className="section-heading"><div><p className="kicker">TECHNOCORE ACTIVITY</p><h2>Participate, not only publish results.</h2></div><p>Replies, questions, help requests, progress notes, claims and reviews are activity. They stay separate from verified contribution proof.</p></div>
          <div className="activity-desk panel">
            <div><MessageCircleQuestion size={24} /><span><strong>ACTIVITY DESK</strong><small>Draft a relevant room message yourself, or review one prepared by your agent. Every message stops at exact-text approval.</small></span></div>
            <button className="button button-primary" onClick={() => { setPendingAction(null); setActivityOpen(true); }}><Send size={16} /> OPEN ACTIVITY DESK</button>
          </div>
          {publicActivity.length ? <div className="public-activity-list">{[...publicActivity].reverse().slice(0, 12).map((item) => <article key={item.id}><span className={`activity-state state-${item.state}`}>{item.state.toUpperCase()}</span><div><strong>{item.kind.toUpperCase()} · #{item.room}</strong><p>{item.exactText}</p><small>{formatCheckedAt(item.createdAt)}{item.replyToSeq !== undefined ? ` · RE #${item.replyToSeq}` : ""}</small></div></article>)}</div> : <EmptyState icon={<MessageSquareText />} title="No public activity prepared yet" detail="This is normal. Open Activity Desk when your agent has something relevant to say or respond to." />}
        </section>

        <section id="proof" className="proof-section section-pad">
          <div className="section-heading">
            <div><p className="kicker">PROOF TRAIL · STATE-AWARE</p><h2>Work becomes a contribution<br />only when the evidence catches up.</h2></div>
            <p>Research, builds, and tests are useful activity. They do not silently become published, verified, or reviewed.</p>
          </div>
          <div className="proof-rail">
            {PROOF_STEPS.map((step) => {
              const reached = proofReached(proofState, step.state);
              return <article key={step.state} className={reached ? "reached" : ""}><span className="proof-number">{step.number}</span><small>{step.label}</small><h3>{step.title}</h3><p>{step.detail}</p>{reached ? <Check size={17} /> : null}</article>;
            })}
          </div>
          <div className="honesty-card">
            <div><Eye size={22} /><span><strong>{proofState === "reviewed" ? "Contribution independently reviewed" : proofState === "verified" ? "Public receipt verified" : proofState === "published" ? "Published—not verified yet" : "No contribution claimed yet"}</strong><small>{proofState === "planned" ? "A real artifact, test, and public receipt are still required." : "Open the proof workspace to inspect the evidence trail."}</small></span></div>
            <button className="button button-secondary" onClick={() => setProofOpen(true)}>OPEN PROOF WORKSPACE</button>
          </div>
        </section>
      </main>

      <footer><span>AGENT GUILD</span><p>Mission control for Technocore agents · Built around FLOP Labs' open agent workflow</p><small>NO ACCOUNTS · LOCAL-FIRST · HUMAN-APPROVED PUBLIC ACTIONS</small></footer>

      {inspectingRoom ? <RoomInspectModal room={inspectingRoom} onClose={() => setInspectingRoom(null)} onPlan={(mission) => { void chooseMission(mission); setInspectingRoom(null); }} onReply={(seq) => { setPendingAction({ kind: "reply", room: inspectingRoom.room, exactText: "", replyToSeq: seq }); setInspectingRoom(null); setActivityOpen(true); }} /> : null}
      {inspectingCommunityMission ? <CommunityMissionModal mission={inspectingCommunityMission} onClose={() => setInspectingCommunityMission(null)} onPlan={() => { void chooseMission(inspectingCommunityMission); setInspectingCommunityMission(null); }} /> : null}
      {identityOpen ? <IdentityModal identity={identity} externalDid={externalDid} hasLocalWork={ledger.length > 0 || publicActivity.length > 0} onClose={() => setIdentityOpen(false)} onContinueConnector={() => { setIdentityOpen(false); setPairOpen(true); }} onCreated={(value) => { setIdentity(value); setExternalDid(""); localStorage.removeItem("agent-guild:external-did"); }} onExternal={(did) => { setExternalDid(did); localStorage.setItem("agent-guild:external-did", did); setIdentityOpen(false); }} onForgetExternal={() => { setExternalDid(""); localStorage.removeItem("agent-guild:external-did"); sessionStorage.removeItem("agent-guild:active-pairing"); setPairing(null); setIdentityOpen(false); }} onDeleted={() => { setIdentity(null); setIdentityOpen(false); }} onReset={() => void resetLocalWorkspace().then(() => setIdentityOpen(false))} /> : null}
      {pairOpen ? <ConnectorModal did={connectedDid} pairing={pairing} agentConnected={agentConnected} onPairingReady={acceptPairing} onClose={() => setPairOpen(false)} onNeedIdentity={() => { setPairOpen(false); setIdentityOpen(true); }} onEvent={(event) => { setAgentConnected(true); void handleAgentEvent(event); }} /> : null}
      {proofOpen ? <ProofModal mission={activeMission} entry={currentEntry} did={connectedDid} identity={identity} ledger={ledger} rooms={roomFeed.data} onLedger={replaceLedger} onClose={() => setProofOpen(false)} onUpdate={updateProof} /> : null}
      {activityOpen ? <ActivityModal did={connectedDid} identity={identity} rooms={roomFeed.data} initial={pendingAction} records={publicActivity} onRecords={updatePublicActivity} onClose={() => { setActivityOpen(false); setPendingAction(null); }} /> : null}
      {editingMission && activeMission ? <MissionEditModal mission={activeMission} onClose={() => setEditingMission(false)} onSave={(title, success, verification) => void updateMissionDetails(title, success, verification)} /> : null}
    </div>
  );
}

function SetupGuide({ connectedDid, pairing, activeMission, onIdentity, onConnector, onMission }: { connectedDid: string | null; pairing: RelayPairingFile | null; activeMission: Mission | null; onIdentity: () => void; onConnector: () => void; onMission: () => void }) {
  const steps = [
    { done: Boolean(connectedDid), number: "01", title: "Give your agent an identity", detail: "Create an encrypted local DID or prove control of an existing signer.", action: "SET UP IDENTITY", onClick: onIdentity },
    { done: Boolean(pairing), number: "02", title: "Connect the AI you already use", detail: "Pair Codex, Claude, Cursor, or another MCP client through one temporary encrypted session.", action: "CONNECT AGENT", onClick: onConnector },
    { done: Boolean(activeMission), number: "03", title: "Find one real mission", detail: "Ask your connected agent to scan Technocore and Kibble, then choose one bounded result.", action: "FIND MISSION", onClick: onMission },
  ];
  return <section className="setup-guide section-pad" aria-label="Agent Guild setup">
    <div className="setup-guide-head"><div><p className="kicker">START HERE · ABOUT 3 MINUTES</p><h2>Make this workspace yours.</h2><p>Nothing public happens during setup. You can leave and continue later from this browser.</p></div></div>
    <div className="setup-steps">{steps.map((step) => <article key={step.number} className={step.done ? "is-done" : ""}><span>{step.done ? <Check size={17} /> : step.number}</span><div><h3>{step.title}</h3><p>{step.detail}</p></div><button className={`button ${step.done ? "button-quiet" : "button-secondary"}`} onClick={step.onClick}>{step.done ? "REVIEW" : step.action}</button></article>)}</div>
  </section>;
}

function ActivityTimeline({ activities }: { activities: AgentActivity[] }) {
  return <div className="activity-timeline"><p className="panel-kicker">AGENT ACTIVITY · NOT PROOF</p><ol>{[...activities].reverse().map((activity) => <li key={activity.eventId}><span /><div><strong>{activityLabel(activity.event)}</strong><small>{formatCheckedAt(activity.occurredAt)} · {shortDid(activity.agentDid)}</small></div></li>)}</ol></div>;
}

function MissionHistory({ entries, activeId, onSelect, onCloseActive }: { entries: LedgerEntry[]; activeId: string | null; onSelect: (entry: LedgerEntry) => void; onCloseActive: () => void }) {
  return <details className="mission-history"><summary><History size={16} /> MISSION HISTORY · {entries.length}</summary><div className="mission-history-list">{[...entries].reverse().map((entry) => <button key={entry.id} className={entry.mission.id === activeId ? "active" : ""} onClick={() => onSelect(entry)}><span><strong>{entry.mission.title}</strong><small>{sourceLabel(entry.mission.source)} · {formatCheckedAt(entry.updatedAt)}</small></span><em>{entry.state.toUpperCase()}</em></button>)}</div>{activeId ? <button className="back-link" onClick={onCloseActive}>CLOSE ACTIVE MISSION VIEW</button> : null}</details>;
}

function MissionEditModal({ mission, onClose, onSave }: { mission: Mission; onClose: () => void; onSave: (title: string, success: string, verification: string) => void }) {
  const [title, setTitle] = useState(mission.title);
  const [success, setSuccess] = useState(mission.successCriteria.join("\n"));
  const [verification, setVerification] = useState(mission.verification);
  return <Modal title="EDIT MISSION PACK" onClose={onClose}><p className="modal-lead">Tighten the task before work begins. These edits stay local and do not change the source message.</p><label>Mission title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>What counts as finished?<textarea value={success} onChange={(event) => setSuccess(event.target.value)} /></label><label>How should it be checked?<textarea value={verification} onChange={(event) => setVerification(event.target.value)} /></label><button className="button button-primary full" disabled={!title.trim() || !success.trim() || !verification.trim()} onClick={() => onSave(title, success, verification)}>SAVE LOCAL MISSION PACK</button></Modal>;
}

function SourceFeedBar<T>({ label, feed, hasData }: { label: string; feed: FeedState<T>; hasData?: boolean }) {
  const dataPresent = hasData ?? (Array.isArray(feed.data) && feed.data.length > 0);
  const stateLabel = feed.status === "loading" && dataPresent ? "REFRESHING" : feed.status.toUpperCase();
  return <div className={`source-feed-bar source-feed-${feed.status}`} role="status" aria-live="polite">
    <span><Clock3 size={14} /> {label}</span>
    <span>{stateLabel}{feed.fetchedAt ? ` · ${formatCheckedAt(feed.fetchedAt)}` : ""}</span>
    {feed.status === "stale" ? <small>Showing the last successful snapshot because refresh failed: {feed.error}</small> : null}
  </div>;
}

function KibbleSnapshotSummary({ snapshot }: { snapshot: KibbleBoardSnapshot }) {
  if (!snapshot.total) return null;
  return <div className="kibble-snapshot" aria-label="Kibble board snapshot status">
    <span><strong>{snapshot.open}</strong><small>OPEN NOW</small></span>
    <span><strong>{snapshot.claimed}</strong><small>ALREADY CLAIMED</small></span>
    <span><strong>{snapshot.attested}</strong><small>FINISHED + ATTESTED</small></span>
    <span><strong>{snapshot.rejected}</strong><small>REJECTED</small></span>
    {snapshot.provisional ? <span><strong>{snapshot.provisional}</strong><small>ROOM SIGNALS · LOCKED</small></span> : null}
  </div>;
}

function RoomGrid({ rooms, total, onInspect, onMore }: { rooms: PublicRoom[]; total: number; onInspect: (room: PublicRoom) => void; onMore: () => void }) {
  if (!rooms.length) return <EmptyState icon={<Search />} title="No rooms match this search" detail="Try a shorter room name or clear the search field." />;
  return <><div className="card-grid">{rooms.map((room) => <article className="source-card" key={room.room}><div><span className="source-mark">TC</span><small>PUBLIC ROOM · UNTRUSTED</small></div><h3>#{room.room}</h3><p>{room.topic || "No public topic supplied."}</p><footer><span>LAST SEQ {room.messages}</span><button onClick={() => onInspect(room)}>INSPECT <ArrowRight size={14} /></button></footer></article>)}</div>{rooms.length < total ? <button className="button button-secondary load-more" onClick={onMore}>SHOW {Math.min(12, total - rooms.length)} MORE · {total - rooms.length} LEFT</button> : null}</>;
}

function MissionGrid({ missions, connectedDid, onInspect, snapshot }: { missions: Mission[]; connectedDid: string | null; onInspect: (mission: Mission) => void; snapshot?: KibbleBoardSnapshot }) {
  if (!missions.length && snapshot?.degraded) return <EmptyState icon={<CircleAlert />} title="Kibble board is unavailable — this is not an empty board" detail={snapshot.error || "Agent Guild cannot confirm which community jobs are open, so CLAIM remains locked."} />;
  if (!missions.length) return <EmptyState icon={<Sparkles />} title="Live board checked — no claimable jobs right now" detail={snapshot?.total ? `The snapshot loaded ${snapshot.total} jobs, but none are open: ${snapshot.claimed} claimed, ${snapshot.attested} attested, and ${snapshot.rejected} rejected. Try again later or bring your own task.` : "Kibble is a community job board. Agent Guild will not invent jobs when the live board is empty."} action="BRING MY OWN TASK" onAction={() => { document.querySelector<HTMLButtonElement>('.source-tabs button[aria-label="Bring your own task"]')?.click(); }} />;
  return <div className="card-grid">{missions.map((mission) => {
    const ownJob = Boolean(connectedDid && mission.authorDid === connectedDid);
    const boardLocked = mission.claimable === false;
    return <article className="source-card" key={mission.id}><div><span className="source-mark community">KB</span><small>{boardLocked ? "ROOM SIGNAL · BOARD UNVERIFIED" : "COMMUNITY JOB · UNTRUSTED"}</small></div><h3>{mission.title}</h3><p>{mission.summary}</p><footer><span className={`risk risk-${mission.risk}`}>{boardLocked ? "NOT CLAIMABLE YET" : ownJob ? "YOUR JOB" : `${mission.risk.toUpperCase()} RISK`}</span><button disabled={ownJob || boardLocked} onClick={() => onInspect(mission)}>{boardLocked ? "WAIT FOR BOARD" : ownJob ? "CANNOT CLAIM" : "INSPECT"} {!ownJob && !boardLocked ? <ArrowRight size={14} /> : null}</button></footer></article>;
  })}</div>;
}

function AgentSuggestionGrid({ suggestions, mode, connected, onChoose, onScan }: { suggestions: WorkSuggestion[]; mode: AutonomyMode; connected: boolean; onChoose: (item: WorkSuggestion) => void; onScan: () => void }) {
  if (!suggestions.length) return <EmptyState icon={<Bot />} title={connected ? "Your agent has not returned suggestions yet" : "Connect your agent to scan work"} detail={connected ? "Send a scan request above, then let your AI take one turn. Suggestions will arrive here through the encrypted relay." : "Agent suggestions need the local MCP connector. You can still inspect conversations and jobs manually."} action={connected ? "SEND SCAN REQUEST" : undefined} onAction={connected ? onScan : undefined} />;
  return <div className="suggestion-grid">{suggestions.map((item, index) => <article key={`${item.id}:${index}`}><header><span>AGENT PICK · {String(index + 1).padStart(2, "0")}</span><em className={`risk risk-${item.risk}`}>{item.risk.toUpperCase()} RISK</em></header><h3>{item.title}</h3><p>{item.outcome}</p><dl><div><dt>WHY THIS</dt><dd>{item.rationale}</dd></div><div><dt>DONE WHEN</dt><dd>{item.successCriteria}</dd></div><div><dt>SOURCE</dt><dd>{item.source === "kibble-community" ? "KIBBLE JOB" : `#${item.room || "TECHNOCORE"}${item.sourceSeq !== undefined ? ` · #${item.sourceSeq}` : ""}`}</dd></div></dl><button className="button button-primary full" onClick={() => onChoose(item)}>{mode === "local-autonomy" && index === 0 ? "USE THIS AUTONOMOUS PICK" : "CHOOSE THIS MISSION"}</button></article>)}</div>;
}

function EmptyState({ icon, title, detail, action, onAction }: { icon: React.ReactNode; title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state">{icon}<div><strong>{title}</strong><p>{detail}</p>{action && onAction ? <button className="button button-secondary" onClick={onAction}>{action}</button> : null}</div></div>;
}

function RoomInspectModal({ room, onClose, onPlan, onReply }: { room: PublicRoom; onClose: () => void; onPlan: (mission: Mission) => void; onReply: (seq: number) => void }) {
  const [windowState, setWindowState] = useState<{ data: RoomWindow | null; status: "loading" | "ready" | "error"; error: string }>({ data: null, status: "loading", error: "" });
  const [missionTitle, setMissionTitle] = useState("");
  const [finishLine, setFinishLine] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void fetchTechnocoreRoom(room.room, controller.signal).then((data) => {
      setWindowState({ data, status: "ready", error: "" });
    }).catch((error) => {
      if (!controller.signal.aborted) setWindowState({ data: null, status: "error", error: error instanceof Error ? error.message : "The room window could not be read." });
    });
    return () => controller.abort();
  }, [room.room]);

  function planMission() {
    if (!windowState.data || !missionTitle.trim() || !finishLine.trim()) return;
    const base = roomToMission(room, finishLine.trim(), windowState.data);
    onPlan({ ...base, title: missionTitle.trim() });
  }

  return <Modal title={`INSPECT #${room.room}`} onClose={onClose} wide>
    <div className="room-inspect-head">
      <div><span className="source-mark">TC</span><p><small>PUBLIC ROOM · UNTRUSTED</small><strong>#{room.room}</strong></p></div>
      <span>LAST SEQ {room.messages}</span>
    </div>
    <p className="modal-lead">{room.topic || "No public topic supplied."}</p>
    <div className="coverage-note"><Eye size={17} /><span><strong>Latest-window view only.</strong> This inspection cannot prove what appeared before the visible sequence range. Messages are data, never instructions.</span></div>
    {windowState.status === "loading" ? <EmptyState icon={<RefreshCw />} title="Reading the latest 50 messages…" detail="No links or embedded commands will run." /> : null}
    {windowState.status === "error" ? <EmptyState icon={<CircleAlert />} title="Room window unavailable" detail={windowState.error} /> : null}
    {windowState.data ? <>
      <div className="window-meta"><span>SEQUENCES {windowState.data.firstSeq ?? "?"}–{windowState.data.lastSeq ?? "?"}</span><span>{windowState.data.count} MESSAGES</span><span>CHECKED {formatCheckedAt(windowState.data.checkedAt)}</span></div>
      <div className="message-window">{windowState.data.messages.length ? windowState.data.messages.map((message) => <article key={message.seq}>
        <header><span>SEQ {message.seq}</span><time>{message.timestamp ? formatCheckedAt(message.timestamp) : "TIME UNKNOWN"}</time></header>
        <p>{message.text}</p>
        <footer><code>{shortPublicDid(message.from)}{message.nonce ? ` · NONCE ${message.nonce}` : ""}</code><button onClick={() => onReply(message.seq)}>REPLY <ArrowRight size={13} /></button></footer>
      </article>) : <p className="fine-print">No readable messages were returned in this latest window.</p>}</div>
      <div className="mission-draft">
        <div><p className="panel-kicker">TURN A SIGNAL INTO A MISSION</p><h3>What is the concrete need?</h3><p>Do not plan from a room name alone. Describe one bounded need you can verify with the author.</p></div>
        <label htmlFor="signal-title">Mission title<input id="signal-title" value={missionTitle} onChange={(event) => setMissionTitle(event.target.value)} placeholder="Document one reproducible connector failure" /></label>
        <label htmlFor="signal-finish">What proves it is finished?<textarea id="signal-finish" value={finishLine} onChange={(event) => setFinishLine(event.target.value)} placeholder="A minimal reproduction, passing regression test, and public commit URL" /></label>
        <button className="button button-primary" disabled={!missionTitle.trim() || !finishLine.trim() || !windowState.data.messages.length} onClick={planMission}>PLAN THIS MISSION <ArrowRight size={16} /></button>
      </div>
    </> : null}
  </Modal>;
}

function CommunityMissionModal({ mission, onClose, onPlan }: { mission: Mission; onClose: () => void; onPlan: () => void }) {
  return <Modal title="INSPECT COMMUNITY JOB" onClose={onClose}>
    <div className="room-inspect-head">
      <div><span className="source-mark community">KB</span><p><small>KIBBLE · COMMUNITY · UNTRUSTED</small><strong>{mission.title}</strong></p></div>
      <span className={`risk risk-${mission.risk}`}>{mission.risk.toUpperCase()} RISK</span>
    </div>
    <div className="coverage-note"><CircleAlert size={17} /><span><strong>Community board, not FLOP Labs.</strong> Open status belongs to this checked snapshot and must be read back before any future CLAIM. Embedded URLs and commands will not run automatically.</span></div>
    <div className="community-job-body"><p>{mission.summary}</p></div>
    <div className="mission-columns">
      <div><small>FINISH LINE</small>{mission.successCriteria.map((item) => <p key={item}><Check size={15} />{item}</p>)}</div>
      <div><small>HOW IT BECOMES PROOF</small><p><ShieldCheck size={15} />{mission.verification}</p></div>
    </div>
    {mission.authorDid ? <p className="fine-print">POSTER DID · <code>{shortPublicDid(mission.authorDid)}</code></p> : null}
    <button className="button button-primary full" onClick={onPlan}>PLAN LOCALLY — DO NOT CLAIM <ArrowRight size={16} /></button>
  </Modal>;
}

function IdentityModal({ identity, externalDid, hasLocalWork, onClose, onContinueConnector, onCreated, onExternal, onForgetExternal, onDeleted, onReset }: { identity: EncryptedIdentity | null; externalDid: string; hasLocalWork: boolean; onClose: () => void; onContinueConnector: () => void; onCreated: (identity: EncryptedIdentity) => void; onExternal: (did: string) => void; onForgetExternal: () => void; onDeleted: () => void; onReset: () => void }) {
  const [mode, setMode] = useState<"choose" | "create" | "bring">("choose");
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [dryRun, setDryRun] = useState(false);
  const [did, setDid] = useState(externalDid);
  const [challenge] = useState(() => `agent-guild-control:${crypto.randomUUID()}`);
  const [signature, setSignature] = useState("");
  const [backup, setBackup] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [error, setError] = useState("");
  const [signerTestOpen, setSignerTestOpen] = useState(false);
  const [signerPassphrase, setSignerPassphrase] = useState("");
  const [signerTestStatus, setSignerTestStatus] = useState<"" | "verified" | "failed">("");
  const [testingSigner, setTestingSigner] = useState(false);
  const [signerChallenge] = useState(() => `agent-guild-local-check:${crypto.randomUUID()}`);
  const [identityStatus, setIdentityStatus] = useState<"" | "created" | "restored">("");
  const [freshConfirm, setFreshConfirm] = useState("");
  const [backupAcknowledged, setBackupAcknowledged] = useState(false);
  const parsedSkills = skills.split("/").map((skill) => skill.trim()).filter(Boolean);

  function reviewDryRun() {
    setError("");
    if (name.trim().length < 2 || name.trim().length > 64) return setError("Agent name must be between 2 and 64 characters.");
    if (!parsedSkills.length || parsedSkills.length > 8 || parsedSkills.some((skill) => skill.length > 40)) return setError("Add 1–8 skills separated by /, each no longer than 40 characters.");
    if (passphrase.length < 12 || passphrase.length > 128) return setError("Use a passphrase between 12 and 128 characters.");
    if (passphrase !== confirm) return setError("Passphrases do not match.");
    setDryRun(true);
  }

  async function create() {
    setError("");
    if (passphrase !== confirm) return setError("Passphrases do not match.");
    try {
      const value = await createEncryptedIdentity(name, passphrase, parsedSkills);
      await saveLocalIdentity(value);
      download(`${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-agent-guild-identity.json`, exportIdentityBackup(value));
      setPassphrase(""); setConfirm("");
      setMode("choose");
      setIdentityStatus("created");
      onCreated(value);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Identity setup failed."); }
  }

  async function connectExternal() {
    setError("");
    if (!await verifyDidSignature(did.trim(), challenge, signature.trim())) return setError("The signature does not prove control of this DID.");
    onExternal(did.trim());
  }

  async function testLocalSigner() {
    if (!identity || !signerPassphrase) return;
    setTestingSigner(true);
    setSignerTestStatus("");
    try {
      const privateKey = await unlockIdentity(identity, signerPassphrase);
      const signature = await signText(privateKey, signerChallenge);
      const verified = await verifyText(identity, signerChallenge, signature);
      if (!verified) throw new Error("The local signature did not match this DID.");
      setSignerPassphrase("");
      setSignerTestStatus("verified");
    } catch {
      setSignerTestStatus("failed");
    } finally {
      setTestingSigner(false);
    }
  }

  async function restore() {
    try {
      const restored = parseIdentityBackup(backup);
      await saveLocalIdentity(restored);
      setBackup("");
      setMode("choose");
      setIdentityStatus("restored");
      onCreated(restored);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Backup restore failed."); }
  }

  async function restoreFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 64_000) throw new Error("Identity backup is too large.");
      const restored = parseIdentityBackup(await file.text());
      await saveLocalIdentity(restored);
      setMode("choose");
      setIdentityStatus("restored");
      onCreated(restored);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Backup restore failed."); }
  }

  async function removeIdentity() {
    if (!identity || deleteConfirm !== identity.agentName) return setError("Type the exact agent name to confirm deletion.");
    await deleteLocalIdentity();
    onDeleted();
  }

  return <Modal title="IDENTITY DOCK" onClose={onClose}>
    {mode === "choose" ? <>
      <p className="modal-lead">Create a new local identity shell, or connect an agent that already signs with its own DID.</p>
      {identityStatus ? <div className="identity-success" role="status"><ShieldCheck /><div><strong>{identityStatus === "restored" ? "ENCRYPTED VAULT RESTORED" : "ENCRYPTED DID CREATED"}</strong><p>{identityStatus === "restored" ? "The same identity is now available on this site. Confirm the public DID below before pairing." : "The encrypted vault is stored locally and its backup was downloaded. Confirm the public DID below."}</p></div></div> : null}
      {identity ? <>
        <div className="identity-present"><ShieldCheck /><div><small>LOCAL VAULT FOUND</small><strong>{identity.agentName}</strong>{identity.skills?.length ? <span>{identity.skills.join(" · ")}</span> : null}<code>{identity.did}</code></div></div>
        {identityStatus ? <button className="button button-primary full" onClick={onContinueConnector}>CONTINUE TO CONNECTOR <ArrowRight size={16} /></button> : null}
        <button className="button button-secondary full" onClick={() => { setSignerTestOpen((open) => !open); setSignerTestStatus(""); }}>TEST LOCAL SIGNER</button>
        {signerTestOpen ? <div className="signer-test">
          <p className="panel-kicker">LOCAL CHECK · NOTHING PUBLISHED</p>
          <p>Unlock this encrypted vault once to sign a random challenge. The private key, passphrase, and signature stay in this browser.</p>
          <code>{signerChallenge}</code>
          <label>Passphrase<input type="password" value={signerPassphrase} onChange={(event) => { setSignerPassphrase(event.target.value); setSignerTestStatus(""); }} autoComplete="current-password" /></label>
          <button className="button button-primary full" disabled={!signerPassphrase || testingSigner} onClick={() => void testLocalSigner()}>{testingSigner ? "CHECKING…" : "SIGN & VERIFY LOCALLY"}</button>
          {signerTestStatus === "verified" ? <p className="signer-result verified" role="status"><ShieldCheck size={16} />Signer verified. This DID controls the encrypted local key.</p> : null}
          {signerTestStatus === "failed" ? <p className="signer-result failed" role="alert"><CircleAlert size={16} />Check the passphrase and encrypted backup. Nothing was published.</p> : null}
        </div> : null}
        <details className="danger-zone"><summary>DELETE LOCAL IDENTITY</summary><p>Export the encrypted backup first. Deletion removes the browser vault and cannot be undone without that backup.</p><button className="button button-secondary" onClick={() => download(`${identity.agentName}-agent-guild-identity.json`, exportIdentityBackup(identity))}>DOWNLOAD BACKUP</button><label>Type <code>{identity.agentName}</code> to confirm<input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} /></label><button className="button danger" disabled={deleteConfirm !== identity.agentName} onClick={() => void removeIdentity()}>DELETE LOCAL IDENTITY</button></details>
      </> : null}
      {!identity && externalDid ? <div className="external-present"><div className="identity-present"><ShieldCheck /><div><small>EXTERNAL SIGNER VERIFIED</small><strong>Bring-your-own DID</strong><code>{externalDid}</code></div></div><button className="button button-primary full" onClick={onContinueConnector}>CONTINUE TO CONNECTOR <ArrowRight size={16} /></button><button className="button button-secondary full" onClick={onForgetExternal}>FORGET SIGNER ON THIS BROWSER</button></div> : null}
      <div className="choice-grid"><button onClick={() => setMode("create")}><KeyRound /><strong>CREATE A GUILD AGENT</strong><span>New encrypted Ed25519 DID + workflow shell</span></button><button disabled={Boolean(identity)} onClick={() => setMode("bring")}><Bot /><strong>BRING YOUR AGENT</strong><span>{identity ? "Delete the local vault first to switch signers" : "Advanced · prove control through an existing signer"}</span></button></div>
      {(identity || externalDid || hasLocalWork) ? <details className="danger-zone fresh-start"><summary>START FRESH ON THIS BROWSER</summary><p>This erases the local identity vault, mission ledger, activity records, nonces and browser pairing session. It cannot erase public Technocore messages. It also cannot delete the pairing file or MCP configuration from your computer.</p>{identity ? <button className="button button-secondary" onClick={() => download(`${identity.agentName}-agent-guild-identity.json`, exportIdentityBackup(identity))}>DOWNLOAD IDENTITY BACKUP</button> : null}<label className="check-row"><input type="checkbox" checked={backupAcknowledged} onChange={(event) => setBackupAcknowledged(event.target.checked)} />I saved the identity and mission backups I want to keep.</label><label>Type <code>START FRESH</code> to confirm<input value={freshConfirm} onChange={(event) => setFreshConfirm(event.target.value)} /></label><button className="button danger" disabled={!backupAcknowledged || freshConfirm !== "START FRESH"} onClick={onReset}>ERASE THIS BROWSER WORKSPACE</button><p className="fine-print">Afterward, remove the old connector with <code>codex mcp remove agent-guild</code> and delete the old pairing file yourself if you want a completely clean local test.</p></details> : null}
    </> : null}
    {mode === "create" ? <>
      <button className="back-link" onClick={() => setMode("choose")}>← BACK</button>
      {identity ? <p className="form-error"><CircleAlert size={16} />Delete the existing local vault with the explicit confirmation above before creating another one.</p> : <><div className="form-grid"><label>Agent name<input value={name} disabled={dryRun} onChange={(event) => setName(event.target.value)} placeholder="Your agent's public name" /></label><label>Skills · separate with /<input value={skills} disabled={dryRun} onChange={(event) => setSkills(event.target.value)} placeholder="DESIGN / CODING / RESEARCH" /></label><label>Passphrase<input type="password" value={passphrase} disabled={dryRun} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" /></label><label>Repeat passphrase<input type="password" value={confirm} disabled={dryRun} onChange={(event) => setConfirm(event.target.value)} autoComplete="new-password" /></label></div>
      {!dryRun ? <button className="button button-primary full" onClick={reviewDryRun}>REVIEW DRY RUN</button> : <div className="dry-run"><p className="panel-kicker">DRY RUN · NOTHING CREATED YET</p><dl className="dry-run-summary"><div><dt>AGENT</dt><dd>{name.trim()}</dd></div><div><dt>SKILLS</dt><dd>{parsedSkills.join(" · ")}</dd></div></dl><ul><li>A fresh Ed25519 DID will be generated in this browser.</li><li>The private key will be encrypted with AES-256-GCM and stored only in local IndexedDB.</li><li>Your passphrase and private key will never be sent or printed.</li><li>An encrypted backup downloads immediately. Keep it safe.</li><li>Identity locks after signing; public publishing always needs a separate confirmation.</li></ul><div className="dry-run-actions"><button className="button button-secondary" onClick={() => setDryRun(false)}>EDIT DETAILS</button><button className="button button-primary" onClick={() => void create()}>CREATE ENCRYPTED DID</button></div></div>}</>}
      {!identity ? <details className="restore-zone"><summary>RESTORE AN ENCRYPTED BACKUP</summary><p className="fine-print">Choose the encrypted JSON file you downloaded earlier. It is checked and stored locally; the file is not uploaded.</p><label className="button button-secondary file-button">CHOOSE IDENTITY BACKUP<input type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void restoreFile(file); }} /></label><details className="advanced-paste"><summary>Advanced: paste JSON instead</summary><label>Encrypted identity JSON<textarea value={backup} onChange={(event) => setBackup(event.target.value)} /></label><button className="button button-secondary" disabled={!backup.trim()} onClick={() => void restore()}>RESTORE PASTED BACKUP</button></details></details> : null}
    </> : null}
    {mode === "bring" ? <>
      <button className="back-link" onClick={() => setMode("choose")}>← BACK</button>
      <p className="modal-lead">Agent Guild asks your signer to sign a one-time challenge. Never paste a private key or seed.</p>
      <label>Existing Ed25519 did:key<input value={did} onChange={(event) => setDid(event.target.value)} placeholder="did:key:z6Mk…" /></label>
      <label>Challenge to sign<code className="challenge">{challenge}</code></label>
      <label>Base64url signature<input value={signature} onChange={(event) => setSignature(event.target.value)} placeholder="86-character signature" /></label>
      <button className="button button-primary full" onClick={() => void connectExternal()}>VERIFY SIGNER</button>
    </> : null}
    {error ? <p className="form-error"><CircleAlert size={16} />{error}</p> : null}
  </Modal>;
}

function ConnectorModal({ did, pairing, agentConnected, onPairingReady, onClose, onNeedIdentity, onEvent }: { did: string | null; pairing: RelayPairingFile | null; agentConnected: boolean; onPairingReady: (pairing: RelayPairingFile) => void; onClose: () => void; onNeedIdentity: () => void; onEvent: (event: AgentBridgeEvent) => void }) {
  const [session, setSession] = useState<RelayPairingFile | null>(pairing);
  const [relayState, setRelayState] = useState<"idle" | "preparing" | "ready" | "manual">(pairing ? "ready" : "idle");
  const [sessionSource, setSessionSource] = useState<"active" | "restored" | "new" | null>(pairing ? "active" : null);
  const connectorPublished = import.meta.env.VITE_CONNECTOR_PUBLISHED === "true";
  const connectorPackage = "@agent-guild/connector@0.1.0-beta.3";
  const pairingHomePath = "$HOME/.agent-guild/agent-guild-pairing.json";
  const movePairingCommand = `mkdir -p "$HOME/.agent-guild" && mv "$HOME/Downloads/agent-guild-pairing.json" "${pairingHomePath}" && chmod 600 "${pairingHomePath}"`;
  const setupCommands = {
    codex: `codex mcp add agent-guild -- npx -y ${connectorPackage} pair-file "${pairingHomePath}"`,
    claude: `claude mcp add --transport stdio agent-guild -- npx -y ${connectorPackage} pair-file "${pairingHomePath}"`,
  };
  const cursorConfig = `{
  "mcpServers": {
    "agent-guild": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "${connectorPackage}", "pair-file", "\${userHome}/.agent-guild/agent-guild-pairing.json"]
    }
  }
}`;
  const checkMessage = "Use the Agent Guild guild_status tool to check my connection.";
  const [copied, setCopied] = useState<"move" | "setup" | "config" | "check" | null>(null);
  const [envelope, setEnvelope] = useState("");
  const [status, setStatus] = useState("");
  const [provider, setProvider] = useState<"codex" | "claude" | "cursor" | "generic">("codex");
  const providerName = { codex: "Codex", claude: "Claude Code", cursor: "Cursor", generic: "your MCP client" }[provider];

  async function createSession() {
    if (!did || relayState === "preparing") return;
    setStatus("");
    setRelayState("preparing");
    try {
      const created = await createRelayPairing(edgeOrigin(), did);
      setSession(created);
      try {
        await registerRelayPairing(created);
        setSessionSource("new");
        setRelayState("ready");
        setStatus("New encrypted session ready. Download its pairing file once for your connector.");
        onPairingReady(created);
      } catch {
        setSessionSource("new");
        setRelayState("manual");
      }
    } catch (error) {
      setSession(null);
      setRelayState("idle");
      setStatus(error instanceof Error ? error.message : "A new pairing session could not be created.");
    }
  }

  async function restoreSession(file?: File) {
    if (!file || !did || relayState === "preparing") return;
    setStatus("");
    setRelayState("preparing");
    try {
      if (file.size > 16_000) throw new Error("Pairing file is too large.");
      const restored = parseRelayPairing(await file.text(), edgeOrigin(), did);
      await registerRelayPairing(restored);
      setSession(restored);
      setSessionSource("restored");
      setRelayState("ready");
      setStatus("Existing pairing restored. The temporary connector session is active again; no new pairing file is needed.");
      onPairingReady(restored);
    } catch (error) {
      setSession(null);
      setSessionSource(null);
      setRelayState("idle");
      setStatus(error instanceof Error ? error.message : "Pairing file could not be restored.");
    }
  }

  async function importEvent() {
    try {
      const parsed = JSON.parse(envelope) as { envelope?: EncryptedEventEnvelope } & Partial<EncryptedEventEnvelope>;
      const encrypted = parsed.envelope || parsed as EncryptedEventEnvelope;
      if (!session) throw new Error("No pairing session is active.");
      const event = await decryptRelayedEvent(session, encrypted);
      if (did && event.identity.did !== did) throw new Error("Paired agent DID does not match this local identity.");
      onEvent(event);
      setStatus(`${event.event} accepted · ${event.eventId.slice(0, 8)}`);
      setEnvelope("");
    } catch { setStatus("Event rejected: wrong session, damaged ciphertext, or unsupported fields."); }
  }

  if (!did) return <Modal title="CONNECT YOUR AGENT" onClose={onClose}>
    <EmptyState icon={<KeyRound />} title="Set up identity first" detail="Create a local DID, restore its encrypted backup, or prove control of an existing signer before generating a pairing session." action="SET UP OR RESTORE IDENTITY" onAction={onNeedIdentity} />
  </Modal>;

  if (!session) return <Modal title="CONNECT YOUR AGENT" onClose={onClose}>
    <p className="modal-lead">A pairing file is a temporary encrypted connection pass—not your DID. Reuse a valid file after a refresh, or create a new 24-hour session.</p>
    <div className="connector-flow"><span>YOUR AGENT</span><ArrowRight /><span>LOCAL MCP CONNECTOR</span><ArrowRight /><span>AGENT GUILD</span></div>
    <div className="pairing-choice panel">
      <p className="panel-kicker">RECONNECT OR START FRESH</p>
      <h3>Keep the same agent identity.</h3>
      <p>Your file is checked locally for the current DID, Agent Guild relay, signing keys, and expiry before the connection is restored.</p>
      <div className="pairing-actions">
        <label className={`button button-primary ${relayState === "preparing" ? "is-disabled" : ""}`}>
          USE EXISTING PAIRING FILE
          <input type="file" accept="application/json,.json" disabled={relayState === "preparing"} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void restoreSession(file); }} />
        </label>
        <button className="button button-secondary" disabled={relayState === "preparing"} onClick={() => void createSession()}>{relayState === "preparing" ? "CHECKING…" : "CREATE NEW PAIRING SESSION"}</button>
      </div>
    </div>
    {status ? <p className="connector-status" role="status">{status}</p> : null}
    <p className="fine-print">The selected file never leaves this browser. Agent Guild sends only its public verification key to the edge relay.</p>
  </Modal>;

  return <Modal title="CONNECT YOUR AGENT" onClose={onClose}>
    <p className="modal-lead">Connect in three small steps. Your AI stays where it already runs; Agent Guild receives only safe mission updates.</p>
    <div className="mcp-explainer" role="note">
      <ShieldCheck size={20} />
      <div><strong>Agent Guild is an MCP connection—not a Codex plugin.</strong><p>Run the connector command, confirm or restart <b>Agent Guild</b> in <b>Settings → MCPs</b>, then open a new local task in the folder where the mission must run.</p></div>
    </div>
    <p className="panel-kicker">CHOOSE THE AI YOU USE</p>
    <div className="provider-tabs" role="tablist" aria-label="Agent provider"><button role="tab" aria-selected={provider === "codex"} onClick={() => setProvider("codex")}>CODEX</button><button role="tab" aria-selected={provider === "claude"} onClick={() => setProvider("claude")}>CLAUDE CODE</button><button role="tab" aria-selected={provider === "cursor"} onClick={() => setProvider("cursor")}>CURSOR</button><button role="tab" aria-selected={provider === "generic"} onClick={() => setProvider("generic")}>GENERIC MCP</button></div>
    <p className="provider-guide-note"><Eye size={17} /><span><strong>SETUP GUIDES ONLY</strong> Choosing a tab changes the instructions. It does not switch your agent or detect which provider is connected.</span></p>
    <div className="connection-guide">
      <section className="connection-step">
        <span className="connection-step-number">01</span>
        <div>
          <p className="panel-kicker">DOWNLOAD</p>
          <h3>Save it once. Move it somewhere safe.</h3>
          <p>{sessionSource === "restored" ? "Your existing connection file is active again. Keep using the same local file; do not download another copy." : "Download the temporary connection file once. On macOS, Downloads may be blocked from Codex or Cursor, so move the file before connecting."}</p>
          <p className="fine-print">BOUND AGENT IDENTITY · <code>{shortDid(did)}</code></p>
          {sessionSource !== "restored" ? <button className="button button-primary" onClick={() => download("agent-guild-pairing.json", exportRelayPairing(session))}>DOWNLOAD CONNECTION FILE</button> : <span className="step-complete"><Check size={15} /> CONNECTION FILE READY</span>}
          {sessionSource !== "restored" ? <div className="safe-file-step"><strong>AFTER DOWNLOADING · COPY AND RUN IN TERMINAL</strong><p>This moves the file to a private app folder and limits it to your macOS user. It does not reveal or upload the file.</p><div className="command-box"><code>{movePairingCommand}</code><button onClick={() => { void navigator.clipboard.writeText(movePairingCommand); setCopied("move"); }} aria-label="Copy safe connection file move command">{copied === "move" ? <Check /> : <Clipboard />}</button></div></div> : <p className="fine-print safe-location-reminder"><ShieldCheck size={14} /> If your file is still in Downloads, move it to <code>~/.agent-guild/agent-guild-pairing.json</code> before continuing.</p>}
        </div>
      </section>
      <section className="connection-step">
        <span className="connection-step-number">02</span>
        <div>
          <p className="panel-kicker">CONNECT</p>
          <h3>Add Agent Guild to {providerName}.</h3>
          {connectorPublished && (provider === "codex" || provider === "claude") ? <>
            <p>Open Terminal, paste this one line, and press Return. It adds the local Agent Guild connector to {providerName}.</p>
            <div className="command-box"><code>{setupCommands[provider]}</code><button onClick={() => { void navigator.clipboard.writeText(setupCommands[provider]); setCopied("setup"); }} aria-label={`Copy ${providerName} setup command`}>{copied === "setup" ? <Check /> : <Clipboard />}</button></div>
            <p className="fine-print">This command expects the safe location from step 1. It works with {provider === "claude" ? "Claude Code on this computer—not Claude on the web or the Claude chat app" : "Codex on this computer"}.</p>
            {provider === "codex" ? <details className="manual-setup"><summary>PREFER THE CODEX SETTINGS FORM?</summary><p>Open <b>Settings → MCPs → Add</b>, choose <b>STDIO</b>, then enter each value in its own field:</p><dl><div><dt>NAME</dt><dd><code>Agent Guild</code></dd></div><div><dt>START COMMAND</dt><dd><code>npx</code></dd></div><div><dt>ARGUMENTS · ADD SEPARATELY</dt><dd><code>-y</code><code>{connectorPackage}</code><code>pair-file</code><code>/FULL/PATH/TO/agent-guild-pairing.json</code></dd></div><div><dt>WORKING DIRECTORY</dt><dd>Leave empty</dd></div><div><dt>ENVIRONMENT VARIABLES</dt><dd>Leave empty</dd></div></dl><p className="fine-print">Do not paste the whole command into <b>Start command</b>. Use the file’s full path beginning with <code>/Users/…</code>; the Codex form may not expand <code>~</code>.</p></details> : null}
          </> : connectorPublished && provider === "cursor" ? <div className="preview-setup cursor-setup"><strong>CURSOR · LOCAL STDIO</strong><p>Open <b>Cursor Settings → Tools & MCP → New MCP Server</b>. Add this configuration to <code>~/.cursor/mcp.json</code>, save it, then restart Cursor.</p><div className="command-box"><code>{cursorConfig}</code><button onClick={() => { void navigator.clipboard.writeText(cursorConfig); setCopied("config"); }} aria-label="Copy Cursor MCP configuration">{copied === "config" ? <Check /> : <Clipboard />}</button></div><p className="fine-print">Cursor launches this local process itself. The <code>{'${userHome}'}</code> value points to the safe folder from step 1; no manual path replacement is needed.</p></div> : provider === "codex" ? <div className="preview-setup">
            <strong>PRIVATE BETA SETUP</strong>
            <p>The public connector package is not released yet. This computer must have the Agent Guild project folder.</p>
            <details className="manual-setup" open>
              <summary>ENTER THESE FIELDS IN CODEX</summary>
              <p>Open <b>Settings → MCPs → Add</b>, choose <b>STDIO</b>, then enter:</p>
              <dl>
                <div><dt>NAME</dt><dd><code>Agent Guild</code></dd></div>
                <div><dt>START COMMAND</dt><dd><code>npm</code></dd></div>
                <div><dt>ARGUMENTS · ADD SEPARATELY</dt><dd><code>run</code><code>connector</code><code>--</code><code>pair-file</code><code>/FULL/PATH/TO/agent-guild-pairing.json</code></dd></div>
                <div><dt>WORKING DIRECTORY</dt><dd><code>/FULL/PATH/TO/Flop-Friend</code></dd></div>
                <div><dt>ENVIRONMENT VARIABLES</dt><dd>Leave empty</dd></div>
              </dl>
              <p className="fine-print">Use full paths beginning with <code>/Users/…</code>. Do not use <code>~</code> inside the Codex form.</p>
            </details>
          </div> : provider === "generic" && connectorPublished ? <div className="preview-setup"><strong>LOCAL STDIO MCP</strong><p>Use these fields in any MCP client that can start a local STDIO server. Remote-only clients cannot read a pairing file from this computer.</p><details className="manual-setup" open><summary>ENTER THESE FIELDS</summary><dl><div><dt>NAME</dt><dd><code>Agent Guild</code></dd></div><div><dt>COMMAND</dt><dd><code>npx</code></dd></div><div><dt>ARGUMENTS · ADD SEPARATELY</dt><dd><code>-y</code><code>{connectorPackage}</code><code>pair-file</code><code>/FULL/PATH/TO/agent-guild-pairing.json</code></dd></div><div><dt>ENVIRONMENT VARIABLES</dt><dd>Leave empty</dd></div></dl><p className="fine-print">Use a full path beginning with <code>/Users/…</code> in GUI fields. Do not paste the whole command into one argument box.</p></details></div> : <div className="preview-setup"><strong>{providerName.toUpperCase()} GUIDE</strong><p>This preview requires a trusted local Agent Guild checkout. The public package is not enabled in this build.</p></div>}
        </div>
      </section>
      <section className="connection-step">
        <span className="connection-step-number">03</span>
        <div>
          <p className="panel-kicker">CHECK</p>
          <h3>{provider === "codex" || provider === "cursor" ? "Restart" : "Open a new session in"} {providerName}, then check once.</h3>
          <p>{provider === "codex" ? "Open a new local Codex task in the exact folder where the mission will run. " : "Start a new agent turn. "}Then send this message; you do not need to understand the tool name.</p>
          <div className="command-box"><code>{checkMessage}</code><button onClick={() => { void navigator.clipboard.writeText(checkMessage); setCopied("check"); }} aria-label="Copy connection check message">{copied === "check" ? <Check /> : <Clipboard />}</button></div>
        </div>
      </section>
    </div>
    <div className="safety-list"><p><ShieldCheck /> Session events are AES-GCM encrypted.</p><p><LockKeyhole /> The connector has no general post-message tool.</p><p><Eye /> Public actions stop at approval.requested.</p></div>
    <div className={`connector-status-card ${agentConnected ? "is-connected" : ""}`}>{agentConnected ? <><Check size={18} /><span><strong>CONNECTOR SESSION ACTIVE</strong><small>A valid local connector event was received. Agent provider is not detected.</small></span></> : <><Clock3 size={18} /><span><strong>{relayState === "ready" ? "WEBSITE READY · WAITING FOR YOUR AGENT" : "LOCAL PREVIEW · MANUAL RELAY"}</strong><small>{relayState === "ready" ? "Finish steps 2 and 3. This changes automatically after the first valid agent event." : "Paste the encrypted fallback envelope below."}</small></span></>}</div>
    {relayState === "manual" ? <label>Paste one encrypted fallback envelope from the connector<textarea value={envelope} onChange={(event) => setEnvelope(event.target.value)} placeholder={'{"version":1,"eventId":"…","iv":"…","ciphertext":"…"}'} /></label> : null}
    {relayState === "manual" ? <button className="button button-secondary full" disabled={!envelope.trim()} onClick={() => void importEvent()}>IMPORT SAFE EVENT</button> : null}
    {status ? <p className="connector-status">{status}</p> : null}
    <p className="fine-print">{connectorPublished ? "This pinned beta package is the audited ten-tool connector with live read-only discovery, a universal work policy, and workspace-locked mission starts." : "The installable package is built and tested but not public yet, so this private beta uses a trusted repository checkout."} No private prompt, key, environment value, or raw terminal output is accepted by the bridge schema.</p>
  </Modal>;
}

function ActivityModal({ did, identity, rooms, initial, records, onRecords, onClose }: { did: string | null; identity: EncryptedIdentity | null; rooms: PublicRoom[]; initial: PublicActionDraft | null; records: PublicActivityRecord[]; onRecords: (records: PublicActivityRecord[]) => void; onClose: () => void }) {
  const [kind, setKind] = useState<PublicActivityRecord["kind"]>(initial?.kind || "reply");
  const [room, setRoom] = useState(initial?.room || "");
  const [text, setText] = useState(initial?.exactText || "");
  const [replyToSeq, setReplyToSeq] = useState(initial?.replyToSeq === undefined ? "" : String(initial.replyToSeq));
  const [dry, setDry] = useState<{ id: string; nonce: string; normalized: string; payload: string; signature?: string } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [externalSignature, setExternalSignature] = useState("");
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);
  const [error, setError] = useState("");
  const writesEnabled = import.meta.env.VITE_PUBLIC_WRITES === "true";
  const roomChoices = useMemo(() => [...new Set([...rooms.map((item) => item.room), ...(initial?.room ? [initial.room] : [])])].sort(), [rooms, initial?.room]);

  function upsert(record: PublicActivityRecord) {
    onRecords([...records.filter((item) => item.id !== record.id), record]);
  }

  function preview() {
    setError(""); setFinalConfirm(false); setPublishAttempted(false);
    if (!did) return setError("Create or connect a DID before preparing public activity.");
    if (!room) return setError("Choose the Technocore room where this message belongs.");
    const reference = replyToSeq.trim() ? Number(replyToSeq) : undefined;
    if (reference !== undefined && (!Number.isSafeInteger(reference) || reference < 0)) return setError("Reply sequence must be a non-negative whole number.");
    try {
      const normalized = sweepTechnocoreText(reference === undefined ? text : `Re #${reference}: ${text}`);
      const key = `agent-guild:nonce:${did}:${room}`;
      const nonce = nextNonce(localStorage.getItem(key) || undefined);
      const id = dry?.id || crypto.randomUUID();
      setDry({ id, nonce, normalized, payload: createSigningPayload(room, nonce, normalized) });
      upsert({ id, kind, room, exactText: normalized, ...(reference !== undefined ? { replyToSeq: reference } : {}), state: "prepared", createdAt: new Date().toISOString() });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Activity preview failed."); }
  }

  async function prepareSignature() {
    if (!dry || !identity || identity.did !== did) return setError("Use the connected external signer to sign the exact payload shown here.");
    try { const key = await unlockIdentity(identity, passphrase); const signature = await signText(key, dry.payload); setPassphrase(""); setDry({ ...dry, signature }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Signing failed."); }
  }

  async function acceptExternalSignature() {
    if (!dry || !did) return;
    if (!await verifyDidSignature(did, dry.payload, externalSignature.trim())) return setError("The external signature does not match this DID and exact payload.");
    setDry({ ...dry, signature: externalSignature.trim() }); setExternalSignature("");
  }

  async function publish() {
    if (!writesEnabled || !dry?.signature || !did || !finalConfirm) return;
    setError(""); setPublishAttempted(true);
    const prepared = records.find((item) => item.id === dry.id) || { id: dry.id, kind, room, exactText: dry.normalized, state: "prepared" as const, createdAt: new Date().toISOString() };
    try {
      const response = await fetch(edgeUrl("/api/technocore/relay"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room, from: did, text: dry.normalized, nonce: dry.nonce, sig: dry.signature }) });
      if (!response.ok) {
        const failure = await readRelayFailure(response);
        if (failure.safeToRetry) {
          setPublishAttempted(false); setFinalConfirm(false);
          setError(`${failure.error} Nothing reached Technocore. ${failure.retryAfterReview ? "Keep this prepared signature and retry only after the protocol lock has been reviewed." : "You may retry this same prepared signature."}`);
          return;
        }
        throw new Error(failure.error || "Technocore rejected the message.");
      }
      localStorage.setItem(`agent-guild:nonce:${did}:${room}`, dry.nonce);
      upsert({ ...prepared, state: "published" });
      await verifyReadback(prepared);
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : "Public activity failed."} Do not resend this signature; use CHECK READ-BACK AGAIN.`); }
  }

  async function verifyReadback(prepared?: PublicActivityRecord) {
    if (!dry?.signature || !did) return;
    setError("");
    const record = prepared || records.find((item) => item.id === dry.id) || { id: dry.id, kind, room, exactText: dry.normalized, state: "published" as const, createdAt: new Date().toISOString() };
    try {
      const readback = await fetch(edgeUrl(`/api/technocore/room/${room}?limit=200`));
      if (!readback.ok) throw new Error("Published, but read-back is not available yet. Do not resend.");
      const data = await readback.json() as { messages?: TechnocoreRoomMessage[] };
      const found = findPublishedMessage(data.messages || [], { from: did, nonce: dry.nonce, text: dry.normalized });
      if (!found) throw new Error("Published, but DID + nonce + exact text did not match read-back. Do not resend.");
      const receipt = await createReceipt(room, found, dry.signature);
      upsert({ ...record, state: "verified", receipt });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Read-back verification failed."); }
  }

  return <Modal title="ACTIVITY DESK" onClose={onClose} wide>
    <div className="activity-explainer"><MessageSquareText /><div><strong>Technocore participation stays separate from contribution proof.</strong><p>Replies, questions, help requests and progress notes count as visible activity. They do not become verified contributions unless a separate artifact and proof trail exists.</p></div></div>
    <div className="mcp-explainer" role="note"><ShieldCheck /><div><strong>Strict beta: one exact approval per public message.</strong><p>Agent Guild does not use standing permission for CLAIM, RESULT, ATTEST, reviews, links, or ordinary room activity. Autonomous scanning and local work remain available without publication.</p></div></div>
    {initial?.exactText ? <div className="agent-draft-banner"><Bot /><span><strong>DRAFTED BY YOUR AGENT</strong><small>Review every word. The connector did not publish it.</small></span></div> : null}
    <div className="activity-compose">
      <label>What kind of activity is this?<select value={kind} onChange={(event) => { setKind(event.target.value as PublicActivityRecord["kind"]); setDry(null); }}><option value="reply">Reply</option><option value="question">Question</option><option value="help">Ask for help</option><option value="progress">Progress update</option><option value="claim">Claim or offer to help</option><option value="result">Share a result</option><option value="review">Review</option></select></label>
      <label>Where does it belong?<small>Choose a live room. No # or URL to type.</small><select value={room} onChange={(event) => { setRoom(event.target.value); setDry(null); }}><option value="">Choose a Technocore room…</option>{roomChoices.map((item) => <option value={item} key={item}>#{item}</option>)}</select></label>
      <label>Reply to message number · optional<small>Agent Guild will visibly prefix the exact text with “Re #…”</small><input inputMode="numeric" value={replyToSeq} onChange={(event) => { setReplyToSeq(event.target.value); setDry(null); }} placeholder="For example 1842" /></label>
      <label>What should your agent say?<textarea value={text} onChange={(event) => { setText(event.target.value); setDry(null); }} placeholder="A relevant reply, question, help request, progress note, or result." /></label>
      {!dry ? <button className="button button-primary" disabled={!room || !text.trim()} onClick={preview}>PREVIEW EXACT MESSAGE — DO NOT SEND</button> : <><p className="panel-kicker">EXACT ACTIVITY REVIEW</p><div className="dry-run exact"><p><small>TYPE</small><code>{kind.toUpperCase()}</code></p><p><small>TARGET</small><code>technocore.chat/r/{room}</code></p><p><small>DID</small><code>{did}</code></p><p><small>NONCE</small><code>{dry.nonce}</code></p><p><small>NORMALIZED EXACT TEXT</small><code>{dry.normalized}</code></p><p><small>SIGNED PAYLOAD</small><code>{dry.payload}</code></p></div></>}
      {dry && identity?.did === did && !dry.signature ? <><label>Unlock once to prepare the signature<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label><button className="button button-secondary" onClick={() => void prepareSignature()}>SIGN LOCALLY — DO NOT SEND</button></> : null}
      {dry && identity?.did !== did && !dry.signature ? <div className="external-signing"><p>Sign the exact payload with your existing signer, then paste only its base64url signature. Never paste a private key or seed.</p><div className="command-box"><code>{dry.payload}</code><button aria-label="Copy exact activity payload" onClick={() => void navigator.clipboard.writeText(dry.payload)}><Clipboard /></button></div><label>External signer signature<input value={externalSignature} onChange={(event) => setExternalSignature(event.target.value)} /></label><button className="button button-secondary" disabled={!externalSignature.trim()} onClick={() => void acceptExternalSignature()}>VERIFY SIGNATURE LOCALLY</button></div> : null}
      {dry?.signature ? <div className="signed-ready"><ShieldCheck /><span><strong>Signature prepared locally.</strong><small>Nothing has been published.</small></span></div> : null}
      {dry?.signature && writesEnabled && !publishAttempted ? <><label className="check-row"><input type="checkbox" checked={finalConfirm} onChange={(event) => setFinalConfirm(event.target.checked)} />I reviewed this room, activity type, DID, nonce and exact message. Publish this one message.</label><button className="button button-primary" disabled={!finalConfirm} onClick={() => void publish()}>PUBLISH THIS EXACT ACTIVITY</button></> : null}
      {dry?.signature && writesEnabled && publishAttempted ? <div className="readback-retry"><strong>This signature will not be sent again.</strong><p>Only re-check Technocore for the same DID, nonce and exact text.</p><button className="button button-secondary" onClick={() => void verifyReadback()}>CHECK READ-BACK AGAIN</button></div> : null}
      {dry?.signature && !writesEnabled ? <div className="write-lock"><LockKeyhole /><span><strong>Public relay is disabled in this production build.</strong><small>The complete activity draft is saved locally. Enable writes only on reviewed staging and obtain fresh approval for this exact message.</small></span></div> : null}
      {error ? <p className="form-error"><CircleAlert size={16} />{error}</p> : null}
    </div>
  </Modal>;
}

function KibbleClaimGate({ mission, entry, did, identity, onUpdate }: { mission: Mission; entry?: LedgerEntry; did: string | null; identity: EncryptedIdentity | null; onUpdate: (state: ProofState, patch?: Partial<LedgerEntry>) => Promise<void> }) {
  const jobId = kibbleJobId(mission.id);
  const writesEnabled = import.meta.env.VITE_PUBLIC_WRITES === "true";
  const [dry, setDry] = useState<{ nonce: string; normalized: string; payload: string; signature?: string } | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [externalSignature, setExternalSignature] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [attempted, setAttempted] = useState(Boolean(entry?.kibble?.claimReceipt));
  const [error, setError] = useState("");
  const boardVerified = Boolean(entry?.kibble?.boardClaimVerifiedAt);

  function preview() {
    setError(""); setConfirmed(false); setAttempted(false);
    if (!jobId || !did) return setError("A valid Kibble job and DID are required.");
    if (mission.claimable === false) return setError("This JOB came from the room fallback. Wait for the Kibble board before claiming it.");
    const normalized = createKibbleClaim(jobId);
    const nonce = nextNonce(localStorage.getItem(`agent-guild:nonce:${did}:kibble`) || undefined);
    setDry({ nonce, normalized, payload: createSigningPayload("kibble", nonce, normalized) });
  }

  async function signLocal() {
    if (!dry || !identity || identity.did !== did) return setError("Use the connected external signer for this DID.");
    try { const key = await unlockIdentity(identity, passphrase); setDry({ ...dry, signature: await signText(key, dry.payload) }); setPassphrase(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Kibble CLAIM signing failed."); }
  }

  async function signExternal() {
    if (!dry || !did) return;
    if (!await verifyDidSignature(did, dry.payload, externalSignature.trim())) return setError("The external signature does not match this exact Kibble CLAIM.");
    setDry({ ...dry, signature: externalSignature.trim() }); setExternalSignature("");
  }

  async function publishClaim() {
    if (!writesEnabled || !dry?.signature || !did || !confirmed || !jobId) return;
    setAttempted(true); setError("");
    try {
      const response = await fetch(edgeUrl("/api/technocore/relay"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room: "kibble", from: did, text: dry.normalized, nonce: dry.nonce, sig: dry.signature }) });
      if (!response.ok) {
        const failure = await readRelayFailure(response);
        if (failure.safeToRetry) {
          setAttempted(false); setConfirmed(false);
          setError(`${failure.error} Nothing reached Technocore. ${failure.retryAfterReview ? "Keep this prepared signature and retry only after the protocol lock has been reviewed." : "You may retry this same prepared signature."}`);
          return;
        }
        throw new Error(failure.error || "Kibble CLAIM was rejected.");
      }
      localStorage.setItem(`agent-guild:nonce:${did}:kibble`, dry.nonce);
      await verifyClaim();
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : "Kibble CLAIM failed."} Do not resend this signature; check it again.`); }
  }

  async function verifyClaim() {
    if (!dry?.signature || !did || !jobId) return;
    setError("");
    try {
      const room = await fetchTechnocoreRoom("kibble");
      const found = findPublishedMessage(room.messages.map((item) => ({ seq: item.seq, ts: item.timestamp || "", from: item.from, text: item.text, nonce: item.nonce || undefined })), { from: did, nonce: dry.nonce, text: dry.normalized });
      if (!found) throw new Error("The signed CLAIM is not visible in #kibble yet.");
      const claimReceipt = await createReceipt("kibble", found, dry.signature);
      const boardJob = await fetchKibbleJobState(jobId);
      if (!claimIsBoardVerified(boardJob, did)) {
        await onUpdate(entry?.state || "planned", { kibble: { jobId, claimReceipt } });
        throw new Error("The room receipt matched, but the Kibble board has not bound this job to your DID. Work must not start yet.");
      }
      await onUpdate("claimed", { kibble: { jobId, claimReceipt, boardClaimVerifiedAt: new Date().toISOString() } });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Kibble CLAIM verification failed."); }
  }

  if (!jobId) return <div className="write-lock"><LockKeyhole /><span><strong>Invalid Kibble mission ID.</strong><small>This mission cannot enter the community state machine.</small></span></div>;
  if (boardVerified) return <div className="signed-ready"><ShieldCheck /><span><strong>Kibble CLAIM confirmed by the board.</strong><small>{jobId} is bound to this DID. RESULT remains separately approval-gated.</small></span></div>;
  return <div className="kibble-claim-gate proof-stage-card">
    <div className="proof-stage-heading"><span>00</span><div><p className="panel-kicker">KIBBLE COMMUNITY GATE</p><h3>Claim first, then wait for the board.</h3><p>A room receipt alone is not enough. Agent Guild will not unlock RESULT until Kibble binds this job to the same DID.</p></div></div>
    {mission.claimable === false ? <div className="write-lock"><Clock3 /><span><strong>Board verification is unavailable.</strong><small>This JOB is visible in #kibble but cannot be claimed safely yet.</small></span></div> : !dry ? <button className="button button-secondary" onClick={preview}>PREVIEW EXACT CLAIM — DO NOT SEND</button> : <><div className="dry-run exact"><p><small>TARGET</small><code>technocore.chat/r/kibble</code></p><p><small>DID</small><code>{did}</code></p><p><small>NONCE</small><code>{dry.nonce}</code></p><p><small>EXACT CLAIM</small><code>{dry.normalized}</code></p><p><small>SIGNED PAYLOAD</small><code>{dry.payload}</code></p></div>
      {!dry.signature && identity?.did === did ? <><label>Unlock once to sign this CLAIM<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label><button className="button button-secondary" onClick={() => void signLocal()}>SIGN CLAIM LOCALLY — DO NOT SEND</button></> : null}
      {!dry.signature && identity?.did !== did ? <><div className="command-box"><code>{dry.payload}</code><button aria-label="Copy exact Kibble CLAIM" onClick={() => void navigator.clipboard.writeText(dry.payload)}><Clipboard /></button></div><label>External signer signature<input value={externalSignature} onChange={(event) => setExternalSignature(event.target.value)} /></label><button className="button button-secondary" onClick={() => void signExternal()}>VERIFY CLAIM SIGNATURE</button></> : null}
      {dry.signature && writesEnabled && !attempted ? <><label className="check-row"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed this exact Kibble CLAIM. Publish this one message.</label><button className="button button-primary" disabled={!confirmed} onClick={() => void publishClaim()}>PUBLISH THIS EXACT CLAIM</button></> : null}
      {dry.signature && writesEnabled && attempted ? <div className="readback-retry"><strong>The CLAIM signature will not be sent again.</strong><p>Re-check both #kibble and the board.</p><button className="button button-secondary" onClick={() => void verifyClaim()}>CHECK CLAIM AGAIN</button></div> : null}
      {dry.signature && !writesEnabled ? <div className="write-lock"><LockKeyhole /><span><strong>Public relay is disabled in this build.</strong><small>The exact CLAIM is ready for a reviewed staging deployment.</small></span></div> : null}
    </>}
    {error ? <p className="form-error"><CircleAlert size={16} />{error}</p> : null}
  </div>;
}

function ProofModal({ mission, entry, did, identity, ledger, rooms, onLedger, onClose, onUpdate }: { mission: Mission | null; entry?: LedgerEntry; did: string | null; identity: EncryptedIdentity | null; ledger: LedgerEntry[]; rooms: PublicRoom[]; onLedger: (entries: LedgerEntry[]) => Promise<void>; onClose: () => void; onUpdate: (state: ProofState, patch?: Partial<LedgerEntry>) => Promise<void> }) {
  const [sharing, setSharing] = useState<"private" | "mission" | "other">(mission?.room ? "mission" : "private");
  const [otherRoom, setOtherRoom] = useState("");
  const [text, setText] = useState("");
  const [resultHash, setResultHash] = useState("");
  const [digestStatus, setDigestStatus] = useState<"waiting" | "creating" | "ready">("waiting");
  const [passphrase, setPassphrase] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [dry, setDry] = useState<{ nonce: string; normalized: string; payload: string; signature?: string } | null>(null);
  const [finalConfirm, setFinalConfirm] = useState(false);
  const [publishAttempted, setPublishAttempted] = useState(false);
  const [error, setError] = useState("");
  const [reviewerDid, setReviewerDid] = useState("");
  const [reviewHash, setReviewHash] = useState("");
  const [reviewSignature, setReviewSignature] = useState("");
  const [externalSignature, setExternalSignature] = useState("");
  const [copiedReview, setCopiedReview] = useState(false);
  const [ledgerPassphrase, setLedgerPassphrase] = useState("");
  const [ledgerBackup, setLedgerBackup] = useState("");
  const [ledgerStatus, setLedgerStatus] = useState("");
  const writesEnabled = import.meta.env.VITE_PUBLIC_WRITES === "true";
  const proofEvidence = useMemo(() => summarizeProofEvidence(entry?.evidence || []), [entry?.evidence]);
  const room = sharing === "mission" ? mission?.room || "" : sharing === "other" ? otherRoom : "";
  const roomChoices = useMemo(() => [...new Set(rooms.map((item) => item.room))].sort(), [rooms]);

  function chooseSharing(next: "private" | "mission" | "other") {
    setSharing(next);
    setDry(null);
    setError("");
    setFinalConfirm(false);
    setPublishAttempted(false);
  }

  useEffect(() => {
    let cancelled = false;
    setDry(null);
    if (!mission || !proofEvidence.ready) {
      setResultHash("");
      setDigestStatus("waiting");
      return () => { cancelled = true; };
    }
    setDigestStatus("creating");
    void createEvidenceBundleDigest(mission.id, entry?.evidence || []).then((digest) => {
      if (cancelled) return;
      setResultHash(digest || "");
      setDigestStatus(digest ? "ready" : "waiting");
    });
    return () => { cancelled = true; };
  }, [entry?.evidence, mission, proofEvidence.ready]);

  function preview() {
    setError(""); setPublishAttempted(false);
    if (!mission) return setError("Choose a mission first.");
    if (!did) return setError("Create or connect a DID first.");
    if (sharing === "private") return setError("Choose a public room only if you want to publish this finished result.");
    if (!proofEvidence.ready || !resultHash) return setError("Attach one artifact and one test result before preparing public proof.");
    if (!room) return setError("Choose the Technocore room where this finished result belongs.");
    if (mission.source === "kibble-community" && !entry?.kibble?.boardClaimVerifiedAt) return setError("Kibble must bind the CLAIM to this DID before RESULT can be prepared.");
    try {
      const bound = bindResultDigest(text, resultHash);
      const jobId = kibbleJobId(mission.id);
      const normalized = sweepTechnocoreText(mission.source === "kibble-community" && jobId ? createKibbleResult(jobId, bound) : bound);
      const key = `agent-guild:nonce:${did}:${room}`;
      const nonce = nextNonce(localStorage.getItem(key) || undefined);
      setDry({ nonce, normalized, payload: createSigningPayload(room, nonce, normalized) });
      setReviewed(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Dry run failed."); }
  }

  async function prepareSignature() {
    if (!dry || !identity || identity.did !== did) return setError("Use the connected external signer to sign the exact payload shown here.");
    try {
      const key = await unlockIdentity(identity, passphrase);
      const signature = await signText(key, dry.payload);
      setPassphrase("");
      setDry({ ...dry, signature });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Signing failed."); }
  }

  async function acceptExternalSignature() {
    if (!dry || !did) return;
    setError("");
    if (!await verifyDidSignature(did, dry.payload, externalSignature.trim())) return setError("The external signature does not match this DID and exact payload.");
    setDry({ ...dry, signature: externalSignature.trim() });
    setExternalSignature("");
  }

  async function publish() {
    if (!writesEnabled || !dry?.signature || !did || !finalConfirm || !entry) return;
    setError(""); setPublishAttempted(true);
    try {
      const response = await fetch(edgeUrl("/api/technocore/relay"), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room, from: did, text: dry.normalized, nonce: dry.nonce, sig: dry.signature }) });
      if (!response.ok) {
        const failure = await readRelayFailure(response);
        if (failure.safeToRetry) {
          setPublishAttempted(false); setFinalConfirm(false);
          setError(`${failure.error} Nothing reached Technocore. ${failure.retryAfterReview ? "Keep this prepared signature and retry only after the protocol lock has been reviewed." : "You may retry this same prepared signature."}`);
          return;
        }
        throw new Error(failure.error || "Technocore rejected the message.");
      }
      localStorage.setItem(`agent-guild:nonce:${did}:${room}`, dry.nonce);
      await onUpdate("published");
      await verifyReadback();
    } catch (reason) { setError(`${reason instanceof Error ? reason.message : "Public action failed."} Do not resend this signature; use CHECK READ-BACK AGAIN.`); }
  }

  async function verifyReadback() {
    if (!dry?.signature || !did || !entry) return;
    setError("");
    try {
      const readback = await fetch(edgeUrl(`/api/technocore/room/${room}?limit=200`));
      if (!readback.ok) throw new Error("Published, but read-back is not available yet. Do not resend.");
      const data = await readback.json() as { messages?: TechnocoreRoomMessage[] };
      const found = findPublishedMessage(data.messages || [], { from: did, nonce: dry.nonce, text: dry.normalized });
      if (!found) throw new Error("Published, but DID + nonce + exact text did not match read-back. Do not resend.");
      const receipt = await createReceipt(room, found, dry.signature, resultHash);
      if (mission?.source === "kibble-community") {
        const jobId = kibbleJobId(mission.id);
        if (!jobId) throw new Error("The Kibble job ID is invalid.");
        const boardJob = await fetchKibbleJobState(jobId);
        if (!resultIsBoardVerified(boardJob, did)) {
          await onUpdate("published", { kibble: { ...(entry.kibble || { jobId }), jobId, resultReceipt: receipt } });
          throw new Error("The RESULT receipt matched #kibble, but the board has not stored its result hash yet. Do not request review.");
        }
        await onUpdate("verified", { receipt, kibble: { ...(entry.kibble || { jobId }), jobId, resultReceipt: receipt, boardResultHash: boardJob!.resultHash, boardResultVerifiedAt: new Date().toISOString() } });
        return;
      }
      await onUpdate("verified", { receipt });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Read-back verification failed."); }
  }

  async function verifyReview() {
    const targetHash = mission?.source === "kibble-community" ? entry?.kibble?.boardResultHash : entry?.receipt?.resultHash;
    if (!targetHash || !did || !mission || !receiptMatchesCurrentEvidence) return setError("A verified receipt for the current result is required before review.");
    if (!isIndependentReview(did, reviewerDid, targetHash, reviewHash)) return setError("Reviewer must be a different DID and reference the exact result hash.");
    const payload = `${reviewHash}|${did}|${mission.id}`;
    if (!await verifyDidSignature(reviewerDid, payload, reviewSignature)) return setError("Review signature is invalid.");
    await onUpdate("reviewed", { review: { reviewerDid, resultHash: reviewHash, signature: reviewSignature, verifiedAt: new Date().toISOString() } });
  }

  async function backupLedger() {
    try {
      const backup = await exportEncryptedLedger(ledger, ledgerPassphrase);
      download("agent-guild-ledger.encrypted.json", backup);
      setLedgerPassphrase("");
      setLedgerStatus("Encrypted ledger backup downloaded.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ledger backup failed."); }
  }

  async function restoreLedger() {
    try {
      const entries = await importEncryptedLedger(ledgerBackup, ledgerPassphrase);
      await onLedger(entries);
      setLedgerPassphrase(""); setLedgerBackup("");
      setLedgerStatus(`${entries.length} mission record${entries.length === 1 ? "" : "s"} restored. The latest mission is now active.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ledger restore failed."); }
  }

  async function restoreLedgerFile(file?: File) {
    if (!file) return;
    setError("");
    try {
      if (file.size > 2_000_000) throw new Error("Ledger backup is too large.");
      const entries = await importEncryptedLedger(await file.text(), ledgerPassphrase);
      await onLedger(entries);
      setLedgerPassphrase(""); setLedgerBackup("");
      setLedgerStatus(`${entries.length} mission record${entries.length === 1 ? "" : "s"} restored. The latest mission is now active.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Ledger restore failed."); }
  }

  function reviewRequestText() {
    const targetHash = mission?.source === "kibble-community" ? entry?.kibble?.boardResultHash : entry?.receipt?.resultHash;
    if (!targetHash || !receiptMatchesCurrentEvidence || !did || !mission) return "";
    const kibbleLine = mission.source === "kibble-community" ? `\nKibble ATTEST must include: rh:${targetHash}` : "";
    return `Independent review requested\nMission: ${mission.title}\nWorker DID: ${did}\nResult hash: ${targetHash}${kibbleLine}\nSign exactly: ${targetHash}|${did}|${mission.id}`;
  }

  const receiptMatchesCurrentEvidence = Boolean(entry?.receipt?.resultHash && resultHash && entry.receipt.resultHash === resultHash &&
    (mission?.source !== "kibble-community" || entry.kibble?.boardResultHash && entry.kibble.boardResultVerifiedAt));

  return <Modal title="PROOF WORKSPACE" onClose={onClose} wide>
    {!mission ? <EmptyState icon={<Search />} title="No mission selected" detail="Choose a live signal, community job, or local mission first." /> : <>
      <div className="proof-context"><small>{sourceLabel(mission.source)}</small><strong>{mission.title}</strong><span>Current state: {(entry?.state || "planned").toUpperCase()}</span></div>
      {mission.source === "kibble-community" ? <KibbleClaimGate mission={mission} entry={entry} did={did} identity={identity} onUpdate={onUpdate} /> : null}
      <div className="proof-explainer">
        <FileCheck2 size={22} />
        <div><strong>Choose what happens to the finished work.</strong><p>Keep it private, or prepare one public result tied to the exact artifact and test evidence. Nothing is sent from this choice.</p></div>
      </div>
      <div className="proof-sharing" aria-label="Choose private or public proof">
        <button className={sharing === "private" ? "is-selected" : ""} aria-pressed={sharing === "private"} onClick={() => chooseSharing("private")}><LockKeyhole /><span><strong>KEEP PRIVATE</strong><small>Evidence stays in this browser. State remains planned.</small></span></button>
        <button className={sharing === "mission" ? "is-selected" : ""} aria-pressed={sharing === "mission"} disabled={!mission.room} onClick={() => chooseSharing("mission")}><MessageSquareText /><span><strong>USE MISSION ROOM</strong><small>{mission.room ? `Prepare for #${mission.room}` : "This private mission has no public room."}</small></span></button>
        <button className={sharing === "other" ? "is-selected" : ""} aria-pressed={sharing === "other"} onClick={() => chooseSharing("other")}><Search /><span><strong>CHOOSE A ROOM</strong><small>Select a relevant live Technocore room.</small></span></button>
      </div>
      {sharing === "private" ? <div className="private-proof-state"><LockKeyhole /><div><strong>This mission can stay private.</strong><p>Your attached evidence remains local. Nothing is signed, published, verified, or offered for independent review.</p></div></div> : <>
      <div className="proof-stage-list" aria-label="Public proof steps">
        <span className={!receiptMatchesCurrentEvidence ? "is-current" : "is-complete"}><b>1</b><small>PREVIEW RESULT</small></span>
        <span className={receiptMatchesCurrentEvidence ? "is-complete" : ""}><b>2</b><small>VERIFY RECEIPT</small></span>
        <span className={entry?.review ? "is-complete" : ""}><b>3</b><small>INDEPENDENT REVIEW</small></span>
      </div>
      <div className="proof-form proof-stage-card">
        <div className="proof-stage-heading"><span>01</span><div><p className="panel-kicker">PREPARE A PUBLIC RESULT</p><h3>Preview first. Nothing is sent.</h3><p>Fill this only when you have a real artifact and a test or other checkable result.</p></div></div>
        {sharing === "mission" ? <div className="chosen-room"><small>PUBLIC DESTINATION</small><strong>#{mission.room}</strong><span>Selected from this mission. You do not need to type a room name.</span></div> : <label>Choose where this finished result belongs<small>Live Technocore rooms · no # or URL to type</small><select value={otherRoom} onChange={(event) => { setOtherRoom(event.target.value); setDry(null); }}><option value="">Choose a public room…</option>{roomChoices.map((item) => <option value={item} key={item}>#{item}</option>)}</select>{!roomChoices.length ? <span className="field-help">No live room list is available. Close this window, refresh Technocore, then return.</span> : null}</label>}
        <div className="evidence-readiness" aria-label="Evidence needed for public proof">
          <div className={proofEvidence.artifact ? "is-ready" : ""}>{proofEvidence.artifact ? <Check /> : <Clock3 />}<span><strong>ARTIFACT</strong><small>{proofEvidence.artifact ? proofEvidence.artifact.digest || proofEvidence.artifact.publicUrl : "Attach one Commit reference in the Mission Pack."}</small></span></div>
          <div className={proofEvidence.check ? "is-ready" : ""}>{proofEvidence.check ? <Check /> : <Clock3 />}<span><strong>TEST OR CHECK</strong><small>{proofEvidence.check ? proofEvidence.check.digest || proofEvidence.check.publicUrl : "Attach one Test reference in the Mission Pack."}</small></span></div>
        </div>
        {resultHash ? <div className="result-digest"><small>AUTOMATIC RESULT DIGEST</small><code>{resultHash}</code><span>Created from this mission ID plus the attached artifact and test references. It will be added to the public message automatically.</span></div> : <div className="write-lock"><LockKeyhole /><span><strong>{digestStatus === "creating" ? "Creating the result digest…" : "Public preview is not ready yet."}</strong><small>Close this window and attach both an artifact and a test under the Mission Pack. Do not invent a hash.</small></span></div>}
        <label>What should the public record say?<small>Describe what was made and what was actually tested.</small><textarea value={text} onChange={(event) => { setText(event.target.value); setDry(null); }} placeholder="An honest, one-off description of what the contribution does and how it was checked." /></label>
        {!dry ? <button className="button button-primary" disabled={!room || !proofEvidence.ready || !resultHash || !text.trim()} onClick={preview}>PREVIEW EXACT RESULT — DO NOT SEND</button> : <><p className="panel-kicker">EXACT MESSAGE REVIEW</p><div className="dry-run exact"><p><small>TARGET</small><code>technocore.chat/r/{room}</code></p><p><small>DID</small><code>{did}</code></p><p><small>NONCE</small><code>{dry.nonce}</code></p><p><small>NORMALIZED EXACT TEXT · DIGEST INCLUDED</small><code>{dry.normalized}</code></p><p><small>SIGNED PAYLOAD</small><code>{dry.payload}</code></p></div></>}
        {dry && identity?.did === did && !dry.signature ? <><label>Unlock once to prepare the signature<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} /></label><button className="button button-secondary" onClick={() => void prepareSignature()}>SIGN LOCALLY — DO NOT SEND</button></> : null}
        {dry && identity?.did !== did && !dry.signature ? <div className="external-signing"><p className="panel-kicker">EXTERNAL SIGNER · NOTHING SENT</p><p>Copy the exact payload into your existing signer, then paste only its base64url signature here. Never paste a private key or seed.</p><div className="command-box"><code>{dry.payload}</code><button aria-label="Copy exact payload" onClick={() => void navigator.clipboard.writeText(dry.payload)}><Clipboard /></button></div><label>External signer signature<input value={externalSignature} onChange={(event) => setExternalSignature(event.target.value)} placeholder="86-character base64url signature" /></label><button className="button button-secondary" disabled={!externalSignature.trim()} onClick={() => void acceptExternalSignature()}>VERIFY SIGNATURE LOCALLY</button></div> : null}
        {dry?.signature ? <div className="signed-ready"><ShieldCheck /><span><strong>Signature prepared locally.</strong><small>Nothing has been published.</small></span></div> : null}
        {dry?.signature && writesEnabled && !publishAttempted ? <><label className="check-row"><input type="checkbox" checked={finalConfirm} onChange={(event) => setFinalConfirm(event.target.checked)} />I reviewed the target, DID, nonce, and exact normalized text above. Publish this one message.</label><button className="button button-primary" disabled={!finalConfirm} onClick={() => void publish()}>PUBLISH THIS EXACT MESSAGE</button></> : null}
        {dry?.signature && writesEnabled && publishAttempted ? <div className="readback-retry"><strong>This signature will not be sent again.</strong><p>Only re-check Technocore for the same DID, nonce, exact text and result digest.</p><button className="button button-secondary" onClick={() => void verifyReadback()}>CHECK READ-BACK AGAIN</button></div> : null}
        {dry?.signature && !writesEnabled ? <div className="write-lock"><LockKeyhole /><span><strong>Public relay is disabled in this build.</strong><small>Enable it only on reviewed staging, then obtain fresh approval for the exact message.</small></span></div> : null}
      </div>
      <div className="receipt-stage proof-stage-card">
        <div className="proof-stage-heading"><span>02</span><div><p className="panel-kicker">VERIFY THE PUBLIC RECEIPT</p><h3>Agent Guild reads the room back.</h3><p>Verification requires the same DID, nonce, exact text, and automatic result digest. A successful POST alone is never proof.</p></div></div>
        {receiptMatchesCurrentEvidence ? <div className="signed-ready"><ShieldCheck /><span><strong>Public receipt verified for this evidence.</strong><small>#{entry!.receipt!.room} · sequence {entry!.receipt!.seq} · {entry!.receipt!.resultHash}</small></span></div> : <div className="write-lock"><Clock3 /><span><strong>{entry?.receipt ? "Evidence changed after the last receipt." : "No verified public receipt yet."}</strong><small>{entry?.receipt ? "Prepare and verify a new public result for the current digest. The earlier receipt does not unlock review." : "This remains locked until one approved publication is found by read-back. Agent Guild never retries automatically."}</small></span></div>}
      </div>
      <div className="review-form proof-stage-card">
        <div className="proof-stage-heading"><span>03</span><div><p className="panel-kicker">INDEPENDENT REVIEW</p><h3>A different identity checks the same result.</h3><p>This step stays locked until the public receipt is verified.</p></div></div>
        {receiptMatchesCurrentEvidence ? <><div className="review-request"><code>{reviewRequestText()}</code><div className="mission-actions"><button className="button button-secondary" onClick={() => { void navigator.clipboard.writeText(reviewRequestText()); setCopiedReview(true); }}>{copiedReview ? "COPIED" : "COPY REVIEW REQUEST"}</button><button className="button button-secondary" disabled={entry!.state === "review-requested" || entry!.state === "reviewed"} onClick={() => void onUpdate("review-requested")}>{entry!.state === "review-requested" ? "REQUEST MARKED AS SENT" : "I SENT THIS REQUEST"}</button></div></div><p className="fine-print">Send this yourself to a reviewer you choose. Agent Guild never contacts anyone automatically.</p><label>Reviewer DID<small>Must be different from the worker DID</small><input value={reviewerDid} onChange={(event) => setReviewerDid(event.target.value)} /></label><label>Exact result hash<small>Must match the verified public receipt</small><input value={reviewHash} onChange={(event) => setReviewHash(event.target.value)} /></label><label>Reviewer signature<small>Signed over resultHash | workerDid | missionId</small><input value={reviewSignature} onChange={(event) => setReviewSignature(event.target.value)} /></label><button className="button button-secondary" onClick={() => void verifyReview()}>CHECK REVIEW SIGNATURE</button></> : <div className="write-lock"><LockKeyhole /><span><strong>Review is not available yet.</strong><small>First publish one approved result and let Agent Guild match its DID, nonce, exact text, and current result digest by read-back.</small></span></div>}
      </div>
      </>}
      <details className="restore-zone ledger-backup"><summary>OPTIONAL · BACK UP THIS BROWSER’S MISSION RECORDS</summary><p className="fine-print">This is not part of publishing or review. It downloads only sanitized mission and proof records in an encrypted file. Use a separate passphrase of at least 12 characters.</p><label>Backup passphrase<input type="password" value={ledgerPassphrase} onChange={(event) => { setLedgerPassphrase(event.target.value); setLedgerStatus(""); }} /></label><div className="mission-actions"><button className="button button-secondary" disabled={ledgerPassphrase.length < 12} onClick={() => void backupLedger()}>DOWNLOAD ENCRYPTED BACKUP</button><label className={`button button-secondary file-button ${ledgerPassphrase.length < 12 ? "is-disabled" : ""}`}>RESTORE A BACKUP FILE<input type="file" accept="application/json,.json" disabled={ledgerPassphrase.length < 12} onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; void restoreLedgerFile(file); }} /></label></div>{ledgerStatus ? <p className="signer-result verified" role="status"><ShieldCheck size={16} />{ledgerStatus}</p> : null}<details className="advanced-paste"><summary>Advanced recovery: paste encrypted JSON</summary><label>Encrypted backup JSON<textarea value={ledgerBackup} onChange={(event) => setLedgerBackup(event.target.value)} /></label><button className="button button-secondary" disabled={ledgerPassphrase.length < 12 || !ledgerBackup.trim()} onClick={() => void restoreLedger()}>RESTORE PASTED BACKUP</button></details></details>
      {error ? <p className="form-error"><CircleAlert size={16} />{error}</p> : null}
      {!reviewed ? <p className="fine-print">No public request or message is sent from this screen until the exact-text review is complete.</p> : null}
    </>}
  </Modal>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") return onClose();
      if (event.key !== "Tab" || !modalRef.current) return;
      const focusable = [...modalRef.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = originalOverflow;
      previous?.focus();
    };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section ref={modalRef} tabIndex={-1} className={`modal ${wide ? "modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><header><span>{title}</span><button onClick={onClose} aria-label={`Close ${title.toLowerCase()}`}><X /></button></header><div className="modal-body">{children}</div></section></div>;
}

function formatCheckedAt(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "TIME UNKNOWN";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(date);
}

function shortPublicDid(value: string) {
  return value.startsWith("did:key:") && value.length > 28 ? `${value.slice(0, 18)}…${value.slice(-8)}` : value.slice(0, 42);
}

function sourceLabel(source: Mission["source"]) { return source === "technocore-signal" ? "TECHNOCORE · OFFICIAL API" : source === "kibble-community" ? "KIBBLE · COMMUNITY" : "LOCAL · PRIVATE"; }
function activityLabel(event: AgentActivity["event"]) {
  if (event === "mission.selected") return "Mission received";
  if (event === "mission.researching") return "Researching";
  if (event === "mission.building") return "Building";
  if (event === "mission.testing") return "Testing";
  return "Blocked · waiting for help";
}
function stationForState(state: ProofState): Station { return state === "review-requested" || state === "reviewed" ? "team" : ["published", "verified"].includes(state) ? "prove" : state === "claimed" ? "make" : "pick"; }
function moodForState(state: ProofState): MascotMood {
  if (state === "review-requested") return "social";
  if (state === "reviewed" || state === "verified") return "proud";
  if (state === "published") return "focused";
  if (state === "claimed") return "working";
  return "focused";
}
function proofReached(current: ProofState, target: ProofState) {
  const order: ProofState[] = ["planned", "claimed", "published", "verified", "review-requested", "reviewed"];
  return order.indexOf(current) >= order.indexOf(target);
}
function stationForEvent(event: AgentBridgeEvent["event"]): Station {
  if (event === "mission.scanning" || event === "agent.connected" || event === "agent.idle") return "spot";
  if (event === "mission.suggestions") return "pick";
  if (event === "mission.selected") return "pick";
  if (["mission.researching", "mission.building", "mission.testing", "mission.blocked"].includes(event)) return "make";
  if (event === "review.requested") return "team";
  return "prove";
}
function moodForEvent(event: AgentBridgeEvent["event"]): MascotMood {
  if (event === "agent.idle") return "ready";
  if (event === "agent.connected" || event === "mission.scanning") return "scanning";
  if (event === "mission.suggestions") return "focused";
  if (event === "mission.selected" || event === "approval.requested" || event === "proof.published") return "focused";
  if (["mission.researching", "mission.building", "mission.testing"].includes(event)) return "working";
  if (event === "mission.blocked") return "blocked";
  if (event === "review.requested") return "social";
  return "proud";
}
function Mascot({ mood, alt, compact = false }: { mood: MascotMood; alt?: string; compact?: boolean }) {
  const signal = mood === "scanning" ? <Search />
    : mood === "focused" ? <Eye />
    : mood === "working" ? <Code2 />
    : mood === "blocked" ? <CircleAlert />
    : mood === "social" ? <Users />
    : mood === "proud" ? <Check />
    : null;
  return <div className={`mascot-art mascot-art-${compact ? "compact" : "full"} mood-${mood}`}>
    <img src={mascotAsset} alt={alt || ""} />
    {signal ? <span className="mascot-signal" aria-hidden="true">{signal}</span> : null}
  </div>;
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click(); URL.revokeObjectURL(url);
}

export default App;
