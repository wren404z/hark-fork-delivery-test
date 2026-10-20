window.__ModuleLoader__.load({
  id: "dsh-hark-subagent",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");

    var WS_URL = "ws://127.0.0.1:8920/ws";

    function useHarkBoard(open) {
      var s = react.useState({ live: false, jobs: [], error: "", at: 0 });
      var state = s[0], setState = s[1];
      react.useEffect(function () {
        if (!open) return;
        var ws = null, timer = null, closed = false, backoff = 1000;
        function connect() {
          try { ws = new WebSocket(WS_URL); } catch (e) {
            setState(function (p) { return { live: false, jobs: p.jobs, error: String(e && e.message || e), at: Date.now() }; });
            return;
          }
          ws.onopen = function () { backoff = 1000; setState(function (p) { return { live: true, jobs: p.jobs, error: "", at: Date.now() }; }); };
          ws.onmessage = function (ev) {
            var msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (!msg || msg.type === "ping") return;
            setState(function (p) {
              var jobs = p.jobs.slice();
              if (msg.type === "snapshot" && Array.isArray(msg.jobs)) jobs = msg.jobs.slice();
              else if (msg.type === "job" && msg.job) {
                var i = jobs.findIndex(function (j) { return j.job_id === msg.job.job_id; });
                if (i >= 0) jobs[i] = msg.job; else jobs.push(msg.job);
              } else return p;
              jobs.sort(function (a, b) { return (b.created_at || 0) - (a.created_at || 0); });
              return { live: true, jobs: jobs, error: "", at: Date.now() };
            });
          };
          ws.onclose = function () {
            setState(function (p) { return { live: false, jobs: p.jobs, error: "已断开 (重连中)", at: Date.now() }; });
            if (!closed) { timer = setTimeout(connect, backoff); backoff = Math.min(backoff * 2, 15000); }
          };
          ws.onerror = function () {};
        }
        connect();
        return function () { closed = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) {} };
      }, [open]);
      return state;
    }

    function pill(text, kind) {
      var bg = kind === "ok" ? "#14361f" : kind === "warn" ? "#3a2f14" : kind === "bad" ? "#3a1618" : "#232a34";
      var fg = kind === "ok" ? "#7ee2a8" : kind === "warn" ? "#ffd479" : kind === "bad" ? "#ff9a9a" : "#d7dae0";
      return react.createElement("span", {
        style: { background: bg, color: fg, padding: "1px 8px", borderRadius: 10, fontSize: 12 }
      }, text);
    }

    function kindOf(state) {
      if (state === "RUNNING" || state === "DONE") return "ok";
      if (state === "STALE" || state === "QUEUED" || state === "ACQUIRING" || state === "BINDING" || state === "PROJECT") return "warn";
      if (state === "FAILED" || state === "CANCELLED") return "bad";
      return "";
    }

    function BoardPanel(props) {
      var s = useHarkBoard(props.open);
      if (!props.open) return null;
      var rows = s.jobs.map(function (j) {
        return react.createElement("tr", { key: j.job_id, style: { borderBottom: "1px solid #232a34" } },
          react.createElement("td", { style: { padding: "4px 8px", fontFamily: "ui-monospace,monospace" } }, j.job_id),
          react.createElement("td", { style: { padding: "4px 8px" } }, pill(j.state || "?", kindOf(j.state))),
          react.createElement("td", { style: { padding: "4px 8px" } }, String(j.rounds == null ? "-" : j.rounds)),
          react.createElement("td", { style: { padding: "4px 8px" } }, j.hark_account || "-"),
          react.createElement("td", { style: { padding: "4px 8px" } }, j.gh_user || "-"),
          react.createElement("td", { style: { padding: "4px 8px", maxWidth: 320, overflowWrap: "anywhere", color: "#ff9a9a" } },
            (j.last_error || "").slice(0, 120))
        );
      });
      return react.createElement("div", {
        style: { position: "fixed", right: 16, top: 64, width: 720, maxHeight: "60vh", overflow: "auto",
                 background: "#0f1115", color: "#d7dae0", border: "1px solid #262c36", borderRadius: 10,
                 boxShadow: "0 8px 30px rgba(0,0,0,.5)", zIndex: 9999, fontSize: 13 }
      },
        react.createElement("div", { style: { display: "flex", gap: 10, alignItems: "center", padding: "10px 12px", borderBottom: "1px solid #262c36" } },
          react.createElement("b", null, "hark 子 agent"),
          pill(s.live ? "WS 实时" : (s.error || "未连接"), s.live ? "ok" : "warn"),
          pill("作业 " + s.jobs.length, ""),
          react.createElement("span", { style: { marginLeft: "auto", cursor: "pointer", color: "#8b93a1" }, onClick: props.onClose }, "关闭")
        ),
        react.createElement("table", { style: { borderCollapse: "collapse", width: "100%" } },
          react.createElement("thead", null, react.createElement("tr", null,
            ["作业号", "状态", "轮次", "hark 号", "gh 号", "最后错误"].map(function (h) {
              return react.createElement("th", { key: h, style: { textAlign: "left", padding: "6px 8px", color: "#8b93a1", fontSize: 12 } }, h);
            }))),
          react.createElement("tbody", null, rows.length ? rows : react.createElement("tr", null,
            react.createElement("td", { colSpan: 6, style: { padding: 14, color: "#8b93a1" } }, "暂无作业")))
        )
      );
    }

    function HarkAction() {
      var s = react.useState(false);
      var open = s[0], setOpen = s[1];
      return react.createElement(react.Fragment, null,
        react.createElement("button", {
          type: "button",
          onClick: function () { setOpen(!open); },
          title: "hark 子 agent 作业",
          style: { background: open ? "#232a34" : "transparent", color: "inherit", border: "1px solid #262c36",
                   borderRadius: 6, padding: "2px 8px", cursor: "pointer", fontSize: 12 }
        }, "hark"),
        react.createElement(BoardPanel, { open: open, onClose: function () { setOpen(false); } })
      );
    }

    // 注册到会话头部动作区 (与 @deepseek-ai/dsh-client-ui-jobs 同一槽位)
    var inject = ["slots"];
    function apply(ctx) {
      ctx.effect(function () {
        return ctx.slots.inject("conversation.session.header.actions", function () {
          return ctx.slots.register({
            name: "conversation.session.header.actions",
            id: "hark-board",
            order: 30,
          }, HarkAction);
        });
      }, "hark-board");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
