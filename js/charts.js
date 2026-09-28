/*
 * Small dependency-free SVG charts with hover tooltips.
 * Colors come from CSS custom properties so light/dark themes swap in CSS.
 */
(function (root) {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  function el(name, attrs, parent) {
    const node = document.createElementNS(SVG_NS, name);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    if (parent) parent.appendChild(node);
    return node;
  }

  /** Round the top of a bar only (data end), keeping the baseline square. */
  function barPath(x, y, w, h, r) {
    if (h <= 0) return "";
    r = Math.min(r, w / 2, h);
    return (
      `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}` +
      `H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
    );
  }

  /** Same, rounded on the right end for horizontal bars. */
  function hBarPath(x, y, w, h, r) {
    if (w <= 0) return "";
    r = Math.min(r, h / 2, w);
    return (
      `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}` +
      `V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`
    );
  }

  /** Axis scale with round tick steps (1/2/2.5/5 x 10^n) and at most `maxTicks` intervals. */
  function niceScale(v, maxTicks) {
    if (v <= 0) return { max: 1, ticks: 1 };
    const raw = v / maxTicks;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    let step = 10 * exp;
    for (const m of [1, 2, 2.5, 5]) if (m * exp >= raw) { step = m * exp; break; }
    const ticks = Math.ceil(v / step);
    return { max: ticks * step, ticks };
  }

  function compact(value, currency) {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);
    } catch (_) {
      return String(Math.round(value));
    }
  }

  function tooltip(container) {
    let tip = container.querySelector(".chart-tip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "chart-tip";
      tip.setAttribute("role", "status");
      container.appendChild(tip);
    }
    return {
      show(html, x, y) {
        tip.innerHTML = html;
        tip.style.display = "block";
        const cw = container.clientWidth;
        const tw = tip.offsetWidth;
        tip.style.left = Math.max(0, Math.min(cw - tw, x - tw / 2)) + "px";
        tip.style.top = Math.max(0, y - tip.offsetHeight - 10) + "px";
      },
      hide() {
        tip.style.display = "none";
      },
    };
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /**
   * Grouped vertical bars: income vs expenses per month.
   * rows: [{ label, income, expenses }] in major units.
   */
  function incomeExpenseBars(container, rows, opts) {
    const { currency, format } = opts;
    container.querySelector("svg")?.remove();
    const width = Math.max(280, container.clientWidth || 600);
    const height = 240;
    const m = { top: 12, right: 8, bottom: 28, left: 56 };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const { max, ticks } = niceScale(Math.max(1, ...rows.flatMap((r) => [r.income, r.expenses])), 4);
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": opts.label || "Income and expenses by month" });
    container.prepend(svg);

    for (let i = 0; i <= ticks; i++) {
      const v = (max / ticks) * i;
      const y = m.top + ih - (v / max) * ih;
      el("line", { x1: m.left, x2: width - m.right, y1: y, y2: y, class: i === 0 ? "axis-base" : "grid" }, svg);
      el("text", { x: m.left - 8, y: y + 4, class: "tick", "text-anchor": "end" }, svg).textContent = compact(v, currency);
    }

    const band = iw / rows.length;
    const gap = 2;
    const barW = Math.max(4, Math.min(28, (band * 0.6 - gap) / 2));
    const tip = tooltip(container);

    rows.forEach((r, i) => {
      const cx = m.left + band * i + band / 2;
      const g = el("g", { class: "bar-group" }, svg);
      [["income", cx - barW - gap / 2], ["expenses", cx + gap / 2]].forEach(([key, x]) => {
        const h = (r[key] / max) * ih;
        el("path", { d: barPath(x, m.top + ih - h, barW, h, 4), class: "bar bar-" + key }, g);
      });
      el("text", { x: cx, y: height - 8, class: "tick", "text-anchor": "middle" }, svg).textContent = r.label;
      // Hit target covers the whole band, not just the bars.
      const hit = el("rect", { x: m.left + band * i, y: m.top, width: band, height: ih, class: "hit" }, svg);
      const onEnter = () => {
        g.classList.add("hover");
        const net = r.income - r.expenses;
        tip.show(
          `<strong>${escapeHTML(r.fullLabel || r.label)}</strong>` +
            `<div><span class="swatch sw-income"></span>Income <b>${format(r.income)}</b></div>` +
            `<div><span class="swatch sw-expenses"></span>Expenses <b>${format(r.expenses)}</b></div>` +
            `<div class="muted">Net ${format(net)}</div>`,
          cx,
          m.top + ih - (Math.max(r.income, r.expenses) / max) * ih
        );
      };
      hit.addEventListener("mouseenter", onEnter);
      hit.addEventListener("mouseleave", () => { g.classList.remove("hover"); tip.hide(); });
    });
  }

  /**
   * Horizontal bars for spending by category (single hue - magnitude).
   * rows: [{ label, value }] in major units, sorted descending.
   */
  function categoryBars(container, rows, opts) {
    const { format } = opts;
    container.querySelector("svg")?.remove();
    const width = Math.max(280, container.clientWidth || 600);
    const rowH = 30;
    const m = { top: 4, right: 88, bottom: 4, left: Math.min(130, width * 0.35) };
    const height = m.top + m.bottom + rows.length * rowH;
    const iw = width - m.left - m.right;
    const max = Math.max(1, ...rows.map((r) => r.value));
    const total = rows.reduce((s, r) => s + r.value, 0);
    const svg = el("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": opts.label || "Spending by category" });
    container.prepend(svg);
    const tip = tooltip(container);

    rows.forEach((r, i) => {
      const y = m.top + i * rowH;
      const w = (r.value / max) * iw;
      const g = el("g", { class: "bar-group" }, svg);
      el("text", { x: m.left - 10, y: y + rowH / 2 + 4, class: "label", "text-anchor": "end" }, g).textContent = r.label;
      el("path", { d: hBarPath(m.left, y + 7, w, rowH - 14, 4), class: "bar bar-category" }, g);
      el("text", { x: m.left + w + 8, y: y + rowH / 2 + 4, class: "value" }, g).textContent = format(r.value);
      const hit = el("rect", { x: 0, y, width, height: rowH, class: "hit" }, svg);
      hit.addEventListener("mouseenter", () => {
        g.classList.add("hover");
        const share = total ? Math.round((r.value / total) * 100) : 0;
        tip.show(`<strong>${escapeHTML(r.label)}</strong><div>${format(r.value)} · ${share}% of spending</div>`, m.left + w / 2, y);
      });
      hit.addEventListener("mouseleave", () => { g.classList.remove("hover"); tip.hide(); });
    });
  }

  root.Charts = { incomeExpenseBars, categoryBars };
})(globalThis);
