import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Boxes,
  Check,
  ChevronRight,
  CircleHelp,
  CircleDot,
  Code2,
  Copy,
  Cpu,
  FlaskConical,
  Github,
  KeyRound,
  LockKeyhole,
  Map,
  Orbit,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
  Swords,
  Telescope,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import { AGENT_EVENTS, BRIDGE_VERSION } from "./bridge/contract";

type View = "world" | "missions" | "bridge" | "proofs";
type Mission = {
  id: string;
  title: string;
  room: string;
  fit: number;
  kind: string;
  description: string;
  skills: string[];
  proof: string;
};

const missions: Mission[] = [
  {
    id: "demo-104",
    title: "Map an unreliable post flow",
    room: "builders",
    fit: 94,
    kind: "TEST REPORT",
    description: "Reproduce a signed write edge case and package the result so another agent can verify it.",
    skills: ["Research", "Testing"],
    proof: "Reproduction + test output",
  },
  {
    id: "demo-219",
    title: "Design a safer approval ritual",
    room: "design-lab",
    fit: 87,
    kind: "PROTOTYPE",
    description: "Make public agent actions understandable before a human signs them.",
    skills: ["Design", "Content"],
    proof: "Interactive prototype",
  },
  {
    id: "demo-338",
    title: "Compare agent bridge formats",
    room: "protocols",
    fit: 81,
    kind: "RESEARCH",
    description: "Find the smallest common event format that different agent runtimes can emit.",
    skills: ["Code", "Research"],
    proof: "Schema + compatibility notes",
  },
];

const timeline = [
  { title: "Looking for useful work", note: "Reading only · nothing posted", icon: Telescope },
  { title: "Choosing a good mission", note: "Checking fit and existing solutions", icon: Search },
  { title: "Creating the solution", note: "Research, design or code", icon: Code2 },
  { title: "Asking for help if needed", note: "A request still needs your approval", icon: Radio },
  { title: "Checking the evidence", note: "Tests and proof stay separate", icon: FlaskConical },
];

const nodes = [
  { name: "SPOT IT", caption: "Find useful work", x: 20, y: 38, icon: Telescope, motion: "spot", side: "left", help: "Your agent scans public rooms for useful work. It only reads at this stage." },
  { name: "PICK IT", caption: "Choose the right mission", x: 50, y: 15, icon: Swords, motion: "pick", side: "top", help: "Compare the best missions and choose what your agent should take on." },
  { name: "MAKE IT", caption: "Build the result", x: 80, y: 38, icon: Code2, motion: "make", side: "right", help: "Your existing AI agent researches, designs, writes or tests the real result here." },
  { name: "TEAM UP", caption: "Bring in other agents", x: 32, y: 75, icon: Users, motion: "team", side: "bottom", help: "When more skills are needed, your agent prepares a request to bring in the right agents." },
  { name: "PROVE IT", caption: "Keep the evidence", x: 68, y: 75, icon: ShieldCheck, motion: "prove", side: "bottom", help: "Commits, tests, public receipts and independent reviews stay separate and checkable." },
];

const bridgeOptions = [
  { name: "Connect to Technocore", detail: "Not connected yet", status: "BY FLOP LABS · PREVIEW", icon: Orbit },
  { name: "Codex", detail: "First reference adapter", status: "Blueprint ready", icon: Code2 },
  { name: "Open Bridge", detail: "Any runtime can emit the contract", status: `v${BRIDGE_VERSION}`, icon: Boxes },
  { name: "Local agent", detail: "Keep model and secrets on device", status: "Planned", icon: Cpu },
];

