/* Club PB site. Reads window.PB_DATA from data.js, which
   `python3 -m skating build` writes. Plain JavaScript, no build step. */
(() => {
  "use strict";

  const DATA = window.PB_DATA;
  const EVENTS = DATA.events;
  const MEETS = DATA.meets;
  const app = document.getElementById("app");
  const SVG_NS = "http://www.w3.org/2000/svg";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  /* ---------- helpers ---------- */

  function setAttrs(el, attrs) {
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
  }

  // Builds DOM with text nodes only, so names from the data can't inject markup.
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    setAttrs(el, attrs);
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }

  function svg(tag, attrs, text) {
    const el = document.createElementNS(SVG_NS, tag);
    setAttrs(el, attrs);
    if (text != null) el.textContent = text;
    return el;
  }

  function parseDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function fmtDate(iso) {
    const d = parseDate(iso);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }
  function fmtShortDate(iso) {
    const d = parseDate(iso);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  }

  // Short track times are to the thousandth; long track mostly to the hundredth.
  function fmtTime(t, discipline) {
    if (t == null) return "";
    const ms = Math.round(t * 1000);
    const decimals = discipline === "long" && ms % 10 === 0 ? 2 : 3;
    const minutes = Math.floor(ms / 60000);
    const secs = ((ms - minutes * 60000) / 1000).toFixed(decimals);
    return minutes ? `${minutes}:${secs.padStart(decimals + 3, "0")}` : secs;
  }
  const fmtGain = (prev, t) => `−${(prev - t).toFixed(2)} s`;
  // Standard deviations from an average, plus if faster: "+1.2", "−0.4", "0.0".
  function fmtZ(z, digits = 1) {
    const f = 10 ** digits, r = Math.round(z * f) / f;
    return r > 0 ? `+${r.toFixed(digits)}` : r < 0 ? `−${(-r).toFixed(digits)}` : (0).toFixed(digits);
  }
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  const trackName = (ev) => (ev.discipline === "long" ? "long track" : `${ev.track} m track`);
  const trackGroup = (ev) => (ev.discipline === "long" ? "Long track (400 m oval)" : `Short track, ${ev.track} m`);
  // A meet's source link: most are PDFs, a Quebec meet can be a results page.
  const sourceLink = (m) => h("a", { href: m.source_url }, m.pdf === false ? "Results" : "Results PDF");

  // The PDF buttons are links. In a claude.ai preview the page runs in a frame
  // that can't open files, so there a button offers the PDF to save instead,
  // through the viewer's downloads capability.
  const downloads = window.claude && typeof window.claude.use === "function"
    ? window.claude.use("downloads").catch(() => null) : null;
  function pdfButton(file, label) {
    const save = (e) => {
      e.preventDefault();
      downloads.then(async (d) => {
        try {
          if (!d) throw new Error("no downloads here");
          const data = await (await fetch(file)).blob();
          await d.save({ filename: `${DATA.club} ${label.replace(/ \(PDF\)$/, "")}.pdf`, data });
        } catch (err) {
          if (err.code !== "declined") window.open(file, "_blank", "noopener");
        }
      });
    };
    return h("a", { class: "button", href: file, target: "_blank", rel: "noopener", onclick: downloads && save }, label);
  }
  const eventName = (key) => `${EVENTS[key].label}, ${trackName(EVENTS[key])}`;
  function compareEvents(a, b) {
    const A = EVENTS[a], B = EVENTS[b];
    return (A.discipline === "long") - (B.discipline === "long") || B.track - A.track || A.distance - B.distance;
  }
  // A distance picker's options, grouped by track. `events` maps each key to
  // its label, discipline and track (DATA.events or DATA.coaches.events).
  function eventOptions(keys, events) {
    const groups = [];
    for (const k of keys) {
      const label = trackGroup(events[k]);
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push(h("optgroup", { label }));
      groups[groups.length - 1].append(h("option", { value: k }, events[k].label));
    }
    return groups;
  }

  const meetIds = Object.keys(MEETS).sort((a, b) => MEETS[a].start_date.localeCompare(MEETS[b].start_date));
  const meetIndex = new Map(meetIds.map((m, i) => [m, i]));
  const byMeetDate = (a, b) => meetIndex.get(a) - meetIndex.get(b);
  const meetName = (id) => MEETS[id].short_name || MEETS[id].name;

  /* ---------- skaters ---------- */

  // A time counts if it exists and wasn't flagged (placeholder, held for review, excluded).
  const counts = (r) => r.time != null && !r.flag;

  function prepare(sk) {
    const valid = sk.results.filter(counts);
    const pbs = {};
    for (const r of valid) if (!pbs[r.event] || r.time < pbs[r.event].time) pbs[r.event] = r;
    const meets = [...new Set(sk.results.map((r) => r.meet))].sort(byMeetDate);
    const latest = meets[meets.length - 1];
    return {
      ...sk,
      valid,
      pbs,
      meets,
      latest,
      latestPbs: sk.results.filter((r) => r.meet === latest && r.pb),
    };
  }
  const skaters = DATA.skaters.map(prepare).sort((a, b) => a.name.localeCompare(b.name));
  const byId = new Map(skaters.map((sk) => [sk.id, sk]));

  // Ages are the age on July 1, when the season starts, and carry forward a
  // year each season. A category from an earlier season is labelled with it.
  const today = new Date();
  const seasonStart = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  const thisSeason = `${seasonStart}-${String(seasonStart + 1).slice(2)}`;
  const ageIn = (sk, season) => sk.age && sk.age[0] + Number(season.slice(0, 4)) - sk.age[1];
  const currentAge = (sk) => ageIn(sk, thisSeason);
  function profileText(sk) {
    const [category, season] = sk.category || [];
    return [sk.age && `Age ${currentAge(sk)}`,
      category && (season === thisSeason ? category : `${category} (${season})`)].filter(Boolean).join(" · ");
  }

  /* ---------- views ---------- */

  function showHome() {
    document.title = DATA.title;
    const list = h("ul", { class: "list" });
    for (const sk of skaters) {
      const n = sk.latestPbs.length;
      list.append(h("li", { "data-name": sk.name.toLowerCase() },
        h("a", { class: "row", href: `#/s/${sk.id}` },
          h("span", { class: "who" }, h("strong", {}, sk.name), h("span", { class: "sub" }, profileText(sk))),
          n ? h("span", { class: "badge", title: `At ${MEETS[sk.latest].name}` }, `${plural(n, "PB")} last meet`)
            : h("span", { class: "chev", "aria-hidden": "true" }, "›"))));
    }
    const none = h("p", { class: "empty", hidden: true }, "No skater by that name.");
    const search = h("input", {
      class: "search", type: "search", placeholder: "Find a skater", "aria-label": "Find a skater", autocomplete: "off",
    });
    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (const li of list.children) {
        li.hidden = Boolean(q) && !li.dataset.name.includes(q);
        if (!li.hidden) shown++;
      }
      none.hidden = shown > 0;
    });
    app.replaceChildren(...[
      raceBanners(null),
      h("h1", {}, "Skaters"),
      h("p", { class: "lede" }, `${skaters.length} ${DATA.club} skaters, ${plural(meetIds.length, "meet")}. Tap a name for PBs and progress.`),
      search, list, none].filter(Boolean));
  }

  function showSkater(sk) {
    document.title = `${sk.name} · ${DATA.title}`;
    app.replaceChildren(...[
      h("p", { class: "crumb" }, h("a", { href: "#/" }, "‹ All skaters")),
      raceBanners(sk),
      h("h1", {}, sk.name),
      h("p", { class: "lede" }, [profileText(sk), plural(sk.meets.length, "meet")].filter(Boolean).join(" · ")),
      pbSection(sk),
      latestCard(sk),
      progressSection(sk),
      seasonSection(sk),
      resultsSection(sk),
    ].filter(Boolean));
  }

  function latestCard(sk) {
    const m = MEETS[sk.latest];
    const card = h("section", { class: "card" },
      h("h2", { class: "card-title" }, "Latest meet"),
      h("p", {}, h("a", { href: `#/meet/${sk.latest}` }, m.name), h("span", { class: "muted" }, ` · ${fmtDate(m.start_date)}`)));
    if (sk.latestPbs.length) {
      card.append(h("p", { class: "muted" }, `${plural(sk.latestPbs.length, "new PB")}:`), pbList(sk.latestPbs));
    } else {
      card.append(h("p", { class: "muted" }, "No new PBs at this meet."));
    }
    return card;
  }

  const ROUND_NAMES = { heat: "Heat", quarter: "Quarter", semi: "Semi", final: "Final" };
  const roundName = (r) => ROUND_NAMES[r.round] || r.label;

  // Results stay in race order within a distance, so a heat PB comes before the final that beat it.
  // A first time at a distance is a PB too, with no earlier time to beat.
  function pbList(rs) {
    return h("ul", { class: "pb-list" }, rs.slice().sort((a, b) => compareEvents(a.event, b.event)).map((r) =>
      h("li", {},
        h("span", { class: "who" }, eventName(r.event), h("span", { class: "sub" }, roundName(r))),
        h("span", { class: "nowrap" },
          h("span", { class: "time" }, fmtTime(r.time, EVENTS[r.event].discipline)), " ",
          h("span", { class: "gain" }, r.prev == null ? "first time" : fmtGain(r.prev, r.time))))));
  }

  function pbSection(sk) {
    const keys = Object.keys(sk.pbs).sort(compareEvents);
    const sec = h("section", {}, h("h2", {}, "Personal bests"));
    if (!keys.length) {
      sec.append(h("p", { class: "empty" }, "No timed races yet."));
      return sec;
    }
    let group = null, tbody = null;
    for (const key of keys) {
      const ev = EVENTS[key];
      if (trackGroup(ev) !== group) {
        group = trackGroup(ev);
        tbody = h("tbody");
        sec.append(h("h3", {}, group), h("div", { class: "card table-card" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Distance"), h("th", { class: "num" }, "PB"), h("th", {}, "Set at"))),
          tbody)));
      }
      const r = sk.pbs[key];
      tbody.append(h("tr", {},
        h("td", { class: "nowrap" }, ev.label),
        h("td", { class: "num time-best" }, fmtTime(r.time, ev.discipline)),
        h("td", {}, meetName(r.meet), h("span", { class: "sub" }, fmtDate(MEETS[r.meet].start_date)))));
    }
    return sec;
  }

  function progressSection(sk) {
    const sec = h("section", {}, h("h2", {}, "Progress"));
    const keys = Object.keys(sk.pbs).sort(compareEvents)
      .filter((k) => new Set(sk.valid.filter((r) => r.event === k).map((r) => r.meet)).size >= 2);
    if (!keys.length) {
      sec.append(h("p", { class: "empty" }, "Charts appear once a distance has been skated at two meets."));
      return sec;
    }
    sec.append(
      h("p", { class: "lede" }, "Every timed race at each distance, in order. Lower is faster."),
      h("div", { class: "legend" },
        h("span", { class: "key" }, h("span", { class: "key-line" }), "Race times"),
        h("span", { class: "key" }, h("span", { class: "key-dot" }), "PB")));
    sec.append(h("div", { class: "charts" }, keys.map((k) => progressChart(sk, k))));
    return sec;
  }

  function seasonSection(sk) {
    const seasonOf = (r) => MEETS[r.meet].season;
    const seasons = [...new Set(sk.valid.map(seasonOf))].sort().slice(-3);
    if (seasons.length < 2) return null;
    const best = {};
    for (const r of sk.valid) {
      const s = seasonOf(r);
      if (!seasons.includes(s)) continue;
      best[r.event] = best[r.event] || {};
      if (best[r.event][s] == null || r.time < best[r.event][s]) best[r.event][s] = r.time;
    }
    const [prev, last] = seasons.slice(-2);
    const rows = Object.keys(best).sort(compareEvents).map((k) => {
      const ev = EVENTS[k], b = best[k];
      const change = b[prev] != null && b[last] != null ? b[last] - b[prev] : null;
      return h("tr", {},
        h("td", {}, ev.label, h("span", { class: "sub" }, trackName(ev))),
        seasons.map((s) => h("td", { class: "num" }, fmtTime(b[s], ev.discipline))),
        h("td", { class: "num" }, change == null ? "" : `${change < 0 ? "−" : "+"}${Math.abs(change).toFixed(2)} s`));
    });
    return h("section", {},
      h("h2", {}, "Season bests"),
      h("div", { class: "card table-card" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", {}, "Distance"), seasons.map((s) => h("th", { class: "num" }, s)), h("th", { class: "num" }, "Change"))),
        h("tbody", {}, rows))));
  }

  function resultsSection(sk) {
    const sec = h("section", {}, h("h2", {}, "All results"));
    sk.meets.slice().reverse().forEach((m, i) => {
      const rs = sk.results.filter((r) => r.meet === m);
      const n = rs.filter((r) => r.pb).length;
      sec.append(h("details", { class: "meet", open: i === 0 },
        h("summary", {},
          h("span", { class: "who" }, h("strong", {}, MEETS[m].name), h("span", { class: "sub" }, fmtDate(MEETS[m].start_date))),
          n ? h("span", { class: "badge" }, plural(n, "PB")) : null),
        h("div", { class: "body" }, raceTable(rs),
          MEETS[m].source_url && h("p", { class: "note" }, "Source: ", sourceLink(MEETS[m])))));
    });
    return sec;
  }

  const PENALTIES = { "P-IMP": "impeding", "P-OFFTrack": "off track" };

  function resultCell(r) {
    const ev = EVENTS[r.event];
    const time = fmtTime(r.time, ev.discipline);
    if (r.flag) {
      const [kind, reason] = r.flag; // reason is for the maintainer; shown on hover only
      if (kind === "pending") return [time, h("span", { class: "sub", title: reason }, "Being checked")];
      return ["No valid time", h("span", { class: "sub" }, `Listed as ${time}`)];
    }
    if (r.status === "OK") {
      return [time, r.pb ? [" ", h("span", { class: "badge" }, "PB")] : null,
        r.pb === "first" ? h("span", { class: "sub" }, "first time") : null];
    }
    if (r.status === "DNS") return "Did not start";
    if (r.status === "DNF") return ["Did not finish", r.note ? h("span", { class: "sub" }, r.note) : null];
    if (r.status === "PEN") return ["Penalty", r.note ? h("span", { class: "sub" }, PENALTIES[r.note] || r.note) : null];
    if (r.note === "points race") return "Points race (no time)";
    if (r.note === "lapped") return "Lapped";
    return ["No time", r.note ? h("span", { class: "sub" }, r.note) : null];
  }

  function raceCell(r) {
    if (!ROUND_NAMES[r.round]) return r.label;
    const number = r.race.replace(/\D+$/, ""), letter = r.race.slice(number.length);
    return [h("span", { class: "nowrap" }, `${roundName(r)} ${letter}`), h("span", { class: "sub nowrap" }, `Race ${number}`)];
  }

  // "3 laps (255 m)" -> "3 laps" over "255 m, 85 m track"; "400 m" over "100 m track".
  function distanceCell(ev) {
    const m = ev.label.match(/^(.*) \((.*)\)$/);
    return m ? [h("span", { class: "nowrap" }, m[1]), h("span", { class: "sub" }, `${m[2]}, ${trackName(ev)}`)]
      : [h("span", { class: "nowrap" }, ev.label), h("span", { class: "sub" }, trackName(ev))];
  }

  function raceTable(rs) {
    return h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Race"), h("th", {}, "Distance"), h("th", { class: "num" }, "Place"), h("th", { class: "num" }, "Time"))),
      h("tbody", {}, rs.map((r) => {
        const ev = EVENTS[r.event];
        return h("tr", {},
          h("td", {}, raceCell(r)),
          h("td", {}, distanceCell(ev)),
          h("td", { class: "num" }, r.place ? ordinal(r.place) : ""),
          h("td", { class: "num" }, resultCell(r)));
      })));
  }

  /* ---------- progress chart ---------- */

  let openTip = null;
  document.addEventListener("pointerdown", (e) => {
    if (openTip && !openTip.plot.contains(e.target)) openTip.hide();
  });

  const YEAR_MS = 365 * 86400000;
  const meetTime = (r) => parseDate(MEETS[r.meet].start_date).getTime();

  // Each chart covers only the dates it has races for, either all time or
  // the last 12 months (from today).
  function progressChart(sk, key) {
    const ev = EVENTS[key];
    const all = sk.valid.filter((r) => r.event === key);
    const recent = all.filter((r) => meetTime(r) >= Date.now() - YEAR_MS);
    const pb = sk.pbs[key];
    const fig = h("figure", { class: "chart card" });
    const buttons = {};
    let plot = null, table = null;

    function show(mode) {
      const rs = mode === "12m" ? recent : all;
      for (const [m, b] of Object.entries(buttons)) b.setAttribute("aria-pressed", String(m === mode));
      const label = `${eventName(key)}, ${mode === "12m" ? "last 12 months" : "all time"}. ` +
        `${plural(rs.length, "timed race")}, PB ${fmtTime(pb.time, ev.discipline)}. Arrow keys step through meets.`;
      const nextPlot = chart(rs, ev, label), nextTable = timesTable(rs, ev);
      if (plot) {
        plot._observer.disconnect();
        plot.replaceWith(nextPlot);
        table.replaceWith(nextTable);
      } else {
        fig.append(nextPlot, nextTable);
      }
      plot = nextPlot;
      table = nextTable;
    }

    const toggle = h("span", { class: "toggle", role: "group", "aria-label": "Time range" },
      [["12m", "Last 12 months"], ["all", "All time"]].map(([mode, title]) => {
        const none = mode === "12m" && !recent.length;
        buttons[mode] = h("button", {
          type: "button", "aria-pressed": "false", disabled: none,
          title: none ? "No races at this distance in the last 12 months" : title, onclick: () => show(mode),
        }, mode);
        return buttons[mode];
      }));
    fig.append(h("figcaption", {},
      h("span", { class: "who" }, h("strong", {}, `${ev.label} · ${trackName(ev)}`),
        h("span", { class: "sub" }, `PB ${fmtTime(pb.time, ev.discipline)}`)),
      toggle));
    show("all");
    return fig;
  }

  function timesTable(rs, ev) {
    return h("details", {},
      h("summary", {}, "Times"),
      h("table", {}, h("tbody", {}, rs.slice().reverse().map((r) => h("tr", {},
        h("td", {}, meetName(r.meet), h("span", { class: "sub" }, fmtDate(MEETS[r.meet].start_date))),
        h("td", {}, raceCell(r)),
        h("td", { class: "num" }, fmtTime(r.time, ev.discipline), r.pb ? [" ", h("span", { class: "badge" }, "PB")] : null))))));
  }

  function niceStep(span, target) {
    for (const s of [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 20, 30, 60, 120, 300, 600]) if (span / s <= target) return s;
    return 1200;
  }
  function tickLabel(t, step) {
    const decimals = step < 1 ? 1 : 0;
    if (t < 60) return t.toFixed(decimals);
    const m = Math.floor(t / 60);
    return `${m}:${(t - m * 60).toFixed(decimals).padStart(decimals ? 4 : 2, "0")}`;
  }

  function chart(rs, ev, label) {
    const plot = h("div", { class: "plot", tabindex: "0", role: "group", "aria-label": label });
    const H = 172, M = { top: 12, right: 14, bottom: 24, left: 46 };
    const d0 = Math.min(...rs.map(meetTime)), d1 = Math.max(...rs.map(meetTime));
    const SPREAD = 5; // px between races at the same meet, so the line stays angled
    const groups = []; // rs is already in race order: meet date, then race number
    for (const r of rs) {
      const last = groups[groups.length - 1];
      if (last && last.meet === r.meet) last.results.push(r);
      else groups.push({ meet: r.meet, ms: parseDate(MEETS[r.meet].start_date).getTime(), results: [r] });
    }
    const tip = h("div", { class: "tip", hidden: true });
    let width = 0, xs = [], active = -1;

    const xpad = Math.max((d1 - d0) * 0.04, 10 * 86400000);
    const times = rs.map((r) => r.time);
    const pad = Math.max((Math.max(...times) - Math.min(...times)) * 0.12, 0.3);
    const lo = Math.min(...times) - pad, hi = Math.max(...times) + pad;
    const x = (ms) => M.left + ((ms - d0 + xpad) / (d1 - d0 + 2 * xpad)) * (width - M.left - M.right);
    const y = (t) => M.top + ((hi - t) / (hi - lo)) * (H - M.top - M.bottom); // faster times lower down

    function draw() {
      const root = svg("svg", { width, height: H, viewBox: `0 0 ${width} ${H}`, "aria-hidden": "true" });
      const step = niceStep(hi - lo, 4);
      for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
        root.append(svg("line", { class: "grid", x1: M.left, x2: width - M.right, y1: y(t), y2: y(t) }));
        root.append(svg("text", { x: M.left - 6, y: y(t) + 4, "text-anchor": "end" }, tickLabel(t, step)));
      }
      root.append(svg("line", { class: "axis", x1: M.left, x2: width - M.right, y1: H - M.bottom, y2: H - M.bottom }));
      // Month ticks for a season or so; past about 18 months, years; under
      // about six weeks (one meet, say), just the date.
      const years = d1 - d0 > 548 * 86400000;
      let lastX = -Infinity, first = true;
      const tick = new Date(d0 - xpad);
      tick.setDate(1);
      if (years) tick.setMonth(12); else tick.setMonth(tick.getMonth() + 1);
      if (d1 - d0 < 42 * 86400000) {
        const day = new Date(d0);
        root.append(svg("text", { x: x(d0), y: H - 6, "text-anchor": "middle" },
          `${MONTHS[day.getMonth()]} ${day.getDate()}, ${day.getFullYear()}`));
        tick.setTime(d1 + xpad + 1);  // skip the month ticks
        first = false;
      }
      for (; tick.getTime() <= d1 + xpad; tick.setMonth(tick.getMonth() + (years ? 12 : 1))) {
        const mx = x(tick.getTime());
        if (mx - lastX < (years ? 40 : 64)) continue;
        const label = years ? String(tick.getFullYear())
          : first || tick.getMonth() === 0 ? `${MONTHS[tick.getMonth()]} ${tick.getFullYear()}` : MONTHS[tick.getMonth()];
        root.append(svg("line", { class: "axis", x1: mx, x2: mx, y1: H - M.bottom, y2: H - M.bottom + 4 }));
        root.append(svg("text", { x: mx, y: H - 6, "text-anchor": "middle" }, label));
        lastX = mx;
        first = false;
      }
      if (first) {  // too short a span for any tick: name the month instead
        const only = new Date(d0);
        root.append(svg("text", { x: x(d0), y: H - 6, "text-anchor": "middle" }, `${MONTHS[only.getMonth()]} ${only.getFullYear()}`));
      }

      // One straight line through every timed race in order. Each result that
      // set a PB (including a first race at the distance) gets a red dot.
      const points = groups.flatMap((g) => g.results.map((r, i) =>
        ({ r, px: x(g.ms) + (i - (g.results.length - 1) / 2) * SPREAD, py: y(r.time) })));
      root.append(svg("path", { class: "result-line", d: points.map((p, i) => `${i ? "L" : "M"}${p.px},${p.py}`).join("") }));
      const cross = svg("line", { class: "cross", y1: M.top, y2: H - M.bottom, visibility: "hidden" });
      root.append(cross);
      for (const p of points.filter((p) => !p.r.pb)) root.append(svg("circle", { class: "dot", cx: p.px, cy: p.py, r: 4 }));
      for (const p of points.filter((p) => p.r.pb)) root.append(svg("circle", { class: "dot pb", cx: p.px, cy: p.py, r: 5 }));
      xs = groups.map((g) => x(g.ms));
      plot.replaceChildren(root, tip);
      plot._cross = cross;
      if (active >= 0) show(active);
    }

    function show(i) {
      active = Math.max(0, Math.min(groups.length - 1, i));
      const g = groups[active], gx = xs[active];
      plot._cross.setAttribute("x1", gx);
      plot._cross.setAttribute("x2", gx);
      plot._cross.setAttribute("visibility", "visible");
      tip.replaceChildren(
        h("div", { class: "tip-head" }, `${meetName(g.meet)} · ${fmtShortDate(MEETS[g.meet].start_date)}`),
        ...g.results.map((r) => h("div", { class: "tip-row" },
          h("span", { class: r.pb ? "tip-key pb" : "tip-key" }),
          h("strong", {}, fmtTime(r.time, ev.discipline)),
          h("span", {}, `${roundName(r)}${r.pb === "pb" ? " · PB" : r.pb === "first" ? " · PB, first time" : ""}`))));
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${gx > width / 2 ? Math.max(0, gx - tw - 10) : Math.min(width - tw, gx + 10)}px`;
      openTip = { plot, hide };
    }

    function hide() {
      active = -1;
      tip.hidden = true;
      if (plot._cross) plot._cross.setAttribute("visibility", "hidden");
    }

    function nearest(clientX) {
      const px = clientX - plot.getBoundingClientRect().left;
      let best = 0;
      xs.forEach((gx, i) => { if (Math.abs(gx - px) < Math.abs(xs[best] - px)) best = i; });
      return best;
    }

    plot.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
    plot.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
    plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    plot.addEventListener("focus", () => show(groups.length - 1));
    plot.addEventListener("blur", hide);
    plot.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        show((active < 0 ? groups.length - 1 : active) + (e.key === "ArrowRight" ? 1 : -1));
      } else if (e.key === "Escape") hide();
    });
    // Redraw at the container's width; deferred a frame so drawing doesn't
    // trigger resize notifications inside the observer callback.
    plot._observer = new ResizeObserver(() => requestAnimationFrame(() => {
      const w = Math.round(plot.clientWidth);
      if (w && w !== width) {
        width = w;
        draw();
      }
    }));
    plot._observer.observe(plot);
    return plot;
  }

  /* ---------- club ---------- */

  // The club view asks for a PIN (club_pin in config.json). Any comparison
  // that names skaters belongs here, behind it; skater and meet pages stay
  // open. Not security: the data is in data.js for anyone who looks. It
  // keeps casual visitors out. data.js has a hash of the PIN, not the PIN,
  // and unlocking is remembered on the device.
  const PIN_KEY = "club-pin";
  let unlocked = false;
  function pinHash(pin) {  // FNV-1a, as pin_hash in skating/build.py
    let h = 0x811c9dc5;
    for (const b of new TextEncoder().encode(pin)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return h.toString(16).padStart(8, "0");
  }
  function clubUnlocked() {
    if (!DATA.club_pin_hash || unlocked) return true;
    try { unlocked = localStorage.getItem(PIN_KEY) === DATA.club_pin_hash; } catch (e) { /* storage blocked */ }
    return unlocked;
  }

  function showPin(next = showClub) {
    document.title = `Club · ${DATA.title}`;
    const input = h("input", { type: "password", inputmode: "numeric", autocomplete: "off", "aria-label": "Club PIN", placeholder: "PIN" });
    const wrong = h("p", { class: "note", "aria-live": "polite" });
    const form = h("form", { class: "pin-form", onsubmit: (e) => {
      e.preventDefault();
      if (pinHash(input.value.trim()) !== DATA.club_pin_hash) {
        wrong.textContent = "That PIN isn't right.";
        input.value = "";
        input.focus();
        return;
      }
      unlocked = true;
      try { localStorage.setItem(PIN_KEY, DATA.club_pin_hash); } catch (e) { /* unlocked until the page reloads */ }
      next();
    } }, input, h("button", { class: "button", type: "submit" }, "Open"));
    app.replaceChildren(
      h("h1", {}, DATA.club),
      h("p", { class: "lede" }, "Enter the club PIN to see the leaderboard, most improved, times by age, the club over time and race day seeds."),
      form, wrong);
    input.focus();
  }

  function showClub() {
    if (!clubUnlocked()) return showPin();
    document.title = `Club · ${DATA.title}`;
    const cs = DATA.club_summary;
    const seasons = cs.seasons.slice().reverse();
    const improvedBox = h("div"), meetsBox = h("div");
    const render = (season) => {
      const [improved, meets] = clubSeason(season);
      improvedBox.replaceChildren(improved);
      meetsBox.replaceChildren(meets);
    };
    const seasonSelect = h("select", { "aria-label": "Season" }, seasons.map((s) => h("option", { value: s }, s)));
    seasonSelect.addEventListener("change", () => render(seasonSelect.value));
    render(seasons[0]);
    app.replaceChildren(...[
      h("h1", {}, DATA.club),
      h("p", { class: "lede" }, "Leaderboard, most improved, times by age for coaches, the club over time, and meet recaps."),
      h("p", { class: "buttons" },
        pdfButton("handouts.pdf", "PB handouts (PDF)"),
        // The club's one-page PB sheet. It ranks skaters, so it's linked only here.
        pdfButton("pb-sheet.pdf", "PB sheet (PDF)")),
      ...activeRaceDays().filter((rd) => !rd.meet).map((rd) =>
        h("a", { class: "banner", href: `#/race/${rd.key}/coaches` },
          h("span", { class: "who" }, h("strong", {}, `${rd.name}, ${raceDates(rd)}`),
            h("span", { class: "sub" }, seeded(rd) ? "Seeds, chances and goal times for each division" : "PB handouts for the skaters racing")),
          h("span", { class: "chev", "aria-hidden": "true" }, "›"))),
      leaderboardSection(true),
      // The season picker scopes most improved and the meet list (whose heading names the season).
      h("div", { class: "controls season-picker" }, h("label", {}, "Season", seasonSelect)),
      improvedBox,
      ageSection(),
      trendSection(),
      meetsBox,
    ].filter(Boolean));
  }

  // The open standings: the leaderboard without SD, for skaters and parents.
  // The PB sheet's QR code links here, so it isn't behind the PIN.
  function showStandings() {
    document.title = `Standings · ${DATA.title}`;
    app.replaceChildren(
      h("h1", {}, `${DATA.club} standings`),
      leaderboardSection(false));
  }

  // The club's order from its PB sheet (sjspeedskaters.ca, Competitions page).
  // Skaters fall into tiers by 400 m PB, fastest tier first, and are ordered
  // within a tier by a score from their short track PBs, lowest first. Each
  // basis has averages by age in DATA.coaches.scores, from LEADERBOARD_SCORES
  // in skating/build.py: keep the two in step.
  function leaderboardEntry(sk) {
    const t = (track, distance) => sk.pbs[`short-${track}-${distance}`]?.time;
    const t400 = t(100, 400), t800 = t(100, 800), t1500 = t(100, 1500);
    const cystc = t400 != null && t800 != null && t1500 != null && !(currentAge(sk) > CYSTC_MAX_AGE)
      ? t400 + t800 / 2 + t1500 / 3.75 : null;
    if (t(111, 500) != null && t(111, 1500) != null) {
      return { tier: 5, score: t(111, 500) + t(111, 1500) / 3, basis: "500 + 1500/3 (111 m)", cystc };
    }
    // Under 55 s without an 800 drops to the 400 m tier.
    if (t400 < 55 && t800 != null) return { tier: t400 < 49 ? 4 : 3, score: t400 + t800 / 2, basis: "400 + 800/2", cystc };
    if (t400 < 60) return { tier: 2, score: t400, basis: "400", cystc };
    if (t(100, 200) != null) return { tier: 1, score: t(100, 200), basis: "200", cystc };
    return null;
  }

  // Standards from Speed Skate NB's Provincial Team Policy, by gender and age on July 1.
  // CYSTC (11 to 13) scores 400 + 800/2 + 1500/3.75 on the 100 m track; 14 and up
  // score 500 + 1500/3 on the 111 m track, the leaderboard's top tier, and get
  // no CYSTC score (coaches' request, Oct 2026).
  const POLICY_URL = "https://speedskatenb.ca/wp-content/uploads/2026/09/Provincial-Team-Policy_EN-UpdateSept2026.pdf";
  const CYSTC_STANDARDS = { M: { 11: 138, 12: 137, 13: 133 }, F: { 11: 147, 12: 146, 13: 140 } };
  const CYSTC_MAX_AGE = 13;
  // Each kind of standard has its own check colour (the std-* classes in style.css).
  const SENIOR_STANDARDS = [
    { event: "Neo-Junior Championships", ages: [14, 15], M: 103, F: 109, page: 10, kind: "neo" },
    { event: "Canadian Junior Open", ages: [16, 18], M: 100, F: 106, page: 11, kind: "jr" },
    { event: "Quebec Provincial (funding)", ages: [13, 15], M: 105.3, F: 109.3, page: 12, kind: "qc" },
    { event: "Quebec Provincial (funding)", ages: [16, 18], M: 103.3, F: 108.3, page: 12, kind: "qc" },
  ];
  const policyLink = (text, page) => h("a", { href: `${POLICY_URL}#page=${page}`, target: "_blank", rel: "noopener" }, text);
  const checkMark = (kind, label) => h("span", { class: `good std-${kind}`, title: label, "aria-label": label }, "✓");

  function cystcCell(e) {
    if (e.cystc == null) return "";
    const std = CYSTC_STANDARDS[e.sk.gender]?.[currentAge(e.sk)];
    return [e.cystc.toFixed(3), std != null && e.cystc < std ? [" ", checkMark("cystc", `Under the CYSTC standard (${std})`)] : null];
  }
  function scoreCell(e) {
    const age = currentAge(e.sk);
    const met = e.tier === 5 ? SENIOR_STANDARDS.filter((s) =>
      age >= s.ages[0] && age <= s.ages[1] && s[e.sk.gender] != null && e.score < s[e.sk.gender]) : [];
    return [e.score.toFixed(3), met.map((s) => [" ", checkMark(s.kind, `Under the ${s.event} standard (${s[e.sk.gender]})`)])];
  }
  // Standard deviations from the average at the skater's age, plus if faster.
  // `ages` rows are [age, skaters, average, SD], from DATA.coaches; `fmt`
  // formats the average for the tooltip.
  function sdCell(ages, t, age, fmt) {
    const a = ages.find(([x]) => x === age);
    if (!a) return age ? h("span", { class: "sub" }, "too few") : "";
    return h("span", { title: `Age ${age}: average ${fmt(a[2])}, SD ${a[3].toFixed(3)}, ${plural(a[1], "skater")}` },
      fmtZ((a[2] - t) / a[3]), h("span", { class: "sub" }, `age ${age}`));
  }
  // A score is compared at the age in the season of its newest PB, so last
  // season's PBs are compared with last season's age.
  function scoreSd(e) {
    const norm = DATA.coaches.scores[e.basis];
    const season = norm.events.map((k) => MEETS[e.sk.pbs[k].meet].season).sort().pop();
    return sdCell(norm.ages, e.score, ageIn(e.sk, season), (t) => t.toFixed(3));
  }

  function standardsTable(head, rows) {
    return h("div", { class: "card table-card" }, h("table", {},
      h("thead", {}, h("tr", {}, head.map((t, i) => h("th", { class: i ? "num" : null }, t)))),
      h("tbody", {}, rows.map((r) => h("tr", {}, r.map((c, i) => h("td", { class: i ? "num" : null }, c)))))));
  }

  // Laptops and wider screens get the whole table, a column for every PB,
  // sorted by the picker or a column heading. Phones keep one ranking column.
  const WIDE = window.matchMedia("(min-width: 1000px)");

  // The club's order by score (the default), or PBs at any distance a club
  // skater has one. With `stats` (the club page, behind the PIN) it has the
  // SD column; without it, it's the open standings the PB sheet's QR links to.
  function leaderboardSection(stats) {
    const ageRange = ([a, b]) => `${a} to ${b}`;
    const [first, last] = DATA.coaches.seasons;
    const keys = [...new Set(skaters.flatMap((sk) => Object.keys(sk.pbs)))].sort(compareEvents);
    const rankBy = h("select", { "aria-label": "Rank by" }, h("option", { value: "" }, "Club score"), eventOptions(keys, EVENTS));
    const sort = (key) => { rankBy.value = key; render(); };
    // At a distance: every skater with a PB there, or only those with a time
    // there in the last 12 months (as on skater pages). The choice carries
    // over from one distance to the next.
    let range = "all";
    const buttons = {};
    const toggle = h("span", { class: "toggle", role: "group", "aria-label": "Skaters" },
      [["12m", "Skaters with a time here in the last 12 months"], ["all", "Every skater with a PB here"]].map(([mode, title]) =>
        (buttons[mode] = h("button", { type: "button", title, onclick: () => { range = mode; render(); } }, mode))));
    const caption = h("span", { class: "who" }), head = h("div", { class: "board-head" }, caption, toggle), table = h("div");
    const board = h("div");
    const render = () => {
      if (!rankBy.value) return board.replaceChildren(...scoreBoard(stats, sort));
      if (head.parentNode !== board) board.replaceChildren(head, table);  // left in place, so a pressed button keeps focus
      for (const [m, b] of Object.entries(buttons)) b.setAttribute("aria-pressed", String(m === range));
      const [text, rows] = distanceBoard(rankBy.value, range === "12m", stats, sort);
      caption.replaceChildren(...text);
      table.replaceChildren(rows);
    };
    rankBy.addEventListener("change", render);
    // Redraw when the window crosses the laptop width, until the page changes.
    const resized = () => (board.isConnected ? render() : WIDE.removeEventListener("change", resized));
    WIDE.addEventListener("change", resized);
    render();
    return h("section", {}, stats ? h("h2", {}, "Leaderboard") : null,
      h("p", { class: "lede" }, "Club order from current PBs, or pick a distance. ",
        stats ? `SD compares each score or PB with all skaters the same age, ${first} to ${last}: +1.0 is one standard deviation faster than average.` : null),
      h("div", { class: "controls" }, h("label", {}, "Rank by", rankBy)),
      board,
      h("details", { class: "meet" },
        h("summary", {}, h("strong", {}, stats ? "How the order, SD and standards work" : "How the order and standards work")),
        h("div", { class: "body" },
          h("h3", {}, "Club order"),
          h("ul", { class: "notes" },
            h("li", {}, "Skaters with 111 m track times rank first, by 500 + 1500/3."),
            h("li", {}, "The rest by their 100 m track 400 PB: under 49 s, then under 55 s, each ranked by 400 + 800/2."),
            h("li", {}, "Then under 60 s (or under 55 s with no 800), ranked by the 400."),
            h("li", {}, "Then slower than 60 s or no 400, ranked by the 200."),
            h("li", {}, "Lower scores rank higher. Ages are the age on July 1.")),
          stats ? h("h3", {}, "SD column") : null,
          stats ? h("ul", { class: "notes" },
            h("li", {}, `Each score or PB is compared with every skater's season bests at that age at Atlantic meets: all clubs, ${first} to ${last}. National and Quebec meets are left out, so as not to mix in a faster field. Boys and girls are pooled; results don't say which.`),
            h("li", {}, "The age is the skater's age in the season the PB was set (for a score, its newest PB), so last season's PBs are compared with last season's age. For a distance, that season is under the skater's name."),
            h("li", {}, "About two in three skaters are between −1.0 and +1.0. Ages with fewer than 5 skaters get no SD."),
            h("li", {}, "On smaller tracks, the older ages are mostly skaters who haven't moved up a track yet, so those averages run slow.")) : null,
          h("h3", {}, "CYSTC standards (ages 11 to 13)"),
          h("p", { class: "note" }, checkMark("cystc", "CYSTC"), " in the CYSTC column. 400 + 800/2 + 1500/3.75 on the 100 m track, for New Brunswick's team at the Canadian Youth Short Track Championships (East); blank for skaters 14 and up. Source: ",
            policyLink("Speed Skate NB Provincial Team Policy, section 3.3", 8), "."),
          standardsTable(["Age", "Male", "Female"], Object.keys(CYSTC_STANDARDS.M).map((age) => [age, CYSTC_STANDARDS.M[age], CYSTC_STANDARDS.F[age]])),
          h("h3", {}, "Standards for ages 13 and up"),
          h("p", { class: "note" }, "500 + 1500/3 on the 111 m track; checks in the Score column, colour by event. Quebec Provincial standards decide Speed Skate NB funding. Sources: ",
            policyLink("section 3.6.2", 10), " and ", policyLink("section 4.1.1", 12), " of the Speed Skate NB Provincial Team Policy."),
          standardsTable(["Event", "Ages", "Male", "Female"], SENIOR_STANDARDS.map((s) =>
            [[checkMark(s.kind, s.event), " ", policyLink(s.event, s.page)], ageRange(s.ages), s.M, s.F])))));
  }

  // Rows are { sk, sub, sd } plus the skater's leaderboardEntry, if any: `sub`
  // goes under the name, `sd` is the SD cell for the ranking (club page only).
  function scoreBoard(stats, sort) {
    const rows = skaters.map((sk) => ({ sk, ...leaderboardEntry(sk) })).filter((e) => e.tier)
      .sort((a, b) => b.tier - a.tier || a.score - b.score)
      .map((e) => ({ ...e, sub: e.basis, sd: stats ? scoreSd(e) : null }));
    const unranked = skaters.length - rows.length;
    return [
      WIDE.matches ? wideTable(rows, "", stats, sort) : h("div", { class: "card table-card" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { class: "num" }, "#"), h("th", {}, "Skater"), h("th", { class: "num" }, "Score"),
          stats ? h("th", { class: "num" }, "SD") : null, h("th", { class: "num" }, "CYSTC"))),
        h("tbody", {}, rows.map((e, i) => h("tr", {},
          h("td", { class: "num" }, i + 1),
          nameCell(e),
          h("td", { class: "num time-best" }, scoreCell(e)),
          stats ? h("td", { class: "num" }, e.sd) : null,
          h("td", { class: "num" }, cystcCell(e))))))),
      h("p", { class: "note" }, "A ✓ marks a score under a Speed Skate NB standard for the skater's age and gender; the colour shows which (see the standards below).",
        unranked ? ` ${plural(unranked, "skater")} without a 200 m time on the 100 m track not ranked.` : null),
    ];
  }

  // One distance: each club skater's PB, fastest first, against the averages
  // in times by age (DATA.coaches.events) at their age in the season it was
  // set. `recent` keeps only skaters with a time there in the last 12 months.
  // Gives the caption and the table.
  function distanceBoard(key, recent, stats, sort) {
    const ev = EVENTS[key], ages = DATA.coaches.events[key] ? DATA.coaches.events[key].ages : [];
    const fmt = (t) => fmtTime(t, ev.discipline);
    const all = skaters.filter((sk) => sk.pbs[key]);
    const shown = recent ? all.filter((sk) => sk.valid.some((r) => r.event === key && meetTime(r) >= Date.now() - YEAR_MS)) : all;
    const rows = shown.map((sk) => {
      const pb = sk.pbs[key], season = MEETS[pb.meet].season;
      return { sk, ...leaderboardEntry(sk), pb, sub: season, sd: stats ? sdCell(ages, pb.time, ageIn(sk, season), fmt) : null };
    }).sort((a, b) => a.pb.time - b.pb.time);
    const caption = [h("strong", {}, `${ev.label} · ${trackName(ev)}`),
      h("span", { class: "sub" }, recent ? `${shown.length} of ${all.length} with a time in the last 12 months` : plural(all.length, "skater"))];
    if (!rows.length) return [caption, h("p", { class: "note" }, `No ${DATA.club} skater has a time here in the last 12 months.`)];
    if (WIDE.matches) return [caption, wideTable(rows, key, stats, sort)];
    return [
      caption,
      h("div", { class: "card table-card" }, h("table", {},
        h("thead", {}, h("tr", {}, h("th", { class: "num" }, "#"), h("th", {}, "Skater"), h("th", { class: "num" }, "PB"),
          stats ? h("th", { class: "num" }, "SD") : null)),
        h("tbody", {}, rows.map((e, i) => h("tr", {},
          h("td", { class: "num" }, i + 1),
          nameCell(e),
          h("td", { class: "num time-best" }, fmt(e.pb.time)),
          stats ? h("td", { class: "num" }, e.sd) : null))))),
    ];
  }

  const nameCell = (e) => h("td", {}, h("a", { href: `#/s/${e.sk.id}` }, e.sk.name), h("span", { class: "sub" }, e.sub));

  // The PB sheet's short track columns, in its order: TRACKS in skating/pb_sheet.py.
  const SHEET_EVENTS = ["short-85-170", "short-85-255", "short-85-425",
    ...[200, 300, 400, 600, 800, 1000, 1500].map((d) => `short-100-${d}`),
    ...[500, 1000, 1500].map((d) => `short-111-${d}`)];

  // The laptop table: score, CYSTC and PBs, in the rows' order, sorted by
  // `key` ("" for the club score). The PB sheet's columns, plus the ranked
  // distance if it isn't one; ranked by a long track distance, every long
  // track distance instead. Headings sort; SD follows the sorted column.
  function wideTable(rows, key, stats, sort) {
    const long = Boolean(key) && EVENTS[key].discipline === "long";
    const keys = long
      ? [...new Set(skaters.flatMap((sk) => Object.keys(sk.pbs)))].filter((k) => EVENTS[k].discipline === "long").sort(compareEvents)
      : SHEET_EVENTS.filter((k) => EVENTS[k]).concat(key && !SHEET_EVENTS.includes(key) ? [key] : [])
        .sort((a, b) => EVENTS[a].track - EVENTS[b].track || EVENTS[a].distance - EVENTS[b].distance);
    const groups = [];
    for (const k of keys) {
      const label = long ? "Long track" : `${EVENTS[k].track} m track`;
      if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label, keys: [] });
      groups[groups.length - 1].keys.push(k);
    }
    const sd = stats ? 1 : 0;
    const heading = (k, label) => h("th", { class: `num${k === key ? " sorted" : ""}`, "aria-sort": k === key ? "ascending" : null },
      h("button", { type: "button", class: "sort", title: k ? `Rank by ${eventName(k)}` : "Rank by club score", onclick: () => sort(k) }, label));
    const sdHead = (k) => (stats && k === key ? h("th", { class: "num" }, "SD") : null);
    const top = (text, attrs) => h("th", { rowspan: 2, ...attrs }, text);
    return h("div", { class: "card table-card wide-board" }, h("table", {},
      h("thead", {},
        h("tr", {}, top("#", { class: "num" }), top("Skater"),
          h("th", { rowspan: 2, class: `num${key ? "" : " sorted"}`, "aria-sort": key ? null : "ascending" },
            h("button", { type: "button", class: "sort", title: "Rank by club score", onclick: () => sort("") }, "Score")),
          stats && !key ? top("SD", { class: "num" }) : null, top("CYSTC", { class: "num" }),
          groups.map((g) => h("th", { class: "group", colspan: g.keys.length + (g.keys.includes(key) ? sd : 0) }, g.label))),
        h("tr", {}, groups.flatMap((g) => g.keys.flatMap((k) => [heading(k, EVENTS[k].label.replace(/ \(.*\)$| m$/, "")), sdHead(k)])))),
      h("tbody", {}, rows.map((e, i) => h("tr", {},
        h("td", { class: "num" }, i + 1),
        nameCell(e),
        h("td", { class: `num${key ? "" : " sorted time-best"}` }, e.tier ? scoreCell(e) : ""),
        stats && !key ? h("td", { class: "num" }, e.sd) : null,
        h("td", { class: "num" }, cystcCell(e)),
        keys.flatMap((k) => [
          h("td", { class: `num${k === key ? " sorted time-best" : ""}` }, e.sk.pbs[k] ? fmtTime(e.sk.pbs[k].time, EVENTS[k].discipline) : ""),
          stats && k === key ? h("td", { class: "num" }, e.sd) : null,
        ]))))));
  }

  function clubSeason(season) {
    const cs = DATA.club_summary;
    const recaps = cs.recaps.filter((r) => MEETS[r.meet].season === season);
    const meetsSec = h("section", {}, h("h2", {}, `Meets, ${season}`),
      recaps.length ? h("ul", { class: "list" }, recaps.map((r) => h("li", {},
        h("a", { class: "row", href: `#/meet/${r.meet}` },
          h("span", { class: "who" }, h("strong", {}, MEETS[r.meet].name),
            h("span", { class: "sub" }, `${fmtDate(MEETS[r.meet].start_date)} · ${plural(r.skaters, "skater")}`)),
          r.pbs.length ? h("span", { class: "badge" }, plural(r.pbs.length, "PB")) : h("span", { class: "chev", "aria-hidden": "true" }, "›")))))
        : h("p", { class: "empty" }, "No meets this season."));

    const improved = (cs.most_improved[season] || []).slice(0, 10);
    const top = improved.length ? improved[0][1] : 0;
    const improvedSec = h("section", {}, h("h2", {}, "Most improved"),
      h("p", { class: "lede" }, "Typical gain from a skater's first meet of the season to their season best, across distances skated at two or more meets."),
      improved.length ? h("ul", { class: "bars" }, improved.map(([id, gain, n]) => h("li", {},
        h("span", { class: "who" }, h("a", { href: `#/s/${id}` }, byId.get(id).name), h("span", { class: "sub" }, plural(n, "distance"))),
        h("span", { class: "bar-track" },
          h("span", { class: "bar", style: `width: calc((100% - 56px) * ${top ? gain / top : 0})` }),
          h("span", { class: "bar-value" }, `${(gain * 100).toFixed(1)}%`)))))
        : h("p", { class: "empty" }, "Needs skaters with at least two meets this season."));

    return [improvedSec, meetsSec];
  }

  function showMeet(id) {
    const m = MEETS[id];
    document.title = `${m.name} · ${DATA.title}`;
    const here = skaters.filter((sk) => sk.meets.includes(id));
    const pbCount = here.reduce((n, sk) => n + sk.results.filter((r) => r.meet === id && r.pb).length, 0);
    const dates = m.end_date && m.end_date !== m.start_date ? `${fmtShortDate(m.start_date)} to ${fmtDate(m.end_date)}` : fmtDate(m.start_date);
    app.replaceChildren(
      h("p", { class: "crumb" }, h("a", { href: "#/club" }, "‹ Club")),
      h("h1", {}, m.name),
      h("p", { class: "lede" }, [dates, m.location].filter(Boolean).join(" · "), " · ", sourceLink(m)),
      h("p", {}, `${plural(here.length, DATA.club + " skater")}, ${plural(pbCount, "new PB")}.`),
      ...here.map((sk) => {
        const rs = sk.results.filter((r) => r.meet === id);
        const pbs = rs.filter((r) => r.pb);
        return h("details", { class: "meet" },
          h("summary", {},
            h("span", { class: "who" }, h("strong", {}, sk.name), h("span", { class: "sub" }, profileText(sk))),
            pbs.length ? h("span", { class: "badge" }, plural(pbs.length, "PB")) : null),
          h("div", { class: "body" },
            pbs.length ? pbList(pbs) : null,
            raceTable(rs),
            h("p", {}, h("a", { href: `#/s/${sk.id}` }, `${sk.name}'s page ›`))));
      }));
  }

  /* ---------- times by age (coaches) ---------- */

  // Typical times by age, from every skater's season best at the meets in the
  // data (all clubs, all seasons), with club skaters' season bests placed
  // against them by name.
  function ageSection() {
    const C = DATA.coaches;
    const NORMS = C.events;
    const keys = Object.keys(NORMS).sort((a, b) => compareNorms(NORMS[a], NORMS[b]));
    if (!keys.length) return null;
    const seasons = Object.keys(C.club).sort().reverse();
    const clubPoints = (key, period) => (period === "all" ? seasons : [period])
      .flatMap((x) => ((C.club[x] || {})[key] || []).map(([age, t, id]) => ({ age, t, season: x, sk: byId.get(id) })));

    const periodSelect = h("select", { "aria-label": "Club skaters from" },
      h("option", { value: "all" }, "All seasons"), seasons.map((x) => h("option", { value: x }, x)));
    const eventSelect = h("select", { "aria-label": "Distance" }, eventOptions(keys, NORMS));
    eventSelect.value = keys.slice().sort((a, b) => clubPoints(b, "all").length - clubPoints(a, "all").length)[0];
    // The drop-downs stay open or closed as the choices change.
    const out = h("div"), averagesBody = h("div", { class: "body" });
    const averages = h("details", { class: "meet" }, h("summary", {}, h("strong", {}, "Averages by age")), averagesBody);
    const namesCount = h("span", { class: "sub" }), namesBody = h("div", { class: "body" });
    const names = h("details", { class: "meet" },
      h("summary", {}, h("span", { class: "who" }, h("strong", {}, `${DATA.club} skaters`), namesCount)), namesBody);
    const render = () => {
      const norm = NORMS[eventSelect.value], period = periodSelect.value;
      const points = clubPoints(eventSelect.value, period);
      out.replaceChildren(...normsView(norm, points, period));  // also gives each point its z
      averagesBody.replaceChildren(ageTable(norm, points));
      names.hidden = !points.length;
      namesCount.textContent = plural(points.length, "season best");
      namesBody.replaceChildren(namesTable(norm, points, period));
    };
    eventSelect.addEventListener("change", render);
    periodSelect.addEventListener("change", render);
    render();
    const total = Object.values(NORMS).reduce((n, e) => n + e.n, 0);
    return h("section", { id: "times-by-age" },
      h("h2", {}, "Times by age (for coaches)"),
      h("p", { class: "lede" },
        `Typical times at each age, from every skater's season best at Atlantic meets (all clubs, ${C.seasons[0]} to ${C.seasons[1]}; national and Quebec meets left out), with ${DATA.club} skaters' season bests placed against them. Tap a dot to see whose it is.`),
      h("div", { class: "controls" }, h("label", {}, "Distance", eventSelect), h("label", {}, `${DATA.club} skaters from`, periodSelect)),
      out,
      averages,
      names,
      h("details", { class: "meet" },
        h("summary", {}, h("strong", {}, "How to read this")),
        h("div", { class: "body" }, h("ul", { class: "notes" },
          h("li", {}, `Each point behind the averages is one skater's best time at that distance in one season, with their age for that season: ${total.toLocaleString("en-CA")} season bests in all.`),
          h("li", {}, "The band is one standard deviation either side of the average: about two in three skaters fall inside it. Ages with fewer than 5 skaters are left out."),
          h("li", {}, "“SD faster” (+ in the skater list) is how many standard deviations a season best is ahead of the average for that age."),
          h("li", {}, "Results don't say whether a skater is a boy or a girl, so they're pooled."),
          h("li", {}, "On smaller tracks, the older ages are mostly skaters who haven't moved up to a bigger track yet, so those averages run slow.")))));
  }

  function compareNorms(A, B) {
    return (A.discipline === "long") - (B.discipline === "long") || B.track - A.track || A.distance - B.distance;
  }

  // Averages to a tenth of a second: "42.6", "1:02.3".
  function fmtAverage(t) {
    const tenths = Math.round(t * 10), minutes = Math.floor(tenths / 600);
    const secs = ((tenths - minutes * 600) / 10).toFixed(1);
    return minutes ? `${minutes}:${secs.padStart(4, "0")}` : secs;
  }

  // "0.4 SD faster", "1.2 SD slower", or "about average" when it rounds to 0.0.
  const nearAverage = (z) => Math.abs(z) < 0.05;
  const zText = (z) => (nearAverage(z) ? "about average" : `${Math.abs(z).toFixed(1)} SD ${z >= 0 ? "faster" : "slower"}`);

  function normsView(norm, points, period) {
    const byAge = new Map(norm.ages.map(([age, n, mean, sd]) => [age, { n, mean, sd }]));
    for (const p of points) {
      const a = byAge.get(p.age);
      p.z = a ? (a.mean - p.t) / a.sd : null;
    }
    const scored = points.filter((p) => p.z != null);
    const meanZ = scored.length ? scored.reduce((n, p) => n + p.z, 0) / scored.length : null;
    const who = period === "all" ? `${DATA.club}, all seasons` : `${DATA.club}, ${period}`;
    const trend = norm.per_year < 0
      ? `Across all skaters, times at this distance drop about ${Math.abs(norm.per_year * 100).toFixed(1)}% for each year of age.`
      : `Across all skaters, times at this distance don't drop with age (${(norm.per_year * 100).toFixed(1)}% a year): mostly older skaters who haven't moved up a track.`;
    return [
      h("figure", { class: "chart card" },
        h("figcaption", {}, h("span", { class: "who" }, h("strong", {}, `${norm.label} · ${trackName(norm)}`),
          h("span", { class: "sub" }, `${norm.n.toLocaleString("en-CA")} season bests. Lower is faster.`))),
        h("div", { class: "legend" },
          h("span", { class: "key" }, h("span", { class: "key-band" }), "Average ± 1 SD"),
          h("span", { class: "key" }, h("span", { class: "key-dot blue" }), who)),
        normsChart(norm, points, period),
        h("p", { class: "note" }, trend)),
      h("p", {}, points.length
        ? `${who}: ${plural(points.length, "season best")}${meanZ == null ? "." : nearAverage(meanZ) ? ", about average for their age." : `, on average ${zText(meanZ)} than the average for their age.`}`
        : `No ${DATA.club} season bests at this distance${period === "all" ? "" : " that season"}.`),
    ];
  }

  // The average and SD at each age, and the club's season bests there. Uses
  // each point's z from normsView.
  function ageTable(norm, points) {
    const byAge = new Map(norm.ages.map(([age, n, mean, sd]) => [age, { n, mean, sd }]));
    const clubAges = [...new Set([...norm.ages.map((a) => a[0]), ...points.map((p) => p.age)])].sort((a, b) => a - b);
    return h("table", {},
      h("thead", {}, h("tr", {},
        h("th", { class: "num" }, "Age"), h("th", { class: "num" }, "Average"), h("th", { class: "num" }, "SD"),
        h("th", { class: "num" }, DATA.club))),
      h("tbody", {}, clubAges.map((age) => {
        const a = byAge.get(age);
        const mine = points.filter((p) => p.age === age);
        const zs = mine.filter((p) => p.z != null);
        const avgZ = zs.length ? zs.reduce((n, p) => n + p.z, 0) / zs.length : null;
        return h("tr", {},
          h("td", { class: "num" }, age),
          h("td", { class: "num" }, a ? [fmtAverage(a.mean), h("span", { class: "sub" }, plural(a.n, "skater"))] : h("span", { class: "sub" }, "too few")),
          h("td", { class: "num" }, a ? `${a.sd.toFixed(1)} s` : ""),
          h("td", { class: "num" }, mine.length ? [plural(mine.length, "best"), avgZ != null ? h("span", { class: "sub" }, nearAverage(avgZ) ? "about average" : `avg ${zText(avgZ)}`) : null] : ""));
      })));
  }

  // Club skaters' season bests by name: youngest first, then fastest.
  function namesTable(norm, points, period) {
    return h("table", {},
      h("thead", {}, h("tr", {}, h("th", {}, "Skater"), h("th", { class: "num" }, "Age"), h("th", { class: "num" }, "Time"), h("th", { class: "num" }, "SD"))),
      h("tbody", {}, points.slice().sort((a, b) => a.age - b.age || a.t - b.t).map((p) => h("tr", {},
        h("td", {}, h("a", { href: `#/s/${p.sk.id}` }, p.sk.name), period === "all" ? h("span", { class: "sub" }, p.season) : null),
        h("td", { class: "num" }, p.age),
        h("td", { class: "num" }, fmtTime(p.t, norm.discipline)),
        h("td", { class: "num" }, p.z == null ? h("span", { class: "sub" }, "too few") : fmtZ(p.z))))));
  }

  function normsChart(norm, points, period) {
    const plot = h("div", { class: "plot", tabindex: "0", role: "img",
      "aria-label": `${norm.label}, ${trackName(norm)}: average time by age with one standard deviation either side, and ${plural(points.length, "club season best")}. The table below has the numbers.` });
    const tip = h("div", { class: "tip", hidden: true });
    const H = 220, M = { top: 12, right: 14, bottom: 28, left: 46 };
    const ages = [...norm.ages.map((a) => a[0]), ...points.map((p) => p.age)];
    const a0 = Math.min(...ages) - 0.5, a1 = Math.max(...ages) + 0.5;
    const ys = [...norm.ages.flatMap(([, , m, sd]) => [m - sd, m + sd]), ...points.map((p) => p.t)];
    const pad = (Math.max(...ys) - Math.min(...ys)) * 0.08 || 1;
    const lo = Math.min(...ys) - pad, hi = Math.max(...ys) + pad;
    let width = 0, pts = [];
    const x = (age) => M.left + ((age - a0) / (a1 - a0)) * (width - M.left - M.right);
    const y = (t) => M.top + ((hi - t) / (hi - lo)) * (H - M.top - M.bottom);

    function draw() {
      const root = svg("svg", { width, height: H, viewBox: `0 0 ${width} ${H}`, "aria-hidden": "true" });
      const step = niceStep(hi - lo, 5);
      for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
        root.append(svg("line", { class: "grid", x1: M.left, x2: width - M.right, y1: y(t), y2: y(t) }));
        root.append(svg("text", { x: M.left - 6, y: y(t) + 4, "text-anchor": "end" }, tickLabel(t, step)));
      }
      root.append(svg("line", { class: "axis", x1: M.left, x2: width - M.right, y1: H - M.bottom, y2: H - M.bottom }));
      const spacing = x(1) - x(0);
      const every = Math.max(1, Math.ceil(28 / spacing));
      for (let age = Math.ceil(a0); age <= a1; age += every) {
        root.append(svg("text", { x: x(age), y: H - 10, "text-anchor": "middle" }, String(age)));
      }
      root.append(svg("text", { x: width - M.right, y: H - 1, "text-anchor": "end" }, "age"));
      const upper = norm.ages.map(([age, , m, sd]) => `${x(age)},${y(m + sd)}`);
      const lower = norm.ages.slice().reverse().map(([age, , m, sd]) => `${x(age)},${y(m - sd)}`);
      root.append(svg("polygon", { class: "norm-band", points: [...upper, ...lower].join(" ") }));
      root.append(svg("polyline", { class: "norm-line", points: norm.ages.map(([age, , m]) => `${x(age)},${y(m)}`).join(" ") }));
      // Several skaters at one age sit side by side, within that age's slot.
      const count = new Map(), seen = new Map();
      for (const p of points) count.set(p.age, (count.get(p.age) || 0) + 1);
      pts = points.map((p) => {
        const n = count.get(p.age), i = seen.get(p.age) || 0;
        seen.set(p.age, i + 1);
        const gap = Math.min(7, (0.7 * spacing) / n);
        return { p, px: x(p.age) + (i - (n - 1) / 2) * gap, py: y(p.t) };
      });
      for (const q of pts) root.append(svg("circle", { class: "dot", cx: q.px, cy: q.py, r: 4 }));
      plot.replaceChildren(root, tip);
    }

    function show(q) {
      tip.replaceChildren(
        h("div", { class: "tip-head" }, `${q.p.sk.name} · age ${q.p.age}${period === "all" ? ` · ${q.p.season}` : ""}`),
        h("div", { class: "tip-row" }, h("strong", {}, fmtTime(q.p.t, norm.discipline)),
          h("span", {}, q.p.z == null ? "too few skaters this age" : zText(q.p.z))));
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${q.px > width / 2 ? Math.max(0, q.px - tw - 12) : Math.min(width - tw, q.px + 12)}px`;
      tip.style.top = `${Math.max(0, Math.min(H - 60, q.py - 20))}px`;
      openTip = { plot, hide };
    }
    function hide() { tip.hidden = true; }
    function nearest(e) {
      const box = plot.getBoundingClientRect();
      const px = e.clientX - box.left, py = e.clientY - box.top;
      let best = null, bestD = 24 * 24;  // a generous hit area around each dot
      for (const q of pts) {
        const d = (q.px - px) ** 2 + (q.py - py) ** 2;
        if (d < bestD) { best = q; bestD = d; }
      }
      return best;
    }
    plot.addEventListener("pointermove", (e) => { const q = nearest(e); if (q) show(q); else hide(); });
    plot.addEventListener("pointerdown", (e) => { const q = nearest(e); if (q) show(q); });
    plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    plot._observer = new ResizeObserver(() => requestAnimationFrame(() => {
      const w = Math.round(plot.clientWidth);
      if (w && w !== width) {
        width = w;
        draw();
      }
    }));
    plot._observer.observe(plot);
    return plot;
  }

  /* ---------- club over time ---------- */

  // The club's median skater each season against all skaters their age, and
  // other clubs' median skater (club_trend in skating/build.py). Rows: [season,
  // club skaters, club median, its SE, other skaters, other median, its SE].
  const startYear = (row) => Number(row[0].slice(0, 4));

  function trendSection() {
    const rows = DATA.club_trend;
    if (rows.length < 2) return null;
    const missing = [];
    for (let i = 1; i < rows.length; i++) {
      for (let y = startYear(rows[i - 1]) + 1; y < startYear(rows[i]); y++) missing.push(`${y}-${String(y + 1).slice(2)}`);
    }
    return h("section", {},
      h("h2", {}, "Club over time"),
      h("p", { class: "lede" }, `How ${DATA.club} skaters compare with all skaters their age, season by season. 0 is the average for their age; higher is faster.`),
      h("figure", { class: "chart card" },
        h("div", { class: "legend" },
          h("span", { class: "key" }, h("span", { class: "key-line" }), DATA.club),
          h("span", { class: "key" }, h("span", { class: "key-line others" }), "Other clubs"),
          h("span", { class: "key" }, h("span", { class: "key-band" }), "Uncertainty")),
        trendChart(rows)),
      h("details", { class: "meet" },
        h("summary", {}, h("strong", {}, "Season by season")),
        h("div", { class: "body" }, h("table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Season"), h("th", { class: "num" }, DATA.club), h("th", { class: "num" }, "Other clubs"))),
          h("tbody", {}, rows.slice().reverse().map(([season, n, z, se, on, oz, ose]) => h("tr", {},
            h("td", { class: "nowrap" }, season),
            h("td", { class: "num" }, fmtZ(z, 2), h("span", { class: "pm" }, ` ±${se.toFixed(2)}`), h("span", { class: "sub" }, plural(n, "skater"))),
            h("td", { class: "num" }, oz == null ? "" : [fmtZ(oz, 2), h("span", { class: "pm" }, ` ±${ose.toFixed(2)}`), h("span", { class: "sub" }, plural(on, "skater"))]))))))),
      h("details", { class: "meet" },
        h("summary", {}, h("strong", {}, "How to read this")),
        h("div", { class: "body" }, h("ul", { class: "notes" },
          h("li", {}, "Each skater gets one figure a season: how many standard deviations their season bests are from the average for their age (the averages in times by age), averaged over the distances they skated."),
          h("li", {}, "The line is the club's middle skater that season: half were faster, half slower. Other clubs is the middle skater from everyone else at the meets."),
          h("li", {}, "The shaded bands, and the ± in the table, are one standard error: how far each figure could move by chance with that many skaters, not how spread out the skaters are. Gaps and moves smaller than the bands may not mean much."),
          h("li", {}, `A skater counts for the club they raced for that season. Seasons with fewer than 5 ${DATA.club} skaters are left out.${missing.length ? ` No results for ${missing.join(", ")}.` : ""}`)))));
  }

  function trendChart(rows) {
    const plot = h("div", { class: "plot", tabindex: "0", role: "img",
      "aria-label": `${DATA.club}'s middle skater each season, in standard deviations from the average for their age, with other clubs for comparison. The table below has the numbers.` });
    const tip = h("div", { class: "tip", hidden: true });
    const H = 200, M = { top: 12, right: 14, bottom: 24, left: 40 };
    const y0 = startYear(rows[0]), y1 = startYear(rows[rows.length - 1]);
    const vals = [0, ...rows.flatMap(([, , z, se, , oz, ose]) => [z - se, z + se, ...(oz == null ? [] : [oz - ose, oz + ose])])];
    const pad = (Math.max(...vals) - Math.min(...vals)) * 0.1 || 0.2;
    const lo = Math.min(...vals) - pad, hi = Math.max(...vals) + pad;
    let width = 0, active = -1;
    const x = (row) => M.left + ((startYear(row) - y0 + 0.5) / (y1 - y0 + 1)) * (width - M.left - M.right);
    const y = (z) => M.top + ((hi - z) / (hi - lo)) * (H - M.top - M.bottom); // faster is higher
    // Runs of back-to-back seasons: a season without results breaks the lines.
    const runs = [];
    for (const row of rows) {
      const run = runs[runs.length - 1];
      if (run && startYear(row) === startYear(run[run.length - 1]) + 1) run.push(row);
      else runs.push([row]);
    }
    const line = (run, i) => run.filter((row) => row[i] != null).map((row) => `${x(row)},${y(row[i])}`).join(" ");
    // One standard error either side of column i (its SE is column i + 1).
    const band = (run, i, cls) => {
      const rs = run.filter((row) => row[i] != null);
      const upper = rs.map((row) => `${x(row)},${y(row[i] + row[i + 1])}`);
      const lower = rs.slice().reverse().map((row) => `${x(row)},${y(row[i] - row[i + 1])}`);
      return svg("polygon", { class: cls, points: [...upper, ...lower].join(" ") });
    };

    function draw() {
      const root = svg("svg", { width, height: H, viewBox: `0 0 ${width} ${H}`, "aria-hidden": "true" });
      const step = niceStep(hi - lo, 7);
      for (let i = Math.ceil(lo / step); i * step <= hi; i++) {  // the 0 line is the average for age
        root.append(svg("line", { class: i ? "grid" : "axis", x1: M.left, x2: width - M.right, y1: y(i * step), y2: y(i * step) }));
        root.append(svg("text", { x: M.left - 6, y: y(i * step) + 4, "text-anchor": "end" }, i ? fmtZ(i * step) : "0"));
      }
      // Season labels, as many as fit, counted back from the latest so it always has one.
      const every = Math.max(1, Math.ceil(34 / ((width - M.left - M.right) / (y1 - y0 + 1))));
      for (const row of rows) {
        if ((y1 - startYear(row)) % every === 0) root.append(svg("text", { x: x(row), y: H - 6, "text-anchor": "middle" }, row[0].slice(2)));
      }
      for (const run of runs) root.append(band(run, 5, "trend-band others"), band(run, 2, "trend-band"));
      for (const run of runs) {
        root.append(svg("polyline", { class: "trend-others", points: line(run, 5) }), svg("polyline", { class: "result-line", points: line(run, 2) }));
      }
      const cross = svg("line", { class: "cross", y1: M.top, y2: H - M.bottom, visibility: "hidden" });
      root.append(cross);
      for (const row of rows) root.append(svg("circle", { class: "dot", cx: x(row), cy: y(row[2]), r: 4 }));
      plot.replaceChildren(root, tip);
      plot._cross = cross;
      if (active >= 0) show(active);
    }

    function show(i) {
      active = Math.max(0, Math.min(rows.length - 1, i));
      const [season, n, z, , on, oz] = rows[active], gx = x(rows[active]);
      plot._cross.setAttribute("x1", gx);
      plot._cross.setAttribute("x2", gx);
      plot._cross.setAttribute("visibility", "visible");
      tip.replaceChildren(
        h("div", { class: "tip-head" }, season),
        h("div", { class: "tip-row" }, h("span", { class: "tip-key" }), h("strong", {}, fmtZ(z, 2)), h("span", {}, `${DATA.club}, ${plural(n, "skater")}`)),
        oz == null ? null : h("div", { class: "tip-row" }, h("span", { class: "tip-key others" }), h("strong", {}, fmtZ(oz, 2)), h("span", {}, `other clubs, ${plural(on, "skater")}`)));
      tip.hidden = false;
      const tw = tip.offsetWidth;
      tip.style.left = `${gx > width / 2 ? Math.max(0, gx - tw - 10) : Math.min(width - tw, gx + 10)}px`;
      openTip = { plot, hide };
    }

    function hide() {
      active = -1;
      tip.hidden = true;
      if (plot._cross) plot._cross.setAttribute("visibility", "hidden");
    }

    function nearest(clientX) {
      const px = clientX - plot.getBoundingClientRect().left;
      let best = 0;
      rows.forEach((row, i) => { if (Math.abs(x(row) - px) < Math.abs(x(rows[best]) - px)) best = i; });
      return best;
    }

    plot.addEventListener("pointermove", (e) => show(nearest(e.clientX)));
    plot.addEventListener("pointerdown", (e) => show(nearest(e.clientX)));
    plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    plot._observer = new ResizeObserver(() => requestAnimationFrame(() => {
      const w = Math.round(plot.clientWidth);
      if (w && w !== width) {
        width = w;
        draw();
      }
    }));
    plot._observer.observe(plot);
    return plot;
  }

  /* ---------- race days ---------- */

  // Race days come from the meets' division lists (race_day.py): who's
  // skating, in which division, at which distances. The race day page lists
  // club skaters by division and bib with their PBs and season bests, never
  // ranked; seed times and chances, which compare skaters, are on the
  // coaches' page behind the PIN.
  const RACE_DAYS = DATA.race_days || [];
  const raceByKey = new Map(RACE_DAYS.map((rd) => [rd.key, rd]));
  const BANNER_BEFORE = 7, BANNER_AFTER = 7;  // days: race week, and a week of PBs once results are published
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  function addDays(iso, n) {
    const d = parseDate(iso);
    d.setDate(d.getDate() + n);
    return isoDay(d);
  }
  const fmtDay = (iso) => `${WEEKDAYS[parseDate(iso).getDay()]} ${fmtShortDate(iso)}`;
  const raceDates = (rd) => (rd.end_date !== rd.start_date ? `${fmtDay(rd.start_date)} to ${fmtDay(rd.end_date)}` : fmtDay(rd.start_date));
  function seasonOf(iso) {
    const y = Number(iso.slice(0, 4)), start = Number(iso.slice(5, 7)) >= 7 ? y : y - 1;
    return `${start}-${String(start + 1).slice(2)}`;
  }
  // "3 laps" rather than "3 laps (255 m)", with the track when it isn't the division's.
  function shortEvent(key, track) {
    const ev = EVENTS[key];
    const name = ev.label.replace(/ \(.*\)$/, "");
    return ev.discipline === "short" && ev.track !== track ? `${name} (${ev.track} m track)` : name;
  }
  const trackOf = (rd, d) => (rd.discipline === "long" ? "long track" : `${d.track} m track`);
  const sentenceCase = (text) => text[0].toUpperCase() + text.slice(1);
  const newPbsAt = (meet, list) => list.reduce((n, sk) => n + sk.results.filter((r) => r.meet === meet && r.pb).length, 0);

  // A race day's banner shows in race week until its results are in, or
  // until a week after it if they never come. Then the meet's new PBs show
  // for a week from when the results were published.
  function activeRaceDays() {
    const t = isoDay(today);
    return RACE_DAYS.filter((rd) => {
      const m = rd.meet && MEETS[rd.meet];
      if (m) return t <= addDays(m.added || rd.end_date, BANNER_AFTER);
      return addDays(rd.start_date, -BANNER_BEFORE) <= t && t <= addDays(rd.end_date, BANNER_AFTER);
    });
  }
  function raceEntry(rd, id) {
    for (const d of rd.divisions) for (const s of d.skaters) if (s.id === id) return { d, s };
    return null;
  }

  // On a skater's page the banner says where they're racing, or how many PBs they set.
  function raceBanners(sk) {
    const items = activeRaceDays().map((rd) => {
      if (rd.meet && MEETS[rd.meet]) {
        const mine = sk ? newPbsAt(rd.meet, [sk]) : 0;
        const text = mine ? `${plural(mine, "new PB")} at ${meetName(rd.meet)}` : `New PBs from ${meetName(rd.meet)}: ${newPbsAt(rd.meet, skaters)}`;
        return h("a", { class: "banner", href: `#/meet/${rd.meet}` }, h("span", {}, h("strong", {}, text)), h("span", { class: "chev", "aria-hidden": "true" }, "›"));
      }
      const mine = sk && raceEntry(rd, sk.id);
      const text = mine
        ? [h("strong", {}, `Racing ${fmtDay(rd.start_date)} at ${rd.name}`),
          h("span", { class: "sub" }, `${mine.d.name}: ${mine.d.events.map((k) => shortEvent(k, mine.d.track)).join(", ")}`)]
        : [h("strong", {}, `${rd.name}, ${raceDates(rd)}`), h("span", { class: "sub" }, "Race day: who's skating, and their PBs")];
      return h("a", { class: "banner", href: mine ? `#/race/${rd.key}/s/${sk.id}` : `#/race/${rd.key}` },
        h("span", { class: "who" }, text), h("span", { class: "chev", "aria-hidden": "true" }, "›"));
    });
    return items.length ? h("div", { class: "banners" }, items) : null;
  }

  function seasonBest(sk, key, season) {
    let best = null;
    for (const r of sk.valid) if (r.event === key && MEETS[r.meet].season === season && (!best || r.time < best.time)) best = r;
    return best;
  }
  function pbCell(r, discipline) {
    return h("td", { class: "num" }, r ? [fmtTime(r.time, discipline), h("span", { class: "sub" }, fmtShortDate(MEETS[r.meet].start_date))]
      : h("span", { class: "muted" }, "first race"));
  }
  // The season best, unless it's the PB.
  function seasonCell(sb, pb, discipline) {
    if (sb && pb && sb.time === pb.time) return h("td", { class: "num muted" }, "PB");
    return h("td", { class: "num" }, sb ? fmtTime(sb.time, discipline) : h("span", { class: "muted" }, "none yet"));
  }

  function showRace(rd, focus) {
    document.title = `${rd.name} race day · ${DATA.title}`;
    const season = seasonOf(rd.start_date);
    const count = rd.divisions.reduce((n, d) => n + d.skaters.length, 0);
    const keys = [...new Set(rd.divisions.flatMap((d) => d.events))].sort(compareEvents);
    const box = h("div");
    const search = h("input", { class: "search", type: "search", placeholder: "Find a skater", "aria-label": "Find a skater", autocomplete: "off" });
    const distance = h("select", { "aria-label": "Distance" }, h("option", { value: "" }, "All distances"), eventOptions(keys, EVENTS));
    const groupWord = rd.discipline === "long" ? "group" : "division";
    const division = h("select", { "aria-label": sentenceCase(groupWord) }, h("option", { value: "" }, `All ${groupWord}s`),
      rd.divisions.map((d, i) => h("option", { value: String(i) }, d.name)));
    const focused = focus && byId.get(focus);
    if (focused) search.value = focused.name;

    const nameOf = (s) => (s.id ? byId.get(s.id).name : s.name);
    function skaterCard(d, s) {
      const sk = s.id && byId.get(s.id);
      const head = h("div", { class: "board-head" },
        sk ? h("a", { href: `#/s/${sk.id}` }, h("strong", {}, sk.name)) : h("strong", {}, s.name),
        s.bib ? h("span", { class: "bib" }, `Bib ${s.bib}`) : null);
      if (!sk) return h("div", { class: "card" }, head, h("p", { class: "note" }, "First meet: no times yet."));
      return h("div", { class: "card table-card" }, head, h("table", { class: "compact" },
        h("thead", {}, h("tr", {}, h("th", {}, "Distance"), h("th", { class: "num" }, "PB"), h("th", { class: "num" }, "Season best"))),
        h("tbody", {}, d.events.map((k) => h("tr", {},
          h("td", {}, shortEvent(k, d.track)),
          pbCell(sk.pbs[k], EVENTS[k].discipline),
          seasonCell(seasonBest(sk, k, season), sk.pbs[k], EVENTS[k].discipline))))));
    }
    // One distance: a table per division, in bib order like the division list.
    function distanceTable(d, k, list) {
      return h("div", { class: "card table-card" }, h("table", { class: "compact" },
        h("thead", {}, h("tr", {}, h("th", {}, "Skater"), h("th", { class: "num" }, "PB"), h("th", { class: "num" }, "Season best"))),
        h("tbody", {}, list.map((s) => {
          const sk = s.id && byId.get(s.id);
          return h("tr", {},
            h("td", {}, sk ? h("a", { href: `#/s/${sk.id}` }, sk.name) : s.name, s.bib ? h("span", { class: "sub" }, `Bib ${s.bib}`) : null),
            sk ? pbCell(sk.pbs[k], EVENTS[k].discipline) : h("td", { class: "num muted" }, "first meet"),
            sk ? seasonCell(seasonBest(sk, k, season), sk.pbs[k], EVENTS[k].discipline) : h("td"));
        }))));
    }
    function render() {
      const q = search.value.trim().toLowerCase(), k = distance.value, di = division.value;
      const parts = [];
      rd.divisions.forEach((d, i) => {
        if (di !== "" && Number(di) !== i) return;
        if (k && !d.events.includes(k)) return;
        const list = d.skaters.filter((s) => !q || nameOf(s).toLowerCase().includes(q));
        if (!list.length) return;
        parts.push(h("h2", {}, d.name),
          h("p", { class: "lede" }, `${trackOf(rd, d)} · ${d.events.map((e) => shortEvent(e, d.track)).join(", ")}`,
            d.division != null ? h("span", { class: "muted" }, ` · ${plural(d.field, "skater")} in the division`) : null));
        if (k) parts.push(distanceTable(d, k, list));
        else parts.push(...list.map((s) => skaterCard(d, s)));
      });
      box.replaceChildren(...(parts.length ? parts : [h("p", { class: "empty" }, "No skater matches.")]));
    }
    for (const el of [search, distance, division]) el.addEventListener(el === search ? "input" : "change", render);
    render();

    const others = RACE_DAYS.filter((o) => o !== rd && o.start_date <= rd.end_date && rd.start_date <= o.end_date);
    const listNote = rd.list
      ? [" · Division list posted ", rd.list.url ? h("a", { href: rd.list.url }, fmtShortDate(rd.list.posted)) : fmtShortDate(rd.list.posted)]
      : [" · Skaters and distances set by the club"];
    app.replaceChildren(...[
      h("p", { class: "crumb" }, h("a", { href: "#/" }, "‹ All skaters")),
      h("h1", {}, rd.name),
      h("p", { class: "lede" }, `${raceDates(rd)} · ${plural(count, DATA.club + " skater")}`, ...listNote),
      others.length ? h("p", { class: "buttons" }, h("span", { class: "toggle" },
        [rd, ...others].sort((a, b) => a.discipline.localeCompare(b.discipline)).reverse().map((o) => h("button", {
          type: "button", "aria-pressed": String(o === rd), onclick: () => { location.hash = `#/race/${o.key}`; },
        }, o.discipline === "long" ? "Long track" : "Short track")))) : null,
      h("p", { class: "buttons" }, pdfButton(`race-${rd.key}.pdf`, "Race day sheet (PDF)"),
        h("a", { class: "button secondary", href: `#/race/${rd.key}/coaches` }, seeded(rd) ? "Coaches: seeds, chances and goals" : "Coaches: PB handouts")),
      search,
      h("div", { class: "controls" }, h("label", {}, "Distance", distance), h("label", {}, sentenceCase(groupWord), division)),
      box,
      h("details", { class: "meet" }, h("summary", {}, h("strong", {}, "About this page")),
        h("div", { class: "body" }, h("ul", { class: "notes" },
          h("li", {}, rd.list ? "Divisions, bibs and distances come from the meet's division list, in race order. A newer list replaces it when it's posted."
            : rd.discipline === "long" ? "Skaters were set by the club. Their groups and distances are last season's for their age, so they may change."
            : "Skaters and distances were set by the club."),
          h("li", {}, `PB: fastest time ever at that distance and track. Season best: fastest in ${season}.`),
          h("li", {}, "Skaters are listed by division and bib, as on the division list."),
          h("li", {}, "Something wrong, like a scratch? Tell the club's results volunteer.")))),
    ].filter(Boolean));
  }

  // Seeds and chances are short track only; long track race days have just the handouts.
  const seeded = (rd) => rd.divisions.some((d) => d.coaches);

  function showRaceCoaches(rd) {
    if (!clubUnlocked()) return showPin(() => showRaceCoaches(rd));
    document.title = `${rd.name} ${seeded(rd) ? "seeds" : "coaches"} · ${DATA.title}`;
    const model = DATA.race_model;
    const pct = (p) => (p < 0.01 ? "<1%" : `${Math.round(p * 100)}%`);
    const keyName = (d, key) => {
      const s = d.skaters.find((x) => (x.id || x.key) === key);
      return s ? (s.id ? byId.get(s.id).name : s.name) : key;
    };
    // For each of our skaters the coach picks a goal (1 in 2, 1 in 4 or
    // 1 in 10); the cell shows that time.
    // A see-through select over the cell keeps the columns narrow enough for
    // a phone. Picks are remembered in this browser only. Once results are
    // in, a tick marks a pick that came true.
    const fmtGoal = (t) => fmtTime(t, "short").slice(0, -2);
    const GOALS = ["1 in 2", "1 in 4", "1 in 10"];
    const PICKS_KEY = "race-picks";
    let picks = {};
    try { picks = JSON.parse(localStorage.getItem(PICKS_KEY)) || {}; } catch (e) { /* storage blocked: picks last until reload */ }
    const savePicks = () => { try { localStorage.setItem(PICKS_KEY, JSON.stringify(picks)); } catch (e) { /* as above */ } };
    const anyPlaced = rd.divisions.some((d) => d.coaches && Object.values(d.coaches).some((c) => Object.keys(c.placed).length));
    const usually = (ch) => (ch[2][0] === ch[2][1] ? ordinal(ch[2][0]) : `${ordinal(ch[2][0])}–${ordinal(ch[2][1])}`);
    // options: [[value shown in the cell, its label, came true or null]]
    function pickCell(id, options, fallback) {
      const td = h("td", { class: "num pick" });
      if (!options) return td;
      const value = h("span", { class: "pick-value" }), label = h("span", { class: "pick-label" });
      const select = h("select", { class: "pick-select", "aria-label": "Choose" },
        options.map(([v, l], i) => h("option", { value: String(i) }, `${l}: ${v}`)));
      const show = () => {
        const [v, l, hit] = options[Number(select.value)];
        value.replaceChildren(v, hit ? h("span", { class: "hit", title: "Came true" }, " ✓") : "");
        label.textContent = `${l} ▾`;
      };
      select.value = String(picks[id] != null && options[picks[id]] ? picks[id] : fallback);
      select.addEventListener("change", () => { picks[id] = Number(select.value); savePicks(); show(); });
      show();
      td.append(value, label, select);
      return td;
    }
    const sections = rd.divisions.filter((d) => d.coaches).map((d) => h("details", { class: "meet" },
      h("summary", {}, h("span", { class: "who" }, h("strong", {}, d.name),
        h("span", { class: "sub" }, `${trackOf(rd, d)} · ${d.skaters.map((s) => (s.id ? byId.get(s.id).name : s.name)).join(", ")}`))),
      h("div", { class: "body" }, d.events.map((k) => {
        const c = d.coaches[k];
        if (!c) return null;
        const untimed = c.n - c.seeds.length;
        const ourRow = (t, key, older, i) => {
          const g = c.goals && c.goals[key], raced = c.raced ? c.raced[key] : null;
          const id = `${rd.key}|${k}|${key}`;
          return h("tr", { class: "ours" },
            h("td", { class: "num" }, String(i + 1)),
            h("td", {}, keyName(d, key)),
            h("td", { class: "num" }, fmtTime(t, "short"), older ? "*" : ""),
            pickCell(`${id}|g`, g && GOALS.map((l, j) => [fmtGoal(g[j]), l, raced != null ? raced < g[j] + 0.05 : null]), 0));
        };
        return [h("h3", {}, `${shortEvent(k, d.track)}`, h("span", { class: "muted" }, ` · ${plural(c.n, "skater")}`)),
          h("table", { class: "seeds" },
            h("thead", {}, h("tr", {}, h("th", { class: "num" }, "#"), h("th", {}, "Skater"), h("th", { class: "num" }, "Time"),
              h("th", { class: "num" }, "Goal"))),
            h("tbody", {}, c.seeds.map(([t, key, older], i) => (key ? ourRow(t, key, older, i)
              : h("tr", {}, h("td", { class: "num" }, String(i + 1)), h("td", {}, h("span", { class: "muted" }, "—")),
                h("td", { class: "num" }, fmtTime(t, "short"), older ? "*" : ""), h("td", {})))))),
          untimed ? h("p", { class: "note" }, `${plural(untimed, "skater")} with no time at this distance yet${
            Object.keys(c.chances).filter((key) => !c.seeds.some((x) => x[1] === key)).map((key) => `, including ${keyName(d, key)}`).join("")}.`) : null];
      }))));
    // Placement chances (or places, once results are in), out of the main view.
    const chanceRows = rd.divisions.filter((d) => d.coaches).flatMap((d) => d.events.flatMap((k) => {
      const c = d.coaches[k];
      return c ? Object.keys(c.chances).map((key) => {
        const ch = c.chances[key], placed = c.placed[key];
        return h("tr", {}, h("td", {}, keyName(d, key), h("span", { class: "sub" }, `${d.name} · ${shortEvent(k, d.track)}`)),
          h("td", { class: "num" }, anyPlaced ? (placed ? ordinal(placed) : "") : usually(ch)),
          h("td", { class: "num" }, pct(ch[0]), placed === 1 ? h("span", { class: "hit" }, " ✓") : null),
          h("td", { class: "num" }, pct(ch[1]), placed && placed <= 3 ? h("span", { class: "hit" }, " ✓") : null));
      }) : [];
    }));
    const chancesSection = chanceRows.length ? h("details", { class: "meet" },
      h("summary", {}, h("strong", {}, "Placement chances")),
      h("div", { class: "body" }, h("table", { class: "seeds" },
        h("thead", {}, h("tr", {}, h("th", {}, "Skater"), h("th", { class: "num" }, anyPlaced ? "Placed" : "Usually"),
          h("th", { class: "num" }, "Win"), h("th", { class: "num" }, "Top 3"))),
        h("tbody", {}, chanceRows)))) : null;
    const observed = model ? model.observed.map(([lo, hi, rate]) => `${hi == null ? `more than ${lo}%` : lo ? `${lo}–${hi}%` : `within ${hi}%`}: ${Math.round(rate * 100)}%`) : [];
    app.replaceChildren(...[
      h("p", { class: "crumb" }, h("a", { href: `#/race/${rd.key}` }, "‹ Race day")),
      h("h1", {}, `${rd.name}: ${seeded(rd) ? "seeds" : "coaches"}`),
      h("p", { class: "lede" }, seeded(rd)
        ? `Each division's skaters by seed time at each distance, with ${DATA.club} skaters' goal times. Other clubs' skaters are times only.`
        : "No seeds or chances for long track. PB handouts for the skaters racing, with just their distances here:"),
      // The coaches' printed sheet, PB slips for just the skaters racing, and the lap calculator.
      h("p", { class: "buttons" },
        seeded(rd) ? pdfButton(`race-${rd.key}-coaches.pdf`, "Coaches' sheet (PDF)") : null,
        pdfButton(`race-${rd.key}-handouts.pdf`, "PB handouts for this meet (PDF)"),
        seeded(rd) ? h("a", { class: "button secondary", href: `#/calc/${rd.key}` }, "Lap calculator") : null),
      ...sections,
      chancesSection,
      !seeded(rd) ? null : h("details", { class: "meet" }, h("summary", {}, h("strong", {}, "How to read this")),
        h("div", { class: "body" }, h("ul", { class: "notes" },
          h("li", {}, "Time is the seed time, as Speed Skate NB seeds: fastest this season at that distance, or last season too until December 31. * marks a time from before that."),
          h("li", {}, "Goal: tap to choose a 1 in 2, 1 in 4 or 1 in 10 time for each skater. Choices are remembered on this phone or computer only. Once results are in, ✓ marks the ones that came true."),
          h("li", {}, "Placement chances come from thousands of simulated races. Each skater's race varies around their seed time, and sometimes a race goes quite differently: a fall, a penalty, or a big jump since the seed. Usually is the middle half of their simulated places."),
          model ? h("li", {}, `In ${model.finals} past division finals, the faster of two seeds finished ahead this often, by how far apart the seeds were: ${observed.join("; ")}. The top seed won ${Math.round(model.top_seed_won * 100)}% of the time.`) : null,
          h("li", {}, "Checked against past seasons, chances came out about right up to 40% for a win and 70% for a top 3, and a little high above that."),
          anyPlaced ? h("li", {}, "Placed: where they finished at that distance in the division, A final first. Win and Top 3 are the chances before the meet.") : null,
          h("li", {}, "Goals: times to aim for, from the seed time. 1 in 2, 1 in 4 and 1 in 10: how many skaters of the same age at a similar distance went that fast or faster at their next meet, in past seasons. Skaters with no time yet this season usually improve most. It's for their best race of the meet, heat or final; in a slow, tactical final, times say less."),
          h("li", {}, "A goal counts as reached by their best time at that distance at the meet, heat or final.")))),
    ].filter(Boolean));
  }

  /* ---------- lap calculator ---------- */

  // A lap of each short track, in metres: TRACK_LAP in skating/coaches_sheet.py. Keep the two in step.
  const TRACK_LAP = { 85: 85, 100: 100, 111: 111.12 };
  // Laps in a short track race: whole, or a half more on the 111 m track
  // (500, 1500), whose half lap comes first. null for other distances.
  function lapCount(key) {
    const ev = EVENTS[key];
    if (!ev || ev.discipline !== "short" || !TRACK_LAP[ev.track]) return null;
    const n = ev.distance / TRACK_LAP[ev.track], r = Math.round(n * 2) / 2;
    return Math.abs(n - r) < 0.05 && r >= 2 ? r : null;
  }
  // The time for each lap after the opener: a full lap, or the half lap
  // that starts a race with a half lap more.
  const averageLap = (goal, opener, laps) => (goal - opener) / (laps - (laps % 1 ? 0.5 : 1));
  const fmtTenth = (t) => fmtTime(Math.round(t * 10) / 10, "short").slice(0, -2);

  // Openers typed in, by skater and kind ("full" or "half"), on this device only.
  const OPENERS_KEY = "openers";
  function openers() {
    try { return JSON.parse(localStorage.getItem(OPENERS_KEY)) || {}; } catch (e) { return {}; }
  }
  function saveOpener(id, kind, t) {
    const all = openers();
    all[`${id}|${kind}`] = t;
    try { localStorage.setItem(OPENERS_KEY, JSON.stringify(all)); } catch (e) { /* storage blocked: kept until reload */ }
  }

  // For a phone at the rink, gloves on: big keys of its own, one large
  // answer. Times are typed as on a stopwatch, last digit tenths: 2 4 1 6 is
  // 2:41.6. With a race day (behind the PIN), pick division, distance and
  // skater to fill in the seed, the 1:2 and 1:4 goals and the laps.
  function showCalc(rd) {
    if (rd && !clubUnlocked()) return showPin(() => showCalc(rd));
    document.title = `Lap calculator · ${DATA.title}`;
    const state = { goal: null, opener: null, laps: 4, field: "goal", typed: "", pick: {} };
    const fromDigits = (d) => (d ? Number(d.slice(0, -3) || 0) * 60 + Number(d.slice(-3, -1) || 0) + Number(d.slice(-1)) / 10 : null);
    const toDigits = (t) => {  // 161.6 -> "2416", as typed
      const tenths = Math.round(t * 10), mins = Math.floor(tenths / 600), secs = Math.floor((tenths % 600) / 10);
      return `${mins ? mins + String(secs).padStart(2, "0") : secs}${tenths % 10}`;
    };
    const show = (t) => (t == null ? "—" : fmtTenth(t));

    const out = h("p", { class: "calc-answer", "aria-live": "polite" });
    const outSub = h("p", { class: "calc-sub" });
    const fields = {};
    const fieldRow = (name, label, step) => {
      const value = h("span", { class: "calc-value" });
      const btn = h("button", { type: "button", class: "calc-field", onclick: () => { state.field = name; state.typed = ""; draw(); } },
        h("span", { class: "calc-label" }, label), value);
      fields[name] = { btn, value, label: btn.firstChild };
      const nudge = (d) => h("button", { type: "button", class: "calc-key small", "aria-label": `${label} ${d > 0 ? "plus" : "minus"} ${step}`,
        onclick: () => {
          const v = state[name] == null ? (name === "laps" ? 4 : 0) : state[name];
          state[name] = Math.max(name === "laps" ? 2 : 0, Math.round((v + d) * 10) / 10);
          state.typed = "";
          changed(name);
        } }, d > 0 ? `+${step}` : `−${step}`);
      return h("div", { class: "calc-row" }, btn, nudge(-(name === "laps" ? 0.5 : 0.1)), nudge(name === "laps" ? 0.5 : 0.1));
    };
    const keyPress = (k) => {
      if (state.field === "laps") {  // whole laps typed; ± gives the half
        state.typed = k === "C" ? "" : k === "⌫" ? state.typed.slice(0, -1) : (state.typed + k).slice(-2);
        if (Number(state.typed) >= 2) state.laps = Number(state.typed);
        return draw();
      }
      if (k === "⌫" && !state.typed && state[state.field] != null) state.typed = toDigits(state[state.field]);  // after a nudge or a tap
      if (k === "C") state.typed = "";
      else if (k === "⌫") state.typed = state.typed.slice(0, -1);
      else if (state.typed.length < 5) state.typed = (state.typed + k).replace(/^0+(?=\d)/, "");
      state[state.field] = fromDigits(state.typed);
      changed(state.field);
    };
    const changed = (name) => {
      const p = state.pick;
      if (name === "opener" && p.id && state.opener != null) saveOpener(p.id, state.laps % 1 ? "half" : "full", state.opener);
      draw();
    };
    const keypad = h("div", { class: "calc-keys" },
      ["7", "8", "9", "4", "5", "6", "1", "2", "3", "C", "0", "⌫"].map((k) =>
        h("button", { type: "button", class: "calc-key", "aria-label": k === "⌫" ? "Delete" : k === "C" ? "Clear" : k, onclick: () => keyPress(k) }, k)));

    const picker = h("div");
    function chips(label, items, current, choose) {
      return h("div", { class: "calc-pick" }, h("p", { class: "calc-label" }, label),
        h("div", { class: "calc-chips" }, items.map(([value, text]) =>
          h("button", { type: "button", class: "calc-chip", "aria-pressed": String(value === current), onclick: () => choose(value) }, text))));
    }
    function drawPicker() {
      if (!rd) return;
      const p = state.pick;
      const divisions = rd.divisions.filter((d) => d.coaches);
      const d = divisions.find((x) => x.division === p.division);
      const parts = [chips("Division", divisions.map((x) => [x.division, x.name.replace(/^Division /, "")]), p.division, (v) => {
        state.pick = { division: v };
        drawPicker();
      })];
      if (d) {
        parts.push(chips("Distance", d.events.filter(lapCount).map((k) => [k, shortEvent(k, d.track)]), p.event, (v) => {
          state.pick = { division: p.division, event: v };
          state.laps = lapCount(v);
          drawPicker();
          draw();
        }));
      }
      if (d && p.event) {
        parts.push(chips("Skater", d.skaters.map((s) => [s.id || s.key, s.id ? byId.get(s.id).name : s.name]), p.id, (v) => {
          state.pick = { ...p, id: v };
          const c = d.coaches[p.event], g = c && c.goals[v];
          state.goal = g ? g[0] : null;
          const saved = openers()[`${v}|${state.laps % 1 ? "half" : "full"}`];
          state.opener = saved != null ? saved : state.opener;
          state.field = "goal";
          state.typed = "";
          drawPicker();
          draw();
        }));
      }
      if (d && p.event && p.id) {
        const c = d.coaches[p.event], g = c && c.goals[p.id], seed = c && c.seeds.find((x) => x[1] === p.id);
        parts.push(h("div", { class: "calc-pick" },
          h("p", { class: "calc-label" }, seed ? `Seed ${fmtTime(seed[0], "short")}${seed[2] ? "*" : ""}` : "No seed time yet"),
          g ? h("div", { class: "calc-chips" }, ["1:2", "1:4"].map((label, i) =>
            h("button", { type: "button", class: "calc-chip", onclick: () => { state.goal = g[i]; state.typed = ""; state.field = "goal"; draw(); } },
              `${label} ${fmtTenth(g[i])}`))) : null));
      }
      picker.replaceChildren(...parts);
    }
    function draw() {
      for (const [name, f] of Object.entries(fields)) {
        f.btn.setAttribute("aria-pressed", String(state.field === name));
        f.value.textContent = name === "laps" ? `${state.laps}` : show(state[name]);
      }
      fields.opener.label.textContent = state.laps % 1 ? "Half lap open" : "Opening lap";
      const ok = state.goal != null && state.opener != null && state.goal > state.opener;
      out.textContent = ok ? fmtTenth(averageLap(state.goal, state.opener, state.laps)) : "—";
      outSub.textContent = ok ? `a lap, for the ${state.laps - (state.laps % 1 ? 0.5 : 1)} laps after the ${state.laps % 1 ? "half lap" : "opener"}`
        : "Enter a goal and an opening lap";
    }
    const others = RACE_DAYS.filter((x) => x !== rd && x.divisions.some((d) => d.coaches) && !x.meet);
    app.replaceChildren(...[
      h("p", { class: "crumb" }, rd ? h("a", { href: `#/race/${rd.key}/coaches` }, "‹ Coaches") : h("a", { href: "#/" }, "‹ All skaters")),
      h("h1", {}, rd ? `Lap calculator: ${rd.name}` : "Lap calculator"),
      picker,
      h("div", { class: "calc" },
        h("div", { class: "calc-out" }, out, outSub),
        fieldRow("goal", "Goal", "0.1"), fieldRow("opener", "Opening lap", "0.1"), fieldRow("laps", "Laps", "½"),
        keypad,
        h("p", { class: "note" }, "Type times as on a stopwatch, last digit tenths: 2 4 1 6 is 2:41.6. On a laptop, type on the keyboard; Enter moves to the next box, and the arrow keys nudge. Lap = (goal − opening lap) ÷ (laps − 1); with a half lap (111 m 500 and 1500), (goal − half lap) ÷ (laps − ½). Openers you enter for a skater are remembered on this device.")),
      rd ? h("p", {}, h("a", { href: "#/calc" }, "Blank calculator")) : null,
      ...others.map((x) => h("p", {}, h("a", { href: `#/calc/${x.key}` }, `Fill in from ${x.name}`))),
    ].filter(Boolean));
    // A laptop's keyboard works too: digits (":" and "." are skipped, so
    // 2:41.6 types as it reads), Backspace, Escape to clear, Enter for the
    // next field, and the up and down arrows to nudge.
    const order = ["goal", "opener", "laps"];
    const onKey = (e) => {
      if (!keypad.isConnected) return document.removeEventListener("keydown", onKey);
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      const k = e.key;
      if (/^[0-9]$/.test(k)) keyPress(k);
      else if (k === "Backspace") keyPress("⌫");
      else if (k === "Escape" || k === "Delete") keyPress("C");
      else if (k === "Enter" && (e.target === document.body || e.target.classList.contains("calc-field"))) {
        state.field = order[(order.indexOf(state.field) + 1) % order.length];
        state.typed = "";
        draw();
      } else if (k === "ArrowUp" || k === "ArrowDown") {
        const step = (state.field === "laps" ? 0.5 : 0.1) * (k === "ArrowUp" ? 1 : -1), name = state.field;
        const v = state[name] == null ? (name === "laps" ? 4 : 0) : state[name];
        state[name] = Math.max(name === "laps" ? 2 : 0, Math.round((v + step) * 10) / 10);
        state.typed = "";
        changed(name);
      } else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    drawPicker();
    draw();
  }

  /* ---------- routing ---------- */

  function route() {
    const [view, id, sub, arg] = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    let nav = "skaters";
    if (view === "s" && byId.has(id)) showSkater(byId.get(id));
    else if (view === "race" && raceByKey.has(id) && sub === "coaches") { showRaceCoaches(raceByKey.get(id)); nav = "club"; }
    else if (view === "race" && raceByKey.has(id)) showRace(raceByKey.get(id), sub === "s" ? arg : null);
    else if (view === "meet" && MEETS[id]) { showMeet(id); nav = "club"; }
    else if (view === "club") { showClub(); nav = "club"; }
    else if (view === "standings") { showStandings(); nav = "standings"; }
    else if (view === "calc") { showCalc(raceByKey.get(id)); nav = id ? "club" : null; }
    else if (view === "coaches") { showClub(); nav = "club"; }  // old link; now part of the club page
    else showHome();
    for (const a of document.querySelectorAll("[data-nav]")) {
      if (a.dataset.nav === nav) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    }
    openTip = null;
    window.scrollTo(0, 0);
  }

  document.querySelector(".brand-name").textContent = `${DATA.club} PBs`;
  document.getElementById("foot").replaceChildren(
    h("p", {}, `Results from Speed Skate NB meet result PDFs, updated ${fmtDate(DATA.generated)}. `,
      "PBs count heats and finals, and are kept separately for each track size. ",
      "Times that look like placeholders, or are still being checked, aren't counted."));
  window.addEventListener("hashchange", route);
  route();
  // Saves the site for when the rink's wifi drops (sw.js). Only on the real site.
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch(() => { /* not allowed here, such as in a preview frame */ });
  }
})();
