"use client";

export default function AgentControls({
  settings = {},
  onToggleAutopilot,
  onToggleKillSwitch,
  onRunAgents,
  running = false,
}) {
  const isEnabled = settings.enabled !== false;
  const isAutopilot = Boolean(settings.autopilot);

  return (
    <div className="agent-controls-bar">
      <div className="agent-controls-left">
        <button
          className="btn-agent-run"
          disabled={running || !isEnabled}
          onClick={onRunAgents}
        >
          {running ? "Running agent loop..." : "Run agents now"}
        </button>

        <label className="agent-toggle-label">
          <input
            type="checkbox"
            checked={isAutopilot}
            disabled={!isEnabled}
            onChange={(e) => onToggleAutopilot(e.target.checked)}
          />
          <span>Autopilot {isAutopilot ? "(direct sending)" : "(approval required)"}</span>
        </label>

        <label className="agent-toggle-label kill-switch-label">
          <input
            type="checkbox"
            checked={!isEnabled}
            onChange={(e) => onToggleKillSwitch(!e.target.checked)}
          />
          <span className={!isEnabled ? "kill-switch-active" : ""}>
            Kill switch {!isEnabled ? "[BLOCKED]" : "[ACTIVE]"}
          </span>
        </label>
      </div>

      <div className="agent-controls-meta">
        <span>Last run: {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleTimeString() : "Never"}</span>
        <span>Scheduled: {settings.nextRunAt ? new Date(settings.nextRunAt).toLocaleTimeString() : "Every 4h"}</span>
      </div>
    </div>
  );
}