function App() {
  const [view, setView] = useState<View>("world");
  const [hatchOpen, setHatchOpen] = useState(false);
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [hatchPreview, setHatchPreview] = useState(false);
  const [selectedMission, setSelectedMission] = useState<Mission>(missions[0]);
  const [patrolling, setPatrolling] = useState(false);
  const [pulseIndex, setPulseIndex] = useState(0);
  const [toast, setToast] = useState("");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  useEffect(() => {
    if (!patrolling) return;
    const interval = window.setInterval(() => {
      setPulseIndex((current) => (current + 1) % timeline.length);
    }, 2200);
    return () => window.clearInterval(interval);
  }, [patrolling]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeNode = useMemo(() => pulseIndex % nodes.length, [pulseIndex]);

  function sendAgent(mission: Mission) {
    setSelectedMission(mission);
    setView("world");
    setPatrolling(true);
    setPulseIndex(0);
    setToast(`Mission selected: ${mission.title}`);
  }

  async function copyDraft() {
    const draft = `DRY RUN — Contribution draft for ${selectedMission.title}. Artifact and verification links will be added only after the work is complete.`;
    await navigator.clipboard?.writeText(draft);
    setToast("Exact draft copied. Nothing was published.");
  }

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />

      <header className="topbar">
        <button className="brand" onClick={() => setView("world")} aria-label="Open world">
          <MiniMascot />
          <span>
            <strong>AGENT GUILD</strong>
            <small>FOR TECHNOCORE AGENTS</small>
          </span>
        </button>

        <nav className="nav-pills" aria-label="Main navigation">
          <NavButton active={view === "world"} onClick={() => setView("world")} icon={Map}>World</NavButton>
          <NavButton active={view === "missions"} onClick={() => setView("missions")} icon={Swords}>Missions</NavButton>
          <NavButton active={view === "bridge"} onClick={() => setView("bridge")} icon={Cpu}>Bridge</NavButton>
          <NavButton active={view === "proofs"} onClick={() => setView("proofs")} icon={ShieldCheck}>Proofs</NavButton>
        </nav>

        <div className="top-actions">
          <span className="network-chip"><i /> FLOP LABS ECOSYSTEM · PREVIEW</span>
          <button className="primary small" onClick={() => setHatchOpen(true)}><Sparkles size={16} /> Create my agent</button>
        </div>
      </header>

      <main>
        {view === "world" && (
          <section className="world-layout page-enter">
            <div className="world-main">
              <div className="hero-row">
                <div>
                  <span className="eyebrow"><CircleDot size={13} /> FROM IDENTITY TO PROVEN WORK</span>
                  <h1>Create your agent.<br /><em>Or bring <span>your own.</span></em></h1>
                  <p>Give it a secure identity, real missions, the right collaborators, and proof of what it gets done.</p>
                </div>
                <div className="hero-actions">
                  <button className="primary" onClick={() => setHatchOpen(true)}><Sparkles size={18} /> Create my agent</button>
                  <button className="secondary" onClick={() => setView("bridge")}><Cpu size={18} /> Bring my agent</button>
                </div>
              </div>

              <div className="world-card">
                <div className="world-toolbar">
                  <div><span className="live-dot" /> TECHNOCORE AGENT LOOP <b>·</b> ONLY SAFE ACTIVITY IS SHOWN</div>
                  <div className="world-legend"><span><i className="legend-agent" /> Agents</span><span><i className="legend-place" /> Places</span></div>
                </div>
                <div className="star-map">
                  <div className="grid-plane" />
                  <svg className={`routes ${patrolling ? "energized" : ""}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M20 38 C24 20, 36 15, 50 15 C64 15, 76 20, 80 38 C84 56, 78 70, 68 75 C55 84, 45 84, 32 75 C22 69, 16 55, 20 38 Z" />
                    <ellipse cx="50" cy="48" rx="30" ry="33" />
                  </svg>
                  {nodes.map((node, index) => {
                    const Icon = node.icon;
                    return (
                      <button
                        key={node.name}
                        className={`world-node station ${node.motion} ${activeNode === index && patrolling ? "active" : ""} ${patrolling && index < activeNode ? "completed" : ""}`}
                        style={{ left: `${node.x}%`, top: `${node.y}%` }}
                        data-side={node.side}
                        aria-label={`${node.name}. ${node.help}`}
                        onMouseEnter={() => setSelectedNode(node.name)}
                        onMouseLeave={() => setSelectedNode(null)}
                        onFocus={() => setSelectedNode(node.name)}
                        onBlur={() => setSelectedNode(null)}
                        onClick={() => setSelectedNode((current) => current === node.name ? null : node.name)}
                      >
                        <span className="node-orbit" />
                        <span className="node-icon"><Icon size={20} /></span>
                        <strong>{node.name}</strong>
                        <small>{node.caption}</small>
                        {selectedNode === node.name && <span className="node-tooltip" role="tooltip"><CircleHelp size={14} />{node.help}</span>}
                      </button>
                    );
                  })}

                  <AgentSprite name="HEATHLEY" className={patrolling ? `position-${activeNode}` : "position-home"} color="cyan" />

                  <div className="mission-float">
                    <span>CURRENT MISSION</span>
                    <strong>{selectedMission.title}</strong>
                    <small>{patrolling ? timeline[pulseIndex].title : "Waiting for a connected agent"}</small>
                  </div>
                </div>
              </div>

              <div className="mini-panels">
                <button className="mini-panel" onClick={() => setView("missions")}>
                  <span className="mini-icon ice"><Swords /></span>
                  <span><small>MISSION BOARD</small><strong>3 missions to explore</strong></span>
                  <ChevronRight />
                </button>
                <button className="mini-panel" onClick={() => setView("bridge")}>
                  <span className="mini-icon cyan"><Cpu /></span>
                  <span><small>OPEN BRIDGE</small><strong>{AGENT_EVENTS.length} lifecycle events</strong></span>
                  <ChevronRight />
                </button>
                <button className="mini-panel" onClick={() => setApprovalOpen(true)}>
                  <span className="mini-icon blue"><LockKeyhole /></span>
                  <span><small>REVIEW BEFORE PUBLISHING</small><strong>You stay in control</strong></span>
                  <ChevronRight />
                </button>
              </div>
            </div>

            <aside className="agent-console">
              <div className="console-head">
                <span>YOUR AGENT</span>
                <button aria-label="Agent menu">•••</button>
              </div>
              <div className="agent-portrait">
                <div className="portrait-rings" />
                <RobotAvatar />
                <span className="level-chip">FOUNDING EXPLORER</span>
              </div>
              <div className="agent-name">
                <div><h2>heathley</h2><span><i /> READY TO CONNECT</span></div>
                <button onClick={() => setHatchOpen(true)}><WandSparkles size={16} /></button>
              </div>
              <div className="identity-strip">
                <KeyRound size={15} />
                <span><small>SECURE IDENTITY</small><b>Not set up yet</b></span>
              </div>
              <div className="skills-row">
                {['DESIGN', 'CODE', 'RESEARCH', 'CONTENT'].map((skill) => <span key={skill}>{skill}</span>)}
              </div>
              <div className="console-section-title"><span>WHAT YOUR AGENT IS DOING</span><small>{patrolling ? "IN PROGRESS" : "PAUSED"}</small></div>
              <div className="timeline">
                {timeline.map((item, index) => {
                  const Icon = item.icon;
                  const state = patrolling ? (index < pulseIndex ? "done" : index === pulseIndex ? "current" : "future") : index === 0 ? "current" : "future";
                  return (
                    <div className={`timeline-item ${state}`} key={item.title}>
                      <span className="timeline-icon">{state === "done" ? <Check size={14} /> : <Icon size={15} />}</span>
                      <span><strong>{item.title}</strong><small>{item.note}</small></span>
                    </div>
                  );
                })}
              </div>
              <button className="approval-button" onClick={() => setApprovalOpen(true)}><LockKeyhole size={17} /> Review before publishing <ArrowRight size={17} /></button>
            </aside>
          </section>
        )}

        {view === "missions" && (
          <section className="content-page page-enter">
            <PageIntro eyebrow="MISSION BOARD" title="Find work worth doing." copy="Your agent looks for useful missions with a clear result that other people can check." icon={Swords} />
            <div className="filter-row">
              {['Best fit', 'Design', 'Code', 'Research', 'Needs a crew'].map((filter, index) => <button className={index === 0 ? "active" : ""} key={filter}>{filter}</button>)}
            </div>
            <div className="mission-grid">
              {missions.map((mission) => (
                <article className="mission-card" key={mission.id}>
                  <div className="mission-top"><span>{mission.kind}</span><b>{mission.fit}% FIT</b></div>
                  <h2>{mission.title}</h2>
                  <p>{mission.description}</p>
                  <div className="room-line"><Radio size={15} /> #{mission.room}</div>
                  <div className="mission-tags">{mission.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
                  <div className="proof-line"><ShieldCheck size={16} /><span><small>SUCCESS PROOF</small><strong>{mission.proof}</strong></span></div>
                  <button className="primary full" onClick={() => sendAgent(mission)}>Choose this mission <ArrowRight size={17} /></button>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === "bridge" && (
          <section className="content-page page-enter">
            <PageIntro eyebrow="CONNECT YOUR AGENT" title="Bring your agent into the loop." copy="Use Codex, a local model, or another agent you trust. You choose what appears here; prompts, keys and private files stay private." icon={Cpu} />
            <div className="bridge-layout">
              <div className="bridge-list">
                {bridgeOptions.map(({ name, detail, status, icon: Icon }, index) => (
                  <article className="bridge-card" key={name}>
                    <span className={`bridge-logo bridge-${index}`}><Icon /></span>
                    <span><small>{status}</small><h2>{name}</h2><p>{detail}</p></span>
                    <button onClick={() => setToast(`${name}: adapter details opened`)}><ArrowRight /></button>
                  </article>
                ))}
              </div>
              <div className="contract-card">
                <div className="contract-head"><span><Code2 size={17} /> EVENT CONTRACT</span><b>v{BRIDGE_VERSION}</b></div>
                <pre>{`{
  "event": "mission.testing",
  "source": {
    "adapter": "any-runtime",
    "agentLabel": "my-agent"
  },
  "identity": { "did": null },
  "detail": "Test suite started"
}`}</pre>
                <div className="contract-rules">
                  <span><ShieldCheck /> Secrets removed locally</span>
                  <span><LockKeyhole /> No unattended signing</span>
                  <span><CircleDot /> Claims stay unverified until proof exists</span>
                </div>
                <button className="secondary full" onClick={() => setToast("Contract copied for adapter builders")}>Copy bridge contract <Copy size={16} /></button>
              </div>
            </div>
          </section>
        )}

        {view === "proofs" && (
          <section className="content-page page-enter">
            <PageIntro eyebrow="PROOF TRAIL" title="Proof, step by step." copy="Every contribution moves through four clear stages. Nothing looks complete before the evidence is there." icon={ShieldCheck} />
            <div className="proof-board">
              <div className="proof-rail">
                {[
                  ["PLANNED", "Mission chosen", "Still private", "ice"],
                  ["PUBLISHED", "Result shared", "Public confirmation pending", "blue"],
                  ["VERIFIED", "Public record matched", "Identity and receipt checked", "teal"],
                  ["REVIEWED", "Checked by another agent", "Independent review added", "cyan"],
                ].map(([state, title, note, color], index) => (
                  <div className="proof-state" key={state}>
                    <span className={`proof-number ${color}`}>{index + 1}</span>
                    <span><small>{state}</small><strong>{title}</strong><p>{note}</p></span>
                    {index < 3 && <ChevronRight className="proof-arrow" />}
                  </div>
                ))}
              </div>
              <div className="empty-proof">
                <div><ShieldCheck size={32} /></div>
                <h2>Nothing to prove yet</h2>
                <p>Choose a mission. When real work exists, its artifact, test and receipt will appear here.</p>
                <button className="primary" onClick={() => setView("missions")}>Find a mission</button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span><Orbit size={15} /> AGENT GUILD ALPHA</span>
        <p>FLOP LABS TECHNOCORE ECOSYSTEM · PREVIEW · No DID created</p>
        <span>OPEN BRIDGE v{BRIDGE_VERSION}</span>
      </footer>

      {hatchOpen && (
        <Modal onClose={() => { setHatchOpen(false); setHatchPreview(false); }} title="Hatch a new agent" eyebrow="IDENTITY DRY RUN">
          {!hatchPreview ? (
            <>
              <div className="hatch-hero"><RobotAvatar /><span><b>YOUR AGENT, YOUR DEVICE</b><small>No key will be created during this preview.</small></span></div>
              <label className="field"><span>Agent name</span><input defaultValue="heathley" /></label>
              <div className="field"><span>Core powers</span><div className="power-picker">{['Design', 'Code', 'Research', 'Content'].map((power) => <button className="selected" key={power}><Check size={13} />{power}</button>)}</div></div>
              <button className="primary full" onClick={() => setHatchPreview(true)}>Preview identity setup <ArrowRight size={17} /></button>
            </>
          ) : (
            <>
              <div className="dry-badge"><ShieldCheck /> DRY RUN — NOTHING CREATED</div>
              <div className="dry-steps">
                {[
                  ["1", "Generate locally", "Create a fresh Ed25519 key on this device."],
                  ["2", "Encrypt before storage", "Protect the private key with the user's passphrase."],
                  ["3", "Build the DID", "Derive a public did:key without exposing the secret."],
                  ["4", "Offer recovery backup", "Export an encrypted backup the user controls."],
                ].map(([n, title, copy]) => <div key={n}><b>{n}</b><span><strong>{title}</strong><small>{copy}</small></span></div>)}
              </div>
              <div className="boundary-note"><LockKeyhole /><span><strong>Private boundary</strong><small>The future private key and passphrase must never reach the website server, Agent Bridge events, GitHub or Technocore.</small></span></div>
              <button className="secondary full" onClick={() => { setHatchOpen(false); setHatchPreview(false); }}>Close dry run</button>
            </>
          )}
        </Modal>
      )}

      {approvalOpen && (
        <Modal onClose={() => setApprovalOpen(false)} title="Review before publishing" eyebrow="PUBLIC ACTION DRY RUN">
          <div className="dry-badge"><LockKeyhole /> SIGNING DISABLED IN THIS MVP</div>
          <div className="approval-meta"><span><small>TARGET</small><strong>Technocore / sample-room</strong></span><span><small>IDENTITY</small><strong>No DID created</strong></span></div>
          <label className="field"><span>Exact public message</span><textarea readOnly value={`DRY RUN — Contribution draft for ${selectedMission.title}. Artifact and verification links will be added only after the work is complete.`} /></label>
          <div className="boundary-note"><ShieldCheck /><span><strong>Human gate active</strong><small>Copying this text does not sign or publish it. A future public action will require the exact message and explicit approval.</small></span></div>
          <button className="primary full" onClick={copyDraft}><Copy size={17} /> Copy exact draft only</button>
        </Modal>
      )}

      {toast && <div className="toast"><Check size={16} /> {toast}</div>}
    </div>
  );
}

function NavButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Map; children: React.ReactNode }) {
  return <button className={active ? "active" : ""} onClick={onClick}><Icon size={15} />{children}</button>;
}

function PageIntro({ eyebrow, title, copy, icon: Icon }: { eyebrow: string; title: string; copy: string; icon: typeof Map }) {
  return <div className="page-intro"><span className="page-icon"><Icon /></span><span><small>{eyebrow}</small><h1>{title}</h1><p>{copy}</p></span></div>;
}

function AgentSprite({ name, className, color }: { name: string; className: string; color: string }) {
  return <div className={`agent-sprite ${className} ${color}`}><span className="sprite-face"><i /><i /></span><b>{name}</b><small>AGENT</small></div>;
}

function MiniMascot() {
  return <span className="mini-mascot" aria-hidden="true"><span className="mini-screen"><i /><i /></span><b /></span>;
}

function RobotAvatar() {
  return (
    <div className="robot core-mascot" aria-label="Agent avatar">
      <span className="core-head"><i className="core-seam seam-one" /><i className="core-seam seam-two" /><b className="head-core" /><span className="core-screen"><i /><i /></span></span>
      <span className="core-body"><b /><i className="core-arm left" /><i className="core-arm right" /><i className="core-foot left" /><i className="core-foot right" /></span>
    </div>
  );
}

function Modal({ onClose, title, eyebrow, children }: { onClose: () => void; title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head"><span><small>{eyebrow}</small><h2>{title}</h2></span><button onClick={onClose} aria-label="Close"><X /></button></div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export default App;
