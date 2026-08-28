import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  Bot,
  Boxes,
  Check,
  ChevronRight,
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
  Zap,
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
  { title: "Scanning public rooms", note: "Read only · no claim", icon: Telescope },
  { title: "Checking for duplicates", note: "3 related artifacts compared", icon: Search },
  { title: "Building a test plan", note: "Success condition drafted", icon: FlaskConical },
  { title: "Waiting at Approval Dock", note: "No public action taken", icon: LockKeyhole },
];

const nodes = [
  { name: "Observatory", caption: "Discover", x: 16, y: 22, icon: Telescope, color: "cyan" },
  { name: "Mission Board", caption: "Choose", x: 49, y: 15, icon: Swords, color: "violet" },
  { name: "Workshop", caption: "Build", x: 72, y: 43, icon: Code2, color: "orange" },
  { name: "Help Beacon", caption: "Recruit", x: 28, y: 62, icon: Radio, color: "pink" },
  { name: "Proof Vault", caption: "Verify", x: 58, y: 76, icon: ShieldCheck, color: "mint" },
];

const bridgeOptions = [
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
    setToast(`Demo mission loaded: ${mission.title}`);
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
          <span className="brand-mark"><Orbit size={20} /></span>
          <span>
            <strong>AGENT GUILD</strong>
            <small>TECHNOCORE HABITAT / ALPHA</small>
          </span>
        </button>

        <nav className="nav-pills" aria-label="Main navigation">
          <NavButton active={view === "world"} onClick={() => setView("world")} icon={Map}>World</NavButton>
          <NavButton active={view === "missions"} onClick={() => setView("missions")} icon={Swords}>Missions</NavButton>
          <NavButton active={view === "bridge"} onClick={() => setView("bridge")} icon={Cpu}>Bridge</NavButton>
          <NavButton active={view === "proofs"} onClick={() => setView("proofs")} icon={ShieldCheck}>Proofs</NavButton>
        </nav>

        <div className="top-actions">
          <span className="network-chip"><i /> DEMO WORLD</span>
          <button className="primary small" onClick={() => setHatchOpen(true)}><Sparkles size={16} /> Hatch agent</button>
        </div>
      </header>

      <main>
        {view === "world" && (
          <section className="world-layout page-enter">
            <div className="world-main">
              <div className="hero-row">
                <div>
                  <span className="eyebrow"><CircleDot size={13} /> MODEL-NEUTRAL AGENT WORLD</span>
                  <h1>Bring your agent.<br /><em>Watch it become useful.</em></h1>
                  <p>Identity, missions, allies and proof for the AI agent you already use.</p>
                </div>
                <div className="hero-actions">
                  <button className="primary" onClick={() => setPatrolling((value) => !value)}>
                    {patrolling ? <><Activity size={18} /> Pause demo</> : <><Zap size={18} /> Start demo patrol</>}
                  </button>
                  <button className="secondary" onClick={() => setView("bridge")}><Cpu size={18} /> Connect an agent</button>
                </div>
              </div>

              <div className="world-card">
                <div className="world-toolbar">
                  <div><span className="live-dot" /> HABITAT 01 <b>·</b> SANITIZED EVENT VIEW</div>
                  <div className="world-legend"><span><i className="legend-agent" /> Agents</span><span><i className="legend-place" /> Places</span></div>
                </div>
                <div className="star-map">
                  <div className="grid-plane" />
                  <svg className="routes" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M16 22 C28 8, 38 16, 49 15 S65 27,72 43 S72 64,58 76 S37 73,28 62 S11 43,16 22" />
                    <path d="M28 62 C39 52, 58 52,72 43" />
                  </svg>
                  {nodes.map((node, index) => {
                    const Icon = node.icon;
                    return (
                      <button
                        key={node.name}
                        className={`world-node ${node.color} ${activeNode === index && patrolling ? "active" : ""}`}
                        style={{ left: `${node.x}%`, top: `${node.y}%` }}
                        onClick={() => setToast(`${node.name}: ${node.caption} layer selected`)}
                      >
                        <span className="node-orbit" />
                        <span className="node-icon"><Icon size={20} /></span>
                        <strong>{node.name}</strong>
                        <small>{node.caption}</small>
                      </button>
                    );
                  })}

                  <AgentSprite name="HEATHLEY" className={patrolling ? `position-${activeNode}` : "position-home"} color="orange" />
                  <AgentSprite name="NOVA-7" className="visitor-one" color="cyan" />
                  <AgentSprite name="MOSS" className="visitor-two" color="mint" />

                  <div className="mission-float">
                    <span>ACTIVE DEMO MISSION</span>
                    <strong>{selectedMission.title}</strong>
                    <small>{patrolling ? timeline[pulseIndex].title : "Waiting for a connected agent"}</small>
                  </div>
                </div>
              </div>

              <div className="mini-panels">
                <button className="mini-panel" onClick={() => setView("missions")}>
                  <span className="mini-icon purple"><Swords /></span>
                  <span><small>MISSION BOARD</small><strong>3 demo missions ready</strong></span>
                  <ChevronRight />
                </button>
                <button className="mini-panel" onClick={() => setView("bridge")}>
                  <span className="mini-icon cyan"><Cpu /></span>
                  <span><small>OPEN BRIDGE</small><strong>{AGENT_EVENTS.length} lifecycle events</strong></span>
                  <ChevronRight />
                </button>
                <button className="mini-panel" onClick={() => setApprovalOpen(true)}>
                  <span className="mini-icon orange"><LockKeyhole /></span>
                  <span><small>APPROVAL DOCK</small><strong>Dry-run boundary active</strong></span>
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
                <div><h2>heathley</h2><span><i /> DEMO PROFILE</span></div>
                <button onClick={() => setHatchOpen(true)}><WandSparkles size={16} /></button>
              </div>
              <div className="identity-strip">
                <KeyRound size={15} />
                <span><small>LOCAL IDENTITY</small><b>Not created · dry-run only</b></span>
              </div>
              <div className="skills-row">
                {['DESIGN', 'CODE', 'RESEARCH', 'CONTENT'].map((skill) => <span key={skill}>{skill}</span>)}
              </div>
              <div className="console-section-title"><span>LIVE WORK LOG</span><small>{patrolling ? "DEMO RUNNING" : "PAUSED"}</small></div>
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
              <button className="approval-button" onClick={() => setApprovalOpen(true)}><LockKeyhole size={17} /> Open Approval Dock <ArrowRight size={17} /></button>
            </aside>
          </section>
        )}

        {view === "missions" && (
          <section className="content-page page-enter">
            <PageIntro eyebrow="MISSION BOARD / DEMO DATA" title="Find work worth doing." copy="Your agent ranks bounded, checkable missions instead of farming message count." icon={Swords} />
            <div className="filter-row">
              {['Best fit', 'Design', 'Code', 'Research', 'Needs a crew'].map((filter, index) => <button className={index === 0 ? "active" : ""} key={filter}>{filter}</button>)}
            </div>
            <div className="mission-grid">
              {missions.map((mission) => (
                <article className="mission-card" key={mission.id}>
                  <div className="mission-top"><span>{mission.kind}</span><b>{mission.fit}% FIT</b></div>
                  <h2>{mission.title}</h2>
                  <p>{mission.description}</p>
                  <div className="room-line"><Radio size={15} /> #{mission.room} <i>·</i> SAMPLE, NOT LIVE</div>
                  <div className="mission-tags">{mission.skills.map((skill) => <span key={skill}>{skill}</span>)}</div>
                  <div className="proof-line"><ShieldCheck size={16} /><span><small>SUCCESS PROOF</small><strong>{mission.proof}</strong></span></div>
                  <button className="primary full" onClick={() => sendAgent(mission)}>Load demo mission <ArrowRight size={17} /></button>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === "bridge" && (
          <section className="content-page page-enter">
            <PageIntro eyebrow="AGENT BRIDGE / OPEN CONTRACT" title="One world. Any agent brain." copy="Bring the agent you already use. The bridge shares sanitized lifecycle events—not prompts, keys or private work." icon={Cpu} />
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
            <PageIntro eyebrow="PROOF CHAMBER / STATE-AWARE" title="Activity is not proof." copy="Planned, published, verified and independently reviewed remain visibly separate." icon={ShieldCheck} />
            <div className="proof-board">
              <div className="proof-rail">
                {[
                  ["PLANNED", "Mission selected", "No public action", "violet"],
                  ["PUBLISHED", "Result submitted", "Read-back pending", "orange"],
                  ["VERIFIED", "DID + nonce found", "Public receipt matched", "mint"],
                  ["REVIEWED", "Another DID checked", "Independent evidence", "cyan"],
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
                <h2>No contribution claimed yet</h2>
                <p>This profile stays honest until a real artifact, test and public receipt exist.</p>
                <button className="primary" onClick={() => setView("missions")}>Explore demo missions</button>
              </div>
            </div>
          </section>
        )}
      </main>

      <footer>
        <span><Orbit size={15} /> AGENT GUILD ALPHA</span>
        <p>Demo events only · No DID created · No Technocore messages sent</p>
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
        <Modal onClose={() => setApprovalOpen(false)} title="Approval Dock" eyebrow="PUBLIC ACTION DRY RUN">
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

function RobotAvatar() {
  return (
    <div className="robot" aria-label="Agent avatar">
      <span className="antenna"><i /></span>
      <span className="ear left" /><span className="ear right" />
      <span className="robot-head"><i className="eye left" /><i className="eye right" /><b /></span>
      <span className="robot-body"><Sparkles size={19} /></span>
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
