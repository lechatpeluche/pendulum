#!/usr/bin/env node
/*
 * Automated checks for the Multi-Link Pendulum Lab.
 *
 * Dependency-free Node script. It reads the single-file application
 * (index.html), extracts the inline classic script, evaluates it in a DOM-less
 * environment (the app guards its DOM layer), and exercises the pure
 * Physics and Model modules.
 *
 * Usage:  node tests/run_checks.js
 * Exits nonzero if any check fails.
 */
"use strict";

const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
const failures = [];

function check(name, cond, detail) {
  if (cond) { passed++; console.log("  ok   " + name); }
  else {
    failed++;
    const line = name + (detail !== undefined ? "  -- " + detail : "");
    failures.push(line);
    console.log("  FAIL " + line);
  }
}
function section(t) { console.log("\n== " + t + " =="); }
function approx(a, b, tol) { return Math.abs(a - b) <= tol; }

/* ---------------- load application from index.html ---------------- */

const htmlPath = path.join(__dirname, "..", "index.html");
let html = "";
try {
  html = fs.readFileSync(htmlPath, "utf8");
} catch (e) {
  console.error("Cannot read index.html: " + e.message);
  process.exit(1);
}

section("Static structure of index.html");

check("file exists and is non-trivial", html.length > 5000, html.length + " bytes");
const scripts = html.match(/<script\b[^>]*>/g) || [];
check("exactly one inline script tag", scripts.length === 1 && !/src\s*=/i.test(scripts[0] || ""), JSON.stringify(scripts));
check("no external stylesheets (<link>)", !/<link\b/i.test(html));
check("no external resource URLs (http/https)", !/\bhttps?:\/\//.test(html));
check("no module imports", !/(^|\n)\s*import\s/.test(html) && !/type="module"/i.test(html));
check("no fetch() usage", !/\bfetch\s*\(/.test(html));
check("no @import in CSS", !/@import/.test(html));
check("has a canvas element", /<canvas\b/.test(html));
check("has Start/Reset buttons and speed x1..x10", /Start/.test(html) && /Reset/.test(html) && /x10/.test(html));

const m = html.match(/<script>([\s\S]*?)<\/script>/);
check("extractable inline script body", !!m);
let lab = null;
if (m) {
  try {
    const factory = new Function(m[1] + "\n;return globalThis.PendulumLab;");
    lab = factory();
  } catch (e) {
    console.error("Script evaluation failed: " + e.stack);
  }
}
check("script evaluates without DOM and exposes PendulumLab", !!lab && !!lab.Physics && !!lab.Model);
if (!lab) { process.exit(1); }
const scriptSrc = m[1];   /* reused by the headless view smoke test */

const { Physics, Model } = lab;

/* ----------------------------- physics ----------------------------- */

section("Physics: single pendulum");

/* Exact large-amplitude period: T = 4*sqrt(l/g)*K(sin(theta0/2)),
   K via the arithmetic-geometric mean. */
function ellipticK(k) {
  let a = 1, b = Math.sqrt(1 - k * k);
  while (Math.abs(a - b) > 1e-16) { const an = (a + b) / 2; b = Math.sqrt(a * b); a = an; }
  return Math.PI / (2 * a);
}
function exactPeriod(l, theta0) { return 4 * Math.sqrt(l / Physics.G) * ellipticK(Math.sin(theta0 / 2)); }

function zeroCrossings(l, theta0, T, dt) {
  dt = dt || 0.005;
  const ph = Physics.createPendulum([l], [1], [theta0]);
  const xs = [];
  let prev = theta0;
  for (let t = dt; t <= T + 1e-12; t += dt) {
    ph.integrate(t);
    const th = ph.y[0];
    if ((prev <= 0 && th > 0) || (prev > 0 && th <= 0)) {
      const f = prev / (prev - th);
      xs.push(t - dt + f * dt);
    }
    prev = th;
  }
  return xs;
}

{
  const l = 1, theta0 = 30 * Math.PI / 180;
  const xs = zeroCrossings(l, theta0, 8);
  check("30 deg swing: at least 4 zero crossings found", xs.length >= 4, "got " + xs.length);
  if (xs.length >= 2) {
    const T = 2 * (xs[1] - xs[0]);
    const Texact = exactPeriod(l, theta0);
    check("30 deg period matches elliptic-integral period (rel < 1e-4)",
      Math.abs(T - Texact) / Texact < 1e-4, "T=" + T + " expected " + Texact);
  }
  const xs2 = zeroCrossings(l, 1 * Math.PI / 180, 12);
  if (xs2.length >= 2) {
    const T = 2 * (xs2[1] - xs2[0]);
    const Tsmall = 2 * Math.PI * Math.sqrt(l / Physics.G);
    check("1 deg period matches small-angle formula (rel < 1e-3)",
      Math.abs(T - Tsmall) / Tsmall < 1e-3, "T=" + T + " expected " + Tsmall);
  } else check("1 deg period: crossings found", false, "got " + xs2.length);
}

section("Physics: equilibrium and free rotation");

{
  const ph = Physics.createPendulum([1, 1, 1], [1, 1, 1], [0, 0, 0]);
  ph.integrate(5);
  let maxDev = 0;
  for (let i = 0; i < 6; i++) maxDev = Math.max(maxDev, Math.abs(ph.y[i]));
  check("3-link equilibrium (all down) stays at rest", maxDev < 1e-8, "maxDev=" + maxDev);
}

{
  /* Chain starts almost inverted; it must fall and rotate through 360
     degrees without any angular stop or wrapping. */
  const ph = Physics.createPendulum([1, 1.5], [1, 1], [175 * Math.PI / 180, 90 * Math.PI / 180]);
  let maxAbs = 0;
  for (let t = 0.05; t <= 20 + 1e-12; t += 0.05) {
    ph.integrate(t);
    maxAbs = Math.max(maxAbs, Math.abs(ph.y[0]), Math.abs(ph.y[1]));
  }
  check("near-inverted 2-link chain rotates past +/-180 deg (|theta| > 2*pi)",
    maxAbs > 2 * Math.PI, "maxAbs=" + maxAbs);
}

section("Physics: rigid links (constant lengths)");

{
  const L = [1.25, 0.5, 2.25], M = [2, 3, 4];
  const th0 = [100, -45, 60].map(d => d * Math.PI / 180);
  const ph = Physics.createPendulum(L, M, th0);
  let maxErr = 0, maxR = 0;
  const total = L.reduce((a, b) => a + b, 0);
  for (let t = 0.03; t <= 6 + 1e-12; t += 0.03) {
    ph.integrate(t);
    const j = ph.joints();
    for (let i = 1; i < j.length; i++) {
      const dx = j[i].x - j[i - 1].x, dy = j[i].y - j[i - 1].y;
      maxErr = Math.max(maxErr, Math.abs(Math.hypot(dx, dy) - L[i - 1]));
    }
    /* chain end must stay within total length of the pivot (rigid rods) */
    maxR = Math.max(maxR, Math.hypot(j[j.length - 1].x, j[j.length - 1].y) - total);
  }
  check("adjacent joint distances equal link lengths while moving (err < 1e-8)", maxErr < 1e-8, "maxErr=" + maxErr);
  check("chain end never exceeds total length from pivot (rigid rods)", maxR < 1e-8, "maxR=" + maxR);
}

section("Physics: energy conservation");

function energyDrift(L, M, th0, T, dt) {
  dt = dt || 0.25;
  const ph = Physics.createPendulum(L, M, th0);
  const E0 = ph.energy().E;
  let worst = 0;
  for (let t = dt; t <= T + 1e-12; t += dt) {
    ph.integrate(t);
    worst = Math.max(worst, Math.abs(ph.energy().E - E0));
  }
  return { drift: worst, rel: worst / Math.abs(E0), E0: E0 };
}

{
  const r = energyDrift([1, 2], [1, 1], [90, -60].map(d => d * Math.PI / 180), 60);
  check("2-link (90/-60 deg), 60 s: energy drift < 0.1 %", r.rel < 1e-3,
    "rel=" + r.rel.toExponential(3) + " (abs=" + r.drift + " J, E0=" + r.E0 + ")");
}
{
  const r = energyDrift([1, 0.8, 1.2, 0.6], [2, 3, 5, 4],
    [150, -120, 90, -45].map(d => d * Math.PI / 180), 30);
  check("4-link chaotic, 30 s: energy drift < 1 %", r.rel < 1e-2,
    "rel=" + r.rel.toExponential(3) + " (abs=" + r.drift + " J, E0=" + r.E0 + ")");
}
{
  const r = energyDrift([0.25, 5], [500, 1], [180, -179].map(d => d * Math.PI / 180), 15);
  check("extreme params (0.25 m + 5 m, 500 kg), 15 s: energy drift < 1 %", r.rel < 1e-2,
    "rel=" + r.rel.toExponential(3));
}

section("Physics: convergence with tighter tolerances");

{
  const cfg = { L: [1, 1.5], M: [1, 2], th0: [120, -90].map(d => d * Math.PI / 180), T: 8 };
  function run(rtol, atol, hMax) {
    const ph = Physics.createPendulum(cfg.L, cfg.M, cfg.th0, { rtol: rtol, atol: atol, hMax: hMax });
    ph.integrate(cfg.T);
    return [ph.y[0], ph.y[1], ph.energy().E];
  }
  const a = run(1e-3, 1e-5, 0.05);
  const b = run(1e-6, 1e-8, 0.02);
  const c = run(1e-9, 1e-11, 0.01);
  const dAB = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const dBC = Math.hypot(b[0] - c[0], b[1] - c[1]);
  check("loose vs mid tolerance states differ (test is meaningful)", dAB > 1e-6, "dAB=" + dAB);
  check("tightening tolerance improves state (dBC < dAB)", dBC < dAB, "dAB=" + dAB + " dBC=" + dBC);
  const eAB = Math.abs(a[2] - c[2]) / Math.abs(c[2]);
  check("energy error of loose run is visible but small", eAB > 1e-8 && eAB < 5e-2, "rel=" + eAB.toExponential(3));
}

section("Physics: determinism");

{
  const mk = () => Physics.createPendulum([1, 1, 1], [1, 2, 1], [120, -30, 45].map(d => d * Math.PI / 180));
  const a = mk(), b = mk();
  a.integrate(10); b.integrate(10);
  let diff = 0;
  for (let i = 0; i < 6; i++) diff = Math.max(diff, Math.abs(a.y[i] - b.y[i]));
  check("identical pendulums give identical states at t=10 s", diff === 0, "diff=" + diff);
}

section("Model: default configuration");

{
  const md = Model.create(undefined);
  check("state idle, time 0, speed x1, trails on",
    md.state === "idle" && md.time === 0 && md.speed === 1 && md.trailsOn === true);
  check("2 pendulums, 2 links each",
    md.config.pendulums.length === 2 && md.config.pendulums.every(p => p.links.length === 2));
  const p1 = md.config.pendulums[0], p2 = md.config.pendulums[1];
  check("default links are 1 m / 1 kg",
    [...p1.links, ...p2.links].every(l => l.length === 1 && l.mass === 1));
  check("pendulum 1 angles [120, -10]",
    approx(p1.links[0].angle, 120, 1e-12) && approx(p1.links[1].angle, -10, 1e-12));
  check("pendulum 2 angles [120.01, -10] (angle precision kept)",
    approx(p2.links[0].angle, 120.01, 1e-12) && approx(p2.links[1].angle, -10, 1e-12));
}

section("Model: validation and errors");

{
  const md = Model.create(undefined);
  const bad = md.setField(0, 0, "length", "0");
  check("length 0 rejected with error", bad.ok === false && !!bad.error, JSON.stringify(bad));
  check("config keeps last valid value on invalid input", md.config.pendulums[0].links[0].length === 1);
  check("start is blocked while an error is present", md.start().ok === false);

  const empty = md.setField(0, 0, "mass", "");
  check("empty field rejected", empty.ok === false && !!empty.error);
  check("garbage rejected", md.setField(1, 1, "angle", "abc").ok === false);
  check("angle 200 deg rejected (range -180..180)", md.setField(0, 0, "angle", "200").ok === false);
  check("angle -181 deg rejected", md.setField(0, 0, "angle", "-181").ok === false);
  check("mass 501 kg rejected", md.setField(0, 0, "mass", "501").ok === false);
  check("length 5.01 m rejected", md.setField(0, 0, "length", "5.01").ok === false);

  check("errors are stored per field key",
    md.errors["0:0:length"] !== undefined && md.errors["1:1:angle"] !== undefined);

  /* boundary values must be accepted (inclusive) */
  check("boundary values accepted (0.25 m, 5 m, 1 kg, 500 kg, -180 deg, 180 deg)",
    md.setField(0, 0, "length", "0.25").ok &&
    md.setField(0, 0, "length", "5").ok &&
    md.setField(0, 0, "mass", "1").ok &&
    md.setField(0, 0, "mass", "500").ok &&
    md.setField(0, 0, "angle", "-180").ok &&
    md.setField(0, 0, "angle", "180").ok);

  check("fine angle precision is not rounded (120.0001 kept exactly)",
    md.setField(0, 0, "angle", "120.0001").ok &&
    md.config.pendulums[0].links[0].angle === 120.0001);
}

section("Model: editing while idle (preview), locking while active");

{
  const md = Model.create(undefined);
  md.reset();
  const r = md.setField(0, 1, "angle", "-40");
  check("idle edit accepted", r.ok === true);
  check("idle edit updates config, motion not started",
    md.config.pendulums[0].links[1].angle === -40 && md.state === "idle" && md.time === 0);

  const s = md.start();
  check("start succeeds with valid config", s.ok === true && md.state === "running");
  check("fields locked while running (angle)", md.setField(0, 0, "angle", "10").ok === false);
  check("lengths locked while running", md.setField(0, 0, "length", "2").ok === false);
  check("link count locked while running", md.setLinkCount(0, 3).ok === false);
  check("pendulum count locked while running", md.setPendulumCount(3).ok === false);
  check("config unchanged by rejected edits",
    md.config.pendulums[0].links[0].angle === 120 && md.config.pendulums[0].links.length === 2);
}

section("Model: start / pause / resume / reset");

{
  const a = Model.create(undefined), b = Model.create(undefined);
  const frames = (md, n) => { for (let i = 0; i < n; i++) md.advance(1 / 60); };
  a.start();
  frames(a, 60);                        /* sim time 1 s at x1 (60 frames) */
  check("60 frames of 1/60 s at x1 give sim time 1 s", approx(a.time, 1.0, 1e-9), "t=" + a.time);
  a.pause();
  check("pause state", a.state === "paused");
  const tPaused = a.time, e1 = a.energy().slice();
  a.advance(5.0);                       /* long wall gap while paused */
  check("paused sim does not advance on wall time", approx(a.time, tPaused, 1e-12) && a.energy().every((e, i) => e === e1[i]));
  a.resume();
  check("resume state", a.state === "running");
  frames(a, 30);                        /* another 0.5 s */
  check("resume continues without catching up (t = 1.5 s)", approx(a.time, 1.5, 1e-9), "t=" + a.time);

  /* compare with a run that never paused */
  b.start();
  frames(b, 90);
  const sa = a.snapshot(), sb = b.snapshot();
  let sd = 0;
  for (let p = 0; p < 2; p++) for (let i = 0; i < sa.pendulums[p].angles.length; i++) sd = Math.max(sd, Math.abs(sa.pendulums[p].angles[i] - sb.pendulums[p].angles[i]));
  check("paused+resumed trajectory identical to uninterrupted one", sd === 0, "max angle diff=" + sd);

  a.reset();
  check("reset: idle, t=0, speed x1", a.state === "idle" && a.time === 0 && a.speed === 1);
  const snap = a.snapshot();
  check("reset: angles back to initial, velocities zero",
    approx(snap.pendulums[0].angles[0], 120 * Math.PI / 180, 1e-12) &&
    snap.pendulums.every(p => p.omegas.every(w => w === 0)));
  check("reset: trails cleared", a.trailPoints(0).length === 0 && a.trailPoints(1).length === 0);
  check("reset: advance does nothing until start", a.advance(1) === 0 && a.time === 0);
  check("reset: fields editable again", a.setField(0, 0, "angle", "30").ok === true);
}

{
  /* Reset restores last valid configuration and clears errors */
  const md = Model.create(undefined);
  md.setField(0, 0, "length", "3");             /* valid, accepted */
  md.setField(0, 0, "length", "0");             /* invalid, rejected, error set */
  check("error present before reset", Object.keys(md.errors).length === 1);
  md.reset();
  check("reset clears errors", Object.keys(md.errors).length === 0);
  check("reset restores last valid config (length 3)", md.config.pendulums[0].links[0].length === 3);
}

section("Model: speed");

{
  const md = Model.create(undefined);
  md.start();
  check("invalid speed rejected", md.setSpeed(3).ok === false);
  check("speed x10 advances sim 10x wall time",
    md.setSpeed(10).ok && md.advance(0.05) === 0.5 && approx(md.time, 0.5, 1e-9));
  check("speed x2 advances sim 2x",
    md.setSpeed(2).ok && md.advance(0.1) === 0.2 && approx(md.time, 0.7, 1e-9));
  check("speed change does not alter physical state (angles finite)",
    md.snapshot().pendulums.every(p => p.angles.every(v => Number.isFinite(v))));
  check("speed usable while paused",
    md.pause() && md.setSpeed(5).ok === true && md.resume() && md.advance(0.02) === 0.1);
}

section("Model: hidden tab / frame clamp");

{
  const md = Model.create(undefined);
  md.start();
  const d1 = md.advance(5);   /* e.g. returning from a hidden tab */
  check("wall gap clamped: sim advance <= 0.1 s at x1", d1 === 0.1 && approx(md.time, 0.1, 1e-12), "advance=" + d1);
  md.setSpeed(10);
  const d2 = md.advance(60);
  check("clamped at x10: advance 0.1 s wall -> 1.0 s sim", d2 === 1.0, "advance=" + d2);
  check("negative wall dt ignored", md.advance(-1) === 0);
}

section("Model: trails");

{
  const md = Model.create(undefined);
  md.start();
  for (let i = 0; i < 150; i++) md.advance(0.1);   /* 15 s of sim time */
  const buf = md.trailPoints(0);
  check("trails recorded while running", buf.length > 100, "n=" + buf.length);
  const tNow = md.time;
  check("trail window is the last 10 s of sim time",
    buf.every(pt => tNow - pt[2] <= 10 + 1e-9) && (tNow - buf[0][2]) > 9,
    "oldest age=" + (tNow - buf[0][2]));
  check("trail buffer is bounded (<= 640 points per pendulum)", buf.length <= 640, "n=" + buf.length);
  check("trail points are finite", buf.every(pt => Number.isFinite(pt[0]) && Number.isFinite(pt[1])));

  md.pause();
  const before = JSON.stringify(md.trailPoints(0));
  md.advance(1);
  check("trails do not age while paused (time and buffer frozen)",
    md.time === tNow && JSON.stringify(md.trailPoints(0)) === before);

  md.resume();
  const tip = md.tipPositions()[0];
  md.setTrails(false);
  check("trails off: hidden and cleared", md.trailPoints(0).length === 0);
  md.setTrails(true);
  const seeded = md.trailPoints(0);
  check("trails on again: restarted at current tip position",
    seeded.length === 1 && approx(seeded[0][0], tip.x, 1e-9) && approx(seeded[0][1], tip.y, 1e-9) && approx(seeded[0][2], md.time, 1e-9),
    JSON.stringify(seeded[0]));
}

section("Model: structure changes and defaults");

{
  const md = Model.create(undefined);
  md.reset();
  check("new link defaults 1 m / 1 kg / 0 deg",
    md.setLinkCount(0, 3).ok &&
    md.config.pendulums[0].links[2].length === 1 &&
    md.config.pendulums[0].links[2].mass === 1 &&
    md.config.pendulums[0].links[2].angle === 0);
  check("removing links truncates", md.setLinkCount(0, 1).ok && md.config.pendulums[0].links.length === 1);
  check("new pendulum defaults: 2 links of 1 m / 1 kg / 0 deg",
    md.setPendulumCount(4).ok &&
    md.config.pendulums.length === 4 &&
    md.config.pendulums[3].links.length === 2 &&
    md.config.pendulums[3].links.every(l => l.length === 1 && l.mass === 1 && l.angle === 0));
  check("invalid counts rejected", md.setPendulumCount(5).ok === false && md.setLinkCount(0, 0).ok === false);
  check("structure changes locked while running",
    md.start().ok === true && md.setPendulumCount(1).ok === false);
}

section("Model: integration through the model stays accurate");

{
  /* Full user path: default config -> start -> 30 s at x1 (300 frames). */
  const md = Model.create(undefined);
  const start = md.start();
  check("default config starts", start.ok === true);
  for (let i = 0; i < 300; i++) md.advance(1 / 30);
  /* initial energy computed independently per pendulum */
  const Einit = md.config.pendulums.map((pd) => {
    const ph = Physics.createPendulum(
      pd.links.map(l => l.length), pd.links.map(l => l.mass),
      pd.links.map(l => l.angle * Math.PI / 180));
    return ph.energy().E;
  });
  const E = md.energy();
  const rel = Math.max(...E.map((e, i) => Math.abs(e - Einit[i]) / Math.abs(Einit[i])));
  check("after 30 s of x1 frames, energy drift < 0.5 % (default config)", rel < 5e-3,
    "rel=" + rel.toExponential(3));
  check("sim time after 300 frames of 1/30 s is 10 s", approx(md.time, 10, 1e-6), "t=" + md.time);
  check("angles stay finite", md.snapshot().pendulums.every(p => [...p.angles, ...p.omegas].every(v => Number.isFinite(v))));
}

/* ---------------- View smoke test (headless DOM stub) ----------------
 * Runs the browser-only View code against a minimal DOM stub to catch
 * runtime errors (typos, null references) in the rendering/UI layer.
 * This is NOT a pixel test; visual behaviour needs a real browser.
 */
(function viewSmoke() {
  section("View smoke test (headless DOM stub)");

  const registry = {};
  const ctxStub = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; }
  });

  function makeEl(tag, id) {
    const el = {
      tagName: tag, id: id || "", children: [], style: {}, dataset: {}, attr: {},
      value: "", textContent: "", disabled: false, checked: false, title: "",
      type: "", className: "", width: 0, height: 0,
      listeners: {},
      appendChild(c) { this.children.push(c); return c; },
      remove() {},
      addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
      removeEventListener() {},
      setAttribute(k, v) { this.attr[k] = v; },
      getAttribute(k) { return this.attr[k]; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      classList: { add() {}, remove() {}, contains() { return false; } },
      getBoundingClientRect() { return { width: 600, height: 600, left: 0, top: 0 } }
    };
    if (tag === "canvas") el.getContext = () => ctxStub;
    if (id) registry[id] = el;
    return el;
  }

  let rafQueue = [];
  globalThis.document = {
    hidden: false,
    getElementById: (id) => registry[id] || makeEl(id === "scene" ? "canvas" : "div", id),
    createElement: (tag) => makeEl(tag),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    querySelectorAll: () => [],
    addEventListener() {}
  };
  globalThis.window = { devicePixelRatio: 1, addEventListener() {} };
  globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); return rafQueue.length; };

  let threw = null;
  try {
    new Function(scriptSrc)();   /* executes the View layer in the stub DOM */
  } catch (e) { threw = e; }
  check("view script runs in a DOM-like environment without errors", threw === null,
    threw ? (threw.name + ": " + threw.message) : "");

  if (!threw) {
    const click = (id) => (registry[id].listeners.click || []).forEach(fn => fn());
    const runFrames = (n, tsState) => {
      for (let i = 0; i < n && rafQueue.length; i++) {
        const q = rafQueue; rafQueue = [];
        tsState.t += 1000 / 60;
        q.forEach(fn => fn(tsState.t));
      }
    };
    const ts = { t: 0 };
    runFrames(2, ts);                                   /* idle frames */
    click("btn-start");                                 /* start */
    runFrames(300, ts);                                 /* ~5 s of frames */
    const t1 = registry["time-display"].textContent;
    check("time display advances after Start", /^\d+(\.\d+)? s$/.test(t1) && parseFloat(t1) > 1, "display=" + t1);
    click("btn-start");                                 /* pause */
    runFrames(60, ts);
    check("time display freezes while paused", registry["time-display"].textContent === t1);
    click("btn-reset");                                 /* reset */
    runFrames(30, ts);
    check("reset returns display to 0.00 s and stays there", registry["time-display"].textContent === "0.00 s");
    const startBtn = registry["btn-start"];
    check("Start button label cycles Start/Pause", startBtn.textContent === "Start");
  }

  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.requestAnimationFrame;
})();

/* ------------------------------ summary ----------------------------- */

console.log("\n============================================");
console.log("Checks passed: " + passed + ", failed: " + failed);
if (failed > 0) {
  console.log("Failed checks:");
  failures.forEach(f => console.log("  - " + f));
  process.exit(1);
}
console.log("All checks passed.");
process.exit(0);
